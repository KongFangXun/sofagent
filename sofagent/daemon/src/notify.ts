// notify.ts · daemon 通知模块（v1.1.4）
// 所有 daemon 对外通知统一走此模块，确保 sofagent 品牌归属
// ============================================================

const VERSION = '1.1.4';

/** 通知级别 */
export type NotifyLevel = 'info' | 'warn' | 'error';

/** 通知选项 */
export interface NotifyOptions {
  /** 通知级别 */
  level?: NotifyLevel;
  /** 来源模块 */
  source: string;
}

const EMOJI: Record<NotifyLevel, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

/**
 * 发送 daemon 通知——所有输出以 sofagent 品牌开头
 *
 * @param message 通知内容
 * @param options 通知选项
 */
export function notify(
  message: string,
  options: NotifyOptions = { source: 'daemon' }
): void {
  const level = options.level ?? 'info';
  const emoji = EMOJI[level];
  const prefix = `[sofagent-daemon v${VERSION}]`;
  console.log(`${emoji} ${prefix} [${options.source}] ${message}`);
}

/**
 * daemon 启动 banner
 */
export function banner(projectDir: string): void {
  console.log(`sofagent-daemon v${VERSION} — 启动守护进程`);
  console.log(`  监控目录: ${projectDir}`);
  console.log('');
}
