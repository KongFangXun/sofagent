// gap-analyzer.test.ts · G2 三类缺口判定边界测试
// 覆盖：空 workflow-store 降级 / 全活跃零缺口 / 缺人（零执行记录）/
// 缺能力（人工介入率超阈）/ 待升级（首次通过率低）/ 损坏 store 文件跳过
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-gap-test-${process.pid}`);

const { analyzeWorkflowGaps } = await import('../gap-analyzer');
const { workflowCreate } = await import('../crud/workflow-store');

const storeDir = join(ISO_DIR, 'workflow-store');
const auditDir = join(ISO_DIR, 'audit');

/** 造 decision-log 条目（worklog 数据源——escalate/retry 类别控制统计口径） */
function seedDecisions(entries: Array<{ agent: string; task: string; escalate?: boolean; retry?: boolean }>): void {
  const lines = entries.map((e, i) =>
    JSON.stringify({
      agentId: e.agent,
      sessionId: e.task,
      kind: e.escalate ? 'ESCALATE_REPORT' : 'ARTIFACT_EDIT',
      category: e.retry ? 'retry' : e.escalate ? 'escalate' : 'select',
      ts: new Date(Date.now() - 86400_000).toISOString(), // 窗口内（昨天）
      why: { text: `seed-${i}` },
      hmacSig: `sig-${i}`,
      prevHash: `prev-${i}`,
    }),
  );
  writeFileSync(join(auditDir, 'decision-log.jsonl'), lines.join('\n') + '\n', 'utf-8');
}

describe('G2 能力缺口分析：三类判定边界', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(storeDir, { recursive: true });
    mkdirSync(auditDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('空 workflow-store → 降级提示不 crash（scanned=0）', () => {
    const r = analyzeWorkflowGaps(ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.scanned).toBe(0);
    expect(r.data.gaps).toEqual([]);
    expect(r.text).toContain('workflow-store 为空');
  });

  it('全活跃 → 零缺口', async () => {
    await workflowCreate(
      {
        workflow: {
          name: 'healthy',
          nodes: [{ id: 'n1', agent: 'developer', task: 't' }],
        },
        owner: 'a',
      },
      ISO_DIR,
    );
    seedDecisions([{ agent: 'developer', task: 'wf1:n1' }]);
    const r = analyzeWorkflowGaps(ISO_DIR);
    expect(r.data.scanned).toBe(1);
    expect(r.data.summary.total).toBe(0);
  });

  it('missing_agent：声明节点但 agent 零执行记录', async () => {
    await workflowCreate(
      {
        workflow: {
          name: 'ghosts',
          nodes: [{ id: 'n1', agent: 'data-scientist', task: 't' }],
        },
        owner: 'a',
      },
      ISO_DIR,
    );
    // worklog 只有 developer 的记录——data-scientist 缺人
    seedDecisions([{ agent: 'developer', task: 'wf1:x' }]);
    const r = analyzeWorkflowGaps(ISO_DIR);
    expect(r.data.summary.missing_agent).toBe(1);
    const gap = r.data.gaps[0]!;
    expect(gap.kind).toBe('missing_agent');
    expect(gap.workflow_id).toBe('ghosts');
    expect(gap.node).toBe('n1');
    expect(gap.agent).toBe('data-scientist');
  });

  it('low_capability：人工介入率 ≥30% 判缺能力', async () => {
    await workflowCreate(
      {
        workflow: {
          name: 'struggling',
          nodes: [{ id: 'n1', agent: 'junior-dev', task: 't' }],
        },
        owner: 'a',
      },
      ISO_DIR,
    );
    // 3 任务 1 次人工介入 = 33% ≥ 30%
    seedDecisions([
      { agent: 'junior-dev', task: 'wf1:t1', escalate: true },
      { agent: 'junior-dev', task: 'wf1:t2' },
      { agent: 'junior-dev', task: 'wf1:t3' },
    ]);
    const r = analyzeWorkflowGaps(ISO_DIR);
    expect(r.data.summary.low_capability).toBe(1);
    expect(r.data.gaps[0]!.kind).toBe('low_capability');
  });

  it('needs_upgrade：首次通过率 <50% 判待升级', async () => {
    await workflowCreate(
      {
        workflow: {
          name: 'flaky',
          nodes: [{ id: 'n1', agent: 'old-model-agent', task: 't' }],
        },
        owner: 'a',
      },
      ISO_DIR,
    );
    // 2 任务 2 retry = 首次通过 0% < 50%（无 escalate——与 low_capability 互斥判定）
    seedDecisions([
      { agent: 'old-model-agent', task: 'wf1:t1', retry: true },
      { agent: 'old-model-agent', task: 'wf1:t2', retry: true },
    ]);
    const r = analyzeWorkflowGaps(ISO_DIR);
    expect(r.data.summary.needs_upgrade).toBe(1);
    expect(r.data.gaps[0]!.kind).toBe('needs_upgrade');
  });

  it('窗口外记录不计入（零窗口记录 → missing_agent）', async () => {
    await workflowCreate(
      {
        workflow: {
          name: 'stale',
          nodes: [{ id: 'n1', agent: 'developer', task: 't' }],
        },
        owner: 'a',
      },
      ISO_DIR,
    );
    // 记录在 60 天前（窗口 30 天外）——不计入 → 缺人
    writeFileSync(
      join(auditDir, 'decision-log.jsonl'),
      JSON.stringify({
        agentId: 'developer',
        sessionId: 'wf1:n1',
        kind: 'ARTIFACT_EDIT',
        category: 'select',
        ts: new Date(Date.now() - 60 * 86_400_000).toISOString(),
        why: { text: 'old' },
        hmacSig: 's',
        prevHash: 'p',
      }) + '\n',
      'utf-8',
    );
    const r = analyzeWorkflowGaps(ISO_DIR);
    expect(r.data.summary.missing_agent).toBe(1);
  });

  it('损坏 store 文件跳过不 crash', async () => {
    writeFileSync(join(storeDir, 'corrupt.json'), '{{{not json', 'utf-8');
    const r = analyzeWorkflowGaps(ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.scanned).toBe(0);
  });

  it('branch 文件不算在役节点面（只扫 trunk）', async () => {
    // trunk + branch 同名——只扫 trunk（branch 是未合并提案）
    writeFileSync(
      join(storeDir, 'real.json'),
      JSON.stringify({
        id: 'real',
        version: 1,
        owner: 'a',
        workflow: { name: 'real', nodes: [{ id: 'n1', agent: 'ghost-agent', task: 't' }] },
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }),
      'utf-8',
    );
    writeFileSync(join(storeDir, 'real.branch-bob.json'), '{{{corrupt but ignored', 'utf-8');
    const r = analyzeWorkflowGaps(ISO_DIR);
    expect(r.data.scanned).toBe(1);
    expect(r.data.summary.missing_agent).toBe(1);
  });
});
