// ============================================================
// degradation.test.ts · 分级降级梯队测试（v1.3.6 交付⑭）
// 验收标准：
//   - 3 个降级触发器可检测（LLM / 审计引擎 / daemon）
//   - 四级降级状态机正确（full → rules-only → minimal → safe-stop）
//   - 每次降级写审计日志（decision-log FALLBACK_DEGRADE）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  DegradationManager,
  getCapability,
  filterRulesForLevel,
  isLlmUnavailable,
  isAuditTimeout,
  isDaemonCrash,
  LEVEL_ORDER,
  CORE_RULE_MIN,
  CORE_RULE_MAX,
} from './degradation';
import { getDecisionLogPath } from '@sofagent/core';

function makeTestDir(): string {
  const dir = join(tmpdir(), `sofagent-degrade-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('degradation 触发器检测', () => {
  it('isLlmUnavailable 识别网络/鉴权/限流故障', () => {
    expect(isLlmUnavailable(new Error('connect ECONNREFUSED 127.0.0.1:8080'))).toBe(true);
    expect(isLlmUnavailable(new Error('fetch failed'))).toBe(true);
    expect(isLlmUnavailable(new Error('401 Unauthorized'))).toBe(true);
    expect(isLlmUnavailable(new Error('429 Too Many Requests'))).toBe(true);
    expect(isLlmUnavailable(new Error('503 Service Unavailable'))).toBe(true);
    expect(isLlmUnavailable('request timeout after 30s')).toBe(true);
  });

  it('isLlmUnavailable 不误报正常错误', () => {
    expect(isLlmUnavailable(new Error('invalid JSON schema'))).toBe(false);
    expect(isLlmUnavailable(new Error('unknown tool name'))).toBe(false);
    expect(isLlmUnavailable(null)).toBe(false);
    expect(isLlmUnavailable(undefined)).toBe(false);
  });

  it('isAuditTimeout 从错误消息检测超时', () => {
    expect(isAuditTimeout(new Error('audit engine timeout'))).toBe(true);
    expect(isAuditTimeout(new Error('operation timed out'))).toBe(true);
    expect(isAuditTimeout(new Error('ETIMEDOUT'))).toBe(true);
  });

  it('isAuditTimeout 从耗时阈值检测超时', () => {
    expect(isAuditTimeout(null, 35_000, 30_000)).toBe(true);
    expect(isAuditTimeout(null, 10_000, 30_000)).toBe(false);
    expect(isAuditTimeout(null)).toBe(false);
  });

  it('isDaemonCrash 检测 health 缺失/停止/心跳停滞', () => {
    expect(isDaemonCrash(null)).toBe(true); // daemon 从未运行
    expect(isDaemonCrash({ status: 'stopped' })).toBe(true);
    // 心跳停滞（30 分钟前）
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isDaemonCrash({ status: 'running', lastHeartbeat: stale })).toBe(true);
    // 健康运行
    const fresh = new Date().toISOString();
    expect(isDaemonCrash({ status: 'running', lastHeartbeat: fresh })).toBe(false);
  });
});

describe('degradation 状态机', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
    // 临时 HMAC key——绝不触碰真实 ~/.sofagent-key
    const keyPath = join(testDir, 'test-hmac-key');
    writeFileSync(keyPath, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.SOFAGENT_KEY_PATH;
  });

  it('初始级别为 full', () => {
    const dm = new DegradationManager({ dataDir: testDir });
    expect(dm.getLevel()).toBe('full');
    expect(dm.isSafeStopped()).toBe(false);
  });

  it('四级降级顺序正确：full → rules-only → minimal → safe-stop', () => {
    const dm = new DegradationManager({ dataDir: testDir });
    expect(dm.degrade('llm-unavailable')?.to).toBe('rules-only');
    expect(dm.getLevel()).toBe('rules-only');
    expect(dm.degrade('audit-timeout')?.to).toBe('minimal');
    expect(dm.getLevel()).toBe('minimal');
    expect(dm.degrade('daemon-crash')?.to).toBe('safe-stop');
    expect(dm.getLevel()).toBe('safe-stop');
    expect(dm.isSafeStopped()).toBe(true);
    // 已到底——无法再降
    expect(dm.degrade('daemon-crash')).toBeNull();
  });

  it('degradeTo 支持跨级直达（只向下）', () => {
    const dm = new DegradationManager({ dataDir: testDir });
    const rec = dm.degradeTo('safe-stop', 'daemon-crash', 'daemon 进程消失直接安全停止');
    expect(rec?.to).toBe('safe-stop');
    expect(rec?.from).toBe('full');
    // 向上不允许
    expect(dm.degradeTo('full', 'llm-unavailable')).toBeNull();
    expect(dm.degradeTo('rules-only', 'llm-unavailable')).toBeNull();
  });

  it('recover 逐级恢复（每次一级）', () => {
    const dm = new DegradationManager({ dataDir: testDir });
    dm.degradeTo('safe-stop', 'daemon-crash');
    expect(dm.recover()?.to).toBe('minimal');
    expect(dm.recover()?.to).toBe('rules-only');
    expect(dm.recover()?.to).toBe('full');
    expect(dm.recover()).toBeNull(); // 已到顶
    expect(dm.getHistory().length).toBe(4);
  });

  it('降级历史记录方向与触发器', () => {
    const dm = new DegradationManager({ dataDir: testDir });
    dm.degrade('llm-unavailable', 'GLM API 连接拒绝');
    dm.recover();
    const history = dm.getHistory();
    expect(history.length).toBe(2);
    expect(history[0]!.direction).toBe('degrade');
    expect(history[0]!.trigger).toBe('llm-unavailable');
    expect(history[0]!.reason).toBe('GLM API 连接拒绝');
    expect(history[1]!.direction).toBe('recover');
    expect(history[1]!.trigger).toBeNull();
  });

  it('每次降级写决策审计日志（kind=FALLBACK_DEGRADE）', () => {
    const dm = new DegradationManager({ dataDir: testDir, agentId: 'audit-engine', sessionId: 'sess-degrade' });
    dm.degrade('llm-unavailable');
    dm.degrade('audit-timeout');

    const logPath = getDecisionLogPath(testDir);
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]!);
    expect(first.kind).toBe('FALLBACK_DEGRADE');
    expect(first.agentId).toBe('audit-engine');
    expect(first.sessionId).toBe('sess-degrade');
    expect(first.why.text).toContain('full → rules-only');
    expect(first.why.tags).toContain('llm-unavailable');
    expect(first.why.tags).toContain('degrade');

    const second = JSON.parse(lines[1]!);
    expect(second.why.text).toContain('rules-only → minimal');
    // 上一级持续时长已记录
    expect(first.why.text).toMatch(/持续 \d+ms/);
  });

  it('recover 也写审计日志（direction=recover）', () => {
    const dm = new DegradationManager({ dataDir: testDir });
    dm.degrade('llm-unavailable');
    dm.recover('LLM 服务恢复');

    const lines = readFileSync(getDecisionLogPath(testDir), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    const recoverEntry = JSON.parse(lines[1]!);
    expect(recoverEntry.why.text).toContain('rules-only → full');
    expect(recoverEntry.why.tags).toContain('recover');
  });

  it('级别持续时长随时间推进', () => {
    let clock = 1_000_000;
    const dm = new DegradationManager({ dataDir: testDir, now: () => clock });
    expect(dm.getCurrentLevelDuration()).toBe(0);
    clock += 60_000;
    expect(dm.getCurrentLevelDuration()).toBe(60_000);
    const rec = dm.degrade('llm-unavailable');
    expect(rec!.durationMs).toBe(60_000); // 在 full 级持续了 60s
    expect(dm.getCurrentLevelDuration()).toBe(0); // 进入新级别重新计时
  });
});

describe('degradation 能力画像与规则过滤', () => {
  it('四级能力画像语义正确', () => {
    const full = getCapability('full');
    expect(full.llmAudit).toBe(true);
    expect(full.diffRules).toBe(true);
    expect(full.coreOnly).toBe(false);
    expect(full.stops).toBe(false);

    const rulesOnly = getCapability('rules-only');
    expect(rulesOnly.llmAudit).toBe(false);
    expect(rulesOnly.diffRules).toBe(true);

    const minimal = getCapability('minimal');
    expect(minimal.llmAudit).toBe(false);
    expect(minimal.coreOnly).toBe(true);

    const safeStop = getCapability('safe-stop');
    expect(safeStop.stops).toBe(true);
    expect(safeStop.diffRules).toBe(false);
  });

  it('filterRulesForLevel：minimal 只保留 A1-A11', () => {
    const rules = [1, 2, 5, 11, 14, 18, 20, 201].map((n) => ({ number: n }));
    const filtered = filterRulesForLevel(rules, 'minimal');
    expect(filtered.map((r) => r.number)).toEqual([1, 2, 5, 11]);
    // 边界值包含
    expect(CORE_RULE_MIN).toBe(1);
    expect(CORE_RULE_MAX).toBe(11);
  });

  it('filterRulesForLevel：full/rules-only 不过滤，safe-stop 清空', () => {
    const rules = [{ number: 1 }, { number: 20 }, { number: 201 }];
    expect(filterRulesForLevel(rules, 'full').length).toBe(3);
    expect(filterRulesForLevel(rules, 'rules-only').length).toBe(3);
    expect(filterRulesForLevel(rules, 'safe-stop').length).toBe(0);
  });

  it('LEVEL_ORDER 顺序固定（单一事实源）', () => {
    expect(LEVEL_ORDER).toEqual(['full', 'rules-only', 'minimal', 'safe-stop']);
  });
});
