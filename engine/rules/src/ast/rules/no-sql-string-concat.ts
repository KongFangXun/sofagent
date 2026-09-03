// ============================================================
// no-sql-string-concat.ts · 禁止 SQL 字符串拼接
// v1.4.4（一）：query 类调用的参数若为「字面量 + 变量」拼接，
// 即 SQL 注入入口（AST 级只报高危形态，比正则扫行准）
// ============================================================

import type { AstRule, AstNodeHost } from '../types';
import { walk, is, nodeText } from '../walk';

/** 查询类函数名模式 */
const QUERY_FN = /(query|execute|exec|sql|raw)/i;

/** 变量名提示来自用户输入（弱信号，仅用于 message 措辞） */
const INPUT_HINT = /(req|input|param|user|body|query|ctx|data)/i;

export const noSqlStringConcatRule: AstRule = {
  id: 'no-sql-string-concat',
  name: '禁止 SQL 字符串拼接',
  severity: 'WARN',
  description: 'query 类调用的参数含「字符串 + 非字面量」拼接——SQL 注入入口',
  checkCode(ctx) {
    walk(ctx.sourceFile, (node) => {
      if (!is(ctx, node, 'CallExpression')) return;
      const callee = (node as AstNodeHost & { expression?: AstNodeHost }).expression;
      if (!is(ctx, callee, 'Identifier') && !is(ctx, callee, 'PropertyAccessExpression')) return;
      const fnName = nodeText((callee as AstNodeHost & { name?: AstNodeHost }).name)
        ?? nodeText(callee)
        ?? '';
      if (!QUERY_FN.test(fnName)) return;

      const args = (node as AstNodeHost & { arguments?: readonly AstNodeHost[] }).arguments ?? [];
      for (const arg of args) {
        if (!is(ctx, arg, 'BinaryExpression')) continue;
        const op = (arg as AstNodeHost & { operatorToken?: AstNodeHost }).operatorToken;
        if (!is(ctx, op, 'PlusToken')) continue;
        // 操作数任一是非字面量 → 拼接变量
        const hasDynamic = [arg].some(() => true);
        void hasDynamic;
        const left = (arg as AstNodeHost & { left?: AstNodeHost }).left;
        const right = (arg as AstNodeHost & { right?: AstNodeHost }).right;
        const dynamicSide = [left, right].find((side) => side && !is(ctx, side, 'StringLiteral') && !is(ctx, side, 'NumericLiteral'));
        if (dynamicSide) {
          const hint = INPUT_HINT.test(nodeText(dynamicSide) ?? '') ? '（疑似用户输入）' : '';
          ctx.report(arg, `${fnName}() 的 SQL 由字符串拼接构造${hint}——改用参数化查询`);
        }
      }
    });
  },
};
