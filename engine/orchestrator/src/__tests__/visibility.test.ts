// visibility.test.ts · G6 节点级可见性三级权限边界测试
// 覆盖：三级枚举穿透 / open 缺省兼容（v1.3.6 格式零破坏）/ private+result-only
// 语义校验（须声明 approver）/ container 集成（受限节点缺 approver 拒绝提交）
import { describe, it, expect } from 'vitest';

const { parseWorkflowYaml } = await import('../workflow-parser');
const { submitWorkflow, validateVisibility } = await import('../workflow/container');

/** 生成 workflow YAML（nodes YAML 串插入） */
function wfYaml(nodesYaml: string, approverYaml = ''): string {
  return `
workflow:
  name: vis-test
  nodes:
${nodesYaml}
${approverYaml}
`.trim();
}

const openNode = '    - id: a1\n      agent: developer\n      task: 公开任务';
const privateNode = '    - id: p1\n      agent: developer\n      task: 私密任务\n      visibility: private';
const resultOnlyNode = '    - id: r1\n      agent: developer\n      task: 摘要任务\n      visibility: result-only';

describe('G6 三级可见性：parser 穿透', () => {
  it('open / private / result-only 三级正确解析', () => {
    const parsed = parseWorkflowYaml(wfYaml([openNode, privateNode, resultOnlyNode].join('\n')));
    expect(parsed.nodes[0]!.visibility).toBeUndefined(); // open 缺省不物化
    expect(parsed.nodes[1]!.visibility).toBe('private');
    expect(parsed.nodes[2]!.visibility).toBe('result-only');
  });

  it('visibility 非法值 fail-loud 拒绝', () => {
    expect(() =>
      parseWorkflowYaml(wfYaml('    - id: a1\n      agent: developer\n      task: t\n      visibility: secret')),
    ).toThrowError(/visibility 非法/);
  });

  it('v1.3.6 旧格式（无 visibility 字段）零破坏', () => {
    const parsed = parseWorkflowYaml(wfYaml(openNode));
    expect(parsed.nodes[0]!.id).toBe('a1');
    expect(parsed.nodes[0]!.visibility).toBeUndefined();
  });
});

describe('G6 三级可见性：merge 语义校验（validateVisibility）', () => {
  it('全 open 节点（或无受限节点）无需 approver——通过', () => {
    const parsed = parseWorkflowYaml(wfYaml(openNode));
    expect(validateVisibility(parsed)).toEqual([]);
  });

  it('private 节点缺 approver——拒绝（受限审阅门必须有执行人）', () => {
    const parsed = parseWorkflowYaml(wfYaml(privateNode));
    const issues = validateVisibility(parsed);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('p1');
    expect(issues[0]).toContain('approver');
  });

  it('result-only 节点缺 approver——同样拒绝', () => {
    const parsed = parseWorkflowYaml(wfYaml(resultOnlyNode));
    expect(validateVisibility(parsed)[0]).toContain('r1');
  });

  it('private 节点 + approver 声明——通过', () => {
    const parsed = parseWorkflowYaml(
      wfYaml(privateNode, '  approver:\n    id: alice\n    kind: human'),
    );
    expect(validateVisibility(parsed)).toEqual([]);
  });
});

describe('G6 三级可见性：container 集成（submitWorkflow 收口）', () => {
  it('受限节点缺 approver 的 workflow 提交被拒（含 visibility 错误项）', () => {
    try {
      submitWorkflow({ workflow: wfYaml(privateNode) });
      expect.unreachable('应抛 WorkflowSubmitError');
    } catch (err) {
      expect((err as { name: string }).name).toBe('WorkflowSubmitError');
      const issues = (err as { issues: string[] }).issues;
      expect(issues.some((i) => i.includes('visibility') && i.includes('p1'))).toBe(true);
    }
  });

  it('带 approver 的受限 workflow 提交通过', () => {
    const handle = submitWorkflow({
      workflow: wfYaml([privateNode, resultOnlyNode].join('\n'), '  approver:\n    id: alice'),
    });
    expect(handle.parsed.nodes).toHaveLength(2);
    expect(handle.criteriaIssues).toEqual([]);
  });

  it('schema 枚举校验穿透（parsedToSchemaDoc 还原 visibility）', () => {
    // 合法三级经 schema 校验通过；拼错值在 parser 已拦——container 全链绿
    const handle = submitWorkflow({
      workflow: wfYaml('    - id: v1\n      agent: developer\n      task: t\n      visibility: result-only', '  approver:\n    id: bob'),
    });
    expect(handle.parsed.nodes[0]!.visibility).toBe('result-only');
  });
});
