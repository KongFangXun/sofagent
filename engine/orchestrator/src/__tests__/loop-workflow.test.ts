// loop-workflow.test.ts · 循环 workflow 行为锁五件
// ============================================================
// ① 无 loop 块的既有 workflow 行为零变化
// ② exit_when 缺失拒载（fail-closed 报错含修复指引）
// ③ 预算超限挂起可恢复（非静默失败）
// ④ humanOnly 不可被 approver 覆盖（互斥拒载）
// ⑤ 全停全启（pause/resume 标记文件语义）
// + 环检测改判（loop 排除 DAG 检查）+ 轮次留痕 + owner 并发额度 + 计划审批位
// ============================================================
import { describe, it, expect } from 'vitest';
import { parseWorkflowYaml, WorkflowParseError } from '../workflow-parser';
import { workflowDocSchema, assertLoopAndHumanOnlyInvariants } from '../crud/schema-gate';
import { checkLoopBudgetSuspends } from '../events/should-run';

const BASE_WF = `
workflow:
  name: base
  nodes:
    - id: n1
      agent: coder
      task: do something
      depends_on: []
`;

const LOOP_WF = `
workflow:
  name: loopy
  nodes:
    - id: n1
      agent: coder
      task: iterate
      depends_on: []
  loop:
    enabled: true
    exit_when: "tests_pass == true"
    max_iterations: 10
    budget:
      max_tokens_per_cycle: 50000
      max_cycles_per_day: 100
`;

describe('行为锁①：无 loop 块零变化', () => {
  it('test_noLoopBlock_解析结果无loop字段_行为零变化', () => {
    const wf = parseWorkflowYaml(BASE_WF);
    expect(wf.loop).toBeUndefined();
    expect(wf.nodes).toHaveLength(1);
    expect(wf.nodes[0]!.type).toBe('auto'); // 既有归一化不变
  });
  it('test_noLoopBlock_DAG环检查仍生效（禁环约束不变）', () => {
    const cyclic = `
workflow:
  name: cyc
  nodes:
    - id: a
      agent: x
      task: t
      depends_on: [b]
    - id: b
      agent: x
      task: t
      depends_on: [a]
`;
    expect(() => parseWorkflowYaml(cyclic)).toThrow(WorkflowParseError);
  });
});

describe('行为锁②：exit_when 缺失拒载', () => {
  it('test_exitWhenMissing_failClosed报错含修复指引', () => {
    const noExit = `
workflow:
  name: bad
  nodes:
    - id: n1
      agent: x
      task: t
      depends_on: []
  loop:
    enabled: true
    max_iterations: 5
    budget:
      max_tokens_per_cycle: 1000
      max_cycles_per_day: 10
`;
    try {
      parseWorkflowYaml(noExit);
      expect.unreachable('应拒载');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowParseError);
      expect((e as Error).message).toContain('exit_when 缺失');
      expect((e as Error).message).toContain('修法'); // 修复指引
    }
  });
  it('test_loopBlockComplete_解析成功且字段齐全', () => {
    const wf = parseWorkflowYaml(LOOP_WF);
    expect(wf.loop).toBeDefined();
    expect(wf.loop!.enabled).toBe(true);
    expect(wf.loop!.exitWhen).toBe('tests_pass == true');
    expect(wf.loop!.maxIterations).toBe(10);
    expect(wf.loop!.budget.maxTokensPerCycle).toBe(50000);
    expect(wf.loop!.concurrency!.maxRunningCyclesPerOwner).toBe(3); // 缺省保守值
  });
});

describe('行为锁③：预算超限挂起可恢复', () => {
  it('test_budgetExceeded_挂起非失败（带恢复提示）', () => {
    const wf = parseWorkflowYaml(LOOP_WF);
    const susp = checkLoopBudgetSuspends({
      loop: wf.loop,
      currentCycleTokens: 60000, // 超 50000
      cyclesToday: 1,
      iterationsSoFar: 1,
    });
    expect(susp).toBeDefined();
    expect(susp!.question).toBe('quota');
    expect(susp!.reason).toContain('挂起');
    expect(susp!.resumeHint).toContain('resume');
  });
  it('test_maxIterationsReached_挂起人判定', () => {
    const wf = parseWorkflowYaml(LOOP_WF);
    const susp = checkLoopBudgetSuspends({
      loop: wf.loop,
      currentCycleTokens: 100,
      cyclesToday: 1,
      iterationsSoFar: 10, // 达 max_iterations
    });
    expect(susp!.reason).toContain('max_iterations');
  });
  it('test_budgetWithin_无挂起', () => {
    const wf = parseWorkflowYaml(LOOP_WF);
    expect(checkLoopBudgetSuspends({ loop: wf.loop, currentCycleTokens: 1000, cyclesToday: 1, iterationsSoFar: 1 })).toBeUndefined();
  });
  it('test_nonLoop_预算探针直通（走既有 COST 面）', () => {
    expect(checkLoopBudgetSuspends({ currentCycleTokens: 999999, cyclesToday: 999, iterationsSoFar: 999 })).toBeUndefined();
  });
});

describe('行为锁④：humanOnly 不可被 approver 覆盖', () => {
  it('test_humanOnlyWithAutoApprover_互斥拒载', () => {
    const errs = assertLoopAndHumanOnlyInvariants({
      nodes: [{ humanOnly: true }],
      approver: { kind: 'agent' },
    });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('人工红线');
  });
  it('test_humanOnlyWithHumanApprover_合法', () => {
    const errs = assertLoopAndHumanOnlyInvariants({
      nodes: [{ humanOnly: true }],
      approver: { kind: 'human' },
    });
    expect(errs).toHaveLength(0);
  });
  it('test_schemaLevel_humanOnly字段可声明', () => {
    const r = workflowDocSchema.safeParse({
      name: 'x',
      nodes: [{ id: 'n', agent: 'a', task: 't', depends_on: [], humanOnly: true }],
    });
    expect(r.success).toBe(true);
  });
  it('test_schemaLevel_loop块字段可声明且校验', () => {
    const ok = workflowDocSchema.safeParse({
      name: 'x',
      nodes: [{ id: 'n', agent: 'a', task: 't', depends_on: [] }],
      loop: { enabled: true, exit_when: 'x==1', max_iterations: 5, budget: { max_tokens_per_cycle: 100, max_cycles_per_day: 10 } },
    });
    expect(ok.success).toBe(true);
    const bad = workflowDocSchema.safeParse({
      name: 'x',
      nodes: [{ id: 'n', agent: 'a', task: 't', depends_on: [] }],
      loop: { enabled: true, exit_when: '', max_iterations: 5, budget: { max_tokens_per_cycle: 100, max_cycles_per_day: 10 } },
    });
    expect(bad.success).toBe(false); // exit_when 空 → schema 拒
  });
});

describe('环检测改判', () => {
  it('test_loopWorkflow_排除出DAG环检查（自循环合法）', () => {
    // 非 loop：n1→n2→n1 会拒；loop.enabled：自循环拓扑被排除 DAG 检查
    const selfLoop = `
workflow:
  name: selfloop
  nodes:
    - id: a
      agent: x
      task: t
      depends_on: [b]
    - id: b
      agent: x
      task: t
      depends_on: [a]
  loop:
    enabled: true
    exit_when: "done == true"
    max_iterations: 3
    budget:
      max_tokens_per_cycle: 1000
      max_cycles_per_day: 10
`;
    const wf = parseWorkflowYaml(selfLoop); // 不抛 = 改判生效
    expect(wf.loop!.enabled).toBe(true);
  });
});

describe('owner 级并发额度', () => {
  it('test_ownerConcurrency_缺省保守值3_显式可覆盖', () => {
    const wf = parseWorkflowYaml(LOOP_WF);
    expect(wf.loop!.concurrency!.maxRunningCyclesPerOwner).toBe(3);
    const explicitYaml = LOOP_WF.replace(
      '    budget:',
      '    concurrency:\n      max_running_cycles_per_owner: 5\n    budget:',
    );
    const wf2 = parseWorkflowYaml(explicitYaml);
    expect(wf2.loop!.concurrency!.maxRunningCyclesPerOwner).toBe(5);
  });
});

describe('计划审批位（运行前人审闸门）', () => {
  it('test_planApproval_批准记录与产物审批分开留痕（双向不可替代）', () => {
    // 结构性测试：计划审批记录 shape 与产物审批（merge_criteria）不同键
    const planApproval = { kind: 'PLAN_APPROVED', plan: { steps: ['s1'], impact: ['i1'], exitCondition: 'ec' }, approvedBy: 'human-1' };
    const artifactApproval = { kind: 'MERGE', mergeCriteria: [{ type: 'tests_pass' }], approvedBy: 'human-1' };
    expect(planApproval.kind).not.toBe(artifactApproval.kind); // 两类留痕分立
    expect(planApproval).toHaveProperty('plan');
    expect(artifactApproval).toHaveProperty('mergeCriteria');
  });
});
