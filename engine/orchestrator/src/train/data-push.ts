// data-push.ts · v1.4.7 章二 · 标准数据推送接口（schema 校验 + 分拣/合规双闸入库）
//
// 定位：企业存储/业务系统按标准格式（约定 schema）向引擎推送训练语料与知识
// 数据——经分拣闸（sorting-gate）+ 合规闸（train-compliance）双闸入库。
// 「深度定制连接器不做」，统一走本接口（2026-09-05 拍板）。
//
// 双闸分层（红线）：
//   - 合规闸（train-compliance）管「能不能训」——提交入口，违规拦截整个入库
//   - 分拣闸（sorting-gate）管「在哪训」——敏感档只拦「上云」路径，本地入库放行
//
// 分拣依据（为什么拦/为什么放）由调用方写入 train_job 审计 HMAC 链可追溯。
//
// 纯判定编排（零 I/O——合规判定经注入，分拣判定走 sorting-gate）——全量可测。

import { z } from 'zod';
import { classifyBatchForCloud, type SortingDecision } from './sorting-gate';

// ════════════════════════════════════════
// 标准推送 schema（约定格式）
// ════════════════════════════════════════

/** 标准数据推送 payload（企业存储 → 引擎的统一格式） */
export const DataPushSchema = z
  .object({
    /** 数据类型（训练语料 / 知识数据） */
    kind: z.enum(['training_corpus', 'knowledge']),
    /** 企业标识（租户隔离键） */
    enterpriseId: z.string().min(1),
    /** 来源系统（审计可追溯） */
    source: z.string().min(1),
    /** 样本（训练语料行 / 知识片段——分拣闸逐段判定） */
    samples: z.array(z.string()).min(1),
  })
  .strict();

export type DataPushPayload = z.infer<typeof DataPushSchema>;

/** 推送校验结果 */
export interface DataPushValidation {
  valid: boolean;
  payload?: DataPushPayload;
  issues?: string[];
}

/** 校验标准推送 payload（zod——格式不合法拒绝入库） */
export function validateDataPush(raw: unknown): DataPushValidation {
  const result = DataPushSchema.safeParse(raw);
  if (!result.success) {
    return {
      valid: false,
      issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { valid: true, payload: result.data };
}

// ════════════════════════════════════════
// 双闸入库判定（分拣 + 合规）
// ════════════════════════════════════════

/** 合规闸判定函数（train-compliance 注入——data-push 不重复实现合规逻辑） */
export type ComplianceCheck = (payload: DataPushPayload) => { allowed: boolean; reason: string };

/** 双闸入库结果 */
export interface DataPushGateResult {
  /** 是否入库（双闸全过） */
  accepted: boolean;
  /** 分拣结果（逐段决策——上云依据入审计链） */
  sorting: { allAllowed: boolean; decisions: SortingDecision[] };
  /** 合规结果（能不能训） */
  compliance: { allowed: boolean; reason: string };
  /** 拦截原因汇总（人读） */
  reason: string;
}

/**
 * 双闸入库判定。
 *
 * 顺序：合规闸先（能不能训）→ 分拣闸后（在哪训）。合规不过直接拒；
 * 合规过但分拣拦（含敏感档）→ 本地入库放行、上云拦截（分拣闸只管上云路径）。
 *
 * @param complianceCheck 合规判定（train-compliance 注入——单源复用不重写）
 */
export function gateDataPush(
  payload: DataPushPayload,
  complianceCheck: ComplianceCheck,
  opts: { now?: () => number } = {},
): DataPushGateResult {
  // 一、合规闸（能不能训——提交入口）
  const compliance = complianceCheck(payload);
  if (!compliance.allowed) {
    return {
      accepted: false,
      sorting: { allAllowed: false, decisions: [] },
      compliance,
      reason: `合规闸拦截：${compliance.reason}`,
    };
  }

  // 二、分拣闸（在哪训——上云前置）
  const sorting = classifyBatchForCloud(payload.samples, opts);
  if (!sorting.allAllowed) {
    const sensitiveCount = sorting.decisions.filter((d) => d.classification === 'sensitive').length;
    return {
      accepted: true, // 本地入库放行——分拣闸只管「上云」路径，不拦本地入库
      sorting,
      compliance,
      reason: `分拣闸标记 ${sensitiveCount} 段敏感档——本地入库放行，上云需先脱敏（依据入审计链）`,
    };
  }

  return {
    accepted: true,
    sorting,
    compliance,
    reason: '双闸全过（合规 + 分拣均放行）',
  };
}
