// train-continuous.ts · v1.4.5 第二章 · 持续后训练（飞轮闭环的「持续」环）
//
// 定位：后训模块有了「训一次」（train-job v1.4.1），缺「定期增量训」。
// 本模块是增量训练编排：数据回流（worklog + decision-log + llm-calls
// 飞轮数据源，与 v1.4.5 语料导出同源）→ 触发判定（数据阈值 / 定时
// @weekly / 人工三模式）→ 复用 train-job 编排 + 数据管道 → eval 回退保护。
//
// 🚧 边界声明（devlog §二 2026-08-26）：本模块 = 数据回流 + 触发策略 +
// 回退保护（规则驱动的增量再训）。**不延伸至** on-policy self-distillation
// / online RL（权重级 continual learning 属商业模型层——开源后训模块只
// 提供数据回流管道与再训编排）。
//
// ── spec（最小接口签名 + 数据结构 · spec-first）──
//
//   type ContinuousTrigger = 'data-threshold' | 'schedule' | 'manual';
//
//   interface TriggerPolicy {
//     minNewSamples: number;        // 数据阈值（缺省 50——回流样本不足不训）
//     maxIntervalDays: number;      // 定时间隔（缺省 7 = @weekly）
//   }
//
//   interface FlywheelSnapshot {
//     collectedAt: string;
//     newSamples: number;           // 自上次增量训练以来的新回流样本数
//     sources: Record<string, number>;  // 各源计数（worklog/decision-log/llm-calls）
//     lastTrainAt: string | null;
//   }
//
//   interface ContinuousRunResult {
//     trigger: ContinuousTrigger;
//     decided: 'train' | 'skip';
//     reason: string;
//     trainJobId?: string;          // decided=train 时新 job
//     newDatasetVersion?: string;   // 增量数据集版本
//     promotion?: 'promoted' | 'rolled-back';
//     evalScore?: number;           // 增量后 eval 分
//     baselineScore?: number;       // 基线分
//   }
//
//   function collectFlywheelSamples(dataDir, since): FlywheelSnapshot;   // 数据回流
//   function shouldTrigger(snapshot, policy, now): { fire, trigger, reason };
//   function runContinuousTraining(input): Promise<ContinuousRunResult>;  // 编排主流程
//
// 复用声明（铁律：复用不重写）：
//   - 训练编排：createTrainScheduler.submitTrainJob（v1.4.1——不重复实现）
//   - 数据管道：buildAndPersistDataset（v1.4.2 dataset-builder）
//   - 飞轮数据源：worklog + decision-log + llm-calls（v1.4.4 语料导出同源）
//   - 回退保护：registerTrainArtifact（v1.4.4 产物注册）+ rollbackWeightsVersion
//     （权重回拨）+ compareEvalReports（eval 对比）
//   - 合规闸：scanAndGate（v1.4.5 第三章——增量数据同样过闸）

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildAndPersistDataset } from './dataset-builder';
import type { IngestRecord } from './data-ingest';
import { scanAndGate, ComplianceGateError, type DataProvenance } from './train-compliance';
import type { TrainEvalReport } from './train-eval-loop';

// ════════════════════════════════════════
// 数据模型（spec 落地）
// ════════════════════════════════════════

/** 触发模式三态（数据阈值 / 定时 / 人工） */
export type ContinuousTrigger = 'data-threshold' | 'schedule' | 'manual';

/** 触发策略（规则驱动——阈值外部化，部署侧可调） */
export interface TriggerPolicy {
  /** 数据阈值：自上次增量训练以来的新回流样本数下限（缺省 50） */
  minNewSamples: number;
  /** 定时间隔天数（缺省 7 = @weekly——超期无训练即定时触发） */
  maxIntervalDays: number;
}

export const DEFAULT_TRIGGER_POLICY: TriggerPolicy = {
  minNewSamples: 50,
  maxIntervalDays: 7,
};

/** 飞轮数据快照（数据回流观测） */
export interface FlywheelSnapshot {
  collectedAt: string;
  /** 自 since 以来的新回流样本数（三源合计） */
  newSamples: number;
  /** 各源计数（worklog / decision-log / llm-calls——与语料导出同源命名） */
  sources: Record<string, number>;
  /** 上次增量训练时间（无历史 → null） */
  lastTrainAt: string | null;
}

/** 触发判定结论 */
export interface TriggerDecision {
  fire: boolean;
  /** 命中的触发模式（fire=false 时为「最接近的模式」——观测用） */
  trigger: ContinuousTrigger;
  reason: string;
}

/** 单轮持续训练结果 */
export interface ContinuousRunResult {
  trigger: ContinuousTrigger;
  /** train = 已提交增量训练；skip = 触发条件未满足（跳过本轮） */
  decided: 'train' | 'skip';
  reason: string;
  /** decided=train 时的增量训练 job 标识 */
  trainJobId?: string;
  /** decided=train 时的新数据集版本（合规打标后的 -c 版） */
  newDatasetVersion?: string;
  /** 晋升 / 回退结论（eval 跑完才有） */
  promotion?: 'promoted' | 'rolled-back';
  /** 增量后 eval 分 */
  evalScore?: number;
  /** 基线分（对比锚） */
  baselineScore?: number;
}

// ════════════════════════════════════════
// 飞轮数据回流（worklog + decision-log + llm-calls——语料导出同源）
// ════════════════════════════════════════

/** JSONL 安全解析（坏行跳过——append-only 文件读侧容错惯例） */
function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      out.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}

/**
 * 飞轮数据回流采集（三源计数 + 样本提取——与 v1.4.4 语料导出同源）。
 *
 * 三源（devlog §二：worklog v1.3.9 节点耗时+人工介入 / decision-log /
 * llm-calls——v1.4.4 语料导出同源）：
 *   - decision-log：data/audit/decision-log.jsonl（决策理由文本——SFT 指令源）
 *   - llm-calls：data/audit/runtime/llm-calls.jsonl（调用轨迹——输入输出对）
 *   - worklog：data/worklog/*.jsonl（节点耗时 + 人工介入记录——若在则计数）
 *
 * since 过滤：ts/时间字段早于 since 的条目不计（增量口径）。
 */
export function collectFlywheelSamples(
  dataDir: string,
  since: string | null,
  now: () => number = Date.now,
): FlywheelSnapshot {
  const sources: Record<string, number> = {};
  const sinceMs = since !== null ? new Date(since).getTime() : 0;

  // 一、decision-log（决策理由——why.text 是高质量指令源）
  const decisions = readJsonl(join(dataDir, 'audit', 'decision-log.jsonl'));
  const decisionsNew = decisions.filter((d) => {
    const ts = typeof d.ts === 'string' ? new Date(d.ts).getTime() : NaN;
    return Number.isFinite(ts) && ts >= sinceMs;
  });
  sources['decision-log'] = decisionsNew.length;

  // 二、llm-calls（调用轨迹——rawResponse 含输入输出对）
  const llmCalls = readJsonl(join(dataDir, 'audit', 'runtime', 'llm-calls.jsonl'));
  const llmNew = llmCalls.filter((c) => {
    const ts = typeof c.ts === 'string' ? new Date(c.ts).getTime() : NaN;
    return Number.isFinite(ts) && ts >= sinceMs;
  });
  sources['llm-calls'] = llmNew.length;

  // 三、worklog（节点耗时 + 人工介入——worklog 数据层文件，存在则计数）
  const worklogPath = join(dataDir, 'worklog', 'entries.jsonl');
  const worklog = readJsonl(worklogPath);
  const worklogNew = worklog.filter((w) => {
    const ts = typeof w.ts === 'string' ? new Date(w.ts).getTime() : NaN;
    return Number.isFinite(ts) && ts >= sinceMs;
  });
  sources['worklog'] = worklogNew.length;

  // 上次增量训练时间：continuous-state.json（本模块状态文件——见 runContinuousTraining）
  let lastTrainAt: string | null = null;
  const statePath = join(dataDir, 'train', 'continuous-state.json');
  if (existsSync(statePath)) {
    try {
      const st = JSON.parse(readFileSync(statePath, 'utf-8')) as { lastTrainAt?: string };
      if (typeof st.lastTrainAt === 'string') lastTrainAt = st.lastTrainAt;
    } catch {
      lastTrainAt = null; // 坏状态文件按无历史处理
    }
  }

  return {
    collectedAt: new Date(now()).toISOString(),
    newSamples: decisionsNew.length + llmNew.length + worklogNew.length,
    sources,
    lastTrainAt,
  };
}

/** 飞轮样本 → 中间格式记录（喂 buildAndPersistDataset——复用 v1.4.2 数据管道） */
export function flywheelToIngestRecords(
  dataDir: string,
  since: string | null,
): { records: IngestRecord[]; columns: string[] } {
  const sinceMs = since !== null ? new Date(since).getTime() : 0;
  const records: IngestRecord[] = [];

  // decision-log →（instruction=决策理由，output=决策种类）
  for (const d of readJsonl(join(dataDir, 'audit', 'decision-log.jsonl'))) {
    const ts = typeof d.ts === 'string' ? new Date(d.ts).getTime() : NaN;
    if (!Number.isFinite(ts) || ts < sinceMs) continue;
    const why = d.why as { text?: string } | undefined;
    const instruction = typeof why?.text === 'string' ? why.text : '';
    if (instruction.trim() === '') continue;
    records.push({
      id: `decision-log#${String(d.ts ?? '')}`,
      source: 'decision-log',
      fields: { instruction, output: String(d.kind ?? ''), input: String(d.agentId ?? '') },
    });
  }
  // llm-calls →（instruction=模型+终止原因上下文，output=原始响应摘要）
  for (const c of readJsonl(join(dataDir, 'audit', 'runtime', 'llm-calls.jsonl'))) {
    const ts = typeof c.ts === 'string' ? new Date(c.ts).getTime() : NaN;
    if (!Number.isFinite(ts) || ts < sinceMs) continue;
    const raw = typeof c.rawResponse === 'string' ? c.rawResponse.slice(0, 2000) : '';
    if (raw.trim() === '') continue;
    records.push({
      id: `llm-calls#${String(c.ts ?? '')}#${String(c.model ?? '')}`,
      source: 'llm-calls',
      fields: {
        instruction: `模型 ${String(c.model ?? '')} 调用（${String(c.stopReason ?? '')}）`,
        output: raw,
        input: '',
      },
    });
  }
  return { records, columns: ['instruction', 'input', 'output'] };
}

// ════════════════════════════════════════
// 触发判定（纯函数——三模式）
// ════════════════════════════════════════

/**
 * 触发判定（规则驱动——数据阈值 / 定时 @weekly 两自动模式 + manual 走旁路）。
 *
 * 判定序（先数据后时间——数据红利优先吃）：
 *   1. 新样本 ≥ minNewSamples → fire（trigger=data-threshold）
 *   2. 距上次训练 ≥ maxIntervalDays 天（或从未训过）→ fire（trigger=schedule）
 *   3. 都不满足 → skip（reason 说明差多少）
 * manual 由调用方直接传 trigger='manual' 绕过本判定（人工触发无条件执行）。
 */
export function shouldTrigger(
  snapshot: FlywheelSnapshot,
  policy: TriggerPolicy = DEFAULT_TRIGGER_POLICY,
  now: () => number = Date.now,
): TriggerDecision {
  if (snapshot.newSamples >= policy.minNewSamples) {
    return {
      fire: true,
      trigger: 'data-threshold',
      reason: `新回流样本 ${snapshot.newSamples} ≥ 阈值 ${policy.minNewSamples}（${Object.entries(snapshot.sources).filter(([, n]) => n > 0).map(([s, n]) => `${s}:${n}`).join(' +')}）——数据红利优先吃`,
    };
  }
  const intervalMs = policy.maxIntervalDays * 86400_000;
  const lastTrainAt = snapshot.lastTrainAt;
  const neverTrained = lastTrainAt === null;
  const sinceLast = neverTrained
    ? Number.POSITIVE_INFINITY
    : now() - new Date(lastTrainAt).getTime();
  if (neverTrained || sinceLast >= intervalMs) {
    return {
      fire: true,
      trigger: 'schedule',
      reason: neverTrained
        ? `从未增量训练过（已有 ${snapshot.newSamples} 样本积累）——定时触发（@${policy.maxIntervalDays}d 口径）`
        : `距上次训练 ${Math.floor(sinceLast / 86400_000)} 天 ≥ ${policy.maxIntervalDays} 天——定时触发（@weekly 口径）`,
    };
  }
  return {
    fire: false,
    trigger: 'data-threshold',
    reason: `样本 ${snapshot.newSamples}/${policy.minNewSamples} 未达阈值，距上次训练 ${Math.floor(sinceLast / 86400_000)}/${policy.maxIntervalDays} 天未超期——本轮跳过`,
  };
}

// ════════════════════════════════════════
// 编排主流程
// ════════════════════════════════════════

/** 编排依赖注入（测试——调度器/eval/注册全部可换） */
export interface ContinuousDeps {
  /** 提交训练（缺省——须调用方注入 createTrainScheduler().submitTrainJob 绑定实例） */
  submitTrain?: (input: {
    dataPath: string;
    baseModel: string;
    algorithm: 'sft' | 'dpo' | 'grpo';
  }) => Promise<{ jobId: string; waitForDone: Promise<{ status: string; outputDir?: string }> }>;
  /** 增量训练后 eval（缺省 null = 跳过 eval——晋升/回退直接按基线判） */
  runEval?: (trainJobId: string, datasetVersion: { datasetId: string; version: string }) => Promise<TrainEvalReport>;
  /** eval 基线（对比锚——缺省 null 首轮无基线） */
  baseline?: TrainEvalReport | null;
  /** 产物注册（回退保护的前半——eval 过闸才注册） */
  registerArtifact?: (trainJobId: string, evalReport: TrainEvalReport) => Promise<{ ok: boolean; message: string }>;
  /** 权重回拨（回退保护的后半——eval 不过闸回滚旧权重） */
  rollbackWeights?: (modelName: string) => Promise<{ ok: boolean; message: string }>;
  /** 时钟注入 */
  now?: () => number;
}

/** 编排入参 */
export interface RunContinuousInput {
  dataDir: string;
  enterpriseId: string;
  /** 基座模型（增量训练起点——通常是当前生产权重对应基座） */
  baseModel: string;
  /** 触发模式（manual = 无条件执行；其余走 shouldTrigger 判定） */
  trigger: ContinuousTrigger;
  /** 触发策略（缺省 DEFAULT_TRIGGER_POLICY） */
  policy?: TriggerPolicy;
  /** 数据来源标记（缺省 enterprise——企业回流是主路径） */
  provenance?: DataProvenance;
  /** 依赖注入（测试） */
  deps?: ContinuousDeps;
}

/** 状态文件路径：data/train/continuous-state.json（跨企业共享——分企业语义在 job 层） */
export function continuousStatePath(dataDir: string): string {
  return join(dataDir, 'train', 'continuous-state.json');
}

/** 状态落盘（lastTrainAt 刷新——增量口径的锚点。失败不阻断主流程） */
function persistLastTrainAt(dataDir: string, trainJobId: string, at: string): void {
  try {
    const p = continuousStatePath(dataDir);
    const dir = join(p, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const prev = existsSync(p)
      ? (() => {
          try {
            return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : {};
    writeFileSync(p, JSON.stringify({ ...prev, lastTrainAt: at, lastTrainJobId: trainJobId }, null, 2));
  } catch {
    // 状态落盘失败不阻断（下轮增量口径退化为全量采——可接受降级）
  }
}

/**
 * 持续后训练编排主流程（单轮）：
 *
 *   1. 数据回流：collectFlywheelSamples（三源计数）
 *   2. 触发判定：manual 直通 / 其余 shouldTrigger（不 fire 即 skip 返回）
 *   3. 数据管道：flywheelToIngestRecords → buildAndPersistDataset（v1.4.2 复用）
 *   4. 合规闸：scanAndGate（v1.4.5 第三章——增量数据同样过闸，阻断即终止本轮）
 *   5. 训练编排：deps.submitTrain（v1.4.1 调度器复用——本模块不 spawn）
 *   6. 回退保护：eval 分数 ≥ 基线 → registerArtifact 晋升；否则 rollbackWeights
 *      回退旧权重（复用 v1.4.4 产物注册衔接 + 回滚）
 *
 * 回退保护语义（devlog：增量后 eval 分数不低于基线才晋升）：
 *   - 无基线（首轮）→ 任意有效 eval 分即晋升（基线锚从此轮建立）
 *   - eval 分 ≥ 基线分 → 晋升（registerTrainArtifact）
 *   - eval 分 < 基线分 → 回退（rollbackWeightsVersion——旧权重继续服务）
 */
export async function runContinuousTraining(input: RunContinuousInput): Promise<ContinuousRunResult> {
  const deps = input.deps ?? {};
  const now = deps.now ?? Date.now;
  const policy = input.policy ?? DEFAULT_TRIGGER_POLICY;

  // ── 0. 增量口径锚点（上次训练时间——先探一次拿 lastTrainAt，无历史全量采）──
  const probe = collectFlywheelSamples(input.dataDir, null, now);
  const since = probe.lastTrainAt;

  // ── 1. 数据回流观测 ──
  const snapshot = collectFlywheelSamples(input.dataDir, since, now);

  // ── 2. 触发判定（manual 直通）──
  if (input.trigger !== 'manual') {
    const decision = shouldTrigger(snapshot, policy, now);
    if (!decision.fire) {
      return { trigger: input.trigger, decided: 'skip', reason: decision.reason };
    }
  }

  // ── 3. 数据管道（v1.4.2 buildAndPersistDataset 复用）──
  const { records, columns } = flywheelToIngestRecords(input.dataDir, since);
  if (records.length === 0) {
    return {
      trigger: input.trigger,
      decided: 'skip',
      reason: '飞轮数据源无可采样本（三源增量均为空）——本轮跳过',
    };
  }
  const datasetId = `continuous-${new Date(now()).toISOString().slice(0, 10)}`;
  const built = buildAndPersistDataset({
    dataDir: input.dataDir,
    enterpriseId: input.enterpriseId,
    datasetId,
    records,
    columns,
    options: { algorithm: 'sft' },
  });

  // ── 4. 合规闸（v1.4.5 第三章——阻断即终止，不留半成品训练）──
  try {
    scanAndGate({
      dataDir: input.dataDir,
      enterpriseId: input.enterpriseId,
      datasetId: built.datasetId,
      version: built.version.version,
      provenance: input.provenance ?? 'enterprise',
      now,
    });
  } catch (err) {
    if (err instanceof ComplianceGateError) {
      return {
        trigger: input.trigger,
        decided: 'skip',
        reason: `合规闸阻断（增量数据未过闸）：${err.message}——数据处置后下轮再训`,
      };
    }
    throw err;
  }

  // ── 5. 训练编排（v1.4.1 调度器复用——deps.submitTrain 由调用方绑定实例）──
  if (!deps.submitTrain) {
    return {
      trigger: input.trigger,
      decided: 'skip',
      reason: 'submitTrain 未注入（持续训练调度器未绑定——daemon 任务装配时注入 createTrainScheduler().submitTrainJob）',
    };
  }
  const submitted = await deps.submitTrain({
    dataPath: built.datasetFile,
    baseModel: input.baseModel,
    algorithm: 'sft',
  });
  const finalRecord = await submitted.waitForDone;
  // 状态锚点刷新（后续增量以本轮为 since——无论晋升/回退，训练已发生）
  persistLastTrainAt(input.dataDir, submitted.jobId, new Date(now()).toISOString());

  // ── 6. 回退保护（eval 分数 ≥ 基线才晋升；否则回退旧权重）──
  const baselineScore = deps.baseline?.averageScore ?? null;
  let evalScore: number | null = null;
  if (deps.runEval) {
    const report = await deps.runEval(submitted.jobId, {
      datasetId: built.datasetId,
      version: built.version.version,
    });
    evalScore = report.averageScore;
    const passed = baselineScore === null || evalScore >= baselineScore;
    if (passed) {
      if (deps.registerArtifact) {
        const reg = await deps.registerArtifact(submitted.jobId, report);
        return {
          trigger: input.trigger,
          decided: 'train',
          reason: `增量训练完成（eval ${evalScore.toFixed(1)} ≥ 基线 ${baselineScore?.toFixed(1) ?? '无（首轮建锚）'}）——产物晋升：${reg.message}`,
          trainJobId: submitted.jobId,
          newDatasetVersion: built.version.version,
          promotion: 'promoted',
          evalScore,
          ...(baselineScore !== null ? { baselineScore } : {}),
        };
      }
      return {
        trigger: input.trigger,
        decided: 'train',
        reason: `增量训练完成（eval ${evalScore.toFixed(1)} ≥ 基线 ${baselineScore?.toFixed(1) ?? '无（首轮建锚）'}）——晋升（产物注册未注入，跳过注册面）`,
        trainJobId: submitted.jobId,
        newDatasetVersion: built.version.version,
        promotion: 'promoted',
        evalScore,
        ...(baselineScore !== null ? { baselineScore } : {}),
      };
    }
    // eval 低于基线 → 回退旧权重（复用 v1.4.4 rollbackWeightsVersion）
    let rollbackMsg = '回滚函数未注入（人工回滚指引：model_switch action=rollback-weights）';
    if (deps.rollbackWeights) {
      const rb = await deps.rollbackWeights(`${input.enterpriseId}-sft`);
      rollbackMsg = rb.message;
    }
    return {
      trigger: input.trigger,
      decided: 'train',
      reason: `⚠ 增量训练完成但 eval ${evalScore.toFixed(1)} < 基线 ${baselineScore!.toFixed(1)}——已回退旧权重（${rollbackMsg}），增量权重不晋升`,
      trainJobId: submitted.jobId,
      newDatasetVersion: built.version.version,
      promotion: 'rolled-back',
      evalScore,
      baselineScore: baselineScore ?? undefined,
    };
  }

  // 无 eval 注入——记录完成态（回退保护需 eval 数据，无 eval 不判晋升）
  return {
    trigger: input.trigger,
    decided: 'train',
    reason: `增量训练完成（${finalRecord.status}）——eval 未注入，晋升/回退判定挂起（生产装配必须注入 runEval）`,
    trainJobId: submitted.jobId,
    newDatasetVersion: built.version.version,
  };
}
