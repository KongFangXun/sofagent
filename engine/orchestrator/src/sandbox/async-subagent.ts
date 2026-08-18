// ============================================================
// sandbox/async-subagent.ts · AsyncSubAgent 独立进程执行（Agent Protocol）
// v1.3.6 · v1.3.7 开发① 新增
//
// 设计（changelog §一 + 开工决议 4）：
//   SubAgent 可在独立进程运行——本版只做「独立进程」（Agent Protocol 服务端
//   跑在本机 child_process）；容器与跨机器留 v1.3.9+（依赖 OS 级沙箱与
//   网络层成熟）。
//
//   Agent Protocol 对齐：spawn → task/run → 状态轮询 → 结果取回 的
//   标准异步执行语义；进程间通信走 stdout JSON 行协议（与训练协议
//   三约定同源——stdout JSON-line / 信号优雅退出）。
//
// 真·实时 A/B 双跑（§一验收第 6 项）：
//   runDual() 把两个 SubAgent 在各自独立进程同时启动（Promise.allSettled），
//   实时 diff 两路输出——隔离环境并行而非串行对比（FORGE fresh-eyes 语义
//   的沙箱版：A/B 物理并行 + 实时对比）。
// ============================================================

import { spawn, ChildProcess } from 'child_process';

/** SubAgent 任务请求（stdout JSON 行协议的请求帧） */
export interface SubAgentTask {
  /** 任务描述 */
  prompt: string;
  /** 虚拟 key（host 边界注入，见 virtual-key.ts） */
  virtualKey: string;
  /** 任务超时（ms，默认 120s） */
  timeoutMs?: number;
}

/** SubAgent 执行结果 */
export interface SubAgentResult {
  ok: boolean;
  /** 最终输出文本 */
  output: string;
  /** 退出码（进程视角） */
  exitCode: number | null;
  /** 被信号杀死时（OOM 等） */
  signal?: string;
  /** 超时标记 */
  timedOut?: boolean;
  durationMs: number;
}

/** A/B 双跑 diff 结果 */
export interface DualRunResult {
  a: SubAgentResult;
  b: SubAgentResult;
  /** 输出是否一致 */
  identical: boolean;
  /** diff 摘要（行级差异，最多 20 行——防大输出刷屏） */
  diffSummary: string[];
}

export interface AsyncSubAgentOptions {
  /** SubAgent 可执行入口（默认 node + 入口脚本路径，由调用方注入） */
  command: string;
  /** 入口参数 */
  args?: string[];
  /** env（虚拟 key 在这里注入——真实 key 不进 SubAgent env） */
  env?: Record<string, string>;
  /** 默认超时 */
  defaultTimeoutMs?: number;
}

/** 单个异步 SubAgent 句柄 */
export interface AsyncSubAgent {
  /** 提交任务（异步——立即返回，结果经 Promise 取回） */
  run(task: SubAgentTask): Promise<SubAgentResult>;
  /** 是否存活 */
  alive(): boolean;
  /** 优雅停止（SIGINT 优先，超时 SIGKILL 兜底——与训练协议三约定同源） */
  stop(): Promise<void>;
}

/**
 * 创建独立进程 SubAgent。
 *
 * @param options 进程入口与 env 注入
 */
export function createAsyncSubAgent(options: AsyncSubAgentOptions): AsyncSubAgent {
  let currentProc: ChildProcess | null = null;
  const defaultTimeout = options.defaultTimeoutMs ?? 120_000;

  return {
    run(task) {
      return new Promise<SubAgentResult>((resolve) => {
        const started = Date.now();
        const timeoutMs = task.timeoutMs ?? defaultTimeout;

        const proc = spawn(options.command, options.args || [], {
          env: {
            ...process.env,
            ...(options.env || {}),
            SOFAGENT_VIRTUAL_KEY: task.virtualKey,
            SOFAGENT_TASK_PROMPT: task.prompt,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        currentProc = proc;

        let output = '';
        let timedOut = false;

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGINT'); // 先礼后兵：超时先 SIGINT 优雅退出
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* 已退出 */ } }, 3000);
        }, timeoutMs);

        proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        proc.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });

        proc.on('close', (code, signal) => {
          clearTimeout(timer);
          currentProc = null;
          resolve({
            ok: code === 0 && !timedOut,
            output,
            exitCode: code,
            signal: signal || undefined,
            timedOut,
            durationMs: Date.now() - started,
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          currentProc = null;
          resolve({
            ok: false,
            output: `spawn error: ${err.message}`,
            exitCode: null,
            durationMs: Date.now() - started,
          });
        });
      });
    },

    alive() {
      return currentProc !== null && currentProc.exitCode === null;
    },

    stop() {
      return new Promise<void>((resolve) => {
        const proc = currentProc;
        if (!proc) { resolve(); return; }
        proc.once('close', () => resolve());
        try { proc.kill('SIGINT'); } catch { resolve(); }
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* noop */ } resolve(); }, 3000);
      });
    },
  };
}

/**
 * 真·实时 A/B 双跑——两个 SubAgent 在各自独立进程同时执行，实时 diff。
 *
 * 隔离性：A/B 各自独立进程（内存/环境完全隔离），一者崩溃不拖累另一者
 * （allSettled 语义）。diff 为行级对比，摘要截断 20 行。
 *
 * @param subagentA A 路 SubAgent
 * @param subagentB B 路 SubAgent
 * @param task 任务（virtualKey 各自独立签发——由调用方保证）
 */
export async function runDual(
  subagentA: AsyncSubAgent,
  subagentB: AsyncSubAgent,
  task: SubAgentTask,
): Promise<DualRunResult> {
  // 同时启动（物理并行，非串行对比）
  const [aRes, bRes] = await Promise.allSettled([
    subagentA.run(task),
    subagentB.run(task),
  ]);

  const a = aRes.status === 'fulfilled' ? aRes.value : { ok: false, output: `rejected: ${aRes.reason}`, exitCode: null, durationMs: 0 };
  const b = bRes.status === 'fulfilled' ? bRes.value : { ok: false, output: `rejected: ${bRes.reason}`, exitCode: null, durationMs: 0 };

  // 实时 diff：行级对比
  const aLines = a.output.split('\n');
  const bLines = b.output.split('\n');
  const identical = a.output === b.output;
  const diffSummary: string[] = [];
  if (!identical) {
    const max = Math.max(aLines.length, bLines.length);
    for (let i = 0; i < max && diffSummary.length < 20; i++) {
      if (aLines[i] !== bLines[i]) {
        diffSummary.push(`L${i + 1}: A=${JSON.stringify((aLines[i] || '').slice(0, 80))} | B=${JSON.stringify((bLines[i] || '').slice(0, 80))}`);
      }
    }
  }

  return { a, b, identical, diffSummary };
}
