// ============================================================
// A5 不瞒真相（追溯层 · 业务底线）
// 合并自旧 #10 如实汇报 + R5 占位 commit
// commit message 是否为空 / 是否纯占位符（"fix"/"update"/"wip"）
// v0.94：优先使用 ctx.commitMsg，为空时 fallback 到 git 读取（向后兼容）
// v1.5.3 第七章（AuditScope）：git 读取不再由本规则发起——commit message 输入面
// 收口到 `ctx.scope.commitMsg`（**规则侧**唯一 git 触达点 = scope.ts 的 createAuditScope），
// 本规则零 git。无 scope 时读 ctx.commitMsg；**无 scope 且无 commitMsg ⇒ 显式 SKIPPED**
// （收敛批：拿不到输入 ≠ 通过——不静默 PASS；对齐 A18 无 scope 分支的 fail-closed 取向）。
// ============================================================

import type { AuditContext, RuleScan, RuleStatus } from './types';

const PLACEHOLDER_PATTERNS = [
  /^(fix|update|wip|test|chore|doc|refactor)$/i,
  /^(fix|update|wip|test|chore|doc|refactor)\s*[:：]\s*$/i,
  /^\.$/,
  /^temp/i,
  /^tmp/i,
];

export function scanA5(ctx: AuditContext): RuleScan {
  let status: RuleStatus = 'PASS';
  const details: string[] = [];

  // 输入面：scope（唯一取输入面）优先——scope 已在构造期解析（显式注入优先，否则 git）；
  // 无 scope（向后兼容旧路径）时退化为 ctx.commitMsg，不触 git。
  let message: string | undefined;
  if (ctx.scope) {
    message = ctx.scope.commitMsg;
    if (message === undefined) {
      // scope 解析失败（git 不可用等）——与旧 fallback 失败同语义与措辞
      status = 'FAIL';
      details.push('无法读取 commit message: ' + (ctx.scope.commitMsgError ?? 'scope 未解析 commit message'));
      return { status, details };
    }
  } else {
    message = ctx.commitMsg;
    if (message === undefined) {
      // v1.5.3 第七章收口：无 scope 且未显式提供 commit message ⇒ **无法判定**。
      //   旧代码此处 fallback 到 git（git 可用→读真实 msg、不可用→FAIL）；D7 把 git
      //   收口到 scope 后此路不触 git，若静默返回 PASS 即 **fail-open 退化**
      //   （实测：非 git cwd 下 PRE=FAIL → POST=PASS）。
      //   现改为**显式 SKIPPED + 原因**——把「拿不到输入」与「通过」分开，不冒充 PASS
      //   （与 A18 无 scope 分支的 fail-closed 取向对称：宁显式未知，不静默放行）。
      status = 'SKIPPED';
      details.push('无 scope 且无 commitMsg——无法判定 commit message 是否如实（不冒充 PASS）');
      return { status, details };
    }
  }
  message = message.trim();

  if (!message) {
    status = 'FAIL';
    details.push('commit message 为空。');
    return { status, details };
  }

  const firstLine = (message.split('\n')[0] ?? '').trim();

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(firstLine)) {
      status = 'WARN';
      details.push(`commit message 疑似占位符: "${firstLine}"。建议改为描述具体改了什么。`);
      return { status, details };
    }
  }

  // 太短的 commit message
  if (firstLine.length < 5) {
    status = 'WARN';
    details.push(`commit message 太短 (${firstLine.length} 字符): "${firstLine}"。`);
  }

  return { status, details };
}
