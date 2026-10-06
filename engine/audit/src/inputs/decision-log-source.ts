// ============================================================
// inputs/decision-log-source.ts · 审计输入面第三路：decision-log（v1.5.7 章八）
// ============================================================
// 背景：
//   decision-log.jsonl 已记 18 类可问责决策（TOOL_GATE / ARTIFACT_EDIT /
//   FALLBACK_DEGRADE …），但此前只有治理报表在消费、规则判定面零消费。
//   本章把它升为审计输入面的正式一路（与 history / 意图流并列）——
//   判定所需的大量事实（放过没放 / 改了什么 / 降级几次）本就在里面。
//
// 只读铁律（三不）：
//   ① 不改 schema——DecisionLogEntry 与写侧（decision-log.ts emitDecision）
//      共用同一类型源（decision-schema.ts），本文件零字段增删；
//   ② 不写盘——本文件对 decision-log.jsonl 只有读权，无任何 fs 写调用；
//   ③ 不猜测——坏行跳过并告警（与 intent-channel 的 readIntentEntries 同容错口径），
//      不编造缺失字段。
//
// 类型映射（18 类逐类「消费 / 不消费 + 理由」——无静默挂空）：
//   见文件尾部 DECISION_KIND_CONSUMPTION 映射表（E7 与后续规则的消费声明单源）。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { getDecisionLogPath } from '@sofagent/core';
import type { DecisionLogEntry, DecisionKind } from '../decision-schema';
import { log } from '../logger';

// ════════════════════════════════════════
// 常量 / Constants
// ════════════════════════════════════════

/** decision-log 落盘文件名（与写侧 getDecisionLogPath 同源——core 的 data-paths SSOT） */
export const DECISION_LOG_FILENAME = 'decision-log.jsonl';

/**
 * decision-log 的合法 kind 集（读侧形态过滤的单源）。
 * ⚠️ 与 decision-log.ts 的 VALID_KINDS 白名单**双落点**（同 DecisionKind union 纪律）——
 * 写侧新增 kind 时须三处同批：decision-schema.ts union + decision-log.ts 白名单 + 本数组。
 */
const READABLE_KINDS: readonly DecisionKind[] = [
  'SPEC_CHANGE', 'ARTIFACT_EDIT', 'TOOL_GATE', 'RULE_TOGGLE',
  'ESCALATE_REPORT', 'FALLBACK_DEGRADE', 'CONFIG_CHANGE',
  'KNOWLEDGE_DISTILL', 'ORCHESTRATION',
  'EVOLUTION', 'TEAM', 'COMMONS',
  'COST', 'COVERAGE', 'INVALIDATION', 'CREDENTIAL_RECONCILE',
  'LEGACY_CLEANUP', 'DATA_PRODUCT',
];

// ════════════════════════════════════════
// 读取面（只读 · 规则侧消费）
// ════════════════════════════════════════

/**
 * 读 decision-log 条目（供 `AuditContext.decisionEntries` 装配）。
 *
 * 容错口径（与 intent-channel.readIntentEntries 同族纪律）：
 * 文件不存在返回空数组（= 无决策记录可判，不是错误）；坏行**跳过**（该行链完整性
 * 由 verifyChain 独立暴露，读侧不二次判定）但**跳过必须留痕**（静默吞错门禁合规形态）。
 * 只收形态合法的条目（kind ∈ 枚举且 ts/agentId/sessionId 为字符串）——被污染行不进规则输入面。
 *
 * 🔴 只读承诺：本函数不写任何文件、不调用任何写侧 API。
 */
export function readDecisionEntries(filePath: string): DecisionLogEntry[] {
  if (!filePath || !existsSync(filePath)) return [];
  const out: DecisionLogEntry[] = [];
  let badLines = 0;
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as DecisionLogEntry;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof parsed.ts === 'string' &&
        typeof parsed.agentId === 'string' &&
        typeof parsed.sessionId === 'string' &&
        READABLE_KINDS.includes(parsed.kind)
      ) {
        out.push(parsed);
      } else {
        // 形态不合法（非本文件写入方的行 / 半截 JSON）——跳过并计数
        badLines++;
      }
    } catch {
      // 坏行跳过——不阻断举证（该行的完整性由 verifyChain 复核，读侧不判链）
      badLines++;
    }
  }
  if (badLines > 0) {
    log.warn(`[decision-log-source] ${filePath} 有 ${badLines} 行无法解析或形态不合法（已跳过，不阻断判定；链完整性请用 verifyChain 复核）`);
  }
  return out;
}

/**
 * 解析 decision-log 路径——**复用 core 的 getDecisionLogPath**（显式 dataDir >
 * SOFAGENT_DATA > 默认数据目录），不另造第二套路径解析（与写侧同源同径）。
 */
export function resolveDecisionLogSourcePath(dataDir?: string): string {
  return getDecisionLogPath(dataDir);
}

/**
 * 便捷入口：按 dataDir 读全部决策条目（runner 装配点用）。
 * dataDir 缺省 = core 三级 fallback（与 intent.jsonl / history.jsonl 同目录口径）。
 */
export function loadDecisionEntries(dataDir?: string): DecisionLogEntry[] {
  return readDecisionEntries(resolveDecisionLogSourcePath(dataDir));
}

/**
 * 按 kind 过滤（E7 等规则的消费面helper——保持读侧纯函数）。
 * INVALIDATION 标记条目按下游读数纪律排除在决策计数外（元记录非决策——见
 * decision-schema.ts 的 isInvalidationMarker 纪律），需要标记条的调用方自行读全集。
 */
export function filterByKind(entries: DecisionLogEntry[], kind: DecisionKind): DecisionLogEntry[] {
  return entries.filter((e) => e.kind === kind);
}

// ════════════════════════════════════════
// 类型映射（18 类逐类消费声明——无静默挂空）
// ════════════════════════════════════════

/**
 * DecisionKind → 审计规则面的消费声明（v1.5.7 章八交付：「无用例的类型显式登记，
 * 不做静默挂空」）。
 *
 * - `consumedBy`：消费该 kind 的规则 id 列表（空数组 = 当前无规则消费，但显式登记）；
 * - `reason`：消费 / 不消费的一句话理由。
 *
 * 维护纪律：新增 DecisionKind 时**必须**同批在本表登记（生成器断言族不扫本表——
 * 表驱动自检见 decision-log-source.test.ts 的完备性用例：表键集 ≡ READABLE_KINDS 集）。
 */
export const DECISION_KIND_CONSUMPTION: Readonly<Record<DecisionKind, { consumedBy: string[]; reason: string }>> = {
  SPEC_CHANGE: { consumedBy: [], reason: '不消费——规格变更属 FDE 进场叙事面，无 git-diff 级判定命题（留待判定底座 v1.6.0+ 评估判据化）' },
  ARTIFACT_EDIT: { consumedBy: [], reason: '不消费——产物编辑的判定面已由 A3/A7/A16/A24 直接从 git diff 判（结果通道），从 decision-log 二次判同一事是重复判定' },
  TOOL_GATE: { consumedBy: [], reason: '不消费——门禁三态留痕已被 v1.5.3 第六章成对完整性守卫消费（check-paired-records.mjs 门禁面），规则面再判即第二套判定' },
  RULE_TOGGLE: { consumedBy: [], reason: '不消费——规则启停属配置治理面（config 三级 fallback 管），无 diff 级判定命题' },
  ESCALATE_REPORT: { consumedBy: [], reason: '不消费——上报动作本身即人工可见（HITL），无自动判定价值' },
  FALLBACK_DEGRADE: { consumedBy: ['E7'], reason: '消费——E7 决策质量信号：降级高频出现 = 判定质量劣化趋势（LLM 不可用/引擎超时等降级链频繁触发说明主判定面不稳）' },
  CONFIG_CHANGE: { consumedBy: [], reason: '不消费——配置变更有签名校验面（--sign-config）+ A4 不删配置，无第二判定需求' },
  KNOWLEDGE_DISTILL: { consumedBy: [], reason: '不消费——蒸馏动作的质量由 eval（passRate）反馈闭环管，非 diff 级命题' },
  ORCHESTRATION: { consumedBy: [], reason: '不消费——编排决策的判定面是 COVERAGE 对账（trace 三源），E7 不重复判' },
  EVOLUTION: { consumedBy: [], reason: '不消费——进化动作有 gate 验收（accept-reject），审计不二次评判进化本身' },
  TEAM: { consumedBy: [], reason: '不消费——团队协作协议（L2）自留痕，无 diff 级判定命题' },
  COMMONS: { consumedBy: [], reason: '不消费——公地动作（发布/评分/退役）有五环治理台账，无 diff 级判定命题' },
  COST: { consumedBy: [], reason: '不消费——成本告警由 budget 台账与 cost_query 查询面消费，审计规则不判成本（超支不是 diff 违规）' },
  COVERAGE: { consumedBy: [], reason: '不消费——trace 对账结果本身是判定产物（trace_reconcile 工具面），规则不判判定的判定' },
  INVALIDATION: { consumedBy: [], reason: '不消费——失效标记是元记录（标记不是抹除），按下游读数纪律排除在决策计数外；其完整性由链校验管' },
  CREDENTIAL_RECONCILE: { consumedBy: [], reason: '不消费——授权对账结论自带三态判定（mandate-credential-reconcile.ts），再判即套娃' },
  LEGACY_CLEANUP: { consumedBy: [], reason: '不消费——清理动作留痕属观测/过程记录（非判决类），无判定命题' },
  DATA_PRODUCT: { consumedBy: [], reason: '不消费（暂）——E5 数据产物审计从 git diff 判勾稽/溯源/口径（结果通道直判）；DATA_PRODUCT kind 的决策留痕消费面待判定底座 v1.6.0+ 判据化后评估' },
};
