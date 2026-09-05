// ============================================================
// tasks/continuous-training.ts · v1.4.5 第二章 · 持续后训练 daemon 定时任务
//
// daemon 侧调度入口（对齐 decision-memory @daily 模式——cron.ts 里
// task === 'continuous-training' 分支消费本模块的 runContinuousTrainingTick）。
//
// 编排本体在 @sofagent/orchestrator 的 train-continuous.ts（数据回流 +
// 触发策略 + 回退保护）；本文件只做 daemon 装配：
//   1. 读触发策略配置（watch.yml `continuous-training:` 段——阈值/间隔可配）
//   2. 装配 train-scheduler（v1.4.1 复用）+ runTrainEval + registerTrainArtifact
//   3. 调 runContinuousTraining（trigger='schedule'——定时模式；数据阈值
//      在 shouldTrigger 内部判定命中时同样触发）
//   4. 结果落盘 data/train/continuous-runs.jsonl（append-only 观测台账）
//
// ⚠️ 边界（devlog §二）：规则驱动增量再训——不实现 on-policy
// self-distillation / online RL（商业模型层范围）。
// ============================================================

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { load as yamlLoad } from 'js-yaml';

/** 持续后训练调度配置（watch.yml `continuous-training:` 段） */
export interface ContinuousTrainingConfig {
  /** 总开关；缺省 false——增量训练烧算力，显式 opt-in（与 inspectors 缺省 true 相反：训练是重操作） */
  enabled: boolean;
  /** 企业标识（🔴 训练分区依赖——未配不给跑） */
  enterpriseId: string;
  /** 基座模型（增量起点） */
  baseModel: string;
  /** 数据阈值（缺省 50——对齐 DEFAULT_TRIGGER_POLICY.minNewSamples） */
  minNewSamples: number;
  /** 定时间隔天数（缺省 7 = @weekly） */
  maxIntervalDays: number;
}

/** 缺省配置（enabled=false——显式 opt-in 语义） */
export const DEFAULT_CONTINUOUS_TRAINING_CONFIG: ContinuousTrainingConfig = {
  enabled: false,
  enterpriseId: '',
  baseModel: '',
  minNewSamples: 50,
  maxIntervalDays: 7,
};

/** watch.yml 顶层结构（本任务只读 continuous-training 段） */
interface WatchConfigForContinuous {
  'continuous-training'?: unknown;
}

/**
 * 读取 watch.yml `continuous-training:` 段。
 *
 * 语义：段缺失 / enabled 缺省 → **不启用**（与 inspectors 的缺省 true 相反：
 * 增量训练消耗真实算力，必须显式 opt-in——「零调度」bug 的修复哲学是
 * 观测类任务缺省跑，算力类任务缺省不跑）。
 */
export function loadContinuousTrainingConfig(projectDir: string): ContinuousTrainingConfig {
  const defaults = { ...DEFAULT_CONTINUOUS_TRAINING_CONFIG };
  const watchYml = join(projectDir, '.sofagent', 'watch.yml');
  if (!existsSync(watchYml)) return defaults;
  try {
    const raw = yamlLoad(readFileSync(watchYml, 'utf-8')) as WatchConfigForContinuous | null;
    const section = raw?.['continuous-training'];
    if (!section || typeof section !== 'object') return defaults;
    const s = section as Record<string, unknown>;
    return {
      enabled: s.enabled === true,
      enterpriseId: typeof s.enterpriseId === 'string' ? s.enterpriseId : '',
      baseModel: typeof s.baseModel === 'string' ? s.baseModel : '',
      minNewSamples:
        typeof s.minNewSamples === 'number' && Number.isFinite(s.minNewSamples) && s.minNewSamples > 0
          ? Math.floor(s.minNewSamples)
          : defaults.minNewSamples,
      maxIntervalDays:
        typeof s.maxIntervalDays === 'number' && Number.isFinite(s.maxIntervalDays) && s.maxIntervalDays > 0
          ? Math.floor(s.maxIntervalDays)
          : defaults.maxIntervalDays,
    };
  } catch {
    return defaults; // 坏 YAML fail-open 到缺省（不启用）
  }
}

/** 单轮执行结果（观测台账 jsonl 单行） */
export interface ContinuousRunTickResult {
  ts: string;
  /** executed=false = 配置未启用/参数不全（观测记录但不训练） */
  executed: boolean;
  reason: string;
  /** 编排层结果（executed=true 时在场） */
  run?: {
    trigger: string;
    decided: string;
    reason: string;
    trainJobId?: string;
    promotion?: string;
  };
}

/** 观测台账路径：data/train/continuous-runs.jsonl */
export function continuousRunsLogPath(dataDir: string): string {
  return join(dataDir, 'train', 'continuous-runs.jsonl');
}

/** 台账追加（失败不阻断——观测是 best-effort） */
function appendRunLog(dataDir: string, entry: ContinuousRunTickResult): void {
  try {
    const p = continuousRunsLogPath(dataDir);
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    /* 观测失败静默（下一轮再记） */
  }
}

/**
 * 持续后训练单轮 tick（daemon cron 的 @weekly / @daily 分支调用）。
 *
 * 装配链（全部复用既有模块——本文件零新编排逻辑）：
 *   - createTrainScheduler（v1.4.1）→ submitTrain 注入
 *   - runContinuousTraining（orchestrator train-continuous）→ 编排本体
 *
 * 失败不抛出（daemon 定时任务纪律——错误进观测台账，daemon 主循环不 crash）。
 */
export async function runContinuousTrainingTick(projectDir: string): Promise<ContinuousRunTickResult> {
  const ts = new Date().toISOString();
  const config = loadContinuousTrainingConfig(projectDir);
  const dataDir =
    process.env.SOFAGENT_DATA ||
    join(process.env.SOFAGENT_HOME || `${require('os').homedir()}/.sofagent`, 'data');

  if (!config.enabled) {
    const entry: ContinuousRunTickResult = {
      ts,
      executed: false,
      reason: 'continuous-training.enabled ≠ true——增量训练未启用（算力类任务显式 opt-in）',
    };
    appendRunLog(dataDir, entry);
    return entry;
  }
  if (config.enterpriseId.trim() === '' || config.baseModel.trim() === '') {
    const entry: ContinuousRunTickResult = {
      ts,
      executed: false,
      reason: 'continuous-training 段缺 enterpriseId / baseModel——企业分区与基座模型必配',
    };
    appendRunLog(dataDir, entry);
    return entry;
  }

  try {
    // 经 dist 动态引入（对齐 cron.ts ab-schedule 模式——orchestrator 导出面
    // 随 dist 重建生效，daemon 不静态依赖编译时序）
    const orch = (await import('@sofagent/orchestrator')) as unknown as {
      createTrainScheduler: (opts: {
        dataDir: string;
        enterpriseId: string;
        crashRecoveryScan?: boolean;
      }) => {
        submitTrainJob: (input: {
          dataPath: string;
          baseModel: string;
          algorithm: 'sft' | 'dpo' | 'grpo';
        }) => { result: { record: { jobId: string } }; handle: { done: Promise<{ status: string; outputDir?: string }> } | null };
      };
      runContinuousTraining: (input: {
        dataDir: string;
        enterpriseId: string;
        baseModel: string;
        trigger: 'schedule' | 'data-threshold' | 'manual';
        policy: { minNewSamples: number; maxIntervalDays: number };
      }) => Promise<{
        trigger: string;
        decided: string;
        reason: string;
        trainJobId?: string;
        promotion?: string;
      }>;
    };

    const scheduler = orch.createTrainScheduler({
      dataDir,
      enterpriseId: config.enterpriseId,
      crashRecoveryScan: false, // daemon 周期任务不重复扫（scheduler 常驻实例职责）
    });

    const run = await orch.runContinuousTraining({
      dataDir,
      enterpriseId: config.enterpriseId,
      baseModel: config.baseModel,
      trigger: 'schedule', // daemon 定时入口——数据阈值命中在 shouldTrigger 内判
      policy: {
        minNewSamples: config.minNewSamples,
        maxIntervalDays: config.maxIntervalDays,
      },
    });

    const entry: ContinuousRunTickResult = {
      ts,
      executed: true,
      reason: run.reason,
      run: {
        trigger: run.trigger,
        decided: run.decided,
        reason: run.reason,
        ...(run.trainJobId !== undefined ? { trainJobId: run.trainJobId } : {}),
        ...(run.promotion !== undefined ? { promotion: run.promotion } : {}),
      },
    };
    appendRunLog(dataDir, entry);
    return entry;
  } catch (err) {
    const entry: ContinuousRunTickResult = {
      ts,
      executed: false,
      reason: `持续后训练 tick 失败：${err instanceof Error ? err.message : String(err)}`,
    };
    appendRunLog(dataDir, entry);
    return entry;
  }
}
