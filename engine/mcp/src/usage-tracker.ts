// ============================================================
// usage-tracker.ts · MCP tool 调用使用率遥测（v1.5.8 章四）
//
// 每次 tool 调用追加一行到 {dataDir}/tool-usage.jsonl。
//
// 🔐 隐私红线（devlog 章四原文）：
//   字段仅 schemaVersion + tool 名 + ISO 时间戳 + 会话标识 + status + durationMs——
//   **不含调用参数与结果内容**。纯本地存储、零网络上报路径
//   （对齐数据主权铁律「记忆/日志/决策记录永不离开本地」）。
//
// status / durationMs（v1.5.7 章四发版前 delta）：调用成败与耗时是**元数据非内容**——
//   只有频次时「调用千次皆失败」与「千次皆成功」同形，不足以支撑退役/加码决策；
//   补两字段后成功率与耗时分布可见。同版未发版 ⇒ schemaVersion 不升、无迁移。
//
// schemaVersion 是前置件（对齐 ROADMAP「数据 schema 迁移管道」纪律：
// 首个破坏性 schema 变更时才有迁移锚）。
//
// 开关（对齐仓库 env 开关惯例 SOFAGENT_PERMISSION_GUARD===1）：
//   默认开；SOFAGENT_USAGE_TRACKING=0 关闭（关闭后零写入）。
//   读写面均不抛错——遥测失败静默计数（mainStreamErrors 计数器），
//   绝不影响 tool 调用主路径（分派点 try/catch 包裹）。
// ============================================================

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { loadEnvConfig } from '@sofagent/core';

/** 调用结果状态（成功 / 失败——含守卫拦截、角色拒绝、未知工具、执行异常） */
export type ToolCallStatus = 'ok' | 'error';

/** 遥测记录——一行 JSONL。⚠️ 字段集钉死：加字段 = schema 变更，须 bump schemaVersion */
export interface ToolUsageRecord {
  /** schema 版本（破坏性变更的迁移锚） */
  schemaVersion: 1;
  /** tool 名（canonical 名——别名已在分派层归一） */
  tool: string;
  /** ISO 8601 时间戳 */
  ts: string;
  /** 会话标识（agent-identity 会话；不可达时 'unknown'，不猜测） */
  sessionId: string;
  /** 调用结果：ok = 正常返回；error = 守卫拦截 / 角色拒绝 / 未知工具 / 执行异常 */
  status: ToolCallStatus;
  /** 调用耗时（毫秒，非负整数——分派点起止时钟差） */
  durationMs: number;
}

/** 遥测 schema 版本（当前 1） */
export const TOOL_USAGE_SCHEMA_VERSION = 1;

/** 遥测写入失败计数（静默——不抛错但可观测；测试与 doctor 消费） */
export const usageTrackerStats = { silentFailures: 0 };

/** 遥测开关：默认开；SOFAGENT_USAGE_TRACKING=0 关闭（显式 '0' 才关，其余值含未设置=开） */
export function isUsageTrackingEnabled(): boolean {
  return process.env.SOFAGENT_USAGE_TRACKING !== '0';
}

/** 遥测落盘路径：{dataDir}/tool-usage.jsonl（dataDir 经 loadEnvConfig 三级 fallback） */
export function resolveToolUsagePath(): string {
  return join(loadEnvConfig().dataDir, 'tool-usage.jsonl');
}

/**
 * 记一次 tool 调用（追加一行 JSONL）。
 *
 * 隐私纪律：入参只有 tool 名、sessionId 与两个**元数据**字段（status / durationMs）——
 * **没有也不接受参数/结果内容**（接口签名层面杜绝内容字段进入遥测面）。
 * 失败静默计数不抛错。
 */
export function recordToolUsage(
  tool: string,
  sessionId: string,
  status: ToolCallStatus = 'ok',
  durationMs = 0,
): void {
  if (!isUsageTrackingEnabled()) return;
  try {
    const record: ToolUsageRecord = {
      schemaVersion: TOOL_USAGE_SCHEMA_VERSION,
      tool,
      ts: new Date().toISOString(),
      sessionId: sessionId === '' ? 'unknown' : sessionId,
      status: status === 'error' ? 'error' : 'ok',
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0,
    };
    const p = resolveToolUsagePath();
    if (!existsSync(dirname(p))) {
      mkdirSync(dirname(p), { recursive: true });
    }
    appendFileSync(p, JSON.stringify(record) + '\n', 'utf-8');
  } catch {
    // 静默失败计数——遥测绝不拖垮调用主路径（分派点另有 try/catch 兜底）
    usageTrackerStats.silentFailures++;
  }
}
