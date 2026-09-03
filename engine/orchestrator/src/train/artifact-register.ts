// artifact-register.ts · v1.4.4 章三 · 训练产物 → 模型注册自动衔接
//
// 定位：训练闭环的最后一步——train job 完成 + eval 通过之后，权重产物
// 不会自动进 model_register，差一个自动衔接动作。本模块补上这一环：
//
//   train job 完成（TrainJobRecord.status=completed）
//     → eval 通过（TrainEvalReport.decision=stop——v1.4.2 阈值判定）
//     → 权重产物打包（第二章目录规范：拷贝 outputDir → <weightsDir>/vN/）
//     → 自动调 model_register（source: 'local-path'，第二章注册面）
//     → 挂载建议（人工确认后 model_switch——晋升强制人审，对齐 v1.3.5）
//
// 幂等语义（同权重版本不重复注册）：
//   - manifest 层：versions 里已有 meta.trainJobId === 本次 job 的版本 →
//     不重复拷贝登记（复用既有版本 id）
//   - registry 层：同名 local-path 条目 + 同权重目录 + 该版本已存在 →
//     不重复调 registerModel（注册表事件链不增长）
//   - 红线贯穿：幂等命中前仍校验既有版本哈希——权重被篡改即拒绝，
//     绝不静默跳过（供应链完整性优先于幂等便利）
//
// 审计留痕（双侧）：
//   - train 侧：manifest.meta.trainJobId / evalScore / baseModel（产物可溯源）
//   - registry 侧：registerModel 自带事件链（actor=artifact-register:<jobId>，
//     comment 记录 eval 分数与 job 归属）
//
// 不越界：协议事件流（TrainEvent）不动——新增事件类型须升协议 schema
// version（v1.3.6 约定），训练闭环留痕走 manifest + registry 双侧已足。

import { cpSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import { getJobGuarded, type TrainJobRecord } from './train-job';
import type { TrainEvalReport } from './train-eval-loop';
import {
  appendVersion,
  hashDir,
  manifestPath,
  type WeightsManifest,
  type WeightsVersion,
} from '../weights-manifest';
import { loadRegistry, registerModel, type ModelRegistryOpResult } from '../model-registry';

// ══════════════════════════════════════
// 数据模型
// ══════════════════════════════════════

/** 挂载建议（注册后给出——人工确认后执行 model_switch，晋升强制人审） */
export interface MountSuggestion {
  /** 建议挂载的注册模型名 */
  model: string;
  /** 建议档位（executor 执行档 / pipeline 流水线档） */
  lane: 'executor' | 'pipeline';
  /** 建议灰度比例（1-99——灰度可逆直接生效；100 晋升强制人审） */
  suggestedPercent: number;
  /** 是否需要人工确认（恒 true——挂载不是注册器的职权，是人审点） */
  requiresHuman: boolean;
  /** 人读操作提示（model_switch 调用形态） */
  hint: string;
}

/** registerTrainArtifact 入参 */
export interface RegisterTrainArtifactInput {
  /** 数据根目录（train 分区 + model_registry 同根） */
  dataDir: string;
  /** 企业标识（隔离守卫——只能注册本企业分区的 train job 产物） */
  enterpriseId: string;
  /** 训练任务标识（train done 溯源键） */
  trainJobId: string;
  /** eval 报告（v1.4.2 阈值判定产物——decision=stop 才可注册） */
  evalReport: TrainEvalReport;
  /** 权重目录（第二章目录规范——manifest.json + 版本子目录的容器） */
  weightsDir: string;
  /** 注册名（缺省 `<enterpriseId>-<baseModel 清洗>`） */
  modelName?: string;
  /** 权重版本 id（缺省自动递增 v1/v2/...） */
  versionId?: string;
  /** 本地推理服务端点（缺省 http://localhost:8000——vLLM/Ollama 部署面） */
  endpoint?: string;
  /** 挂载建议档位（缺省 pipeline——产线校准类场景） */
  lane?: 'executor' | 'pipeline';
  /** 挂载建议灰度比例（缺省 20） */
  suggestedPercent?: number;
  /** 操作者（注册事件留痕——缺省 artifact-register:<jobId>） */
  actor?: string;
  /** 操作备注（缺省自动生成） */
  comment?: string;
}

/** 注册动作分类（幂等命中与真注册可区分） */
export type ArtifactRegisterAction = 'registered' | 'skipped' | 'rejected';

/** 注册结果 */
export interface ArtifactRegisterResult {
  ok: boolean;
  /** 三分类：registered（新注册）/ skipped（幂等命中）/ rejected（前置校验失败） */
  action: ArtifactRegisterAction;
  message: string;
  /** 结构化错误（action=rejected 时非空） */
  issues: string[];
  /** 本次生效的权重版本 id */
  versionId?: string;
  /** registerModel 结果（action=registered 时非空） */
  registration?: ModelRegistryOpResult;
  /** 挂载建议（ok=true 时非空——人工确认后 model_switch） */
  suggestion?: MountSuggestion;
}

// ══════════════════════════════════════
// 内部工具
// ══════════════════════════════════════

/** 产物拷贝排除后缀（日志/事件流——权重目录只要模型文件与配置） */
const COPY_EXCLUDE_SUFFIXES = ['.log', '.jsonl'];

/** 读 manifest（缺文件 → null——调用方判空） */
function readManifest(weightsDir: string): WeightsManifest | null {
  const mf = manifestPath(weightsDir);
  if (!existsSync(mf)) return null;
  try {
    return JSON.parse(readFileSync(mf, 'utf-8')) as WeightsManifest;
  } catch {
    return null; // 坏 manifest 交给 appendVersion / checkWeightsDir 报错
  }
}

/** 在 manifest 里按 trainJobId 找既有版本（幂等键——同 job 的产物只登记一次） */
function findVersionByJob(m: WeightsManifest | null, trainJobId: string): WeightsVersion | undefined {
  return m?.versions.find((v) => v.meta?.trainJobId === trainJobId);
}

/** 下一个版本 id（v1/v2/... 自动递增——无 manifest 从 v1 起） */
function nextVersionId(weightsDir: string): string {
  const m = readManifest(weightsDir);
  if (m === null) return 'v1';
  const nums = m.versions
    .map((v) => parseInt(v.id.replace(/^v/, ''), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  return `v${(nums.length > 0 ? Math.max(...nums) : 0) + 1}`;
}

/** 目录总字节数（递归——manifest sizeBytes 记录用） */
function dirSizeBytes(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    total += st.isDirectory() ? dirSizeBytes(full) : st.size;
  }
  return total;
}

/** 拷贝训练产物 → 版本目录（排除日志/事件流文件） */
function copyArtifacts(srcDir: string, destDir: string): void {
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (src: string) => {
      const name = basename(src);
      return !COPY_EXCLUDE_SUFFIXES.some((sfx) => name.endsWith(sfx));
    },
  });
}

/** 注册名清洗（baseModel 可能是 HF 风格 `Qwen/Qwen3-8B`——斜杠等非法字符转 `-`） */
function sanitizeModelName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-_.]/g, '-');
}

/** 保留一位小数（eval 分数进 manifest.meta / registry.meta） */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 挂载建议构造（人工确认点——注册器不代执行） */
function buildSuggestion(model: string, lane: 'executor' | 'pipeline', percent: number): MountSuggestion {
  return {
    model,
    lane,
    suggestedPercent: percent,
    requiresHuman: true,
    hint: `model_switch("${model}", lane="${lane}", percent=${percent})——人工确认后执行（晋升 100% 强制人审，灰度可直接生效）`,
  };
}

/** rejected 快捷构造 */
function rejected(message: string, issues: string[]): ArtifactRegisterResult {
  return { ok: false, action: 'rejected', message, issues };
}

// ══════════════════════════════════════
// 主流程：train done + eval pass → 打包 → 注册 → 挂载建议
// ══════════════════════════════════════

/**
 * 训练产物自动注册（训练闭环最后一步）。
 *
 * 前置双闸（任一不过即 rejected——产物绝不进注册表）：
 *   一、train done：job 记录在场（企业隔离守卫）且 status=completed
 *   二、eval pass：decision=stop 且报告归属与注册目标一致（防串档）
 *
 * 幂等（同权重版本不重复注册）：
 *   - manifest 已有本 job 版本 + 注册表已有同名 local-path 条目（同权重目录）
 *     → skipped（不重复拷贝、不重复注册、事件链不增长）
 *   - 幂等命中前校验既有版本哈希——篡改即 rejected（红线优先于便利）
 */
export function registerTrainArtifact(input: RegisterTrainArtifactInput): ArtifactRegisterResult {
  // ── 闸一：train done（企业隔离 + 终态校验）──
  const guarded = getJobGuarded(input.dataDir, input.enterpriseId, input.trainJobId);
  if (!guarded.ok) {
    return rejected(guarded.error.message, [`${guarded.error.code}: ${guarded.error.message}`]);
  }
  const record = guarded.data;
  if (record === null) {
    return rejected(
      `train job ${input.trainJobId} 不存在（企业分区 ${input.enterpriseId}）`,
      [`train job 不存在：${input.trainJobId}`],
    );
  }
  if (record.status !== 'completed') {
    return rejected(
      `train job ${input.trainJobId} 状态为 ${record.status}——仅 completed 可注册（train done 是产物注册的前置）`,
      [`train job 状态非法：${record.status}（期望 completed）`],
    );
  }

  // ── 闸二：eval pass（阈值判定 + 归属一致）──
  if (input.evalReport.decision !== 'stop') {
    return rejected(
      `eval 未通过（decision=${input.evalReport.decision}：${input.evalReport.reason}）——产物不注册，继续训练`,
      [`eval decision=${input.evalReport.decision}（期望 stop）`],
    );
  }
  if (input.evalReport.trainJobId !== input.trainJobId) {
    return rejected(
      `eval 报告归属不一致：report.trainJobId=${input.evalReport.trainJobId} ≠ 注册目标 ${input.trainJobId}（防串档）`,
      [`eval 报告串档：${input.evalReport.trainJobId} ≠ ${input.trainJobId}`],
    );
  }

  // ── 产物目录在场（训练框架落盘点——缺失说明产物未落盘）──
  const outputDir = record.job.outputDir;
  if (!existsSync(outputDir)) {
    return rejected(
      `训练产物目录缺失：${outputDir}（job ${input.trainJobId} 的 outputDir）——产物未落盘不可注册`,
      [`产物目录缺失：${outputDir}`],
    );
  }

  // ── 权重版本定位（幂等键 = manifest 里的 trainJobId）──
  const manifestBefore = readManifest(input.weightsDir);
  const prior = findVersionByJob(manifestBefore, input.trainJobId);
  const versionId = prior ? prior.id : input.versionId ?? nextVersionId(input.weightsDir);
  const versionDir = join(input.weightsDir, versionId);

  if (prior) {
    // 幂等命中前的红线校验：既有版本完整性（篡改即拒——绝不静默跳过）
    const actual = existsSync(versionDir) ? hashDir(versionDir) : '';
    if (!existsSync(versionDir) || actual !== prior.sha256) {
      return rejected(
        `既有版本 ${versionId} 完整性校验失败（manifest sha256=${prior.sha256.slice(0, 12)}…，实际=${actual.slice(0, 12)}…）——权重可能被篡改或损坏，拒绝幂等跳过`,
        [`版本 ${versionId} 完整性校验失败——供应链红线（哈希不匹配）`],
      );
    }
  } else {
    // 新登记：拷贝产物 → 版本目录 → 哈希 → appendVersion（meta 三件套溯源）
    copyArtifacts(outputDir, versionDir);
    const modelName0 =
      input.modelName ?? `${input.enterpriseId}-${sanitizeModelName(record.job.baseModel)}`;
    appendVersion(input.weightsDir, {
      id: versionId,
      createdAt: new Date().toISOString(),
      sha256: hashDir(versionDir),
      sizeBytes: dirSizeBytes(versionDir),
      meta: {
        trainJobId: input.trainJobId,
        evalScore: round1(input.evalReport.averageScore),
        baseModel: record.job.baseModel,
      },
    }, { setCurrent: true, model: modelName0 });
  }

  // ── 注册（source: 'local-path'——第二章注册面，verifyHash 强制）──
  const modelName =
    input.modelName ?? `${input.enterpriseId}-${sanitizeModelName(record.job.baseModel)}`;
  const evalScore = round1(input.evalReport.averageScore);

  // registry 层幂等：同名 local-path 条目 + 同权重目录 + 本 job 版本在册
  // → 同权重版本已注册过，不重复调 registerModel（事件链不增长）
  const registryBefore = loadRegistry(input.dataDir);
  const entryBefore = registryBefore.models[modelName];
  const manifestAfter = readManifest(input.weightsDir);
  const versionInManifest = manifestAfter?.versions.some((v) => v.id === versionId) ?? false;
  if (
    entryBefore &&
    entryBefore.source === 'local-path' &&
    entryBefore.localWeights?.dir === input.weightsDir &&
    prior &&
    versionInManifest
  ) {
    return {
      ok: true,
      action: 'skipped',
      message: `同权重版本已注册（${modelName}@${versionId}，train job ${input.trainJobId}）——幂等跳过，注册表事件链未增长`,
      issues: [],
      versionId,
      suggestion: buildSuggestion(modelName, input.lane ?? 'pipeline', input.suggestedPercent ?? 20),
    };
  }

  const registration = registerModel(
    {
      name: modelName,
      endpoint: input.endpoint ?? 'http://localhost:8000',
      clientType: 'openai-compatible',
      model: record.job.baseModel,
      source: 'local-path',
      weightsDir: input.weightsDir,
      verifyHash: true,
      meta: {
        evalScore,
        notes: `train:${input.trainJobId} eval:${input.evalReport.benchmarkId}(${evalScore})`,
      },
    },
    {
      dataDir: input.dataDir,
      actor: input.actor ?? `artifact-register:${input.trainJobId}`,
      comment: input.comment ?? `训练产物自动注册（job ${input.trainJobId}，eval ${evalScore}，版本 ${versionId}）`,
    },
  );
  if (!registration.ok) {
    return {
      ok: false,
      action: 'rejected',
      message: `model_register 调用失败：${registration.message}`,
      issues: registration.issues,
      versionId,
      registration,
    };
  }

  // ── 挂载建议（人工确认点——注册器只建议不代执行）──
  const suggestion = buildSuggestion(modelName, input.lane ?? 'pipeline', input.suggestedPercent ?? 20);
  return {
    ok: true,
    action: 'registered',
    message: `训练产物已注册：${modelName}@${versionId}（eval ${evalScore}，manifest 校验通过）——挂载建议已给出，人工确认后 model_switch`,
    issues: [],
    versionId,
    registration,
    suggestion,
  };
}
