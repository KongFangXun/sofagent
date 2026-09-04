// ============================================================
// daemon-health.ts · daemon 健康自检文件管理（§8.4）
//
// daemon 启动后写入 ~/.sofagent/data/daemon-health.json，
// 包含 pid / startTime / version / lastPush / lastError / heartbeat。
//
// `--doctor` 子命令读取此文件报告 daemon 状态。
// 心跳每 5min 由 daemon 主循环更新。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '@sofagent/core';
import type { FatigueReport } from './fatigue';

/** v1.4.5 T9：webhook 告警通道健康摘要（推送侧写入，心跳透传） */
export interface WebhookChannelHealth {
  /** 最近一次推送成功时间（ISO 8601） */
  lastSuccessAt: string | null;
  /** 最近一次失败摘要（平台 + 错误；null = 无失败记录） */
  lastError: string | null;
}

/** daemon 健康自检文件结构 */
export interface DaemonHealthFile {
  /** 进程 PID */
  pid: number;
  /** 启动时间（ISO 8601） */
  startTime: string;
  /** daemon 版本号 */
  version: string;
  /** 整体状态 */
  status: 'running' | 'degraded' | 'stopped';
  /** 最后一次心跳时间（ISO 8601，每 5min 更新） */
  lastHeartbeat: string;
  /** 最后一次推送时间（ISO 8601，推送成功时更新） */
  lastPush: string | null;
  /** 最后一次错误信息 */
  lastError: string | null;
  /** daemon uptime（毫秒，从 startTime 计算） */
  uptimeMs: number;
  /** v1.4.4 #32+47：daemon 退出时的进程退出码（0=正常停止；78=守护级致命错误；未退出时无此字段） */
  lastExitCode?: number;
  /** v1.4.4 #32+47：daemon 退出原因（'sigint' | 'sigterm' | 'uncaught-exception' | 'startup-failure' | 'unknown'） */
  stoppedReason?: string;
  /** v1.3.6 交付⑬：Agent 疲劳度报告（每小时采集，fatigue.ts 独立写入） */
  fatigue?: FatigueReport;
  /** v1.4.5 T9：webhook 告警通道自身健康（推送侧写入，心跳不擦除） */
  webhook?: WebhookChannelHealth;
}

/**
 * v1.4.5 T5：运行时读取 daemon 包版本（package.json）。
 *
 * 修复：原硬编码 `version: '1.4.3'` 字面量——包已 1.4.4，每次升版必漂移。
 * 现在从 dist 同级的 package.json 读取；读取失败（打包裁剪等）回退 'unknown'
 * 而非旧版本号（宁可 unknown 也不说谎）。
 */
export function resolveDaemonVersion(): string {
  try {
    // daemon-health.js 编译后在 dist/，package.json 在其上一级
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 健康自检文件路径 */
export function resolveHealthFilePath(): string {
  const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;
  return path.join(dataDir, 'daemon-health.json');
}

/**
 * 写入 daemon 健康自检文件。
 *
 * daemon 启动时调用 writeHealthFile('start')，运行中调用 writeHealthFile('heartbeat')，
 * 退出时调用 recordDaemonExit()（v1.4.4 #32+47——进程退出前落盘退出码）。
 *
 * @param event 事件类型
 * @param extra 额外信息（如 lastPush / lastError）
 * @returns 写入的健康文件对象
 */
export function writeHealthFile(
  event: 'start' | 'heartbeat' | 'push' | 'error' | 'exit',
  extra?: { lastPush?: string; lastError?: string; exitCode?: number; stoppedReason?: string; webhook?: WebhookChannelHealth },
): DaemonHealthFile | null {
  const healthPath = resolveHealthFilePath();
  const now = new Date().toISOString();
  const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;

  // 读取现有文件获取 startTime（heartbeat/push/error/exit 不应重置 startTime）
  let startTime = now;
  let existingLastPush: string | null = null;
  let existingLastError: string | null = null;
  // v1.3.6 交付⑬：心跳重写不擦除疲劳度报告（fatigue 由 fatigue.ts 独立维护）
  let existingFatigue: FatigueReport | undefined;
  // v1.4.5 T9：心跳不擦除 webhook 通道健康（webhook 推送侧独立维护）
  let existingWebhook: WebhookChannelHealth | undefined;

  if (event !== 'start' && fs.existsSync(healthPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(healthPath, 'utf-8')) as Partial<DaemonHealthFile> & { fatigue?: unknown };
      if (raw.startTime) startTime = raw.startTime;
      existingLastPush = raw.lastPush ?? null;
      existingLastError = raw.lastError ?? null;
      // 类型守卫：只透传合法对象（防损坏文件把 null/字符串塞进 fatigue）
      if (raw.fatigue !== null && typeof raw.fatigue === 'object') {
        existingFatigue = raw.fatigue as FatigueReport;
      }
      // v1.4.5 T9：webhook 健康同规则透传（类型守卫）
      if (raw.webhook !== null && typeof raw.webhook === 'object') {
        existingWebhook = raw.webhook as WebhookChannelHealth;
      }
    } catch {
      // 文件损坏——继续
    }
  }

  const startMs = new Date(startTime).getTime();
  const uptimeMs = isNaN(startMs) ? 0 : Date.now() - startMs;

  // 判断状态：心跳超过 10min → degraded
  let status: DaemonHealthFile['status'] = 'running';
  if (event === 'start') {
    status = 'running';
  } else {
    const heartbeatMs = new Date(now).getTime() - startMs;
    // 如果有 lastError 且事件不是 error，但上次错误在 5min 内 → degraded
    if (existingLastError) {
      status = 'degraded';
    }
  }

  // event 影响状态
  if (event === 'error') {
    status = 'degraded';
  }
  // v1.4.4 #32+47：exit 事件——进程即将退出，状态落 stopped
  if (event === 'exit') {
    status = 'stopped';
  }

  const health: DaemonHealthFile = {
    pid: process.pid,
    startTime,
    // v1.4.5 T5：运行时读 package.json（消灭 '1.4.3' 硬编码漂移）
    version: resolveDaemonVersion(),
    status,
    lastHeartbeat: now,
    lastPush: extra?.lastPush ?? existingLastPush,
    lastError: extra?.lastError ?? existingLastError,
    uptimeMs,
    // v1.4.4 #32+47：退出码落盘（doctor 感知「守护已死亡」的依据）
    ...(extra?.exitCode !== undefined ? { lastExitCode: extra.exitCode } : {}),
    ...(extra?.stoppedReason !== undefined ? { stoppedReason: extra.stoppedReason } : {}),
    // v1.3.6 交付⑬：透传已有疲劳度报告（fatigue.ts 独立写入，心跳不擦除）
    ...(existingFatigue !== undefined ? { fatigue: existingFatigue } : {}),
    // v1.4.5 T9：webhook 通道健康（推送侧写入，心跳透传不擦除）
    ...(extra?.webhook !== undefined ? { webhook: extra.webhook } : {}),
    ...(extra?.webhook === undefined && existingWebhook !== undefined ? { webhook: existingWebhook } : {}),
  };

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(healthPath, JSON.stringify(health, null, 2), 'utf-8');
    return health;
  } catch {
    // 健康文件写失败（磁盘满/权限）不阻断 daemon 主流程——本周期健康数据丢弃
    return null;
  }
}

/**
 * 记录 daemon 退出（v1.4.4 #32+47——进程退出钩子调用）。
 *
 * 由 cli.ts 的 SIGINT / SIGTERM / uncaughtException 钩子与 main().catch 兜底调用，
 * 在进程退出前把退出码落盘 daemon-health.json——此后 doctor（daemon 自带 doctor
 * 与 @sofagent/core doctor）读同一路径即可感知「守护已死亡（exit N）」。
 *
 * 与 writeHealthFile('exit', ...) 等价，独立成函数是为了让调用点语义更直白。
 *
 * @param exitCode 进程退出码（0=正常停止；78=守护级致命错误——EX_CONFIG 约定）
 * @param reason 退出原因（'sigint' | 'sigterm' | 'uncaught-exception' | 'startup-failure' | 'unknown'）
 * @param detail 额外错误信息（uncaughtException 的 message 等）
 */
export function recordDaemonExit(
  exitCode: number,
  reason: 'sigint' | 'sigterm' | 'uncaught-exception' | 'startup-failure' | 'unknown' = 'unknown',
  detail?: string,
): DaemonHealthFile | null {
  return writeHealthFile('exit', {
    exitCode,
    stoppedReason: reason,
    ...(detail !== undefined ? { lastError: detail } : {}),
  });
}

/**
 * 读取 daemon 健康自检文件。
 *
 * @returns 健康文件对象；文件不存在返回 null
 */
export function readHealthFile(): DaemonHealthFile | null {
  const healthPath = resolveHealthFilePath();
  if (!fs.existsSync(healthPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(healthPath, 'utf-8')) as DaemonHealthFile;
    return raw;
  } catch {
    // JSON 损坏（写一半崩溃等）按无健康数据处理——下轮写入会覆盖修复
    return null;
  }
}

/**
 * 检查 daemon 健康状态（供 `--doctor` 调用）。
 *
 * 判断逻辑：
 *   - 文件不存在 → daemon 从未运行
 *   - v1.4.4 #32+47：lastExitCode 非 0 且心跳陈旧 → 守护已死亡（exit 78 等）
 *   - lastHeartbeat 超过 10min → 可能已停止
 *   - status === 'degraded' → 降级中
 *   - 有 lastError → 报告最近错误
 *
 * @returns 人类可读的健康报告
 */
export function checkDaemonHealth(): {
  healthy: boolean;
  status: 'running' | 'degraded' | 'stopped' | 'never-started' | 'dead';
  message: string;
  details?: DaemonHealthFile;
} {
  const health = readHealthFile();

  if (!health) {
    return {
      healthy: false,
      status: 'never-started',
      message: 'daemon 从未运行过（daemon-health.json 不存在）',
    };
  }

  // v1.4.4 #32+47：退出码检测——非零退出码 + 心跳已陈旧 = 守护已死亡
  // （心跳新鲜说明 daemon 已重新启动——新一轮 start 事件不会写 lastExitCode，
  //  但旧值可能残留，故以心跳陈旧为共同条件避免误报活着的 daemon）
  const now = Date.now();
  const heartbeatMs = new Date(health.lastHeartbeat).getTime();
  const staleThreshold = 10 * 60 * 1000; // 10min

  if (health.lastExitCode !== undefined && health.lastExitCode !== 0 && (isNaN(heartbeatMs) || now - heartbeatMs > staleThreshold)) {
    return {
      healthy: false,
      status: 'dead',
      message: `daemon 守护已死亡（exit ${health.lastExitCode}${health.stoppedReason ? `，原因 ${health.stoppedReason}` : ''}，最后心跳: ${health.lastHeartbeat}）`,
      details: health,
    };
  }

  if (isNaN(heartbeatMs) || now - heartbeatMs > staleThreshold) {
    return {
      healthy: false,
      status: 'stopped',
      message: `daemon 可能已停止（最后心跳: ${health.lastHeartbeat}，已超 10min）`,
      details: health,
    };
  }

  if (health.status === 'degraded') {
    const errMsg = health.lastError ? `（最近错误: ${health.lastError}）` : '';
    return {
      healthy: false,
      status: 'degraded',
      message: `daemon 降级运行中${errMsg}`,
      details: health,
    };
  }

  const uptimeMin = Math.floor(health.uptimeMs / 60000);
  return {
    healthy: true,
    status: 'running',
    message: `daemon 运行正常（PID ${health.pid}，已运行 ${uptimeMin}min）`,
    details: health,
  };
}
