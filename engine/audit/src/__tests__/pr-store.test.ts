// pr-store.test.ts · G13 PR 状态机 + triggerBinding 三铁律测试
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-pr-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

const { prSubmit, prReview, prMerge, upsertTriggerBinding, listPrs, isHeuristicallyBlocked } = await import(
  '../pr-store'
);

const prDir = join(ISO_DIR, 'pr-store');
const decisionLog = join(ISO_DIR, 'audit', 'decision-log.jsonl');

describe('G13 PR 状态机：submit → review → merge 全链', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('submit → open + 贡献者默认计入', () => {
    const r = prSubmit(
      { pr_id: 'pr-1', workflow_id: 'wf-a', title: '加节点', submitter: 'alice' },
      ISO_DIR,
    );
    expect(r.data.isError).toBe(false);
    expect(r.data.status).toBe('open');
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-1.json'), 'utf-8'));
    expect(stored.contributors).toEqual([{ contributor_id: 'alice', weight: 1 }]);
  });

  it('重复 submit 拒绝 / 缺参拒绝', () => {
    prSubmit({ pr_id: 'pr-1', workflow_id: 'wf-a', title: 't', submitter: 'a' }, ISO_DIR);
    const dup = prSubmit({ pr_id: 'pr-1', workflow_id: 'wf-a', title: 't', submitter: 'a' }, ISO_DIR);
    expect(dup.data.isError).toBe(true);
    const missing = prSubmit({ pr_id: '', workflow_id: 'wf-a', title: 't', submitter: 'a' }, ISO_DIR);
    expect(missing.data.isError).toBe(true);
  });

  it('review approve → reviewed；merge → merged（criteria 全过自动）', () => {
    prSubmit(
      {
        pr_id: 'pr-2',
        workflow_id: 'wf-a',
        title: '变更',
        submitter: 'alice',
        merge_criteria: [{ kind: 'test_pass', detail: '跑测试' }],
      },
      ISO_DIR,
    );
    const rv = prReview({ pr_id: 'pr-2', reviewer: 'bob', verdict: 'approve' }, ISO_DIR);
    expect(rv.data.status).toBe('reviewed');

    const mg = prMerge({ pr_id: 'pr-2', actor: 'bob' }, ISO_DIR);
    expect(mg.data.isError).toBe(false);
    expect(mg.data.status).toBe('merged');
    expect(mg.data.criteriaResults).toEqual([{ kind: 'test_pass', passed: true }]);
  });

  it('未 review 直接 merge 拒绝（状态机迁移守卫）', () => {
    prSubmit({ pr_id: 'pr-3', workflow_id: 'wf-a', title: 't', submitter: 'a' }, ISO_DIR);
    const r = prMerge({ pr_id: 'pr-3', actor: 'a' }, ISO_DIR);
    expect(r.data.isError).toBe(true);
    expect(r.data.issues?.[0]).toContain('不可合并');
  });

  it('rejected 终态：review reject + 负样本留痕进 decision-log', () => {
    prSubmit({ pr_id: 'pr-4', workflow_id: 'wf-a', title: '烂提案', submitter: 'a' }, ISO_DIR);
    const r = prReview({ pr_id: 'pr-4', reviewer: 'bob', verdict: 'reject', note: '质量不达标' }, ISO_DIR);
    expect(r.data.status).toBe('rejected');

    // 负样本落盘 decision-log
    expect(existsSync(decisionLog)).toBe(true);
    const lines = readFileSync(decisionLog, 'utf-8').trim().split('\n');
    const rejectEntry = lines.map((l) => JSON.parse(l)).find((e) => e.why?.text?.includes('负样本'));
    expect(rejectEntry).toBeDefined();
    expect(rejectEntry.agentId).toBe('sofagent-pr-store-reject');

    // 终态不可再迁移
    const again = prReview({ pr_id: 'pr-4', reviewer: 'bob', verdict: 'approve' }, ISO_DIR);
    expect(again.data.isError).toBe(true);
  });
});

describe('G13 triggerBinding 三铁律', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('铁律一：confirmed 不被 suggested 覆盖', () => {
    prSubmit(
      {
        pr_id: 'pr-b1',
        workflow_id: 'wf-x',
        title: 't',
        submitter: 'a',
        trigger: { source: 'human', confidence: 'confirmed' },
      },
      ISO_DIR,
    );
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-b1.json'), 'utf-8'));
    // 启发式重试覆盖
    const ok = upsertTriggerBinding(stored, 'gap-analyzer', 'suggested');
    expect(ok).toBe(false);
    expect(stored.triggerBinding.confidence).toBe('confirmed'); // 未被覆盖
  });

  it('铁律二：后来显式可替换 suggested', () => {
    prSubmit(
      {
        pr_id: 'pr-b2',
        workflow_id: 'wf-x',
        title: 't',
        submitter: 'a',
        trigger: { source: 'gap-analyzer', confidence: 'suggested' },
      },
      ISO_DIR,
    );
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-b2.json'), 'utf-8'));
    const ok = upsertTriggerBinding(stored, 'human', 'confirmed');
    expect(ok).toBe(true);
    expect(stored.triggerBinding).toEqual({
      source: 'human',
      confidence: 'confirmed',
      boundAt: expect.any(String),
    });
  });

  it('铁律三：同资源 upsert 单条（对象只有一份 triggerBinding）', () => {
    prSubmit(
      {
        pr_id: 'pr-b3',
        workflow_id: 'wf-x',
        title: 't',
        submitter: 'a',
        trigger: { source: 's1', confidence: 'suggested' },
      },
      ISO_DIR,
    );
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-b3.json'), 'utf-8'));
    upsertTriggerBinding(stored, 's2', 'suggested');
    upsertTriggerBinding(stored, 's3', 'suggested');
    expect(stored.triggerBinding.source).toBe('s3'); // 单字段位——最后写入者胜
  });

  it('suggested 被否决后启发式重跑不复活（isHeuristicallyBlocked）', () => {
    // suggested PR 被拒绝
    prSubmit(
      {
        pr_id: 'pr-b4',
        workflow_id: 'wf-block',
        title: 't',
        submitter: 'a',
        trigger: { source: 'gap-analyzer', confidence: 'suggested' },
      },
      ISO_DIR,
    );
    prReview({ pr_id: 'pr-b4', reviewer: 'bob', verdict: 'reject' }, ISO_DIR);

    // 启发式重跑查询——该 workflow 已被否决，应跳过
    const prs = listPrs(ISO_DIR);
    expect(isHeuristicallyBlocked(prs, 'wf-block')).toBe(true);
    expect(isHeuristicallyBlocked(prs, 'wf-other')).toBe(false);
  });
});

describe('G13 merge HITL 门', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('criteria 未过 → HITL 挂起（不合并）；human_confirmed=true 强制合并', () => {
    prSubmit(
      {
        pr_id: 'pr-h1',
        workflow_id: 'wf-a',
        title: 't',
        submitter: 'a',
        merge_criteria: [{ kind: 'test_pass' }, { kind: '' }], // 第二条 kind 空 → 未过
      },
      ISO_DIR,
    );
    prReview({ pr_id: 'pr-h1', reviewer: 'bob', verdict: 'approve' }, ISO_DIR);

    const pending = prMerge({ pr_id: 'pr-h1', actor: 'bob' }, ISO_DIR);
    expect(pending.data.awaitingHuman).toBe(true);
    expect(pending.data.status).toBe('reviewed'); // 状态未动

    const forced = prMerge({ pr_id: 'pr-h1', actor: 'bob', human_confirmed: true }, ISO_DIR);
    expect(forced.data.status).toBe('merged');
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-h1.json'), 'utf-8'));
    expect(stored.awaitingHuman).toBe(true); // 强制合并的 HITL 痕迹保留
  });
});
