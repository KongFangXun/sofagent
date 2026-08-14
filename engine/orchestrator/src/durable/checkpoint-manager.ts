// ============================================================
// durable/checkpoint-manager.ts · checkpoint 写入/读取/清理（v1.3.4 交付 4 L1）
// ============================================================
//
// 在 graph/checkpoint.ts 的 FileCheckpointer（单文件级原语）之上，
// 提供 Durable Execution L1 需要的**目录级管理**：
//   - 写入：委托 FileCheckpointer.save（原子写 + 锁 + latest 指针，不重造）
//   - 读取：loadLatest / loadFile / list（含 mtime）
//   - 清理：cleanupStale()——默认保留 7 天，可配置（retentionDays）
//
// 消费方：
//   - resume.ts：扫描 checkpoint → 找未完成 graph → 续跑
//   - daemon 启动 / 运维：周期性清理过期 checkpoint
//
// 零新依赖——复用 FileCheckpointer 与 Node.js 内置模块。
// ============================================================

import {
  existsSync,
  readdirSync,
  statSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { FileCheckpointer, type CheckpointRecord } from '../graph/checkpoint';

/** checkpoint 默认保留天数（铁律：默认 7 天可配置） */
export const DEFAULT_CHECKPOINT_RETENTION_DAYS = 7;

/** CheckpointManager 选项 */
export interface CheckpointManagerOptions {
  /** checkpoint 目录（默认 {SOFAGENT_DATA}/checkpoint，与 daemon 共享） */
  checkpointDir: string;
  /** 保留天数（默认 7；<=0 表示永不过期） */
  retentionDays?: number;
}

/** 目录内一个 checkpoint 文件的信息 */
export interface CheckpointFileInfo {
  /** 文件名 */
  fileName: string;
  /** 绝对路径 */
  filePath: string;
  /** 文件 mtime（ISO 8601） */
  mtime: string;
  /** 是否过期（超过保留期） */
  stale: boolean;
}

/**
 * checkpoint 目录管理器——L1 graph 状态恢复的存储层。
 */
export class CheckpointManager {
  /** 底层文件 checkpointer（复用原子写/锁/latest 语义） */
  readonly checkpointer: FileCheckpointer;
  private readonly retentionDays: number;

  constructor(options: CheckpointManagerOptions) {
    this.checkpointer = new FileCheckpointer(options.checkpointDir);
    this.retentionDays = options.retentionDays ?? DEFAULT_CHECKPOINT_RETENTION_DAYS;
  }

  /** checkpoint 目录 */
  get dir(): string {
    return this.checkpointer.dir;
  }

  /**
   * 写入一次 checkpoint 快照（委托 FileCheckpointer.save）。
   * @param state checkpoint 状态（含 checkpointId）
   * @param node 节点名
   * @param phase before / after
   * @returns 落盘文件绝对路径
   */
  write(state: import('../graph/checkpoint').CheckpointState, node: string, phase: 'before' | 'after'): string {
    return this.checkpointer.save(state, node, phase);
  }

  /** 读取最近一次 checkpoint（无则 null） */
  readLatest(): CheckpointRecord | null {
    return this.checkpointer.loadLatest();
  }

  /** 读取指定 checkpoint 文件 */
  readFile(filePath: string): CheckpointRecord | null {
    return this.checkpointer.loadFile(filePath);
  }

  /**
   * 列出目录下全部 checkpoint 文件（含 mtime / 过期标记，按名称升序 = 时间升序）。
   */
  listFiles(): CheckpointFileInfo[] {
    const files = this.checkpointer.list();
    const now = Date.now();
    const cutoff = this.retentionDays > 0 ? now - this.retentionDays * 24 * 60 * 60 * 1000 : 0;
    return files.map((fileName) => {
      const filePath = join(this.dir, fileName);
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(filePath).mtimeMs;
      } catch {
        // 文件可能刚被清理——mtime 缺失按过期处理
      }
      return {
        fileName,
        filePath,
        mtime: new Date(mtimeMs).toISOString(),
        stale: cutoff > 0 && mtimeMs < cutoff,
      };
    });
  }

  /**
   * 清理过期 checkpoint（默认保留 7 天；retentionDays<=0 永不过期）。
   * latest 指向的文件永不清理（正在使用/最近恢复锚点）。
   *
   * @returns 已清理的文件名列表
   */
  cleanupStale(): string[] {
    const latest = this.checkpointer.resolveLatestPath();
    const removed: string[] = [];
    for (const info of this.listFiles()) {
      if (!info.stale) continue;
      // 跳过 latest 指向的文件（恢复锚点）
      if (latest && info.filePath === latest) continue;
      try {
        rmSync(info.filePath, { force: true });
        removed.push(info.fileName);
      } catch {
        // 清理失败不阻断其余
      }
    }
    return removed;
  }
}
