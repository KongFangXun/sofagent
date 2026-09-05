// ============================================================
// dream-cycle/continuous-sampler.ts · 持续样本采集（v1.4.5 第七章一）
// ============================================================
//
// 「越用越好」宣称当前仅 11 个一次性测试 Case——补法是 Dream Cycle
// 连续运行 ≥7 天持续采样（开发日志第七章一）：
//   每日 eval passRate 曲线 + 知识库条目增量 + 修正回流统计，
//   落盘 data/evolution/samples-<date>.json（每日追加，跨 daemon
//   重启可续——cursor.json 记采样进度）。
//
// 以真脑为前提（第七章五硬前置）：采样记录 providerStatus，降级轮
//（status=mock）单独计数并醒目标注——「占位符跑 7 天」永不默默发生。
//
// 复用不重复实现：
//   - eval passRate：读 benchmarks/<id>/evaluation-log.jsonl（v1.3.7
//     appendEvaluationRecord 的落盘，HMAC 链防篡改——原始 eval 记录
//     即证据树的叶子）
//   - 知识库增量：数 knowledge/entities/*.md 条目数
//   - 修正回流：数 instinct/failure-log.jsonl 条目数（v1.3.5 错题本）
//   - Dream Cycle 本轮：runDreamCycle（Provider 注入式，真脑缺省）
//
// 明细四件（Phase 4 尾巴 · D4 桥消费面对齐——
// engine/orchestrator/src/evolution/evolution-samples.ts 同名字段）：
//   DailySample 可选携带 correctionBackflow/lowScoreFeedback/
//   repeatFailures/toolUsage 明细数组（有则填无则空——序列化时空
//   数组省略字段，向后兼容）。源数据：commons/ratings.jsonl +
//   commons/invoke-log.jsonl + instinct/failure-log.jsonl（复用既有
//   落盘，只读）。D4 桥的 JSONL 读侧对明细字段透传——生产链路
//   （采样→反哺→L4）经此对接，无需桥侧再降级。
// ============================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { resolveDataDir } from '@sofagent/core';

import { runDreamCycle } from './state-machine';

/** 采样目标周期（天）——开发日志第七章一验收线 */
export const SAMPLE_TARGET_DAYS = 7;

// ── 明细口径四类型（v1.4.5 Phase 4 尾巴——与 D4 桥
// engine/orchestrator/src/evolution/evolution-samples.ts 的同名类型
// 字段级对齐，采样侧只做收集不做转换）──────────────────────

/** 修正回流明细（人纠正 Agent 输出的记录——反哺闭环输入） */
export interface CorrectionBackflow {
  /** 被纠正的能力/节点 ID */
  capabilityId: string;
  /** 纠正者（人审者 agentId） */
  correctedBy: string;
  /** 纠正前评分（0.0~1.0——纠正意味着原输出不达标） */
  score: number;
  /** 纠正说明 */
  comment?: string;
  /** 纠正时间 ISO */
  correctedAt: string;
}

/** 低分差评明细（commons ratings 中 score < 0.5 的当日记录——harvest 源一） */
export interface LowScoreFeedback {
  capabilityId: string;
  raterId: string;
  score: number;
  comment?: string;
}

/** 反复失败明细（invoke-log 聚合 failCount ≥ 2 的当日能力——harvest 源二） */
export interface RepeatFailure {
  capabilityId: string;
  failCount: number;
  lastReason?: string;
}

/** 工具调用统计明细（invoke-log 当日聚合——L4 高频工具候选源） */
export interface ToolUsageStat {
  /** 工具名（commons capabilityId） */
  toolName: string;
  /** 采样周期内调用次数 */
  invokeCount: number;
  /** 成功率（0.0~1.0——低成功率高频工具有自写替代价值） */
  successRate?: number;
  /** Agent 提出的自写候选来源描述 */
  candidateHint?: string;
}

/** 单日样本结构（samples-<date>.json 的一行） */
export interface DailySample {
  /** 采样日期（ISO 8601 date，本地时区） */
  date: string;
  /** 当日 eval passRate（0-1；无 eval 记录时 null——如实记缺数） */
  evalPassRate: number | null;
  /** 当日评测 case 总数（evalPassRate 的分母） */
  evalCaseCount: number;
  /** 知识库 entities 条目总数（存量口径） */
  knowledgeEntities: number;
  /** 相对前一日的新增条目数（首日为全量） */
  knowledgeDelta: number | null;
  /** 错题本（修正回流）累计条目数 */
  correctionReflows: number;
  /** Dream Cycle 本轮是否完整跑完六阶段 */
  dreamCycleComplete: boolean;
  /** 大脑状态（'real'=真脑；'mock'=降级轮——采样标注位） */
  providerStatus: 'real' | 'mock';
  /** 降级原因（providerStatus='mock' 时非空） */
  degradedReason?: string;
  /**
   * 修正回流明细（Phase 4 尾巴——可选：源数据在场则填，不在场为空数组）。
   * 计数器 correctionReflows 保留（错题本累计口径），明细与计数器并存不互斥。
   */
  correctionBackflow?: CorrectionBackflow[];
  /** 低分差评明细（可选——commons/ratings.jsonl 当日 score<0.5 记录） */
  lowScoreFeedback?: LowScoreFeedback[];
  /** 反复失败明细（可选——commons/invoke-log.jsonl 当日 failCount≥2 聚合） */
  repeatFailures?: RepeatFailure[];
  /** 工具调用统计明细（可选——commons/invoke-log.jsonl 当日聚合） */
  toolUsage?: ToolUsageStat[];
  /** 采样时间戳（ISO 8601） */
  sampledAt: string;
}

/** 采样进度游标（cursor.json——跨 daemon 重启可续） */
export interface SamplerCursor {
  /** 上次采样日期（ISO date） */
  lastSampleDate: string;
  /** 已累计采样天数（含降级轮） */
  daysSampled: number;
  /** 其中降级轮天数（providerStatus=mock） */
  mockDays: number;
  /** 首日基线（entities 存量——增量口径的锚点） */
  baselineEntities: number | null;
}

/** 采样结果（collectDailySample 返回） */
export interface SampleResult {
  /** 落盘的日样本 */
  sample: DailySample;
  /** 更新后的游标 */
  cursor: SamplerCursor;
  /** 样本文件绝对路径（证据树：结论→样本文件→eval 记录） */
  sampleFilePath: string;
  /** 是否已达采样目标（daysSampled ≥ 7 且 mockDays=0 才算达标） */
  targetReached: boolean;
}

/** evolution 目录（data/evolution/） */
export function evolutionDir(dataDir: string): string {
  return join(dataDir, 'evolution');
}

/** 日样本文件路径（samples-<date>.json——每日一文件，追加行） */
export function sampleFilePath(dataDir: string, date: string): string {
  return join(evolutionDir(dataDir), `samples-${date}.json`);
}

/** 采样游标路径（cursor.json） */
export function cursorFilePath(dataDir: string): string {
  return join(evolutionDir(dataDir), 'cursor.json');
}

/** 读游标（缺失/损坏 → 空游标——跨重启可续的数据锚） */
export function loadCursor(dataDir: string): SamplerCursor {
  const path = cursorFilePath(dataDir);
  if (!existsSync(path)) {
    return { lastSampleDate: '', daysSampled: 0, mockDays: 0, baselineEntities: null };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<SamplerCursor>;
    return {
      lastSampleDate: typeof parsed.lastSampleDate === 'string' ? parsed.lastSampleDate : '',
      daysSampled: Number.isFinite(parsed.daysSampled) ? Number(parsed.daysSampled) : 0,
      mockDays: Number.isFinite(parsed.mockDays) ? Number(parsed.mockDays) : 0,
      baselineEntities: Number.isFinite(parsed.baselineEntities) ? Number(parsed.baselineEntities) : null,
    };
  } catch {
    return { lastSampleDate: '', daysSampled: 0, mockDays: 0, baselineEntities: null };
  }
}

/** 写游标（原子写经 tmp+rename——采样进度不因半写丢失） */
function saveCursor(dataDir: string, cursor: SamplerCursor): void {
  const dir = evolutionDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const finalPath = cursorFilePath(dataDir);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(cursor, null, 2), 'utf-8');
  require('fs').renameSync(tmpPath, finalPath);
}

/** 数 knowledge/entities/*.md 条目数（缺目录 → 0） */
export function countKnowledgeEntities(dataDir: string): number {
  const entitiesDir = join(dataDir, 'knowledge', 'entities');
  if (!existsSync(entitiesDir)) return 0;
  try {
    return readdirSync(entitiesDir).filter((f) => f.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

/** 数 instinct/failure-log.jsonl 条目数（缺文件 → 0；坏行跳过） */
export function countCorrectionReflows(dataDir: string): number {
  const logPath = join(dataDir, 'instinct', 'failure-log.jsonl');
  if (!existsSync(logPath)) return 0;
  try {
    return readFileSync(logPath, 'utf-8').split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/**
 * 读 benchmark evaluation-log 统计当日 passRate。
 * score>=60 记通过（与 runEvalSuite passedCases 口径一致）。
 * 无记录 → { passRate: null, caseCount: 0 }（如实记缺数，不造假样本）。
 */
export function readDailyEvalStats(
  dataDir: string,
  date: string,
  benchmarkId?: string,
): { passRate: number | null; caseCount: number } {
  const benchmarksDir = join(dataDir, 'benchmarks');
  if (!existsSync(benchmarksDir)) return { passRate: null, caseCount: 0 };
  const ids = benchmarkId
    ? [benchmarkId]
    : (() => {
        try { return readdirSync(benchmarksDir); } catch { return []; }
      })();
  let total = 0;
  let passed = 0;
  for (const id of ids) {
    const logPath = join(benchmarksDir, id, 'evaluation-log.jsonl');
    if (!existsSync(logPath)) continue;
    try {
      const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as { ts?: string; score?: number };
          if (typeof rec.ts === 'string' && rec.ts.slice(0, 10) === date) {
            total += 1;
            if (typeof rec.score === 'number' && rec.score >= 60) passed += 1;
          }
        } catch {
          // 坏行跳过（与 evaluation-log 读侧宽松语义一致）
        }
      }
    } catch {
      // 单 benchmark 读失败跳过
    }
  }
  return { passRate: total > 0 ? passed / total : null, caseCount: total };
}

// ── 明细四件收集（Phase 4 尾巴 · v1.4.5）─────────────────
// 源数据（复用 orchestrator 既有落盘，只读不写——单一出口原则）：
//   commons/ratings.jsonl      → lowScoreFeedback（当日 score<0.5）+ correctionBackflow（评分随带 comment 的纠正记录）
//   commons/invoke-log.jsonl   → repeatFailures（当日 failCount≥2）+ toolUsage（当日聚合）
//   instinct/failure-log.jsonl → correctionBackflow 兜底源（错题本当日新增行）
// 源文件缺失/损坏 → 该明细为空数组（有则填无则空——不造数不崩）。

/** 明细四件聚合结果 */
interface DailyDetails {
  correctionBackflow: CorrectionBackflow[];
  lowScoreFeedback: LowScoreFeedback[];
  repeatFailures: RepeatFailure[];
  toolUsage: ToolUsageStat[];
}

/** 空明细（skipDetails / 全源缺失时的返回——字段级显式空，序列化时省略） */
function emptyDailyDetails(): DailyDetails {
  return {
    correctionBackflow: [],
    lowScoreFeedback: [],
    repeatFailures: [],
    toolUsage: [],
  };
}

/** 宽松读 JSONL（缺文件/坏行跳过——与既有读侧语义一致） */
function readJsonlLoose(filePath: string): Array<Record<string, unknown>> {
  if (!existsSync(filePath)) return [];
  try {
    const rows: Array<Record<string, unknown>> = [];
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // 坏行跳过
      }
    }
    return rows;
  } catch {
    return [];
  }
}

/** 行时间戳取日期前缀（无 ts 字段按不在当日处理——fail-safe 不误收） */
function rowDate(row: Record<string, unknown>, tsKey: string): string {
  const ts = row[tsKey];
  return typeof ts === 'string' ? ts.slice(0, 10) : '';
}

/**
 * 收集当日明细四件（Phase 4 尾巴——D4 桥消费面口径）。
 *
 * 一、correctionBackflow：两源合并——① ratings.jsonl 当日带 comment 的低分记录
 *    （评价即纠正语义：score<0.5 + comment = 人指出问题）② 错题本当日新增行
 *    （audit/refine 来源的失败记录——context 即纠正上下文）。
 * 二、lowScoreFeedback：ratings.jsonl 当日 score<0.5 记录（harvest 源一）。
 * 三、repeatFailures：invoke-log.jsonl 当日 failed 聚合，failCount≥2 才收
 *    （单次失败可能是噪声——反复失败才是 harvest 源二）。
 * 四、toolUsage：invoke-log.jsonl 当日全量聚合（L4 候选源——高频低成功率最热）。
 */
export function collectDailyDetails(dataDir: string, date: string): DailyDetails {
  const details = emptyDailyDetails();

  // 一·二、commons ratings（评分与纠正）
  const ratings = readJsonlLoose(join(dataDir, 'commons', 'ratings.jsonl'));
  for (const row of ratings) {
    if (rowDate(row, 'ratedAt') !== date) continue;
    const capabilityId = typeof row.capabilityId === 'string' ? row.capabilityId : null;
    const raterId = typeof row.raterId === 'string' ? row.raterId : null;
    const score = typeof row.score === 'number' ? row.score : null;
    if (!capabilityId || !raterId || score === null) continue;
    if (score >= 0.5) continue; // 低分阈值 0.5——harvest 源一口径
    const comment = typeof row.comment === 'string' && row.comment.length > 0 ? row.comment : undefined;
    details.lowScoreFeedback.push({
      capabilityId,
      raterId,
      score,
      ...(comment ? { comment } : {}),
    });
    // 带 comment 的低分 = 人给出纠正说明 → 同时进修正回流明细
    if (comment) {
      details.correctionBackflow.push({
        capabilityId,
        correctedBy: raterId,
        score,
        comment,
        correctedAt: typeof row.ratedAt === 'string' ? row.ratedAt : `${date}T00:00:00.000Z`,
      });
    }
  }

  // 一·补、错题本当日成立的失败记录（修正回流兜底源——audit/refine 语义）
  const failures = readJsonlLoose(join(dataDir, 'instinct', 'failure-log.jsonl'));
  for (const row of failures) {
    if (rowDate(row, 'timestamp') !== date) continue;
    const pattern = typeof row.pattern === 'string' ? row.pattern : null;
    if (!pattern) continue;
    details.correctionBackflow.push({
      capabilityId: `failure-pattern:${pattern.slice(0, 60)}`,
      correctedBy: 'instinct/failure-log',
      score: 0,
      comment: typeof row.context === 'string' && row.context.length > 0 ? row.context : undefined,
      correctedAt: typeof row.timestamp === 'string' ? row.timestamp : `${date}T00:00:00.000Z`,
    });
  }

  // 三·四、commons invoke-log（反复失败 + 工具调用统计）
  const invokes = readJsonlLoose(join(dataDir, 'commons', 'invoke-log.jsonl'));
  const byTool = new Map<string, { total: number; failed: number; lastReason?: string }>();
  for (const row of invokes) {
    if (rowDate(row, 'ts') !== date) continue;
    const capabilityId = typeof row.capabilityId === 'string' ? row.capabilityId : null;
    if (!capabilityId) continue;
    const outcome = typeof row.outcome === 'string' ? row.outcome : '';
    const agg = byTool.get(capabilityId) ?? { total: 0, failed: 0 };
    agg.total += 1;
    if (outcome === 'failed' || outcome === 'blocked') {
      agg.failed += 1;
      // scanVerdict 携带失败原因（SkillScan 判定文本）
      if (typeof row.scanVerdict === 'string' && row.scanVerdict.length > 0) {
        agg.lastReason = row.scanVerdict;
      }
    }
    byTool.set(capabilityId, agg);
  }
  for (const [toolName, agg] of byTool) {
    details.toolUsage.push({
      toolName,
      invokeCount: agg.total,
      successRate: agg.total > 0 ? (agg.total - agg.failed) / agg.total : undefined,
    });
    if (agg.failed >= 2) {
      details.repeatFailures.push({
        capabilityId: toolName,
        failCount: agg.failed,
        ...(agg.lastReason ? { lastReason: agg.lastReason } : {}),
      });
    }
  }

  return details;
}

/** 今日日期（ISO date，本地时区——采样按自然日切分） */
function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 采集一个日样本（幂等：当日已采则跳过 Dream Cycle 重跑，直接返回现状）。
 *
 * 流程：跑一轮 Dream Cycle（真脑缺省）→ 统计 eval/知识库/错题本 →
 * 追加 samples-<date>.json → 更新 cursor.json。
 *
 * @param opts.benchmarkId 限定统计的 benchmark（缺省扫全部）
 * @param opts.skipDreamCycle 测试用：跳过 Dream Cycle（只统计落盘）
 * @param opts.providerOverride 测试用：覆盖 providerStatus 断言
 */
export async function collectDailySample(
  dataDir: string,
  opts?: {
    benchmarkId?: string;
    skipDreamCycle?: boolean;
    providerOverride?: 'real' | 'mock';
    /** Phase 4 尾巴：跳过明细四件收集（测试用/轻量采样场景） */
    skipDetails?: boolean;
  },
): Promise<SampleResult> {
  const date = todayISO();
  const cursor = loadCursor(dataDir);
  const alreadySampled = cursor.lastSampleDate === date;

  // 一、跑 Dream Cycle（真脑缺省——第七章一以真脑为前提）
  let dreamCycleComplete = true;
  let providerStatus: 'real' | 'mock' = 'real';
  let degradedReason: string | undefined;
  if (!alreadySampled && !opts?.skipDreamCycle) {
    const result = await runDreamCycle(dataDir, {});
    dreamCycleComplete = result.cycleComplete;
    providerStatus = result.providerStatus ?? 'real';
    degradedReason = result.degradedReason;
  }
  if (opts?.providerOverride) {
    providerStatus = opts.providerOverride;
  }

  // 二、统计三轴
  const evalStats = readDailyEvalStats(dataDir, date, opts?.benchmarkId);
  const entities = countKnowledgeEntities(dataDir);
  const reflows = countCorrectionReflows(dataDir);
  const knowledgeDelta = cursor.baselineEntities === null ? entities : entities - cursor.baselineEntities;

  // 二·补、明细四件（Phase 4 尾巴——源数据在场则填，不在场为空数组；
  // 失败静默为空不阻断采样主链：明细是增量信息，缺数好过错采）
  const details = opts?.skipDetails ? emptyDailyDetails() : collectDailyDetails(dataDir, date);

  // 三、落日样本（当日多行追加——重采不覆盖，最新行为准）
  const sample: DailySample = {
    date,
    evalPassRate: evalStats.passRate,
    evalCaseCount: evalStats.caseCount,
    knowledgeEntities: entities,
    knowledgeDelta,
    correctionReflows: reflows,
    dreamCycleComplete,
    providerStatus,
    ...(degradedReason ? { degradedReason } : {}),
    ...(details.correctionBackflow.length > 0 ? { correctionBackflow: details.correctionBackflow } : {}),
    ...(details.lowScoreFeedback.length > 0 ? { lowScoreFeedback: details.lowScoreFeedback } : {}),
    ...(details.repeatFailures.length > 0 ? { repeatFailures: details.repeatFailures } : {}),
    ...(details.toolUsage.length > 0 ? { toolUsage: details.toolUsage } : {}),
    sampledAt: new Date().toISOString(),
  };
  const sPath = sampleFilePath(dataDir, date);
  mkdirSync(evolutionDir(dataDir), { recursive: true });
  appendFileSync(sPath, JSON.stringify(sample) + '\n', 'utf-8');

  // 四、更新游标（当日首采才推进天数——幂等）
  const nextCursor: SamplerCursor = alreadySampled
    ? cursor
    : {
        lastSampleDate: date,
        daysSampled: cursor.daysSampled + 1,
        mockDays: cursor.mockDays + (providerStatus === 'mock' ? 1 : 0),
        baselineEntities: entities,
      };
  saveCursor(dataDir, nextCursor);

  return {
    sample,
    cursor: nextCursor,
    sampleFilePath: sPath,
    targetReached: nextCursor.daysSampled >= SAMPLE_TARGET_DAYS && nextCursor.mockDays === 0,
  };
}

/**
 * 读全部样本（evolution report 与 A/B 对照的数据源）。
 * 返回按文件名日期升序、文件内行序的完整样本序列。
 */
export function readAllSamples(dataDir: string): DailySample[] {
  const dir = evolutionDir(dataDir);
  if (!existsSync(dir)) return [];
  const samples: DailySample[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^samples-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  } catch {
    return [];
  }
  for (const file of files) {
    try {
      const lines = readFileSync(join(dir, file), 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          samples.push(JSON.parse(line) as DailySample);
        } catch {
          // 坏行跳过
        }
      }
    } catch {
      // 单文件读失败跳过
    }
  }
  return samples;
}

/**
 * 汇总采样状态（evolution report / 门面输出消费）。
 * mockDays > 0 时结论必须带降级标注——三级证据强度里的「自测自报」
 * 在降级轮存在时不得声称达标。
 */
export function summarizeSamples(samples: DailySample[]): {
  days: number;
  mockDays: number;
  passRateSeries: Array<{ date: string; passRate: number | null }>;
  knowledgeGrowth: Array<{ date: string; entities: number; delta: number | null }>;
  firstDate: string | null;
  lastDate: string | null;
  targetReached: boolean;
} {
  const days = samples.length;
  const mockDays = samples.filter((s) => s.providerStatus === 'mock').length;
  const firstDate = samples.length > 0 ? samples[0]!.date : null;
  const lastDate = samples.length > 0 ? samples[samples.length - 1]!.date : null;
  return {
    days,
    mockDays,
    passRateSeries: samples.map((s) => ({ date: s.date, passRate: s.evalPassRate })),
    knowledgeGrowth: samples.map((s) => ({ date: s.date, entities: s.knowledgeEntities, delta: s.knowledgeDelta })),
    firstDate,
    lastDate,
    targetReached: days >= SAMPLE_TARGET_DAYS && mockDays === 0,
  };
}
