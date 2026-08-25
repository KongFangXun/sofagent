// ============================================================
// train-env.test.ts · v1.4.1 块一 · 训练环境准备模块测试
//
// 覆盖：GPU 检测三场景（nvidia-smi 存在 / 不存在 / system_profiler
// 输出）/ 解析层纯函数 / cuda-ready 全流程 mock / metal-degraded 降级
// 全流程 mock / 安装失败与验证失败容错 / Mac 真机真实 exec 集成用例。
//
// 全部经 deps.exec 注入 mock（零真实进程）；仅最后一组用例走真实
// system_profiler（本机即 Mac——可实测分支验收）。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseCudaVersion,
  parseGpuQueryCsv,
  parseMetalInfo,
  detectCudaGpu,
  detectMetalGpu,
  prepareTrainEnv,
  defaultMlxInstallDir,
  DEFAULT_CUDA_FRAMEWORK,
  DEFAULT_MLX_FRAMEWORK,
  type ExecFn,
  type ExecResult,
  type TrainEnvReport,
} from '../train/train-env';

// ──────────────────────────────────────
// mock 工厂：按命令名路由的假 exec（nvidia-smi / system_profiler / pip3 / npm / python3 / node）
// ──────────────────────────────────────

interface MockRoute {
  /** 命令名 */
  cmd: string;
  /** 可选参数精确匹配（区分同名命令的多次调用；null = 不检查参数） */
  args?: string[];
  /** 匹配到即返回 */
  result: ExecResult | Error;
}

/** 造一个按路由表应答的 exec——表外命令按「不存在」reject（ENOENT 语义） */
function makeExec(routes: MockRoute[]): ExecFn {
  return async (cmd, args) => {
    const hit = routes.find(
      (r) => r.cmd === cmd && (r.args == null || arraysEqual(r.args, args)),
    );
    if (!hit) {
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    }
    if (hit.result instanceof Error) return Promise.reject(hit.result);
    return Promise.resolve(hit.result);
  };
}

/** 数组逐元素相等（浅比较） */
function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** nvidia-smi 默认表头输出样例（真实格式——含 CUDA Version 行） */
const NVIDIA_SMI_TABLE = [
  'Mon Aug 25 10:00:00 2026',
  '+-----------------------------------------------------------------------------------------+',
  '| NVIDIA-SMI 550.54.15              Driver Version: 550.54.15      CUDA Version: 12.4     |',
  '|-----------------------------------------+------------------------+----------------------|',
  '| GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |',
  '|   0  NVIDIA A100-SXM4-80GB    On     00000000:00:04.0   Off |                  N/A |',
  '+-----------------------------------------------------------------------------------------+',
  '',
].join('\n');

/** nvidia-smi 明细 CSV 样例（noheader nounits——真实格式） */
const NVIDIA_SMI_QUERY_CSV = 'NVIDIA A100-SXM4-80GB, 550.54.15, 76012\n';

/** macOS system_profiler SPDisplaysDataType 样例（Apple Silicon 真实格式） */
const SP_DISPLAYS_METAL = [
  'Graphics/Displays:',
  '',
  '    Apple M3 Max:',
  '      Chipset Model: Apple M3 Max',
  '      Type: GPU',
  '      Total Number of Cores: 40',
  '      Vendor: Apple (0x106b)',
  '      Metal Support: Metal 3',
  '      Displays:',
  '        Color LCD:',
  '          Display Type: Built-in Liquid Retina XDR Display',
  '',
].join('\n');

/** 成功应答的快捷构造 */
const ok = (stdout: string): ExecResult => ({ stdout, stderr: '' });

// ──────────────────────────────────────
// 解析层纯函数
// ──────────────────────────────────────

describe('train-env · 解析层纯函数', () => {
  it('test_parseCudaVersion_正常表头_取出CUDA版本号', () => {
    // 场景：nvidia-smi 默认输出含 "CUDA Version: 12.4" → 解析出 12.4
    expect(parseCudaVersion(NVIDIA_SMI_TABLE)).toBe('12.4');
  });

  it('test_parseCudaVersion_无CUDA行_返回null', () => {
    // 场景：输出损坏 / 无 CUDA 信息 → null（调用方按不可用处理）
    expect(parseCudaVersion('garbage output')).toBeNull();
    expect(parseCudaVersion('')).toBeNull();
  });

  it('test_parseGpuQueryCsv_单卡CSV_取名称驱动余量', () => {
    // 场景：单卡 noheader nounits CSV → name/driver/freeMiB 三元组
    const r = parseGpuQueryCsv('NVIDIA A100-SXM4-80GB, 550.54.15, 76012\n');
    expect(r).not.toBeNull();
    expect(r?.name).toBe('NVIDIA A100-SXM4-80GB');
    expect(r?.driverVersion).toBe('550.54.15');
    expect(r?.freeMiB).toBe(76012);
  });

  it('test_parseGpuQueryCsv_多卡多行_取首行', () => {
    // 场景：多卡输出多行 → 首行为准（多卡调度属 v1.4.3 GPU 队列）
    const csv = 'NVIDIA H100, 550.54.15, 40000\nNVIDIA H100, 550.54.15, 38000\n';
    expect(parseGpuQueryCsv(csv)?.freeMiB).toBe(40000);
  });

  it('test_parseGpuQueryCsv_坏行或空_返回null', () => {
    // 场景：空输出 / 列数不足 / 余量非数字 → null
    expect(parseGpuQueryCsv('')).toBeNull();
    expect(parseGpuQueryCsv('only-one-column')).toBeNull();
    expect(parseGpuQueryCsv('A, B, not-a-number')).toBeNull();
  });

  it('test_parseMetalInfo_Metal支持行_返回metalGpuInfo', () => {
    // 场景：Apple Silicon 输出含 "Metal Support: Metal 3" → GpuInfo(kind: metal)
    const r = parseMetalInfo(SP_DISPLAYS_METAL);
    expect(r?.kind).toBe('metal');
    expect(r?.name).toBe('Apple M3 Max');
    expect(r?.metalSupport).toBe('Metal 3');
  });

  it('test_parseMetalInfo_无Metal或为No_返回null', () => {
    // 场景：老核显 "Metal Support: No" 或缺失该行 → null（无可用 Metal）
    expect(parseMetalInfo('      Metal Support: No\n')).toBeNull();
    expect(parseMetalInfo('Graphics/Displays:\n    Some GPU:\n')).toBeNull();
    expect(parseMetalInfo('')).toBeNull();
  });
});

// ──────────────────────────────────────
// 检测层（exec 注入）
// ──────────────────────────────────────

describe('train-env · GPU 检测（exec 注入）', () => {
  it('test_detectCudaGpu_nvidiaSmi存在且可用_返回cudaGpu与显存余量', async () => {
    // 场景一（Linux GPU 分支）：nvidia-smi 存在且输出正常 → cuda 分支成立
    const exec = makeExec([
      { cmd: 'nvidia-smi', args: [], result: ok(NVIDIA_SMI_TABLE) },
      { cmd: 'nvidia-smi', args: ['--query-gpu=name,driver_version,memory.free', '--format=csv,noheader,nounits'], result: ok(NVIDIA_SMI_QUERY_CSV) },
    ]);
    const r = await detectCudaGpu(exec);
    expect(r.gpu?.kind).toBe('cuda');
    expect(r.gpu?.cudaVersion).toBe('12.4');
    expect(r.gpu?.name).toBe('NVIDIA A100-SXM4-80GB');
    expect(r.freeVramMiB).toBe(76012);
  });

  it('test_detectCudaGpu_nvidiaSmi不存在_gpu为null', async () => {
    // 场景二（Mac 实测分支的前置）：命令缺失 reject → null
    const exec = makeExec([]);
    const r = await detectCudaGpu(exec);
    expect(r.gpu).toBeNull();
    expect(r.freeVramMiB).toBeUndefined();
  });

  it('test_detectCudaGpu_命令存在但输出损坏_gpu为null', async () => {
    // 场景：装了驱动但输出无 CUDA Version → 不算可用（坏驱动 ≈ 没装）
    const exec = makeExec([{ cmd: 'nvidia-smi', result: ok('broken') }]);
    const r = await detectCudaGpu(exec);
    expect(r.gpu).toBeNull();
  });

  it('test_detectMetalGpu_darwinSystemProfiler输出_Metal检出', async () => {
    // 场景三：macOS system_profiler 输出 Metal 支持 → metal GpuInfo
    const exec = makeExec([{ cmd: 'system_profiler', result: ok(SP_DISPLAYS_METAL) }]);
    const r = await detectMetalGpu(exec, 'darwin');
    expect(r?.kind).toBe('metal');
    expect(r?.metalSupport).toBe('Metal 3');
  });

  it('test_detectMetalGpu_非darwin平台_不探测返回null', async () => {
    // 场景：Linux 无 CUDA → 不误报 Metal（即便 exec 表里有 system_profiler 也不该被调）
    const exec = makeExec([{ cmd: 'system_profiler', result: ok(SP_DISPLAYS_METAL) }]);
    const r = await detectMetalGpu(exec, 'linux');
    expect(r).toBeNull();
  });

  it('test_detectMetalGpu_darwin但无Metal_返回null', async () => {
    // 场景：macOS 但显示芯片不支持 Metal → null
    const exec = makeExec([{ cmd: 'system_profiler', result: ok('      Metal Support: No\n') }]);
    const r = await detectMetalGpu(exec, 'darwin');
    expect(r).toBeNull();
  });
});

// ──────────────────────────────────────
// 主流程：cuda-ready 分支（Linux GPU 单测 mock 验收）
// ──────────────────────────────────────

describe('train-env · prepareTrainEnv cuda-ready 分支（mock）', () => {
  it('test_prepareTrainEnv_cuda全通_输出cudaReady报告', async () => {
    // 场景：Linux GPU 真机的 mock 等价——检测 → pip3 装 verl → python3 验证版本
    const exec = makeExec([
      { cmd: 'nvidia-smi', args: [], result: ok(NVIDIA_SMI_TABLE) },
      { cmd: 'nvidia-smi', args: ['--query-gpu=name,driver_version,memory.free', '--format=csv,noheader,nounits'], result: ok(NVIDIA_SMI_QUERY_CSV) },
      { cmd: 'pip3', result: ok('Successfully installed verl-0.4.0') },
      { cmd: 'python3', result: ok('0.4.0\n') },
    ]);
    const report = await prepareTrainEnv({ exec, platform: 'linux' });

    expect(report.branch).toBe('cuda-ready');
    expect(report.gpu?.kind).toBe('cuda');
    expect(report.gpu?.cudaVersion).toBe('12.4');
    expect(report.gpu?.name).toBe('NVIDIA A100-SXM4-80GB');
    expect(report.freeVramMiB).toBe(76012);
    expect(report.framework?.name).toBe(DEFAULT_CUDA_FRAMEWORK);
    expect(report.framework?.version).toBe('0.4.0');
    expect(report.degradationHint).toBeNull();
    expect(report.ready).toBe(true);
    // 审计留痕：cuda 命中即不再探 metal——三步全 ok
    const statuses = report.steps.map((s) => s.status);
    expect(statuses).toEqual(['ok', 'ok', 'ok']);
    expect(report.steps[0]?.name).toBe('gpu-detect-cuda');
  });

  it('test_prepareTrainEnv_cuda查询明细失败_仍输出cudaReady但余量null', async () => {
    // 场景：nvidia-smi 主探测通过但 --query-gpu reject → gpu 存在、余量降级 null
    const exec = makeExec([
      { cmd: 'nvidia-smi', result: ok(NVIDIA_SMI_TABLE) },
      { cmd: 'pip3', result: ok('ok') },
      { cmd: 'python3', result: ok('0.4.0\n') },
    ]); // 第二次 nvidia-smi（query-gpu）走表外 → reject
    const report = await prepareTrainEnv({ exec, platform: 'linux' });

    expect(report.branch).toBe('cuda-ready');
    expect(report.gpu?.cudaVersion).toBe('12.4');
    expect(report.gpu?.name).toBe('NVIDIA GPU'); // 明细缺失时的兜底名
    expect(report.freeVramMiB).toBeNull();
    expect(report.ready).toBe(true);
  });

  it('test_prepareTrainEnv_cuda安装失败_readyFalse且步骤留痕', async () => {
    // 场景：pip3 装 verl 失败 → ready=false、install=fail、verify=skip、报告仍返回
    const exec = makeExec([
      { cmd: 'nvidia-smi', args: [], result: ok(NVIDIA_SMI_TABLE) },
      { cmd: 'nvidia-smi', args: ['--query-gpu=name,driver_version,memory.free', '--format=csv,noheader,nounits'], result: ok(NVIDIA_SMI_QUERY_CSV) },
      { cmd: 'pip3', result: new Error('pip install failed: no network') },
    ]);
    const report = await prepareTrainEnv({ exec, platform: 'linux' });

    expect(report.branch).toBe('cuda-ready');
    expect(report.framework).toBeNull();
    expect(report.ready).toBe(false);
    const install = report.steps.find((s) => s.name === 'framework-install');
    expect(install?.status).toBe('fail');
    expect(install?.detail).toContain('pip install failed');
    const verify = report.steps.find((s) => s.name === 'framework-verify');
    expect(verify?.status).toBe('skip');
  });

  it('test_prepareTrainEnv_cuda验证失败_安装ok验证fail', async () => {
    // 场景：装上了但 import 失败（版本探测不出）→ ready=false、verify=fail
    const exec = makeExec([
      { cmd: 'nvidia-smi', args: [], result: ok(NVIDIA_SMI_TABLE) },
      { cmd: 'nvidia-smi', args: ['--query-gpu=name,driver_version,memory.free', '--format=csv,noheader,nounits'], result: ok(NVIDIA_SMI_QUERY_CSV) },
      { cmd: 'pip3', result: ok('ok') },
      { cmd: 'python3', result: new Error('ModuleNotFoundError: No module named verl') },
    ]);
    const report = await prepareTrainEnv({ exec, platform: 'linux' });

    expect(report.framework).toBeNull();
    expect(report.ready).toBe(false);
    const verify = report.steps.find((s) => s.name === 'framework-verify');
    expect(verify?.status).toBe('fail');
    expect(verify?.detail).toContain('ModuleNotFoundError');
  });
});

// ──────────────────────────────────────
// 主流程：metal-degraded 分支（Mac 实测分支的 mock 验收）
// ──────────────────────────────────────

describe('train-env · prepareTrainEnv metal-degraded 分支（mock）', () => {
  it('test_prepareTrainEnv_mac无CUDA有Metal_输出metalDegraded报告含降级提示', async () => {
    // 场景：Mac 开发机——nvidia-smi 不存在 → 降级 + Metal 检出 + 隔离安装验证
    const exec = makeExec([
      { cmd: 'system_profiler', result: ok(SP_DISPLAYS_METAL) },
      { cmd: 'npm', result: ok('added 1 package') },
      { cmd: 'node', result: ok('0.0.10\n') },
    ]);
    const report = await prepareTrainEnv({ exec, platform: 'darwin' });

    expect(report.branch).toBe('metal-degraded');
    expect(report.gpu?.kind).toBe('metal');
    expect(report.gpu?.name).toBe('Apple M3 Max');
    expect(report.gpu?.metalSupport).toBe('Metal 3');
    expect(report.framework?.name).toBe(DEFAULT_MLX_FRAMEWORK);
    expect(report.framework?.version).toBe('0.0.10');
    expect(report.freeVramMiB).toBeNull(); // Metal 统一内存——无独立显存概念
    expect(report.degradationHint).toContain(DEFAULT_MLX_FRAMEWORK);
    expect(report.degradationHint).toContain('train-stack.md');
    expect(report.ready).toBe(true);
    // 步骤序列：cuda skip → metal ok → install ok → verify ok
    const names = report.steps.map((s) => `${s.name}:${s.status}`);
    expect(names).toEqual([
      'gpu-detect-cuda:skip',
      'gpu-detect-metal:ok',
      'framework-install:ok',
      'framework-verify:ok',
    ]);
  });

  it('test_prepareTrainEnv_linux无CUDA无Metal_降级且gpu为null', async () => {
    // 场景：Linux CPU 机器——无 CUDA 也无 Metal，仍走 metal-degraded 分支但无 GPU
    const exec = makeExec([
      { cmd: 'npm', result: ok('added 1 package') },
      { cmd: 'node', result: ok('0.0.10\n') },
    ]);
    const report = await prepareTrainEnv({ exec, platform: 'linux' });

    expect(report.branch).toBe('metal-degraded');
    expect(report.gpu).toBeNull();
    expect(report.degradationHint).toContain('未检测到任何可用 GPU');
    expect(report.ready).toBe(true);
    const metal = report.steps.find((s) => s.name === 'gpu-detect-metal');
    expect(metal?.status).toBe('skip');
    expect(metal?.detail).toBe('非 macOS 平台不探测 Metal');
  });

  it('test_prepareTrainEnv_隔离安装参数_npm带prefix指向tmp目录', async () => {
    // 场景：降级分支的隔离纪律——npm install 必须带 --prefix 且指向 os.tmpdir() 下
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const exec: ExecFn = async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts?.cwd });
      if (cmd === 'system_profiler') return ok(SP_DISPLAYS_METAL);
      if (cmd === 'npm') return ok('added 1 package');
      if (cmd === 'node') return ok('0.0.10\n');
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    };
    const report = await prepareTrainEnv({ exec, platform: 'darwin' });

    expect(report.ready).toBe(true);
    const npmCall = calls.find((c) => c.cmd === 'npm');
    expect(npmCall?.args).toEqual([
      'install',
      DEFAULT_MLX_FRAMEWORK,
      '--prefix',
      defaultMlxInstallDir(),
    ]);
    // 验证阶段的 node 也应在安装目录内解析包
    const nodeCall = calls.find((c) => c.cmd === 'node');
    expect(nodeCall?.cwd).toBe(defaultMlxInstallDir());
  });
});

// ──────────────────────────────────────
// 报告结构化 JSON（序列化往返）
// ──────────────────────────────────────

describe('train-env · 就绪报告结构化 JSON', () => {
  it('test_report_结构化JSON_可序列化往返且字段齐备', async () => {
    // 场景：报告是决策面直接消费物——JSON.stringify/parse 往返不丢字段
    const exec = makeExec([
      { cmd: 'system_profiler', result: ok(SP_DISPLAYS_METAL) },
      { cmd: 'npm', result: ok('ok') },
      { cmd: 'node', result: ok('0.0.10\n') },
    ]);
    const report = await prepareTrainEnv({ exec, platform: 'darwin' });
    const round = JSON.parse(JSON.stringify(report)) as TrainEnvReport;

    expect(round.branch).toBe('metal-degraded');
    expect(round.gpu?.kind).toBe('metal');
    expect(round.framework?.version).toBe('0.0.10');
    expect(round.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(round.steps)).toBe(true);
    expect(round.steps.length).toBe(4);
    // 六个顶层契约字段一个不少（branch/gpu/framework/freeVramMiB/degradationHint/ready）
    expect(Object.keys(round).sort()).toEqual(
      [
        'branch',
        'checkedAt',
        'degradationHint',
        'framework',
        'freeVramMiB',
        'gpu',
        'ready',
        'steps',
      ].sort(),
    );
  });
});

// ──────────────────────────────────────
// Mac 真机集成（真实 exec——本机 darwin 可实测分支验收）
// ──────────────────────────────────────

describe('train-env · Mac 真机真实检测（集成）', () => {
  it('test_prepareTrainEnv_真机Mac_无CUDA降级且Metal真实检出', async () => {
    // 场景：本机 darwin——真实跑 which nvidia-smi（不存在）与 system_profiler
    //（真实 Metal 信息），安装/验证注入 mock（不真装包——安装属阶段 0 实测职责）
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'system_profiler') {
        const { execFile } = await import('node:child_process');
        return new Promise<ExecResult>((resolve, reject) => {
          execFile(cmd, args, { encoding: 'utf8', timeout: 15_000 }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
          });
        });
      }
      if (cmd === 'npm' || cmd === 'node') {
        return ok(cmd === 'npm' ? 'added 1 package' : '0.0.10\n');
      }
      // nvidia-smi 等其他命令 → 真实尝试（Mac 上会 ENOENT reject——正是要验的）
      const { execFile } = await import('node:child_process');
      return new Promise<ExecResult>((resolve, reject) => {
        execFile(cmd, args, { encoding: 'utf8', timeout: 15_000 }, (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
        });
      });
    };

    const report = await prepareTrainEnv({ exec });

    expect(process.platform).toBe('darwin'); // 本用例仅在 Mac 真机有意义
    expect(report.branch).toBe('metal-degraded');
    expect(report.gpu?.kind).toBe('metal');
    expect(report.gpu?.metalSupport).toMatch(/^Metal /); // 真实探出的 Metal 等级
    expect(report.gpu?.name.length ?? 0).toBeGreaterThan(0);
    expect(report.degradationHint).toContain('降级');
    expect(report.ready).toBe(true);
  }, 30_000);
});
