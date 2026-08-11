// ============================================================
// durable/side-effect-ledger.ts · 副作用登记簿（v1.3.2 交付 4 L2）
// ============================================================
//
// 工具幂等性底座：JSONL append-only 登记外部副作用（PR / webhook /
// 飞书消息等**不幂等**操作）。续跑前查重——已登记的动作跳过，
// 未登记的正常执行。
//
// 设计要点：
//   - 维度：taskId + action（铁律：外部副作用必须查重；git 操作天然
//     幂等无需登记——本登记簿只记不幂等动作）
//   - append-only：只追加不修改——审计可完整回放
//   - 内存索引 + 落盘双份：首次读取时构建索引，后续 O(1) 查重；
//     record() 先写盘再更新索引（崩溃不丢登记）
//   - 容错：写盘失败不抛异常（登记簿是辅助幂等，不是事务日志）
//
// 零新依赖——Node.js fs 内置。
// ============================================================

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { loadEnvConfig } from '@sofagent/core';

/** 默认登记簿路径：{dataDir}/durable/side-effect-ledger.jsonl */
export const SIDE_EFFECT_LEDGER_REL = 'durable/side-effect-ledger.jsonl';

/** 登记簿条目 */
export interface SideEffectEntry {
  /** 登记时间（ISO 8601） */
  ts: string;
  /** 任务标识（Durable Execution L2 查重维度） */
  taskId: string;
  /** 动作标识（如 'webhook.send' / 'pr.create' / 'feishu.notify'） */
  action: string;
  /** 幂等键（taskId + action + 可选 meta 摘要）——查重主键 */
  id: string;
  /** 动作摘要（参数脱敏后；可空） */
  detail?: string;
}

/**
 * 计算幂等键——taskId:action 为基本维度（meta 摘要可选扩展）。
 *
 * meta 值序列化：标量用 String，嵌套对象用 JSON.stringify（避免
 * String({}) 退化为 '[object Object]' 导致不同参数误判同键）。
 */
export function sideEffectId(taskId: string, action: string, meta?: Record<string, unknown>): string {
  const base = `${taskId}:${action}`;
  if (!meta || Object.keys(meta).length === 0) return base;
  // 稳定序列化 meta 作为键的一部分（区分同一任务同一动作的不同参数）
  const keys = Object.keys(meta).sort();
  const parts = keys.map((k) => {
    const v = meta[k];
    const str = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k}=${str}`;
  });
  return `${base}?${parts.join('&')}`;
}

/** 解析默认登记簿路径（走 @sofagent/core loadEnvConfig 数据目录） */
export function resolveSideEffectLedgerPath(dataDir?: string, override?: string): string {
  if (override) return override;
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, SIDE_EFFECT_LEDGER_REL);
}

/**
 * 副作用登记簿——append-only JSONL + 内存索引查重。
 *
 * 用法：
 *   const ledger = new SideEffectLedger(ledgerPath);
 *   ledger.record('task-42', 'webhook.send', { url: '...' });  // 执行前登记
 *   ledger.has('task-42', 'webhook.send');                       // 续跑查重 → true
 */
export class SideEffectLedger {
  private readonly filePath: string;
  /** 幂等键 → 条目（内存索引，首次读取构建） */
  private readonly index = new Map<string, SideEffectEntry>();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** 登记簿文件路径 */
  get path(): string {
    return this.filePath;
  }

  /**
   * 读取登记簿（幂等——只读一次，后续用内存索引）。
   * 坏行跳过（进程崩溃可能写了一半）。
   */
  private ensureLoaded(): void {
    if (this.loaded) return;
    if (existsSync(this.filePath)) {
      for (const line of readFileSync(this.filePath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as SideEffectEntry;
          if (entry && typeof entry.id === 'string') {
            this.index.set(entry.id, entry);
          }
        } catch {
          // 跳过坏行
        }
      }
    }
    this.loaded = true;
  }

  /**
   * 登记一次副作用（append-only + 更新内存索引）。
   *
   * 写盘失败不抛异常（登记簿是辅助幂等）——但内存索引仍更新，
   * 保证本次进程内查重有效。
   *
   * @param taskId 任务标识
   * @param action 动作标识（如 'webhook.send'）
   * @param meta 动作摘要（可选，参与幂等键计算）
   * @returns 幂等键
   */
  record(taskId: string, action: string, meta?: Record<string, unknown>): string {
    this.ensureLoaded();
    const id = sideEffectId(taskId, action, meta);
    const entry: SideEffectEntry = {
      ts: new Date().toISOString(),
      taskId,
      action,
      id,
      ...(meta && Object.keys(meta).length > 0 ? { detail: JSON.stringify(meta) } : {}),
    };
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
    } catch {
      // 写盘失败静默——内存索引仍生效（本次进程查重不失效）
    }
    this.index.set(id, entry);
    return id;
  }

  /**
   * 查重：该 taskId+action（+meta）是否已登记。
   * @param taskId 任务标识
   * @param action 动作标识
   * @param meta 动作摘要（可选——与 record 时的 meta 一致才命中）
   * @returns 已登记 = true（续跑应跳过）
   */
  has(taskId: string, action: string, meta?: Record<string, unknown>): boolean {
    this.ensureLoaded();
    return this.index.has(sideEffectId(taskId, action, meta));
  }

  /**
   * 列出某任务的全部登记（审计回放）。
   * @param taskId 任务标识（缺省 = 全部）
   */
  list(taskId?: string): SideEffectEntry[] {
    this.ensureLoaded();
    const entries = [...this.index.values()];
    if (!taskId) return entries;
    return entries.filter((e) => e.taskId === taskId);
  }

  /** 已登记条目数 */
  get size(): number {
    this.ensureLoaded();
    return this.index.size;
  }

  /** 清空内存索引（仅测试用；不删落盘文件） */
  clear(): void {
    this.index.clear();
    this.loaded = false;
  }
}
