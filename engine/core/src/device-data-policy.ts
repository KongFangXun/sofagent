// ============================================================
// device-data-policy.ts · G10 设备侧数据面授权读取（v1.5.3 T2）
// ============================================================
//
// 平台从设备「拉」数据的授权边界：设备数据目录白名单。
//
// 设计决策（任务书 §二 T2 + changelog 二章）：
//   - 目录白名单默认空 = 全拒（opt-in 模型，fail-closed 铁律 4）：
//     配置文件不存在 / 损坏 / 字段非法 → 一律按空清单处理 = 拒绝
//     一切读取。放行是显式配置的结果，拒绝是缺省态。
//   - 白名单是「设备目录级」授权（G6 visibility 管节点级，本文件管
//     目录级——两层正交不合并）。
//   - 路径匹配语义：目录前缀 + 边界字符匹配。requestedPath 命中
//     allowedDir 当且仅当 requestedPath === allowedDir 或
//     requestedPath.startsWith(allowedDir + path.sep)——防止
//     「/data-secret」借「/data」前缀绕过（边界字符攻击面）。
//   - 本文件只做策略判定（纯函数面 + 配置读写），不读用户文件内容、
//     不脱敏、不审计——那些是调用链下游（mcp tool 层）的职责。
//     策略层保持零副作用，独立可测。
//   - 配置落 <dataDir>/config/device-data-policy.json（结构化 JSON，
//     与 redact-rules.json 同目录惯例），由 FDE 交付时声明。
//
// 与 T3（device-upload-policy.ts）的同源纪律：判定语义一致（默认空=
// 拒绝）、配置形态一致（version + deviceId + 清单）、fail-closed 分支
// 一致——两文件是「拉 / 推」两个方向各一份最小策略面。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join, sep } from 'path';
import { getDataDir } from './data-paths';

/** 数据面策略配置文件相对路径（<dataDir>/config/device-data-policy.json） */
export const DEVICE_DATA_POLICY_FILE = 'config/device-data-policy.json';

/** 设备数据目录白名单配置（config/device-data-policy.json 顶层结构） */
export interface DeviceDataPolicyConfig {
  /** 配置版本（格式演进预留） */
  version: number;
  /** 策略归属设备（deviceId = AgentIdentity.agentId） */
  deviceId: string;
  /** 可暴露的数据目录清单（绝对路径或相对 dataDir 的路径；空 = 全拒） */
  allowedDirs: string[];
}

/** 读取授权判定结果（fail-closed 语义显式化） */
export interface DeviceReadAuthResult {
  /** true = 放行（白名单内） */
  ok: boolean;
  /** 拒绝原因（ok=false 时有值） */
  reason?: 'empty-policy' | 'device-not-in-policy' | 'path-not-allowed' | 'invalid-params';
  /** 命中的白名单目录（ok=true 时有值——审计留痕用「依据什么授权」） */
  allowedDir?: string;
  message: string;
}

/**
 * 路径规范化：去尾部分隔符 + 保留原样（不做 resolve/normalize 的
 * symlink 收敛——策略层只做字符串边界匹配，realpath 校验归调用方
// 的读文件层，避免策略层隐式 fs 依赖）。
 */
export function normalizeDirPath(dir: string): string {
  let out = dir;
  while (out.length > 1 && out.endsWith(sep)) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * 判定 requestedPath 是否落在 allowedDir 授权范围内（纯函数）。
 *
 * 匹配语义：相等或以 allowedDir + 分隔符 为前缀——
 *   isPathAllowed('/data/a.txt', ['/data'])       → true
 *   isPathAllowed('/data', ['/data'])             → true（目录本体）
 *   isPathAllowed('/data-secret/a', ['/data'])    → false（边界字符防绕过）
 *   isPathAllowed('/data', [])                    → false（空清单全拒）
 */
export function isPathAllowed(requestedPath: string, allowedDirs: string[]): boolean {
  if (!requestedPath || !Array.isArray(allowedDirs) || allowedDirs.length === 0) {
    return false;
  }
  const req = normalizeDirPath(requestedPath);
  for (const raw of allowedDirs) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const dir = normalizeDirPath(raw);
    if (req === dir || req.startsWith(dir + sep)) {
      return true;
    }
  }
  return false;
}

/** 策略文件路径（<dataDir>/config/device-data-policy.json） */
export function deviceDataPolicyPath(dataDir?: string): string {
  return join(getDataDir(dataDir), DEVICE_DATA_POLICY_FILE);
}

/**
 * 读取设备数据面白名单配置。
 *
 * fail-closed（铁律 4）：文件不存在 / JSON 损坏 / 结构非法 → 返回 null
 * （调用方按「无策略 = 全拒」处理）。损坏时 console.warn 留证（不静默
 * ——与 long-tasks 注册表损坏告警同纪律），但不抛异常（策略读取失败
 * 不阻断服务启动，只阻断读取放行）。
 */
export function loadDeviceDataPolicy(dataDir?: string): DeviceDataPolicyConfig | null {
  const p = deviceDataPolicyPath(dataDir);
  if (!existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'));
  } catch (err) {
    console.warn(
      `[device-data-policy] 配置损坏（${p}）：${err instanceof Error ? err.message : String(err)}——按空策略处理（全拒）`,
    );
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const cfg = raw as Partial<DeviceDataPolicyConfig>;
  if (typeof cfg.deviceId !== 'string' || cfg.deviceId.length === 0) return null;
  if (!Array.isArray(cfg.allowedDirs)) return null;
  // 目录条目类型过滤（坏条目剔除，不整表丢弃——同 long-tasks 纪律）
  const allowedDirs = cfg.allowedDirs.filter((d): d is string => typeof d === 'string' && d.length > 0);
  return {
    version: typeof cfg.version === 'number' ? cfg.version : 1,
    deviceId: cfg.deviceId,
    allowedDirs,
  };
}

/**
 * 写入设备数据面白名单配置（FDE 声明面 / 运维增删）。
 * 目录 0o700 / 文件 0o600（白名单本身是安全配置面——权限收紧）。
 */
export function saveDeviceDataPolicy(config: DeviceDataPolicyConfig, dataDir?: string): void {
  const p = deviceDataPolicyPath(dataDir);
  const dir = join(p, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
  try {
    chmodSync(p, 0o600);
  } catch {
    /* 为何可静默：非 POSIX 平台（Windows）无 chmod 语义，0o600 权限收紧为尽力而为，失败不阻断写入主流程 */
  }
}

/**
 * 读取授权判定（G10 核心——验收 ①②）。
 *
 * 判定顺序（fail-closed 逐层收口）：
 *   1. 参数缺失 → invalid-params
 *   2. 无策略文件 / 策略损坏 → empty-policy（默认空 = 全拒）
 *   3. 策略不归属该设备 → device-not-in-policy（单文件单设备——
 *      多设备各持一份配置，deviceId 显式绑定，防串设备放行）
 *   4. 路径不在白名单 → path-not-allowed（含前缀绕过攻击面）
 *
 * 本函数不读文件内容、不审计——纯策略判定。审计在调用链下游
 * （mcp tool 层 emitDecision，「依据什么授权」取 allowedDir 字段）。
 */
export function authorizeDeviceRead(
  deviceId: string,
  requestedPath: string,
  dataDir?: string,
): DeviceReadAuthResult {
  if (!deviceId || typeof deviceId !== 'string' || !requestedPath || typeof requestedPath !== 'string') {
    return { ok: false, reason: 'invalid-params', message: 'deviceId / path 参数缺失' };
  }
  const policy = loadDeviceDataPolicy(dataDir);
  if (!policy) {
    return { ok: false, reason: 'empty-policy', message: '数据面白名单为空（默认全拒，opt-in）' };
  }
  if (policy.deviceId !== deviceId) {
    return { ok: false, reason: 'device-not-in-policy', message: '策略不归属该设备（deviceId 不匹配）' };
  }
  const matched = policy.allowedDirs.find((raw) => {
    const dir = normalizeDirPath(raw);
    const req = normalizeDirPath(requestedPath);
    return req === dir || req.startsWith(dir + sep);
  });
  if (!matched) {
    return { ok: false, reason: 'path-not-allowed', message: `路径不在白名单内：${requestedPath}` };
  }
  return { ok: true, allowedDir: normalizeDirPath(matched), message: '白名单内放行' };
}
