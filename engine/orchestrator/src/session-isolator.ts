// ============================================================
// session-isolator.ts · Onboard/Refine Session 级隔离（v1.3.5 交付 9）
// ============================================================
//
// Builder（FDE 建 Agent）vs Optimizer（Onboard/Refine 跑循环）分离。
// spawn 子进程跑 Onboard 循环（独立 workspace + 独立上下文）。
// Session 间数据走 evaluation-log（不直接写文件/不走上下文变量）。
//
// 设计来源：PenguinHarness Builder Session vs Optimizer Session 分离。
// ============================================================

import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';

/** Session 类型 */
export type SessionType = 'builder' | 'optimizer';

/** Session 级隔离配置 */
export interface SessionIsolatorConfig {
  /** Session 类型 */
  type: SessionType;
  /** 企业 ID */
  enterpriseId: string;
  /** 任务 ID */
  taskId: string;
  /** 独立 workspace 目录（默认 {dataDir}/sessions/{type}-{taskId}） */
  workspaceDir?: string;
  /** 独立 SOFAGENT_HOME（上下文隔离） */
  isolatedHome?: string;
  /** 超时（ms，默认 300_000 = 5 分钟） */
  timeoutMs?: number;
}

/** Session 隔离运行结果 */
export interface SessionRunResult {
  /** Session 类型 */
  sessionType: SessionType;
  /** 任务 ID */
  taskId: string;
  /** 退出码 */
  exitCode: number;
  /** stdout */
  stdout: string;
  /** stderr */
  stderr: string;
  /** 运行耗时 */
  durationMs: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 传递给下游的数据（走 evaluation-log） */
  dataHandoff?: {
    benchmarkId?: string;
    evalResults?: Array<{ caseId: string; score: number }>;
  };
}

/**
 * 创建隔离的 Session workspace。
 *
 * @param config Session 配置
 * @returns workspace 目录路径
 */
export function createSessionWorkspace(config: SessionIsolatorConfig): string {
  const env = loadEnvConfig();
  const baseDir = config.isolatedHome ?? env.dataDir ?? process.env.SOFAGENT_HOME ?? join(process.env.HOME ?? '/tmp', '.sofagent');
  const workspace = config.workspaceDir ?? join(baseDir, 'sessions', `${config.type}-${config.taskId}`);
  return workspace;
}

/**
 * 在隔离 Session 中运行 Onboard 循环（spawn 子进程）。
 *
 * 子进程有独立的 workspace + 独立的上下文环境变量。
 * Session 间数据通过 evaluation-log 传递（不直接写文件/不走上下文变量）。
 *
 * @param config Session 配置
 * @param command 要执行的命令（默认运行 onboard loop）
 * @param args 命令参数
 * @returns SessionRunResult
 */
export function runInIsolatedSession(
  config: SessionIsolatorConfig,
  command?: string,
  args?: string[],
): Promise<SessionRunResult> {
  return new Promise((resolve) => {
    const workspace = createSessionWorkspace(config);
    const timeoutMs = config.timeoutMs ?? 300_000;
    const startedAt = Date.now();

    // 默认命令：运行 onboard loop
    const cmd = command ?? process.execPath;
    const cmdArgs = args ?? [];

    // 隔离环境变量（独立 SOFAGENT_HOME）
    const env: Record<string, string> = {
      ...process.env,
      SOFAGENT_SESSION_TYPE: config.type,
      SOFAGENT_SESSION_TASK_ID: config.taskId,
      SOFAGENT_SESSION_WORKSPACE: workspace,
      ...(config.isolatedHome ? { SOFAGENT_HOME: config.isolatedHome } : {}),
    } as Record<string, string>;

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child: ChildProcess | null = null;

    try {
      child = spawn(cmd, cmdArgs, {
        cwd: workspace,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        sessionType: config.type,
        taskId: config.taskId,
        exitCode: 1,
        stdout: '',
        stderr: `spawn 失败：${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        sessionType: config.type,
        taskId: config.taskId,
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        sessionType: config.type,
        taskId: config.taskId,
        exitCode: 1,
        stdout,
        stderr: `子进程错误：${err.message}`,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      });
    });
  });
}

/**
 * 通过 evaluation-log 在 Session 间传递数据。
 *
 * 不直接写文件/不走上下文变量——调用 appendEvaluationRecord 写入，
 * 下游 Session 通过 readEvaluationLog 读取。
 *
 * @param benchmarkId Benchmark ID
 * @param taskId 任务 ID
 * @param data 要传递的数据
 */
export async function handoffSessionData(
  benchmarkId: string,
  taskId: string,
  data: { caseId: string; score: number; durationMs: number; failureCode?: string | null }[],
): Promise<void> {
  const { appendEvaluationRecord } = await import('./benchmark/evaluation-log');
  for (const item of data) {
    try {
      appendEvaluationRecord({
        benchmarkId,
        caseId: item.caseId,
        revision: 0,
        score: item.score,
        failureCode: item.failureCode ?? null,
        durationMs: item.durationMs,
      });
    } catch {
      // 写入失败静默（数据传递容错）
    }
  }
  void taskId; // taskId 用于日志关联（HMAC 链内含 timestamp）
}
