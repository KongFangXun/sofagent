// ============================================================
// no-hardcoded-secret.ts · 禁止硬编码密钥（AST 语义级）
// v1.4.3（一）：与 pattern 规则（正则扫行）相比，AST 级检测只命中
// 「赋值给密钥类变量名的字符串字面量」，误报率显著更低
// ============================================================

import type { AstRule, AstNodeHost } from '../types';
import { walk, is, nodeText } from '../walk';

/** 密钥类变量名模式 */
const SECRET_NAME = /(secret|token|passwd|password|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential)/i;

/** 占位符白名单——这些值不是真实密钥 */
const PLACEHOLDER = /^(x+|<[^>]*>|\$\{[^}]*\}|your[_-].*|placeholder|changeme|redacted|test-?dummy)$/i;

/** 疑似真实密钥的最小长度（短字符串多为业务常量） */
const MIN_SECRET_LEN = 16;

function isSecretLiteral(name: string, value: string): boolean {
  if (!SECRET_NAME.test(name)) return false;
  if (value.length < MIN_SECRET_LEN) return false;
  if (PLACEHOLDER.test(value)) return false;
  return true;
}

export const noHardcodedSecretRule: AstRule = {
  id: 'no-hardcoded-secret',
  name: '禁止硬编码密钥（AST 语义级）',
  severity: 'FAIL',
  description: '赋值给 secret/token/apiKey 等密钥类变量的长字符串字面量——比正则扫行误报率低',
  checkCode(ctx) {
    walk(ctx.sourceFile, (node) => {
      // const secret = "sk-..."：VariableDeclaration
      if (is(ctx, node, 'VariableDeclaration')) {
        const decl = node as AstNodeHost & { name?: AstNodeHost; initializer?: AstNodeHost };
        const name = nodeText(decl.name);
        const init = decl.initializer;
        if (name && is(ctx, init, 'StringLiteral')) {
          const value = nodeText(init) ?? '';
          if (isSecretLiteral(name, value)) {
            ctx.report(node, `变量 ${name} 被赋值为疑似真实密钥的字符串字面量`);
          }
        }
      }
      // { apiKey: "sk-..." }：PropertyAssignment（对象字面量属性）
      if (is(ctx, node, 'PropertyAssignment')) {
        const prop = node as AstNodeHost & { name?: AstNodeHost; initializer?: AstNodeHost };
        const name = nodeText(prop.name);
        const init = prop.initializer;
        if (name && is(ctx, init, 'StringLiteral')) {
          const value = nodeText(init) ?? '';
          if (isSecretLiteral(name, value)) {
            ctx.report(node, `属性 ${name} 被赋值为疑似真实密钥的字符串字面量`);
          }
        }
      }
    });
  },
};
