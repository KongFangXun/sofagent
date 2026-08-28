// env-manager.ts · v1.4.2 章四 · 训练环境管理（train env init / train doctor / 环境版本清单）
//
// 定位：双栈方案假设「服务器上有一套 Python 环境」——这套环境谁装、
// 怎么验证、怎么换版本此前没有落点。本文件是 v1.4.2 train-env.ts
// （块一：GPU 检测双分支 + 就绪报告）的**扩展**而非重建：
//   - v1.4.2 prepareTrainEnv：检测 GPU → 安装框架 → 验证 → 就绪报告（保留不动）
//   - v1.4.2 本文件新增：
//       ① trainEnvInit —— 一键安装编排（venv + 框架 + CUDA 校验，脚本化
//          可打包进设备；对齐 tools/train-env-init.sh 的编排逻辑）
//       ② trainDoctor —— 环境体检（CUDA / 显存 / 框架版本 / 基座模型缓存
//          四项——对齐 v1.3.x doctor 模式的结构化体检报告）
//       ③ 环境版本清单 —— train-env.json（Python 版本 + 框架版本 + CUDA
//          版本——train job 记录用的环境版本，训练可复现口径）
//
// 复用来源：
//   - train-env.ts：detectCudaGpu / detectMetalGpu / prepareTrainEnv /
//     ExecFn 依赖注入模式（本文件同款注入）
//   - train-fingerprint.ts EnvSnapshot：环境版本清单与其对齐（train job
//     冻结指纹时引用同一口径）
//   - data-paths getDataDir：数据目录一律走它（禁止硬编码 HOME 回退）
//
// 可测试性：全部 IO（exec / 落盘）依赖注入——单测零真实进程零真实安装。

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import {
  detectCudaGpu,
  detectMetalGpu,
  makeDefaultExecFn,
  type ExecFn,
  type GpuInfo,
} from './train-env';

// ══════════════════════════════════════
// 环境版本清单（train-env.json——训练可复现口径）
// ══════════════════════════════════════

/** 环境版本清单（train job 记录用的环境版本——冻结进指纹的口径同源） */
export interface TrainEnvManifest {
  /** 清单 schema 版本 */
  schemaVersion: 'v1';
  /** Python 版本（python3 --version；未装 → null） */
  pythonVersion: string | null;
  /** 训练框架名+版本（verl/trl/deepspeed/@mlx-node/trl；未装 → null） */
  framework: { name: string; version: string } | null;
  /** CUDA 版本（nvidia-smi；无 → null） */
  cudaVersion: string | null;
  /** GPU 信息（null = 无 GPU） */
  gpu: GpuInfo | null;
  /** 包管理器（pip3 / npm——分支决定） */
  packageManager: 'pip3' | 'npm';
  /** 生成的机器平台（process.platform） */
  platform: NodeJS.Platform;
  /** 生成时间（ISO 8601） */
  generatedAt: string;
}

/** 环境清单文件名（job 目录 / datasets 目录同级约定） */
export const TRAIN_ENV_MANIFEST_FILE = 'train-env.json';

/** 清单落盘路径：{dataDir}/train/{enterpriseId}/train-env.json（单一出口） */
export function trainEnvManifestPath(dataDir: string, enterpriseId: string): string {
  return join(dataDir, 'train', enterpriseId, TRAIN_ENV_MANIFEST_FILE);
}

// ══════════════════════════════════════
// train env init（一键安装编排）
// ══════════════════════════════════════

/** env init 步骤记录（审计留痕——init 与 doctor 共用步骤模型） */
export interface EnvCheckStep {
  name: string;
  status: 'ok' | 'skip' | 'fail';
  detail?: string;
}

/** env init 结果 */
export interface TrainEnvInitResult {
  /** 安装是否全部成功（Python 探测 + 框架安装 + 验证） */
  ok: boolean;
  steps: EnvCheckStep[];
  /** 安装后产出的环境版本清单（失败步骤字段为 null） */
  manifest: TrainEnvManifest;
}

/** 可注入依赖（单测零真实进程） */
export interface EnvManagerDeps {
  /** 命令执行（缺省 makeDefaultExecFn——execFile 封装；测试必注入 mock） */
  exec: ExecFn;
  /** 平台（缺省 process.platform） */
  platform?: NodeJS.Platform;
  /** 时钟（缺省 Date.now） */
  now?: () => number;
}

/** 依赖解析（缺省补齐——调用方只传 exec 也能工作） */
function resolveDeps(userDeps: Partial<EnvManagerDeps>): EnvManagerDeps {
  return {
    exec: userDeps.exec ?? makeDefaultExecFn(),
    platform: userDeps.platform ?? process.platform,
    now: userDeps.now ?? (() => Date.now()),
  };
}

/**
 * train env init 一键安装编排：
 *   1. Python 版本探测（python3 --version——venv 与框架安装的前置）
 *   2. GPU 检测（复用 v1.4.1 detectCudaGpu / detectMetalGpu 决定分支）
 *   3. 框架安装（cuda-ready → pip3 install verl；metal-degraded → 提示
 *      走 tools/train-env-init.sh 的 npm --prefix 隔离路径——Node 侧编排
 *      不重复实现 npm 安装，步骤标 skip 并给指引）
 *   4. 框架验证（版本可探测）
 *   5. 产出 train-env.json 版本清单
 *
 * 失败不抛错（安装器语义 = 如实报告每步结果，ok=false 由调用方处置）。
 */
export async function trainEnvInit(
  dataDir: string,
  enterpriseId: string,
  userDeps: Partial<EnvManagerDeps> = {},
): Promise<TrainEnvInitResult> {
  const deps = resolveDeps(userDeps);
  const steps: EnvCheckStep[] = [];
  const platform = deps.platform ?? process.platform;

  // ── 1. Python 探测 ──
  let pythonVersion: string | null = null;
  try {
    const out = await deps.exec('python3', ['--version']);
    pythonVersion = /Python\s+(\S+)/.exec(out.stdout)?.[1] ?? null;
    steps.push({
      name: 'python-detect',
      status: pythonVersion ? 'ok' : 'fail',
      detail: pythonVersion ?? 'python3 存在但版本解析失败',
    });
  } catch (err) {
    steps.push({
      name: 'python-detect',
      status: 'fail',
      detail: `python3 不可用：${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 2. GPU 检测（复用 v1.4.1——双分支判定） ──
  const cuda = await detectCudaGpu(deps.exec);
  let gpu: GpuInfo | null = null;
  if (cuda.gpu) {
    gpu = cuda.gpu;
    steps.push({
      name: 'gpu-detect',
      status: 'ok',
      detail: `${gpu.name} · CUDA ${gpu.cudaVersion} · 余量 ${cuda.freeVramMiB ?? '?'} MiB`,
    });
  } else {
    const metal = await detectMetalGpu(deps.exec, platform);
    if (metal) {
      gpu = metal;
      steps.push({
        name: 'gpu-detect',
        status: 'ok',
        detail: `${metal.name} · ${metal.metalSupport}（降级分支）`,
      });
    } else {
      steps.push({ name: 'gpu-detect', status: 'skip', detail: '未检测到可用 GPU' });
    }
  }

  // ── 3+4. 框架安装 + 验证 ──
  let framework: { name: string; version: string } | null = null;
  let packageManager: 'pip3' | 'npm' = 'pip3';
  if (cuda.gpu && pythonVersion) {
    // 生产分支：pip3 装 verl（DEFAULT_CUDA_FRAMEWORK 同名约定）
    try {
      await deps.exec('pip3', ['install', 'verl']);
      steps.push({ name: 'framework-install', status: 'ok', detail: 'pip3 install verl' });
      try {
        const vOut = await deps.exec('python3', ['-c', 'import verl; print(verl.__version__)']);
        framework = { name: 'verl', version: vOut.stdout.trim() };
        steps.push({ name: 'framework-verify', status: 'ok', detail: `verl@${framework.version}` });
      } catch (err) {
        steps.push({
          name: 'framework-verify',
          status: 'fail',
          detail: `版本探测失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } catch (err) {
      steps.push({
        name: 'framework-install',
        status: 'fail',
        detail: `pip3 install verl 失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else if (!cuda.gpu) {
    // 降级分支：npm --prefix 隔离安装由 tools/train-env-init.sh 承担
    // （Node 编排不重复实现——单一事实源，指引走脚本）
    packageManager = 'npm';
    steps.push({
      name: 'framework-install',
      status: 'skip',
      detail: '无 CUDA——降级分支请运行 bash tools/train-env-init.sh（npm --prefix 隔离安装 @mlx-node/trl）',
    });
  } else {
    steps.push({
      name: 'framework-install',
      status: 'skip',
      detail: '有 CUDA 但 Python 不可用——先装 Python 3.10+ 再重跑 train env init',
    });
  }

  // ── 5. 版本清单产出（train-env.json——无论成败都落盘快照） ──
  const manifest: TrainEnvManifest = {
    schemaVersion: 'v1',
    pythonVersion,
    framework,
    cudaVersion: gpu?.kind === 'cuda' ? (gpu.cudaVersion ?? null) : null,
    gpu,
    packageManager,
    platform,
    generatedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
  };
  const manifestFile = trainEnvManifestPath(dataDir, enterpriseId);
  const dir = join(manifestFile, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(manifestFile, JSON.stringify(manifest, null, 2));

  const ok = steps.every((s) => s.status !== 'fail');
  return { ok, steps, manifest };
}

// ══════════════════════════════════════
// train doctor（环境体检——只查不装）
// ══════════════════════════════════════

/** 基座模型缓存条目（体检四项之四——目录存在即缓存命中） */
export interface ModelCacheEntry {
  /** 基座模型名（如 Qwen3-8B） */
  name: string;
  /** 缓存目录是否存在 */
  cached: boolean;
  /** 缓存路径 */
  path: string;
}

/** doctor 体检报告（结构化 JSON——MCP train_doctor tool 直接消费） */
export interface TrainDoctorReport {
  /** 四项体检整体结论（全 ok 才 ready） */
  ready: boolean;
  /** CUDA 检查 */
  cuda: { status: 'ok' | 'fail'; version: string | null; gpuName: string | null; detail: string };
  /** 显存检查（无 GPU → skip 语义并入 detail） */
  vram: { status: 'ok' | 'fail' | 'skip'; freeMiB: number | null; detail: string };
  /** 框架版本检查（train-env.json 清单引用——没装过 init 则 fail） */
  framework: {
    status: 'ok' | 'fail';
    name: string | null;
    version: string | null;
    detail: string;
  };
  /** 基座模型缓存检查（候选清单逐个查目录） */
  modelCache: { status: 'ok' | 'fail'; entries: ModelCacheEntry[]; detail: string };
  /** 环境版本清单引用（train-env.json——可复现口径） */
  manifest: TrainEnvManifest | null;
  steps: EnvCheckStep[];
  checkedAt: string;
}

/** 基座模型缓存的默认候选清单（十数 GB 级——只查不下载，下载走 model-downloader） */
export const DEFAULT_BASE_MODEL_CANDIDATES: readonly string[] = ['Qwen3-8B', 'Qwen3-14B'];

/**
 * train doctor 环境体检：CUDA / 显存 / 框架版本 / 基座模型缓存四项
 * （只查不装——对齐 v1.3.x doctor 模式：结构化报告 + ready 汇总结论）。
 *
 * 模型缓存查找路径：{dataDir}/models/<name>/（model-downloader 的统一
 * 落点——doctor 只查缓存，「没有时怎么拿到」是 downloader 的职责边界）。
 */
export async function trainDoctor(
  dataDir: string,
  enterpriseId: string,
  userDeps: Partial<EnvManagerDeps> = {},
  options: { baseModels?: readonly string[] } = {},
): Promise<TrainDoctorReport> {
  const deps = resolveDeps(userDeps);
  const steps: EnvCheckStep[] = [];
  const platform = deps.platform ?? process.platform;
  const candidates = options.baseModels ?? DEFAULT_BASE_MODEL_CANDIDATES;

  // ── ① CUDA 检查 ──
  const cuda = await detectCudaGpu(deps.exec);
  const cudaSection: TrainDoctorReport['cuda'] = cuda.gpu
    ? {
        status: 'ok',
        version: cuda.gpu.cudaVersion ?? null,
        gpuName: cuda.gpu.name,
        detail: `${cuda.gpu.name} · CUDA ${cuda.gpu.cudaVersion ?? '?'}`,
      }
    : {
        status: 'fail',
        version: null,
        gpuName: null,
        detail: 'nvidia-smi 不可用——无 CUDA GPU（Metal 降级分支另见 train-env 清单）',
      };
  steps.push({ name: 'cuda-check', status: cudaSection.status, detail: cudaSection.detail });

  // ── ② 显存检查 ──
  const vramSection: TrainDoctorReport['vram'] = cuda.gpu
    ? cuda.freeVramMiB !== undefined
      ? {
          status: cuda.freeVramMiB > 8 * 1024 ? 'ok' : 'fail',
          freeMiB: cuda.freeVramMiB,
          detail: `空闲显存 ${cuda.freeVramMiB} MiB（8B 模型训练建议 ≥ 8192 MiB）`,
        }
      : {
          status: 'skip',
          freeMiB: null,
          detail: '有 CUDA 但显存查询失败（--query-gpu 不可用）',
        }
    : { status: 'skip', freeMiB: null, detail: '无 CUDA GPU——显存检查跳过' };
  steps.push({ name: 'vram-check', status: vramSection.status, detail: vramSection.detail });

  // ── ③ 框架版本检查（train-env.json 清单引用） ──
  const manifestFile = trainEnvManifestPath(dataDir, enterpriseId);
  let manifest: TrainEnvManifest | null = null;
  if (existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(readFileSync(manifestFile, 'utf-8')) as TrainEnvManifest;
    } catch {
      manifest = null;
    }
  }
  const frameworkSection: TrainDoctorReport['framework'] = manifest?.framework
    ? {
        status: 'ok',
        name: manifest.framework.name,
        version: manifest.framework.version,
        detail: `${manifest.framework.name}@${manifest.framework.version}（train-env.json 清单引用）`,
      }
    : {
        status: 'fail',
        name: null,
        version: null,
        detail: '框架未安装或清单缺失——先运行 train env init（或 bash tools/train-env-init.sh）',
      };
  steps.push({ name: 'framework-check', status: frameworkSection.status, detail: frameworkSection.detail });

  // ── ④ 基座模型缓存检查 ──
  const entries: ModelCacheEntry[] = candidates.map((name) => {
    const modelPath = join(dataDir, 'models', name);
    return { name, cached: existsSync(modelPath), path: modelPath };
  });
  const cachedCount = entries.filter((e) => e.cached).length;
  const modelCacheSection: TrainDoctorReport['modelCache'] = {
    status: cachedCount > 0 ? 'ok' : 'fail',
    entries,
    detail:
      cachedCount > 0
        ? `${cachedCount}/${entries.length} 个基座模型已缓存（${entries.filter((e) => e.cached).map((e) => e.name).join(', ')}）`
        : `基座模型缓存为空（候选：${candidates.join(', ')}）——用 model-downloader 下载（断点续传）`,
  };
  steps.push({ name: 'model-cache-check', status: modelCacheSection.status, detail: modelCacheSection.detail });

  // ── 汇总（四项全 ok 才 ready；Metal 降级环境 CUDA fail 是预期——manifest 有降级记录即可） ──
  // 降级分支的口径：CUDA/显存两项由 manifest 的 metal 记录替代（Metal 无
  // 独立显存查询口径——vram skip 即降级环境的通过态）；框架与缓存两项不变。
  const isMetalDegraded = platform === 'darwin' && manifest !== null && manifest.gpu?.kind === 'metal';
  const cudaOkForPlatform = cudaSection.status === 'ok' || isMetalDegraded;
  const vramOkForPlatform = vramSection.status === 'ok' || (isMetalDegraded && vramSection.status === 'skip');
  const ready =
    cudaOkForPlatform && vramOkForPlatform && frameworkSection.status === 'ok' && modelCacheSection.status === 'ok';

  return {
    ready,
    cuda: cudaSection,
    vram: vramSection,
    framework: frameworkSection,
    modelCache: modelCacheSection,
    manifest,
    steps,
    checkedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
  };
}
