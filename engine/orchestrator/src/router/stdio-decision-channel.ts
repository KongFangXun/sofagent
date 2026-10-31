// ============================================================
// stdio-decision-channel.ts · 判定通道的**本地子进程实现**（v1.8.0 §一 S2）
// ------------------------------------------------------------
// 定位：`DecisionChannel` 的一个**默认实现**——把判定件当作外部进程，走 stdio 上的
// NDJSON 协议问答。本文件**不含任何模型代码、不引入 Python 依赖**：判定件由提供方
// （AIR 侧 / 用户自带）以可执行命令的形式交付，本仓只负责「启动、说话、守时、收尸」。
//
// 为什么是子进程而不是 HTTP（2026-10-31 判定）：
//   ① §四 纪律「不新增运行时组件」——起服务就是新增组件（端口/进程管理/健康检查/鉴权）；
//   ② 判定是低频操作（~150ms/次），一份常驻进程够用，服务化收益在一体机单机形态下用不上；
//   ③ §一 必须落「加载失败率」读数——子进程崩了就是崩了，比 HTTP 把崩溃伪装成 5xx 更好归因。
//   传输层仍留后路：将来一体机多进程共享一个判定服务时，**换传输不动 provider**
//   （`DecisionTransport` 接口预留，本版只落 stdio）。
//
// ── 协议（本文件是 SSOT，runner 侧按此实现）──────────────────────────
// 帧格式：**每行一个 JSON**（NDJSON）；stdout 只放协议帧，**日志一律走 stderr**。
//   → 请求：{"id": "<req-id>", "state": {...}, "questions": [...]}
//   ← 应答：{"id": "<req-id>", "answers": [...], "modelVersion": "...", "tempBucket": "..."}
//   ← 失败：{"id": "<req-id>", "error": {"code": "<FallbackReason 通道级五路之一>", "message": "..."}}
// 约定的错误码取 `FallbackReason` 的**通道级五值**（load-failed / weights-missing /
// channel-error / timeout / type-mismatch）；runner 自报 code 时本层直接采信，
// 不作翻译——保证「归因只有一个出处」。
// ────────────────────────────────────────────────────────────────
//
// 加载策略（§一 要求成为显式策略，不留作实现细节）：
//   · `lazy`（默认）：首次 `judge` 才 spawn——低频场景省内存；
//   · `preload`：`preload()` 显式预热，常驻——生产热点档消除冷加载延迟。
//   两档的冷加载耗时/常驻内存/加载失败率读数由调用方采集（S3），本层只暴露
//   `stats` 计数（spawn 次数 / 失败次数 / 超时次数）供落数。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  assertContractCompliance,
  classifyJudgeError,
  type DecisionChannel,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
  type FallbackReason,
} from './decision-channel';

/** 判定件加载策略（两档 · 显式）。 */
export type LoadStrategy = 'lazy' | 'preload';

/** 传输层接口（本版只实现 stdio；HTTP 实现留后路，不改 provider）。 */
export interface DecisionTransport {
  /** 发一次请求并等应答（实现负责分帧与超时）。 */
  request(payload: unknown, timeoutMs: number): Promise<unknown>;
  /** 预热（preload 档调用；lazy 档应为空实现）。 */
  warmup?(): Promise<void>;
  /** 释放资源（关闭管道 / 杀进程）。 */
  close(): Promise<void>;
}

export interface StdioDecisionChannelOptions {
  /** 判定件启动命令（提供方交付的可执行文件 / 解释器 + 脚本） */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 附加环境变量 */
  env?: Record<string, string>;
  /** 单次判定超时（ms，默认 8000——判定应远快于此；超时即杀进程重来） */
  timeoutMs?: number;
  /** 加载策略（默认 lazy） */
  strategy?: LoadStrategy;
  /** 通道名（审计追溯实现方，默认 `stdio:<basename(command)>`） */
  name?: string;
}

/** 通道运行计数（供 §一「加载失败率」等读数采集，S3 使用）。 */
export interface StdioChannelStats {
  spawns: number;
  requests: number;
  failures: number;
  timeouts: number;
  /** 最近一次失败原因（可查） */
  lastFailure?: { reason: FallbackReason; detail: string };
}

/** 判定件自报错误（协议帧级）——原样携带 code，不在此翻译。 */
class RunnerReportedError extends Error {
  readonly code: FallbackReason;
  constructor(code: FallbackReason, message: string) {
    super(message);
    this.name = 'RunnerReportedError';
    this.code = code;
  }
}

/**
 * stdio 传输：一个常驻子进程 + NDJSON 分帧 + 逐请求超时。
 *
 * 失败纪律（fail-closed，不静默）：
 *   · 进程非零退出 / spawn 失败 ⇒ 抛出，由通道层归因为 load-failed；
 *   · 超时 ⇒ **杀进程**（不留半死状态）并归因 timeout，下次调用重新 spawn；
 *   · 输出不是合法 JSON / 缺 id ⇒ 归因 type-mismatch（输出类型不符）。
 */
export class StdioTransport implements DecisionTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private seq = 0;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly opts: StdioDecisionChannelOptions) {}

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed && this.child.exitCode === null) return this.child;
    const child = spawn(this.opts.command, this.opts.args ?? [], {
      cwd: this.opts.cwd,
      env: { ...process.env, ...(this.opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onData(chunk));
    // runner 的日志一律走 stderr：本层不透传，避免日志混入协议面（排障时由调用方落盘）
    child.stderr.setEncoding('utf8');
    child.on('exit', (code) => {
      const err = new Error(`判定件进程退出（code=${code ?? 'null'}）`);
      err.name = 'DecisionChannelUnavailableError';
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      this.child = null;
    });
    child.on('error', (e) => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(e);
      }
      this.pending.clear();
      this.child = null;
    });
    this.child = child;
    return child;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // 协议污染（runner 往 stdout 打了日志）⇒ 类型不符，不静默丢弃
        const e = new Error(`判定件输出不是合法 JSON：${line.slice(0, 120)}`);
        e.name = 'TypeMismatchError';
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(e);
        }
        this.pending.clear();
        continue;
      }
      const id = typeof frame.id === 'string' ? frame.id : '';
      const p = this.pending.get(id);
      if (!p) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      const err = frame.error as { code?: string; message?: string } | undefined;
      if (err) {
        p.reject(new RunnerReportedError((err.code as FallbackReason) ?? 'channel-error', err.message ?? ''));
      } else {
        p.resolve(frame);
      }
    }
  }

  async request(payload: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.ensureChild();
    const id = `r${++this.seq}`;
    const body = JSON.stringify({ ...(payload as object), id });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // 超时即杀进程：留下半死的 runner 比崩掉更难查
        try {
          child.kill('SIGKILL');
        } catch {
          /* 进程已退出 */
        }
        this.child = null;
        const e = new Error(`判定超时（>${timeoutMs}ms）`);
        e.name = 'AbortError';
        reject(e);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(body + '\n');
    });
  }

  async warmup(): Promise<void> {
    this.ensureChild();
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('通道已关闭'));
    }
    this.pending.clear();
    if (child && child.exitCode === null) {
      child.stdin.end();
      child.kill('SIGTERM');
    }
  }
}

/**
 * 本地子进程判定通道（`DecisionChannel` 的默认实现之一）。
 *
 * 行为契约：
 *   · 正常：应答帧经 `assertContractCompliance` 校验，不合规按 type-mismatch 抛；
 *   · 失败：一律抛错（**不返回空答案**），由编排层经 `classifyJudgeError` 归因后落 L0；
 *   · 不占主模型槽位：判定跑在独立进程，与本地主模型推理槽位零交集（§一 行为锁）。
 */
export class StdioDecisionChannel implements DecisionChannel {
  readonly name: string;
  readonly strategy: LoadStrategy;
  readonly stats: StdioChannelStats = { spawns: 0, requests: 0, failures: 0, timeouts: 0 };
  private readonly transport: DecisionTransport;
  private readonly timeoutMs: number;

  constructor(opts: StdioDecisionChannelOptions, transport?: DecisionTransport) {
    this.name = opts.name ?? `stdio:${opts.command.split('/').pop() ?? opts.command}`;
    this.strategy = opts.strategy ?? 'lazy';
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.transport = transport ?? new StdioTransport(opts);
    if (this.strategy === 'preload') {
      // preload 档：构造即预热（失败不抛——由首次 judge 的失败暴露，§一「常驻失败靠兜底发现」）
      void this.transport.warmup?.().catch(() => undefined);
    }
  }

  async preload(): Promise<void> {
    await this.transport.warmup?.();
  }

  async judge(state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionResult> {
    const started = Date.now();
    this.stats.requests += 1;
    let frame: Record<string, unknown>;
    try {
      frame = (await this.transport.request({ state, questions }, this.timeoutMs)) as Record<string, unknown>;
    } catch (e) {
      this.stats.failures += 1;
      const reason = e instanceof RunnerReportedError ? e.code : classifyJudgeError(e);
      if (reason === 'timeout') this.stats.timeouts += 1;
      this.stats.lastFailure = { reason, detail: e instanceof Error ? e.message : String(e) };
      // 自报错误码原样透出（保证归因单出处），其余交给 classifyJudgeError
      if (e instanceof RunnerReportedError) {
        const err = new Error(e.message);
        err.name =
          e.code === 'weights-missing' || e.code === 'load-failed'
            ? 'DecisionChannelUnavailableError'
            : e.code === 'type-mismatch'
              ? 'TypeMismatchError'
              : 'Error';
        throw err;
      }
      throw e;
    }
    const result: DecisionResult = {
      answers: frame.answers as DecisionResult['answers'],
      modelVersion: String(frame.modelVersion ?? ''),
      tempBucket: String(frame.tempBucket ?? ''),
      latencyMs: Date.now() - started,
    };
    const problems = assertContractCompliance(result, questions);
    if (problems.length) {
      this.stats.failures += 1;
      this.stats.lastFailure = { reason: 'type-mismatch', detail: problems.join('；') };
      const e = new Error(`判定件输出不合契约：${problems.join('；')}`);
      e.name = 'TypeMismatchError';
      throw e;
    }
    return result;
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}
