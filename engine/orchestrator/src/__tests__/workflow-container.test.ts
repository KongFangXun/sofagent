// ============================================================
// workflow-container.test.ts · Workflow 运行容器单测（v1.3.6 交付 ①）
//
// 覆盖：
//   - 外部提交 → schema 校验 → parser 解析（合法 workflow 拿到句柄）
//   - merge_criteria / approver 审阅协议字段校验（缺失/非法 → 结构化错误）
//   - 非法 workflow 返回结构化错误不 crash（WorkflowSubmitError.issues）
//   - runner 注入（v1.3.7 沙箱宿主位——测试注入 mock runner 验证宿主位）
//   - agent 字段任意类型（registry 查找 + agent-creation 兜底不阻断校验）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  submitWorkflow,
  WorkflowSubmitError,
  validateMergeCriteria,
  validateApprover,
  WORKFLOW_SCHEMA,
} from '../workflow/container';
import { DSH_SEAM_FIELD_MAPPINGS } from '../workflow/dsh-seam';

// 合法 workflow YAML（含审阅协议字段）
const VALID_WORKFLOW = `
workflow:
  name: demo-release-flow
  description: 示例发布流程
  nodes:
    - id: build
      agent: developer
      task: 构建项目并修复编译错误
    - id: review
      agent: qa-engineer
      task: 审查代码质量
      depends_on: [build]
  merge_criteria:
    - kind: test_pass
      command: npm test
      detail: 全部测试通过
    - kind: grep_absent
      pattern: TODO-PRODUCT
      detail: 不得残留产品级待办
  approver:
    id: tech-lead
    kind: human
    required: true
`;

const MINIMAL_WORKFLOW = `
workflow:
  nodes:
    - id: only
      agent: developer
      task: 做一件事
`;

describe('workflow container · 外部提交 → 校验 → 句柄', () => {
  it('合法 workflow 提交成功（含审阅协议字段解析）', () => {
    const handle = submitWorkflow({ workflow: VALID_WORKFLOW });
    expect(handle.parsed.name).toBe('demo-release-flow');
    expect(handle.parsed.nodes).toHaveLength(2);
    // 审阅协议字段透传
    expect(handle.parsed.mergeCriteria).toHaveLength(2);
    expect(handle.parsed.mergeCriteria?.[0]?.kind).toBe('test_pass');
    expect(handle.parsed.approver?.id).toBe('tech-lead');
    expect(handle.criteriaIssues).toHaveLength(0);
  });

  it('最小 workflow（无审阅协议字段）合法——向后兼容', () => {
    const handle = submitWorkflow({ workflow: MINIMAL_WORKFLOW });
    expect(handle.parsed.nodes).toHaveLength(1);
    expect(handle.parsed.mergeCriteria).toBeUndefined();
    expect(handle.parsed.approver).toBeUndefined();
  });

  it('schema 公开定义可机读（WORKFLOW_SCHEMA 含 merge_criteria/approver）', () => {
    const wfProps = (WORKFLOW_SCHEMA.properties as Record<string, unknown>)?.['workflow'] as {
      properties: Record<string, unknown>;
    };
    expect(wfProps.properties).toHaveProperty('merge_criteria');
    expect(wfProps.properties).toHaveProperty('approver');
    expect(wfProps.properties).toHaveProperty('nodes');
  });
});

describe('workflow container · 非法提交结构化错误（不 crash）', () => {
  it('空内容 → WorkflowSubmitError', () => {
    expect(() => submitWorkflow({ workflow: '' })).toThrow(WorkflowSubmitError);
    expect(() => submitWorkflow({ workflow: '   ' })).toThrow(WorkflowSubmitError);
  });

  it('非法 YAML → 结构化错误（issues 非空）', () => {
    try {
      submitWorkflow({ workflow: 'workflow: [unclosed' });
      expect.unreachable('应抛出 WorkflowSubmitError');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowSubmitError);
      expect((err as WorkflowSubmitError).issues.length).toBeGreaterThan(0);
    }
  });

  it('缺 workflow 根节点 → 结构化错误', () => {
    try {
      submitWorkflow({ workflow: 'nodes:\n  - id: a\n    agent: developer\n    task: x' });
      expect.unreachable('应抛出 WorkflowSubmitError');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowSubmitError);
    }
  });

  it('节点缺 task → 结构化错误不 crash', () => {
    try {
      submitWorkflow({ workflow: 'workflow:\n  nodes:\n    - id: a\n      agent: developer' });
      expect.unreachable('应抛出 WorkflowSubmitError');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowSubmitError);
      expect((err as WorkflowSubmitError).issues[0]).toContain('task');
    }
  });

  it('depends_on 存在环 → 结构化错误', () => {
    const cyclic = `
workflow:
  nodes:
    - id: a
      agent: developer
      task: x
      depends_on: [b]
    - id: b
      agent: developer
      task: y
      depends_on: [a]
`;
    expect(() => submitWorkflow({ workflow: cyclic })).toThrow(/环/);
  });
});

describe('workflow container · 审阅协议语义校验', () => {
  it('merge_criteria 非数组 → 违规', () => {
    const issues = validateMergeCriteria('not-an-array');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('必须是数组');
  });

  it('grep_absent 缺 pattern → 违规', () => {
    const issues = validateMergeCriteria([{ kind: 'grep_absent' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('pattern');
  });

  it('business_approval 缺 approver_role → 违规（对齐人审语义）', () => {
    const issues = validateMergeCriteria([{ kind: 'business_approval' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('approver_role');
  });

  it('data_compliance 缺 approver_role → 违规', () => {
    const issues = validateMergeCriteria([{ kind: 'data_compliance', detail: 'DPO 签字' }]);
    expect(issues).toHaveLength(1);
  });

  it('合法三类叠加 → 零违规（组织宪法）', () => {
    const issues = validateMergeCriteria([
      { kind: 'test_pass', command: 'npm test' },
      { kind: 'business_approval', approver_role: 'CFO' },
      { kind: 'data_compliance', approver_role: 'DPO' },
    ]);
    expect(issues).toHaveLength(0);
  });

  it('approver 缺 id → 违规', () => {
    const issues = validateApprover({ kind: 'human' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('approver.id');
  });

  it('approver 缺省 → 合法（默认强制人审）', () => {
    expect(validateApprover(undefined)).toHaveLength(0);
  });

  it('workflow 带非法 merge_criteria → 提交拒绝（issues 含语义错误）', () => {
    const badCriteria = `
workflow:
  nodes:
    - id: a
      agent: developer
      task: x
  merge_criteria:
    - kind: grep_absent
`;
    try {
      submitWorkflow({ workflow: badCriteria });
      expect.unreachable('应抛出 WorkflowSubmitError');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowSubmitError);
      const issues = (err as WorkflowSubmitError).issues;
      expect(issues.some((i) => i.includes('pattern'))).toBe(true);
    }
  });
});

describe('workflow container · 沙箱宿主位 + DSH seam', () => {
  it('runner 注入生效（v1.3.7 沙箱宿主位——容器接口不写死执行入口）', async () => {
    let runnerCalled = false;
    const handle = submitWorkflow({
      workflow: MINIMAL_WORKFLOW,
      runner: async (parsed, taskDesc) => {
        runnerCalled = true;
        return { sandboxExecuted: true, nodes: parsed.nodes.length, task: taskDesc };
      },
    });
    const result = await handle.run('沙箱任务');
    expect(runnerCalled).toBe(true);
    expect(result).toMatchObject({ sandboxExecuted: true, nodes: 1 });
  });

  it('DSH seam 契约位就绪（字段映射表非空 + 转换器签名冻结）', () => {
    const handle = submitWorkflow({ workflow: MINIMAL_WORKFLOW });
    expect(DSH_SEAM_FIELD_MAPPINGS.length).toBeGreaterThanOrEqual(3);
    const seamResult = handle.seam.toDshSurface();
    // 真实互转等 DSH 正式版——契约位返回明确的未实现提示（非 crash）
    expect(seamResult.ok).toBe(false);
    expect(seamResult.reason).toContain('DSH 正式版');
  });

  it('agent 字段任意类型不阻断校验（agent-creation 兜底对接）', () => {
    // agent 值不在内置映射表——校验层不应拒绝（resolveAgent 兜底）
    const handle = submitWorkflow({
      workflow: `
workflow:
  nodes:
    - id: x
      agent: some-unknown-agent-type
      task: 做一个未知类型的事
`,
    });
    expect(handle.parsed.nodes[0]?.agent).toBe('some-unknown-agent-type');
  });
});
