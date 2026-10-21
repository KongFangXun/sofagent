// ============================================================
// validator-health.ts · 验证器自身老化检测（元验证 · v1.7.0 章四）
// ============================================================
//
// ── 这一件解决什么 ──
// 进化循环靠 eval 验证集当门，但**验证集自己会老化**：进化循环持续跑，样本被反复消费，
// 通过率越来越好看而能力未必提升——**越进化，门越松**。验证器必须独立于写面，但「独立」
// 不等于「永远有效」——验证器自身也要被检验。本节把「门本身管起来」：
//
//   ① 验证集老化指标   每组验证集记「样本消费次数 / 通过率趋势 / 上次人工复检时间」
//                      → 合成**老化度**（对齐 skill-health.ts 五维健康度同款思路：
//                        低价值技能能退役，老化验证集也要能退役）。
//   ② 收益归因对照组   进化收益的**反事实基线**：进化开启前先冻结一份对照配置
//                      （不改 skill / 不注入 / 不训练），四指标同时跑「进化组 vs 对照组」——
//                      **差值才是净贡献**（防「环境变好了」冒充「进化有效」）。对照组按周期
//                      **轮换重置**（防对照组本身过时），**轮换留痕**。
//   ③ 验证漂移三态     考核失败区分「真失败 / 环境漂移 / 证据不足」（对齐 core
//                      checkHistoryChainDetailed 的 tampered/unverifiable/insufficient 三态先例）。
//                      **漂移态不降经验置信度、不触发回退**，但必须告警并标记待环境复核——
//                      **宁可挂起，不误杀好经验**。
//   ④ 老化告警         通过率连续上升但真实任务指标未改善（或消费次数超阈值且长期无复检）
//                      ⇒ 告警 + 建议冻结该验证集的**自动晋升资格**——**只提示不阻断**。
//   ⑤ 验证集复检入口   人工复检通道（标记样本失效 / 新增样本），**复检动作留痕**
//                      （与 v1.5.2 第四章审计结论失效语义同族：失效的不当新证据用）。
//   ⑥ 评估器解耦与三级精判  ① 自评禁令：评估/反思角色**不得复用被考核的执行模型**
//                      ② 三级精判：规则/格式预筛（廉价全覆盖）→ 独立评估模型精判（有成本、
//                         覆盖疑难）→ 关键样本人工抽检（**定标权在 `human` 档**）
//                      ③ 评估模型选型：稳定/可复现/便宜优先，须与执行模型解耦。
//   ⑦ 判定件作为验证器（三边界）  判定件是 `model-judge` 档**首选形态**——
//                      ① **能判不能出题**（只出结论与概率、不生成文本 ⇒ 作判题器不作出题器）
//                      ② **自评禁则**（不得为自身所属判定面的进化当裁判）
//                      ③ **跨面互审**（可验证其他判定面与其他可写面的进化产物，跨面关系须在
//                         域验证器登记里**显式声明**；**无声明 ⇒ 按自评处理（fail-closed）**）。
//   ⑧ 验证者链三机制   ① 每次判定用全新实例（不复用同一会话/上下文）
//                      ② 判负必须回抛原因给生产者会话
//                      ③ 不需要外部执行就能判定的不变量放进格式校验层，而不是再加一个验证者
//                      三条**不新立角色、不新增档位**。
//
// ── 取数与落点（只读既有实现，不改它们）──
//   · 四指标读数口径复用 promotion-policy 的 EvolutionBenefitMetrics（通过率趋势 / 复发率 /
//     skill 复用率 / 纠偏介入率），对照组与进化组的差值即净贡献。
//   · 域验证器档位复用 domain-verifier-registry 的 VerifierTier（判定件 = model-judge 档首选）。
//   · 判定件自身不得为所属判定面当裁判：跨面声明由域验证器登记面承载，本模块只做判定纯函数；
//     无声明按自评 fail-closed。
//
// ── 落盘与留痕 ──
//   · 验证集消费台账 ${dataDir}/evolve/validator-health/eval-set-usage.jsonl
//   · 复检留痕       ${dataDir}/evolve/validator-health/recheck.jsonl
//   · 对照组状态     ${dataDir}/evolve/validator-health/control-group.json
//   · 对照组轮换留痕 ${dataDir}/evolve/validator-health/control-rotation.jsonl
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { loadEnvConfig } from '@sofagent/core';
import type { EvolutionBenefitMetrics, PromotionVerdict } from './promotion-policy';
import type { VerifierTier } from './domain-verifier-registry';

// ────────────────────────────────────────────────────────────
// 阈值常量（单源——测试与文档消费；对齐 skill-health.ts 常量惯例）
// ────────────────────────────────────────────────────────────

/** 样本消费次数饱和值（≥ 此值该维满分——样本被反复消费 = 老化信号） */
export const AGING_CONSUMPTION_SATURATION = 50;
/** 消费次数告警阈值（≥ 此值且长期无复检 ⇒ 触发老化告警） */
export const AGING_CONSUMPTION_ALERT_THRESHOLD = 30;
/** 复检陈旧上限（天——上次人工复检距今超过此值该维满分） */
export const AGING_STALE_RECHECK_DAYS = 90;
/** 通过率连续上升窗口（连续 N 条记录上升即判「连续上升」） */
export const AGING_TREND_RISE_WINDOW = 3;
/** 通过率趋势饱和值（趋势达到此值该维满分——上升越快越可疑） */
export const AGING_TREND_SATURATION = 0.1;
/** 老化度告警阈值（老化度 ≥ 此值即纳入告警面） */
export const AGING_DEGREE_ALERT_THRESHOLD = 0.6;

/** 对照组默认轮换周期（天——防对照组本身过时） */
export const CONTROL_GROUP_ROTATION_DAYS = 30;

/** 三态判定所需最小考核记录数（不足 ⇒ 证据不足——宁缺勿假） */
export const MIN_FAILURE_EVIDENCE_SAMPLES = 3;

/** 证据门槛：判定件档位（首选形态——对象验证器档位常量，单一来源） */
export const JUDGE_ARTIFACT_TIER: VerifierTier = 'model-judge';

// ────────────────────────────────────────────────────────────
// IO 基础：路径解析与 JSONL 读写
// ────────────────────────────────────────────────────────────

/** 解析数据根目录（显式 > loadEnvConfig().dataDir） */
function resolveDataDir(dataDir?: string): string {
  return dataDir ?? loadEnvConfig().dataDir;
}

/** 验证器健康落盘目录：${dataDir}/evolve/validator-health */
export function resolveValidatorHealthDir(dataDir?: string): string {
  return join(resolveDataDir(dataDir), 'evolve', 'validator-health');
}

/** 验证集消费台账：eval-set-usage.jsonl */
export function resolveEvalSetUsagePath(dataDir?: string): string {
  return join(resolveValidatorHealthDir(dataDir), 'eval-set-usage.jsonl');
}

/** 复检留痕：recheck.jsonl */
export function resolveRecheckLogPath(dataDir?: string): string {
  return join(resolveValidatorHealthDir(dataDir), 'recheck.jsonl');
}

/** 对照组状态：control-group.json */
export function resolveControlGroupPath(dataDir?: string): string {
  return join(resolveValidatorHealthDir(dataDir), 'control-group.json');
}

/** 对照组轮换留痕：control-rotation.jsonl */
export function resolveControlRotationPath(dataDir?: string): string {
  return join(resolveValidatorHealthDir(dataDir), 'control-rotation.jsonl');
}

/** 追加一行 JSONL（不存在则建目录） */
function appendJsonl(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + '\n', 'utf-8');
}

/** 读 JSONL（文件不存在 = 空；坏行跳过并计数——不静默） */
function readJsonl<T>(path: string): { rows: T[]; corrupted: number } {
  if (!existsSync(path)) return { rows: [], corrupted: 0 };
  const rows: T[] = [];
  let corrupted = 0;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    try {
      rows.push(JSON.parse(t) as T);
    } catch {
      // 坏行跳过并计数：台账读到损坏行不炸主流程，但通过 corrupted 计数如实暴露（不静默）。
      corrupted += 1;
    }
  }
  return { rows, corrupted };
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
/** 两时刻之间的天数（to − from；可注入参照时刻——供测试锚定确定性） */
const daysBetween = (fromIso: string, toIso: string): number =>
  (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
// v1.6.0 BUG-76：sha256Hex 收敛——包内共享 baseline-snapshot 的导出实现（同签名，消灭复制漂移面）
import { sha256Hex } from './baseline-snapshot';
function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ────────────────────────────────────────────────────────────
// ① 验证集老化指标
// ────────────────────────────────────────────────────────────

/** 单条验证集消费记录（eval-set-usage.jsonl 一行） */
export interface EvalSetUsageRecord {
  /** 验证集 id */
  evalSetId: string;
  /** 记录时刻（ISO） */
  ts: string;
  /** 该次考核的通过率 [0,1] */
  passRate: number;
  /** 真实任务指标（如 acceptance 通过率 / 线上成功率）；缺省 = 未采集（不猜数） */
  taskMetric?: number | null;
}

/** 老化度三维分项（各有 0-1 分——对齐 skill-health 五维同款结构） */
export interface EvalSetAgingDimensions {
  /** ① 样本消费度（消费次数 / AGING_CONSUMPTION_SATURATION 归一） */
  consumption: number;
  /** ② 通过率趋势可疑度（连续上升且任务指标未改善时越高） */
  suspicion: number;
  /** ③ 复检陈旧度（上次人工复检距今 / AGING_STALE_RECHECK_DAYS 归一） */
  staleRecheck: number;
}

/** 老化告警（只提示不阻断——建议冻结自动晋升资格，交人决策） */
export interface AgingAlert {
  evalSetId: string;
  /** 告警级别（仅 warn——本模块不产生阻断级） */
  level: 'warn';
  /** 告警理由（人读） */
  reasons: string[];
  /** 建议（冻结该验证集的自动晋升资格——只是建议） */
  suggestion: string;
  /** 铁律：只提示不阻断（恒为 false——负向探针锚点） */
  blocksPromotion: false;
}

/** 单验证集健康度报告 */
export interface EvalSetHealth {
  evalSetId: string;
  /** 样本消费次数 */
  consumptionCount: number;
  /** 通过率趋势（窗口后半均 − 前半均；正 = 上升） */
  passRateTrend: number;
  /** 真实任务指标趋势（null = 未采集） */
  taskMetricTrend: number | null;
  /** 连续上升段长度（通过率台账末尾连续上升的条数） */
  trailingRises: number;
  /** 上次人工复检时间（无 = null） */
  lastManualRecheckAt: string | null;
  /** 三维分项 */
  dimensions: EvalSetAgingDimensions;
  /** 老化度（三维等权平均，0-1；越高越老化） */
  agingDegree: number;
  /** 老化告警（无 = null） */
  alert: AgingAlert | null;
}

/** 计算一条数值序列的趋势（后半均 − 前半均） */
function trendOf(series: number[]): number {
  if (series.length < 2) return 0;
  const half = Math.max(1, Math.floor(series.length / 2));
  return avg(series.slice(-half)) - avg(series.slice(0, half));
}

/** 统计末尾连续上升段长度（严格递增的尾部条数；首条不计） */
function countTrailingRises(series: number[]): number {
  let n = 0;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i]! > series[i - 1]!) n += 1;
    else break;
  }
  return n;
}

/** 老化计算选项 */
export interface EvalSetHealthOptions {
  /** 复检台账（缺省从 recheck.jsonl 读） */
  rechecks?: readonly EvalSetRecheckAction[];
  /** 时间注入（测试锚定用；缺省真实时间） */
  now?: string;
}

function lastRecheckAtFor(evalSetId: string, rechecks: readonly EvalSetRecheckAction[]): string | null {
  const mine = rechecks.filter((r) => r.evalSetId === evalSetId).map((r) => r.at).sort();
  return mine.length > 0 ? mine[mine.length - 1]! : null;
}

/**
 * 计算单验证集老化度（纯函数——消费记录 + 复检记录 → 健康度报告）。
 *
 * 三维：① 消费度 ② 趋势可疑度 ③ 复检陈旧度；等权平均 = 老化度。
 * 趋势可疑度只有在「通过率连续上升（≥ AGING_TREND_RISE_WINDOW）**且**真实任务指标未改善」
 * 时才计入（任务指标未采集 ⇒ 不猜，该维记 0——宁缺勿假）。
 */
export function computeEvalSetHealth(
  evalSetId: string,
  usage: readonly EvalSetUsageRecord[],
  opts: EvalSetHealthOptions = {},
): EvalSetHealth {
  const mine = usage.filter((u) => u.evalSetId === evalSetId).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const rechecks = opts.rechecks ?? [];
  const nowIso = opts.now ?? new Date().toISOString();

  const passRates = mine.map((u) => u.passRate);
  const taskMetrics = mine.map((u) => u.taskMetric).filter((v): v is number => typeof v === 'number');

  const passRateTrend = trendOf(passRates);
  const taskMetricTrend = taskMetrics.length >= 2 ? trendOf(taskMetrics) : null;
  const trailingRises = countTrailingRises(passRates);

  // ① 样本消费度
  const consumption = clamp01(mine.length / AGING_CONSUMPTION_SATURATION);

  // ② 趋势可疑度：连续上升且任务指标未改善（未采集 ⇒ 不猜，记 0）
  const taskNotImproved = taskMetricTrend === null ? false : taskMetricTrend <= 0;
  const suspicious = trailingRises >= AGING_TREND_RISE_WINDOW && taskNotImproved;
  const suspicion = suspicious ? clamp01(passRateTrend / AGING_TREND_SATURATION) : 0;

  // ③ 复检陈旧度
  const last = lastRecheckAtFor(evalSetId, rechecks);
  const staleRecheck = last === null ? 1 : clamp01(daysBetween(last, nowIso) / AGING_STALE_RECHECK_DAYS);

  const dimensions: EvalSetAgingDimensions = { consumption, suspicion, staleRecheck };
  const agingDegree = (consumption + suspicion + staleRecheck) / 3;

  const health: EvalSetHealth = {
    evalSetId,
    consumptionCount: mine.length,
    passRateTrend,
    taskMetricTrend,
    trailingRises,
    lastManualRecheckAt: last,
    dimensions,
    agingDegree,
    alert: null,
  };
  health.alert = evaluateAgingAlert(health, nowIso);
  return health;
}

/**
 * ④ 老化告警判定（**只提示不阻断**）：
 * 两条任一成立即告警——
 *   A. 通过率连续上升（≥ 窗口）**且**真实任务指标未改善；
 *   B. 消费次数 ≥ 告警阈值 **且** 上次人工复检距今 > 陈旧上限（长期无复检）。
 * 或老化度 ≥ AGING_DEGREE_ALERT_THRESHOLD 也纳入（保守兜底）。
 * 建议冻结自动晋升资格——**只建议，交人决策**，本函数不产生任何阻断位。
 */
export function evaluateAgingAlert(health: EvalSetHealth, nowIso?: string): AgingAlert | null {
  const now = nowIso ?? new Date().toISOString();
  const reasons: string[] = [];
  const taskNotImproved = health.taskMetricTrend !== null && health.taskMetricTrend <= 0;
  const condA = health.trailingRises >= AGING_TREND_RISE_WINDOW && taskNotImproved;
  if (condA) {
    reasons.push(
      `通过率连续上升 ${health.trailingRises} 次、趋势 +${health.passRateTrend.toFixed(3)}，` +
        `但真实任务指标未改善（趋势 ${health.taskMetricTrend!.toFixed(3)}）——疑「门变松」非「能力变强」`,
    );
  }
  const days = health.lastManualRecheckAt === null ? Infinity : daysBetween(health.lastManualRecheckAt, now);
  const condB = health.consumptionCount >= AGING_CONSUMPTION_ALERT_THRESHOLD && days > AGING_STALE_RECHECK_DAYS;
  if (condB) {
    reasons.push(
      `样本消费 ${health.consumptionCount} 次 ≥ ${AGING_CONSUMPTION_ALERT_THRESHOLD} 且距上次人工复检 ` +
        `${health.lastManualRecheckAt === null ? '从未复检' : `${Math.floor(days)} 天`}（上限 ${AGING_STALE_RECHECK_DAYS} 天）——长期无复检`,
    );
  }
  const condC = health.agingDegree >= AGING_DEGREE_ALERT_THRESHOLD;
  if (condC && reasons.length === 0) {
    reasons.push(`老化度 ${health.agingDegree.toFixed(2)} ≥ 阈值 ${AGING_DEGREE_ALERT_THRESHOLD}`);
  }
  if (reasons.length === 0) return null;
  return {
    evalSetId: health.evalSetId,
    level: 'warn',
    reasons,
    suggestion: `建议冻结验证集「${health.evalSetId}」的自动晋升资格，交人工复检后决定是否续用（只提示不阻断）`,
    blocksPromotion: false,
  };
}

/** 老化告警 × 晋级判定的装配结果（只提示不阻断的显式载体） */
export interface AgingAdvisoryOnPromotion {
  /** 原样返回的晋级判定（未被老化告警改写——负向探针锚点） */
  verdict: PromotionVerdict;
  /** 是否被阻断（恒为 false） */
  blocked: false;
  /** 附带的建议文案（无告警 = null） */
  advisory: string | null;
}

/**
 * 把老化告警叠加到晋级判定上——**只提示不阻断**：返回值里 verdict 与入参逐字段相同，
 * blocked 恒为 false。晋级流程可放心消费本函数做「提示 + 继续」。
 */
export function applyAgingAlertToPromotion(
  alert: AgingAlert | null,
  verdict: PromotionVerdict,
): AgingAdvisoryOnPromotion {
  return {
    verdict,
    blocked: false,
    advisory: alert === null ? null : `${alert.suggestion}（理由：${alert.reasons.join('；')}）`,
  };
}

/** 计算全部验证集的老化度（从台账读消费与复检记录） */
export function computeAllEvalSetHealth(opts: { dataDir?: string; now?: string } = {}): EvalSetHealth[] {
  const usage = readEvalSetUsage(opts.dataDir);
  const rechecks = readEvalSetRecheckLog(opts.dataDir).rows;
  const ids = [...new Set(usage.map((u) => u.evalSetId))].sort();
  const now = opts.now;
  return ids.map((id) => computeEvalSetHealth(id, usage, now === undefined ? { rechecks } : { rechecks, now }));
}

/** 收集全部老化告警（只提示面） */
export function collectAgingAlerts(opts: { dataDir?: string; now?: string } = {}): AgingAlert[] {
  return computeAllEvalSetHealth(opts)
    .map((h) => h.alert)
    .filter((a): a is AgingAlert => a !== null);
}

// ────────────────────────────────────────────────────────────
// ⑤ 验证集复检入口（人工复检通道 + 留痕）
// ────────────────────────────────────────────────────────────

/** 复检动作种类 */
export const RECHECK_ACTIONS = ['invalidate-sample', 'add-sample'] as const;
export type RecheckActionKind = (typeof RECHECK_ACTIONS)[number];

/** 复检动作（recheck.jsonl 一行——与审计结论失效语义同族：失效的不当新证据用） */
export interface EvalSetRecheckAction {
  /** 验证集 id */
  evalSetId: string;
  /** 动作：标记样本失效 / 新增样本 */
  action: RecheckActionKind;
  /** 样本 id */
  sampleId: string;
  /** 发起人（人工复检——须人发起） */
  actor: string;
  /** 复检理由 */
  reason: string;
  /** 复检时刻（ISO） */
  at: string;
}

/** 复检入参（at 可省略——缺省取当前时刻） */
export type EvalSetRecheckInput = Omit<EvalSetRecheckAction, 'at'> & { at?: string };

/**
 * 记录一次人工复检动作（落 recheck.jsonl）。
 * 复检动作留痕：标记样本失效 / 新增样本都被记一条可追溯条目（含发起人与理由）。
 */
export function recordEvalSetRecheck(input: EvalSetRecheckInput, opts: { dataDir?: string } = {}): EvalSetRecheckAction {
  const action: EvalSetRecheckAction = { ...input, at: input.at ?? new Date().toISOString() };
  appendJsonl(resolveRecheckLogPath(opts.dataDir), action);
  return action;
}

/** 读复检台账（坏行计数如实暴露） */
export function readEvalSetRecheckLog(dataDir?: string): { rows: EvalSetRecheckAction[]; corrupted: number } {
  return readJsonl<EvalSetRecheckAction>(resolveRecheckLogPath(dataDir));
}

/** 记一次验证集消费（落 eval-set-usage.jsonl——供老化度取数） */
export function recordEvalSetUsage(record: EvalSetUsageRecord, opts: { dataDir?: string } = {}): EvalSetUsageRecord {
  appendJsonl(resolveEvalSetUsagePath(opts.dataDir), record);
  return record;
}

/** 读验证集消费台账 */
export function readEvalSetUsage(dataDir?: string): EvalSetUsageRecord[] {
  return readJsonl<EvalSetUsageRecord>(resolveEvalSetUsagePath(dataDir)).rows;
}

// ────────────────────────────────────────────────────────────
// ② 收益归因对照组（反事实基线）
// ────────────────────────────────────────────────────────────

/** 对照组冻结配置（进化开启前的基线快照——不改 skill / 不注入 / 不训练） */
export interface ControlGroupFrozenConfig {
  /** 语义化标签（如 'pre-evolution-freeze'） */
  label: string;
  /** 冻结时的配置载荷（技能集 / 注入模板 / 训练策略的只读引用） */
  payload: Record<string, unknown>;
  /** 冻结时刻（ISO） */
  frozenAt: string;
}

/** 对照组状态（含轮换代次） */
export interface ControlGroupState {
  /** 对照组内容寻址 id（冻结载荷 + 轮换代次） */
  id: string;
  /** 冻结配置 */
  frozenConfig: ControlGroupFrozenConfig;
  /** 轮换周期（天） */
  rotationPeriodDays: number;
  /** 轮换代次（0 = 初次冻结；每次轮换 +1） */
  generation: number;
  /** 上次（含初次）冻结时刻（ISO） */
  lastRotatedAt: string;
}

/** 对照组轮换留痕（control-rotation.jsonl 一行——防对照组本身过时） */
export interface ControlGroupRotationRecord {
  /** 轮换后新代次 */
  generation: number;
  /** 轮换时刻（ISO） */
  rotatedAt: string;
  /** 被替换的上一代 id */
  previousId: string;
  /** 新冻结配置快照 */
  frozenConfig: ControlGroupFrozenConfig;
  /** 轮换理由 */
  reason: string;
  /** 发起人 */
  actor: string;
}

/** 净贡献（进化组 × 对照组逐指标差值） */
export interface MetricNetContribution {
  metric: keyof EvolutionBenefitMetrics;
  /** 进化组读数 */
  treatment: number;
  /** 对照组读数 */
  control: number;
  /** 原始差值（treatment − control） */
  delta: number;
  /** 方向：higher = 越大越好 / lower = 越小越好 */
  direction: 'higher' | 'lower';
  /** 按方向的净改善（direction 折算后为正 = 进化有效） */
  improvement: number;
}

/** 四指标的偏好方向（单一来源） */
export const BENEFIT_METRIC_DIRECTIONS: Record<keyof EvolutionBenefitMetrics, 'higher' | 'lower'> = {
  passRateTrend: 'higher',
  recurrenceRate: 'lower',
  skillReuseRate: 'higher',
  interventionRate: 'lower',
};

/** 冻结一组对照配置（进化开启前） */
export function freezeControlGroup(
  frozenConfig: Omit<ControlGroupFrozenConfig, 'frozenAt'> & { frozenAt?: string },
  opts: { rotationPeriodDays?: number; now?: string } = {},
): ControlGroupState {
  const at = frozenConfig.frozenAt ?? opts.now ?? new Date().toISOString();
  const full: ControlGroupFrozenConfig = { label: frozenConfig.label, payload: frozenConfig.payload, frozenAt: at };
  const rotationPeriodDays = opts.rotationPeriodDays ?? CONTROL_GROUP_ROTATION_DAYS;
  const id = `cg-${sha256Hex(`${full.label}|${JSON.stringify(full.payload)}|0`, 16)}`;
  return { id, frozenConfig: full, rotationPeriodDays, generation: 0, lastRotatedAt: at };
}

/** 读对照组状态（文件不存在 = null） */
export function readControlGroup(dataDir?: string): ControlGroupState | null {
  const p = resolveControlGroupPath(dataDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ControlGroupState;
  } catch {
    // 损坏状态不静默：返回 null 且打 stderr 提示，调用方据 null 重建。
    console.error(`[validator-health] 对照组状态文件解析失败，按「无对照组」处理：${p}`);
    return null;
  }
}

/** 落盘对照组状态 */
export function saveControlGroup(state: ControlGroupState, opts: { dataDir?: string } = {}): void {
  const p = resolveControlGroupPath(opts.dataDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/** 对照组是否到轮换周期（防对照组本身过时） */
export function shouldRotateControlGroup(state: ControlGroupState, nowIso?: string): boolean {
  const now = nowIso ?? new Date().toISOString();
  return daysBetween(state.lastRotatedAt, now) >= state.rotationPeriodDays;
}

/** 轮换选项 */
export interface RotateControlGroupOptions {
  /** 新冻结配置（缺省沿用旧载荷——只换代次） */
  frozenConfig?: Omit<ControlGroupFrozenConfig, 'frozenAt'>;
  /** 发起人（缺省 'validator-health-rotation'） */
  actor?: string;
  /** 轮换理由 */
  reason?: string;
  /** 轮换时刻（ISO） */
  now?: string;
  /** 数据目录（落盘 use） */
  dataDir?: string;
  /** 是否落盘（缺省 true；测试可置 false） */
  persist?: boolean;
}

/**
 * 轮换重置对照组：代次 +1、冻结时刻更新、**轮换留痕**（control-rotation.jsonl）。
 * 返回新状态与轮换记录。新 id 内容寻址含新代次 ⇒ 不同代次必然不同 id（可寻址）。
 */
export function rotateControlGroup(
  state: ControlGroupState,
  opts: RotateControlGroupOptions = {},
): { state: ControlGroupState; rotation: ControlGroupRotationRecord } {
  const at = opts.now ?? new Date().toISOString();
  const frozen: ControlGroupFrozenConfig = opts.frozenConfig
    ? { label: opts.frozenConfig.label, payload: opts.frozenConfig.payload, frozenAt: at }
    : { ...state.frozenConfig, frozenAt: at };
  const generation = state.generation + 1;
  const id = `cg-${sha256Hex(`${frozen.label}|${JSON.stringify(frozen.payload)}|${generation}`, 16)}`;
  const next: ControlGroupState = { id, frozenConfig: frozen, rotationPeriodDays: state.rotationPeriodDays, generation, lastRotatedAt: at };
  const rotation: ControlGroupRotationRecord = {
    generation,
    rotatedAt: at,
    previousId: state.id,
    frozenConfig: frozen,
    reason: opts.reason ?? '对照组周期轮换重置（防对照组本身过时）',
    actor: opts.actor ?? 'validator-health-rotation',
  };
  if (opts.persist !== false) {
    saveControlGroup(next, { dataDir: opts.dataDir });
    appendJsonl(resolveControlRotationPath(opts.dataDir), rotation);
  }
  return { state: next, rotation };
}

/** 读对照组轮换留痕 */
export function readControlRotationLog(dataDir?: string): { rows: ControlGroupRotationRecord[]; corrupted: number } {
  return readJsonl<ControlGroupRotationRecord>(resolveControlRotationPath(dataDir));
}

/**
 * 计算净贡献：逐指标「进化组 − 对照组」原始差值 + 按方向折算的净改善。
 * **差值才是净贡献**——防「环境变好了」冒充「进化有效」。
 */
export function computeNetContribution(
  treatment: EvolutionBenefitMetrics,
  control: EvolutionBenefitMetrics,
): MetricNetContribution[] {
  const metrics = Object.keys(BENEFIT_METRIC_DIRECTIONS) as Array<keyof EvolutionBenefitMetrics>;
  return metrics.map((metric) => {
    const t = treatment[metric];
    const c = control[metric];
    const delta = t - c;
    const direction = BENEFIT_METRIC_DIRECTIONS[metric];
    const improvement = direction === 'higher' ? delta : -delta;
    return { metric, treatment: t, control: c, delta, direction, improvement };
  });
}

// ────────────────────────────────────────────────────────────
// ③ 验证漂移三态
// ────────────────────────────────────────────────────────────

/** 考核失败三态（对齐 checkHistoryChainDetailed 的 tampered/unverifiable/insufficient 先例） */
export const VALIDATION_FAILURE_STATES = ['true-failure', 'environment-drift', 'insufficient-evidence'] as const;
export type ValidationFailureState = (typeof VALIDATION_FAILURE_STATES)[number];

/** 失败归因证据 */
export interface FailureEvidence {
  /** 失败时环境指纹与通过时是否一致（依赖版本 / 路径 / 权限） */
  envFingerprintMatched: boolean;
  /** 是否可稳定复现（多次重试同样失败） */
  reproducible: boolean;
  /** 是否具备构成判定所需的充分证据 */
  hasSufficientEvidence: boolean;
  /** 考核记录条数（缺省 = 用 hasSufficientEvidence 判定） */
  sampleCount?: number;
}

/** 漂移三态判定结果 */
export interface DriftVerdict {
  state: ValidationFailureState;
  /** 是否降低经验置信度（漂移/证据不足态 = false——不误杀） */
  lowerConfidence: boolean;
  /** 是否触发回退（漂移/证据不足态 = false——不误杀） */
  triggerRollback: boolean;
  /** 是否告警（三态均告警——失败不可无痕） */
  alert: boolean;
  /** 是否标记待环境复核（漂移/证据不足态 = true） */
  pendingEnvReview: boolean;
  /** 判定依据（人读） */
  basis: string;
}

/**
 * 考核失败三态判定：
 *   · 环境指纹不一致 ⇒ **environment-drift**（环境漂移：依赖版本/路径/权限变了，非经验失效）
 *   · 证据不足（样本数 < MIN 或 hasSufficientEvidence=false）⇒ **insufficient-evidence**
 *   · 其余（指纹一致 + 证据充分 + 可复现/不可复现皆可）⇒ **true-failure**（真失败）
 *
 * **漂移态与证据不足态不降经验置信度、不触发回退，只告警 + 标记待环境复核**——
 * 宁可挂起，不误杀好经验。三态优先级：证据不足 > 环境漂移 > 真失败
 * （无充分证据时连「是否漂移」都判不准，先按证据不足挂起）。
 */
export function classifyValidationFailure(ev: FailureEvidence): DriftVerdict {
  const sampleCount = ev.sampleCount ?? (ev.hasSufficientEvidence ? MIN_FAILURE_EVIDENCE_SAMPLES : 0);
  const insufficient = !ev.hasSufficientEvidence || sampleCount < MIN_FAILURE_EVIDENCE_SAMPLES;
  if (insufficient) {
    return {
      state: 'insufficient-evidence',
      lowerConfidence: false,
      triggerRollback: false,
      alert: true,
      pendingEnvReview: true,
      basis: `证据不足（样本 ${sampleCount} < ${MIN_FAILURE_EVIDENCE_SAMPLES} 或未构成充分证据）——挂起待补证据，不降置信度、不回退`,
    };
  }
  if (!ev.envFingerprintMatched) {
    return {
      state: 'environment-drift',
      lowerConfidence: false,
      triggerRollback: false,
      alert: true,
      pendingEnvReview: true,
      basis: '环境指纹与通过时不一致（依赖版本/路径/权限漂移）——归环境漂移，挂起待环境复核，不降置信度、不回退',
    };
  }
  return {
    state: 'true-failure',
    lowerConfidence: true,
    triggerRollback: true,
    alert: true,
    pendingEnvReview: false,
    basis: `环境一致 + 证据充分（样本 ${sampleCount}）→ 真失败（${ev.reproducible ? '可稳定复现' : '不可复现但环境一致'}）——降置信度并可回退`,
  };
}

// ────────────────────────────────────────────────────────────
// ⑥ 评估器解耦与三级精判
// ────────────────────────────────────────────────────────────

/** 角色引用（执行模型 / 评估模型） */
export interface ModelRoleRef {
  role: 'executor' | 'evaluator' | 'reflection';
  modelId: string;
}

/** 解耦判定结果 */
export interface DecouplingVerdict {
  ok: boolean;
  /** 不 ok 时的原因 */
  reason?: string;
}

/**
 * ⑥① 自评禁令：评估 / 反思角色**不得复用被考核的执行模型**。
 * 同一 modelId 既做题又判题 = 自评失效（对齐 devlog：评判准确度与下一步改进几乎零相关）。
 * 角色为 executor 的引用应传 executor.modelId 作为比对基准。
 */
export function assertEvaluatorDecoupled(executor: ModelRoleRef, evaluator: ModelRoleRef): DecouplingVerdict {
  if (evaluator.role === 'executor') {
    return { ok: false, reason: `评估者角色不得为 executor（自评禁令：判题者须独立于执行者）` };
  }
  if (executor.modelId === evaluator.modelId) {
    return {
      ok: false,
      reason: `评估模型与执行模型同 id（${evaluator.modelId}）——自评禁令：同一模型既做题又判题 = 自评失效`,
    };
  }
  return { ok: true };
}

/** 三级精判档位（廉价全覆盖 → 有成本覆盖疑难 → 关键样本人审） */
export const JUDGE_TIERS = ['rule-prefilter', 'independent-model', 'human-spot-check'] as const;
export type JudgeTier = (typeof JUDGE_TIERS)[number];

/** 三级精判装配配置 */
export interface ThreeTierPrecisionConfig {
  /** ① 规则/格式预筛（廉价、覆盖全量） */
  prefilter: { enabled: true; description: string };
  /** ② 独立评估模型精判（有成本、覆盖疑难） */
  independentModel: { modelId: string; decoupledFrom: string; basis: string };
  /** ③ 关键样本人工抽检（定标权在 human 档） */
  humanSpotCheck: { calibrationAuthority: 'human'; sampleRate: number; basis: string };
}

/** 三级精判装配失败（自评禁令违反 / 参数非法） */
export class EvaluatorDecouplingError extends Error {
  constructor(message: string) {
    super(`[validator-health] ${message}`);
    this.name = 'EvaluatorDecouplingError';
  }
}

/**
 * ⑥② 装配三级精判结构：规则预筛（廉价全覆盖）→ 独立评估模型（有成本、覆盖疑难）→
 * 关键样本人审抽检（**定标权在 human 档**）。
 * 装配时强制自评禁令：独立评估模型 id 必须 ≠ 执行模型 id，否则抛错（fail-closed）。
 */
export function buildThreeTierPrecision(
  executorModelId: string,
  judgeModelId: string,
  opts: { humanSampleRate?: number } = {},
): ThreeTierPrecisionConfig {
  const dec = assertEvaluatorDecoupled(
    { role: 'executor', modelId: executorModelId },
    { role: 'evaluator', modelId: judgeModelId },
  );
  if (!dec.ok) throw new EvaluatorDecouplingError(dec.reason ?? '评估器解耦校验失败');
  const sampleRate = opts.humanSampleRate ?? 0.1;
  if (sampleRate < 0 || sampleRate > 1) throw new EvaluatorDecouplingError(`人审抽检比例非法：${sampleRate}（须 ∈ [0,1]）`);
  return {
    prefilter: { enabled: true, description: '规则/格式预筛——廉价、覆盖全量（需求外部执行证据者除外）' },
    independentModel: {
      modelId: judgeModelId,
      decoupledFrom: executorModelId,
      basis: '稳定/可复现/便宜优先，与执行模型解耦（反思/评估不需强创造力）',
    },
    humanSpotCheck: {
      calibrationAuthority: 'human',
      sampleRate,
      basis: '关键样本人工抽检——定标权在 human 档（对齐教师蒸馏定标纪律）',
    },
  };
}

/** 待精判样本特征 */
export interface JudgeSample {
  sampleId: string;
  /** 规则/格式层即可判定的不变量（廉价全覆盖面） */
  ruleDeterminable: boolean;
  /** 关键样本（须人审抽检定标） */
  key: boolean;
}

/** 精判路由结果 */
export interface JudgeRouting {
  sampleId: string;
  tier: JudgeTier;
  /** 是否定标权在 human 档（仅 human-spot-check 为 true） */
  calibrationAuthority: 'human' | null;
  /** 是否需要外部执行证据（false = 应归格式校验层，见验证者链机制③） */
  needsExecutionEvidence: boolean;
  basis: string;
}

/**
 * ⑥② 精判路由：规则可判定 ⇒ 规则预筛（廉价全覆盖）；否则关键样本 ⇒ 人审抽检
 * （定标权 human）；其余 ⇒ 独立评估模型精判（覆盖疑难）。
 */
export function routeJudgeTier(sample: JudgeSample): JudgeRouting {
  if (sample.ruleDeterminable) {
    return {
      sampleId: sample.sampleId,
      tier: 'rule-prefilter',
      calibrationAuthority: null,
      needsExecutionEvidence: false,
      basis: '规则/格式可判定 ⇒ 规则预筛（廉价、覆盖全量，不需外部执行证据）',
    };
  }
  if (sample.key) {
    return {
      sampleId: sample.sampleId,
      tier: 'human-spot-check',
      calibrationAuthority: 'human',
      needsExecutionEvidence: true,
      basis: '关键样本 ⇒ 人工抽检（定标权在 human 档）',
    };
  }
  return {
    sampleId: sample.sampleId,
    tier: 'independent-model',
    calibrationAuthority: null,
    needsExecutionEvidence: true,
    basis: '疑难样本 ⇒ 独立评估模型精判（有成本、与执行模型解耦）',
  };
}

// ────────────────────────────────────────────────────────────
// ⑦ 判定件作为验证器（三边界）
// ────────────────────────────────────────────────────────────

/** 判定件（类型化概率 · 单次前向 · 可校准——model-judge 档首选形态） */
export interface JudgeArtifact {
  id: string;
  /** 该判定件所属判定面（域） */
  surface: string;
  /** 能力声明：能判 / 能出题 */
  capabilities: { canJudge: boolean; canAuthor: boolean };
}

/** 判定件边界判定结果 */
export interface JudgeArtifactBoundary {
  ok: boolean;
  /** 不 ok 时的原因 */
  reason?: string;
}

/**
 * ⑦① 能判不能出题：判定件只出结论与概率、不生成文本 ⇒ 作**判题器**不作**出题器**。
 * 即：canJudge 必须为 true，且 canAuthor 必须为 false（混用会让「自己出题」从机制上复活）。
 */
export function assertJudgeArtifactCanJudgeNotAuthor(artifact: JudgeArtifact): JudgeArtifactBoundary {
  if (!artifact.capabilities.canJudge) {
    return { ok: false, reason: `判定件 ${artifact.id} 未声明能判（canJudge=false）——不能作判题器` };
  }
  if (artifact.capabilities.canAuthor) {
    return {
      ok: false,
      reason: `判定件 ${artifact.id} 声明能出题（canAuthor=true）——违反「能判不能出题」边界：作判题器不作出题器`,
    };
  }
  return { ok: true };
}

/** 跨面关系声明（须在域验证器登记里显式声明——无声明 ⇒ 按自评 fail-closed） */
export interface CrossSurfaceDeclaration {
  /** 判定件所属判定面 */
  judgeSurface: string;
  /** 被验证的进化面（判定面 / 可写面：prompt / memory / skill / 配置） */
  targetSurface: string;
  /** 声明落点（域验证器登记项 id——显式声明的载体） */
  declaredIn: string;
  /** 声明理由 */
  basis: string;
}

/** 跨面互审判定结果 */
export interface CrossSurfaceVerdict {
  /** 是否允许当裁判 */
  allowed: boolean;
  /** 是否被按自评处理（无声明 / 同面） */
  treatedAsSelfReview: boolean;
  /** 判定依据 */
  basis: string;
}

/**
 * ⑦②③ 判定件裁判资格判定：
 *   · 同判定面（judgeSurface === targetSurface）⇒ **自评禁则**：不得为自身所属判定面的进化
 *     当裁判（含自身微调 / 同判据集上的判据变更）——treatedAsSelfReview=true；
 *   · 异面且登记表里有**显式声明** ⇒ 允许（跨面互审）；
 *   · 异面但**无声明** ⇒ fail-closed 按自评处理（treatedAsSelfReview=true、allowed=false）。
 */
export function judgeCrossSurface(
  judgeSurface: string,
  targetSurface: string,
  declarations: readonly CrossSurfaceDeclaration[],
): CrossSurfaceVerdict {
  if (judgeSurface === targetSurface) {
    return {
      allowed: false,
      treatedAsSelfReview: true,
      basis: `判定件所属判定面「${judgeSurface}」即为进化目标面——自评禁则：不得为自身所属判定面的进化当裁判`,
    };
  }
  const decl = declarations.find((d) => d.judgeSurface === judgeSurface && d.targetSurface === targetSurface);
  if (!decl) {
    return {
      allowed: false,
      treatedAsSelfReview: true,
      basis:
        `跨面关系（${judgeSurface} → ${targetSurface}）未在域验证器登记里显式声明——` +
        `无声明 ⇒ 按自评处理（fail-closed）`,
    };
  }
  return {
    allowed: true,
    treatedAsSelfReview: false,
    basis: `跨面关系已显式声明（${decl.declaredIn}）：${decl.basis}`,
  };
}

/** 判定件登记为 model-judge 档首选验证器（档位为常量 JUDGE_ARTIFACT_TIER） */
export function judgeArtifactTier(): VerifierTier {
  return JUDGE_ARTIFACT_TIER;
}

// ────────────────────────────────────────────────────────────
// ⑧ 验证者链三机制（不新立角色、不新增档位）
// ────────────────────────────────────────────────────────────

/** 验证者链三机制（常量——判据名单一来源） */
export const VERIFIER_CHAIN_MECHANISMS = ['fresh-instance', 'reject-returns-reason', 'invariants-in-format-layer'] as const;
export type VerifierChainMechanism = (typeof VERIFIER_CHAIN_MECHANISMS)[number];

/** 判定请求（每次判定用全新实例） */
export interface VerificationRequest {
  /** 本次判定所用实例 id */
  verifierInstanceId: string;
  /** 复用判定的话，此前用过的实例（须为空 = 全新） */
  reusedInstanceIds?: readonly string[];
}

/**
 * ⑧① 每次判定用全新实例：verifierInstanceId 不得出现在本会话已用实例集合里
 * （复用实例等于让裁判带着上一题的印象判下一题）。
 */
export function assertFreshInstance(req: VerificationRequest, used: ReadonlySet<string>): JudgeArtifactBoundary {
  if (used.has(req.verifierInstanceId)) {
    return { ok: false, reason: `验证者实例 ${req.verifierInstanceId} 已被复用——违反「每次判定用全新实例」` };
  }
  if (req.reusedInstanceIds && req.reusedInstanceIds.includes(req.verifierInstanceId)) {
    return { ok: false, reason: `验证者实例 ${req.verifierInstanceId} 出现在复用清单里——违反「每次判定用全新实例」` };
  }
  return { ok: true };
}

/** 判定结果（判负须回抛原因） */
export interface VerdictFeedback {
  passed: boolean;
  /** 判负时必须给出可行动的原因 */
  reason?: string;
}

/**
 * ⑧② 判负必须回抛原因：passed=false 时 reason 必须为非空字符串
 * （判定结果不是 bool，而是可直接给生产者会话执行修正的可行动反馈）。
 */
export function assertRejectHasReason(feedback: VerdictFeedback): JudgeArtifactBoundary {
  if (!feedback.passed && (!feedback.reason || feedback.reason.trim() === '')) {
    return { ok: false, reason: '判负未回抛原因——判定结果须为可行动反馈（可能是「字段 X 缺失」等具体原因），不能只报 bool' };
  }
  return { ok: true };
}

/** 不变量归属判定结果 */
export interface InvariantPlacement {
  /** 是否需要（新增）验证者 */
  useVerifier: boolean;
  /** 是否应放进格式校验层 */
  formatValidation: boolean;
  basis: string;
}

/**
 * ⑧③ 不需要外部执行就能判定的不变量 ⇒ 放进**格式校验层**，而不是再加一个验证者
 * （验证者数量与判定成本须与「是否真需要执行证据」对齐，否则门会越加越多而每一道都更松）。
 */
export function placeInvariant(needsExecutionEvidence: boolean): InvariantPlacement {
  if (needsExecutionEvidence) {
    return {
      useVerifier: true,
      formatValidation: false,
      basis: '不变量需要外部执行证据 → 需（独立）验证者；归判定面而非格式层',
    };
  }
  return {
    useVerifier: false,
    formatValidation: true,
    basis: '不变量不需外部执行即可判定 → 放进格式校验层，不再加一个验证者（判据成本与执行证据需求对齐）',
  };
}
