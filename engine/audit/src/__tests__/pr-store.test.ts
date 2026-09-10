// pr-store.test.ts · G13 PR 状态机 + triggerBinding 三铁律测试
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-pr-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

const { prSubmit, prReview, prMerge, upsertTriggerBinding, listPrs, isHeuristicallyBlocked, prRecordMergedVersion, prRevertToOpen } = await import(
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
        merge_criteria: [{ kind: 'approver-review' }],
      },
      ISO_DIR,
    );
    const rv = prReview({ pr_id: 'pr-2', reviewer: 'bob', verdict: 'approve' }, ISO_DIR);
    expect(rv.data.status).toBe('reviewed');

    const mg = prMerge({ pr_id: 'pr-2', actor: 'bob' }, ISO_DIR);
    expect(mg.data.isError).toBe(false);
    expect(mg.data.status).toBe('merged');
    expect(mg.data.criteriaResults).toEqual([{ kind: 'approver-review', passed: true }]);
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
        merge_criteria: [{ kind: 'approver-review' }, { kind: 'unknown-gate' }], // 第二条未知 kind → 未过（fail-closed）
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

describe('v1.4.7 修复批：merge_criteria 真判定器（fail-closed）', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  /** 快捷：提交 + 审阅（非 submitter reviewer）到位，返回 PR id */
  function setupReviewed(
    prId: string,
    opts: {
      mergeCriteria?: Array<{ kind: string; detail?: string }>;
      trigger?: { source: string; confidence: 'suggested' | 'confirmed' };
      reviewer?: string;
    } = {},
  ): string {
    prSubmit(
      {
        pr_id: prId,
        workflow_id: 'wf-judge',
        title: '判定器测试',
        submitter: 'alice',
        ...(opts.mergeCriteria ? { merge_criteria: opts.mergeCriteria } : {}),
        ...(opts.trigger ? { trigger: opts.trigger } : {}),
      },
      ISO_DIR,
    );
    // reviewer 缺省 bob（≠ submitter alice）；显式传 'alice' 模拟自审遗留
    prReview({ pr_id: prId, reviewer: opts.reviewer ?? 'bob', verdict: 'approve' }, ISO_DIR);
    return prId;
  }

  it('未知 kind → HITL 挂起（awaitingHuman，不写状态）', () => {
    const id = setupReviewed('pr-j1', { mergeCriteria: [{ kind: 'mystery-gate' }] });
    const r = prMerge({ pr_id: id, actor: 'bob' }, ISO_DIR);
    expect(r.data.awaitingHuman).toBe(true);
    expect(r.data.status).toBe('reviewed'); // 状态未动
    expect(r.data.criteriaResults).toEqual([{ kind: 'mystery-gate', passed: false }]);
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-j1.json'), 'utf-8'));
    expect(stored.status).toBe('reviewed'); // 不写状态
  });

  it('approver-review：reviewer=submitter（自审遗留）→ 挂起；reviewer≠submitter → 合并', () => {
    // prReview 已拒绝 submitter 自审——此处直接改盘模拟存量自审遗留数据（判定器防御）
    const id = setupReviewed('pr-j2a', { mergeCriteria: [{ kind: 'approver-review' }] });
    const legacy = JSON.parse(readFileSync(join(prDir, 'pr-j2a.json'), 'utf-8'));
    legacy.reviewer = 'alice'; // 强行改为 submitter 同人
    writeFileSync(join(prDir, 'pr-j2a.json'), JSON.stringify(legacy, null, 2));

    const r = prMerge({ pr_id: id, actor: 'bob' }, ISO_DIR);
    expect(r.data.awaitingHuman).toBe(true);
    expect(r.data.criteriaResults).toEqual([{ kind: 'approver-review', passed: false }]);

    const id2 = setupReviewed('pr-j2b', { mergeCriteria: [{ kind: 'approver-review' }] });
    const r2 = prMerge({ pr_id: id2, actor: 'bob' }, ISO_DIR);
    expect(r2.data.status).toBe('merged');
    expect(r2.data.criteriaResults).toEqual([{ kind: 'approver-review', passed: true }]);
  });

  it('confidence-min：gte:0.7 + suggested(0.5) → 挂起；+ confirmed(1.0) → 合并', () => {
    const id = setupReviewed('pr-j3a', {
      mergeCriteria: [{ kind: 'confidence-min', detail: 'gte:0.7' }],
      trigger: { source: 'gap-analyzer', confidence: 'suggested' },
    });
    const r = prMerge({ pr_id: id, actor: 'bob' }, ISO_DIR);
    expect(r.data.awaitingHuman).toBe(true);
    expect(r.data.criteriaResults).toEqual([{ kind: 'confidence-min', passed: false }]);

    const id2 = setupReviewed('pr-j3b', {
      mergeCriteria: [{ kind: 'confidence-min', detail: 'gte:0.7' }],
      trigger: { source: 'human', confidence: 'confirmed' },
    });
    const r2 = prMerge({ pr_id: id2, actor: 'bob' }, ISO_DIR);
    expect(r2.data.status).toBe('merged');
  });

  it('confidence-min：detail 畸形 → 挂起；detail 缺失 → 挂起', () => {
    const id = setupReviewed('pr-j4a', {
      mergeCriteria: [{ kind: 'confidence-min', detail: '大约0.7' }],
      trigger: { source: 'human', confidence: 'confirmed' },
    });
    expect(prMerge({ pr_id: id, actor: 'bob' }, ISO_DIR).data.awaitingHuman).toBe(true);

    const id2 = setupReviewed('pr-j4b', {
      mergeCriteria: [{ kind: 'confidence-min' }],
      trigger: { source: 'human', confidence: 'confirmed' },
    });
    const r2 = prMerge({ pr_id: id2, actor: 'bob' }, ISO_DIR);
    expect(r2.data.awaitingHuman).toBe(true);
    expect(r2.data.criteriaResults).toEqual([{ kind: 'confidence-min', passed: false }]);
  });

  it('confidence-min：无 triggerBinding(0) 低于任意正阈值 → 挂起', () => {
    const id = setupReviewed('pr-j5', { mergeCriteria: [{ kind: 'confidence-min', detail: 'gte:0.3' }] });
    expect(prMerge({ pr_id: id, actor: 'bob' }, ISO_DIR).data.awaitingHuman).toBe(true);
  });

  it('空 mergeCriteria → 无门槛直接可合（维持现状）', () => {
    const id = setupReviewed('pr-j6');
    const r = prMerge({ pr_id: id, actor: 'bob' }, ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.status).toBe('merged');
    expect(r.data.criteriaResults).toEqual([]);
  });
});

describe('v1.4.7 修复批：pr_review 权限（自审拒绝）', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('reviewer === submitter → 利益冲突拒绝', () => {
    prSubmit({ pr_id: 'pr-r1', workflow_id: 'wf-a', title: 't', submitter: 'alice' }, ISO_DIR);
    const r = prReview({ pr_id: 'pr-r1', reviewer: 'alice', verdict: 'approve' }, ISO_DIR);
    expect(r.data.isError).toBe(true);
    expect(r.data.issues?.[0]).toContain('不可自审');
    // 状态未动
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-r1.json'), 'utf-8'));
    expect(stored.status).toBe('open');
  });
});

describe('v1.4.7 修复批：pr_submit contributors 校验', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('weight 超界（2.5 / -1）与 NaN → 拒绝', () => {
    for (const [w, label] of [[2.5, '2.5'], [-1, '-1'], [Number.NaN, 'NaN']] as Array<[number, string]>) {
      const r = prSubmit(
        {
          pr_id: `pr-c-${label}`,
          workflow_id: 'wf-a',
          title: 't',
          submitter: 'alice',
          contributors: [{ contributor_id: 'bob', weight: w }],
        },
        ISO_DIR,
      );
      expect(r.data.isError).toBe(true);
      expect(r.data.issues?.[0]).toContain('weight 须为 0-1 数值');
    }
  });

  it('声明 11 条 → 拒绝（超上限）；10 条合法通过', () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ contributor_id: `c${i}`, weight: 0.5 }));
    const over = prSubmit(
      { pr_id: 'pr-c-11', workflow_id: 'wf-a', title: 't', submitter: 'alice', contributors: mk(11) },
      ISO_DIR,
    );
    expect(over.data.isError).toBe(true);
    expect(over.data.issues?.some((i) => i.includes('超上限'))).toBe(true);

    const ok = prSubmit(
      { pr_id: 'pr-c-10', workflow_id: 'wf-a', title: 't', submitter: 'alice', contributors: mk(10) },
      ISO_DIR,
    );
    expect(ok.data.isError).toBe(false);
    // 10 条声明 + submitter 自动 1 条 = 11 条在册
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-c-10.json'), 'utf-8'));
    expect(stored.contributors.length).toBe(11);
  });
});

describe('v1.4.7 修复批：mergedVersion 回填与 merged→open 回退', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(prDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('prRecordMergedVersion：merged PR 回填版本；非 merged 拒绝', () => {
    prSubmit({ pr_id: 'pr-v1', workflow_id: 'wf-a', title: 't', submitter: 'alice' }, ISO_DIR);
    prReview({ pr_id: 'pr-v1', reviewer: 'bob', verdict: 'approve' }, ISO_DIR);
    prMerge({ pr_id: 'pr-v1', actor: 'bob' }, ISO_DIR);

    const r = prRecordMergedVersion('pr-v1', 3, ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.mergedVersion).toBe(3);
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-v1.json'), 'utf-8'));
    expect(stored.mergedVersion).toBe(3);

    // 非 merged 拒绝
    prSubmit({ pr_id: 'pr-v2', workflow_id: 'wf-a', title: 't', submitter: 'alice' }, ISO_DIR);
    const bad = prRecordMergedVersion('pr-v2', 3, ISO_DIR);
    expect(bad.data.isError).toBe(true);
  });

  it('prRevertToOpen：merged→open + 原因留痕；criteriaResults 清空、reviewer 保留', () => {
    prSubmit({ pr_id: 'pr-v3', workflow_id: 'wf-a', title: 't', submitter: 'alice' }, ISO_DIR);
    prReview({ pr_id: 'pr-v3', reviewer: 'bob', verdict: 'approve', note: 'ok' }, ISO_DIR);
    prMerge({ pr_id: 'pr-v3', actor: 'bob' }, ISO_DIR);

    const r = prRevertToOpen('pr-v3', 'branch JSON 损坏', ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.status).toBe('open');
    const stored = JSON.parse(readFileSync(join(prDir, 'pr-v3.json'), 'utf-8'));
    expect(stored.status).toBe('open');
    expect(stored.revertReason).toBe('branch JSON 损坏');
    expect(stored.criteriaResults).toBeUndefined();
    expect(stored.reviewer).toBe('bob'); // 审阅证据保留
    expect(stored.reviewNote).toBe('ok');
  });
});
