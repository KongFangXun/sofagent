// ============================================================
// pr-submit-explanation.test.ts · auto-PR 决策解释块挂载（v1.5.1 章二）
// ============================================================
// 覆盖：AI 节点经 MCP pr_submit 产出 PR 时，PR 记录本身自带决策解释块
// （引 decision-log 因果链）；返回文本给出附件指引；解释块生成不可用时
// 如实标注而非静默。
//
// 注意：本文件经 workspace symlink 消费 @sofagent/orchestrator 的 dist——
// 跑之前需先 build orchestrator（CI 顺序 test 前 build）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDecisionLogPath } from '@sofagent/core';

const ISO_DIR = join(tmpdir(), `sofagent-mcp-pr-explain-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

const { prSubmit } = await import('../tools/pr-tools');

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();

function writeDecisions(entries: Array<Record<string, unknown>>): void {
  mkdirSync(join(ISO_DIR, 'audit'), { recursive: true });
  writeFileSync(
    getDecisionLogPath(ISO_DIR),
    `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'utf-8',
  );
}

function decision(ts: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts,
    agentId: 'bob',
    sessionId: 'sess-1',
    kind: 'ORCHESTRATION',
    moment: 'ACT',
    why: { text: '按拦截结论调整 target-flow 节点顺序' },
    ...overrides,
  };
}

/** 读 PR 存储记录（pr-store/{prId}.json） */
function readStoredPr(prId: string): { title: string } {
  return JSON.parse(readFileSync(join(ISO_DIR, 'pr-store', `${prId}.json`), 'utf-8')) as {
    title: string;
  };
}

describe('MCP pr_submit：PR 附决策解释块（理解债务应对）', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(ISO_DIR, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('PR 变更描述自带解释块（引因果链），返回文本给出附件指引', async () => {
    const rootTs = minutesAgo(30);
    writeDecisions([
      decision(rootTs, {
        kind: 'TOOL_GATE',
        causalType: 'caused',
        artifactRef: 'workflow-store/target-flow.json',
        why: { text: '拦截越界写入（target-flow）' },
      }),
      decision(minutesAgo(10), {
        causalType: 'caused',
        causedBy: [rootTs],
        artifactRef: 'workflow-store/target-flow.json',
      }),
    ]);

    const result = await prSubmit({
      pr_id: 'pr-explain',
      workflow_id: 'target-flow',
      title: '调整节点顺序',
      submitter: 'bob',
      data_dir: ISO_DIR,
    });

    expect(result.data.isError).toBe(false);

    const stored = readStoredPr('pr-explain');
    // 「改了什么」+「为什么这么做」同体——解释块落在 PR 记录里，不是只回显
    expect(stored.title).toContain('调整节点顺序');
    expect(stored.title).toContain('## 决策解释（为什么这么做）');
    expect(stored.title).toContain('因果链 1 条');
    expect(stored.title).toContain('拦截越界写入');

    expect(result.text).toContain('已附决策解释块');
  });

  it('窗口内无可引用因果链 → 解释块如实标注（不编造依据），PR 仍可提交', async () => {
    const result = await prSubmit({
      pr_id: 'pr-plain',
      workflow_id: 'target-flow',
      title: '纯元数据 PR',
      submitter: 'bob',
      data_dir: ISO_DIR,
    });

    expect(result.data.isError).toBe(false);
    const stored = readStoredPr('pr-plain');
    expect(stored.title).toContain('未找到带因果边的相关决策');
    expect(result.text).toContain('已附决策解释块');
  });

  it('提交失败（重名）不追加「已附」指引——错误文本不误导', async () => {
    await prSubmit({
      pr_id: 'pr-dup',
      workflow_id: 'target-flow',
      title: '首次',
      submitter: 'bob',
      data_dir: ISO_DIR,
    });
    const second = await prSubmit({
      pr_id: 'pr-dup',
      workflow_id: 'target-flow',
      title: '重复',
      submitter: 'bob',
      data_dir: ISO_DIR,
    });

    expect(second.data.isError).toBe(true);
    expect(second.text).not.toContain('已附决策解释块');
  });
});
