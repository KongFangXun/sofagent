// ============================================================
// invoker.ts · 能力调用 + 结果记录（v1.3.4 交付 2）
//
// L3 组织能力市场的「调用」环节——发现能力 → 一键挂载到 Agent
// （复用 registry.ts 的 listAgents 注册机制）→ 调用 → 记录结果。
//
// 安全门：挂载前必须过 SkillScan（交付 4 的 scanForInstall）：
//   - DANGEROUS → 拦截调用
//   - SUSPICIOUS → 复用 v1.3.1 HITL 弹人工确认
//   - SAFE → 直接放行
//
// 调用全程审计：kind=MARKET（谁调了谁的能力、结果如何）。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';
import { readCatalog } from './catalog';
import { getCapabilityStatus } from './retire';
import { scanForInstall, type ScanResult } from './skill-scan';
import { appendInvokeCount } from './rating';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 调用结果状态 */
export type InvokeOutcome = 'success' | 'failed' | 'blocked' | 'hitl_pending';

/** 能力调用入参 */
export interface InvokeInput {
  /** 要调用的能力 ID（从 catalog 发现） */
  capabilityId: string;
  /** 调用者 agentId（谁调的） */
  callerAgentId: string;
  /** 调用入参（透传给被调能力） */
  input?: unknown;
  /** 是否跳过 SkillScan（默认 false——挂载前必须扫） */
  skipScan?: boolean;
}

/** 能力调用结果 */
export interface InvokeResult {
  /** 能力 ID */
  capabilityId: string;
  /** 能力名称 */
  capabilityName: string;
  /** 调用结果状态 */
  outcome: InvokeOutcome;
  /** 调用产出（success 时有值） */
  output?: unknown;
  /** SkillScan 扫描结果 */
  scan?: ScanResult;
  /** 是否需要 HITL 确认（SUSPICIOUS 时） */
  needHITL?: boolean;
  /** 耗时 ms */
  durationMs: number;
  /** 拒绝原因（blocked 时） */
  reason?: string;
}

/**
 * 能力执行函数（可注入——测试用 mock，不调真实 Agent）。
 *
 * 真实调用由 MCP 层 / Agent runtime 注入；invoker.ts 只负责
 * 编排（发现→扫描→调用→记录），执行逻辑解耦。
 */
export type CapabilityExecutor = (input: {
  capabilityId: string;
  sourcePath: string;
  input: unknown;
}) => Promise<unknown>;

// ────────────────────────────────────────────────────────────
// 调用记录持久化
// ────────────────────────────────────────────────────────────

/** 调用日志路径 */
export function resolveInvokeLogPath(dataDir?: string): string {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, 'market', 'invoke-log.jsonl');
}

/** 调用日志记录 */
export interface InvokeLogEntry {
  /** 时间戳 ISO */
  ts: string;
  /** 能力 ID */
  capabilityId: string;
  /** 调用者 agentId */
  callerAgentId: string;
  /** 结果状态 */
  outcome: InvokeOutcome;
  /** 耗时 ms */
  durationMs: number;
  /** SkillScan 判定 */
  scanVerdict?: string;
}

/**
 * 读取调用日志。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 调用日志数组
 */
export function readInvokeLog(dataDir?: string): InvokeLogEntry[] {
  const path = resolveInvokeLogPath(dataDir);
  if (!existsSync(path)) return [];

  let content = '';
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }

  const entries: InvokeLogEntry[] = [];
  for (const line of content.trim().split('\n').filter(Boolean)) {
    try {
      entries.push(JSON.parse(line) as InvokeLogEntry);
    } catch {
      // 跳过
    }
  }
  return entries;
}

/** 追加一条调用日志 */
function appendInvokeLog(entry: InvokeLogEntry, dataDir?: string): void {
  const path = resolveInvokeLogPath(dataDir);
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(entry) + '\n', { flag: 'a' });
}

// ────────────────────────────────────────────────────────────
// 核心调用流程
// ────────────────────────────────────────────────────────────

/**
 * 发现并调用一个能力。
 *
 * 流程：
 *   1. 发现：从 catalog 读取能力详情（getCapability）
 *   2. 状态检查：能力未退役（getCapabilityStatus）
 *   3. SkillScan：scanForInstall（调用者侧扫描）
 *      - DANGEROUS → 拦截（outcome=blocked）
 *      - SUSPICIOUS → 标记 needHITL（outcome=hitl_pending）
 *      - SAFE → 放行
 *   4. 执行：调用 executor（注入）
 *   5. 记录：invoke-log + invoke-count + 审计（kind=MARKET）
 *
 * @param input 调用入参
 * @param executor 能力执行函数（必填——真实执行或 mock）
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 调用结果
 */
export async function invokeCapability(
  input: InvokeInput,
  executor: CapabilityExecutor,
  dataDir?: string,
): Promise<InvokeResult> {
  const startTime = Date.now();
  const { capabilityId, callerAgentId } = input;

  // 1. 发现：读取能力详情（含已退役——以便给出准确的「已退役」而非「不存在」提示）
  // CatalogEntry 类型未暴露 sourcePath，但 manifest 实际含此字段（publisher 写入），用宽类型读取
  const cap = (readCatalog(dataDir, true) as unknown as Array<Record<string, string>>).find((e) => e.id === capabilityId) ?? null;
  if (!cap) {
    return {
      capabilityId,
      capabilityName: '',
      outcome: 'blocked',
      durationMs: Date.now() - startTime,
      reason: `能力「${capabilityId}」不存在（先 market_search 发现）`,
    };
  }
  const capName = cap.name ?? '';
  const capSourcePath = cap.sourcePath ?? '';

  // 2. 状态检查：已退役的能力不可调用
  const status = getCapabilityStatus(capabilityId, dataDir);
  if (status === 'retired') {
    return {
      capabilityId,
      capabilityName: capName,
      outcome: 'blocked',
      durationMs: Date.now() - startTime,
      reason: `能力「${capName}」已退役，不可调用`,
    };
  }

  // 3. SkillScan（调用者侧——挂载前必须扫）
  let scan: ScanResult | undefined;
  if (!input.skipScan) {
    const installScan = scanForInstall(capSourcePath, capabilityId);
    scan = installScan;

    if (installScan.verdict === 'DANGEROUS') {
      // DANGEROUS → 拦截调用
      const result: InvokeResult = {
        capabilityId,
        capabilityName: capName,
        outcome: 'blocked',
        scan,
        durationMs: Date.now() - startTime,
        reason: `SkillScan 拦截: ${installScan.reason}`,
      };
      logAndAudit(result, callerAgentId, dataDir);
      return result;
    }

    if (installScan.verdict === 'SUSPICIOUS' && installScan.needHITL) {
      // SUSPICIOUS → 需要 HITL 人工确认（先返回 pending，由调用方处理）
      const result: InvokeResult = {
        capabilityId,
        capabilityName: capName,
        outcome: 'hitl_pending',
        scan,
        needHITL: true,
        durationMs: Date.now() - startTime,
        reason: `SkillScan SUSPICIOUS，需人工确认: ${installScan.reason}`,
      };
      logAndAudit(result, callerAgentId, dataDir);
      return result;
    }
  }

  // 4. 执行（调用注入的 executor）
  try {
    const output = await executor({
      capabilityId,
      sourcePath: capSourcePath,
      input: input.input,
    });

    const result: InvokeResult = {
      capabilityId,
      capabilityName: capName,
      outcome: 'success',
      output,
      scan,
      durationMs: Date.now() - startTime,
    };

    // 5. 记录 + 调用量统计 + 审计
    logAndAudit(result, callerAgentId, dataDir);
    appendInvokeCount(capabilityId, dataDir);

    return result;
  } catch (err) {
    const result: InvokeResult = {
      capabilityId,
      capabilityName: capName,
      outcome: 'failed',
      scan,
      durationMs: Date.now() - startTime,
      reason: err instanceof Error ? err.message : String(err),
    };
    logAndAudit(result, callerAgentId, dataDir);
    return result;
  }
}

/**
 * 记录调用日志 + 审计（kind=MARKET）。
 */
function logAndAudit(
  result: InvokeResult,
  callerAgentId: string,
  dataDir?: string,
): void {
  // 调用日志
  appendInvokeLog(
    {
      ts: new Date().toISOString(),
      capabilityId: result.capabilityId,
      callerAgentId,
      outcome: result.outcome,
      durationMs: result.durationMs,
      ...(result.scan ? { scanVerdict: result.scan.verdict } : {}),
    },
    dataDir,
  );

  // 审计（kind=MARKET——市场调用走审计引擎）
  try {
    emitDecision({
      agentId: callerAgentId,
      sessionId: `market-invoke-${result.capabilityId}`,
      kind: 'MARKET',
      moment: 'ACT',
      why: {
        text: `调用能力「${result.capabilityName}」(${result.capabilityId}) → ${result.outcome}`,
        tags: ['market', 'invoke', result.outcome],
        confidence: result.outcome === 'success' ? 'high' : 'med',
      },
      artifactRef: result.capabilityId,
      evidence: [
        `outcome: ${result.outcome}`,
        `durationMs: ${result.durationMs}`,
        ...(result.reason ? [`reason: ${result.reason}`] : []),
        ...(result.scan ? [`scan: ${result.scan.verdict}`] : []),
      ],
    });
  } catch (err) {
    process.stderr.write(
      `[invoker] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// ────────────────────────────────────────────────────────────
// 评价回流辅助（调用方在调用后提交评分）
// ────────────────────────────────────────────────────────────

/**
 * 调用后提交评分的便捷函数（封装 rating.addRating + owner trust 更新）。
 *
 * 这是对 rating.ts addRating 的语义化封装——调用方调 invokeCapability 后，
 * 根据结果质量提交评分。评分回流会同时更新 owner trust。
 *
 * @param capabilityId 能力 ID
 * @param raterId 评价者 agentId
 * @param score 评分（0.0 ~ 1.0）
 * @param ownerAgentId 能力 owner（用于更新 trust）
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function rateAfterInvoke(
  capabilityId: string,
  raterId: string,
  score: number,
  ownerAgentId: string,
  dataDir?: string,
): void {
  // 延迟导入避免循环依赖（rating.ts 不 import invoker，但此函数在 invoker 中）
  const { addRating } = require('./rating') as {
    addRating: (rec: { capabilityId: string; raterId: string; score: number; ratedAt?: string }, dd?: string) => unknown;
  };
  const { updateTrustOnRating } = require('./owner') as {
    updateTrustOnRating: (ownerId: string, score: number, dd?: string) => number;
  };

  addRating(
    { capabilityId, raterId, score, ratedAt: new Date().toISOString() },
    dataDir,
  );
  // 评价回流更新 owner trust
  updateTrustOnRating(ownerAgentId, score, dataDir);
}
