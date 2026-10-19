// doctor-decision-log-rate.test.ts · W8 BUG-14：decision-log 可解析率检查回归锁
// 两态验收：
//   ① 50% 坏行 → WARN 可见（输出含失败行数与总数、读侧静默减员语义）；
//   ② 全好行 → ✅（可解析率 100%）。
// 隔离：沙箱 SOFAGENT_HOME + 白名单前缀（对齐 doctor.test.ts 的 setupOntologyTest
// 先例）+ 链校验 mock（隔离 dist/审计噪音）+ console 静音收集。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as auditHistory from '../audit-history';
import { runDoctor } from '../doctor';

function setupDecisionLogTest() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'doctor-dlog-'));
  vi.stubEnv('SOFAGENT_HOME', tmpHome);
  // vitest-setup.mjs 会预置 SOFAGENT_DATA（全局隔离面）——不覆盖它的话
  // resolveDataDir() 读到的是预置面而非本夹具的 tmpHome/data（实测踩坑）
  vi.stubEnv('SOFAGENT_DATA', join(tmpHome, 'data'));
  // /tmp 不在默认白名单——不设会回退真实 ~/.sofagent（path-traversal 防护）
  vi.stubEnv('SOFAGENT_HOME_ALLOWED_PREFIXES', tmpdir());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({ status: 'ok' });

  const auditDir = join(tmpHome, 'data', 'audit');
  mkdirSync(auditDir, { recursive: true });
  const logPath = join(auditDir, 'decision-log.jsonl');

  /** 好行样本（与写侧 emitDecision 同构的最小合法条目） */
  const goodLine = (i: number) =>
    JSON.stringify({ ts: `2026-10-20T00:00:${String(i).padStart(2, '0')}Z`, agentId: 'a', sessionId: 's', kind: 'TOOL_GATE', moment: 'ACT', category: 'select', why: { text: 'x' }, evidence: [] });

  return {
    tmpHome,
    logPath,
    goodLine,
    output: () => (console.log as ReturnType<typeof vi.spyOn>).mock.calls.map((c) => String(c[0])).join('\n'),
    cleanup: () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* 临时面清理尽力而为 */ }
    },
  };
}

describe('doctor decision-log 可解析率（W8 BUG-14）', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

  it('25% 坏行（>5% ≤30%）→ WARN 可见（失败行数/总数 + 读侧静默减员语义）', () => {
    const t = setupDecisionLogTest();
    cleanups.push(t.cleanup);
    // 6 好 + 2 坏（半截 JSON / 非法 kind 各一行）= 25% 失败率——落在 WARN 区间
    // （>5% 且 ≤30%；50% 会跨过 30% 阈值走 FAIL 分支，那是另一态）
    writeFileSync(t.logPath, [
      t.goodLine(0),
      '{"ts": "x", "agentId": "a", "sessionId": "s", "kind": "TOOL_GA', // 半截 JSON
      t.goodLine(1),
      t.goodLine(2),
      JSON.stringify({ ts: 'x', agentId: 'a', sessionId: 's', kind: 'NOT_A_KIND' }), // 非法 kind
      t.goodLine(3),
      t.goodLine(4),
      t.goodLine(5),
    ].join('\n') + '\n', 'utf-8');

    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('decision-log 可解析率 75.0%');
    expect(out).toContain('2/8 行失败');
    expect(out).toContain('判定面事实减少');
    expect(out).toContain('decision-log 可解析率 [全局数据面');
  });

  it('>30% 坏行 → FAIL（数据面大面积腐化语义）', () => {
    const t = setupDecisionLogTest();
    cleanups.push(t.cleanup);
    // 2 好 + 4 坏 = 66.7% 失败率——FAIL 分支
    writeFileSync(t.logPath, [
      t.goodLine(0),
      '{"broken-line-1',
      t.goodLine(1),
      'garbage-not-json',
      JSON.stringify({ ts: 'x', agentId: 'a', sessionId: 's', kind: 'BAD' }),
      'another-bad-line',
    ].join('\n') + '\n', 'utf-8');

    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('可解析率仅 33.3%');
    expect(out).toContain('4/6 行失败');
    expect(out).toContain('大面积腐化');
  });

  it('全好行 → ✅ 可解析率 100%（总数与失败 0 可见）', () => {
    const t = setupDecisionLogTest();
    cleanups.push(t.cleanup);
    writeFileSync(t.logPath, [0, 1, 2].map((i) => t.goodLine(i)).join('\n') + '\n', 'utf-8');

    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('decision-log 可解析率 100%');
    expect(out).toContain('3 行全部可解析');
  });

  it('文件不存在 → 信息级跳过（缺失项形态，不告警）', () => {
    const t = setupDecisionLogTest();
    cleanups.push(t.cleanup);
    // 不写 decision-log.jsonl——不存在是「未产生决策记录」的常态
    runDoctor(t.tmpHome);
    const out = t.output();
    expect(out).toContain('decision-log.jsonl 不存在');
    expect(out).toContain('跳过可解析率检查');
  });
});
