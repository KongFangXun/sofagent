// train-env.ts · v1.4.2 块一 · 训练环境准备（双栈分支检测 + 就绪报告）
//
// 定位：训练引擎的「第零步」——跑训练前先回答三个问题：
//   一、这台机器上有什么 GPU（CUDA / Metal / 无）？
//   二、对应装哪个框架（生产 = Python 栈 spawn；Mac 开发机 = @mlx-node/trl 纯 Node 路径）？
//   三、装完是否真的可用（版本可探测）？
// 决策点流程：检测 GPU → 安装/配置框架 → 验证可用 → 输出就绪报告（结构化 JSON）。
//
// 双栈分支（与 docs/guides/train-stack.md 同源）：
//   - cuda-ready：检测到可用 CUDA（nvidia-smi 存在且可用）→ 自动安装生产框架
//     （默认 verl），报告含 CUDA 版本 + 框架版本 + 显存余量。Linux GPU 真机验收
//     留 v1.4.3（本版以单测 mock 验收契约）。
//   - metal-degraded：无 CUDA → 明确降级提示，走 @mlx-node/trl 路径（阶段 0 纯
//     Node 验证 reward 收敛用）；macOS 上用 system_profiler SPDisplaysDataType
//     探测 Metal 支持。隔离安装纪律：npm --prefix 到 os.tmpdir() 独立目录，
//     绝不碰仓库 package.json / node_modules。
//
// 可测试性：GPU 检测 / 安装 / 验证全部依赖注入（exec 探测函数可 mock）——
// 单测零真实进程、零真实安装（Mac 真机分支另有一条真实 exec 集成用例）。

import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

// ══════════════════════════════════════
// 依赖注入接口（测试零真实进程）
// ══════════════════════════════════════

/** 命令执行结果（stdout/stderr 文本） */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * 可注入的命令探测函数——train-env 的唯一 IO 出口。
 * 命令不存在 / 非零退出 / 超时 → reject（调用方据此判定「不可用」）。
 */
export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
) => Promise<ExecResult>;

/** 默认实现：node child_process.execFile 封装（utf8 + 15s 超时兜底） */
const defaultExec: ExecFn = (cmd, args, opts) =>
  new Promise<ExecResult>((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts?.cwd, timeout: opts?.timeoutMs ?? 15_000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });

/**
 * 生产用 exec 工厂（v1.4.2 章四）：env-manager / MCP train_doctor 等调用方
 * 不想各自包装 execFile 时取这个默认实现（测试仍走依赖注入 mock）。
 */
export function makeDefaultExecFn(): ExecFn {
  return defaultExec;
}

/** 环境准备依赖（全部可注入——单测 mock，真机走默认） */
export interface TrainEnvDeps {
  /** 命令探测（默认 execFile 封装） */
  exec: ExecFn;
  /** 当前平台（默认 process.platform；决定是否探测 Metal） */
  platform: NodeJS.Platform;
  /** 框架安装（默认 pip3 / npm --prefix——见 defaultInstallFramework） */
  installFramework: (target: FrameworkTarget, deps: { exec: ExecFn }) => Promise<void>;
  /** 框架验证（默认跑版本探测命令——见 defaultVerifyFramework） */
  verifyFramework: (
    target: FrameworkTarget,
    deps: { exec: ExecFn },
  ) => Promise<{ name: string; version: string }>;
}

// ══════════════════════════════════════
// GPU 信息模型
// ══════════════════════════════════════

/** 检测到的 GPU（计算后端二选一） */
export interface GpuInfo {
  kind: 'cuda' | 'metal';
  /** GPU 名称（cuda：query-gpu name；metal：Chipset Model） */
  name: string;
  /** cuda 分支：CUDA 版本（如 "12.4"）；metal 分支：不设 */
  cudaVersion?: string;
  /** cuda 分支：驱动版本；metal 分支：不设 */
  driverVersion?: string;
  /** metal 分支：Metal 支持等级（如 "Metal 4"）；cuda 分支：不设 */
  metalSupport?: string;
}

// ══════════════════════════════════════
// 解析层（纯函数——单测直接覆盖）
// ══════════════════════════════════════

/**
 * 从 `nvidia-smi` 默认表头输出解析 CUDA 版本（如 "CUDA Version : 12.4" → "12.4"）。
 * 解析不到 → null（输出损坏或驱动异常，调用方按「不可用」处理）。
 */
export function parseCudaVersion(nvidiaSmiStdout: string): string | null {
  const match = /CUDA Version\s*:\s*([\d.]+)/.exec(nvidiaSmiStdout);
  return match?.[1] ?? null;
}

/**
 * 从 `nvidia-smi --query-gpu=name,driver_version,memory.free --format=csv,noheader,nounits`
 * 输出解析 GPU 明细。输出形如 `NVIDIA A100-SXM4-80GB, 550.54.15, 76012`。
 * 多卡多行时取首行（余量按第一张卡计——多卡调度属 v1.4.3 GPU 队列范围）。
 * 解析不到 → null。
 */
export function parseGpuQueryCsv(csv: string): {
  name: string;
  driverVersion: string;
  freeMiB: number;
} | null {
  const firstLine = csv
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  const parts = firstLine.split(',').map((p) => p.trim());
  if (parts.length < 3) return null;
  const freeMiB = Number.parseInt(parts[2] ?? '', 10);
  if (!Number.isFinite(freeMiB)) return null;
  return {
    name: parts[0] ?? '',
    driverVersion: parts[1] ?? '',
    freeMiB,
  };
}

/**
 * 从 macOS `system_profiler SPDisplaysDataType` 输出解析 Metal GPU 信息。
 * 含非「No」的 Metal Support 行 → 返回 GpuInfo（kind: 'metal'）；
 * 无 Metal 支持（如老核显输出 "Metal Support: No" 或缺失该行）→ null。
 */
export function parseMetalInfo(spDisplaysStdout: string): GpuInfo | null {
  const chipset =
    /Chipset Model:\s*(.+)/.exec(spDisplaysStdout)?.[1]?.trim() ?? null;
  const metalRaw =
    /Metal Support:\s*(.+)/.exec(spDisplaysStdout)?.[1]?.trim() ?? null;
  if (!metalRaw || /^no$/i.test(metalRaw)) return null;
  return {
    kind: 'metal',
    name: chipset ?? 'Apple GPU',
    metalSupport: metalRaw,
  };
}

// ══════════════════════════════════════
// 检测层（exec 注入——失败即不可用）
// ══════════════════════════════════════

/** CUDA 检测结论（gpu 为 null = 无可用 CUDA） */
export interface CudaDetection {
  gpu: GpuInfo | null;
  /** 显存余量（MiB）——gpu 为 null 时不设 */
  freeVramMiB?: number;
}

/**
 * 检测 CUDA：`nvidia-smi` 存在且可用才算数（命令缺失 / 非零退出 / 输出损坏
 * 一律 null——「装了驱动但坏了」不比「没装」更可用）。
 * 明细与显存余量用 --query-gpu=memory.free 同族 CSV 查询（name/driver 一并取，
 * nounits 便于解析）。
 */
export async function detectCudaGpu(exec: ExecFn): Promise<CudaDetection> {
  // 探测一：命令存在 + 驱动可用（默认输出含 CUDA Version 表头）
  let smiOut: ExecResult;
  try {
    smiOut = await exec('nvidia-smi', []);
  } catch {
    return { gpu: null };
  }
  const cudaVersion = parseCudaVersion(smiOut.stdout);
  if (!cudaVersion) return { gpu: null };

  // 探测二：明细（名称 / 驱动版本 / 显存余量）——失败降级为「有 CUDA 但明细缺失」
  let detail: ReturnType<typeof parseGpuQueryCsv> = null;
  try {
    const q = await exec('nvidia-smi', [
      '--query-gpu=name,driver_version,memory.free',
      '--format=csv,noheader,nounits',
    ]);
    detail = parseGpuQueryCsv(q.stdout);
  } catch {
    detail = null;
  }

  return {
    gpu: {
      kind: 'cuda',
      name: detail?.name ?? 'NVIDIA GPU',
      cudaVersion,
      driverVersion: detail?.driverVersion,
    },
    freeVramMiB: detail?.freeMiB,
  };
}

/**
 * 检测 Metal（仅 darwin）：`system_profiler SPDisplaysDataType` 查 Metal 支持。
 * 非 macOS 平台直接 null（Linux 无 CUDA 即无 GPU 可用，不误报 Metal）。
 */
export async function detectMetalGpu(
  exec: ExecFn,
  platform: NodeJS.Platform,
): Promise<GpuInfo | null> {
  if (platform !== 'darwin') return null;
  try {
    const out = await exec('system_profiler', ['SPDisplaysDataType']);
    return parseMetalInfo(out.stdout);
  } catch {
    return null;
  }
}

// ══════════════════════════════════════
// 框架安装与验证（默认实现）
// ══════════════════════════════════════

/** 框架安装目标（分支决定包生态：Python 生产栈 / npm 降级栈） */
export interface FrameworkTarget {
  branch: 'cuda-ready' | 'metal-degraded';
  /** cuda-ready → Python 包名（verl/trl/deepspeed）；metal-degraded → npm 包名 */
  frameworkName: string;
  /** metal 降级路径的隔离安装目录（npm --prefix；cuda 分支忽略） */
  installDir?: string;
}

/** 生产分支默认框架（verl——RL 后训练主流生产框架，可换 TRL/DeepSpeed） */
export const DEFAULT_CUDA_FRAMEWORK = 'verl';
/** 降级分支框架（阶段 0 纯 Node 路径——Apple Silicon Metal 专用实验包） */
export const DEFAULT_MLX_FRAMEWORK = '@mlx-node/trl';

/** Metal 降级路径的隔离安装目录（os.tmpdir() 下独立目录——不碰仓库 package.json） */
export function defaultMlxInstallDir(): string {
  return path.join(os.tmpdir(), 'sofagent-train-env');
}

/** Python 包名 → import 模块名（当前三者同名，留显式映射防未来包名/模块名分叉） */
function pythonModuleOf(pkgName: string): string {
  const known: Record<string, string> = {
    verl: 'verl',
    trl: 'trl',
    deepspeed: 'deepspeed',
  };
  return known[pkgName] ?? pkgName;
}

/** 默认安装：cuda-ready → pip3；metal-degraded → npm --prefix 隔离目录 */
async function defaultInstallFramework(
  target: FrameworkTarget,
  deps: { exec: ExecFn },
): Promise<void> {
  if (target.branch === 'cuda-ready') {
    await deps.exec('pip3', ['install', target.frameworkName]);
    return;
  }
  // 隔离纪律：npm --prefix 装进独立目录（该目录内的 package.json/node_modules
  // 与仓库零交集——阶段 0 实测同款纪律）。
  const installDir = target.installDir ?? defaultMlxInstallDir();
  await deps.exec('npm', ['install', target.frameworkName, '--prefix', installDir], {
    cwd: installDir,
  });
}

/** 默认验证：框架版本可探测才算「可用」 */
async function defaultVerifyFramework(
  target: FrameworkTarget,
  deps: { exec: ExecFn },
): Promise<{ name: string; version: string }> {
  if (target.branch === 'cuda-ready') {
    const mod = pythonModuleOf(target.frameworkName);
    const out = await deps.exec('python3', ['-c', `import ${mod}; print(${mod}.__version__)`]);
    return { name: target.frameworkName, version: out.stdout.trim() };
  }
  // metal：node 在安装目录内解析包版本（cwd = installDir，require 从该处解析）
  const installDir = target.installDir ?? defaultMlxInstallDir();
  const out = await deps.exec(
    'node',
    ['-e', `console.log(require('${target.frameworkName}/package.json').version)`],
    { cwd: installDir },
  );
  return { name: target.frameworkName, version: out.stdout.trim() };
}

// ══════════════════════════════════════
// 主流程：检测 → 安装 → 验证 → 报告
// ══════════════════════════════════════

/** 环境准备单步记录（审计留痕——报告 steps 数组） */
export interface EnvStep {
  /** 步骤名（gpu-detect-cuda / gpu-detect-metal / framework-install / framework-verify） */
  name: string;
  status: 'ok' | 'skip' | 'fail';
  /** 补充说明（如失败原因 / 跳过原因） */
  detail?: string;
}

/** 训练环境就绪报告（结构化 JSON——决策面与审计的直接消费物） */
export interface TrainEnvReport {
  /** 分支：CUDA 就绪走生产 Python 栈 spawn；无 CUDA 降级走 @mlx-node/trl */
  branch: 'cuda-ready' | 'metal-degraded';
  /** GPU 信息（null = 未检测到任何可用 GPU） */
  gpu: GpuInfo | null;
  /** 框架版本（安装+验证均成功才有；否则 null） */
  framework: { name: string; version: string } | null;
  /** 显存余量（MiB）——仅 cuda 分支；Metal 为统一内存共享，无独立显存概念 → null */
  freeVramMiB: number | null;
  /** 降级提示（仅 metal-degraded 分支；cuda-ready 为 null） */
  degradationHint: string | null;
  /** 环境是否就绪（检测到分支 + 框架安装验证通过） */
  ready: boolean;
  /** 各步骤执行记录（审计留痕） */
  steps: EnvStep[];
  /** 检测时间戳（ISO 8601） */
  checkedAt: string;
}

/** 汇总降级提示文案（metal-degraded 分支专用） */
function buildDegradationHint(hasMetal: boolean): string {
  const gpuPart = hasMetal
    ? '检测到 Apple Metal GPU'
    : '未检测到任何可用 GPU（无 CUDA，且无 Metal）';
  return (
    `${gpuPart}——已降级到 ${DEFAULT_MLX_FRAMEWORK} 路径（阶段 0 纯 Node 验证 reward 收敛）。` +
    '生产训练需 CUDA GPU + Python 框架（verl/TRL/DeepSpeed）spawn，' +
    '双栈契约见 docs/guides/train-stack.md。'
  );
}

/**
 * 训练环境准备主流程：检测 GPU → 安装/配置框架 → 验证可用 → 输出就绪报告。
 *
 * 失败不抛错（环境探测的意义就是「如实报告」）：安装/验证失败记入 steps
 * 并置 ready=false，报告照常返回，由决策面决定是否继续。
 *
 * @param userDeps 可选依赖注入（exec / platform / install / verify——单测 mock 用）
 */
export async function prepareTrainEnv(
  userDeps: Partial<TrainEnvDeps> = {},
): Promise<TrainEnvReport> {
  const deps: TrainEnvDeps = {
    exec: userDeps.exec ?? defaultExec,
    platform: userDeps.platform ?? process.platform,
    installFramework: userDeps.installFramework ?? defaultInstallFramework,
    verifyFramework: userDeps.verifyFramework ?? defaultVerifyFramework,
  };
  const steps: EnvStep[] = [];

  // ── 步骤一：GPU 检测（先 CUDA 后 Metal——生产栈优先） ──
  const cuda = await detectCudaGpu(deps.exec);
  let gpu: GpuInfo | null = null;
  let freeVramMiB: number | null = null;

  if (cuda.gpu) {
    gpu = cuda.gpu;
    freeVramMiB = cuda.freeVramMiB ?? null;
    steps.push({
      name: 'gpu-detect-cuda',
      status: 'ok',
      detail: `${gpu.name} · CUDA ${gpu.cudaVersion} · 余量 ${freeVramMiB ?? '?'} MiB`,
    });
  } else {
    steps.push({
      name: 'gpu-detect-cuda',
      status: 'skip',
      detail: 'nvidia-smi 不存在或不可用',
    });
    const metal = await detectMetalGpu(deps.exec, deps.platform);
    if (metal) {
      gpu = metal;
      steps.push({
        name: 'gpu-detect-metal',
        status: 'ok',
        detail: `${metal.name} · ${metal.metalSupport}`,
      });
    } else {
      steps.push({
        name: deps.platform === 'darwin' ? 'gpu-detect-metal' : 'gpu-detect-metal',
        status: 'skip',
        detail:
          deps.platform === 'darwin'
            ? 'system_profiler 未检出 Metal 支持'
            : '非 macOS 平台不探测 Metal',
      });
    }
  }

  // ── 步骤二：确定分支与框架目标，安装 ──
  const target: FrameworkTarget = cuda.gpu
    ? { branch: 'cuda-ready', frameworkName: DEFAULT_CUDA_FRAMEWORK }
    : {
        branch: 'metal-degraded',
        frameworkName: DEFAULT_MLX_FRAMEWORK,
        installDir: defaultMlxInstallDir(),
      };

  let installed = false;
  try {
    await deps.installFramework(target, { exec: deps.exec });
    installed = true;
    steps.push({
      name: 'framework-install',
      status: 'ok',
      detail: `${target.frameworkName}（${target.branch === 'cuda-ready' ? 'pip3' : 'npm --prefix ' + target.installDir}）`,
    });
  } catch (err) {
    steps.push({
      name: 'framework-install',
      status: 'fail',
      detail: `${target.frameworkName} 安装失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ── 步骤三：验证可用（安装失败则跳过） ──
  let framework: { name: string; version: string } | null = null;
  if (!installed) {
    steps.push({
      name: 'framework-verify',
      status: 'skip',
      detail: '安装未成功，跳过验证',
    });
  } else {
    try {
      framework = await deps.verifyFramework(target, { exec: deps.exec });
      steps.push({
        name: 'framework-verify',
        status: 'ok',
        detail: `${framework.name}@${framework.version}`,
      });
    } catch (err) {
      steps.push({
        name: 'framework-verify',
        status: 'fail',
        detail: `版本探测失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── 步骤四：汇总就绪报告 ──
  const ready = framework != null;
  return {
    branch: target.branch,
    gpu,
    framework,
    freeVramMiB,
    degradationHint: target.branch === 'metal-degraded' ? buildDegradationHint(gpu != null) : null,
    ready,
    steps,
    checkedAt: new Date().toISOString(),
  };
}
