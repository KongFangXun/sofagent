// ============================================================
// log-channel.ts · daemon 日志通道解析 + 旧通道 tombstone（v1.6.0 BUG-74）
// ============================================================
//
// 背景（视角十九 P1-19.2「daemon 日志三态不一致」）：
//   daemon 的真实日志通道已迁 launchd log（launchd 接管后 stdout/stderr 归
//   plist 的 StandardOutPath），但旧 `daemon.log`（shell daemon.sh 写入）仍在
//   原地停在上一次 SIGTERM 退出的内容——既无 rotation 说明也无 tombstone。
//   用户按文档 `tail daemon.log` 排查会读到「daemon 已退出」的假死相。
//
// 本模块职责（纯解析 + 幂等写入，便于单测）：
//   ① resolveActiveLogChannel —— 解析当前活跃的日志通道路径（--doctor 展示用）；
//   ② ensureDaemonLogTombstone —— launchd 接管且 daemon.log 已非活跃通道时，
//      向旧 daemon.log 追加一行迁移提示（幂等：已含该行则跳过）。
// ============================================================

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/** 迁移提示固定文案（tombstone SSOT——grep「日志通道已迁移」判定） */
export const DAEMON_LOG_TOMBSTONE =
  '[sofagent] 日志通道已迁移：本文件不再更新，活跃日志见 daemon-launchd.log（launchd 托管）';

/** launchd 托管 daemon 的服务标签（plist Label / XPC_SERVICE_NAME 前缀） */
export const LAUNCHD_SERVICE_LABEL = 'com.sofagent.daemon';

/** launchd 托管注册点（macOS LaunchAgent plist 路径） */
export function launchdPlistPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LAUNCHD_SERVICE_LABEL}.plist`);
}

/**
 * 解析 launchd plist 声明的日志落点（StandardOutPath）。
 * 无 plist / 无该项 / 读取失败 → null。
 */
export function resolveLaunchdLogOutPath(home: string = homedir()): string | null {
  const plist = launchdPlistPath(home);
  if (!existsSync(plist)) return null;
  try {
    const xml = readFileSync(plist, 'utf-8');
    const m = xml.match(/<key>StandardOutPath<\/key>\s*<string>([^<]+)<\/string>/);
    return m?.[1]?.trim() ?? null;
  } catch (err) {
    console.warn(
      `[daemon-log-channel] launchd plist 读取失败（${plist}）: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** 当前进程是否由 launchd 拉起（macOS launchd 注入 XPC_SERVICE_NAME） */
export function launchedByLaunchd(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'darwin') return false;
  const xpc = env.XPC_SERVICE_NAME;
  return typeof xpc === 'string' && xpc.startsWith('com.sofagent');
}

/**
 * 解析当前活跃的 daemon 日志通道。
 *
 * 优先级：launchd plist 显式声明的 StandardOutPath → launchd 拉起时的约定落点
 * （与旧 daemon.log 同目录的 daemon-launchd.log）→ 回退旧 daemon.log（legacy 通道）。
 */
export function resolveActiveLogChannel(
  legacyLogPath: string,
  opts: { home?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const plistOut = resolveLaunchdLogOutPath(home);
  if (plistOut) return plistOut;
  if (launchedByLaunchd(env)) return join(dirname(legacyLogPath), 'daemon-launchd.log');
  return legacyLogPath;
}

export interface TombstoneResult {
  written: boolean;
  reason: 'written' | 'already-present' | 'channel-active';
}

/**
 * 向旧 daemon.log 追加迁移 tombstone（BUG-74，幂等）。
 *
 * 触发条件：当前活跃日志通道 ≠ 旧 daemon.log（即 launchd 已接管、旧通道已非活跃）。
 * 幂等：文件已含 tombstone 行则跳过——重复启动不重复追加。
 * 失败不阻断 daemon 启动（best-effort），但留痕。
 */
export function ensureDaemonLogTombstone(
  legacyLogPath: string,
  opts: { home?: string; env?: NodeJS.ProcessEnv; activeChannel?: string } = {},
): TombstoneResult {
  const activeChannel = opts.activeChannel ?? resolveActiveLogChannel(legacyLogPath, opts);
  if (activeChannel === legacyLogPath) {
    // 旧 daemon.log 仍是活跃通道 → 无需 tombstone
    return { written: false, reason: 'channel-active' };
  }

  let content = '';
  try {
    if (existsSync(legacyLogPath)) content = readFileSync(legacyLogPath, 'utf-8');
  } catch (err) {
    console.warn(
      `[daemon-log-channel] 读旧 daemon.log 失败（${legacyLogPath}）: ${err instanceof Error ? err.message : String(err)}`,
    );
    content = '';
  }
  if (content.includes(DAEMON_LOG_TOMBSTONE)) {
    return { written: false, reason: 'already-present' };
  }

  try {
    mkdirSync(dirname(legacyLogPath), { recursive: true });
    const prefix = content === '' || content.endsWith('\n') ? '' : '\n';
    appendFileSync(legacyLogPath, `${prefix}${DAEMON_LOG_TOMBSTONE}\n`, 'utf-8');
    return { written: true, reason: 'written' };
  } catch (err) {
    // 写失败不阻断启动（下次启动重试）——但必须留痕
    console.warn(
      `[daemon-log-channel] 写 tombstone 失败（${legacyLogPath}）: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { written: false, reason: 'channel-active' };
  }
}
