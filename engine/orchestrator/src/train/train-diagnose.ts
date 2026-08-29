// train-diagnose.ts · v1.4.3 第二章 · 训练失败诊断（七类分类 + 上下文收集 + 修复处方）
//
// 定位：训练失败是高概率事件（OOM / 数据格式错 / 超参发散 / 框架版本不匹配）。
// 失败后自动诊断分类 + 打包上下文 + 给修复建议——不是把原始日志丢给用户。
// 对齐 sofagent 错误处理升级思路（v1.3.1 stop_reason 六值分类 + 指数退避）。
//
// 七类失败（2026-08-26 补后两类）：
//   一、OOM 显存耗尽
//   二、数据格式错误
//   三、超参发散（loss 不收敛 / NaN）
//   四、框架错误（版本/接口不匹配）
//   五、环境不匹配（CUDA/driver/依赖）
//   六、重复坍塌（RL 训练响应重复——MiniMax-M1 稳定性配方对齐）
//   七、精度异常（bf16 混合精度 loss 尖刺——LM head/优化器状态升 FP32 处方）
//
// 诊断链：失败日志尾部 + train-env.json + 最近 checkpoint + 超参 →
// 分类（关键词规则，可解释可审计）→ 处方（每类固定建议）→ 诊断报告落盘。
//
// 纯规则驱动（LLM 不参与——训练 Agent 决策面的确定性前置层）。

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import {
  loadTrainJobRecord,
  readTrainEvents,
  trainJobFilePaths,
  type TrainJobRecord,
} from './train-job';
import { trainEnvManifestPath, type TrainEnvManifest } from './env-manager';

// ════════════════════════════════════════
// 七类失败分类
// ════════════════════════════════════════

/** 失败分类标识（七类） */
export type TrainFailureCategory =
  | 'oom'
  | 'data_format'
  | 'hyperparam_divergence'
  | 'framework_error'
  | 'environment_mismatch'
  | 'repetition_collapse'
  | 'precision_anomaly';

/** 分类定义（id + 人读名 + 判定关键词——诊断报告可读） */
export interface FailureCategoryDef {
  id: TrainFailureCategory;
  name: string;
  /** 日志关键词（命中任一即归类——大小写不敏感） */
  keywords: readonly string[];
}

/** 七类失败定义（单一事实源——classify 与报告共享） */
export const FAILURE_CATEGORIES: readonly FailureCategoryDef[] = [
  {
    id: 'oom',
    name: '显存耗尽（OOM）',
    keywords: [
      'out of memory',
      'cuda oom',
      'cudaruntimeerror',
      'tried to allocate',
      'torch.cuda.outofmemoryerror',
      'nccl out of memory',
    ],
  },
  {
    id: 'data_format',
    name: '数据格式错误',
    keywords: [
      'jsondecodeerror',
      'keyerror',
      'valueerror: invalid',
      'unexpected token',
      'column mismatch',
      'missing field',
      'data loader',
      'dataloader worker exited',
    ],
  },
  {
    id: 'hyperparam_divergence',
    name: '超参发散（loss 不收敛）',
    keywords: [
      'loss is nan',
      'loss=nan',
      'gradient overflow',
      'inf loss',
      'loss became nan',
      'diverged',
      'clipping threshold',
    ],
  },
  {
    id: 'framework_error',
    name: '框架错误（版本/接口）',
    keywords: [
      'modulenotfounderror',
      'importerror',
      'attributeerror',
      'typeerror:',
      'no module named',
      'incompatible api',
      'argument of type',
    ],
  },
  {
    id: 'environment_mismatch',
    name: '环境不匹配（CUDA/driver/依赖）',
    keywords: [
      'cuda driver version is insufficient',
      'cuda error',
      'device kernel image is invalid',
      'libcudart',
      'undefined symbol',
      'cudnn',
      'runtimeerror: cuda',
      'no cuda-capable device',
    ],
  },
  {
    id: 'repetition_collapse',
    name: '重复坍塌（RL 响应重复）',
    keywords: [
      'repetition',
      'degenerate output',
      'loop detected',
      'identical responses',
      'response collapse',
      'repeated token',
    ],
  },
  {
    id: 'precision_anomaly',
    name: '精度异常（bf16 loss 尖刺）',
    keywords: [
      'loss spike',
      'numerical instability',
      'float16 overflow',
      'underflow',
      'precision loss',
      'loss jump',
    ],
  },
];

/**
 * 失败日志分类（关键词规则——命中最多的类胜出，平局按定义序）。
 * 零命中返回 null（未分类——报告标注「未识别，转人审」）。
 */
export function classifyTrainFailure(logText: string): {
  category: TrainFailureCategory | null;
  name: string;
  matchedKeywords: string[];
} {
  const text = logText.toLowerCase();
  let best: FailureCategoryDef | null = null;
  let bestHits: string[] = [];
  for (const def of FAILURE_CATEGORIES) {
    const hits = def.keywords.filter((kw) => text.includes(kw.toLowerCase()));
    if (hits.length > bestHits.length) {
      best = def;
      bestHits = hits;
    }
  }
  if (!best) {
    return { category: null, name: '未识别（转人审）', matchedKeywords: [] };
  }
  return { category: best.id, name: best.name, matchedKeywords: bestHits };
}

// ════════════════════════════════════════
// 修复处方（每类固定建议——诊断报告的核心价值）
// ════════════════════════════════════════

/** 处方结构（可执行建议 + 处方出处） */
export interface FailurePrescription {
  /** 修复建议（有序步骤——按优先级） */
  steps: string[];
  /** 处方出处（方法论引用——审计可读） */
  source: string;
}

/** 七类处方表（分类 id → 处方） */
export const FAILURE_PRESCRIPTIONS: Readonly<Record<TrainFailureCategory, FailurePrescription>> = {
  oom: {
    steps: [
      '减小 per_device_batch_size（当前值减半），用 gradient_accumulation_steps 补有效 batch',
      '开启/确认 gradient_checkpointing（QLoRA 模板已默认开启——检查是否被覆盖）',
      '确认 load_in_4bit + paged_adamw_8bit（QLoRA 显存双开关）',
      '缩短 max_seq_len（4096→2048——长序列激活内存是大头）',
      '仍不够：换小一档基座（8B→4B）或 LoRA rank 降档（32→16）',
    ],
    source: 'sofagent qlora-template 显存双开关 + train-diagnose 处方基线',
  },
  data_format: {
    steps: [
      '用 train_dryrun 做数据抽样预检（管线连通+格式核对）',
      '核对 column_mapping（CSV/Excel 列名映射——KeyError 多为映射错位）',
      '数据管道重跑：dataset-builder + dataset-validator（v1.4.2 章二）',
      '检查 JSONL 逐行合法性（非法行剔除——dataset-validator 的坏行报告）',
    ],
    source: 'v1.4.2 数据管道（dataset-builder/validator）+ train_dryrun 预检',
  },
  hyperparam_divergence: {
    steps: [
      '降低 learning_rate（当前值 ×0.1 起试——发散首选处方）',
      'RL 训练：加/升 KL 系数 beta（0.0→0.04——约束策略漂移）',
      '确认 warmup_steps_ratio ≥ 0.03（ScaleRL 技巧④——LR warmup 防早期崩）',
      'RL 训练：开启 advantage_normalization=batch（ScaleRL 技巧①——batch 级归一稳方差）',
      '仍发散：reset 到最近 checkpoint 续跑（resumeTrainJob）并再降 LR',
    ],
    source: 'ScaleRL 四技巧（arxiv 2510.13786）+ 超参发散常规处方',
  },
  framework_error: {
    steps: [
      '核对 train-env.json 框架版本清单（train_doctor 的 framework 检查项）',
      'pip 依赖冲突排查：pip3 check + 按报错模块 pin 版本',
      'API 不匹配多为版本漂移——对照 v1.3.7 协议调研的框架版本矩阵回退',
      '重跑 train env init 重建环境（venv 隔离——不污染系统 Python）',
    ],
    source: 'env-manager 版本清单 + v1.3.7 训练协议框架调研',
  },
  environment_mismatch: {
    steps: [
      'nvidia-smi 核对 driver/CUDA 版本（CUDA driver version is insufficient → 升驱动）',
      '框架 CUDA 编译版与驱动对齐（cu121/cu124 与 driver 版本矩阵）',
      '重跑 train env init（完整探测链——失败步骤如实报告）',
      '金属降级环境（Apple Silicon）：确认走 tools/train-env-init.sh 的 npm 分支',
    ],
    source: 'env-manager trainDoctor 四项体检 + train-env 双分支探测',
  },
  repetition_collapse: {
    steps: [
      '开启重复早停检测（重复率超阈值自动暂停——v1.4.2 步零已交付重复率熔断）',
      '长度窗口分阶段扩张（MiniMax-M1 稳定性配方：短窗口训稳→逐步放宽长窗口）',
      'RL 训练：确认 skip_zero_variance_groups=true（ScaleRL 技巧③——全对/全错组不贡献梯度）',
      '提高采样温度或换 dapo 配方（clip_eps_high 放宽——高概率 token 不锁死）',
      '检查 reward 函数是否对重复有惩罚缺口（重复坍塌常因 reward 惩罚面缺失）',
    ],
    source: 'MiniMax-M1 稳定性配方（重复早停+长度窗口分阶段扩张）+ ScaleRL 技巧③',
  },
  precision_anomaly: {
    steps: [
      'LM head 升 FP32（bf16 混合精度下 LM head 是尖刺高发层）',
      '优化器状态升 FP32（AdamW 双矩量 bf16 累积误差——MiniMax-M1 + ScaleRL 同款处方）',
      '确认 gradient clipping（max_grad_norm 1.0——尖刺先截断防扩散）',
      '仍尖刺：learning_rate ×0.5 + warmup 拉长（warmup_steps_ratio 0.03→0.1）',
    ],
    source: 'MiniMax-M1 + ScaleRL 同款处方（LM head/优化器状态升 FP32）',
  },
};

// ════════════════════════════════════════
// 诊断上下文收集 + 报告
// ════════════════════════════════════════

/** 诊断上下文（自动收集——打包成报告的四源） */
export interface DiagnoseContext {
  /** 失败日志尾部（state.json 的 reason + events 中的 failed 事件——截尾 2000 字符） */
  logTail: string;
  /** 环境版本清单（train-env.json——可复现口径） */
  envManifest: TrainEnvManifest | null;
  /** 最近 checkpoint（续跑起点） */
  lastCheckpoint: { checkpointPath: string; step: number } | null;
  /** 超参快照（job.json 的 hyperparams） */
  hyperparams: Record<string, unknown>;
}

/** 诊断报告（七类分类 + 上下文 + 处方） */
export interface TrainDiagnoseReport {
  schemaVersion: 'v1';
  trainJobId: string;
  enterpriseId: string;
  /** 失败时的状态（failed/cancelled 等终态） */
  status: string;
  /** 一、失败分类（七类之一或未识别） */
  classification: {
    category: TrainFailureCategory | null;
    name: string;
    matchedKeywords: string[];
  };
  /** 二、诊断上下文（四源收集） */
  context: DiagnoseContext;
  /** 三、修复处方（分类为 null 时给通用排查建议） */
  prescription: FailurePrescription | null;
  /** 诊断时间 */
  diagnosedAt: string;
}

/** 收集失败日志尾部（state.json reason + events.jsonl 的 failed 行） */
function collectLogTail(record: TrainJobRecord, dataDir: string): string {
  const parts: string[] = [];
  if (record.reason) parts.push(record.reason);
  const { events } = readTrainEvents(dataDir, record.enterpriseId, record.jobId);
  for (const ev of events) {
    if (ev.type === 'failed') parts.push(ev.reason);
  }
  return parts.join('\n').slice(-2000);
}

/** 读环境清单（train-env.json——不存在返回 null） */
function readEnvManifest(dataDir: string, enterpriseId: string): TrainEnvManifest | null {
  const file = trainEnvManifestPath(dataDir, enterpriseId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as TrainEnvManifest;
  } catch {
    return null;
  }
}

/** 未分类时的通用排查处方 */
const GENERIC_PRESCRIPTION: FailurePrescription = {
  steps: [
    '查看完整日志：data/train/<企业>/<jobId>/events.jsonl 与 stderr 留痕',
    '用 train_doctor 做环境四项体检（CUDA/显存/框架/基座缓存）',
    '用 train_dryrun 复现管线（极小样本跑通性验证）',
    '仍未定位：带上诊断报告转人审（报告已含上下文四源）',
  ],
  source: '未分类通用排查路径（诊断报告上下文四源已打包）',
};

/**
 * 训练失败诊断主入口：jobId → 分类 + 上下文 + 处方 → 报告。
 *
 * 任务不存在抛错（快速失败）；非 failed 态仍可诊断（cancelled/interrupted
 * 也可能有失败上下文——分类器对无失败特征的日志返回未识别）。
 */
export function diagnoseTrainFailure(
  dataDir: string,
  enterpriseId: string,
  trainJobId: string,
  options: { now?: () => number } = {},
): TrainDiagnoseReport {
  const now = options.now ?? Date.now;
  const record = loadTrainJobRecord(dataDir, enterpriseId, trainJobId);
  if (!record) {
    throw new Error(
      `[train-diagnose] 训练任务不存在：${trainJobId}（enterprise=${enterpriseId}）`,
    );
  }

  // 一、分类（日志尾部四源之一）
  const logTail = collectLogTail(record, dataDir);
  const classification = classifyTrainFailure(logTail);

  // 二、上下文四源收集
  const context: DiagnoseContext = {
    logTail,
    envManifest: readEnvManifest(dataDir, enterpriseId),
    lastCheckpoint: record.lastCheckpoint ?? null,
    hyperparams: record.job.hyperparams,
  };

  // 三、处方（七类各有——未识别给通用排查）
  const prescription = classification.category
    ? FAILURE_PRESCRIPTIONS[classification.category]
    : GENERIC_PRESCRIPTION;

  return {
    schemaVersion: 'v1',
    trainJobId,
    enterpriseId,
    status: record.status,
    classification,
    context,
    prescription,
    diagnosedAt: new Date(now()).toISOString(),
  };
}

/** 诊断报告落盘路径：data/train/<企业>/<jobId>/diagnose.json */
export function trainDiagnoseReportPath(dataDir: string, enterpriseId: string, trainJobId: string): string {
  const { jobDir } = trainJobFilePaths(dataDir, enterpriseId, trainJobId);
  return join(jobDir, 'diagnose.json');
}

/** 落盘诊断报告（原子写——幂等覆盖，最新诊断为准确认态） */
export function saveTrainDiagnoseReport(dataDir: string, report: TrainDiagnoseReport): string {
  const file = trainDiagnoseReportPath(dataDir, report.enterpriseId, report.trainJobId);
  const dir = join(file, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(file, JSON.stringify(report, null, 2));
  return file;
}
