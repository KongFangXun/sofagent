// ============================================================
// no-empty-catch.ts · 禁止空 catch 块
// v1.4.4（一）：空 catch 吞异常——错误静默扩散是审计盲区的经典成因
// （对齐 FORGE「空 catch 治理」工程纪律的语义级落地）
// ============================================================

import type { AstRule, AstNodeHost } from '../types';
import { walk, is } from '../walk';

export const noEmptyCatchRule: AstRule = {
  id: 'no-empty-catch',
  name: '禁止空 catch 块',
  severity: 'WARN',
  description: '空 catch 块吞掉异常——错误静默扩散；至少要留一行注释说明为什么可以忽略',
  checkCode(ctx) {
    walk(ctx.sourceFile, (node) => {
      if (!is(ctx, node, 'CatchClause')) return;
      const block = (node as AstNodeHost & { block?: AstNodeHost }).block;
      if (!is(ctx, block, 'Block')) return;
      const stmts = (block as AstNodeHost & { statements?: readonly AstNodeHost[] }).statements ?? [];
      if (stmts.length === 0) {
        ctx.report(node, '空 catch 块——异常被静默吞掉；至少留一行注释说明忽略理由');
      }
    });
  },
};
