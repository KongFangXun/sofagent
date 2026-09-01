// ============================================================
// no-eval.ts · 禁止 eval() / new Function()
// v1.4.3（一）：官方示范 AST 规则——动态代码执行是注入攻击的标准入口
// ============================================================

import type { AstRule } from '../types';
import { walk, is, nodeText } from '../walk';

export const noEvalRule: AstRule = {
  id: 'no-eval',
  name: '禁止动态代码执行',
  severity: 'FAIL',
  description: 'eval() / new Function() 会执行任意字符串代码，是 prompt 注入与供应链攻击的放大器',
  checkCode(ctx) {
    walk(ctx.sourceFile, (node) => {
      // eval(...)：CallExpression，callee 是 Identifier "eval"
      if (is(ctx, node, 'CallExpression')) {
        const callee = (node as { expression?: unknown }).expression as
          | { kind: number; text?: string }
          | undefined;
        if (callee && callee.kind === ctx.kind('Identifier') && nodeText(callee as never) === 'eval') {
          ctx.report(node, '禁止使用 eval()——动态代码执行入口');
        }
      }
      // new Function(...)：NewExpression，callee 是 Identifier "Function"
      if (is(ctx, node, 'NewExpression')) {
        const callee = (node as { expression?: unknown }).expression as
          | { kind: number; text?: string }
          | undefined;
        if (callee && callee.kind === ctx.kind('Identifier') && nodeText(callee as never) === 'Function') {
          ctx.report(node, '禁止 new Function()——动态代码执行入口');
        }
      }
    });
  },
};
