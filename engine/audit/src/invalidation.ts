// ============================================================
// invalidation.ts · 审计结论失效语义（v1.5.2 章四 · Codex Guardian 启发）
//
// 问题：审计结论（decision-log 条目）一经产生即被当作永久有效——下游
// 消费方（fresh-eyes 审查输入 / HITL 免检依据 / 治理 KPI 统计）无法判断
// 「这条结论还能不能信」。
//
// 本模块给结论定义**失效条件**与**失效标记机制**，语义三铁律：
//
//   ① append-only —— 失效是**追加一条新条目**，绝不回头涂改既有行。
//      decision-log 是 HMAC 链（decision-log.ts + chain-kernel.ts），
//      改写已签名条目 = 断链 = 判 tampered。故「标记失效」= emitDecision
//      追加 kind=INVALIDATION 条目：causedBy 指向被失效结论的 ts、
//      causalType='influenced'、invalidationReason 记原因。
//
//   ② 原文保留 —— 被失效条目的落盘字节逐字不变（HMAC 链完整性不被破坏）。
//      「失效是标记不是抹除」：证据仍在，只是不再当新证据用。
//
//   ③ 下游过滤 —— 带失效标记的结论不作为后续判定的输入。消费方经
//      collectInvalidations / isInvalidated / filterValid 剔除失效结论
//      （「过期结论不当新证据用」）。已接线两处：治理 KPI 统计
//      （governance.computeGovernanceKpis）与 HITL 免检依据
//      （decision-query.findSimilarDecisions/先例检索）；失效**标记条目自身**
//      在读数面亦以 isInvalidationMarker 排除（元记录，不是 Agent 决策）。
//      ⚠️ 第三处「fresh-eyes 审查输入」**仓内无落点**——已核 `FORGE/src/
//      fresh-eyes-driver.mjs` 全程不读 decision-log（仅一处 `emitDecision: true`
//      配置项），即本仓不存在消费决策结论的 fresh-eyes 输入构造点，非漏接。
//      过滤 API 已从本模块导出，供跨仓 / 后续消费方按同一语义接入。
//
// 失效原因词汇表见 decision-schema.ts 的 InvalidationReason（对齐 Guardian
// `GuardianReviewReason` 六原因取五项子集）。
//
// 三触发钩子（hooks）：
//   ① onAuthorizationChanged —— 授权或白名单配置变更（AuthorizationChanged）
//   ② onCompaction           —— 压缩/摘要事件（IncompatibleCompaction，
//                               对应 L2 工具输出总结 / 加载链压缩）
//   ③ onRiskEscalated        —— 同一对象后续被更严规则命中（ElevatedRisk）
//
// 钩子返回 null 表示「本次事件无可失效目标」——**不追加空标记**（空标记
// 无信息量，只会污染决策日志）。幂等：已被失效的目标不会重复追加。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { getDecisionLogPath } from '@sofagent/core';
import { emitDecision } from './decision-log';
import type { DecisionLogEntry, InvalidationReason } from './decision-schema';

/**
 * 决策日志只读（坏行容忍——与 decision-query.loadDecisionLog / governance.readDecisionEntries
 * 同一解析语义：空行跳过、坏行跳过）。
 *
 * ⚠️ 刻意不复用 decision-query.loadDecisionLog：本模块被 decision-query 反向依赖
 * （findSimilarDecisions 的失效过滤），复用会形成 import 环；故自持这一小段只读解析。
 */
function readLog(dataDir?: string): DecisionLogEntry[] {
  const filePath = getDecisionLogPath(dataDir);
  if (!existsSync(filePath)) return [];
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const entries: DecisionLogEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(JSON.parse(trimmed) as DecisionLogEntry);
    } catch {
      // 坏行跳过（与 loadDecisionLog / readDecisionEntries 同语义）
      continue;
    }
  }
  return entries;
}

/** 失效原因合法集合（与 decision-schema 的 InvalidationReason 逐字对齐） */
const VALID_REASONS: readonly string[] = [
  'authorization-changed', 'incompatible-compaction', 'elevated-risk', 'stale-score', 'fresh-required',
];

/** markInvalid 入参 */
export interface MarkInvalidInput {
  /** 发起失效标记的 Agent 标识 */
  agentId: string;
  /** 会话标识 */
  sessionId: string;
  /** 失效原因（五分类，见 InvalidationReason） */
  reason: InvalidationReason;
  /** 被失效的结论条目 ts 列表（必须非空——空标记无信息量） */
  targets: string[];
  /** 触发源描述（授权变更 / 压缩事件 / 风险升级——写入 why.text 供人读） */
  trigger: string;
  /** 证据链（字符串数组，可空） */
  evidence?: string[];
}

/**
 * 追加一条失效标记条目（append-only 唯一写入口）。
 *
 * 语义：`causedBy = targets`、`causalType = 'influenced'`、`moment = 'ATTRIBUTION'`
 * （追责/归因阶段——失效判定发生在结论产生之后的复查环节）。
 *
 * @throws Error targets 为空 / reason 非法（不写文件——空标记与非法原因都是调用方 bug）
 * @throws DecisionSchemaError / DecisionWriteError 透传自 emitDecision
 */
export function markInvalid(input: MarkInvalidInput, dataDir?: string): DecisionLogEntry {
  if (!VALID_REASONS.includes(input.reason)) {
    throw new Error(`[invalidation] 非法失效原因 "${String(input.reason)}"——必须在 InvalidationReason 枚举内`);
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new Error('[invalidation] targets 必须是非空数组（被失效结论条目的 ts）——空标记无信息量，拒绝写入');
  }
  const targets = [...new Set(input.targets.filter((t) => typeof t === 'string' && t.trim() !== ''))];
  if (targets.length === 0) {
    throw new Error('[invalidation] targets 去重后为空——拒绝写入空标记');
  }

  return emitDecision(
    {
      agentId: input.agentId,
      sessionId: input.sessionId,
      kind: 'INVALIDATION',
      moment: 'ATTRIBUTION',
      causedBy: targets,
      causalType: 'influenced',
      invalidationReason: input.reason,
      why: {
        text: `结论失效（${input.reason}）：${input.trigger}——失效 ${targets.length} 条既有结论`,
        tags: ['invalidation', input.reason],
        confidence: 'high',
      },
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    },
    dataDir,
  );
}

/**
 * 从决策日志派生「已被失效的结论 ts 集合」。
 *
 * 口径：扫描全部条目，凡带 `invalidationReason` 的即是标记条目；其
 * `causedBy` 逐项即被失效结论的 ts。标记条目自身不在集合内（它是标记，
 * 不是被失效的结论）。
 *
 * 老日志无 invalidationReason 字段 → 空集合（向后兼容）。
 */
export function collectInvalidations(dataDir?: string): Set<string> {
  const invalid = new Set<string>();
  for (const entry of readLog(dataDir)) {
    if (entry.invalidationReason === undefined) continue;
    for (const ts of entry.causedBy ?? []) {
      if (typeof ts === 'string' && ts !== '') invalid.add(ts);
    }
  }
  return invalid;
}

/** 单条结论是否已失效（消费方单点查询用）。 */
export function isInvalidated(ts: string, dataDir?: string): boolean {
  return collectInvalidations(dataDir).has(ts);
}

/**
 * 下游过滤助手：剔除已被失效的条目。
 *
 * @param entries 待过滤条目（只要求含 ts 字段）
 * @param invalid 失效 ts 集合；缺省时按默认数据目录现算
 *                （批量消费场景建议显式传入——避免条目来源目录与集合目录不一致）
 */
export function filterValid<T extends { ts: string }>(entries: T[], invalid?: Set<string>): T[] {
  const set = invalid ?? collectInvalidations();
  if (set.size === 0) return entries;
  return entries.filter((e) => !set.has(e.ts));
}

/** 失效标记条目判定（供消费方把标记与结论区分开）。 */
export function isInvalidationMarker(entry: Pick<DecisionLogEntry, 'invalidationReason'>): boolean {
  return entry.invalidationReason !== undefined;
}

// ════════════════════════════════════════
// 目标选择器（钩子与真实触发点共用）
// ════════════════════════════════════════

/**
 * 规范化规则标识用于匹配——小写去空白。规则 key 形如 'a1'，
 * `why.tags` 形如 'a1'、`why.triggeredRule` 形如 'tool-sensitive-file'。
 */
function normRule(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 找「以指定规则为依据」的既有结论 ts（授权/白名单规则变更的失效目标）。
 *
 * 匹配口径（精确 + 段前缀，避免 'a1' 误命中 'a10'）：
 *   - `why.tags` 项 与规则 key 相等，或互为 `-` 分段前缀（'a1' ↔ 'a1-sensitive-files'）
 *   - `why.triggeredRule` 与规则 key 相等，或含 `-` 分段前缀（同上）
 * 自动排除已失效条目与失效标记条目自身（幂等——不重复标记）。
 */
export function findConclusionsByRules(rules: string[], dataDir?: string): string[] {
  const keys = rules.map(normRule).filter((k) => k !== '');
  if (keys.length === 0) return [];
  const alreadyInvalid = collectInvalidations(dataDir);
  const out: string[] = [];
  for (const entry of readLog(dataDir)) {
    if (entry.invalidationReason !== undefined) continue; // 标记条目不是结论
    if (alreadyInvalid.has(entry.ts)) continue;           // 幂等
    const candidates = [...(entry.why?.tags ?? []), ...(entry.why?.triggeredRule ? [entry.why.triggeredRule] : [])];
    const hit = candidates.some((c) => {
      const n = normRule(c);
      return keys.some((k) => n === k || n.startsWith(`${k}-`) || k.startsWith(`${n}-`));
    });
    if (hit) out.push(entry.ts);
  }
  return out;
}

/**
 * 找「同一对象（文件/artifactRef/specRef）」的既有结论 ts（风险升级的失效目标）。
 * 自动排除已失效条目与标记条目自身。
 */
export function findConclusionsForObject(objectRef: string, dataDir?: string): string[] {
  const ref = objectRef.trim();
  if (ref === '') return [];
  const alreadyInvalid = collectInvalidations(dataDir);
  const out: string[] = [];
  for (const entry of readLog(dataDir)) {
    if (entry.invalidationReason !== undefined) continue;
    if (alreadyInvalid.has(entry.ts)) continue;
    const refs = [entry.artifactRef, entry.specRef].filter((r): r is string => typeof r === 'string');
    if (refs.some((r) => r === ref || r.includes(ref))) out.push(entry.ts);
  }
  return out;
}

/**
 * 找「同一会话」在给定时刻之前的既有结论 ts（压缩事件的失效目标）。
 *
 * 语义：压缩/摘要事件发生后，本会话此前那些**依赖完整上下文**的结论前提
 * 不再可核（原始上下文已被摘要替换）——故它们须失效。已失效条目与标记条目
 * 自动排除（幂等）。`beforeTs` 缺省 = 全部会话内结论。
 */
export function findSessionConclusions(sessionId: string, beforeTs?: string, dataDir?: string): string[] {
  if (sessionId.trim() === '') return [];
  const alreadyInvalid = collectInvalidations(dataDir);
  const out: string[] = [];
  for (const entry of readLog(dataDir)) {
    if (entry.sessionId !== sessionId) continue;
    if (entry.invalidationReason !== undefined) continue;
    if (alreadyInvalid.has(entry.ts)) continue;
    if (beforeTs !== undefined && entry.ts >= beforeTs) continue;
    out.push(entry.ts);
  }
  return out;
}

// ════════════════════════════════════════
// 三触发钩子
// ════════════════════════════════════════

/** 钩子公共入参 */
export interface HookInput {
  agentId: string;
  sessionId: string;
  /**
   * 显式指定被失效结论的 ts。缺省时各钩子按自己的选择器派生
   * （派生结果为空的钩子返回 null，不追加空标记）。
   */
  targets?: string[];
  /** 触发源描述（缺省由各钩子给默认文案） */
  trigger?: string;
  evidence?: string[];
}

/** 授权/白名单配置变更入参 */
export interface AuthorizationChangedInput extends HookInput {
  /** 变更的授权/白名单规则标识（用于派生 targets——与 targets 至少提供一个） */
  changedRules?: string[];
}

/** 压缩/摘要事件入参 */
export interface CompactionInput extends HookInput {
  /** 压缩源（L2 工具输出总结 / 加载链压缩等——留痕用） */
  source?: string;
  /** 压缩发生时刻；之前（不含）的会话内结论为候选失效目标 */
  beforeTs?: string;
}

/** 风险升级入参 */
export interface RiskEscalatedInput extends HookInput {
  /** 命中该对象的更严规则名（留痕用） */
  rule?: string;
  /** 同一对象引用（文件路径 / artifactRef / specRef——用于派生 targets） */
  objectRef?: string;
}

/** 钩子返回：DecisionLogEntry = 已追加标记；null = 无可失效目标（未写）。 */
export type HookResult = DecisionLogEntry | null;

function resolveTargets(explicit: string[] | undefined, derive: () => string[]): string[] {
  if (explicit !== undefined) return explicit;
  try {
    return derive();
  } catch (err) {
    // 选择器读日志失败——不阻断调用方主流程，按「无可失效目标」处理
    console.error(`[invalidation] 目标选择器读取决策日志失败: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * ① 授权或白名单配置变更（Guardian: AuthorizationChanged）。
 *
 * 真实触发点（本仓）：
 *   - `engine/audit/src/index.ts` main()——config.yml 关闭规则（授权面放宽）检出后调用；
 *   - `engine/audit/src/permission/loader.ts`——permission.local.json 覆盖全局规则时
 *     （本地 Agent 可自写该文件，覆盖即授权变更）；
 *   - policy.yml plugin_sources 白名单变更（跨包，见章四汇报）。
 *
 * @returns 失效标记条目；无可失效目标时返回 null（不追加空标记）
 */
export function onAuthorizationChanged(input: AuthorizationChangedInput, dataDir?: string): HookResult {
  const targets = resolveTargets(input.targets, () => findConclusionsByRules(input.changedRules ?? [], dataDir));
  if (targets.length === 0) return null;
  const ruleText = input.changedRules && input.changedRules.length > 0 ? `（规则：${input.changedRules.join(', ')}）` : '';
  return markInvalid(
    {
      agentId: input.agentId,
      sessionId: input.sessionId,
      reason: 'authorization-changed',
      targets,
      trigger: input.trigger ?? `授权/白名单配置变更${ruleText}`,
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    },
    dataDir,
  );
}

/**
 * ② 压缩/摘要事件（Guardian: IncompatibleCompaction）。
 *
 * 真实触发点（本仓）：L2 工具输出总结（`FORGE/src/tool-output-budget.mjs`）、
 * 加载链压缩（`engine/hooks/sofagent-load-chain`）、`compactIfNeeded`
 * （`engine/inject`）——均在本 audit 包之外，需跨包接线（见章四汇报）。
 *
 * @returns 失效标记条目；会话内无可失效结论时返回 null
 */
export function onCompaction(input: CompactionInput, dataDir?: string): HookResult {
  const targets = resolveTargets(input.targets, () =>
    findSessionConclusions(input.sessionId, input.beforeTs, dataDir),
  );
  if (targets.length === 0) return null;
  const sourceText = input.source ? `（来源：${input.source}）` : '';
  return markInvalid(
    {
      agentId: input.agentId,
      sessionId: input.sessionId,
      reason: 'incompatible-compaction',
      targets,
      trigger: input.trigger ?? `压缩/摘要事件使既有结论前提失效${sourceText}`,
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    },
    dataDir,
  );
}

/**
 * ③ 后续轮次风险升级（Guardian: ElevatedRisk）。
 *
 * 「同一对象后续被更严规则命中」——同一文件/artifactRef 在后续轮次被更严
 * 规则命中（FAIL），则先前针对该对象的宽松结论不再可信。
 *
 * @returns 失效标记条目；该对象无可失效结论时返回 null
 */
export function onRiskEscalated(input: RiskEscalatedInput, dataDir?: string): HookResult {
  const targets = resolveTargets(input.targets, () =>
    input.objectRef ? findConclusionsForObject(input.objectRef, dataDir) : [],
  );
  if (targets.length === 0) return null;
  const detail = [input.objectRef ? `对象：${input.objectRef}` : '', input.rule ? `更严规则：${input.rule}` : '']
    .filter((s) => s !== '')
    .join(' · ');
  return markInvalid(
    {
      agentId: input.agentId,
      sessionId: input.sessionId,
      reason: 'elevated-risk',
      targets,
      trigger: input.trigger ?? `后续轮次风险升级${detail ? `（${detail}）` : ''}`,
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    },
    dataDir,
  );
}

/** 三触发钩子（唯一导出面——消费方按事件类型调用）。 */
export const hooks = {
  onAuthorizationChanged,
  onCompaction,
  onRiskEscalated,
};

/** 决策日志路径（测试/诊断用——与 emitDecision 同一解析链）。 */
export function invalidationLogPath(dataDir?: string): string {
  return getDecisionLogPath(dataDir);
}
