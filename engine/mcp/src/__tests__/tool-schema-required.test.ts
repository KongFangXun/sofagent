// ============================================================
// tool-schema-required.test.ts · schema.required ↔ dispatch 强制 一致性守卫
// v1.4.8 深模块条目 5 勘误 §一-2
// ============================================================
// 单向断言：schema 中每个 `required` 字段，要么 dispatch 侧静态强制它，
// 要么在显式豁免清单（EXEMPT，带 reason）里——把「刻意不强制」变成显式声明，
// 杜绝后人继续往 schema 里塞假 required（虚标）。
// 反向（dispatch 强制但 schema 未标）不在本守卫范围（属条件必填勘误，另列）。
// ============================================================
import { describe, it, expect } from 'vitest';
import { TOOLS } from '../tool-registry';

/** dispatch 侧强制某字段的静态判据形态（与 handler 内校验写法一一对应） */
function dispatchEnforces(handlerSrc: string, field: string): boolean {
  const f = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`!args\\.${f}\\b`).test(handlerSrc) ||
    new RegExp(`typeof args\\.${f}\\b\\s*!==`).test(handlerSrc) ||
    new RegExp(`!Array\\.isArray\\(args\\.${f}\\b`).test(handlerSrc)
  );
}

/**
 * 显式豁免清单——schema.required 保留但 dispatch 不静态强制，必须在此声明 reason。
 * 两类：
 *   (1) 实现内强制——校验在 tool 实现（工具函数体内返回 { error }），handler 只转发；
 *   (2) 刻意不强制——语义上是破坏性操作的显式声明，缺省走非错误路径（human-confirmed）。
 */
const EXEMPT: Array<{ tool: string; field: string; reason: string }> = [
  // (1) 实现内强制——校验在 tool 实现体内，handler 只转发
  { tool: 'write_think', field: 'lesson', reason: '实现内强制：writeThink 校验 typeof args.lesson !== string || !args.lesson 返回 { error }' },
  { tool: 'compose', field: 'task', reason: '实现内强制：compose 校验 typeof args.task !== string || !args.task 返回错误（v1.5.2 A-4 由 sofagent_compose 更名）' },
  { tool: 'audit_file', field: 'path', reason: '实现内强制：auditFile 校验 !path || typeof path !== string 返回 { error }' },
  { tool: 'audit_file', field: 'change_type', reason: '实现内强制：auditFile 校验 change_type ∈ create|modify|delete' },
  { tool: 'search_knowledge', field: 'query', reason: '实现内强制：searchKnowledge 校验 query 缺失返回 { error }' },
  { tool: 'read_entity', field: 'name', reason: '实现内强制：readEntity 校验 !name 返回 { error }' },
  { tool: 'read_concept', field: 'name', reason: '实现内强制：readConcept 校验 !name 返回 { error }' },
  // (2) 刻意不强制——破坏性操作的显式声明，缺省走非错误路径（human-confirmed 语义）
  { tool: 'delete_entity', field: 'confirmed', reason: '刻意不强制：confirmed !== true 走「需人工确认」提示的非错误路径，非参数错误' },
  { tool: 'delete_concept', field: 'confirmed', reason: '刻意不强制：confirmed !== true 走「需人工确认」提示的非错误路径，非参数错误' },
];

describe('schema.required ↔ dispatch 强制 一致性守卫（§一-2）', () => {
  it('每个 schema.required 字段要么被 dispatch 强制、要么在显式豁免清单', () => {
    const missing: string[] = [];
    for (const t of TOOLS) {
      const src = typeof t.handler === 'function' ? t.handler.toString() : '';
      for (const field of t.inputSchema.required ?? []) {
        if (dispatchEnforces(src, field)) continue;
        if (EXEMPT.some((e) => e.tool === t.name && e.field === field)) continue;
        missing.push(`${t.name}.${field}`);
      }
    }
    expect(missing, `以下 schema.required 字段 dispatch 未强制且未豁免（虚标）：\n${missing.join('\n')}`).toEqual([]);
  });

  it('豁免清单每条都指向真实存在的 schema.required 字段且带 reason（防清单腐化）', () => {
    const bad: string[] = [];
    for (const e of EXEMPT) {
      const t = TOOLS.find((x) => x.name === e.tool);
      if (!t || !(t.inputSchema.required ?? []).includes(e.field)) bad.push(`${e.tool}.${e.field}: 非真实 required 字段`);
      if (!e.reason || e.reason.length < 8) bad.push(`${e.tool}.${e.field}: reason 缺失或过短`);
    }
    expect(bad).toEqual([]);
  });
});
