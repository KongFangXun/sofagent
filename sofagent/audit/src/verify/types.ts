// ============================================================
// verify/types.ts · 验证脚本的类型与常量定义
// ============================================================
// 从 verify.ts 中提取的类型定义、颜色常量、参数接口。

// ── 颜色（与 index.ts 风格一致）──
export const RED = '\x1b[0;31m';
export const GREEN = '\x1b[0;32m';
export const YELLOW = '\x1b[1;33m';
export const BOLD = '\x1b[1m';
export const NC = '\x1b[0m';

// ── 检查状态类型 ──
export type CheckStatus = 'pass' | 'fail' | 'warn';

export interface CheckItem {
  status: CheckStatus;
  item: string;
}

export interface VerifyResult {
  pass: number;
  warn: number;
  fail: number;
  total: number;
  checks: CheckItem[];
}

// ── 参数解析 ──
export interface Args {
  json: boolean;
  quiet: boolean;
  quick: boolean;
  platform: string;
}
