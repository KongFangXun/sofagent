// train-channel.ts · 章十二 云训练执行接线收口 · TrainChannel 接口
//
// 定位：云端微调走标准 TrainChannel 接口（一体机战略硬性边界——
// 不做每云适配器）。任何托管训练 API（云厂商 / 自建）实现本接口
// 四动作（submit/status/artifacts/cancel），经通道注册表挂进
// train-scheduler 消费面——scheduler 只见 TrainExecutor 形态。
//
// 与 train-executor.ts 的关系：TrainExecutor（v1.4.6 批次 D）是本地
// spawn 执行器接口；TrainChannel 是其云端通道形态扩展——同一 job
// 既可 LocalSpawnExecutor 跑（执行者互换测试），也可任意 TrainChannel
// 实现跑（ssh 适配器 / 托管 API 适配器），事件流协议②不变。
//
// 测试纪律：零真实网络——所有实现注入 fake；参考适配示例见
// tools/train/examples/hosted-channel.example.mjs（非引擎核心依赖）。

import type { TrainExecutorHooks } from './train-executor';
import type { TrainEvent } from './train-protocol';

// ════════════════════════════════════════
// 通道事件与契约
// ════════════════════════════════════════

/** 通道状态值（轮询状态机归一——各云原生状态映射至此） */
export type ChannelStatus =
  | 'pending'    // 已受理未启动
  | 'running'    // 训练中
  | 'succeeded'  // 成功（artifacts 就绪）
  | 'failed'     // 失败（error 携因）
  | 'cancelled'; // 已取消（止损/人审）

/** 通道事件（事件归一——各云原生事件映射至协议② TrainEvent 流） */
export interface ChannelEvent {
  /** 事件时间（ISO 8601） */
  at: string;
  /** 归一类型 */
  kind: 'status' | 'progress' | 'log' | 'error';
  /** 归一状态（kind=status 时） */
  status?: ChannelStatus;
  /** 进度（0-100——kind=progress 时） */
  percent?: number;
  /** 日志/错误文本 */
  message?: string;
}

/** 产物描述（artifacts 动作返回——sha256 校验入权重 manifest） */
export interface ChannelArtifact {
  /** 产物名（如 adapter.safetensors） */
  name: string;
  /** 远程地址（下载用——file:// 或 https://） */
  uri: string;
  /** sha256（产物校验——篡改拒绝） */
  sha256: string;
  /** 字节数 */
  sizeBytes: number;
}

/** submit 动作结果 */
export interface ChannelSubmitResult {
  /** 云侧 job 标识（后续 status/artifacts/cancel 的引用） */
  remoteJobId: string;
  /** 受理确认 */
  accepted: true;
}

/** status 轮询结果 */
export interface ChannelStatusResult {
  status: ChannelStatus;
  /** 状态原值（各云原生状态字串——审计可读） */
  rawStatus: string;
  /** 失败原因（status=failed 时） */
  error?: string;
  /** 最近事件（增量） */
  recentEvents: ChannelEvent[];
}

// ════════════════════════════════════════
// TrainChannel 四动作接口
// ════════════════════════════════════════

/**
 * 托管训练通道接口——四动作契约。
 *
 * 实现约束（适配规范详见 docs/guides/train-channel-spec.md）：
 *   - execFile 数组参数防注入（禁止 shell 拼接）
 *   - 凭据不落明文——走 credentialRef 引用边界
 *   - 事件归一：各云原生事件 → ChannelEvent（协议②兼容）
 *   - 产物校验：sha256 必填（篡改拒绝在 artifact-verify 侧）
 */
export interface TrainChannel {
  /** 通道名（train submit 的 channel 字段引用） */
  readonly name: string;
  /** 提交训练 job（本地 job.json 路径 → 云侧受理） */
  submit(jobDir: string, jobSpec: ChannelJobSpec): Promise<ChannelSubmitResult>;
  /** 轮询状态（状态机：pending → running → succeeded/failed/cancelled） */
  status(remoteJobId: string): Promise<ChannelStatusResult>;
  /** 取产物清单（status=succeeded 后可调） */
  artifacts(remoteJobId: string): Promise<ChannelArtifact[]>;
  /** 取消（止损/人审——幂等：已终态再调返回当次状态） */
  cancel(remoteJobId: string, reason: string): Promise<ChannelStatusResult>;
}

/** submit 携带的 job 规格（job.json 摘要 + 校验） */
export interface ChannelJobSpec {
  /** job 标识（本地侧） */
  jobId: string;
  /** job.json 的 sha256（上传完整性校验） */
  jobJsonSha256: string;
  /** 凭据引用（不落明文——virtual-key 边界） */
  credentialRef?: string;
  /** 超时（秒——云侧强制止损上限） */
  timeoutSeconds?: number;
}

// ════════════════════════════════════════
// 通道注册表
// ════════════════════════════════════════

/** 通道注册表——train submit 的 channel 字段解析面 */
export class ChannelRegistry {
  private channels = new Map<string, TrainChannel>();

  register(channel: TrainChannel): void {
    this.channels.set(channel.name, channel);
  }

  get(name: string): TrainChannel | undefined {
    return this.channels.get(name);
  }

  list(): string[] {
    return [...this.channels.keys()];
  }
}

// ════════════════════════════════════════
// TrainExecutor 适配桥（通道 → executor 形态）
// ════════════════════════════════════════

/**
 * 把 TrainChannel 适配为 executor 形态（执行者互换测试的桥）。
 *
 * 语义：start() 立即 submit 并轮询（intervalMs）；事件经 hooks.onEvent
 * 回流（ChannelEvent → 协议② TrainEvent 映射）。stop() 停轮询。
 * 本桥为测试/演示形态——生产 ssh 通道见 daemon/cloud-exec.ts。
 */
export function channelAsExecutor(
  channel: TrainChannel,
  opts: { pollIntervalMs?: number } = {},
): { start: (jobId: string, hooks: TrainExecutorHooks) => unknown; stop: (jobId: string) => Promise<{ action: string }> } {
  const interval = opts.pollIntervalMs ?? 100;
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  /** ChannelEvent → 协议② TrainEvent 映射 */
  function toTrainEvent(ev: ChannelEvent): TrainEvent {
    if (ev.kind === 'progress') return { type: 'progress', step: Math.round(ev.percent ?? 0) };
    if (ev.kind === 'error') return { type: 'failed', reason: ev.message ?? 'unknown' };
    if (ev.status === 'succeeded') return { type: 'done' };
    if (ev.status === 'failed') return { type: 'failed', reason: ev.message ?? 'channel failed' };
    // status/log → progress 心跳
    return { type: 'progress', step: -1 };
  }

  return {
    start(jobId, hooks) {
      // 异步驱动（桥形态——哑对象代替 child 引用，close/error 经 hooks 回流）
      const dummy = { pid: undefined } as unknown as import('child_process').ChildProcess;
      void (async () => {
        try {
          const submit = await channel.submit(jobDir(jobId), {
            jobId,
            jobJsonSha256: 'bridge',
          });
          hooks.onStarted(dummy);
          const timer = setInterval(async () => {
            try {
              const st = await channel.status(submit.remoteJobId);
              for (const ev of st.recentEvents) hooks.onEvent(toTrainEvent(ev));
              if (st.status === 'succeeded' || st.status === 'failed' || st.status === 'cancelled') {
                clearInterval(timer);
                timers.delete(jobId);
                hooks.onClose({ code: st.status === 'succeeded' ? 0 : 1, child: dummy, stderrTail: st.error ?? '' });
              }
            } catch (err) {
              clearInterval(timer);
              timers.delete(jobId);
              hooks.onError({ err: err as Error, child: dummy });
            }
          }, interval);
          timers.set(jobId, timer);
        } catch (err) {
          hooks.onError({ err: err as Error, child: dummy });
        }
      })();
      return dummy;
    },

    async stop(jobId) {
      const timer = timers.get(jobId);
      if (timer) {
        clearInterval(timer);
        timers.delete(jobId);
      }
      // 幂等止损兑现（stop 语义 = 停轮询 + 停远端任务——cancel 对已终态 job
      // 返回终态不重复动作；本桥转生产路径后此调用成为失联止损的远端半边）
      try {
        await channel.cancel(jobId, 'executor stop（channelAsExecutor）');
      } catch {
        // cancel 失败不阻断本地停轮询（远端已死/网络不可达时 noop 即可）
      }
      return { action: 'noop' };
    },
  };
}

/** jobDir 推导（桥内部——job.json 常规落点） */
function jobDir(jobId: string): string {
  return `./train-jobs/${jobId}`;
}
