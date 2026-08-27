// ============================================================
// env-manager.test.ts · v1.4.2 章四 · 训练环境管理测试
//
// 覆盖：
//   - trainEnvInit 一键安装编排（python 探测 / GPU 双分支检测 /
//     pip3 装 verl 生产分支 / Metal 降级分支走脚本指引 / manifest 落盘）
//   - trainEnvInit 失败容错（python 不可用 / pip3 失败——ok=false 如实报告）
//   - trainDoctor 四项体检（CUDA / 显存 / 框架清单引用 / 基座模型缓存）
//   - Metal 降级环境 ready 判定（darwin + metal manifest → CUDA fail 是预期）
//   - train-env.json 清单模型（TrainEnvManifest 字段口径）
//
// 全部经 deps.exec 注入 mock（零真实进程零真实安装——对齐 train-env.test.ts
// 的 makeExec 路由表模式）；dataDir 用临时目录（落盘验证用）。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  trainEnvInit,
  trainDoctor,
  trainEnvManifestPath,
  TRAIN_ENV_MANIFEST_FILE,
  DEFAULT_BASE_MODEL_CANDIDATES,
  type EnvManagerDeps,
  type TrainEnvManifest,
} from '../train/env-manager';
import type { ExecFn, ExecResult } from '../train/train-env';

// ──────────────────────────────────────
// mock 工厂（对齐 train-env.test.ts 模式——按命令路由的假 exec）
// ──────────────────────────────────────

interface MockRoute {
  cmd: string;
  args?: string[] | null; // null = 不检查参数
  result: ExecResult | Error;
}

function makeExec(routes: MockRoute[]): ExecFn {
  return async (cmd, args) => {
    const hit = routes.find((r) => r.cmd === cmd && (r.args == null || r.args === undefined || arraysEqual(r.args, args)));
    if (!hit) return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    if (hit.result instanceof Error) return Promise.reject(hit.result);
    return Promise.resolve(hit.result);
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const ok = (stdout: string): ExecResult => ({ stdout, stderr: '' });

/** nvidia-smi 表头（含 CUDA Version 行） */
const NVIDIA_SMI_TABLE = [
  'Mon Aug 25 10:00:00 2026',
  '| NVIDIA-SMI 550.54.15    Driver Version: 550.54.15    CUDA Version: 12.4     |',
  '|   0  NVIDIA A100-SXM4-80GB    On     00000000:00:04.0   Off |              N/A |',
].join('\n');

const NVIDIA_SMI_QUERY_CSV = 'NVIDIA A100-SXM4-80GB, 550.54.15, 76012\n';

const SP_DISPLAYS_METAL = [
  'Graphics/Displays:',
  '    Apple M3 Max:',
  '      Chipset Model: Apple M3 Max',
  '      Metal Support: Metal 3',
  '      Displays:',
  '        Color LCD:',
  '',
].join('\n');

/** Linux 平台注入（模拟生产服务器——CUDA 生产分支） */
const LINUX: NodeJS.Platform = 'linux';
/** darwin 平台注入（模拟 Mac——Metal 降级分支） */
const DARWIN: NodeJS.Platform = 'darwin';

const FIXED_NOW = () => 1_800_000_000_000;

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-envmgr-test-'));
});

/** 读落盘的 manifest（断言用） */
function readManifest(enterpriseId: string): TrainEnvManifest {
  const p = trainEnvManifestPath(dataDir, enterpriseId);
  expect(existsSync(p)).toBe(true);
  return JSON.parse(readFileSync(p, 'utf-8')) as TrainEnvManifest;
}

// ──────────────────────────────────────
// trainEnvInit · 生产分支（Linux + CUDA）
// ──────────────────────────────────────

describe('env-manager · trainEnvInit 生产分支', () => {
  it('test_trainEnvInit_cuda生产分支_pip3装verl并写manifest', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec: ExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === 'nvidia-smi' && args.length === 0) return ok(NVIDIA_SMI_TABLE);
      if (cmd === 'nvidia-smi' && args[0]?.startsWith('--query-gpu')) return ok(NVIDIA_SMI_QUERY_CSV);
      if (cmd === 'python3' && args[0] === '--version') return ok('Python 3.11.4');
      if (cmd === 'pip3') return ok('Successfully installed verl-0.4.0');
      if (cmd === 'python3' && args[0] === '-c') return ok('0.4.0');
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    };
    const r = await trainEnvInit(dataDir, 'ent-prod', { exec, platform: LINUX, now: FIXED_NOW });

    // 全步骤成功 → ok=true
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual([
      'python-detect',
      'gpu-detect',
      'framework-install',
      'framework-verify',
    ]);

    // 生产分支走 pip3 install verl
    expect(calls.some((c) => c.cmd === 'pip3' && c.args[0] === 'install' && c.args[1] === 'verl')).toBe(true);

    // manifest 落盘：Python/框架/CUDA 版本 + cuda gpu + pip3
    const m = readManifest('ent-prod');
    expect(m.schemaVersion).toBe('v1');
    expect(m.pythonVersion).toBe('3.11.4');
    expect(m.framework).toEqual({ name: 'verl', version: '0.4.0' });
    expect(m.cudaVersion).toBe('12.4');
    expect(m.gpu?.kind).toBe('cuda');
    expect(m.gpu?.name).toBe('NVIDIA A100-SXM4-80GB');
    expect(m.packageManager).toBe('pip3');
    expect(m.platform).toBe(LINUX);
    expect(m.generatedAt).toBe(new Date(FIXED_NOW()).toISOString());

    // 返回值与落盘一致
    expect(r.manifest).toEqual(m);
  });

  it('test_trainEnvInit_python不可用_步骤fail_ok为false但manifest仍落盘', async () => {
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'nvidia-smi' && args.length === 0) return ok(NVIDIA_SMI_TABLE);
      if (cmd === 'nvidia-smi') return ok(NVIDIA_SMI_QUERY_CSV);
      if (cmd === 'python3') return Promise.reject(new Error('spawn python3 ENOENT'));
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    };

    const r = await trainEnvInit(dataDir, 'ent-nopy', { exec, platform: LINUX, now: FIXED_NOW });

    expect(r.ok).toBe(false);
    const pyStep = r.steps.find((s) => s.name === 'python-detect');
    expect(pyStep?.status).toBe('fail');
    expect(pyStep?.detail).toContain('python3 不可用');

    // 有 CUDA 但 Python 不可用 → 框架安装 skip（指引先装 Python）
    const fwStep = r.steps.find((s) => s.name === 'framework-install');
    expect(fwStep?.status).toBe('skip');
    expect(fwStep?.detail).toContain('Python 不可用');

    // manifest 仍落盘（快照语义——失败也要留现场）
    const m = readManifest('ent-nopy');
    expect(m.pythonVersion).toBeNull();
    expect(m.framework).toBeNull();
    expect(m.gpu?.kind).toBe('cuda'); // GPU 照探照记
  });

  it('test_trainEnvInit_pip3安装失败_步骤fail_不抛错', async () => {
    const exec: ExecFn = async (cmd) => {
      if (cmd === 'nvidia-smi') return ok(NVIDIA_SMI_TABLE + '\n' + NVIDIA_SMI_QUERY_CSV);
      if (cmd === 'python3') return ok('Python 3.11.4');
      if (cmd === 'pip3') return Promise.reject(new Error('network unreachable'));
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    };

    const r = await trainEnvInit(dataDir, 'ent-badnet', { exec, platform: LINUX, now: FIXED_NOW });

    // 安装器语义：如实报告不抛错
    expect(r.ok).toBe(false);
    const fwStep = r.steps.find((s) => s.name === 'framework-install');
    expect(fwStep?.status).toBe('fail');
    expect(fwStep?.detail).toContain('pip3 install verl 失败');
    expect(r.manifest.framework).toBeNull();
  });

  it('test_trainEnvInit_框架装完但验证失败_fail如实报告', async () => {
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'nvidia-smi' && args.length === 0) return ok(NVIDIA_SMI_TABLE);
      if (cmd === 'nvidia-smi') return ok(NVIDIA_SMI_QUERY_CSV);
      if (cmd === 'python3' && args[0] === '--version') return ok('Python 3.11.4');
      if (cmd === 'pip3') return ok('Successfully installed verl-0.4.0');
      if (cmd === 'python3' && args[0] === '-c') return Promise.reject(new Error('ModuleNotFoundError'));
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    };

    const r = await trainEnvInit(dataDir, 'ent-verify-fail', { exec, platform: LINUX, now: FIXED_NOW });

    expect(r.ok).toBe(false);
    const vStep = r.steps.find((s) => s.name === 'framework-verify');
    expect(vStep?.status).toBe('fail');
    expect(vStep?.detail).toContain('版本探测失败');
    expect(r.manifest.framework).toBeNull();
  });
});

// ──────────────────────────────────────
// trainEnvInit · 降级分支（Mac / 无 CUDA）
// ──────────────────────────────────────

describe('env-manager · trainEnvInit 降级分支', () => {
  it('test_trainEnvInit_metal降级分支_指引脚本_包管理器npm', async () => {
    const exec: ExecFn = async (cmd) => {
      if (cmd === 'python3') return ok('Python 3.12.1');
      if (cmd === 'nvidia-smi') return Promise.reject(new Error('spawn nvidia-smi ENOENT'));
      if (cmd === 'system_profiler') return ok(SP_DISPLAYS_METAL);
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    };

    const r = await trainEnvInit(dataDir, 'ent-mac', { exec, platform: DARWIN, now: FIXED_NOW });

    // 降级分支：Python 探测 ok / GPU metal ok / 框架 skip（指引脚本）
    expect(r.ok).toBe(true); // skip 不算 fail
    const gpuStep = r.steps.find((s) => s.name === 'gpu-detect');
    expect(gpuStep?.status).toBe('ok');
    expect(gpuStep?.detail).toContain('降级分支');
    const fwStep = r.steps.find((s) => s.name === 'framework-install');
    expect(fwStep?.status).toBe('skip');
    expect(fwStep?.detail).toContain('tools/train-env-init.sh');

    // manifest：gpu=metal / cudaVersion=null / packageManager=npm
    const m = readManifest('ent-mac');
    expect(m.gpu?.kind).toBe('metal');
    expect(m.gpu?.name).toBe('Apple M3 Max');
    expect(m.gpu?.metalSupport).toBe('Metal 3');
    expect(m.cudaVersion).toBeNull();
    expect(m.packageManager).toBe('npm');
  });

  it('test_trainEnvInit_无GPU无Metal_gpu步骤skip', async () => {
    const exec: ExecFn = async (cmd) => {
      if (cmd === 'python3') return ok('Python 3.11.4');
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`)); // nvidia-smi / system_profiler 均不可用
    };

    const r = await trainEnvInit(dataDir, 'ent-cpu', { exec, platform: LINUX, now: FIXED_NOW });

    expect(r.steps.find((s) => s.name === 'gpu-detect')?.status).toBe('skip');
    const fwStep = r.steps.find((s) => s.name === 'framework-install');
    expect(fwStep?.status).toBe('skip');
    expect(fwStep?.detail).toContain('train-env-init.sh');
    expect(r.manifest.gpu).toBeNull();
    expect(r.manifest.packageManager).toBe('npm');
    expect(r.ok).toBe(true); // CPU-only 也是合法环境（走降级栈）
  });
});

// ──────────────────────────────────────
// trainDoctor · 四项体检
// ──────────────────────────────────────

describe('env-manager · trainDoctor 四项体检', () => {
  /** CUDA 全绿的 exec 路由 */
  const cudaExec: ExecFn = async (cmd, args) => {
    if (cmd === 'nvidia-smi' && args.length === 0) return ok(NVIDIA_SMI_TABLE);
    if (cmd === 'nvidia-smi') return ok(NVIDIA_SMI_QUERY_CSV);
    return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
  };

  /** 预置 manifest（framework ok 前提）+ 模型缓存目录 */
  function primeManifest(enterpriseId: string, framework = { name: 'verl', version: '0.4.0' }): void {
    const p = trainEnvManifestPath(dataDir, enterpriseId);
    mkdirSync(join(p, '..'), { recursive: true });
    const manifest: TrainEnvManifest = {
      schemaVersion: 'v1',
      pythonVersion: '3.11.4',
      framework,
      cudaVersion: '12.4',
      gpu: { kind: 'cuda', name: 'NVIDIA A100-SXM4-80GB', cudaVersion: '12.4', driverVersion: '550.54.15' },
      packageManager: 'pip3',
      platform: LINUX,
      generatedAt: new Date(FIXED_NOW()).toISOString(),
    };
    require('fs').writeFileSync(p, JSON.stringify(manifest));
  }

  function primeModelCache(name: string): void {
    mkdirSync(join(dataDir, 'models', name), { recursive: true });
  }

  it('test_trainDoctor_cuda生产环境_全过_ready', async () => {
    primeManifest('ent-ok');
    primeModelCache('Qwen3-8B');

    const r = await trainDoctor(dataDir, 'ent-ok', { exec: cudaExec, platform: LINUX, now: FIXED_NOW });

    expect(r.ready).toBe(true);
    expect(r.cuda.status).toBe('ok');
    expect(r.cuda.version).toBe('12.4');
    expect(r.vram.status).toBe('ok');
    expect(r.vram.freeMiB).toBe(76012);
    expect(r.framework.status).toBe('ok');
    expect(r.framework.name).toBe('verl');
    expect(r.modelCache.status).toBe('ok');
    expect(r.manifest?.framework?.version).toBe('0.4.0');
    expect(r.checkedAt).toBe(new Date(FIXED_NOW()).toISOString());
  });

  it('test_trainDoctor_无manifest_框架fail_指引init', async () => {
    primeModelCache('Qwen3-8B');

    const r = await trainDoctor(dataDir, 'ent-fresh', { exec: cudaExec, platform: LINUX, now: FIXED_NOW });

    expect(r.ready).toBe(false);
    expect(r.framework.status).toBe('fail');
    expect(r.framework.detail).toContain('train env init');
    expect(r.manifest).toBeNull();
  });

  it('test_trainDoctor_缓存为空_modelCache_fail_指引downloader', async () => {
    primeManifest('ent-nocache');

    const r = await trainDoctor(dataDir, 'ent-nocache', { exec: cudaExec, platform: LINUX, now: FIXED_NOW });

    expect(r.ready).toBe(false);
    expect(r.modelCache.status).toBe('fail');
    expect(r.modelCache.detail).toContain('model-downloader');
    expect(r.modelCache.entries).toHaveLength(DEFAULT_BASE_MODEL_CANDIDATES.length);
  });

  it('test_trainDoctor_显存不足8G_vram_fail', async () => {
    primeManifest('ent-lowvram');
    primeModelCache('Qwen3-8B');
    const lowVramExec: ExecFn = async (cmd, args) => {
      if (cmd === 'nvidia-smi' && args.length === 0) return ok(NVIDIA_SMI_TABLE);
      if (cmd === 'nvidia-smi') return ok('NVIDIA A100-SXM4-80GB, 550.54.15, 4096\n'); // 4 GiB
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    };

    const r = await trainDoctor(dataDir, 'ent-lowvram', { exec: lowVramExec, platform: LINUX, now: FIXED_NOW });

    expect(r.ready).toBe(false);
    expect(r.vram.status).toBe('fail');
    expect(r.vram.freeMiB).toBe(4096);
    expect(r.vram.detail).toContain('8192');
  });

  it('test_trainDoctor_metal降级环境_cudaFail是预期_ready可达', async () => {
    // Mac + metal manifest（trainEnvInit 降级分支产出的清单）→ CUDA fail 是预期
    const manifestFile = trainEnvManifestPath(dataDir, 'ent-macdoc');
    mkdirSync(join(manifestFile, '..'), { recursive: true });
    const manifest: TrainEnvManifest = {
      schemaVersion: 'v1',
      pythonVersion: '3.12.1',
      framework: { name: '@mlx-node/trl', version: '0.1.2' },
      cudaVersion: null,
      gpu: { kind: 'metal', name: 'Apple M3 Max', metalSupport: 'Metal 3' },
      packageManager: 'npm',
      platform: DARWIN,
      generatedAt: new Date(FIXED_NOW()).toISOString(),
    };
    require('fs').writeFileSync(manifestFile, JSON.stringify(manifest));
    primeModelCache('Qwen3-8B');

    const macExec: ExecFn = async (cmd) => {
      if (cmd === 'nvidia-smi') return Promise.reject(new Error('spawn nvidia-smi ENOENT'));
      return Promise.reject(new Error(`spawn ${cmd} ENOENT`));
    };

    const r = await trainDoctor(dataDir, 'ent-macdoc', { exec: macExec, platform: DARWIN, now: FIXED_NOW });

    // CUDA 探测 fail（Mac 无 nvidia-smi）——但 metal manifest 在 → ready
    expect(r.cuda.status).toBe('fail');
    expect(r.vram.status).toBe('skip');
    expect(r.ready).toBe(true);
  });

  it('test_trainDoctor_linux无CUDA_不享受metal特判_ready_false', async () => {
    // Linux 服务器没装好驱动 → cuda fail + 无 metal manifest → 不 ready
    primeManifest('ent-linuxbad');
    primeModelCache('Qwen3-8B');
    const noGpuExec: ExecFn = async () => Promise.reject(new Error('spawn nvidia-smi ENOENT'));

    const r = await trainDoctor(dataDir, 'ent-linuxbad', { exec: noGpuExec, platform: LINUX, now: FIXED_NOW });

    expect(r.cuda.status).toBe('fail');
    expect(r.ready).toBe(false);
  });
});

// ──────────────────────────────────────
// 路径与常量口径
// ──────────────────────────────────────

describe('env-manager · 路径与常量', () => {
  it('test_trainEnvManifestPath_企业分区', () => {
    expect(trainEnvManifestPath('/data', 'ent-x')).toBe(
      join('/data', 'train', 'ent-x', 'train-env.json'),
    );
    expect(TRAIN_ENV_MANIFEST_FILE).toBe('train-env.json');
  });

  it('test_DEFAULT_BASE_MODEL_CANDIDATES_含Qwen3系列', () => {
    expect(DEFAULT_BASE_MODEL_CANDIDATES.length).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_BASE_MODEL_CANDIDATES.some((n) => n.startsWith('Qwen3'))).toBe(true);
  });
});

/** 依赖形态验证（EnvManagerDeps.exec 必填——类型层约定） */
export type _DepsShape = EnvManagerDeps;
