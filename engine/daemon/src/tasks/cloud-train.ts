// ============================================================
// tasks/cloud-train.ts · v1.4.7 批次 B · 云训练通道 daemon 真实接线
//
// 定位：daemon 云训练任务装配面——把章十二的两块「零生产调用」导出接进
// 真实执行链（check-unwired-exports 监控表在册防回退）：
//   ① createSshTrainChannel（cloud-exec.ts）——TrainChannel 的 ssh 形态实现
//   ② chainDualChannelEvent（cloud-events.ts）——双通道事件归一 + HMAC 挂链
//
// 装配链（全部复用既有模块——本文件零新执行逻辑）：
//   cloud/registry.json（train_cloud tool 落盘）
//     → 选 VM（reachable 优先，凭据边界：只读 endpoint/credentialRef 引用，
//       真实凭据不落表不落明文——cloud-registry.ts:6 红线）
//     → createSshTrainChannel({ endpoint, exec })
//     → channelAsExecutor（orchestrator 桥——executor 形态）
//     → createTrainScheduler({ executor, onEvent })
//     → onEvent 回调 → chainDualChannelEvent → emitTrainAudit（既有 HMAC 链）
//
// 消费点：tasks/continuous-training.ts 的 scheduler 构造处注入（daemon 侧
// 唯一生产 createTrainScheduler 消费者——最小改动缝，cron.ts 经既有
// continuous-training 分支不变）。
//
// 测试纪律：channel / exec / registry 全注入（零真实网络 / 零真实 ssh——
// fake channel 走 submit→事件→挂链全链）。
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  channelAsExecutor,
  type SignalAction,
  type TrainChannel,
  type TrainEvent,
  type TrainExecutor,
  type TrainExecutorHooks,
} from '@sofagent/orchestrator';
import { createSshTrainChannel, type SshChannelOptions } from '../cloud-exec';
import { chainDualChannelEvent } from '../cloud-events';

// ════════════════════════════════════════
// 云 VM 注册表读取（registry.json——train_cloud tool 的落盘面）
// ════════════════════════════════════════

/** 注册表落盘记录（cloud-registry.ts CloudVmRecord 的 jsonl 形态） */
interface CloudVmRecordLike {
  name: string;
  endpoint: string;
  status: 'unknown' | 'reachable' | 'unreachable';
  credentialRef?: string;
  registeredAt: string;
}

/** 注册表路径：data/train/cloud/registry.json（对齐 mcp train-cloud 落点） */
export function cloudRegistryPath(dataDir: string): string {
  return join(dataDir, 'train', 'cloud', 'registry.json');
}

/** 读注册表（不存在/损坏返回 []——云路径降级本地，daemon 不 crash） */
export function loadCloudVms(dataDir: string): CloudVmRecordLike[] {
  const file = cloudRegistryPath(dataDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is CloudVmRecordLike =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as CloudVmRecordLike).name === 'string' &&
        typeof (r as CloudVmRecordLike).endpoint === 'string',
    );
  } catch {
    return []; // 坏注册表降级本地执行（观测面在装配结果 reason 里可见）
  }
}

/**
 * 选执行 VM：reachable 优先（unknown 次之——刚注册未体检也放行，首次
 * submit 即体检），unreachable 跳过；同级按注册名排序（稳定选择）。
 */
export function pickCloudVm(vms: CloudVmRecordLike[]): CloudVmRecordLike | null {
  const candidates = vms
    .filter((v) => v.status !== 'unreachable')
    .sort((a, b) => {
      const rank = (s: CloudVmRecordLike['status']): number => (s === 'reachable' ? 0 : 1);
      return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name);
    });
  return candidates[0] ?? null;
}

// ════════════════════════════════════════
// 调度器选项装配（云 executor + 双通道事件挂链）
// ════════════════════════════════════════

/** createTrainScheduler 选项的最小消费面（对齐 continuous-training 动态引入形态） */
interface SchedulerOptsLike {
  dataDir: string;
  enterpriseId: string;
  crashRecoveryScan?: boolean;
  /** v1.4.7 批次 B：执行器注入（orchestrator TrainSchedulerOptions.executor） */
  executor?: Pick<TrainExecutor, 'start' | 'stop'>;
  /** 事件回调（双通道挂链回流口） */
  onEvent?: (jobId: string, event: TrainEvent) => void;
}

/** 装配结果（观测面——continuous-training tick 台账与测试断言消费） */
export interface CloudWiringResult {
  /** true = 云通道已注入（executor 形态）；false = 维持本地执行 */
  wired: boolean;
  /** 选中 VM 名（wired=true 时在场） */
  vmName?: string;
  /** 未接线原因（wired=false 时在场——观测台账可读） */
  reason: string;
}

/** 装配选项（全注入点——测试 fake channel/exec 零真实网络） */
export interface BuildCloudSchedulerOptionsOptions {
  dataDir: string;
  enterpriseId: string;
  /** ssh 通道 exec 注入（测试） */
  exec?: SshChannelOptions['exec'];
  /** 通道整体注入（测试——fake TrainChannel 直驱，绕过 ssh 形态） */
  channel?: TrainChannel;
  /** 注册表 VM 列表注入（测试——不读盘） */
  vms?: CloudVmRecordLike[];
  /** 注册表路径覆盖（测试） */
  registryPath?: string;
  /** scheduler 其余选项透传（crashRecoveryScan 等） */
  scheduler?: Omit<SchedulerOptsLike, 'dataDir' | 'enterpriseId' | 'executor' | 'onEvent'>;
}

/**
 * 装配云训练调度器选项（executor + onEvent）——不直接构造 scheduler，
 * 只产出注入件，由调用方（continuous-training）合入 createTrainScheduler。
 *
 * 凭据边界：ssh 通道只消费 endpoint（ssh user@host 形态，凭据走本机
 * ssh-agent / 虚拟 key 边界）——credentialRef 仅透传引用，不解析不落明文。
 */
export function buildCloudSchedulerOptions(
  opts: BuildCloudSchedulerOptionsOptions,
): CloudWiringResult & { schedulerOptions: SchedulerOptsLike } {
  const vms = opts.vms ?? loadCloudVms(opts.registryPath ?? opts.dataDir);
  const vm = pickCloudVm(vms);
  if (!vm) {
    return {
      wired: false,
      reason: '无可用云 VM（registry.json 未注册或全部 unreachable）——维持本地执行',
      schedulerOptions: {
        dataDir: opts.dataDir,
        enterpriseId: opts.enterpriseId,
        ...(opts.scheduler ?? {}),
      },
    };
  }

  // ① ssh 通道（章十二 createSshTrainChannel——此处成为生产消费点）。
  // jobDir 重映射：桥的缺省 jobDir 是演示态相对路径（./train-jobs/<jobId>，
  // 真实 scp 会因目录不存在失败）——包装 submit 把第一参改指 scheduler 落盘的
  // 真实 job 目录（data/train/<ent>/<jobId>）。桥本体不归本批改，此处只包一层。
  const rawChannel: TrainChannel =
    opts.channel ??
    createSshTrainChannel({
      endpoint: vm.endpoint,
      ...(opts.exec ? { exec: opts.exec } : {}),
    });
  const channel: TrainChannel = {
    name: rawChannel.name,
    submit: (jobDirArg, spec) =>
      rawChannel.submit(opts.channel ? jobDirArg : join(opts.dataDir, 'train', opts.enterpriseId, spec.jobId), spec),
    status: rawChannel.status.bind(rawChannel),
    artifacts: rawChannel.artifacts.bind(rawChannel),
    cancel: rawChannel.cancel.bind(rawChannel),
  };

  // ② 通道 → executor 形态（channelAsExecutor 桥——submit + 轮询 + 事件回流）
  const bridged = channelAsExecutor(channel, { pollIntervalMs: 5_000 });

  // 签名桥接：桥的 start(jobId, hooks) 与 scheduler 调用面 start(jobId,
  // command, args, { hooks }) 不同构（桥自称测试/演示形态）。适配后整体呈现
  // Pick<TrainExecutor, 'start' | 'stop'>——command/args 对云通道无意义（job.json
  // 经 submit 上传），忽略。
  const executor: Pick<TrainExecutor, 'start' | 'stop'> = {
    start: ((jobId: string, _command: string, _args: string[], options: { hooks: TrainExecutorHooks }) =>
      bridged.start(jobId, options.hooks)) as TrainExecutor['start'],
    stop: (jobId: string) => bridged.stop(jobId) as Promise<SignalAction>,
  };

  // ③ 双通道事件挂链（onEvent → chainDualChannelEvent → emitTrainAudit）。
  // progress 心跳在归一层即被过滤（chained=false 不写链）——高频轮询不刷链。
  const dataDir = opts.dataDir;
  const enterpriseId = opts.enterpriseId;
  const onEvent = (jobId: string, event: TrainEvent): void => {
    chainDualChannelEvent({
      enterpriseId,
      trainJobId: jobId,
      // 数据源指纹：scheduler 侧审计已在提交时算一次（unknown 容错在位）；
      // 挂链维度（enterprise/trainJob）与主链一致，readTrainAudit 一次可查全
      dataSourceHash: 'unknown',
      event: { source: 'cloud', event, remoteJobId: jobId },
      dataDir,
    });
  };

  return {
    wired: true,
    vmName: vm.name,
    reason: `云通道已接线：ssh:${vm.endpoint}（VM=${vm.name}）`,
    schedulerOptions: {
      dataDir,
      enterpriseId,
      crashRecoveryScan: false,
      ...(opts.scheduler ?? {}),
      executor,
      onEvent,
    },
  };
}
