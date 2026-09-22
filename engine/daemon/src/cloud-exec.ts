// cloud-exec.ts · 章十二 ssh 通道适配器（daemon 接线批）
//
// 消费 v1.5.1 train-cloud 命令构造器产物（CloudCommand）真实执行——
// execFile 数组参数防注入（构造器已保证 args 数组形态，本层不拼 shell）。
//
// 四类命令：spawn / upload / cleanup / stop——映射 TrainChannel 四动作：
//   submit   = upload(job.json + dataset) + spawn
//   status   = 轮询事件文件尾读（远程 tail）→ 状态机归一
//   artifacts= 产物清单（sha256 校验——篡改拒绝）
//   cancel   = stop（pkill）+ cleanup（rm -rf）
//
// 测试纪律：ExecFn 注入 fake（零真实网络/零真实 ssh）。

import { execFile } from 'child_process';
import {
  buildCloudSpawnCommand,
  buildCloudUploadCommand,
  buildCloudCleanupCommand,
  buildCloudStopCommand,
  isSafePathSegment,
  type CloudCommand,
} from '@sofagent/train';
import type {
  TrainChannel,
  ChannelJobSpec,
  ChannelSubmitResult,
  ChannelStatusResult,
  ChannelStatus,
  ChannelArtifact,
} from '@sofagent/train';

/** 可注入执行函数（测试 fake——零真实网络） */
export type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

/** 缺省实现——Node execFile（数组参数天然防注入） */
const defaultExec: ExecFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });

/** ssh 通道适配器配置 */
export interface SshChannelOptions {
  /** VM endpoint（ssh user@host） */
  endpoint: string;
  /** 远程工作根目录（job 目录挂这下面） */
  remoteRoot?: string;
  /** 命令超时（ms——缺省 30s） */
  timeoutMs?: number;
  /** exec 注入（测试） */
  exec?: ExecFn;
}

/** CloudVmRecord 最小形态（命令构造器的入参——本层自造记录不碰注册表） */
interface CloudVmRecordLike {
  name: string;
  endpoint: string;
  status: 'reachable';
  registeredAt: string;
}

/**
 * ssh 通道适配器——TrainChannel 的 ssh 形态实现。
 *
 * 四动作映射（章十二验收口径）：
 *   submit:   scp 上传 job.json → ssh spawn（torchrun/verl）
 *   status:   ssh tail 事件文件尾 → 归一状态机
 *   artifacts: ssh ls + sha256sum → 产物清单
 *   cancel:  ssh pkill + rm -rf（失联止损）
 */
export function createSshTrainChannel(opts: SshChannelOptions): TrainChannel {
  const exec = opts.exec ?? defaultExec;
  const remoteRoot = opts.remoteRoot ?? '/tmp/sofagent-train';

  /** 执行 CloudCommand（execFile 数组——防注入） */
  async function run(cmd: CloudCommand): Promise<{ stdout: string; stderr: string }> {
    return exec(cmd.args[0] ?? 'ssh', cmd.args.slice(1));
  }

  /**
   * 远程任务标识把关——只允许作为**单一路径段**（P2-4）。
   *
   * 为什么需要：ssh 会把多段 argv 用空格拼回**远端 shell 命令**执行 ⇒ `remoteJobId`
   * 一旦含 `;`、`$()`、`..`、`\0` 等构造，即构成远端命令注入。四个动作
   * （submit / status / artifacts / cancel）的 id 全部落进远端命令串，故在**同一处**
   * 统一把关：一处守卫、四路同强度（避免「修了两处、漏了两处」的同形态漏网）。
   * 复用 `@sofagent/train` 的 `isSafePathSegment`——与 train 写入口 P2-3 同源守卫。
   *
   * 非法即抛（fail-loud）：调用侧 train-channel.ts 已用 try/catch 收口到 hooks.onError，
   * 不会静默吞掉，也不会带着恶意 id 继续拼命令。
   */
  function assertSafeRemoteJobId(remoteJobId: string): void {
    if (!isSafePathSegment(remoteJobId)) {
      throw new Error('[cloud-exec] remoteJobId 非法（含分隔符 / 逃逸构造 / 空字节）——已拒绝拼入远端命令');
    }
  }

  return {
    name: `ssh:${opts.endpoint}`,

    async submit(jobDirLocal: string, spec: ChannelJobSpec): Promise<ChannelSubmitResult> {
      // 远端命令串含 spec.jobId（上传目录 + spawn 路径）——先过关再拼（P2-4）
      assertSafeRemoteJobId(spec.jobId);
      const remoteJobDir = `${remoteRoot}/${spec.jobId}`;
      const vm: CloudVmRecordLike = {
        name: spec.jobId,
        endpoint: opts.endpoint,
        status: 'reachable',
        registeredAt: new Date().toISOString(),
      };
      // ① 上传 job 目录（scp -r——构造器产物）
      const upload = buildCloudUploadCommand(vm, jobDirLocal, remoteJobDir);
      await run(upload);
      // ② 远程 spawn（构造器产物——torchrun/verl 启动）
      const spawnCmd = buildCloudSpawnCommand(
        vm,
        // TrainJob 最小形态——构造器只消费 gpu.count/nodes/hyperparams.launcher
        { gpu: { count: 1 }, nodes: 1, hyperparams: { launcher: 'torchrun' } } as never,
        `${remoteJobDir}/job.json`,
      );
      await run(spawnCmd);
      return { remoteJobId: spec.jobId, accepted: true };
    },

    async status(remoteJobId: string): Promise<ChannelStatusResult> {
      assertSafeRemoteJobId(remoteJobId);
      // 远程 tail 事件文件（events.jsonl——协议② stdout 重定向落盘形态）
      const tail = await exec('ssh', [
        opts.endpoint,
        `tail -n 50 ${remoteRoot}/${remoteJobId}/events.jsonl 2>/dev/null || echo '{}'`,
      ]);
      return normalizeStatus(tail.stdout, remoteJobId);
    },

    async artifacts(remoteJobId: string): Promise<ChannelArtifact[]> {
      assertSafeRemoteJobId(remoteJobId);
      const list = await exec('ssh', [
        opts.endpoint,
        `cd ${remoteRoot}/${remoteJobId}/artifacts 2>/dev/null && sha256sum * 2>/dev/null || true`,
      ]);
      const out: ChannelArtifact[] = [];
      for (const line of list.stdout.split('\n')) {
        const m = line.match(/^([0-9a-f]{64})\s+(\S+)$/);
        const sha = m?.[1];
        const name = m?.[2];
        if (m && sha && name) {
          out.push({
            name,
            uri: `ssh://${opts.endpoint}${remoteRoot}/${remoteJobId}/artifacts/${name}`,
            sha256: sha,
            sizeBytes: 0,
          });
        }
      }
      return out;
    },

    async cancel(remoteJobId: string, reason: string): Promise<ChannelStatusResult> {
      // cancel 落两处远端命令（pkill -f train_job_<id> / rm -rf <root>/<id>）——同样先过关（P2-4）
      assertSafeRemoteJobId(remoteJobId);
      const vm: CloudVmRecordLike = {
        name: remoteJobId,
        endpoint: opts.endpoint,
        status: 'reachable',
        registeredAt: new Date().toISOString(),
      };
      // ① 强杀（pkill -9——构造器产物）
      await run(buildCloudStopCommand(vm, remoteJobId));
      // ② 清理（rm -rf——构造器产物）
      await run(buildCloudCleanupCommand(vm, `${remoteRoot}/${remoteJobId}`));
      return {
        status: 'cancelled',
        rawStatus: `cancelled（${reason}）`,
        recentEvents: [{ at: new Date().toISOString(), kind: 'status', status: 'cancelled', message: reason }],
      };
    },
  };
}

/** 事件文件尾 → 状态归一（远端最后一行 done/failed 决定状态） */
function normalizeStatus(stdout: string, remoteJobId: string): ChannelStatusResult {
  const lines = stdout.split('\n').filter((l) => l.trim() !== '' && l !== '{}');
  const events: ChannelStatusResult['recentEvents'] = [];
  let status: ChannelStatus = 'running';
  let error: string | undefined;

  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as { type?: string; reason?: string; step?: number };
      if (ev.type === 'done') status = 'succeeded';
      else if (ev.type === 'failed') {
        status = 'failed';
        error = ev.reason;
      } else if (ev.type === 'progress') {
        events.push({ at: new Date().toISOString(), kind: 'progress', percent: ev.step });
      }
    } catch {
      // 坏行容忍（协议错误容忍同款）
    }
  }
  if (lines.length === 0) status = 'pending';
  return { status, rawStatus: `${status}@${remoteJobId}`, error, recentEvents: events };
}
