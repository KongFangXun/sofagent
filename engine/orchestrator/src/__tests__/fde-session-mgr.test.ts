// ============================================================
// fde-session-mgr.test.ts · v1.4.5 第八章 · FDE 进场记忆目录工程化测试
//
// 覆盖（对齐 devlog 第八章验收标准）：
//   - fde_interview 首次调用自动初始化客户目录（10 文件结构）——
//     经 initFDEClientSession 幂等语义验证（MCP 挂载点在 fde-interview.ts，
//     其调用即本函数；此处锁引擎层契约）
//   - clientId 校验（空/路径逃逸拒绝；幂等二次调用不重写）
//   - session-stop 自动捕获状态文件（captureFDEClientSession——
//     session-state.json + history.jsonl 追加 + meta.lastCapturedAt）
//   - 跨 session 恢复（restoreFDEClientSession——显式 clientId /
//     缺省取最近捕获 / 未初始化降级 / 损坏文件降级）
//   - 恢复事件留痕（history.jsonl session-restore 行 + meta.lastRestoredAt）
//
// 全部临时目录 fixture——零真实 IO 外溢。FIXED_NOW 时钟注入。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  FDE_SESSION_TEN_FILES,
  initFDEClientSession,
  captureFDEClientSession,
  restoreFDEClientSession,
  isFDEClientInitialized,
  listFDEClients,
  fdeClientSessionDir,
  parseFDEClientContext,
  type FDESessionState,
} from '../fde-session-mgr';

let dataDir: string;
const FIXED_NOW = (): number => new Date('2026-09-05T08:00:00Z').getTime();

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-fde-mgr-test-'));
});

// ──────────────────────────────────────
// fixture
// ──────────────────────────────────────

function makeState(overrides: Partial<FDESessionState> = {}): FDESessionState {
  return {
    schemaVersion: 'v1',
    clientId: 'acme',
    sessionId: 'sess-20260905-1',
    capturedAt: new Date(FIXED_NOW()).toISOString(),
    completed: ['首轮五要素访谈（3 节点）'],
    inProgress: ['报表节点深挖（还差 bottleneck 细节）'],
    nextSteps: ['fde_classify 三问判定', '数据底座评估（§3.9）'],
    openQuestions: ['ERP 导出接口有没有 API？'],
    nodeCount: 3,
    roles: ['运营专员', '数据分析师'],
    ...overrides,
  };
}

// ──────────────────────────────────────
// 初始化（fde_interview 首次调用触发）
// ──────────────────────────────────────

describe('fde-session-mgr · 初始化', () => {
  it('test_initFDEClientSession_十文件结构齐', () => {
    const r = initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    expect(r.created).toBe(true);
    expect(r.files).toEqual([...FDE_SESSION_TEN_FILES]);
    expect(FDE_SESSION_TEN_FILES).toHaveLength(10);
    // 逐文件在场
    for (const f of FDE_SESSION_TEN_FILES) {
      expect(existsSync(join(r.dir, f))).toBe(true);
    }
  });

  it('test_initFDEClientSession_meta内容', () => {
    initFDEClientSession(dataDir, 'acme', { initializedBy: 'fde_interview', now: FIXED_NOW });
    const meta = JSON.parse(
      readFileSync(join(fdeClientSessionDir(dataDir, 'acme'), 'meta.json'), 'utf-8'),
    );
    expect(meta.schemaVersion).toBe('v1');
    expect(meta.clientId).toBe('acme');
    expect(meta.initializedBy).toBe('fde_interview');
    expect(meta.createdAt).toBe(new Date(FIXED_NOW()).toISOString());
    expect(meta.lastCapturedAt).toBeNull();
    expect(meta.lastRestoredAt).toBeNull();
  });

  it('test_initFDEClientSession_幂等二次不重写', () => {
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    // 人工改一个文件后二次初始化——不应被覆盖
    const ctxPath = join(fdeClientSessionDir(dataDir, 'acme'), 'context.md');
    writeFileSync(ctxPath, '---\nclientId: acme\nindustry: fintech\n---\n人工内容', 'utf-8');
    const r2 = initFDEClientSession(dataDir, 'acme', { now: () => new Date('2026-09-06T00:00:00Z').getTime() });
    expect(r2.created).toBe(false);
    expect(readFileSync(ctxPath, 'utf-8')).toContain('人工内容');
  });

  it('test_initFDEClientSession_非法clientId拒绝', () => {
    expect(() => initFDEClientSession(dataDir, '')).toThrow('clientId 必填');
    expect(() => initFDEClientSession(dataDir, '../escape')).toThrow('clientId 不合法');
    expect(() => initFDEClientSession(dataDir, 'a/b')).toThrow('clientId 不合法');
    expect(() => initFDEClientSession(dataDir, 'ok-id_v1.0')).not.toThrow();
  });

  it('test_history首行_初始化事件', () => {
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    const lines = readFileSync(join(fdeClientSessionDir(dataDir, 'acme'), 'history.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(1);
    const first = JSON.parse(lines[0]!);
    expect(first.event).toBe('initialized');
    expect(first.by).toBe('fde_interview');
  });
});

// ──────────────────────────────────────
// session-stop 自动捕获
// ──────────────────────────────────────

describe('fde-session-mgr · session-stop 捕获', () => {
  it('test_capture_状态文件落盘', () => {
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    const state = makeState();
    const path = captureFDEClientSession(dataDir, state);
    expect(path).toBe(join(fdeClientSessionDir(dataDir, 'acme'), 'session-state.json'));
    const saved = JSON.parse(readFileSync(path!, 'utf-8')) as FDESessionState;
    expect(saved.sessionId).toBe('sess-20260905-1');
    expect(saved.completed).toEqual(['首轮五要素访谈（3 节点）']);
    expect(saved.nextSteps).toHaveLength(2);
    expect(saved.nodeCount).toBe(3);
  });

  it('test_capture_history追加与meta更新', () => {
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    captureFDEClientSession(dataDir, makeState());
    const history = readFileSync(join(fdeClientSessionDir(dataDir, 'acme'), 'history.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    expect(history).toHaveLength(2);
    const stopLine = JSON.parse(history[1]!);
    expect(stopLine.event).toBe('session-stop');
    expect(stopLine.sessionId).toBe('sess-20260905-1');
    const meta = JSON.parse(readFileSync(join(fdeClientSessionDir(dataDir, 'acme'), 'meta.json'), 'utf-8'));
    expect(meta.lastCapturedAt).toBe(new Date(FIXED_NOW()).toISOString());
  });

  it('test_capture_未初始化返回null', () => {
    const path = captureFDEClientSession(dataDir, makeState({ clientId: 'ghost' }));
    expect(path).toBeNull();
  });
});

// ──────────────────────────────────────
// 跨 session 恢复
// ──────────────────────────────────────

describe('fde-session-mgr · 跨 session 恢复', () => {
  it('test_restore_显式clientId恢复上下文与状态', () => {
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    captureFDEClientSession(dataDir, makeState());
    const r = restoreFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    expect(r.restored).toBe(true);
    expect(r.clientId).toBe('acme');
    expect(r.context?.industry).toBe('unknown');
    expect(r.context?.stage).toBe('interview');
    expect(r.sessionState?.inProgress).toEqual(['报表节点深挖（还差 bottleneck 细节）']);
    expect(r.missingFiles).toEqual([]);
    expect(r.message).toContain('已恢复客户「acme」');
  });

  it('test_restore_缺省取最近捕获客户', () => {
    initFDEClientSession(dataDir, 'alpha', { now: FIXED_NOW });
    initFDEClientSession(dataDir, 'beta', { now: FIXED_NOW });
    // alpha 先捕获、beta 后捕获——缺省应恢复 beta
    captureFDEClientSession(
      dataDir,
      makeState({ clientId: 'alpha', capturedAt: '2026-09-04T10:00:00Z', sessionId: 's-a' }),
    );
    captureFDEClientSession(
      dataDir,
      makeState({ clientId: 'beta', capturedAt: '2026-09-05T09:00:00Z', sessionId: 's-b' }),
    );
    const r = restoreFDEClientSession(dataDir);
    expect(r.restored).toBe(true);
    expect(r.clientId).toBe('beta');
    expect(r.sessionState?.sessionId).toBe('s-b');
  });

  it('test_restore_无捕获记录时降级', () => {
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    const r = restoreFDEClientSession(dataDir);
    // 有初始化目录但从未 capture——缺省路径无 lastCapturedAt 可比 → 无记忆
    expect(r.restored).toBe(false);
    expect(r.message).toContain('无已捕获的客户目录');
  });

  it('test_restore_未初始化目录降级', () => {
    const r = restoreFDEClientSession(dataDir, 'ghost');
    expect(r.restored).toBe(false);
    expect(r.message).toContain('未初始化');
  });

  it('test_restore_损坏文件降级为无记忆', () => {
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    // 上下文与状态都写坏
    writeFileSync(join(fdeClientSessionDir(dataDir, 'acme'), 'context.md'), '乱码无frontmatter', 'utf-8');
    writeFileSync(join(fdeClientSessionDir(dataDir, 'acme'), 'session-state.json'), '{broken', 'utf-8');
    const r = restoreFDEClientSession(dataDir, 'acme');
    expect(r.restored).toBe(false);
    expect(r.message).toContain('损坏');
  });

  it('test_restore_恢复事件留痕', () => {
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    captureFDEClientSession(dataDir, makeState());
    restoreFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    const history = readFileSync(join(fdeClientSessionDir(dataDir, 'acme'), 'history.jsonl'), 'utf-8')
      .trim()
      .split('\n');
    const last = JSON.parse(history[history.length - 1]!);
    expect(last.event).toBe('session-restore');
    const meta = JSON.parse(readFileSync(join(fdeClientSessionDir(dataDir, 'acme'), 'meta.json'), 'utf-8'));
    expect(meta.lastRestoredAt).toBe(new Date(FIXED_NOW()).toISOString());
  });
});

// ──────────────────────────────────────
// 辅助面
// ──────────────────────────────────────

describe('fde-session-mgr · 辅助面', () => {
  it('test_listFDEClients_列目录', () => {
    expect(listFDEClients(dataDir)).toEqual([]);
    initFDEClientSession(dataDir, 'beta', { now: FIXED_NOW });
    initFDEClientSession(dataDir, 'alpha', { now: FIXED_NOW });
    expect(listFDEClients(dataDir)).toEqual(['alpha', 'beta']);
  });

  it('test_isFDEClientInitialized', () => {
    expect(isFDEClientInitialized(dataDir, 'acme')).toBe(false);
    initFDEClientSession(dataDir, 'acme', { now: FIXED_NOW });
    expect(isFDEClientInitialized(dataDir, 'acme')).toBe(true);
  });

  it('test_parseFDEClientContext_平台与联系人解析', () => {
    const md = [
      '---',
      'clientId: acme',
      'industry: fintech',
      'stage: classify',
      'updatedAt: 2026-09-05T00:00:00Z',
      '---',
      '',
      '# FDE 进场记忆 · acme',
      '',
      '## 企业平台',
      '',
      '- 钉钉',
      '- 自研 ERP',
      '',
      '## 联系人',
      '',
      '- 张经理（IT 负责人）',
      '',
      '## 当前阶段',
      '',
      '- classify（三问判定中）',
    ].join('\n');
    const ctx = parseFDEClientContext(md);
    expect(ctx?.clientId).toBe('acme');
    expect(ctx?.industry).toBe('fintech');
    expect(ctx?.stage).toBe('classify');
    expect(ctx?.platforms).toEqual(['钉钉', '自研 ERP']);
    expect(ctx?.contacts).toEqual(['张经理（IT 负责人）']);
  });
});
