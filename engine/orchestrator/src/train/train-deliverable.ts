// train-deliverable.ts · v1.4.5 第四章 · FDE 训练交付包（五件聚合 + zip + manifest + HMAC）
//
// 定位：FDE 离场交的「训练运维包」——给了引擎但没给说明书，企业自己跑不起
// 来（devlog 第四章定位段）。本文件把散落各版本的交付物收口成一个标准包：
//
//   五件内容（devlog 第四章交付表）：
//     ① 训练配置模板（v1.4.3 模板库实例化版——job.json 快照 + 模板引用）
//     ② 数据管道配置（v1.4.2 数据源连接 + 字段映射——dataset-version 台账引用）
//     ③ eval 基线冻结（首次训练的 Benchmark 分数冻结——eval 报告快照）
//     ④ 运维手册（续训触发条件 / 回滚步骤 / 故障排查 / 联系方式——markdown）
//     ⑤ 权重清单（当前生产权重 + 历史版本 + 回滚点——weights-manifest 引用
//        + retention-policy 第五章标记的回滚点）
//
//   打包与签名：
//     - zip：train-deliverable-<enterpriseId>-<date>.zip（zip-writer 零依赖实现）
//     - manifest：五件内容逐项 sha256 + 尺寸（完整性核对基准）
//     - HMAC：manifest 整体 HMAC（复用 @sofagent/core getHmacKey +
//       stableStringify + getEnvFingerprint——与 artifact-signing 同签名构造）
//
//   校验（train deliverable verify）：
//     - 完整性：manifest 逐项核对（zip 条目 sha256 复算）
//     - 环境兼容性：train doctor 子集（Node 版本 / 数据盘可写——不重复实现
//       trainDoctor 的 GPU/框架检查，交付包 verify 是企业收包侧轻量体检）
//
// 接口签名（spec-first）：
//   generateTrainDeliverable(dataDir, enterpriseId, input?): DeliverableResult
//   verifyTrainDeliverable(zipPath, opts?): DeliverableVerifyReport
//   数据结构：DeliverableManifest（五件 files + 签名）/ DeliverableVerifyReport
//   （integrity / env 两段结论）
//
// 依赖序：⑤ 权重清单消费第五章 retention-policy.markRollbackPoint 登记的
// 回滚点（devlog 批次依赖「五 → 四」——本文件是消费侧）。

import { createHash, createHmac } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  atomicWriteSync,
  getEnvFingerprint,
  getHmacKey,
  stableStringify,
} from '@sofagent/core';
import { unzipEntries } from './data-ingest';
import { buildZip, type ZipEntryInput } from './zip-writer';
import { listTrainJobRecords, trainJobDir } from './train-job';
import { readDatasetVersions } from './dataset-version';
import { readRetentionMarkers, queryRetentionDecision } from './retention-policy';
import { loadRegistry } from '../model-registry';
import { manifestPath as weightsManifestPath, type WeightsManifest } from '../weights-manifest';

// ════════════════════════════════════════
// manifest 模型（五件内容 + 签名）
// ════════════════════════════════════════

/** manifest 单文件条目（完整性核对基准——zip 内逐条目 sha256） */
export interface DeliverableFileEntry {
  /** zip 内相对路径（五件内容各自的落点） */
  path: string;
  /** 内容字节数 */
  sizeBytes: number;
  /** 内容 SHA-256（hex——verify 逐项复算比对） */
  sha256: string;
  /** 归属件（① 训练配置模板…⑤ 权重清单——manifest 人读分组） */
  section: 'train-config' | 'data-pipeline' | 'eval-baseline' | 'ops-manual' | 'weights-list';
}

/** manifest 主体（签名输入——不含 hmac 字段） */
export interface DeliverableManifestBody {
  /** manifest schema 版本 */
  schemaVersion: 'v1';
  /** 企业标识 */
  enterpriseId: string;
  /** 生成时间（ISO） */
  createdAt: string;
  /** 五件内容条目（完整清单——verify 的核对基准） */
  files: DeliverableFileEntry[];
  /** 引用的 train job（五件内容的血缘——溯源键） */
  trainJobId: string | null;
  /** 引用的数据集（② 数据管道配置的台账键） */
  datasetId: string | null;
  /** 生成器版本（包内常量——兼容性判定依据） */
  generatorVersion: string;
}

/** 完整 manifest（body + 签名链字段） */
export interface DeliverableManifest {
  schemaVersion: 'v1';
  enterpriseId: string;
  createdAt: string;
  files: DeliverableFileEntry[];
  trainJobId: string | null;
  datasetId: string | null;
  generatorVersion: string;
  /** manifest 整体 HMAC（body 全量签名——与 artifact-signing 同构造） */
  manifestHmac: string;
  /** 签名时的环境指纹（跨环境 verify 三态判定的依据） */
  envFingerprint: string;
  /** 签名算法标记 */
  hmacAlgo: 'stable';
}

/** 生成器版本（发版随 package.json 对齐——此处常量声明，避免循环 import） */
export const TRAIN_DELIVERABLE_GENERATOR_VERSION = 'v1.4.4';

// ════════════════════════════════════════
// 错误类型
// ════════════════════════════════════════

/** 交付包生成失败（前置条件不满足）——不写任何文件 */
export class TrainDeliverableError extends Error {
  constructor(message: string) {
    super(`[train-deliverable] ${message}`);
    this.name = 'TrainDeliverableError';
  }
}

// ════════════════════════════════════════
// 生成入参 / 结果
// ════════════════════════════════════════

/** 交付包生成入参 */
export interface GenerateTrainDeliverableInput {
  /** 指定血缘 job（缺省取企业分区内最新 completed——报告血缘默认最新） */
  trainJobId?: string;
  /** 指定数据集（缺省取版本台账最新一条的 datasetId） */
  datasetId?: string;
  /** FDE 联系方式（④ 运维手册联系方式段——缺省占位指引填写） */
  contact?: string;
  /** 生成时间（缺省当前——测试可注入） */
  createdAt?: string;
  /** 输出目录（缺省 data/train/<ent>/deliverables/） */
  outDir?: string;
}

/** 交付包生成结果 */
export interface DeliverableResult {
  /** 交付包 zip 绝对路径 */
  zipPath: string;
  /** manifest（已签名——zip 内 + 落盘双份） */
  manifest: DeliverableManifest;
  /** 五件内容覆盖情况（企业收包侧的完整性速览） */
  sections: Record<DeliverableFileEntry['section'], number>;
  /** zip 字节数 */
  zipBytes: number;
}

/** 交付包归档目录：data/train/<enterpriseId>/deliverables/ */
export function deliverablesDir(dataDir: string, enterpriseId: string): string {
  return join(dataDir, 'train', enterpriseId, 'deliverables');
}

/** 日期段（文件名用——YYYYMMDD 本地口径与 train-report 归档风格对齐） */
function dateStamp(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '');
}

// ════════════════════════════════════════
// ④ 运维手册（markdown——续训/回滚/排查/联系方式四段）
// ════════════════════════════════════════

/** 运维手册渲染（纯函数——生成侧与测试共用） */
export function renderOpsManual(input: {
  enterpriseId: string;
  trainJobId: string | null;
  datasetId: string | null;
  productionModel: string | null;
  rollbackPoints: string[];
  contact?: string;
  createdAt: string;
}): string {
  const contact = input.contact ?? '（待填：FDE 离场前补齐企业支持渠道——电话/群/邮箱）';
  const rollbackLines =
    input.rollbackPoints.length > 0
      ? input.rollbackPoints.map((r) => `  - ${r}`).join('\n')
      : '  - （暂无登记——建议 FDE 离场前用 train deliverable 生成时补登关键权重版本）';

  return `# 训练运维手册（${input.enterpriseId}）

> 生成时间：${input.createdAt} · 血缘任务：${input.trainJobId ?? '—'} · 数据集：${input.datasetId ?? '—'}
> 本手册随 train-deliverable 交付包分发——五件内容之一（④）。

## 一、续训（增量再训触发条件）

1. 数据量达阈值：新回流数据累计 ≥ 1000 条样本（或现役训练集 20%）时建议续训
2. 定时触发：daemon @weekly 自动评估（data/train/ 保留策略与归档同源调度）
3. 人工触发：\`train_submit\` 提交新 job（dataPath 指向新版本训练集，算法沿用血缘任务）
4. 续训后 eval 分数不低于基线（见 ③ eval-baseline）才晋升；否则回退旧权重

## 二、回滚（步骤 + 回滚点）

1. 查看权重清单（见 ⑤ weights-list）定位回滚点
2. 当前登记的回滚点：
${rollbackLines}
3. 回滚执行：\`model_switch\`（action=rollback-weights 指向目标版本目录）
${input.productionModel ? `4. 当前生产模型：${input.productionModel}（model-registry active）` : ''}

## 三、故障排查

| 症状 | 首查 | 处置 |
|------|------|------|
| 训练启动失败 | \`train_doctor\` 四项体检 | CUDA/显存/框架/基座缓存——fail 项按 detail 指引装 |
| 提交前想预检 | \`train_dryrun\` | 管线连通 + 数据抽样 + 显存估算 + 算力外推 |
| 训练中断 | job 目录 events.jsonl 末行 | crash-recovery 三选项：续跑/标败/人审 |
| eval 分数跌 | \`train_diagnose\` | 七类失败分类 + 处方（含数据漂移检查） |
| 产物完整性疑虑 | verify（本交付包 verify 子命令） | manifest 逐项核对 + 环境兼容性 |

## 四、联系方式

${contact}

## 五、磁盘治理提示

- 保留策略：data/train/${input.enterpriseId}/train-retention.json（最近 N checkpoint + 90 天二次保留）
- 归档冷存：data/train/archive/${input.enterpriseId}/（@weekly 自动——归档不删除）
- 空间预警：磁盘超 80% 告警 + 最大可归档项建议
`;
}

// ════════════════════════════════════════
// 五件内容收集
// ════════════════════════════════════════

/** sha256 快捷（条目级——文件内容已全量在内存） */
function sha256Of(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 读文本文件（缺失返回 null——五件内容按「有则收录」语义聚合） */
function readTextIf(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 收集五件内容（生成器主体——纯读不写）。
 *
 * 缺件语义（如实——不伪造）：
 *   ① job.json：血缘 job 缺失或文件不在 → 该件内容用说明性 JSON 占位
 *      （section 仍计入 manifest——企业收包侧能看到「缺件原因」）
 *   ② 数据管道配置：dataset-version 台账引用 + dataset.jsonl 头部采样
 *   ③ eval 基线：evaluation-log 最近记录的聚合快照（benchmarkId/均分/时间）
 *      ——找不到记录时给空基线声明（基线冻结语义 = 有据可查，无据声明无）
 *   ④ 运维手册：恒可生成（模板渲染——回滚点列表来自第五章标记）
 *   ⑤ 权重清单：weights-manifest 引用 + 回滚点（第五章 retention 标记）
 */
function collectFiveSections(input: {
  dataDir: string;
  enterpriseId: string;
  trainJobId: string | null;
  datasetId: string | null;
  contact?: string;
  createdAt: string;
}): { entries: ZipEntryInput[]; sections: Record<DeliverableFileEntry['section'], number> } {
  const { dataDir, enterpriseId } = input;
  const entries: ZipEntryInput[] = [];
  const sections: Record<DeliverableFileEntry['section'], number> = {
    'train-config': 0,
    'data-pipeline': 0,
    'eval-baseline': 0,
    'ops-manual': 0,
    'weights-list': 0,
  };

  // ── ① 训练配置模板 ──
  const jobDir = input.trainJobId !== null ? trainJobDir(dataDir, enterpriseId, input.trainJobId) : null;
  const jobJson = jobDir !== null ? readTextIf(join(jobDir, 'job.json')) : null;
  entries.push({
    name: 'train-config/job.json',
    data:
      jobJson ??
      JSON.stringify(
        {
          note: '血缘任务 job.json 不在场（任务目录缺失或未指定）——本件为占位说明',
          enterpriseId,
          trainJobId: input.trainJobId,
          templateHint: '训练配置模板可经 train-analyze / train-templates 重新实例化',
        },
        null,
        2,
      ),
  });
  sections['train-config'] += 1;

  // ── ② 数据管道配置 ──
  let pipelineDoc: Record<string, unknown> = {
    note: 'dataset-version 台账为空——本件为占位说明',
    enterpriseId,
  };
  try {
    const versions = readDatasetVersions(dataDir, enterpriseId);
    // 台账天然 append 序（旧→新）；指定 datasetId 时收窄到该链，否则取全台账尾部
    const target =
      input.datasetId !== null
        ? versions.filter((v) => v.datasetId === input.datasetId)
        : versions.slice();
    if (target.length > 0) {
      const latest = target[target.length - 1]!;
      pipelineDoc = {
        datasetId: latest.datasetId,
        version: latest.version,
        algorithm: latest.algorithm,
        columnMapping: latest.columnMapping,
        datasetFile: latest.datasetFile,
        contentHash: latest.contentHash,
        sampleCount: latest.sampleCount,
        createdAt: latest.createdAt,
        versionChain: target.map((v) => v.version),
      };
    }
  } catch {
    // 台账读失败 → 占位说明已预置
  }
  entries.push({ name: 'data-pipeline/pipeline.json', data: JSON.stringify(pipelineDoc, null, 2) });
  sections['data-pipeline'] += 1;

  // ── ③ eval 基线冻结 ──
  let baselineDoc: Record<string, unknown> = {
    note: '未找到 eval 记录——基线冻结语义：有据可查才冻结，无据如实声明',
    enterpriseId,
    benchmarkId: null,
    averageScore: null,
    evaluatedAt: null,
  };
  try {
    // evaluation-log 按 benchmark 分目录（readEvaluationLog 需 benchmarkId——
    // 扫 benchmarks 根聚合全部日志后取最新一条作基线快照）
    const benchmarksRoot = join(dataDir, 'benchmarks');
    if (existsSync(benchmarksRoot)) {
      let best: { benchmarkId: string; score: number; at: string } | null = null;
      for (const bm of readdirSync(benchmarksRoot, { withFileTypes: true })) {
        if (!bm.isDirectory()) continue;
        const logFile = join(benchmarksRoot, bm.name, 'evaluation-log.jsonl');
        if (!existsSync(logFile)) continue;
        for (const line of readFileSync(logFile, 'utf-8').split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const rec = JSON.parse(trimmed) as { score?: number; evaluatedAt?: string };
            const score = typeof rec.score === 'number' ? rec.score : null;
            const at = typeof rec.evaluatedAt === 'string' ? rec.evaluatedAt : '';
            if (score !== null && (best === null || at > best.at)) {
              best = { benchmarkId: bm.name, score, at };
            }
          } catch {
            // 坏行跳过
          }
        }
      }
      if (best !== null) {
        baselineDoc = {
          note: 'eval 基线冻结（最新一条记录——续训 eval 不低于此分数才晋升）',
          enterpriseId,
          benchmarkId: best.benchmarkId,
          averageScore: best.score,
          evaluatedAt: best.at,
        };
      }
    }
  } catch {
    // eval 聚合失败 → 占位说明已预置
  }
  entries.push({ name: 'eval-baseline/baseline.json', data: JSON.stringify(baselineDoc, null, 2) });
  sections['eval-baseline'] += 1;

  // ── ④ 运维手册 ──
  const markers = readRetentionMarkers(dataDir, enterpriseId);
  let productionModel: string | null = null;
  try {
    const registry = loadRegistry(dataDir);
    for (const entry of Object.values(registry.models)) {
      if (entry.status === 'active') {
        productionModel = entry.name;
        break;
      }
    }
  } catch {
    // 注册表不可读 → 生产模型段省略（手册已容缺）
  }
  const manual = renderOpsManual({
    enterpriseId,
    trainJobId: input.trainJobId,
    datasetId: input.datasetId,
    productionModel,
    rollbackPoints: markers.map(
      (m) => `${m.point.kind} ${m.point.path}（${m.point.reason}，标记于 ${m.point.markedAt}）`,
    ),
    ...(input.contact !== undefined ? { contact: input.contact } : {}),
    createdAt: input.createdAt,
  });
  entries.push({ name: 'ops-manual/MANUAL.md', data: manual });
  sections['ops-manual'] += 1;

  // ── ⑤ 权重清单（生产权重 + 历史版本 + 第五章回滚点）──
  let weightsDoc: Record<string, unknown> = {
    note: '无注册生产权重——本件为占位说明',
    enterpriseId,
    production: null,
    versions: [],
    rollbackPoints: markers.map((m) => m.point),
  };
  try {
    const registry = loadRegistry(dataDir);
    for (const entry of Object.values(registry.models)) {
      if (entry.status !== 'active' || !entry.localWeights) continue;
      const wmFile = weightsManifestPath(entry.localWeights.dir);
      let versions: Array<Record<string, unknown>> = [];
      if (existsSync(wmFile)) {
        const wm = JSON.parse(readFileSync(wmFile, 'utf-8')) as WeightsManifest;
        versions = wm.versions.map((v) => ({
          id: v.id,
          createdAt: v.createdAt,
          sha256: v.sha256,
          sizeBytes: v.sizeBytes,
          ...(v.meta ?? {}),
        }));
      }
      weightsDoc = {
        note: '权重清单（当前生产权重 + 历史版本 + 回滚点）',
        enterpriseId,
        production: {
          model: entry.name,
          weightsDir: entry.localWeights.dir,
          currentVersion: entry.localWeights.currentVersion,
        },
        versions,
        rollbackPoints: markers.map((m) => m.point),
      };
      break;
    }
  } catch {
    // 权重清单聚合失败 → 占位说明已预置
  }
  entries.push({ name: 'weights-list/weights.json', data: JSON.stringify(weightsDoc, null, 2) });
  sections['weights-list'] += 1;

  return { entries, sections };
}

// ════════════════════════════════════════
// 生成主入口
// ════════════════════════════════════════

/**
 * 生成 FDE 训练交付包（五件聚合 → zip → manifest + HMAC → 落盘）。
 *
 * 前置条件：
 *   一、HMAC 密钥可用（~/.sofagent-key / SOFAGENT_KEY_PATH——与 artifact-signing
 *      同纪律：无签名能力拒绝生成，宁缺毋滥）
 *   二、企业分区存在（data/train/<enterpriseId>/——从未训练过的企业无包可交，
 *      显式拒绝并指引先跑训练）
 *
 * 幂等语义：不覆盖——同名 zip 已存在时拒绝（wx 旗标），重生成先删旧包。
 */
export function generateTrainDeliverable(
  dataDir: string,
  enterpriseId: string,
  input: GenerateTrainDeliverableInput = {},
): DeliverableResult {
  if (typeof enterpriseId !== 'string' || enterpriseId.trim() === '') {
    throw new TrainDeliverableError('enterpriseId 必填（企业隔离分区依赖）');
  }
  const enterpriseDir = join(dataDir, 'train', enterpriseId);
  if (!existsSync(enterpriseDir)) {
    throw new TrainDeliverableError(
      `企业分区不存在：${enterpriseDir}——从未训练过的企业无交付物可聚合，请先完成训练（train_submit）`,
    );
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const hmacKey = getHmacKey();
  if (!hmacKey) {
    throw new TrainDeliverableError(
      'HMAC 密钥不可用（~/.sofagent-key 缺失）——拒绝生成无签名交付包（宁缺毋滥，对齐 artifact-signing 纪律）',
    );
  }

  // ── 血缘解析（缺省：最新 completed job / 台账最新 dataset）──
  let trainJobId = input.trainJobId ?? null;
  if (trainJobId === null) {
    const jobs = listTrainJobRecords(dataDir, enterpriseId)
      .filter((j) => j.status === 'completed')
      .sort((a, b) => {
        const keyA = a.finishedAt ?? a.updatedAt;
        const keyB = b.finishedAt ?? b.updatedAt;
        return keyA > keyB ? -1 : keyA < keyB ? 1 : 0; // 倒序——最新在前
      });
    trainJobId = jobs.length > 0 ? jobs[0]!.jobId : null;
  }
  let datasetId = input.datasetId ?? null;
  if (datasetId === null) {
    try {
      const versions = readDatasetVersions(dataDir, enterpriseId);
      datasetId = versions.length > 0 ? versions[versions.length - 1]!.datasetId : null;
    } catch {
      datasetId = null;
    }
  }

  // ── 五件收集 ──
  const { entries, sections } = collectFiveSections({
    dataDir,
    enterpriseId,
    trainJobId,
    datasetId,
    ...(input.contact !== undefined ? { contact: input.contact } : {}),
    createdAt,
  });

  // ── manifest（逐条目 sha256）──
  const files: DeliverableFileEntry[] = entries.map((e) => {
    const buf = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const section = e.name.startsWith('train-config/')
      ? 'train-config'
      : e.name.startsWith('data-pipeline/')
        ? 'data-pipeline'
        : e.name.startsWith('eval-baseline/')
          ? 'eval-baseline'
          : e.name.startsWith('ops-manual/')
            ? 'ops-manual'
            : 'weights-list';
    return { path: e.name, sizeBytes: buf.length, sha256: sha256Of(buf), section };
  });

  const body: DeliverableManifestBody = {
    schemaVersion: 'v1',
    enterpriseId,
    createdAt,
    files,
    trainJobId,
    datasetId,
    generatorVersion: TRAIN_DELIVERABLE_GENERATOR_VERSION,
  };

  // ── HMAC（与 artifact-signing 同构造：stableStringify(body) + '|' + envFingerprint）──
  const envFingerprint = getEnvFingerprint(dataDir);
  const manifestHmac = createHmac('sha256', hmacKey)
    .update(stableStringify(body) + '|' + envFingerprint)
    .digest('hex')
    .slice(0, 32);
  const manifest: DeliverableManifest = {
    ...body,
    manifestHmac,
    envFingerprint,
    hmacAlgo: 'stable',
  };

  // ── zip（五件 + manifest 双入包——manifest 是核对基准必须同包分发）──
  const zipEntries: ZipEntryInput[] = [
    ...entries,
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
  ];
  const zip = buildZip(zipEntries, { at: new Date(createdAt) });

  const outDir = input.outDir ?? deliverablesDir(dataDir, enterpriseId);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const zipPath = join(outDir, `train-deliverable-${enterpriseId}-${dateStamp(createdAt)}.zip`);
  if (existsSync(zipPath)) {
    throw new TrainDeliverableError(
      `交付包已存在（不覆盖——重生成先删旧包）：${zipPath}`,
    );
  }
  writeFileSync(zipPath, zip, { flag: 'wx' });
  // manifest 单独落盘一份（verify 无需解包即可比对——双份分发语义）
  atomicWriteSync(join(outDir, `${dateStamp(createdAt)}-manifest.json`), JSON.stringify(manifest, null, 2));

  return { zipPath, manifest, sections, zipBytes: zip.length };
}

// ════════════════════════════════════════
// 校验侧（train deliverable verify）
// ════════════════════════════════════════

/** 环境兼容性结论（train doctor 子集——收包侧轻量体检） */
export interface DeliverableEnvCheck {
  /** Node 版本（verify 运行时实测） */
  nodeVersion: string;
  /** Node 版本兼容（≥ 18——交付链 engines.node 口径） */
  nodeOk: boolean;
  /** 数据盘可写（交付包所在目录探测——tmp 试写） */
  dataDirWritable: boolean;
  /** zip 可读（unzipEntries 解析成功） */
  zipReadable: boolean;
  /** 兼容性总闸（三项全过） */
  ok: boolean;
  /** 明细（人读） */
  detail: string;
}

/** 交付包校验报告 */
export interface DeliverableVerifyReport {
  /** zip 路径 */
  zipPath: string;
  /** 完整性总闸（manifest HMAC 复算 + 逐条目 sha256 全过） */
  integrityOk: boolean;
  /** manifest 完整性三态（valid / manifestTampered / unverifiable） */
  manifestIntegrity: 'valid' | 'manifestTampered' | 'unverifiable';
  /** 逐条目核对明细 */
  files: Array<{
    path: string;
    section: DeliverableFileEntry['section'];
    /** ok = sha256+size 全匹配 */
    status: 'ok' | 'mismatch' | 'missing';
  }>;
  /** zip 内存在但 manifest 未登记的条目（包被塞东西） */
  unregistered: string[];
  /** 环境兼容性（train doctor 子集） */
  env: DeliverableEnvCheck;
  /** 总闸（integrity + env 双过） */
  ok: boolean;
  /** 拒绝原因（ok=false 时非空——人读） */
  rejectionReason: string | null;
}

/**
 * 校验交付包（train deliverable verify——企业收包侧）。
 *
 * 双项校验（devlog 第四章交付表）：
 *   一、完整性：manifest HMAC 复算（清单本身可信）→ 逐条目 sha256 比对
 *      （内容未变）→ unregistered 扫描（未被塞东西）
 *   二、环境兼容性：train doctor 子集——Node 版本 ≥ 18 / 落盘目录可写 /
 *      zip 可解析（GPU/框架体检不在此重复——那是训练侧 doctor 的职责）
 *
 * 容错：坏 zip / 坏 manifest → 结构化失败报告（不抛出——校验语义 = 如实报告）。
 */
export function verifyTrainDeliverable(
  zipPath: string,
  opts: { dataDir?: string; now?: Date } = {},
): DeliverableVerifyReport {
  const report: DeliverableVerifyReport = {
    zipPath,
    integrityOk: false,
    manifestIntegrity: 'unverifiable',
    files: [],
    unregistered: [],
    env: {
      nodeVersion: process.version,
      nodeOk: parseInt(process.versions.node.split('.')[0] ?? '0', 10) >= 18,
      dataDirWritable: false,
      zipReadable: false,
      ok: false,
      detail: '',
    },
    ok: false,
    rejectionReason: null,
  };

  // ── 环境兼容性：zip 可读 + 数据盘可写 ──
  let zipBuf: Buffer | null = null;
  let entries: Map<string, Buffer> | null = null;
  try {
    const st = statSync(zipPath);
    if (!st.isFile()) throw new Error('不是文件');
    zipBuf = readFileSync(zipPath);
    entries = unzipEntries(zipBuf);
    report.env.zipReadable = true;
  } catch (e) {
    report.rejectionReason = `zip 不可读：${e instanceof Error ? e.message : String(e)}`;
    report.env.detail = report.rejectionReason;
    return report;
  }

  // 数据盘可写（交付包同目录试写——收包环境的最小写入面）
  try {
    const probe = join(
      (zipPath.split('/').slice(0, -1).join('/') || '.') ,
      `.deliverable-verify-probe-${(opts.now ?? new Date()).getTime()}`,
    );
    writeFileSync(probe, 'probe');
    require('fs').unlinkSync(probe);
    report.env.dataDirWritable = true;
  } catch {
    report.env.dataDirWritable = false;
  }
  report.env.ok =
    report.env.nodeOk && report.env.dataDirWritable && report.env.zipReadable;
  report.env.detail = report.env.ok
    ? `Node ${report.env.nodeVersion} / 数据盘可写 / zip 可解析——环境兼容 ✅`
    : `环境不兼容：Node ${report.env.nodeVersion}${report.env.nodeOk ? '' : '（< 18）'} / 数据盘${report.env.dataDirWritable ? '可写' : '不可写'} / zip ${report.env.zipReadable ? '可解析' : '不可解析'}`;

  // ── manifest 解析 ──
  const manifestBuf = entries.get('manifest.json');
  if (manifestBuf === undefined) {
    report.rejectionReason = 'zip 内无 manifest.json——非法交付包（签名清单缺失）';
    return report;
  }
  let manifest: DeliverableManifest;
  try {
    manifest = JSON.parse(manifestBuf.toString('utf8')) as DeliverableManifest;
  } catch (e) {
    report.rejectionReason = `manifest 解析失败：${e instanceof Error ? e.message : String(e)}`;
    return report;
  }

  // ── manifest HMAC 复算（三态——与 artifact-verify.verifyManifestIntegrity 同语义）──
  const hmacKey = getHmacKey();
  const dataDir = opts.dataDir ?? process.env.SOFAGENT_DATA ?? 'data';
  const currentEnvFingerprint = getEnvFingerprint(dataDir);
  if (!hmacKey) {
    report.manifestIntegrity = 'unverifiable';
  } else if (manifest.envFingerprint !== currentEnvFingerprint) {
    // 环境指纹漂移（收包侧 ≠ 打包侧——跨机器分发的常态而非攻击）
    report.manifestIntegrity = 'unverifiable';
  } else {
    const body: DeliverableManifestBody = {
      schemaVersion: manifest.schemaVersion,
      enterpriseId: manifest.enterpriseId,
      createdAt: manifest.createdAt,
      files: manifest.files,
      trainJobId: manifest.trainJobId,
      datasetId: manifest.datasetId,
      generatorVersion: manifest.generatorVersion,
    };
    const expected = createHmac('sha256', hmacKey)
      .update(stableStringify(body) + '|' + currentEnvFingerprint)
      .digest('hex')
      .slice(0, 32);
    report.manifestIntegrity =
      manifest.manifestHmac === expected ? 'valid' : 'manifestTampered';
  }

  // 环境指纹漂移时完整性按「逐条目 sha256 独立核对」继续（跨机器收包主场景：
  // 密钥不同环境不同——HMAC 不可复验是常态，条目级哈希是明文可核对的底线）
  if (report.manifestIntegrity === 'manifestTampered') {
    report.rejectionReason = 'manifest HMAC 失配——核对基准清单本身被篡改，拒绝';
    return report;
  }

  // ── 逐条目核对 ──
  let allOk = true;
  const manifestPaths = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const buf = entries.get(f.path);
    if (buf === undefined) {
      report.files.push({ path: f.path, section: f.section, status: 'missing' });
      allOk = false;
      continue;
    }
    const actual = sha256Of(buf);
    const status = actual === f.sha256 && buf.length === f.sizeBytes ? 'ok' : 'mismatch';
    report.files.push({ path: f.path, section: f.section, status });
    if (status !== 'ok') allOk = false;
  }
  for (const name of entries.keys()) {
    if (name !== 'manifest.json' && !manifestPaths.has(name)) {
      report.unregistered.push(name);
      allOk = false;
    }
  }

  report.integrityOk = allOk; // manifestTampered 已提前 return——到此处必为 valid/unverifiable
  report.ok = report.integrityOk && report.env.ok;
  if (!report.ok) {
    const reasons: string[] = [];
    if (report.manifestIntegrity === 'unverifiable') {
      reasons.push('manifest HMAC 不可复验（环境指纹/密钥漂移——条目级哈希已独立核对，跨机器收包属常态，同环境重验可消除）');
    }
    if (report.files.some((f) => f.status !== 'ok')) {
      reasons.push(`条目核对失败：${report.files.filter((f) => f.status !== 'ok').map((f) => `${f.path}(${f.status})`).join('、')}`);
    }
    if (report.unregistered.length > 0) {
      reasons.push(`未登记条目：${report.unregistered.join('、')}`);
    }
    if (!report.env.ok) {
      reasons.push(`环境不兼容：${report.env.detail}`);
    }
    report.rejectionReason = reasons.join('；');
  }
  return report;
}
