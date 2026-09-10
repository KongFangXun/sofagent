// contribution.test.ts · G4 贡献度聚合测试——聚合正确性 + 同标准 + org 过滤
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-contribution-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

const { prSubmit, prReview, prMerge } = await import('../pr-store');
const { aggregateContributions } = await import('../contribution');

/** 造一条 merged PR（submit → review approve → merge） */
function makeMergedPr(
  prId: string,
  workflowId: string,
  submitter: string,
  extraContributors?: Array<{ contributor_id: string; weight: number }>,
): void {
  prSubmit(
    {
      pr_id: prId,
      workflow_id: workflowId,
      title: `test-${prId}`,
      submitter,
      contributors: extraContributors,
    },
    ISO_DIR,
  );
  prReview({ pr_id: prId, reviewer: 'reviewer-1', verdict: 'approve' }, ISO_DIR);
  prMerge({ pr_id: prId, actor: 'reviewer-1' }, ISO_DIR);
}

describe('G4 贡献度聚合：核心正确性', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(ISO_DIR, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('空数据 → 空报表（不 crash）', () => {
    const r = aggregateContributions(ISO_DIR);
    expect(r.byContributor).toEqual([]);
    expect(r.byWorkflow).toEqual([]);
    expect(r.totalPrs).toBe(0);
    expect(r.mergedPrs).toBe(0);
  });

  it('单 PR merged → 贡献者行（merged_prs/weight_score 正确）', () => {
    makeMergedPr('pr-1', 'wf-a', 'alice');
    const r = aggregateContributions(ISO_DIR);
    expect(r.mergedPrs).toBe(1);
    const alice = r.byContributor.find((c) => c.contributor_id === 'alice');
    expect(alice).toBeDefined();
    expect(alice!.merged_prs).toBe(1);
    expect(alice!.weight_score).toBe(1);
    expect(alice!.contribution_score).toBeCloseTo(2, 1); // 1×2 + 0 + 0
  });

  it('多贡献者权重分摊 + workflow 维度聚合', () => {
    makeMergedPr('pr-1', 'wf-a', 'alice', [{ contributor_id: 'agent-x', weight: 0.5 }]);
    makeMergedPr('pr-2', 'wf-a', 'alice', [{ contributor_id: 'agent-x', weight: 0.5 }]);
    const r = aggregateContributions(ISO_DIR);
    const alice = r.byContributor.find((c) => c.contributor_id === 'alice')!;
    const agentX = r.byContributor.find((c) => c.contributor_id === 'agent-x')!;
    expect(alice.merged_prs).toBe(2);
    expect(alice.weight_score).toBe(2);
    expect(agentX.merged_prs).toBe(2);
    expect(agentX.weight_score).toBe(1);

    const wfA = r.byWorkflow.find((w) => w.workflow_id === 'wf-a')!;
    expect(wfA.merged_prs).toBe(2);
    expect(wfA.contributors).toBe(2); // alice + agent-x（去重）
    expect(wfA.breakdown.length).toBe(2);
  });

  it('open/rejected PR 不计入贡献（只 merged 计入）', () => {
    prSubmit({ pr_id: 'pr-open', workflow_id: 'wf-a', title: 't', submitter: 'alice' }, ISO_DIR);
    prSubmit({ pr_id: 'pr-rej', workflow_id: 'wf-a', title: 't', submitter: 'bob' }, ISO_DIR);
    prReview({ pr_id: 'pr-rej', reviewer: 'r', verdict: 'reject' }, ISO_DIR);
    const r = aggregateContributions(ISO_DIR);
    expect(r.totalPrs).toBe(2);
    expect(r.mergedPrs).toBe(0);
    expect(r.byContributor.filter((c) => ['alice', 'bob'].includes(c.contributor_id) && c.merged_prs > 0)).toEqual([]);
  });

  it('decision-log 留痕计入 decisions + 负样本单独计', () => {
    makeMergedPr('pr-1', 'wf-a', 'alice');
    // decision-log 位于 {dataDir}/audit/decision-log.jsonl
    const auditDir = join(ISO_DIR, 'audit');
    mkdirSync(auditDir, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      join(auditDir, 'decision-log.jsonl'),
      [
        JSON.stringify({ ts: now, agentId: 'agent-x', sessionId: 's', kind: 'ARTIFACT_EDIT', moment: 'ACT', why: '正常编辑' }),
        JSON.stringify({ ts: now, agentId: 'agent-x', sessionId: 's', kind: 'ORCHESTRATION', moment: 'ACT', why: 'PR review reject: pr-9——负样本训练信号' }),
        JSON.stringify({ ts: now, agentId: 'alice', sessionId: 's', kind: 'ESCALATE_REPORT', moment: 'ACT', why: '升级' }),
      ].join('\n') + '\n',
      'utf-8',
    );
    const r = aggregateContributions(ISO_DIR);
    const agentX = r.byContributor.find((c) => c.contributor_id === 'agent-x')!;
    const alice = r.byContributor.find((c) => c.contributor_id === 'alice')!;
    expect(agentX.decisions).toBe(2);
    expect(agentX.negative_signals).toBe(1);
    expect(alice.decisions).toBe(1);
    expect(alice.negative_signals).toBe(1); // ESCALATE_REPORT = 负样本
  });

  it('audit history 变更规模计入 audit_files', () => {
    makeMergedPr('pr-1', 'wf-a', 'alice');
    const auditDir = join(ISO_DIR, 'audit');
    mkdirSync(auditDir, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      join(auditDir, 'history.jsonl'),
      [
        JSON.stringify({ timestamp: now, diffRange: 'HEAD~1..HEAD', exitCode: 0, ruleResults: [], diffFileCount: 5, agentId: 'alice' }),
        JSON.stringify({ timestamp: now, diffRange: 'HEAD~2..HEAD~1', exitCode: 0, ruleResults: [], diffFileCount: 3, agentId: 'agent-x' }),
      ].join('\n') + '\n',
      'utf-8',
    );
    const r = aggregateContributions(ISO_DIR);
    const alice = r.byContributor.find((c) => c.contributor_id === 'alice')!;
    expect(alice.audit_files).toBe(5);
    const agentX = r.byContributor.find((c) => c.contributor_id === 'agent-x')!;
    expect(agentX.audit_files).toBe(3);
  });

  it('窗口外 PR 不计入（windowDays=1 + 旧时间戳）', () => {
    // 直接写一个 40 天前的 PR 文件
    const prDir = join(ISO_DIR, 'pr-store');
    mkdirSync(prDir, { recursive: true });
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    writeFileSync(
      join(prDir, 'pr-old.json'),
      JSON.stringify({
        id: 'pr-old', workflow_id: 'wf-a', title: 't', submitter: 'alice',
        status: 'merged', contributors: [{ contributor_id: 'alice', weight: 1 }],
        mergeCriteria: [], createdAt: old, updatedAt: old,
      }),
      'utf-8',
    );
    const r = aggregateContributions(ISO_DIR, { windowDays: 30 });
    expect(r.totalPrs).toBe(0);
    expect(r.mergedPrs).toBe(0);
  });
});

describe('G4 同标准 + org 过滤', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(ISO_DIR, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('人/数字员工同标准：userId 与 agentId 同字段位同聚合', () => {
    makeMergedPr('pr-1', 'wf-a', 'alice(人)', [{ contributor_id: 'agent-x(数字员工)', weight: 0.5 }]);
    const r = aggregateContributions(ISO_DIR);
    expect(r.byContributor.length).toBe(2);
    // 两行结构完全一致（同字段位——不区分人/数字员工的附加标记）
    expect(r.byContributor[0]).toHaveProperty('contribution_score');
    expect(r.byContributor[1]).toHaveProperty('contribution_score');
    const ids = r.byContributor.map((c) => c.contributor_id);
    expect(ids).toContain('alice(人)');
    expect(ids).toContain('agent-x(数字员工)');
  });

  it('org 过滤：不同 dataDir 数据互不可见（物理分区即权限边界）', () => {
    // org-a：alice 有一条 merged PR
    makeMergedPr('pr-1', 'wf-a', 'alice');
    // org-b：独立分区，bob 有一条 merged PR
    const orgBDir = join(tmpdir(), `sofagent-contribution-orgb-${process.pid}`);
    rmSync(orgBDir, { recursive: true, force: true });
    mkdirSync(orgBDir, { recursive: true });
    try {
      prSubmit({ pr_id: 'pr-b1', workflow_id: 'wf-b', title: 't', submitter: 'bob' }, orgBDir);
      prReview({ pr_id: 'pr-b1', reviewer: 'r', verdict: 'approve' }, orgBDir);
      prMerge({ pr_id: 'pr-b1', actor: 'r' }, orgBDir);

      const reportA = aggregateContributions(ISO_DIR);
      const reportB = aggregateContributions(orgBDir);
      // 跨租户不可见：org-a 报表无 bob，org-b 报表无 alice
      expect(reportA.byContributor.map((c) => c.contributor_id)).not.toContain('bob');
      expect(reportB.byContributor.map((c) => c.contributor_id)).not.toContain('alice');
    } finally {
      rmSync(orgBDir, { recursive: true, force: true });
    }
  });
});
