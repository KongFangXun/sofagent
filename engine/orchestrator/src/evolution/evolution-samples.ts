// ============================================================
// evolution/evolution-samples.ts · 进化模块持续采样数据桥（v1.4.5 第七章二/三）
//
// 定位：章八（devlog 第七章一）continuous-sampler 每日落盘
// `data/evolution/samples-<date>.json`（Dream Cycle ≥7 天连续运行的
// eval passRate 曲线 + 知识库增量 + 修正回流统计）。本文件是这份
// **真实采样数据**的两个消费入口：
//   一、评估反哺闭环（第七章二）：采样中的「修正回流 + 低分差评 +
//       反复失败」作为 harvest→jury→promote 的链路输入（非合成数据）；
//   二、L4 工具层自进化（第七章三）：采样中的「工具调用统计」作为
//       高频工具候选的来源（Agent 产出高频工具候选——复用持续采样统计）。
//
// ⚠️ 合流记录（2026-09-05 · D3 落盘后核对）：D3 的 continuous-sampler.ts
// 已合入（engine/daemon/src/dream-cycle/continuous-sampler.ts），其落盘
// 结构与本桥的差异及对齐决策：
//   一、D3 的 samples-<date>.json 是 **JSONL 追加行**（每行一个
//       DailySample 统计记录：evalPassRate/knowledgeEntities/
//       correctionReflows 计数器口径）；本桥按 devlog 第七章二/三的
//       反哺与 L4 消费面需要**明细口径**（correctionBackflow/
//       lowScoreFeedback/repeatFailures/toolUsage 明细数组）。
//   二、读侧兼容双格式：JSONL 行式（D3 形态——逐行解析，统计字段
//       映射到 summary）与整文件对象式（本桥 spec 形态）都接受；
//       反哺/L4 消费接口在 D3 统计口径样本上优雅降级（无明细 →
//       空候选，不误报不崩——见 summarizeEvolutionSamples）。
//   三、生产链路（采样→反哺→L4）的完整明细口径对接属章八→章九/十
//       的接口边界，待 D3 的明细扩展（其 spec 未含明细数组——报告
//       已列「待拍板」）。
//
// 数据结构（samples-<date>.json 单日样本 · devlog 第七章一 spec）：
//   EvolutionSampleFile = {
//     date: string                  // 采样日 YYYY-MM-DD
//     cycleDays: number             // 累计运行天数（≥7 为达标）
//     degraded: 'real'|'mock'       // LLM 降级标注（mock=占位跑——第七章五）
//     evalCurve: { date, passRate }[]         // 每日 eval 通过率曲线
//     knowledgeDelta: { concepts, atoms }      // 知识库当日增量
//     correctionBackflow: CorrectionBackflow[] // 修正回流统计（章二反哺输入）
//     lowScoreFeedback: LowScoreFeedback[]     // 低分差评（harvest 源一）
//     repeatFailures: RepeatFailure[]          // 反复失败（harvest 源二）
//     toolUsage: ToolUsageStat[]               // 工具调用统计（L4 候选源）
//   }
//
// 接口签名（spec-first）：
//   readEvolutionSamples(dataDir, opts?): EvolutionSampleFile[]  按日期序读全部样本
//   readLatestEvolutionSample(dataDir): EvolutionSampleFile|null 取最新一日
//   correctionBackflowToRatings(samples): LowScoreRating[]       修正回流→harvest 入参形态
//   repeatFailuresToCases(samples): RepeatFailCase[]             反复失败→harvest 入参形态
//   toolCandidatesFromSamples(samples, opts?): ToolCandidate[]   高频工具候选（L4）
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { appendSkillImpactEntry } from '../skill-evolution/skill-impact-ledger';

// ────────────────────────────────────────────────────────────
// 类型定义（samples-<date>.json · devlog 第七章一 spec 对齐）
// ────────────────────────────────────────────────────────────

/** 每日 eval 通过率曲线点 */
export interface EvalCurvePoint {
  date: string;
  passRate: number;
}

/** 修正回流统计（人纠正 Agent 输出的记录——反哺闭环的核心输入） */
export interface CorrectionBackflow {
  /** 被纠正的能力/节点 ID */
  capabilityId: string;
  /** 纠正者（人审者 agentId） */
  correctedBy: string;
  /** 纠正前评分（0.0~1.0——纠正意味着原输出不达标） */
  score: number;
  /** 纠正说明（FDE delivery-report 格式文本——可被 parseFdeDeliveryReport 解析） */
  comment?: string;
  /** 纠正时间 ISO */
  correctedAt: string;
}

/** 低分差评（commons_rate 累积——harvest 源一） */
export interface LowScoreFeedback {
  capabilityId: string;
  raterId: string;
  score: number;
  comment?: string;
}

/** 反复失败（invoke-log 聚合——harvest 源二） */
export interface RepeatFailure {
  capabilityId: string;
  failCount: number;
  lastReason?: string;
}

/** 工具调用统计（L4 高频工具候选源） */
export interface ToolUsageStat {
  /** 工具名（MCP tool name 或 commons capabilityId） */
  toolName: string;
  /** 采样周期内调用次数 */
  invokeCount: number;
  /** 成功率（0.0~1.0——低成功率高频工具有自写替代价值） */
  successRate?: number;
  /** Agent 提出的自写候选来源描述（如「重复手工编排三步」） */
  candidateHint?: string;
}

/** 单日采样文件（samples-<date>.json 全量结构） */
export interface EvolutionSampleFile {
  /** 采样日（YYYY-MM-DD——与文件名后缀一致） */
  date: string;
  /** 累计连续运行天数 */
  cycleDays: number;
  /** LLM 降级标注（'real'=真脑 / 'mock'=占位——第七章五显式降级语义） */
  degraded: 'real' | 'mock';
  /** 每日 eval 通过率曲线（含当日） */
  evalCurve: EvalCurvePoint[];
  /** 知识库当日增量 */
  knowledgeDelta: { concepts: number; atoms: number };
  /** 修正回流统计 */
  correctionBackflow: CorrectionBackflow[];
  /** 低分差评 */
  lowScoreFeedback: LowScoreFeedback[];
  /** 反复失败 */
  repeatFailures: RepeatFailure[];
  /** 工具调用统计 */
  toolUsage: ToolUsageStat[];
}

/** harvest 入参形态（rule-harvest.ts 的 HarvestInput 子集——类型对齐） */
export interface LowScoreRating {
  capabilityId: string;
  raterId: string;
  score: number;
  comment?: string;
}

/** harvest 入参形态（反复失败 case） */
export interface RepeatFailCase {
  capabilityId: string;
  failCount: number;
  lastReason?: string;
}

/** L4 高频工具候选 */
export interface ToolCandidate {
  /** 工具名 */
  toolName: string;
  /** 采样周期内累计调用次数 */
  invokeCount: number;
  /** 加权热度（invokeCount × (1 - successRate)——低成功高频最热） */
  heat: number;
  /** 候选来源描述（透传 candidateHint） */
  hint?: string;
}

// ────────────────────────────────────────────────────────────
// 读取
// ────────────────────────────────────────────────────────────

/**
 * 进化采样目录（data/evolution/）。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function resolveEvolutionSamplesDir(dataDir?: string): string {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, 'evolution');
}

/**
 * 读取全部进化采样样本（samples-*.json），按日期升序。
 *
 * 降级语义：目录不存在 / 无样本文件 → 返回空数组（采样未开始是
 * 正常态——反哺闭环与 L4 候选在无采样数据时各走「无输入」路径，
 * 不崩不误报）。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 采样文件数组（按 date 升序）
 */
export function readEvolutionSamples(dataDir?: string): EvolutionSampleFile[] {
  const dir = resolveEvolutionSamplesDir(dataDir);
  if (!existsSync(dir)) return [];

  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const samples: EvolutionSampleFile[] = [];
  for (const name of names) {
    if (!/^samples-\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    try {
      const content = readFileSync(join(dir, name), 'utf-8').trim();
      if (content.length === 0) continue;

      // 双格式兼容（D3 合流决策）：
      //   格式 A（本桥 spec）：整文件单 JSON 对象（明细口径）
      //   格式 B（D3 continuous-sampler）：JSONL 追加行（每日一行 DailySample
      //           统计口径——evalPassRate/knowledgeDelta/correctionReflows 计数器）
      // 判定：先试整文件 parse；失败则按行 parse（逐行收集，统计字段映射 summary）
      let parsedAsObject = false;
      try {
        const raw = JSON.parse(content) as Partial<EvolutionSampleFile> & {
          evalPassRate?: number | null;
          correctionReflows?: number;
          providerStatus?: 'real' | 'mock';
          knowledgeDelta?: number | null;
        };
        // 整对象形态：有 date 且行数语义为单对象
        if (typeof raw.date === 'string' && raw.date.length > 0) {
          parsedAsObject = true;
          samples.push({
            date: raw.date,
            cycleDays: typeof raw.cycleDays === 'number' ? raw.cycleDays : 1,
            degraded: raw.degraded === 'mock' || raw.providerStatus === 'mock' ? 'mock' : 'real',
            // evalCurve 缺省时回落 DailySample.evalPassRate（单行 JSONL 文件会命中
            // 本对象分支——Phase 4 明细扩展合流时发现的丢分路径：evalPassRate
            // 是数字非数组，此前静默丢弃。曲线语义：当日单点）
            evalCurve: Array.isArray(raw.evalCurve)
              ? raw.evalCurve
              : typeof raw.evalPassRate === 'number'
                ? [{ date: raw.date, passRate: raw.evalPassRate }]
                : [],
            // knowledgeDelta 同理回落：DailySample.knowledgeDelta 是数字（entities 增量）
            knowledgeDelta:
              raw.knowledgeDelta && typeof raw.knowledgeDelta.concepts === 'number'
                ? { concepts: raw.knowledgeDelta.concepts, atoms: raw.knowledgeDelta.atoms ?? 0 }
                : typeof raw.knowledgeDelta === 'number'
                  ? { concepts: raw.knowledgeDelta, atoms: 0 }
                  : { concepts: 0, atoms: 0 },
            correctionBackflow: Array.isArray(raw.correctionBackflow) ? raw.correctionBackflow : [],
            lowScoreFeedback: Array.isArray(raw.lowScoreFeedback) ? raw.lowScoreFeedback : [],
            repeatFailures: Array.isArray(raw.repeatFailures) ? raw.repeatFailures : [],
            toolUsage: Array.isArray(raw.toolUsage) ? raw.toolUsage : [],
          });
        }
      } catch {
        // 非单对象 → 尝试 JSONL
      }
      if (!parsedAsObject) {
        // 格式 B：逐行收集统计口径（明细面留空——反哺/L4 消费接口对统计
        // 口径样本优雅降级为「无明细输入」，不误报）
        for (const line of content.split('\n').filter(Boolean)) {
          try {
            const row = JSON.parse(line) as Partial<EvolutionSampleFile> & {
              evalPassRate?: number | null;
              correctionReflows?: number;
              knowledgeDelta?: number | null;
              providerStatus?: 'real' | 'mock';
              daysSampled?: number;
            };
            if (typeof row.date === 'string' && row.date.length > 0) {
              samples.push({
                date: row.date,
                cycleDays: typeof row.cycleDays === 'number' ? row.cycleDays
                  : typeof row.daysSampled === 'number' ? row.daysSampled : 1,
                degraded: row.degraded === 'mock' || row.providerStatus === 'mock' ? 'mock' : 'real',
                // D3 统计行有当日 passRate——映射为单点曲线（明细评估曲线由其 summarizeSamples 承担）
                evalCurve:
                  typeof row.evalPassRate === 'number'
                    ? [{ date: row.date, passRate: row.evalPassRate }]
                    : Array.isArray(row.evalCurve) ? row.evalCurve : [],
                knowledgeDelta:
                  row.knowledgeDelta && typeof (row.knowledgeDelta as { concepts?: number }).concepts === 'number'
                    ? { concepts: (row.knowledgeDelta as { concepts: number }).concepts, atoms: 0 }
                    : typeof row.knowledgeDelta === 'number'
                      ? { concepts: row.knowledgeDelta, atoms: 0 }
                      : { concepts: 0, atoms: 0 },
                correctionBackflow: Array.isArray(row.correctionBackflow) ? row.correctionBackflow : [],
                lowScoreFeedback: Array.isArray(row.lowScoreFeedback) ? row.lowScoreFeedback : [],
                repeatFailures: Array.isArray(row.repeatFailures) ? row.repeatFailures : [],
                toolUsage: Array.isArray(row.toolUsage) ? row.toolUsage : [],
              });
            }
          } catch {
            // 坏行跳过
          }
        }
      }
    } catch {
      // 单文件损坏跳过（append-only 精神——不因一日坏样本阻断全周期读取）
    }
  }
  samples.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return samples;
}

/**
 * 取最新一日采样（无样本返回 null）。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function readLatestEvolutionSample(dataDir?: string): EvolutionSampleFile | null {
  const all = readEvolutionSamples(dataDir);
  return all.length > 0 ? all[all.length - 1]! : null;
}

// ────────────────────────────────────────────────────────────
// 反哺闭环输入适配（第七章二：采样数据 → harvest 入参）
// ────────────────────────────────────────────────────────────

/**
 * 采样数据 → harvest 低分差评入参。
 *
 * 两个来源合并（都是「真实使用中被纠错/被差评」的信号）：
 *   一、lowScoreFeedback（commons_rate 差评直采）
 *   二、correctionBackflow（人工纠正——纠正即差评，score 透传）
 *
 * 与 rule-harvest.ts 的 collectLowScoreRatings 阈值过滤衔接：
 * 此处不过滤（全量透出），阈值（LOW_SCORE_THRESHOLD=0.4）由
 * harvest 侧统一执行——单一职责。
 *
 * @param samples 采样文件数组
 * @returns 低分差评列表（harvest 入参形态）
 */
export function correctionBackflowToRatings(samples: EvolutionSampleFile[]): LowScoreRating[] {
  const ratings: LowScoreRating[] = [];
  for (const s of samples) {
    for (const f of s.lowScoreFeedback) {
      ratings.push({
        capabilityId: f.capabilityId,
        raterId: f.raterId,
        score: f.score,
        ...(f.comment ? { comment: f.comment } : {}),
      });
    }
    for (const c of s.correctionBackflow) {
      ratings.push({
        capabilityId: c.capabilityId,
        raterId: c.correctedBy,
        score: c.score,
        ...(c.comment ? { comment: c.comment } : {}),
      });
    }
  }
  return ratings;
}

/**
 * 采样数据 → harvest 反复失败入参。
 *
 * 多日样本按 capabilityId 聚合 failCount（跨日累加——周期统计语义），
 * lastReason 取最近一日。
 *
 * @param samples 采样文件数组
 * @returns 反复失败列表（harvest 入参形态）
 */
export function repeatFailuresToCases(samples: EvolutionSampleFile[]): RepeatFailCase[] {
  const byCap = new Map<string, RepeatFailCase>();
  for (const s of samples) {
    for (const f of s.repeatFailures) {
      const existing = byCap.get(f.capabilityId);
      if (existing) {
        existing.failCount += f.failCount;
        if (f.lastReason) existing.lastReason = f.lastReason;
      } else {
        byCap.set(f.capabilityId, {
          capabilityId: f.capabilityId,
          failCount: f.failCount,
          ...(f.lastReason ? { lastReason: f.lastReason } : {}),
        });
      }
    }
  }
  return Array.from(byCap.values());
}

// ────────────────────────────────────────────────────────────
// L4 高频工具候选（第七章三：采样统计 → 自写工具候选）
// ────────────────────────────────────────────────────────────

/** L4 候选缺省配置 */
export const DEFAULT_TOOL_CANDIDATE_OPTS = {
  /** 最小累计调用次数（低于此值不成候选——偶发使用不值得自写） */
  minInvokeCount: 5,
  /** 候选取 top N（按热度降序） */
  topN: 5,
} as const;

/**
 * 采样数据 → 高频工具候选（L4 自写工具管线第一步）。
 *
 * 热度公式：heat = invokeCount × (1 - successRate)
 *   —— 高频且低成功率的工具最值得 Agent 自写替代（复用持续采样统计）；
 *      successRate 缺省按 1.0（不惩罚——保守口径，只看频次）。
 *
 * @param samples 采样文件数组
 * @param opts 可选配置（minInvokeCount / topN）
 * @returns 候选列表（heat 降序，≤ topN）
 */
export function toolCandidatesFromSamples(
  samples: EvolutionSampleFile[],
  opts?: Partial<typeof DEFAULT_TOOL_CANDIDATE_OPTS>,
): ToolCandidate[] {
  const config = { ...DEFAULT_TOOL_CANDIDATE_OPTS, ...opts };
  const byTool = new Map<string, ToolCandidate>();
  for (const s of samples) {
    for (const t of s.toolUsage) {
      const successRate = typeof t.successRate === 'number' ? Math.min(Math.max(t.successRate, 0), 1) : 1;
      const heat = t.invokeCount * (1 - successRate);
      const existing = byTool.get(t.toolName);
      if (existing) {
        existing.invokeCount += t.invokeCount;
        existing.heat += heat;
        if (t.candidateHint) existing.hint = t.candidateHint;
      } else {
        byTool.set(t.toolName, {
          toolName: t.toolName,
          invokeCount: t.invokeCount,
          heat,
          ...(t.candidateHint ? { hint: t.candidateHint } : {}),
        });
      }
    }
  }
  return Array.from(byTool.values())
    .filter((c) => c.invokeCount >= config.minInvokeCount)
    .sort((a, b) => b.heat - a.heat)
    .slice(0, config.topN);
}

// ────────────────────────────────────────────────────────────
// 台账衔接（D3 skill-evolution 合流 · 2026-09-05）
// ────────────────────────────────────────────────────────────

/**
 * 反哺闭环晋升结果 → D3 的 skill-impact 台账落账。
 *
 * 消费 D3 的 appendSkillImpactEntry（skill-evolution/skill-impact-ledger.ts）：
 * 反哺闭环 promote 出的每条 builtin 规则，作为一次「可回滚变更提案被
 * 接受」记录进技能进化台账——「技能变更」与「run」两本账在进化事件上
 * 汇流（devlog 第七章四：Proposer 的食粮）。依赖单向（skill-evolution
 * 不 import 本文件）。
 *
 * @param dataDir 数据目录
 * @param promoted 晋升的规则（来自 promoteRules）
 * @param benchmarks 对应 Benchmark 证据（scoreDelta→evalScore 映射）
 * @returns 落账条数
 */
export function logPromotionsToSkillImpact(
  dataDir: string,
  promoted: Array<{ id: string; description: string }>,
  benchmarks: Array<{ ruleId: string; scoreDelta: number; benchmarkHash: string }>,
): number {
  // 静态 import（顶部已引入 appendSkillImpactEntry——D3 合流后依赖真实存在，
  // 无需延迟 require；此前延迟 require 在 vitest src 态无法解析 .ts 路径）
  const benchMap = new Map(benchmarks.map((b) => [b.ruleId, b]));
  const ts = new Date().toISOString();
  let logged = 0;
  for (const rule of promoted) {
    const bench = benchMap.get(rule.id);
    appendSkillImpactEntry(dataDir, {
      proposalId: `feedback-loop-${rule.id}-${ts}`,
      ts,
      skillPath: 'builtin://quality-rule-set',
      slug: rule.id,
      solvesPattern: rule.description,
      unifiedDiff: '', // 规则晋升无文本 diff——unifiedDiff 为空串（台账 schema 允许）
      evalScore: typeof bench?.scoreDelta === 'number' ? bench.scoreDelta : null,
      historicalBest: null, // 规则集无历史分线——由 D3 的 historicalBestScore 消费方维护
      verdict: 'accepted',
      actor: 'evolution-feedback-loop',
    });
    logged++;
  }
  return logged;
}
