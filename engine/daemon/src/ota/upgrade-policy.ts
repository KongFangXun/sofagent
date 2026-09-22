// ============================================================
// upgrade-policy.ts · G12 设备 OTA 升级策略解析 + 挂起队列持久化（v1.5.1 第四章）
// ============================================================
//
// 本文件只做两件事（执行面归 upgrade-executor.ts）：
//   1. 策略解析与判定——设备侧配置「升级窗口」（业务低峰时段执行；窗口外
//      挂起等待）+「手动确认模式」（高风险版本需设备侧 HITL 确认）。
//   2. 挂起队列 / 版本清单 / 待投递任务的持久化——「窗口外 / 离线设备挂起，
//      恢复后自动补升」与第五章「离线回落，上线补收不丢」的状态载体。
//
// fail-closed 语义（铁律 4）：
//   - 策略文件存在但解析失败 → 判定为 policy-invalid → **挂起**（不放行执行），
//     与「无策略」区分——无策略 = 设备未配置窗口，按可执行放行（缺省低摩擦）；
//     坏策略 = 配置异常，宁可挂起等人工，不猜。
//   - 窗口边界含端点（start ≤ now < end；跨午夜窗口 start > end 自动按两段判定）。
//
// 注册点：本模块无自注册面——持久化文件路径由 OTA_STATE_FILE / OTA_POLICY_FILE
// 常量钉死，消费方为 upgrade-executor.ts 与 subscriptions.ts。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { getDataDir } from '@sofagent/core';
import type { DeviceUpgradePayload } from './upgrade-executor';

/** 设备侧升级策略文件名（<dataDir>/ota-policy.json） */
export const OTA_POLICY_FILE = 'ota-policy.json';

/** OTA 状态文件名（<dataDir>/ota/state.json——挂起队列 + 版本清单 + 待投递任务） */
export const OTA_STATE_FILE = 'ota/state.json';

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 升级窗口（本地时间；支持跨午夜与按星期限定） */
export interface UpgradeWindow {
  /** 窗口开始（'HH:MM'，本地时间） */
  start: string;
  /** 窗口结束（'HH:MM'，本地时间；小于 start = 跨午夜窗口） */
  end: string;
  /** 生效星期（0=周日 … 6=周六；缺省每日） */
  days?: number[];
}

/** 设备侧升级策略（解析产物） */
export interface UpgradePolicy {
  /** 解析是否成功（fail-closed：false → 判定 policy-invalid → 挂起） */
  valid: boolean;
  /** 解析问题清单（valid=false 时有值） */
  issues?: string[];
  /** 升级窗口（缺省 = 无窗口限制） */
  window?: UpgradeWindow;
  /** 全量手动确认模式（true = 所有版本升级都需设备侧确认） */
  manualConfirm?: boolean;
  /** 仅高风险版本需手动确认（manualConfirm=true 时本项无意义） */
  manualConfirmHighRisk?: boolean;
}

/** 策略判定原因（可解释——进审计证据） */
export type PolicyVerdictReason =
  | 'no-policy'
  | 'in-window'
  | 'out-of-window'
  | 'manual-confirm-required'
  | 'policy-invalid';

/** 策略判定结果 */
export interface PolicyVerdict {
  /** 是否允许立即执行（false = 挂起等待） */
  allowed: boolean;
  reason: PolicyVerdictReason;
  /** 人读说明（进审计 evidence / 挂起理由） */
  message: string;
}

/** 挂起原因（窗口外 / 离线 / 待人工确认 / 截止窗口已过 / 策略异常） */
export type SuspensionReason =
  | 'out-of-window'
  | 'offline'
  | 'manual-confirm-required'
  | 'deadline-exceeded'
  | 'policy-invalid';

/** 挂起的升级指令（恢复后自动补升的载体） */
export interface SuspendedUpgrade {
  deviceId: string;
  targetVersion: string;
  payload: DeviceUpgradePayload;
  reason: SuspensionReason;
  suspendedAt: string;
}

/** 挂起的任务投递（第五章：离线回落，上线补投不丢） */
export interface PendingTaskDispatch {
  deviceId: string;
  task: { title: string; payload: string; dispatchedBy: string };
  /** 挂起原因（当前仅 device-offline——推送不可达且心跳离线） */
  reason: 'device-offline';
  suspendedAt: string;
}

/** 单设备 OTA 状态 */
export interface DeviceOtaState {
  /** 当前组件版本清单（升级成功后更新——版本清单上报的数据源） */
  components: Record<string, string>;
  /** 最近一次升级结果（upgraded / rolled-back / rejected） */
  lastOutcome?: string;
  /** 最近一次升级时间（ISO 8601） */
  lastUpgradeAt?: string;
  /** 最近一次目标版本 */
  lastTargetVersion?: string;
}

/** OTA 状态文件结构 */
export interface OtaStateFile {
  version: 1;
  /** 设备 → OTA 状态 */
  devices: Record<string, DeviceOtaState>;
  /** 挂起中的升级指令（恢复后自动补升） */
  suspended: SuspendedUpgrade[];
  /** 挂起中的任务投递（上线后补投进 G9 心跳捎带队列） */
  pendingDispatches: PendingTaskDispatch[];
}

// ────────────────────────────────────────────────────────────
// 时钟解析（纯函数——可独立测试）
// ────────────────────────────────────────────────────────────

/**
 * 'HH:MM' → 当日分钟数。
 *
 * @returns 0..1439；非法格式（非 HH:MM / 越界）返回 null（fail-closed）
 */
export function parseClockMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * 判定给定时刻是否落在升级窗口内（纯函数）。
 *
 * 语义：
 *   - days 限定（缺省每日）——当日星期不在 days 内 → 窗口外；
 *   - start ≤ end：当日 [start, end) 单段；
 *   - start > end（跨午夜）：[start, 24:00) ∪ [00:00, end) 两段。
 */
export function isWithinWindow(window: UpgradeWindow, now: Date): boolean {
  const start = parseClockMinutes(window.start);
  const end = parseClockMinutes(window.end);
  // 窗口字段非法 → 视为窗口外（fail-closed：不放行）
  if (start === null || end === null) return false;
  const day = now.getDay();
  if (Array.isArray(window.days) && window.days.length > 0 && !window.days.includes(day)) {
    return false;
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (start <= end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

// ────────────────────────────────────────────────────────────
// 策略解析 / 判定
// ────────────────────────────────────────────────────────────

/**
 * 解析策略原始对象（容错但 fail-closed）。
 *
 * @param raw 策略原始对象（来自 <dataDir>/ota-policy.json 或注入）
 * @returns 解析产物；字段非法时 valid=false 且 issues 列明（判定侧挂起）
 */
export function resolveUpgradePolicy(raw: unknown): UpgradePolicy {
  if (raw === undefined || raw === null) return { valid: true };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, issues: ['策略必须是对象'], };
  }
  const src = raw as Record<string, unknown>;
  const issues: string[] = [];
  let window: UpgradeWindow | undefined;

  if (src['window'] !== undefined) {
    const w = src['window'];
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      issues.push('window 必须是对象');
    } else {
      const ws = w as Record<string, unknown>;
      if (parseClockMinutes(ws['start']) === null) issues.push(`window.start 非法：${String(ws['start'])}（须 HH:MM）`);
      if (parseClockMinutes(ws['end']) === null) issues.push(`window.end 非法：${String(ws['end'])}（须 HH:MM）`);
      if (ws['days'] !== undefined) {
        if (!Array.isArray(ws['days']) || ws['days'].some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
          issues.push('window.days 非法（须 0..6 整数数组）');
        }
      }
      if (issues.length === 0) {
        window = {
          start: String(ws['start']),
          end: String(ws['end']),
          ...(Array.isArray(ws['days']) ? { days: ws['days'] as number[] } : {}),
        };
      }
    }
  }
  if (src['manualConfirm'] !== undefined && typeof src['manualConfirm'] !== 'boolean') {
    issues.push('manualConfirm 必须是布尔');
  }
  if (src['manualConfirmHighRisk'] !== undefined && typeof src['manualConfirmHighRisk'] !== 'boolean') {
    issues.push('manualConfirmHighRisk 必须是布尔');
  }
  if (issues.length > 0) return { valid: false, issues };
  return {
    valid: true,
    ...(window ? { window } : {}),
    ...(typeof src['manualConfirm'] === 'boolean' ? { manualConfirm: src['manualConfirm'] } : {}),
    ...(typeof src['manualConfirmHighRisk'] === 'boolean'
      ? { manualConfirmHighRisk: src['manualConfirmHighRisk'] }
      : {}),
  };
}

/** 策略文件路径（<dataDir>/ota-policy.json） */
export function otaPolicyPath(dataDir?: string): string {
  return path.join(getDataDir(dataDir), OTA_POLICY_FILE);
}

/** 读设备侧策略（文件不存在 → 无窗口无确认的缺省策略；损坏 → valid=false 挂起） */
export function loadUpgradePolicy(dataDir?: string): UpgradePolicy {
  const p = otaPolicyPath(dataDir);
  if (!fs.existsSync(p)) return { valid: true };
  try {
    return resolveUpgradePolicy(JSON.parse(fs.readFileSync(p, 'utf-8')));
  } catch (err) {
    return { valid: false, issues: [`策略文件解析失败：${err instanceof Error ? err.message : String(err)}`] };
  }
}

/**
 * 高风险版本判定（手动确认模式的触发判据，纯函数）。
 *
 * 判据（两取一，任一命中即高风险）：
 *   - 预发布标记：版本串含 `-alpha` / `-beta` / `-rc` / `-canary`；
 *   - 主版本号为 0（0.x 未定型版本）。
 */
export function isHighRiskVersion(targetVersion: string): boolean {
  if (typeof targetVersion !== 'string') return false;
  // 预发布标记须出现在连字符后（semver 惯例）——避免把普通版本号误判为高风险
  if (/-(?:alpha|beta|rc|canary)(?:[.\d]|$)/i.test(targetVersion.trim())) return true;
  const m = /^(\d+)\./.exec(targetVersion.trim().replace(/^v/, ''));
  return m ? Number(m[1]) === 0 : false;
}

/**
 * 策略判定（纯函数——判定侧唯一入口）。
 *
 * @param policy 策略
 * @param ctx.now 判定时刻（本地时区用于窗口比较）
 * @param ctx.targetVersion 目标版本（高风险判定用）
 * @param ctx.manualConfirmed 设备侧是否已完成人工确认
 */
export function evaluateUpgradePolicy(
  policy: UpgradePolicy,
  ctx: { now: Date; targetVersion?: string; manualConfirmed?: boolean },
): PolicyVerdict {
  if (!policy.valid) {
    return {
      allowed: false,
      reason: 'policy-invalid',
      message: `升级策略非法，挂起等待人工处置：${(policy.issues ?? []).join('；')}`,
    };
  }
  const needsConfirm =
    policy.manualConfirm === true ||
    (policy.manualConfirmHighRisk === true && isHighRiskVersion(ctx.targetVersion ?? ''));
  if (needsConfirm && ctx.manualConfirmed !== true) {
    return {
      allowed: false,
      reason: 'manual-confirm-required',
      message: `手动确认模式：版本 ${ctx.targetVersion ?? 'unknown'} 需设备侧人工确认后方可执行`,
    };
  }
  if (!policy.window) {
    return { allowed: true, reason: 'no-policy', message: '未配置升级窗口，按即时执行放行' };
  }
  if (!isWithinWindow(policy.window, ctx.now)) {
    return {
      allowed: false,
      reason: 'out-of-window',
      message: `当前时刻不在升级窗口内（窗口 ${policy.window.start}-${policy.window.end}），挂起等待窗口开启`,
    };
  }
  return {
    allowed: true,
    reason: 'in-window',
    message: `当前时刻在升级窗口内（${policy.window.start}-${policy.window.end}）`,
  };
}

// ────────────────────────────────────────────────────────────
// 状态持久化（挂起队列 + 版本清单 + 待投递任务）
// ────────────────────────────────────────────────────────────

/** 状态文件路径（<dataDir>/ota/state.json） */
export function otaStatePath(dataDir?: string): string {
  return path.join(getDataDir(dataDir), OTA_STATE_FILE);
}

/** 空状态 */
function emptyState(): OtaStateFile {
  return { version: 1, devices: {}, suspended: [], pendingDispatches: [] };
}

/** 读 OTA 状态（文件不存在 / 损坏 → 空态——读取面 fail-open，写入侧严格） */
export function loadOtaState(dataDir?: string): OtaStateFile {
  const p = otaStatePath(dataDir);
  if (!fs.existsSync(p)) return emptyState();
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as OtaStateFile;
    if (raw && typeof raw === 'object' && raw.devices && Array.isArray(raw.suspended) && Array.isArray(raw.pendingDispatches)) {
      return raw;
    }
  } catch {
    /* 为何可静默：状态文件损坏按空态 fail-open——读取面损坏不阻断升级流程；写入侧仍严格报错 */
  }
  return emptyState();
}

/** 写 OTA 状态（目录 0o700 / 文件 0o600——对齐本仓审计纪律） */
export function saveOtaState(state: OtaStateFile, dataDir?: string): void {
  const p = otaStatePath(dataDir);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* 为何可静默：非 POSIX 平台（Windows）无 chmod 语义，权限收紧尽力而为，失败不阻断写入主流程 */
  }
}

/** 挂起一条升级指令（窗口外 / 离线 / 待确认 / 已过截止——同设备同目标版本去重） */
export function suspendUpgrade(entry: SuspendedUpgrade, dataDir?: string): void {
  const state = loadOtaState(dataDir);
  state.suspended = state.suspended.filter(
    (s) => !(s.deviceId === entry.deviceId && s.targetVersion === entry.targetVersion),
  );
  state.suspended.push(entry);
  saveOtaState(state, dataDir);
}

/** 列出挂起中的升级指令（可按设备过滤） */
export function listSuspendedUpgrades(deviceId?: string, dataDir?: string): SuspendedUpgrade[] {
  const all = loadOtaState(dataDir).suspended;
  return deviceId ? all.filter((s) => s.deviceId === deviceId) : all;
}

/** 清除挂起项（升级已执行 / 设备已吊销 / 人工取消） */
export function clearSuspendedUpgrade(deviceId: string, targetVersion: string, dataDir?: string): void {
  const state = loadOtaState(dataDir);
  const before = state.suspended.length;
  state.suspended = state.suspended.filter(
    (s) => !(s.deviceId === deviceId && s.targetVersion === targetVersion),
  );
  if (state.suspended.length !== before) saveOtaState(state, dataDir);
}

/** 记录设备当前组件版本清单 + 最近升级结果（升级成功 / 回滚后均调用） */
export function recordDeviceVersions(
  deviceId: string,
  components: Record<string, string>,
  meta: { outcome: string; targetVersion: string; at: string },
  dataDir?: string,
): void {
  const state = loadOtaState(dataDir);
  state.devices[deviceId] = {
    components,
    lastOutcome: meta.outcome,
    lastUpgradeAt: meta.at,
    lastTargetVersion: meta.targetVersion,
  };
  saveOtaState(state, dataDir);
}

/** 读设备当前组件版本清单（版本清单上报的数据源；未记录 → 空对象） */
export function getDeviceVersions(deviceId: string, dataDir?: string): Record<string, string> {
  return loadOtaState(dataDir).devices[deviceId]?.components ?? {};
}

/** 挂起一条任务投递（第五章：设备心跳离线，推送不可达——上线后补投） */
export function holdTaskDispatch(entry: PendingTaskDispatch, dataDir?: string): void {
  const state = loadOtaState(dataDir);
  state.pendingDispatches.push(entry);
  saveOtaState(state, dataDir);
}

/** 取走某设备的挂起任务投递（清空该设备条目——补投后调用） */
export function takeHeldTaskDispatches(deviceId: string, dataDir?: string): PendingTaskDispatch[] {
  const state = loadOtaState(dataDir);
  const mine = state.pendingDispatches.filter((p) => p.deviceId === deviceId);
  if (mine.length === 0) return [];
  state.pendingDispatches = state.pendingDispatches.filter((p) => p.deviceId !== deviceId);
  saveOtaState(state, dataDir);
  return mine;
}

/** 列出挂起中的任务投递（巡检 / 测试对账用） */
export function listHeldTaskDispatches(deviceId?: string, dataDir?: string): PendingTaskDispatch[] {
  const all = loadOtaState(dataDir).pendingDispatches;
  return deviceId ? all.filter((p) => p.deviceId === deviceId) : all;
}
