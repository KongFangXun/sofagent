// ============================================================
// logger.ts · 基础日志函数
// 给未来的 TypeScript 脚本用（bash→TS 迁移的前置基础设施）
// 替代 bash 脚本中重复定义的 echo颜色/日志格式函数
// ============================================================

import { Colors, color } from './colors';

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

/** 日志级别前缀 */
const LEVEL_PREFIX: Record<LogLevel, string> = {
  info: `${Colors.BLUE}[INFO]${Colors.RESET}`,
  warn: `${Colors.YELLOW}[WARN]${Colors.RESET}`,
  error: `${Colors.RED}[ERROR]${Colors.RESET}`,
  success: `${Colors.GREEN}[OK]${Colors.RESET}`,
};

/**
 * 输出带级别标签的日志消息
 */
export function log(level: LogLevel, message: string): void {
  const prefix = LEVEL_PREFIX[level];
  console.log(`${prefix} ${message}`);
}

/** 信息级日志（蓝色） */
export function info(message: string): void {
  log('info', message);
}

/** 警告级日志（黄色） */
export function warn(message: string): void {
  log('warn', message);
}

/** 错误级日志（红色） */
export function error(message: string): void {
  log('error', message);
}

/** 成功级日志（绿色） */
export function success(message: string): void {
  log('success', message);
}

/**
 * 输出带标签的标题行
 */
export function title(text: string): void {
  console.log(`\n${color.bold(color.cyan('=== ' + text + ' ==='))}\n`);
}

/**
 * 输出分隔线
 */
export function separator(char: string = '-', length: number = 60): void {
  console.log(char.repeat(length));
}
