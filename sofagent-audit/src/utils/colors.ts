// ============================================================
// colors.ts · ANSI 颜色码常量
// 给未来的 TypeScript 脚本用（bash→TS 迁移的前置基础设施）
// bash 侧的颜色定义保持不变——这是已知技术债，将在迁移时统一消除
// ============================================================

/** ANSI 颜色码枚举 */
export const Colors = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  UNDERSCORE: '\x1b[4m',

  BLACK: '\x1b[30m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',

  BG_RED: '\x1b[41m',
  BG_GREEN: '\x1b[42m',
  BG_YELLOW: '\x1b[43m',
  BG_BLUE: '\x1b[44m',
} as const;

/** 颜色辅助函数 */
export const color = {
  red: (text: string): string => `${Colors.RED}${text}${Colors.RESET}`,
  green: (text: string): string => `${Colors.GREEN}${text}${Colors.RESET}`,
  yellow: (text: string): string => `${Colors.YELLOW}${text}${Colors.RESET}`,
  blue: (text: string): string => `${Colors.BLUE}${text}${Colors.RESET}`,
  cyan: (text: string): string => `${Colors.CYAN}${text}${Colors.RESET}`,
  bold: (text: string): string => `${Colors.BOLD}${text}${Colors.RESET}`,
  dim: (text: string): string => `${Colors.DIM}${text}${Colors.RESET}`,
};
