// ============================================================
// diff-ref.ts · --diff range → git ref 解析
// v1.1.3 新增（T02 回归测试支撑：commitMsg 取 range 终点）
// ============================================================

/**
 * 从 `--diff <range>` 参数解析出用于读取 commit message 的 git ref。
 *
 * 规则：
 * - 含 `..` 的范围（如 `HEAD~3..HEAD~1`）取**终点**（最后一个 `..` 之后的部分），
 *   而非始终取 HEAD——这是 v1.0.9 T02 修复点（commitMsg fallback 应反映本次审计的区间终点）。
 * - 非 `..` 范围的普通 ref（如 `main`、`HEAD`、`abc1234`）**原样返回**——
 *   用户传 `--diff main` 时应该读 main 的 commit message，不该静默换成 HEAD。
 * - 仅 undefined 或空字符串 → 回退 `HEAD`（安全兜底）。
 *
 * ⚠️ range 受 diff-parser 白名单 [a-zA-Z0-9~^.-] 约束，此处仅做字符串 split，安全。
 */
export function resolveDiffEndpoint(range: string | undefined): string {
  if (!range || range.length === 0) {
    return 'HEAD';
  }
  if (range.includes('..')) {
    return range.split('..').pop() || 'HEAD';
  }
  return range;
}
