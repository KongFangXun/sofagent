// pr-merge-orchestration.test.ts · v1.4.7 修复批：MCP pr_merge 编排态测试
// 覆盖：branch→trunk 写回联动全链（trunk version 推进 + mergedVersion 回填 +
// branch 删除）/ branch 不存在不算失败（省略 mergedVersion）/ 写回失败回退 open /
// verdict fail-fast（大小写变体用法错误）
//
// 注意：@sofagent/audit 与 @sofagent/orchestrator 经 workspace symlink 消费
// dist 构建——跑本文件前需先 build 两包（CI 顺序 test 前 build）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-mcp-pr-orch-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

const storeDir = join(ISO_DIR, 'workflow-store');
const prDir = join(ISO_DIR, 'pr-store');

const { prSubmit, prReview, prMerge } = await import('../tools/pr-tools');

const baseDoc = {
  name: 'pr-target-flow',
  nodes: [
    { id: 'n1', agent: 'developer', task: '实现功能' },
    { id: 'n2', agent: 'qa-engineer', task: '回归', depends_on: ['n1'] },
  ],
};

/** 构造：workflow（owner=alice）+ bob 写 branch + bob 提 PR（criteria 空）+ carol 审 */
async function setupPrWithBranch(prId: string): Promise<void> {
  const { workflowCreate, workflowUpdate } = await import('@sofagent/orchestrator');
  await workflowCreate({ workflow: baseDoc, owner: 'alice' }, ISO_DIR);
  await workflowUpdate(
    {
      workflow_id: 'pr-target-flow',
      workflow: { ...baseDoc, description: 'bob 的改动' },
      actor: 'bob',
    },
    ISO_DIR,
  );
  await prSubmit(
    { pr_id: prId, workflow_id: 'pr-target-flow', title: '变更', submitter: 'bob', data_dir: ISO_DIR },
  );
  await prReview({ pr_id: prId, reviewer: 'carol', verdict: 'approve', data_dir: ISO_DIR });
}

describe('MCP pr_merge 编排态：branch→trunk 写回联动', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('branch 存在：merge → trunk version 推进 + mergedVersion 回填 + branch 删除', async () => {
    await setupPrWithBranch('pr-o1');

    const r = await prMerge({ pr_id: 'pr-o1', actor: 'carol', data_dir: ISO_DIR });
    expect(r.data.isError).toBe(false);
    expect(r.data.status).toBe('merged');
    expect(r.data.mergedVersion).toBe(2); // trunk v1 → v2

    // trunk 已替换为 branch 内容
    const trunk = JSON.parse(readFileSync(join(storeDir, 'pr-target-flow.json'), 'utf-8'));
    expect(trunk.version).toBe(2);
    expect(trunk.workflow.description).toBe('bob 的改动');
    expect(trunk.owner).toBe('alice');

    // branch 文件删除
    expect(existsSync(join(storeDir, 'pr-target-flow.branch-bob.json'))).toBe(false);

    // PR mergedVersion 回填
    const pr = JSON.parse(readFileSync(join(prDir, 'pr-o1.json'), 'utf-8'));
    expect(pr.status).toBe('merged');
    expect(pr.mergedVersion).toBe(2);
  });

  it('branch 不存在：不算失败，mergedVersion 省略（PR 不带 branch 改动场景）', async () => {
    const { workflowCreate } = await import('@sofagent/orchestrator');
    await workflowCreate({ workflow: baseDoc, owner: 'alice' }, ISO_DIR);
    await prSubmit({ pr_id: 'pr-o2', workflow_id: 'pr-target-flow', title: '纯元数据 PR', submitter: 'bob', data_dir: ISO_DIR });
    await prReview({ pr_id: 'pr-o2', reviewer: 'carol', verdict: 'approve', data_dir: ISO_DIR });

    const r = await prMerge({ pr_id: 'pr-o2', actor: 'carol', data_dir: ISO_DIR });
    expect(r.data.isError).toBe(false);
    expect(r.data.status).toBe('merged');
    expect(r.data.mergedVersion).toBeUndefined();
    // trunk 未动
    const trunk = JSON.parse(readFileSync(join(storeDir, 'pr-target-flow.json'), 'utf-8'));
    expect(trunk.version).toBe(1);
  });

  it('branch 损坏 JSON：写回失败 → isError + PR 回退 open', async () => {
    await setupPrWithBranch('pr-o3');
    // 覆写 branch 为损坏 JSON
    writeFileSync(join(storeDir, 'pr-target-flow.branch-bob.json'), '{corrupted!!!');

    const r = await prMerge({ pr_id: 'pr-o3', actor: 'carol', data_dir: ISO_DIR });
    expect(r.data.isError).toBe(true);
    expect(r.data.issues?.[0]).toContain('写回失败');

    // PR 回退 open + 原因留痕
    const pr = JSON.parse(readFileSync(join(prDir, 'pr-o3.json'), 'utf-8'));
    expect(pr.status).toBe('open');
    expect(pr.revertReason).toContain('损坏');

    // trunk 未被污染
    const trunk = JSON.parse(readFileSync(join(storeDir, 'pr-target-flow.json'), 'utf-8'));
    expect(trunk.version).toBe(1);
  });
});

describe('MCP pr_review verdict fail-fast', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('verdict 大小写变体（Approve/APPROVE/ok）→ 用法错误，不宽容归一', async () => {
    await prSubmit({ pr_id: 'pr-v1', workflow_id: 'wf-a', title: 't', submitter: 'alice', data_dir: ISO_DIR });
    for (const v of ['Approve', 'APPROVE', 'ok', 'yes', undefined, 1]) {
      const r = await prReview({ pr_id: 'pr-v1', reviewer: 'bob', verdict: v, data_dir: ISO_DIR } as Record<string, unknown>);
      expect(r.data.isError).toBe(true);
      expect(r.data.issues?.[0]).toContain("verdict 须为 'approve' | 'reject'");
    }
    // 状态未动
    const pr = JSON.parse(readFileSync(join(prDir, 'pr-v1.json'), 'utf-8'));
    expect(pr.status).toBe('open');
  });

  it('合法 verdict 正常通过（小写精确值）', async () => {
    await prSubmit({ pr_id: 'pr-v2', workflow_id: 'wf-a', title: 't', submitter: 'alice', data_dir: ISO_DIR });
    const r = await prReview({ pr_id: 'pr-v2', reviewer: 'bob', verdict: 'approve', data_dir: ISO_DIR });
    expect(r.data.isError).toBe(false);
    expect(r.data.status).toBe('reviewed');
  });
});
