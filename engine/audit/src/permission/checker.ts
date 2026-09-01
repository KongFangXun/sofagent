// ============================================================
// permission/checker.ts · 权限检查逻辑
// v1.3.7 新增
// v1.4.3 RegExp 构造加 try/catch——非法正则（如 `finance/(unclosed`）
//   不再让审计进程崩溃（此前 new RegExp(用户串) 无保护 = 权限配置 DoS：
//   攻击者写一个语法错误的正则就能让整个审计停摆且 commit 照过）。
//   构造失败时 WARN 并跳过该条规则，不崩溃进程。
// ============================================================

import type { MergedPermission } from './types';

/**
 * 将权限规则的 glob 模式编译为正则。
 * 支持 * 通配符；非法模式（未闭合括号等）返回 null，调用方跳过该条并告警。
 */
export function compilePermissionPattern(pattern: string): RegExp | null {
  try {
    // 先转义正则元字符（保留 * 通配语义），含 +/( 等元字符的 pattern 按字面匹配，
    // 避免用户串被当作正则语法（注入面）或引发灾难性回溯（ReDoS）。
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  } catch (err) {
    console.error(
      `[sofagent] 权限配置正则无效: "${pattern}" → ${err instanceof Error ? err.message : String(err)}（该条规则已跳过）`
    );
    return null;
  }
}

export function checkPermission(
  perm: MergedPermission,
  file: string,
  operation: string,
): { allowed: boolean; matchedRule?: string; reason?: string } {
  for (const rule of perm.merged) {
    // 简单 glob 匹配（支持 * 通配符）——构造失败跳过该条，不崩溃进程
    const patternRegex = compilePermissionPattern(rule.pattern);
    if (patternRegex === null) continue;
    if (patternRegex.test(file) || patternRegex.test(operation)) {
      return {
        allowed: rule.effect === 'allow',
        matchedRule: rule.name,
        reason: rule.effect === 'allow'
          ? `Matched allow rule: ${rule.name}`
          : `Matched deny rule: ${rule.name}`,
      };
    }
  }
  // 无匹配规则 → 默认允许
  return { allowed: true };
}
