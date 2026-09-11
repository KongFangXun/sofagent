// train-executor.ts · v1.4.7 批次 D · 训练进程执行器（spawn / 事件流解析 / 信号控制的执行面收口）
//
// 定位：v1.4.7 边界收缩把「进程操作」从 scheduler（缰绳面）拆进 executor
// （执行面）。scheduler 只保留提交/事件归一/状态机/审计/GPU 回收——child_process
// 的全部触碰（spawn 缺省实现、stdout 逐行解析、stderr 留痕、SignalController
// 编排）收敛到本文件的 LocalSpawnExecutor。v1.4.7 章十一 TrainChannel 将实现
// TrainExecutor 接口的云端通道形态（ssh/托管 API），本实现保持默认本地执行器。
//
// 行为保真：搬迁自 train-scheduler.ts 原 launch/gracefulStopChild——逻辑原样
// 搬入不改行为；scheduler 侧 close/error 钩子里的状态机收尾动作经 onClose/
// onError 回调注入（回调带 child 引用——spawn 先行、收尾后置）。
//
// 测试纪律：SpawnFn 注入点语义不变（测试传假子进程零真实进程）；缺省实现
// 绑定 Node spawn。

import { spawn, type ChildProcess } from 'child_process';
import {
  parseTrainEvent,
  createSignalController,
  type SignalAction,
  type SignalControllerOptions,
  type TrainEvent,
} from './train-protocol';

/** 类型再导出（scheduler 侧类型引用免触 child_process——缰绳面零进程细节 import） */
export type { ChildProcess };

/** 可注入的 spawn 函数（测试用假子进程替换——零真实进程） */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd?: string; stdio?: ('ignore' | 'pipe')[] },
) => ChildProcess;

/**
 * executor 生命周期回调（scheduler 注入——状态机收尾动作留缰绳面）。
 * onStarted 在挂 stdout/close/error 监听之前同步调用（保真原时序：spawn →
 * 落盘/审计/心跳 → 事件流消费 → close/error 收尾）。
 */
export interface TrainExecutorHooks {
  /** spawn 返回即调（挂监听前）——scheduler 做记录落盘/审计/心跳注册 */
  onStarted: (child: ChildProcess) => void;
  /** stdout 解析出一个协议事件（坏行静默容忍——与原实现一致） */
  onEvent: (event: TrainEvent) => void;
  /** 进程退出（退出码——0 走存档暂停分支，非 0 走失败分支，由回调方判定） */
  onClose: (info: { code: number | null; child: ChildProcess; stderrTail: string }) => void;
  /** spawn 失败（可执行不存在等——child_process error 事件） */
  onError: (info: { err: Error; child: ChildProcess }) => void;
}

/** TrainExecutor 窄接口（v1.4.6 批次 D——scheduler 只见此面） */
export interface TrainExecutor {
  /**
   * 启动一次训练执行：spawn → onStarted（同步、挂监听前）→ stdout 逐行解析
   * → onEvent / onClose / onError。返回子进程引用（终态结算由回调方自管
   * ——executor 不持有调度状态）；jobId 进内部注册表（stop 消费，close/error
   * 自动注销——生命周期与进程一致）。
   */
  start(
    jobId: string,
    command: string,
    args: string[],
    options: { cwd?: string; hooks: TrainExecutorHooks },
  ): ChildProcess;
  /**
   * 优雅停止（约定③——SIGINT 超时升级 SIGKILL）。无在册进程（未 spawn /
   * 已退出 / 排队占位）返回 noop——状态机直接收尾。
   */
  stop(jobId: string): Promise<SignalAction>;
}

/**
 * 本地 spawn 执行器（缺省实现——Node child_process 收口）。
 *
 * @param spawnFn 可注入（测试——零真实进程）；缺省绑定 Node spawn
 * @param signalOptions SIGINT 超时等 SignalController 选项（透传——scheduler 侧已合并缺省）
 */
export function createLocalSpawnExecutor(options: {
  spawnFn?: SpawnFn;
  signalOptions?: SignalControllerOptions;
}): TrainExecutor {
  const spawnFn: SpawnFn = options.spawnFn ?? ((cmd, args, opts) => spawn(cmd, args, opts));

  // 在册子进程（jobId → child）：stop 的查找面；close/error 自动注销——
  // 注册表生命周期与进程严格一致（进程退场即出册，无悬挂引用）
  const children = new Map<string, ChildProcess>();

  return {
    start(jobId, command, args, startOptions) {
      const { hooks } = startOptions;
      const child = spawnFn(command, args, {
        ...(startOptions.cwd ? { cwd: startOptions.cwd } : {}),
        stdio: ['ignore', 'pipe', 'pipe'] as ('ignore' | 'pipe')[],
      });
      children.set(jobId, child);
      // spawn 先行：落盘/审计/心跳等状态面先于事件流消费（保真原时序）
      hooks.onStarted(child);

      // 约定②：stdout 逐行解析（只认 JSON 行——坏行静默容忍不崩溃）
      let stdoutBuf = '';
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          const parsed = parseTrainEvent(line);
          if (parsed.event) hooks.onEvent(parsed.event);
        }
      });

      // stderr：日志留痕（不解析——协议只认 stdout）
      let stderrTail = '';
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });

      child.on('close', (code) => {
        children.delete(jobId);
        hooks.onClose({ code, child, stderrTail });
      });

      child.on('error', (err) => {
        children.delete(jobId);
        hooks.onError({ err, child });
      });

      return child;
    },

    async stop(jobId) {
      const child = children.get(jobId);
      if (!child || child.pid === undefined) {
        return { action: 'noop' }; // 无进程（崩溃残留/未 spawn/排队占位）——状态机直接收尾
      }
      const controller = createSignalController(options.signalOptions ?? {});
      return controller.gracefulStop(child.pid);
    },
  };
}
