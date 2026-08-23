// ============================================================
// walk.ts · 语法树遍历工具
// v1.4.0（一）：深度优先遍历 + 判型/取文本工具——规则层共用
// ============================================================

import type { AstNodeHost, AstRuleContext } from './types';

/** 深度优先遍历（先序）：visit 返回 false 时剪枝不再下钻 */
export function walk(node: AstNodeHost, visit: (n: AstNodeHost) => boolean | void): void {
  const keepGoing = visit(node);
  if (keepGoing === false) return;
  node.forEachChild((child) => walk(child, visit));
}

/** 判节点类型：ctx.kind(name) === node.kind */
export function is(ctx: AstRuleContext, node: AstNodeHost | undefined | null, kindName: string): boolean {
  return !!node && node.kind === ctx.kind(kindName);
}

/** 取标识符/字面量文本（Token 节点的 .text 属性） */
export function nodeText(node: AstNodeHost | undefined | null): string | undefined {
  return node?.text;
}

/**
 * 收集本文件 import 绑定：{ 导入名: 来源模块 }。
 * 供规则做「符号来自哪个模块」的语法级判断（不需要 checker 语义层）。
 * 支持：import { x } from 'm' / import * as x from 'm' / import x from 'm'
 */
export function collectImports(ctx: AstRuleContext): Map<string, string> {
  const bindings = new Map<string, string>();
  const stmts = ctx.sourceFile.statements ?? [];
  for (const stmt of stmts) {
    if (!is(ctx, stmt, 'ImportDeclaration')) continue;
    const moduleSpecifier = nodeText(
      (stmt as AstNodeHost & { moduleSpecifier?: AstNodeHost }).moduleSpecifier
    );
    if (!moduleSpecifier) continue;
    const clause = (stmt as AstNodeHost & { importClause?: AstNodeHost }).importClause;
    if (!clause) continue;
    // namedBindings：NamedImports { x } / NamespaceImport * as x
    const named = (clause as AstNodeHost & { namedBindings?: AstNodeHost }).namedBindings;
    if (named) {
      if (is(ctx, named, 'NamespaceImport')) {
        const name = nodeText((named as AstNodeHost & { name?: AstNodeHost }).name);
        if (name) bindings.set(name, moduleSpecifier);
      } else if (is(ctx, named, 'NamedImports')) {
        const elements = (named as AstNodeHost & { elements?: readonly AstNodeHost[] }).elements ?? [];
        for (const el of elements) {
          // ImportSpecifier：name 是导入名，propertyName 是本地别名（反向）
          const imported = nodeText((el as AstNodeHost & { propertyName?: AstNodeHost }).propertyName)
            ?? nodeText((el as AstNodeHost & { name?: AstNodeHost }).name);
          if (imported) bindings.set(imported, moduleSpecifier);
        }
      }
    }
    // default import
    const def = nodeText((clause as AstNodeHost & { name?: AstNodeHost }).name);
    if (def) bindings.set(def, moduleSpecifier);
  }
  return bindings;
}
