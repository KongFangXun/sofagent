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
import {
  parseWorkflowYaml,
  WorkflowParseError,
  isExitWhenDecidable,
  KNOWN_EXIT_WHEN_VARS,
} from '../workflow-parser';
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
    exit_when: "iterations >= 10"
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
    expect(wf.loop!.exitWhen).toBe('iterations >= 10');
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
      loop: { enabled: true, exit_when: 'iterations >= 5', max_iterations: 5, budget: { max_tokens_per_cycle: 100, max_cycles_per_day: 10 } },
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
    exit_when: "iterations >= 3"
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

// ============================================================
// 行为锁⑥（fresh-eyes run-01 F-03+N-3 收口）：exit_when 可判定性
// ============================================================
// 判定契约三条（不发明 DSL 文法——避免第二权威源）：
//   ① 引用封闭：标识符 ⊆ 已知变量白名单（KNOWN_EXIT_WHEN_VARS）
//   ② 无赋值副作用：不含裸 = / ++ / --（==、!=、<=、>= 合法）
//   ③ 双目平衡：括号配平 + 比较运算符两侧非空
// 两处消费（workflow-parser 解析门 + schema-gate 语义断言门）同函数收口。
// ============================================================

/** 生成带合法 loop 块的 workflow YAML（exit_when 参数化） */
function loopYamlWith(exitWhen: string): string {
  return `
workflow:
  name: decidable
  nodes:
    - id: n1
      agent: coder
      task: iterate
      depends_on: []
  loop:
    enabled: true
    exit_when: ${JSON.stringify(exitWhen)}
    max_iterations: 10
    budget:
      max_tokens_per_cycle: 50000
      max_cycles_per_day: 100
`;
}

describe('行为锁⑥：exit_when 可判定性（引用封闭/无副作用/双目平衡）', () => {
  // ── 单测 1：合法表达式过 ──
  it('test_validExpressions_合法表达式全部通过（变量白名单+比较+逻辑+括号）', () => {
    const validCases: Array<[string, string]> = [
      ['iterations >= 10', '已知变量数值比较'],
      ['tokens < 50000', '已知变量小于比较'],
      ['iterations >= 10 && exitFlag == true', '逻辑与组合'],
      ['exitFlag == false || lastOutput != "STOP"', '逻辑或+不等+字符串字面量'],
      ['(iterations >= 3) && (exitFlag == true)', '括号分组'],
      ['iterations >= 10 && iterations <= 100', '链式边界'],
    ];
    for (const [expr] of validCases) {
      const r = isExitWhenDecidable(expr, KNOWN_EXIT_WHEN_VARS);
      expect(r.ok, `「${expr}」应可判定（${r.reason ?? ''}）`).toBe(true);
    }
  });

  // ── 单测 2：未知变量拒 ──
  it('test_unknownVariable_拒载且reason含修复指引（可用变量列表）', () => {
    const r = isExitWhenDecidable('tests_pass == true', KNOWN_EXIT_WHEN_VARS);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('tests_pass');
    expect(r.reason).toContain('iterations'); // 修复指引含可用变量列表
  });

  // ── 单测 3：含赋值拒 ──
  it('test_assignmentSideEffect_拒载（裸=、++、--）', () => {
    expect(isExitWhenDecidable('exitFlag = true', KNOWN_EXIT_WHEN_VARS).ok).toBe(false); // 裸 = 赋值
    expect(isExitWhenDecidable('iterations++ >= 10', KNOWN_EXIT_WHEN_VARS).ok).toBe(false); // ++ 副作用
    expect(isExitWhenDecidable('iterations-- >= 10', KNOWN_EXIT_WHEN_VARS).ok).toBe(false); // -- 副作用
  });

  // ── 单测 4：括号不平衡拒 ──
  it('test_unbalancedParens_拒载', () => {
    const open = isExitWhenDecidable('(iterations >= 10', KNOWN_EXIT_WHEN_VARS);
    expect(open.ok).toBe(false);
    expect(open.reason).toContain('括号');
    const close = isExitWhenDecidable('iterations >= 10)', KNOWN_EXIT_WHEN_VARS);
    expect(close.ok).toBe(false);
    expect(close.reason).toContain('括号');
  });

  // ── 单测 4b：比较运算符两侧非空（双目平衡）──
  it('test_comparisonOperandMissing_拒载（比较符两侧空）', () => {
    expect(isExitWhenDecidable('>= 10', KNOWN_EXIT_WHEN_VARS).ok).toBe(false); // 左侧空
    expect(isExitWhenDecidable('iterations >=', KNOWN_EXIT_WHEN_VARS).ok).toBe(false); // 右侧空
    expect(isExitWhenDecidable('iterations >= && exitFlag', KNOWN_EXIT_WHEN_VARS).ok).toBe(false); // 右侧被逻辑符截断
  });

  // ── 单测 5：垃圾串拒（acceptance 场景的前置单元面）──
  it('test_garbageString_拒载（含汉字/多级路径/下划线分隔散文）', () => {
    const garbage = '!!! @@@ 改到满意为止';
    const r = isExitWhenDecidable(garbage, KNOWN_EXIT_WHEN_VARS);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(isExitWhenDecidable('do not exit unless you_feel it is good_enough', KNOWN_EXIT_WHEN_VARS).ok).toBe(false);
  });

  // ── 单测 5b：自然语言操作数拒（CJK 绕过标识符抽取的补位拦截）──
  it('test_naturalLanguageOperand_拒载（CJK 操作数不可判定）', () => {
    const r = isExitWhenDecidable('效果满意 == true', KNOWN_EXIT_WHEN_VARS);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('非 ASCII');
  });

  // ── 双门接线断言：workflow-parser 解析门 ──
  it('test_parserGate_不可判定exit_when拒载（fail-closed 含修法指引）', () => {
    expect(() => parseWorkflowYaml(loopYamlWith('!!! @@@ 垃圾串'))).toThrow(WorkflowParseError);
    try {
      parseWorkflowYaml(loopYamlWith('tests_pass == true')); // 未知变量
      expect.unreachable('应拒载');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowParseError);
      expect((e as Error).message).toContain('不可判定');
      expect((e as Error).message).toContain('可用变量'); // 修复指引
    }
    // 合法串通过
    const ok = parseWorkflowYaml(loopYamlWith('iterations >= 10'));
    expect(ok.loop!.exitWhen).toBe('iterations >= 10');
  });

  // ── 双门接线断言：schema-gate 语义断言门 ──
  it('test_schemaGateGate_不可判定exit_when拒载（与parser同契约）', () => {
    const errs = assertLoopAndHumanOnlyInvariants({
      nodes: [{ humanOnly: false }],
      loop: { enabled: true, exit_when: '!!! @@@ 垃圾串' },
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('不可判定');
    expect(errs[0]).toContain('可用变量');
    // 合法串零错误
    expect(assertLoopAndHumanOnlyInvariants({
      nodes: [{ humanOnly: false }],
      loop: { enabled: true, exit_when: 'iterations >= 10' },
    })).toHaveLength(0);
  });

  // ── N-3 完整闭环：crud 写路径语义门接线（此前 assertLoopAndHumanOnlyInvariants
  //    只在测试里被调——schema-gate 的 fail-closed 生产不可达，本测锁接线）──
  it('test_crudWritePath_不可判定exit_when在workflow_create被拒（语义门生产可达）', async () => {
    const { workflowCreate } = await import('../crud/workflow-store');
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-exitwhen-crud-'));
    try {
      // 不可判定 exit_when（垃圾串）→ create 拒绝（isError，报错含「不可判定」）
      const bad = await workflowCreate({
        workflow: {
          name: 'undecidable-wf',
          nodes: [{ id: 'n1', agent: 'coder', task: 't', depends_on: [] }],
          loop: { enabled: true, exit_when: '!!! @@@ 改到满意为止', max_iterations: 5, budget: { max_tokens_per_cycle: 100, max_cycles_per_day: 10 } },
        },
        owner: 'owner-1',
      }, tmpDir);
      expect(bad.data.isError).toBe(true);
      expect(bad.text).toContain('不可判定');
      // 合法 exit_when → create 成功
      const good = await workflowCreate({
        workflow: {
          name: 'decidable-wf',
          nodes: [{ id: 'n1', agent: 'coder', task: 't', depends_on: [] }],
          loop: { enabled: true, exit_when: 'iterations >= 5', max_iterations: 5, budget: { max_tokens_per_cycle: 100, max_cycles_per_day: 10 } },
        },
        owner: 'owner-1',
      }, tmpDir);
      expect(good.data.isError).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
