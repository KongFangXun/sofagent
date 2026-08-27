// ============================================================
// no-dynamic-require.ts · 禁止动态 require
// v1.4.1（一）：require(变量) 使依赖来源在静态分析下不可见——
// 供应链投毒（OWASP ASI04）的隐藏通道
// ============================================================

import type { AstRule, AstNodeHost } from '../types';
import { walk, is, nodeText } from '../walk';

export const noDynamicRequireRule: AstRule = {
  id: 'no-dynamic-require',
  name: '禁止动态 require',
  severity: 'FAIL',
  description: 'require(非字面量) 的模块来源静态不可见——供应链投毒隐藏通道（ASI04 关联）',
  checkCode(ctx) {
    walk(ctx.sourceFile, (node) => {
      if (!is(ctx, node, 'CallExpression')) return;
      const callee = (node as AstNodeHost & { expression?: AstNodeHost }).expression;
      if (!is(ctx, callee, 'Identifier')) return;
      if (nodeText(callee) !== 'require') return;

      const args = (node as AstNodeHost & { arguments?: readonly AstNodeHost[] }).arguments ?? [];
      const first = args[0];
      if (!first) return;
      if (!is(ctx, first, 'StringLiteral')) {
        ctx.report(node, 'require() 参数不是字符串字面量——动态模块加载使依赖审计失效');
      }
    });
  },
};
