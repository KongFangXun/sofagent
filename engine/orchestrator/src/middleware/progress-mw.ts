// ============================================================
// progress-mw.ts · SubAgent 进度遥测 middleware（v1.3.1 · P2b）
// ============================================================
//
// 背景：v1.3.1 ROADMAP 声称 ProgressMiddleware 已交付，实际代码不存在
// （全仓 grep 零命中）。本文件为净新增实现，与 data-sovereignty-mw
// 同目录平铺，为 FDE Dashboard「工作状态栏」提供实时数据源。
//
// 设计要点：
//   1. 写出 data/audit/sub-progress-{role}.jsonl（append-only）
//   2. kind 枚举：node-start / tool-call / llm-heartbeat / node-end
//   3. llm-heartbeat 3s 节流——Dashboard 心跳阈值 5s 黄 / 10s 红，
//      3s 写入保证健康心跳绝不误报
//   4. 遥测是辅助通道：写日志失败静默，绝不 throw 阻断 LOOP 主流程
//   5. 与 DataSovereigntyMiddleware 同一 DI 模式：节点级共享单例 +
//      setLoopProgressMwForTest 测试替换
// ============================================================

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveAuditDir } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

/** 事件种类（对齐架构师定义的 jsonl schema） */
export type ProgressEventKind = 'node-start' | 'tool-call' | 'llm-heartbeat' | 'node-end';

/** SubAgent 角色 */
export type ProgressRole = 'engineer' | 'reviewer' | 'plan' | 'audit' | string;

/**
 * sub-progress-{role}.jsonl 单条记录 schema
 *
 * 示例：
 *   {"timestamp":"2026-07-28T10:00:00.000Z","role":"engineer",
 *    "kind":"tool-call","toolName":"sf_read","target":"src/foo.ts",
 *    "resultSummary":"ok · 142 行","tokenCount":1200}
 */
export interface ProgressEvent {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** SubAgent 角色（决定写出文件名） */
  role: ProgressRole;
  /** 事件种类 */
  kind: ProgressEventKind;
  /** 工具名（kind=tool-call 时存在） */
  toolName?: string;
  /** 工具调用目标：文件路径 / 命令 / 查询串 */
  target?: string;
  /** 结果摘要（人可读，截断 120 字符） */
  resultSummary?: string;
  /** 本事件关联的 token 数（node-end / tool-call 可带） */
  tokenCount?: number;
  /** 当前执行任务名（node-start 时携带，Dashboard 卡片标题） */
  taskName?: string;
  /** 节点执行耗时毫秒（node-end 时携带） */
  durationMs?: number;
  /** 节点执行是否成功（node-end 时携带，统计本轮成功率） */
  success?: boolean;
}

/** heartbeat 节流间隔（毫秒）——主理人决策 3s */
export const HEARTBEAT_THROTTLE_MS = 3000;

// ============================================================
// Middleware
// ============================================================

/**
 * SubAgent 进度遥测 middleware
 *
 * 用法（nodes.ts 接线示例）：
 *   const mw = getLoopProgressMw();
 *   mw.nodeStart('engineer', taskName);
 *   mw.toolCall('engineer', { toolName, target, resultSummary, tokenCount });
 *   mw.heartbeat('engineer');            // 内部 3s 节流
 *   mw.nodeEnd('engineer', { durationMs, success, tokenCount });
 */
export class ProgressMiddleware {
  private readonly auditDir: string;
  /** role → 上次 heartbeat 写入时间（ms epoch），用于 3s 节流 */
  private readonly lastHeartbeatAt = new Map<string, number>();
  /** role → 当前任务名（node-start 记录，供卡片标题兜底） */
  private readonly currentTask = new Map<string, string>();

  constructor(overrideHome?: string) {
    this.auditDir = resolveAuditDir(overrideHome);
  }

  /**
   * 节点开始执行——每次必写
   * @param role SubAgent 角色
   * @param taskName 当前执行任务名（截断 120 字符）
   */
  nodeStart(role: ProgressRole, taskName: string): void {
    this.currentTask.set(role, taskName.slice(0, 120));
    this.append(role, {
      kind: 'node-start',
      taskName: this.currentTask.get(role),
    });
  }

  /**
   * 节点执行结束——每次必写
   * @param role SubAgent 角色
   * @param meta 耗时 / 是否成功 / 本轮 token 数
   */
  nodeEnd(role: ProgressRole, meta: { durationMs?: number; success?: boolean; tokenCount?: number } = {}): void {
    this.append(role, {
      kind: 'node-end',
      taskName: this.currentTask.get(role),
      durationMs: meta.durationMs,
      success: meta.success,
      tokenCount: meta.tokenCount,
    });
  }

  /**
   * 工具调用事件——每次必写
   * @param role SubAgent 角色
   * @param call 工具名 / 目标 / 结果摘要 / token 数
   */
  toolCall(
    role: ProgressRole,
    call: { toolName: string; target?: string; resultSummary?: string; tokenCount?: number },
  ): void {
    this.append(role, {
      kind: 'tool-call',
      toolName: call.toolName,
      target: call.target?.slice(0, 200),
      resultSummary: call.resultSummary?.slice(0, 120),
      tokenCount: call.tokenCount,
    });
  }

  /**
   * LLM 心跳——3s 节流写入。
   * Dashboard 心跳阈值 5s 黄 / 10s 红，3s 写入保证健康心跳绝不误报。
   *
   * @param role SubAgent 角色
   * @param tokenCount 可选：截至目前的累计 token
   * @param now 可选：测试注入当前时间（默认 Date.now()）
   * @returns true=实际写入了；false=被节流跳过
   */
  heartbeat(role: ProgressRole, tokenCount?: number, now: number = Date.now()): boolean {
    const last = this.lastHeartbeatAt.get(role) ?? -Infinity;
    if (now - last < HEARTBEAT_THROTTLE_MS) return false;
    this.lastHeartbeatAt.set(role, now);
    this.append(role, { kind: 'llm-heartbeat', tokenCount });
    return true;
  }

  /** 查询某角色当前任务名（测试 / Dashboard 兜底用） */
  getCurrentTask(role: ProgressRole): string | undefined {
    return this.currentTask.get(role);
  }

  /** 写出路径：data/audit/sub-progress-{role}.jsonl */
  resolveLogPath(role: ProgressRole): string {
    return join(this.auditDir, `sub-progress-${role}.jsonl`);
  }

  // ============================================================
  // 内部：组装记录并落盘（失败静默——遥测绝不阻断业务）
  // ============================================================

  private append(role: ProgressRole, event: Omit<ProgressEvent, 'timestamp' | 'role'>): void {
    try {
      if (!existsSync(this.auditDir)) mkdirSync(this.auditDir, { recursive: true });
      const record: ProgressEvent = {
        timestamp: new Date().toISOString(),
        role,
        ...event,
      };
      appendFileSync(this.resolveLogPath(role), `${JSON.stringify(record)}\n`, 'utf-8');
    } catch {
      // 遥测写入失败静默——不阻塞 LOOP 主流程
    }
  }
}
