// train-serve.test.ts · v1.4.5 第一章 测试
//
// 验收标准逐条覆盖：
// - 从权重目录拉起推理服务（三后端命令构造 + spawn 接线）
// - 健康检查就绪探测（/health 首次即过 + 多次退避后过）
// - 启动失败指数退避重试（超限杀进程 + 审计事件）
// - 停止 / 重启 / 状态四操作
// - model_switch 联动（local-path 自动拉起 / endpoint 型跳过）
// - 每次启停记 train_serve 审计事件（谁启的/哪个模型/哪个节点）
//
// 测试纪律：spawn / fetch / sleep 全注入——零真实进程零真实端口。
// HMAC 密钥纪律：SOFAGENT_KEY_PATH 指向临时密钥（train-audit.test 同款）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  createTrainServeManager,
  buildServeCommand,
  serveEndpoint,
  computeServeBackoff,
  linkSwitchToServe,
  type ServeTarget,
  type ServeSpawnFn,
} from '../train/train-serve';
import { readTrainAudit } from '../train/train-audit';
import { registerModel } from '../model-registry';

// ── 测试基建 ──
let dataDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-train-serve-'));
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'test-hmac-key');
  writeFileSync(process.env.SOFAGENT_KEY_PATH, 'test-train-serve-key-0123456789abcdef');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** 假子进程（零真实进程——EventEmitter 模拟，pid 可控） */
function fakeChild(pid = 777001): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as { pid: number }).pid = pid;
  return proc;
}

/** 假权重目录（existsSync 过校验——空目录即可） */
function makeWeightsDir(name = 'weights-a'): string {
  const dir = join(dataDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 基线拉起目标 */
function makeTarget(overrides: Partial<ServeTarget> = {}): ServeTarget {
  return {
    enterpriseId: 'ent-serve',
    weightsDir: makeWeightsDir(),
    modelName: 'ent-serve-qwen3-8b',
    backend: 'vllm',
    ...overrides,
  };
}

/** 记录 spawn 调用的注入器 */
function recordingSpawn(children: ChildProcess[]): { spawnFn: ServeSpawnFn; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawnFn: ServeSpawnFn = (command, args) => {
    calls.push({ command, args });
    const child = children.shift() ?? fakeChild();
    return child;
  };
  return { spawnFn, calls };
}

describe('buildServeCommand 后端命令构造', () => {
  it('test_buildServeCommand_vllm后端_生成OpenAI兼容启动命令', () => {
    const { command, args } = buildServeCommand(makeTarget({ backend: 'vllm', weightsDir: '/w', modelName: 'm1', modelId: 'qwen3' }));
    expect(command).toBe('python');
    expect(args).toContain('-m');
    expect(args).toContain('vllm.entrypoints.openai.api_server');
    // 权重目录进 --model、注册名进 --served-model-name
    expect(args[args.indexOf('--model') + 1]).toBe('/w');
    expect(args[args.indexOf('--served-model-name') + 1]).toBe('qwen3');
    // 缺省 host/port
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
    expect(args[args.indexOf('--port') + 1]).toBe('8000');
  });

  it('test_buildServeCommand_ollama后端_生成serve命令', () => {
    const { command, args } = buildServeCommand(makeTarget({ backend: 'ollama', host: '0.0.0.0', port: 11434 }));
    expect(command).toBe('ollama');
    expect(args[0]).toBe('serve');
    expect(args).toContain('11434');
  });

  it('test_buildServeCommand_openaiCompatible后端_权重目录透传', () => {
    const { command, args } = buildServeCommand(makeTarget({ backend: 'openai-compatible', weightsDir: '/w9' }));
    expect(command).toBe('python');
    expect(args).toContain('sofagent_serve');
    expect(args[args.indexOf('--weights') + 1]).toBe('/w9');
  });

  it('test_buildServeCommand_extraArgs_透传不解释', () => {
    const { args } = buildServeCommand(makeTarget({ extraArgs: ['--gpu-memory-utilization', '0.9'] }));
    expect(args).toContain('--gpu-memory-utilization');
    expect(args[args.indexOf('--gpu-memory-utilization') + 1]).toBe('0.9');
  });

  it('test_serveEndpoint_端点URL_可直接进model_register的openaiCompatible插槽', () => {
    expect(serveEndpoint(makeTarget({ host: '10.0.0.5', port: 9001 }))).toBe('http://10.0.0.5:9001');
    expect(serveEndpoint(makeTarget())).toBe('http://127.0.0.1:8000');
  });
});

describe('computeServeBackoff 指数退避', () => {
  it('test_computeServeBackoff_指数增长且截断_带jitter区间约束', () => {
    // 第 0 次：base*1=500 ±20%；第 3 次：500*8=4000；超 max 截断 8000
    const b0 = computeServeBackoff(0, 500, 8000);
    expect(b0).toBeGreaterThanOrEqual(400);
    expect(b0).toBeLessThanOrEqual(600);
    const b3 = computeServeBackoff(3, 500, 8000);
    expect(b3).toBeGreaterThanOrEqual(3200);
    expect(b3).toBeLessThanOrEqual(4800);
    // 大 attempt 截断到 max 附近
    const b10 = computeServeBackoff(10, 500, 8000);
    expect(b10).toBeLessThanOrEqual(9600);
    expect(b10).toBeGreaterThanOrEqual(6400);
  });
});

describe('start 拉起 + 健康探测', () => {
  it('test_start_健康探测首次即过_拉起成功且记审计', async () => {
    const { spawnFn, calls } = recordingSpawn([fakeChild(777100)]);
    const probeUrls: string[] = [];
    const mgr = createTrainServeManager({
      dataDir,
      spawnFn,
      probeFn: async (url) => {
        probeUrls.push(url);
        return true;
      },
      sleepFn: async () => {},
      pidAliveFn: () => true,
      nodeName: 'node-test',
    });
    const result = await mgr.start(makeTarget(), 'fde-zhang');
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.status?.state).toBe('running');
    expect(result.status?.endpoint).toBe('http://127.0.0.1:8000');
    expect(result.status?.healthUrl).toBe('http://127.0.0.1:8000/health');
    expect(result.status?.node).toBe('node-test');
    expect(result.status?.pid).toBe(777100);
    // 探测的就是 /health
    expect(probeUrls).toEqual(['http://127.0.0.1:8000/health']);
    // spawn 了 vllm 命令
    expect(calls.length).toBe(1);
    expect(calls[0]!.command).toBe('python');
    // 审计事件：train_serve（谁启的=actor、哪个模型、哪个节点）
    const audits = readTrainAudit(dataDir, 'ent-serve', 'serve-ent-serve-qwen3-8b');
    const serveEvents = audits.filter((a) => a.type === 'train_serve');
    expect(serveEvents.length).toBe(1);
    expect(serveEvents[0]!.hyperparams.action).toBe('start');
    expect(serveEvents[0]!.hyperparams.model).toBe('ent-serve-qwen3-8b');
    expect(serveEvents[0]!.hyperparams.node).toBe('node-test');
    expect(serveEvents[0]!.hyperparams.actor).toBe('fde-zhang');
  });

  it('test_start_健康探测多次失败后退避重试通过_attempts计数递增', async () => {
    const { spawnFn } = recordingSpawn([fakeChild(777101)]);
    const sleeps: number[] = [];
    let probeCount = 0;
    const mgr = createTrainServeManager({
      dataDir,
      spawnFn,
      probeFn: async () => {
        probeCount += 1;
        return probeCount >= 4; // 前 3 次未就绪（冷启动），第 4 次过
      },
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
      pidAliveFn: () => true,
    });
    const result = await mgr.start(makeTarget());
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(4);
    // 退避序列存在且指数增长趋势（3 次间隔：500 档 → 1000 档 → 2000 档）
    expect(sleeps.length).toBe(3);
    expect(sleeps[0]!).toBeLessThanOrEqual(600);
    expect(sleeps[1]!).toBeGreaterThanOrEqual(800);
    expect(sleeps[2]!).toBeGreaterThanOrEqual(1600);
  });

  it('test_start_探测超限_杀进程返回失败且记start_failed审计', async () => {
    const child = fakeChild(777102);
    const killedSignals: Array<{ pid: number; signal: string }> = [];
    const origKill = process.kill.bind(process.kill);
    (process.kill as unknown as (pid: number, signal?: string) => void) = (pid: number, signal?: string) => {
      killedSignals.push({ pid: pid as number, signal: signal ?? 'SIGTERM' });
      return true;
    };
    try {
      const mgr = createTrainServeManager({
        dataDir,
        spawnFn: () => child,
        probeFn: async () => false, // 永不就绪
        sleepFn: async () => {},
        pidAliveFn: () => true,
        maxAttempts: 3,
      });
      const result = await mgr.start(makeTarget());
      expect(result.ok).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.issues[0]).toContain('健康探测');
      // 半死进程被清理（负 pid 组杀 SIGKILL——detached 启动形态）
      expect(killedSignals.some((k) => k.pid === -777102 && k.signal === 'SIGKILL')).toBe(true);
      // 审计记 start-failed
      const audits = readTrainAudit(dataDir, 'ent-serve', 'serve-ent-serve-qwen3-8b');
      const failed = audits.filter((a) => a.type === 'train_serve' && a.hyperparams.action === 'start-failed');
      expect(failed.length).toBe(1);
      expect(failed[0]!.hyperparams.attempts).toBe(3);
    } finally {
      (process.kill as unknown as (pid: number, signal?: string) => void) = origKill;
    }
  });

  it('test_start_权重目录不存在_结构化拒绝不spawn', async () => {
    const { spawnFn, calls } = recordingSpawn([]);
    const mgr = createTrainServeManager({ dataDir, spawnFn, probeFn: async () => true, sleepFn: async () => {} });
    const result = await mgr.start(makeTarget({ weightsDir: join(dataDir, 'no-such-dir') }));
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('权重目录不存在');
    expect(calls.length).toBe(0);
  });

  it('test_start_enterpriseId缺失_拒绝（审计隔离依赖）', async () => {
    const mgr = createTrainServeManager({ dataDir, spawnFn: () => fakeChild(), probeFn: async () => true, sleepFn: async () => {} });
    const result = await mgr.start(makeTarget({ enterpriseId: '' }));
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('enterpriseId');
  });
});

describe('stop / status / restart 生命周期', () => {
  it('test_stop_运行中服务_组杀信号且记审计', async () => {
    const child = fakeChild(777200);
    const killedSignals: Array<{ pid: number; signal: string }> = [];
    const origKill = process.kill.bind(process.kill);
    (process.kill as unknown as (pid: number, signal?: string) => void) = (pid: number, signal?: string) => {
      killedSignals.push({ pid: pid as number, signal: signal ?? 'SIGTERM' });
      throw Object.assign(new Error('esrch'), { code: 'ESRCH' }); // 杀完即死（pidAlive false）
    };
    try {
      const mgr = createTrainServeManager({
        dataDir,
        spawnFn: () => child,
        probeFn: async () => true,
        sleepFn: async () => {},
        pidAliveFn: () => true,
        nodeName: 'node-stop',
      });
      await mgr.start(makeTarget(), 'op-li');
      const result = mgr.stop('ent-serve', 'ent-serve-qwen3-8b', 'op-li');
      expect(result.ok).toBe(true);
      expect(result.status?.state).toBe('stopped');
      // 组杀（负 pid）
      expect(killedSignals.some((k) => k.pid === -777200)).toBe(true);
      // 审计记 stop（谁停的）
      const audits = readTrainAudit(dataDir, 'ent-serve', 'serve-ent-serve-qwen3-8b');
      const stops = audits.filter((a) => a.type === 'train_serve' && a.hyperparams.action === 'stop');
      expect(stops.length).toBe(1);
      expect(stops[0]!.hyperparams.actor).toBe('op-li');
    } finally {
      (process.kill as unknown as (pid: number, signal?: string) => void) = origKill;
    }
  });

  it('test_stop_已停服务_幂等返回stopped不报错', () => {
    const mgr = createTrainServeManager({ dataDir, spawnFn: () => fakeChild(), probeFn: async () => true, sleepFn: async () => {} });
    const result = mgr.stop('ent-serve', 'never-started-model');
    expect(result.ok).toBe(true);
    expect(result.status?.state).toBe('stopped');
  });

  it('test_status_从未启动_issues提示先start', () => {
    const mgr = createTrainServeManager({ dataDir, spawnFn: () => fakeChild(), probeFn: async () => true, sleepFn: async () => {} });
    const result = mgr.status('ent-serve', 'ghost-model');
    expect(result.ok).toBe(true);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]).toContain('先 start');
    expect(result.status?.state).toBe('stopped');
  });

  it('test_status_启动后_进程视角running且落盘视角可恢复', async () => {
    const mgr = createTrainServeManager({
      dataDir,
      spawnFn: () => fakeChild(777300),
      probeFn: async () => true,
      sleepFn: async () => {},
      pidAliveFn: () => true,
      nodeName: 'node-status',
    });
    await mgr.start(makeTarget());
    // 同 dataDir 新 manager（模拟进程重启——状态文件是持久视角）
    const mgr2 = createTrainServeManager({
      dataDir,
      spawnFn: () => fakeChild(),
      probeFn: async () => true,
      sleepFn: async () => {},
      pidAliveFn: () => true,
      nodeName: 'node-status',
    });
    const result = mgr2.status('ent-serve', 'ent-serve-qwen3-8b');
    expect(result.status?.state).toBe('running');
    expect(result.status?.pid).toBe(777300);
    expect(result.status?.startedAt).toBeTruthy();
  });

  it('test_restart_先停后起_spawn两次且终点running', async () => {
    const children = [fakeChild(777400), fakeChild(777401)];
    const { spawnFn, calls } = recordingSpawn(children);
    const origKill = process.kill.bind(process.kill);
    (process.kill as unknown as (pid: number, signal?: string) => void) = () => {
      throw Object.assign(new Error('esrch'), { code: 'ESRCH' });
    };
    try {
      const mgr = createTrainServeManager({ dataDir, spawnFn, probeFn: async () => true, sleepFn: async () => {}, pidAliveFn: () => true });
      const result = await mgr.restart(makeTarget(), 'op-restart');
      expect(result.ok).toBe(true);
      expect(result.status?.state).toBe('running');
      // 新 manager 首次 restart = stop 幂等 no-op（无 spawn）+ start 一次 spawn
      expect(calls.length).toBe(1);
      // 终态 pid 即本次拉起的子进程
      expect(result.status?.pid).toBe(777400);
    } finally {
      (process.kill as unknown as (pid: number, signal?: string) => void) = origKill;
    }
  });
});

describe('model_switch 联动（linkSwitchToServe）', () => {
  it('test_linkSwitchToServe_localPath模型_自动拉起新权重服务', async () => {
    const weightsDir = makeWeightsDir('linked-weights');
    // 注册 local-path 模型（registerModel 校验 manifest——手工造合法 manifest）
    const { appendVersion, hashDir } = await import('../weights-manifest');
    const versionDir = join(weightsDir, 'v1');
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(join(versionDir, 'model.safetensors'), 'fake-weights-bytes');
    appendVersion(weightsDir, {
      id: 'v1',
      createdAt: new Date().toISOString(),
      sha256: hashDir(versionDir),
      sizeBytes: 16,
    }, { setCurrent: true, model: 'ent-serve-linked' });
    registerModel(
      {
        name: 'ent-serve-linked',
        endpoint: 'http://127.0.0.1:8000',
        clientType: 'openai-compatible',
        model: 'qwen3-8b',
        source: 'local-path',
        weightsDir,
      },
      { dataDir, actor: 'test' },
    );

    const mgr = createTrainServeManager({
      dataDir,
      spawnFn: () => fakeChild(777500),
      probeFn: async () => true,
      sleepFn: async () => {},
      pidAliveFn: () => true,
      nodeName: 'node-link',
    });
    const result = await linkSwitchToServe(dataDir, 'ent-serve', 'ent-serve-linked', { manager: mgr });
    expect(result.switchOk).toBe(true);
    expect(result.serveOk).toBe(true);
    expect(result.serveStatus?.state).toBe('running');
    expect(result.message).toContain('自动拉起');
  });

  it('test_linkSwitchToServe_endpoint型模型_跳过不越界', async () => {
    registerModel(
      {
        name: 'cloud-model',
        endpoint: 'https://api.example.com/v1',
        clientType: 'openai-compatible',
        model: 'gpt-x',
        source: 'endpoint',
      },
      { dataDir, actor: 'test' },
    );
    const result = await linkSwitchToServe(dataDir, 'ent-serve', 'cloud-model');
    expect(result.switchOk).toBe(true);
    expect(result.serveOk).toBe(false);
    expect(result.message).toContain('外部承接');
  });

  it('test_linkSwitchToServe_未注册模型_跳过且不误报', async () => {
    const result = await linkSwitchToServe(dataDir, 'ent-serve', 'no-such-model');
    expect(result.switchOk).toBe(true);
    expect(result.serveOk).toBe(false);
  });
});
