// trajectory.ts · v1.3.7 交付⑤ · Trajectory 训练信号采集 PoC
//
// 使命：订阅 DSH Cordis 事件流（turn / step / tool / fs 全链），落 JSONL——
// 格式可直接进 reward 样本（商业模型层 B' 路径起点）；failure-log（错题本）同步
// 消费失败轨迹——哪类工具调用链最易翻车 = 结构化负样本。
//
// 契约依据（DSH 官方 cordis-tutorial 七章，2026-08 核实）：
// - Cordis 事件五模式：emit / parallel / serial / bail / waterfall
// - 观察型监听器用 ctx.on 订阅（fire-and-forget，不干扰执行）
// - 事件域（教程 04-events + 07-into-the-harness）：agent/*（turn 生命周期）、
//   tools/*（工具执行）、fs/*（文件写意向）
// - 🔴 waterfall 纪律不适用于本文件——采集是纯观察，全部走 ctx.on；
//   waterfall next() 透传纪律只约束 dsh-backend.ts 的预算软熔断监听器。
//
// 防御式订阅：DSH 正式版事件名与教程如有出入，逐事件 try-catch——
// 订阅失败只丢该路信号，绝不影响 agent 执行。

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { appendFailure } from '../instinct/failure-log.js';
import type { CordisPlugin, CordisRuntime } from './dsh-backend.js';

/** 轨迹记录（JSONL 一行 = 一条）——reward 样本可消费格式 */
export interface TrajectoryRecord {
  /** 事件时间戳（ISO） */
  ts: string;
  /** 执行的 agent 标识（跨设备审计聚合用，对齐 debugLogs.agentId 口径） */
  agentId: string;
  /** 轨迹层级：turn（轮次）/ tool（工具调用）/ fs（文件写意向） */
  kind: 'turn' | 'tool' | 'fs';
  /** 事件域全名（如 'tools/result'） */
  event: string;
  /** 事件载荷（原样保留，schema 由事件源定义） */
  data: Record<string, unknown>;
}

/** 采集的轨迹中判定为失败的最小特征 */
interface FailureSignal {
  /** 归一化失败模式（进错题本的 pattern） */
  pattern: string;
  /** 人类可审读上下文 */
  context: string;
}

/**
 * 订阅的事件域清单（防御式——订阅失败静默跳过该路）。
 * kind 映射：turn → agent 轮次生命周期；tool → 工具执行；fs → 文件写意向。
 */
const TRAJECTORY_EVENT_DOMAINS: ReadonlyArray<{ event: string; kind: TrajectoryRecord['kind'] }> = [
  { event: 'agent/turn-started', kind: 'turn' },
  { event: 'agent/turn-stopping', kind: 'turn' },
  { event: 'agent/turn-stopped', kind: 'turn' },
  { event: 'tools/pre-execute', kind: 'tool' },
  { event: 'tools/result', kind: 'tool' },
  { event: 'fs/write-intent', kind: 'fs' },
];

/** Trajectory 采集器 */
export interface TrajectoryCollector {
  /** Cordis 插件（挂进 ctx 即开始采集） */
  plugin: CordisPlugin;
  /** 内存中的全量轨迹（时间序） */
  records: TrajectoryRecord[];
  /**
   * 落盘 JSONL（reward 样本格式）。
   * @param dataDir 数据目录（落点 <dataDir>/trajectory/<agentId>-<ts>.jsonl）
   * @returns 落盘路径；无记录时不落盘，返回 null
   */
  flush(dataDir: string): string | null;
  /**
   * 失败轨迹 → failure-log（错题本）同步消费。
   * 哪类工具调用链最易翻车 = 结构化负样本（DSH 公开复盘的四起事故即现成语料）。
   * @param dataDir 数据目录
   * @returns 写入条数
   */
  consumeFailure(dataDir: string): number;
}

/** 创建 Trajectory 采集器 */
export function createTrajectoryCollector(opts: { agentId: string }): TrajectoryCollector {
  const agentId = opts.agentId;
  const records: TrajectoryRecord[] = [];

  const plugin: CordisPlugin = (ctx: CordisRuntime) => {
    for (const { event, kind } of TRAJECTORY_EVENT_DOMAINS) {
      try {
        ctx.on(event, (...args: unknown[]) => {
          // 载荷归一化：单参直取，多参打包（事件源 schema 不一，原样保留）
          const data = normalizePayload(args);
          records.push({ ts: new Date().toISOString(), agentId, kind, event, data });
        });
      } catch {
        // 事件域不存在（DSH 正式版与教程命名有出入）——丢该路信号，不影响执行
      }
    }
  };

  return {
    plugin,
    records,
    flush(dataDir: string): string | null {
      if (records.length === 0) return null;
      const dir = join(dataDir, 'trajectory');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const file = join(dir, `${sanitize(agentId)}-${Date.now()}.jsonl`);
      writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
      return file;
    },
    consumeFailure(dataDir: string): number {
      const signals = detectFailureSignals(records);
      for (const s of signals) {
        appendFailure(dataDir, {
          pattern: s.pattern,
          source: 'trajectory',
          context: s.context,
          timestamp: new Date().toISOString(),
        });
      }
      return signals.length;
    },
  };
}

/**
 * 失败轨迹检测（结构化负样本提取）。
 * 判定规则（保守——只录高置信失败，避免污染错题本）：
 * - tools/result 载荷含 error 字段 → 该工具链失败
 * - agent/turn-stopped 无有效产出（output 空 / error 存在）→ 轮次失败
 */
function detectFailureSignals(records: TrajectoryRecord[]): FailureSignal[] {
  const signals: FailureSignal[] = [];
  for (const r of records) {
    if (r.kind === 'tool' && r.event === 'tools/result') {
      const err = extractError(r.data);
      if (err) {
        signals.push({
          pattern: `tool-failure:${r.data.name ?? 'unknown'}`,
          context: `工具 ${String(r.data.name ?? 'unknown')} 执行失败：${err}`,
        });
      }
    }
    if (r.kind === 'turn' && r.event === 'agent/turn-stopped') {
      const err = extractError(r.data);
      const output = r.data.output ?? r.data.result;
      const emptyOutput = output == null || output === '';
      if (err || emptyOutput) {
        signals.push({
          pattern: err ? 'turn-failure:error' : 'turn-failure:empty-output',
          context: err
            ? `轮次异常终止：${err}`
            : '轮次正常结束但零产出（工具链空转——run-01 类负样本）',
        });
      }
    }
  }
  return signals;
}

/** 从任意载荷形状提取 error 文本（防御式） */
function extractError(data: Record<string, unknown>): string | null {
  const err = data.error ?? data.err;
  if (err == null) return null;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(err);
}

/** 载荷归一化：单参直取对象，多参打包为 { args: [...] } */
function normalizePayload(args: unknown[]): Record<string, unknown> {
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    return args[0] as Record<string, unknown>;
  }
  return { args };
}

/** 文件名安全化（agentId 可能含路径不安全字符） */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}
