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
}

/** 健康自检文件路径 */
export function resolveHealthFilePath(): string {
  const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;
  return path.join(dataDir, 'daemon-health.json');
}

/**
 * 写入 daemon 健康自检文件。
 *
 * daemon 启动时调用 writeHealthFile('start')，运行中调用 writeHealthFile('heartbeat')。
 *
 * @param event 事件类型
 * @param extra 额外信息（如 lastPush / lastError）
 * @returns 写入的健康文件对象
 */
export function writeHealthFile(
  event: 'start' | 'heartbeat' | 'push' | 'error',
  extra?: { lastPush?: string; lastError?: string },
): DaemonHealthFile | null {
  const healthPath = resolveHealthFilePath();
  const now = new Date().toISOString();
  const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;

  // 读取现有文件获取 startTime（heartbeat/push/error 不应重置 startTime）
  let startTime = now;
  let existingLastPush: string | null = null;
  let existingLastError: string | null = null;

  if (event !== 'start' && fs.existsSync(healthPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(healthPath, 'utf-8')) as Partial<DaemonHealthFile>;
      if (raw.startTime) startTime = raw.startTime;
      existingLastPush = raw.lastPush ?? null;
      existingLastError = raw.lastError ?? null;
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

  const health: DaemonHealthFile = {
    pid: process.pid,
    startTime,
    version: '1.2.5',
    status,
    lastHeartbeat: now,
    lastPush: extra?.lastPush ?? existingLastPush,
    lastError: extra?.lastError ?? existingLastError,
    uptimeMs,
  };

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(healthPath, JSON.stringify(health, null, 2), 'utf-8');
    return health;
  } catch {
    return null;
  }
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
    return null;
  }
}

/**
 * 检查 daemon 健康状态（供 `--doctor` 调用）。
 *
 * 判断逻辑：
 *   - 文件不存在 → daemon 从未运行
 *   - lastHeartbeat 超过 10min → 可能已停止
 *   - status === 'degraded' → 降级中
 *   - 有 lastError → 报告最近错误
 *
 * @returns 人类可读的健康报告
 */
export function checkDaemonHealth(): {
  healthy: boolean;
  status: 'running' | 'degraded' | 'stopped' | 'never-started';
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

  const now = Date.now();
  const heartbeatMs = new Date(health.lastHeartbeat).getTime();
  const staleThreshold = 10 * 60 * 1000; // 10min

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
