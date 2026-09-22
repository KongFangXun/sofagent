// ============================================================
// pr-explainer.test.ts · auto-PR 决策解释块（v1.5.1 章二）
// ============================================================
// 覆盖：引因果链（causedBy/causalType）/ 窗口过滤 / 相关性命中（提交者与
// 文本引用）/ 无可引用链时如实标注 / PR 变更描述组装。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDecisionLogPath } from '@sofagent/core';
import { buildPrDecisionExplanation, composePrBodyWithExplanation } from '../runtime/pr-explainer';

const ISO_DIR = join(tmpdir(), `sofagent-pr-explainer-${process.pid}`);

/** 写 decision-log.jsonl（loadDecisionLog 的读面口径） */
function writeDecisions(entries: Array<Record<string, unknown>>): void {
  mkdirSync(join(ISO_DIR, 'audit'), { recursive: true });
  writeFileSync(
    getDecisionLogPath(ISO_DIR),
    `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'utf-8',
  );
}

/** 决策条目最小形态（agentId/sessionId/kind/moment/why 为 schema 必填面） */
function decision(
  ts: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ts,
    agentId: 'dev-a',
    sessionId: 'sess-1',
    kind: 'ORCHESTRATION',
    moment: 'ACT',
    why: { text: '改动 workflow 的派活顺序' },
    ...overrides,
  };
}

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();

describe('buildPrDecisionExplanation', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(ISO_DIR, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('带因果边的相关决策 → 解释块引因果链（根因→结果 + 链深）', () => {
    const rootTs = minutesAgo(30);
    const childTs = minutesAgo(10);
    writeDecisions([
      decision(rootTs, {
        kind: 'TOOL_GATE',
        causalType: 'caused',
        artifactRef: 'workflow-store/wf-42.json',
        why: { text: '拦截越界写入（wf-42）' },
      }),
      decision(childTs, {
        causalType: 'caused',
        causedBy: [rootTs],
        artifactRef: 'workflow-store/wf-42.json',
        why: { text: '据拦截结论调整 wf-42 节点顺序' },
      }),
    ]);

    const r = buildPrDecisionExplanation({ workflowId: 'wf-42', submitter: 'dev-a', dataDir: ISO_DIR });

    expect(r.block).toContain('## 决策解释（为什么这么做）');
    expect(r.block).toContain('因果链 1 条');
    expect(r.block).toContain(childTs); // 链起点 ts 可回查
    expect(r.block).toContain('链深 2');
    expect(r.block).toContain('拦截越界写入'); // 链上根因的 why 出现在叙事里
    expect(r.causalChains).toBe(1);
    expect(r.citedDecisions).toBe(2);
    expect(r.scanned).toBe(2);
  });

  it('窗口内无因果边 → 如实标注「无可引用因果链」（不编造依据）', () => {
    writeDecisions([decision(minutesAgo(5), { artifactRef: 'workflow-store/wf-42.json' })]);

    const r = buildPrDecisionExplanation({ workflowId: 'wf-42', submitter: 'dev-a', dataDir: ISO_DIR });

    expect(r.causalChains).toBe(0);
    expect(r.block).toContain('未找到带因果边的相关决策');
    expect(r.block).toContain('如实标注，不编造依据');
    expect(r.block).not.toContain('因果链 1 条');
  });

  it('窗口外决策不计入（窗口 = 近 7 天，可注入）', () => {
    const oldTs = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    writeDecisions([decision(oldTs, { causedBy: [minutesAgo(40000)] })]);

    const r = buildPrDecisionExplanation({ workflowId: 'wf-42', submitter: 'dev-a', dataDir: ISO_DIR });

    expect(r.citedDecisions).toBe(0);
    expect(r.causalChains).toBe(0);
    expect(r.scanned).toBe(1); // 日志读到了，但落在窗口外
  });

  it('相关性两路命中：提交者本人 / 文本提到 workflow 或 pr_id', () => {
    writeDecisions([
      decision(minutesAgo(20), { agentId: 'dev-b', why: { text: '与本 workflow 无关的日常巡检' } }), // 不相关
      decision(minutesAgo(15), { agentId: 'dev-b', why: { text: '调整 wf-42 的重试策略' } }), // 文本命中
      decision(minutesAgo(12), { agentId: 'dev-b', why: { text: '提交 pr-7 的变更说明' } }), // pr_id 命中
      decision(minutesAgo(9), { agentId: 'dev-a', why: { text: '提交者本人的决策' } }), // 提交者命中
    ]);

    const r = buildPrDecisionExplanation({
      workflowId: 'wf-42',
      submitter: 'dev-a',
      prId: 'pr-7',
      dataDir: ISO_DIR,
    });

    expect(r.citedDecisions).toBe(3);
  });

  it('决策日志为空（无文件）→ 不抛错，解释块照常产出', () => {
    const r = buildPrDecisionExplanation({ workflowId: 'wf-42', submitter: 'dev-a', dataDir: ISO_DIR });

    expect(r.scanned).toBe(0);
    expect(r.citedDecisions).toBe(0);
    expect(r.block).toContain('## 决策解释（为什么这么做）');
  });

  it('composePrBodyWithExplanation：变更描述 + 分隔线 + 解释块', () => {
    const r = buildPrDecisionExplanation({ workflowId: 'wf-42', submitter: 'dev-a', dataDir: ISO_DIR });
    const body = composePrBodyWithExplanation('调整派活顺序', r);

    expect(body.startsWith('调整派活顺序\n\n---\n\n## 决策解释（为什么这么做）')).toBe(true);
  });
});
