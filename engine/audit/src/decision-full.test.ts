// ============================================================
// decision-full.test.ts · decisions.jsonl 完整版测试（v1.3.6 交付⑮）
//
// 覆盖验收标准：
//   1. emitDecision 支持 category（route/select/skip/retry/escalate），非法值拒绝
//   2. 向后兼容：不传 category 的条目无此字段，老查询不受影响
//   3. decisions.jsonl 可按 kind / moment / agentId / category 查询
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { emitDecision, DecisionSchemaError, type EmitDecisionInput } from './decision-log';
import {
  queryByKind,
  queryByMoment,
  queryByAgent,
  queryByCategory,
  queryDecisions,
  loadDecisionLog,
} from './decision-query';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-decision-full-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInput(overrides: Partial<EmitDecisionInput> = {}): EmitDecisionInput {
  return {
    agentId: 'engineer',
    sessionId: 'sess-1',
    kind: 'ORCHESTRATION',
    moment: 'ACT',
    why: { text: '路由命中节点', tags: ['route'] },
    ...overrides,
  };
}

describe('decisions.jsonl 完整版（v1.3.6 交付⑮）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(KEY_PATH, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = KEY_PATH;
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  // ── category 写入与校验 ──

  it('五种 category 均可写入并回读', () => {
    const categories = ['route', 'select', 'skip', 'retry', 'escalate'] as const;
    for (const category of categories) {
      emitDecision(makeInput({ sessionId: `s-${category}`, category }), testDir);
    }
    const entries = loadDecisionLog(testDir);
    expect(entries.length).toBe(5);
    for (const category of categories) {
      const found = entries.find((e) => e.sessionId === `s-${category}`);
      expect(found?.category).toBe(category);
    }
  });

  it('非法 category → DecisionSchemaError（不写文件）', () => {
    expect(() =>
      // 故意传非法值——类型断言绕过编译期检查，测运行时校验
      emitDecision(makeInput({ category: 'INVALID' as unknown as 'route' }), testDir),
    ).toThrow(DecisionSchemaError);
    expect(loadDecisionLog(testDir).length).toBe(0);
  });

  it('不传 category → 条目无此字段（向后兼容老语义）', () => {
    const entry = emitDecision(makeInput(), testDir);
    expect(entry.category).toBeUndefined();
    const onDisk = loadDecisionLog(testDir);
    expect(onDisk[0]?.category).toBeUndefined();
    expect('category' in onDisk[0]!).toBe(false);
  });

  // ── 三维度查询 ──

  it('queryByMoment 按时刻过滤', () => {
    emitDecision(makeInput({ sessionId: 's1', moment: 'ACT' }), testDir);
    emitDecision(makeInput({ sessionId: 's2', moment: 'EVOLVE' }), testDir);
    emitDecision(makeInput({ sessionId: 's3', moment: 'ACT' }), testDir);

    const acts = queryByMoment('ACT', {}, testDir);
    expect(acts.length).toBe(2);
    expect(acts.every((e) => e.moment === 'ACT')).toBe(true);

    const evolves = queryByMoment('EVOLVE', {}, testDir);
    expect(evolves.length).toBe(1);
    expect(evolves[0]!.sessionId).toBe('s2');
  });

  it('queryByAgent 按 agentId 过滤', () => {
    emitDecision(makeInput({ sessionId: 's1', agentId: 'mcp-router' }), testDir);
    emitDecision(makeInput({ sessionId: 's2', agentId: 'engineer' }), testDir);
    emitDecision(makeInput({ sessionId: 's3', agentId: 'mcp-router' }), testDir);

    const router = queryByAgent('mcp-router', {}, testDir);
    expect(router.length).toBe(2);
    expect(router.every((e) => e.agentId === 'mcp-router')).toBe(true);

    // 不存在的 agentId → 空数组（不抛错）
    expect(queryByAgent('nobody', {}, testDir).length).toBe(0);
  });

  it('queryByCategory 只返回带 category 标注的条目', () => {
    emitDecision(makeInput({ sessionId: 's1', category: 'route' }), testDir);
    emitDecision(makeInput({ sessionId: 's2', category: 'skip' }), testDir);
    emitDecision(makeInput({ sessionId: 's3' }), testDir); // 无 category（老语义）

    const routes = queryByCategory('route', {}, testDir);
    expect(routes.length).toBe(1);
    expect(routes[0]!.sessionId).toBe('s1');

    // 老日志（无 category）不会被任何 category 查询命中
    const all = ['route', 'select', 'skip', 'retry', 'escalate'] as const;
    const total = all.reduce((sum, c) => sum + queryByCategory(c, {}, testDir).length, 0);
    expect(total).toBe(2); // s1 + s2，s3 不算
  });

  // ── 组合查询 ──

  it('queryDecisions 多维度交叉过滤', () => {
    emitDecision(makeInput({ sessionId: 's1', agentId: 'mcp-router', category: 'route' }), testDir);
    emitDecision(makeInput({ sessionId: 's2', agentId: 'mcp-router', category: 'select' }), testDir);
    emitDecision(makeInput({ sessionId: 's3', agentId: 'engineer', category: 'route' }), testDir);

    // 「mcp-router 的路由决策」= agentId + category 交叉
    const routerRoutes = queryDecisions({ agentId: 'mcp-router', category: 'route' }, {}, testDir);
    expect(routerRoutes.length).toBe(1);
    expect(routerRoutes[0]!.sessionId).toBe('s1');

    // 空 filter = 全量
    expect(queryDecisions({}, {}, testDir).length).toBe(3);

    // 三维度交叉无结果 → 空数组（不抛错）
    expect(queryDecisions({ agentId: 'engineer', category: 'skip' }, {}, testDir).length).toBe(0);
  });

  it('queryDecisions 与既有 queryByKind 共存（kind 维度不回归）', () => {
    emitDecision(makeInput({ sessionId: 's1', kind: 'ORCHESTRATION', category: 'route' }), testDir);
    emitDecision(makeInput({ sessionId: 's2', kind: 'CONFIG_CHANGE', category: 'route' }), testDir);

    // 老接口 queryByKind 行为不变
    expect(queryByKind('ORCHESTRATION', {}, testDir).length).toBe(1);

    // 组合查询 kind + category
    const both = queryDecisions({ kind: 'CONFIG_CHANGE', category: 'route' }, {}, testDir);
    expect(both.length).toBe(1);
    expect(both[0]!.sessionId).toBe('s2');
  });

  it('queryByMoment/queryByAgent 支持 limit', () => {
    for (let i = 0; i < 5; i++) {
      emitDecision(makeInput({ sessionId: `s${i}`, agentId: 'bulk' }), testDir);
    }
    expect(queryByAgent('bulk', { limit: 3 }, testDir).length).toBe(3);
    expect(queryByMoment('ACT', { limit: 2 }, testDir).length).toBe(2);
  });

  // ── 防篡改链兼容 ──

  it('带 category 的条目进入防篡改链（prevHash 连续）', () => {
    const e1 = emitDecision(makeInput({ sessionId: 's1' }), testDir);
    const e2 = emitDecision(makeInput({ sessionId: 's2', category: 'route' }), testDir);
    // 第二条的 prevHash 非 genesis（链上了）
    expect(e2.prevHash).not.toBe('genesis');
    expect(e1.prevHash).toBe('genesis');
    // 带 category 条目同样有签名
    expect(e2.hmacSig).toBeDefined();
  });
});
