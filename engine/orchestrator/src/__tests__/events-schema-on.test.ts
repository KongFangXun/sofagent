// ============================================================
// events-schema-on.test.ts · workflow.schema.json 的 `on:` 声明（v1.5.1 第一章收口）
// ============================================================
//
// 断言两件事：
//   ① 声明在位——`definitions.workflowNode.properties.on` 存在，且两种写法
//      （简写字符串 / `{ event, from?, filter? }` 对象）都在 schema 里；
//   ② 声明**真的生效**——同一份文档经 `WORKFLOW_SCHEMA` 校验时，合法 `on:`
//      通过、非法 `on:`（非串非对象 / 缺 event / 未知键 / 非法的 filter 值）
//      被拒，且不含 `on:` 的既有节点定义仍通过（向后兼容零破坏）。
//
// ⚠️ 边界（如实记录，不假装已闭环）：运行容器 submitWorkflow 的 schema 校验
// 走 `parsedToSchemaDoc`，该函数**尚未透传 `on:`**（parser 也未解析该字段）——
// 故本 schema 声明目前对「容器提交路径」不生效；运行期 `on:` 约束由
// `validateEventSubscriptions`（workflow-submit + EventRouter）兜住。
// 本文件只对本 schema 自身（直接喂文档给 WORKFLOW_SCHEMA）做断言。
// ============================================================

import { describe, it, expect } from 'vitest';
import { WORKFLOW_SCHEMA } from '../workflow/container';
import { validateAgainstSchema } from '../ontology/schema/index';

/** 取 workflowNode.properties.on 的声明 */
function onDecl(): Record<string, unknown> {
  const schema = WORKFLOW_SCHEMA as unknown as {
    definitions: { workflowNode: { properties: Record<string, unknown> } };
  };
  return schema.definitions.workflowNode.properties.on as Record<string, unknown>;
}

/** 构造一份含单节点的 schema 文档 */
function docWithNode(node: Record<string, unknown>): Record<string, unknown> {
  return { workflow: { name: 'schema-on-probe', nodes: [node] } };
}

/** 节点最小必需字段（id/agent/task） */
function node(extra: Record<string, unknown>): Record<string, unknown> {
  return { id: 'n1', agent: 'developer', task: '任务', ...extra };
}

function errorsOf(doc: Record<string, unknown>): string[] {
  return validateAgainstSchema(doc, WORKFLOW_SCHEMA).errors;
}

describe('第一章 · workflow.schema.json 的 on: 声明', () => {
  it('声明在位：on 支持 简写字符串 / 完整对象 两种写法', () => {
    const decl = onDecl();
    expect(decl).toBeDefined();
    expect(typeof decl.description).toBe('string');
    const forms = decl.oneOf as Array<Record<string, unknown>>;
    expect(Array.isArray(forms)).toBe(true);
    expect(forms).toHaveLength(2);
    // 简写：字符串
    expect(forms[0]!.type).toBe('string');
    // 完整形态：event 必填；from/filter 可选；未知键拒绝
    expect(forms[1]!.type).toBe('object');
    expect(forms[1]!.required).toEqual(['event']);
    expect(forms[1]!.additionalProperties).toBe(false);
    const props = forms[1]!.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['event', 'filter', 'from']);
  });

  it('合法 on: 通过——简写 / from 约束 / filter 过滤三种形态', () => {
    expect(errorsOf(docWithNode(node({ on: 'workflow.node.completed' })))).toEqual([]);
    expect(
      errorsOf(
        docWithNode(
          node({ on: { event: 'workflow.node.completed', from: 'upstream' } }),
        ),
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        docWithNode(
          node({ on: { event: 'webhook.form.submitted', filter: { formId: 'contact-us', retry: 2, urgent: true } } }),
        ),
      ),
    ).toEqual([]);
  });

  it('非法 on: 被 schema 拒绝——非串非对象 / 缺 event', () => {
    // 数组形态（本版不支持多声明）
    expect(errorsOf(docWithNode(node({ on: ['workflow.node.completed'] }))).length).toBeGreaterThan(0);
    // 数字标量
    expect(errorsOf(docWithNode(node({ on: 42 }))).length).toBeGreaterThan(0);
    // 对象但缺 event
    expect(errorsOf(docWithNode(node({ on: { from: 'upstream' } }))).length).toBeGreaterThan(0);
    // event 类型非法（空串被 minLength 拒）
    expect(errorsOf(docWithNode(node({ on: { event: '' } }))).length).toBeGreaterThan(0);
  });

  it('声明了 additionalProperties: false（未知键/非法 filter 值的**声明**在位）', () => {
    // ⚠️ 本仓 workflow 容器用的校验器（ontology/schema/index.ts）只实现
    //    type/required/properties/items/enum/minLength/oneOf/$ref 七要素——
    //    `additionalProperties` 是**声明性**约束（与既有 modelPreference 同先例），
    //    校验器不执行它，故此处只断言声明在位，不假装它已被强制。
    const forms = onDecl().oneOf as Array<Record<string, unknown>>;
    expect(forms[1]!.additionalProperties).toBe(false);
    const filter = (forms[1]!.properties as Record<string, Record<string, unknown>>).filter;
    expect(filter.additionalProperties).toEqual({
      type: ['string', 'number', 'boolean'],
    });
  });

  it('向后兼容：不写 on: 的既有节点定义仍然零错误', () => {
    expect(errorsOf(docWithNode(node({ depends_on: ['n0'], type: 'auto', hitl: false })))).toEqual([]);
  });
});
