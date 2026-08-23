// ============================================================
// no-insecure-url.ts · 禁止 http:// 明文端点
// v1.4.0（一）：AST 级扫字符串字面量——只报代码里的端点 URL，
// 不碰注释与文档（pattern 规则会误伤）
// ============================================================

import type { AstRule } from '../types';
import { walk, is, nodeText } from '../walk';

/** 本地/示例域名白名单——不是真实端点 */
const SAFE_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|example\.(com|org)|test|.*\.local)(:|$)/;

export const noInsecureUrlRule: AstRule = {
  id: 'no-insecure-url',
  name: '禁止 http:// 明文端点',
  severity: 'WARN',
  description: '字符串字面量里的 http:// 端点（本地/示例域名除外）——明文传输可被中间人替换',
  checkCode(ctx) {
    walk(ctx.sourceFile, (node) => {
      if (!is(ctx, node, 'StringLiteral')) return;
      const text = nodeText(node) ?? '';
      if (!/^http:\/\//.test(text)) return;
      // 提取 host 部分做白名单
      const host = text.replace(/^http:\/\//, '').split('/')[0] ?? '';
      if (SAFE_HOST.test(host)) return;
      ctx.report(node, `明文 http:// 端点（${host}）——生产端点应走 https`);
    });
  },
};
