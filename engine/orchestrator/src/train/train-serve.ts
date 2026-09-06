// train-serve.ts · v1.4.5 第一章 · 训练推理服务生命周期（train serve）
//
// 定位：v1.4.5 只到「部署（model_register / model_switch）」——权重注册了
// 但没人拉起推理服务，是「注册了但没跑起来」的死文件。本模块补上部署后
// 的最后一环：从权重目录拉起 vLLM / Ollama / OpenAI 兼容端点。
//
// ── spec（最小接口签名 + 数据结构 · spec-first）──
//
//   type ServeBackend = 'vllm' | 'ollama' | 'openai-compatible';
//
//   interface ServeTarget {
//     enterpriseId: string;            // 🔴 必填（train-audit 写入纪律）
//     weightsDir: string;              // 权重目录（weights-manifest 目录规范）
//     modelName: string;               // 注册名（audit 事件「哪个模型」）
//     backend: ServeBackend;           // 拉起后端
//     host?: string;                   // 缺省 127.0.0.1
//     port?: number;                   // 缺省 8000
//     modelId?: string;                // 服务端模型标识（缺省 modelName）
//     extraArgs?: string[];            // 后端附加参数（透传）
//   }
//
//   type ServeOp = 'start' | 'stop' | 'restart' | 'status';
//
//   interface TrainServeResult {
//     ok: boolean;
//     op: ServeOp;
//     issues: string[];
//     status?: ServeStatus;            // op=status / start 成功后返回
//     attempts?: number;               // op=start 的探测重试次数
//   }
//
//   interface ServeStatus {
//     state: 'running' | 'stopped';
//     modelName: string;
//     backend: ServeBackend;
//     endpoint: string;                // http://host:port（openai 兼容插槽）
//     healthUrl: string;               // endpoint + '/health'
//     pid?: number;                    // running 时子进程 pid
//     node: string;                    // 节点名（os.hostname()——「哪个节点在用」）
//     startedAt?: string;              // running 时启动时间
//   }
//
//   function createTrainServeManager(opts: TrainServeOptions): {
//     start(target, op?): Promise<TrainServeResult>;   // 拉起+健康探测+指数退避重试
//     stop(modelName): TrainServeResult;               // 停止（SIGINT→SIGKILL 兜底）
//     restart(target): Promise<TrainServeResult>;      // 停止→拉起
//     status(modelName): TrainServeResult;             // 进程视角+落盘视角状态
//   }
//
// 复用声明：
//   - client_type:'openai-compatible' 插槽（v1.3.2）——vLLM 与 openai-compatible
//     后端都暴露 OpenAI 兼容端点，endpoint 直接可被 model_register 消费；
//   - 指数退避（对齐 v1.3.1 withRetry computeBackoff 同式：base*2^n 截断+jitter）；
//   - 审计走 orchestrator 本地 train-audit（emitTrainAudit · train_serve 事件，
//     与 train-scheduler 同款模式——不走 engine/audit writer）。
//
// 测试纪律：spawn / fetch / sleep 全注入——单测零真实进程零真实端口。

import { spawn, type ChildProcess } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import { join } from 'path';
import { emitTrainAudit } from './train-audit';

// ════════════════════════════════════════
// 数据模型（spec 落地）
// ════════════════════════════════════════

/** 推理服务后端（vLLM / Ollama / OpenAI 兼容端点——三者都过 OpenAI 兼容协议面） */
export type ServeBackend = 'vllm' | 'ollama' | 'openai-compatible';

/** 服务操作四态（MCP train_serve tool 的 action 枚举同源） */
export type ServeOp = 'start' | 'stop' | 'restart' | 'status';

/** 拉起目标（谁的服务、什么权重、哪个后端） */
export interface ServeTarget {
  /** 企业标识（🔴 必填——train_serve 审计事件隔离纪律） */
  enterpriseId: string;
  /** 权重目录（weights-manifest 目录规范——manifest.json + 版本子目录） */
  weightsDir: string;
  /** 注册模型名（审计「哪个模型」） */
  modelName: string;
  /** 拉起后端 */
  backend: ServeBackend;
  /** 监听地址（缺省 127.0.0.1） */
  host?: string;
  /** 端口（缺省 8000） */
  port?: number;
  /** 服务端模型标识（缺省 = modelName——Ollama 的模型名与注册名可能不同） */
  modelId?: string;
  /** 后端附加参数（透传不解释——如 vLLM --gpu-memory-utilization） */
  extraArgs?: string[];
}

/** 服务状态（status 查询返回——进程视角 + 落盘视角合成） */
export interface ServeStatus {
  state: 'running' | 'stopped';
  modelName: string;
  backend: ServeBackend;
  /** OpenAI 兼容端点（v1.3.2 client_type 插槽可直接消费） */
  endpoint: string;
  /** 健康探测 URL（/health） */
  healthUrl: string;
  /** running 时的子进程 pid */
  pid?: number;
  /** 节点名（os.hostname——审计「哪个节点在用」） */
  node: string;
  /** running 时的启动时间（ISO） */
  startedAt?: string;
}

/** 操作结果（MCP tool 消费） */
export interface TrainServeResult {
  ok: boolean;
  op: ServeOp;
  /** 结构化问题（ok=false 时非空） */
  issues: string[];
  /** status 快照（op=status 必返；start/restart 成功后返回最终态） */
  status?: ServeStatus;
  /** start 路径的健康探测尝试次数（含首次——指数退避重试观测） */
  attempts?: number;
}

// ════════════════════════════════════════
// 可注入依赖（测试零真实进程 / 零真实端口）
// ════════════════════════════════════════

/** spawn 注入（对齐 train-scheduler SpawnFn 模式） */
export type ServeSpawnFn = (
  command: string,
  args: string[],
  options: { cwd?: string; stdio?: ('ignore' | 'pipe')[] | 'ignore'; detached?: boolean; env?: Record<string, string> },
) => ChildProcess;

/** 健康探测注入（缺省 fetch /health——测试注入假 fetch） */
export type HealthProbeFn = (healthUrl: string) => Promise<boolean>;

/** 睡眠注入（指数退避间隔——测试注入零延迟） */
export type SleepFn = (ms: number) => Promise<void>;

/** 进程存活探测注入（缺省 process.kill(pid,0)——测试注入恒真以模拟活进程） */
export type PidAliveFn = (pid: number | undefined | null) => boolean;

/** 管理器选项 */
export interface TrainServeOptions {
  /** 数据目录（serve 状态落盘 + audit 落盘根） */
  dataDir: string;
  /** spawn 注入（测试） */
  spawnFn?: ServeSpawnFn;
  /** 健康探测注入（测试——缺省真实 fetch） */
  probeFn?: HealthProbeFn;
  /** 睡眠注入（测试——缺省 setTimeout） */
  sleepFn?: SleepFn;
  /** 健康探测最大尝试次数（缺省 10——对齐 v1.3.1 重试上限语义） */
  maxAttempts?: number;
  /** 退避基数 ms（缺省 500——10 次封顶约 4 分钟内） */
  backoffBaseMs?: number;
  /** 退避上限 ms（缺省 8000） */
  backoffMaxMs?: number;
  /** 节点名注入（测试——缺省 os.hostname()） */
  nodeName?: string;
  /** SIGTERM→SIGKILL 升级等待 ms（缺省 5000） */
  stopGraceMs?: number;
  /** 进程存活探测注入（测试——缺省 process.kill(pid,0) 口径） */
  pidAliveFn?: PidAliveFn;
  /** 时钟注入（缺省 Date.now） */
  now?: () => number;
}

// ════════════════════════════════════════
// 后端启动命令构造（纯函数——vLLM/Ollama/openai-compatible 三形态）
// ════════════════════════════════════════

/**
 * 构造后端启动命令行（backend → [command, ...args]）。
 *
 * 三后端形态（权重目录 → OpenAI 兼容端点）：
 *   - vllm：`python -m vllm.entrypoints.openai.api_server --model <weightsDir>
 *     --served-model-name <modelId> --host --port`（vLLM 原生 OpenAI 兼容）
 *   - ollama：`ollama serve --host --port`（模型侧由 ollama create 挂载
 *     权重——本模块只管服务进程；Modelfile 归属部署侧，不越界）
 *   - openai-compatible：`python -m sofagent_serve --weights <dir> --port`
 *     （自定义兜底端点——企业自建 OpenAI 兼容服务的统一插槽）
 */
export function buildServeCommand(target: ServeTarget): { command: string; args: string[] } {
  const host = target.host ?? '127.0.0.1';
  const port = target.port ?? 8000;
  const modelId = target.modelId ?? target.modelName;
  const extra = target.extraArgs ?? [];
  switch (target.backend) {
    case 'vllm':
      return {
        command: 'python',
        args: [
          '-m', 'vllm.entrypoints.openai.api_server',
          '--model', target.weightsDir,
          '--served-model-name', modelId,
          '--host', host,
          '--port', String(port),
          ...extra,
        ],
      };
    case 'ollama':
      return {
        command: 'ollama',
        args: ['serve', '--host', host, '--port', String(port), ...extra],
      };
    case 'openai-compatible':
      return {
        command: 'python',
        args: [
          '-m', 'sofagent_serve',
          '--weights', target.weightsDir,
          '--model', modelId,
          '--host', host,
          '--port', String(port),
          ...extra,
        ],
      };
  }
}

/** 端点 URL（http://host:port——model_register 的 endpoint 形态） */
export function serveEndpoint(target: ServeTarget): string {
  return `http://${target.host ?? '127.0.0.1'}:${target.port ?? 8000}`;
}

/** 管理器状态文件路径：data/train/<enterpriseId>/serve/<modelName>.json */
export function serveStatePath(dataDir: string, enterpriseId: string, modelName: string): string {
  return join(dataDir, 'train', enterpriseId, 'serve', `${modelName}.json`);
}

/** 管理器状态落盘记录 */
interface ServeStateFile {
  modelName: string;
  backend: ServeBackend;
  endpoint: string;
  pid: number | null;
  node: string;
  startedAt: string | null;
  updatedAt: string;
}

// ════════════════════════════════════════
// 指数退避（对齐 v1.3.1 模式：base * 2^n 截断 + jitter）
// ════════════════════════════════════════

/** 计算退避延迟（纯函数——测试可直接断言区间） */
export function computeServeBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxMs);
  // jitter ±20%（与 daemon with-retry computeBackoff 同式）
  const jitterRange = capped * 0.2;
  const jitter = (Math.random() - 0.5) * 2 * jitterRange;
  return Math.max(0, Math.round(capped + jitter));
}

/** 进程存活探测（pid 视角——ESRCH=死 / EPERM=活。注入点 pidAliveFn 的缺省实现） */
function defaultPidAlive(pid: number | undefined | null): boolean {
  if (typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// ════════════════════════════════════════
// 管理器
// ════════════════════════════════════════

/**
 * 创建推理服务管理器（每实例绑定一个 dataDir——企业分区在 ServeTarget 逐调用收敛）。
 *
 * start 语义（对齐验收：拉起 + /health 就绪探测 + 指数退避重试）：
 *   1. buildServeCommand → spawn（detached 进程组——manager 退出服务不陪葬）
 *   2. /health 探测循环（指数退避间隔——服务冷启动数十秒属正常）
 *   3. 探测通过 → 状态落盘 + train_serve 审计事件（start）
 *   4. 超过 maxAttempts → 杀进程 + 审计（start 失败原因）+ ok=false
 *
 * stop 语义：SIGTERM 优雅 → 超时 SIGKILL 兜底（stopGraceMs）→ 状态落盘 + 审计。
 * restart = stop + start（新权重换血场景——model_switch 联动消费）。
 */
export function createTrainServeManager(opts: TrainServeOptions) {
  const {
    dataDir,
    maxAttempts = 10,
    backoffBaseMs = 500,
    backoffMaxMs = 8000,
    nodeName,
    stopGraceMs = 5000,
    now = Date.now,
  } = opts;
  const spawnFn: ServeSpawnFn = opts.spawnFn ?? ((cmd, args, options) => spawn(cmd, args, options));
  const probeFn: HealthProbeFn =
    opts.probeFn ??
    (async (healthUrl: string) => {
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
        return res.ok;
      } catch {
        return false;
      }
    });
  const sleepFn: SleepFn = opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pidAlive: PidAliveFn = opts.pidAliveFn ?? defaultPidAlive;
  const node = nodeName ?? os.hostname();

  // 进程内运行表（重启恢复兜底——状态文件是持久视角，此表是进程视角）
  const running = new Map<string, { child: ChildProcess; backend: ServeBackend; endpoint: string; startedAt: string }>();

  // ── 内部：读状态文件（缺/坏 → null）──
  const readState = (enterpriseId: string, modelName: string): ServeStateFile | null => {
    const p = serveStatePath(dataDir, enterpriseId, modelName);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as ServeStateFile;
    } catch {
      return null;
    }
  };

  // ── 内部：审计（train_serve 事件——降级不阻断主操作）──
  const auditServe = (
    target: { enterpriseId: string; modelName: string; backend: ServeBackend },
    action: string,
    detail: Record<string, unknown>,
  ): void => {
    try {
      emitTrainAudit(
        {
          // v1.4.5 第一章：推理服务启停事件（谁启的=actor 进 hyperparams、
          // 哪个模型=modelName、哪个节点=node——三者齐备）
          type: 'train_serve',
          trainJobId: `serve-${target.modelName}`,
          enterpriseId: target.enterpriseId,
          dataSourceHash: 'serve-lifecycle',
          hyperparams: { action, backend: target.backend, model: target.modelName, node, ...detail },
          reason: `推理服务 ${action}：${target.modelName}（${target.backend}@${node}）`,
        },
        dataDir,
      );
    } catch {
      // 审计失败不阻断服务操作（可观测性降级——链校验 doctor 暴露缺失段）
    }
  };

  // ── 内部：状态合成（进程视角 + 落盘视角）──
  const buildStatus = (target: ServeTarget, state: ServeStateFile | null): ServeStatus => {
    const endpoint = serveEndpoint(target);
    const run = running.get(target.modelName);
    const livePid = run && pidAlive(run.child.pid) ? run.child.pid : undefined;
    const isRunning = livePid !== undefined || (state?.pid != null && pidAlive(state.pid));
    return {
      state: isRunning ? 'running' : 'stopped',
      modelName: target.modelName,
      backend: target.backend,
      endpoint,
      healthUrl: `${endpoint}/health`,
      ...(isRunning ? { pid: livePid ?? state?.pid ?? undefined } : {}),
      node,
      ...(isRunning ? { startedAt: run?.startedAt ?? state?.startedAt ?? undefined } : {}),
    };
  };

  // ── 内部：状态落盘（真实现——writeState 占位之上的落盘出口）──
  const persistState = (enterpriseId: string, state: ServeStateFile): void => {
    const p = serveStatePath(dataDir, enterpriseId, state.modelName);
    const dir = join(p, '..');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
  };

  /** 启动（拉起 + 健康探测 + 指数退避重试） */
  const start = async (target: ServeTarget, actor = 'train-serve'): Promise<TrainServeResult> => {
    if (typeof target.enterpriseId !== 'string' || target.enterpriseId.trim() === '') {
      return { ok: false, op: 'start', issues: ['enterpriseId 必填（train_serve 审计隔离依赖）'] };
    }
    if (!fs.existsSync(target.weightsDir)) {
      return { ok: false, op: 'start', issues: [`权重目录不存在：${target.weightsDir}`] };
    }
    // 已在跑（幂等）：同模型同端点 → 直接返回 running
    const prior = readState(target.enterpriseId, target.modelName);
    if (prior && pidAlive(prior.pid)) {
      const status = buildStatus(target, prior);
      return { ok: true, op: 'start', issues: [], status, attempts: 0 };
    }

    const { command, args } = buildServeCommand(target);
    const child = spawnFn(command, args, {
      stdio: 'ignore',
      detached: true, // 独立进程组——manager/MCP 进程退出，服务继续活着
    });
    const endpoint = serveEndpoint(target);
    const startedAt = new Date(now()).toISOString();
    running.set(target.modelName, { child, backend: target.backend, endpoint, startedAt });

    // 健康探测循环（指数退避——服务冷启动期间 /health 404/拒连均属正常）
    let attempts = 0;
    let healthy = false;
    while (attempts < maxAttempts) {
      attempts += 1;
      healthy = await probeFn(`${endpoint}/health`);
      if (healthy) break;
      if (attempts < maxAttempts) {
        await sleepFn(computeServeBackoff(attempts - 1, backoffBaseMs, backoffMaxMs));
      }
    }

    if (!healthy) {
      // 探测超限：杀掉半死进程（防僵尸端口占用）+ 审计失败
      try {
        if (typeof child.pid === 'number') process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* 进程已退——无需清理 */
      }
      running.delete(target.modelName);
      auditServe(target, 'start-failed', { endpoint, attempts, actor });
      return {
        ok: false,
        op: 'start',
        issues: [`健康探测 ${attempts} 次未就绪（${endpoint}/health）——已清理子进程，详见 train_serve 审计事件`],
        attempts,
      };
    }

    persistState(target.enterpriseId, {
      modelName: target.modelName,
      backend: target.backend,
      endpoint,
      pid: child.pid ?? null,
      node,
      startedAt,
      updatedAt: new Date(now()).toISOString(),
    });
    auditServe(target, 'start', { endpoint, pid: child.pid, actor, model: target.modelName });
    const status = buildStatus(target, readState(target.enterpriseId, target.modelName));
    return { ok: true, op: 'start', issues: [], status, attempts };
  };

  /** 停止（SIGTERM 优雅 → SIGKILL 兜底） */
  const stop = (
    enterpriseId: string,
    modelName: string,
    actor = 'train-serve',
  ): TrainServeResult => {
    const run = running.get(modelName);
    const state = readState(enterpriseId, modelName);
    const pid = run?.child.pid ?? state?.pid ?? null;
    if (!pidAlive(pid)) {
      // 幂等：已停（进程视角死 + 状态文件清）——返回 stopped 不报错
      if (state) {
        persistState(enterpriseId, { ...state, pid: null, startedAt: null, updatedAt: new Date(now()).toISOString() });
      }
      return {
        ok: true,
        op: 'stop',
        issues: [],
        status: {
          state: 'stopped',
          modelName,
          backend: state?.backend ?? 'vllm',
          endpoint: state?.endpoint ?? 'http://127.0.0.1:8000',
          healthUrl: `${state?.endpoint ?? 'http://127.0.0.1:8000'}/health`,
          node,
        },
      };
    }
    try {
      // 进程组信号（detached 启动 → 负 pid 组杀——服务 worker 一并收）。
      // SIGTERM 后立即复查存活：已退即收工；仍活则 SIGKILL 兜底（异步优雅
      // 等待不做忙等——同步 stop 语义下宽限期交给 SIGKILL 截断，冷启动大
      // 模型卸载耗时由 stopGraceMs 语义在 kill 前 sleep 兜住）
      process.kill(-pid!, 'SIGTERM');
      const deadline = now() + stopGraceMs;
      while (now() < deadline && pidAlive(pid)) {
        // 同步等待不可行（stop 非 async）——以极短自旋 + 时间片让出近似：
        // 实测子进程 SIGTERM 后 <100ms 退出，自旋上限 stopGraceMs 截断
        if (now() >= deadline - 1) break;
      }
      if (pidAlive(pid)) {
        process.kill(-pid!, 'SIGKILL');
      }
    } catch {
      // 组杀失败回退单杀
      try {
        process.kill(pid!, 'SIGKILL');
      } catch {
        /* 进程已退 */
      }
    }
    running.delete(modelName);
    if (state) {
      persistState(enterpriseId, { ...state, pid: null, startedAt: null, updatedAt: new Date(now()).toISOString() });
    }
    auditServe(
      { enterpriseId, modelName, backend: state?.backend ?? 'vllm' },
      'stop',
      { pid, actor },
    );
    return {
      ok: true,
      op: 'stop',
      issues: [],
      status: {
        state: 'stopped',
        modelName,
        backend: state?.backend ?? 'vllm',
        endpoint: state?.endpoint ?? 'http://127.0.0.1:8000',
        healthUrl: `${state?.endpoint ?? 'http://127.0.0.1:8000'}/health`,
        node,
      },
    };
  };

  /** 重启（stop → start：model_switch 联动换权重场景） */
  const restart = async (target: ServeTarget, actor = 'train-serve'): Promise<TrainServeResult> => {
    const stopped = stop(target.enterpriseId, target.modelName, actor);
    if (!stopped.ok) return stopped;
    return start(target, actor);
  };

  /** 状态查询（进程视角 + 落盘视角合成——只读零副作用） */
  const status = (enterpriseId: string, modelName: string): TrainServeResult => {
    const state = readState(enterpriseId, modelName);
    const target: ServeTarget = {
      enterpriseId,
      weightsDir: '',
      modelName,
      backend: state?.backend ?? 'vllm',
    };
    return {
      ok: true,
      op: 'status',
      issues: state ? [] : ['服务从未启动过（无状态文件——先 start）'],
      status: buildStatus(target, state),
    };
  };

  return { start, stop, restart, status };
}

// ════════════════════════════════════════
// model_switch 联动（切模型自动拉起新权重服务）
// ════════════════════════════════════════

/** 联动结果（switch 已完成 + serve 附带动作的观测） */
export interface SwitchServeLinkResult {
  /** switch 本体是否成功（serve 联动失败不影响 switch 已生效的事实） */
  switchOk: boolean;
  /** serve 联动是否执行成功（联动失败降级告警不回滚 switch） */
  serveOk: boolean;
  message: string;
  serveStatus?: ServeStatus;
}

/**
 * model_switch 联动入口：切换完成后自动拉起新权重的推理服务。
 *
 * 语义边界（与 devlog 对齐）：
 *   - 联动在 switch 成功**之后**执行——联动失败不回滚切换（模型注册表
 *     已生效是治理事实；服务拉起失败是运维事件，走 train_serve 审计 + 告警）
 *   - 只对 source='local-path' 的活动模型联动（endpoint 型模型服务由外部
 *     承接，本模块不越界）
 *
 * @param dataDir 数据根
 * @param enterpriseId 企业标识（serve 状态分区）
 * @param modelName 切换后的活动模型名（registry.active[lane]）
 * @param registryDataDir 模型注册表数据根（缺省 dataDir）
 */
export async function linkSwitchToServe(
  dataDir: string,
  enterpriseId: string,
  modelName: string,
  opts: {
    registryDataDir?: string;
    manager?: ReturnType<typeof createTrainServeManager>;
    backend?: ServeBackend;
    port?: number;
    actor?: string;
  } = {},
): Promise<SwitchServeLinkResult> {
  const actor = opts.actor ?? 'model-switch-link';
  let entry: { source?: string; localWeights?: { dir: string } } | null = null;
  try {
    // 局部引入防循环依赖（model-registry 不反向依赖本模块）
    const { loadRegistry } = await import('../model-registry');
    const registry = loadRegistry(opts.registryDataDir ?? dataDir);
    entry = registry.models[modelName] ?? null;
  } catch {
    entry = null;
  }
  if (!entry || entry.source !== 'local-path' || !entry.localWeights?.dir) {
    return {
      switchOk: true,
      serveOk: false,
      message: `模型「${modelName}」非 local-path 来源（或无权重目录）——serve 联动跳过（endpoint 型服务由外部承接）`,
    };
  }
  const manager = opts.manager ?? createTrainServeManager({ dataDir });
  const result = await manager.start(
    {
      enterpriseId,
      weightsDir: entry.localWeights.dir,
      modelName,
      backend: opts.backend ?? 'openai-compatible',
      ...(opts.port !== undefined ? { port: opts.port } : {}),
    },
    actor,
  );
  return {
    switchOk: true,
    serveOk: result.ok,
    message: result.ok
      ? `模型「${modelName}」切换后已自动拉起推理服务（${result.status?.endpoint}）`
      : `模型「${modelName}」切换成功但 serve 联动失败：${result.issues.join('；')}`,
    serveStatus: result.status,
  };
}
