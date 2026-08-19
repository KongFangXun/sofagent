// ============================================================
// durable/wal-writer.ts · Durable Execution L3：WAL 写入器
// v1.3.8 交付三 新增
//
// 事务级 write-ahead log——所有工具调用**先写日志再执行**（类数据库
// 事务机制）。与 L1（graph checkpoint）/L2（side-effect ledger）的分工：
//
//   层  机制                 恢复粒度           版本
//   L1  graph checkpoint     节点级（中断续跑） v1.3.1
//   L2  side-effect ledger   工具级（已执行跳过）v1.3.1
//   L3  WAL（本文件）        事务级（回放/回滚） v1.3.8
//
// 三段事务协议（写前日志——begin 在执行前落盘）：
//   begin(taskId, tool, params, expectedSideEffects)
//     → 执行工具（网关 executor）
//     → 成功 commit(taskId, actualSideEffects)
//     → 失败 abort(taskId, reason)
//
// 每条记录一行 JSON（JSONL，append-only）：
//   {type:'begin'|'commit'|'abort', taskId, tool?, ts, ...}
//
// 崩溃恢复由 wal-recovery.ts 负责（scan 三态 + undo/重跑/告警）。
//
// 写入可靠性：appendFileSync（POSIX < PIPE_BUF 原子）；目录自动创建。
// fsync 策略：本版不做 fsync（同 side-effect-ledger 容错定位——WAL 是
// 恢复辅助层，OS 崩溃丢尾部若干行的代价是「少回滚一次」，可接受；
// 进程崩溃不丢（append 已进 page cache，另一进程可见））。
//
// 零 npm 依赖——Node 内建 fs/path/crypto。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, chmodSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

/** WAL 默认相对路径：{dataDir}/wal.jsonl（changelog v1.3.8 §三） */
export const WAL_REL_PATH = 'wal.jsonl';

/** 记录类型：begin（执行前）/ commit（成功）/ abort（失败） */
export type WalRecordType = 'begin' | 'commit' | 'abort';

/**
 * 副作用描述——begin 时声明「预期副作用」（恢复期判定重跑安全性），
 * commit 时记录「实际副作用」（undo 回滚的操作对象）。
 */
export interface SideEffectSpec {
  /** 动作标识（如 'file.write' / 'pr.create' / 'git.checkout'） */
  action: string;
  /** 幂等标记：true = 同参数重复执行结果一致（恢复期可安全 reExecute） */
  idempotent?: boolean;
  /** 操作对象（文件路径/PR 号/commit SHA 等——undo 函数的输入） */
  target?: string;
  /** 附加描述（脱敏后；恢复报告用） */
  detail?: string;
}

/** WAL 单条记录（JSONL 每行一条） */
export interface WalRecord {
  /** 记录类型 */
  type: WalRecordType;
  /** 事务标识（同一次工具调用 begin/commit/abort 的 taskId 一致） */
  taskId: string;
  /** 工具名（begin 携带；commit/abort 复述便于单行审计） */
  tool?: string;
  /** ISO 8601 时间戳 */
  ts: string;
  /** begin：预期副作用（恢复期判定重跑/跳过） */
  expectedSideEffects?: SideEffectSpec[];
  /** begin：调用参数（恢复期 reExecute 回调的输入——重跑同参） */
  params?: Record<string, unknown>;
  /** commit：实际发生的副作用（undo 回滚依据） */
  actualSideEffects?: SideEffectSpec[];
  /** abort：失败原因 */
  reason?: string;
}

/** 生成事务 ID（taskId 前缀 + 时间基36 + 随机——进程内并发不撞） */
export function newTaskId(prefix = 'wal'): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/**
 * WAL 写入器——append-only JSONL 事务日志。
 *
 * 用法（网关 execute 路径，v1.3.8 §三）：
 *   const wal = new WalWriter(walPath);
 *   const taskId = wal.begin('x', 'write_file', {path}, [{action:'file.write', target:p}]);
 *   try { await exec(); wal.commit(taskId, [{action:'file.write', target:p}]); }
 *   catch (e) { wal.abort(taskId, String(e)); throw e; }
 *
 * begin 的返回值即 taskId（原样传给 commit/abort）。
 */
export class WalWriter {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** WAL 文件路径 */
  get path(): string {
    return this.filePath;
  }

  /**
   * 事务开始——执行前落盘（write-ahead 语义的核心：崩溃后恢复器能
   * 看到「打算执行什么」，从而回滚已发生的部分副作用或安全重跑）。
   *
   * @param taskId 事务标识（缺省自动生成）
   * @param tool 工具名
   * @param params 调用参数（恢复期重跑输入）
   * @param expectedSideEffects 预期副作用清单（含幂等标记）
   * @returns taskId（传给后续 commit/abort）
   */
  begin(
    taskId: string,
    tool: string,
    params: Record<string, unknown>,
    expectedSideEffects: SideEffectSpec[] = [],
  ): string {
    this.append({
      type: 'begin',
      taskId,
      tool,
      ts: new Date().toISOString(),
      expectedSideEffects,
      params,
    });
    return taskId;
  }

  /**
   * 事务提交——执行成功后落盘实际副作用（undo 回滚的操作对象）。
   */
  commit(taskId: string, actualSideEffects: SideEffectSpec[] = []): void {
    this.append({
      type: 'commit',
      taskId,
      ts: new Date().toISOString(),
      actualSideEffects,
    });
  }

  /**
   * 事务中止——执行失败后落盘原因。恢复器对 aborted 事务调 undo
   * 回滚 begin 中声明的预期副作用（可能已部分发生）。
   */
  abort(taskId: string, reason: string): void {
    this.append({
      type: 'abort',
      taskId,
      ts: new Date().toISOString(),
      reason,
    });
  }

  /** 追加一行（自动建目录；O_APPEND 短行 POSIX 原子） */
  private append(record: WalRecord): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      // 行完整性防御：文件末尾不是换行（崩溃半行 / 外部编辑）时先补换行，
      // 否则本条 JSON 会拼进坏行一起报废（读侧坏行跳过会丢两条记录）
      if (existsSync(this.filePath) && statSync(this.filePath).isFile()) {
        const content = readFileSync(this.filePath, 'utf-8');
        if (content.length > 0 && !content.endsWith('\n')) {
          appendFileSync(this.filePath, '\n', 'utf-8');
        }
      }
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf-8');
      // 每次写入后收紧权限（0600——WAL 含 params，可能与审计同级的敏感面）
      this.chmod0600();
    } catch (err) {
      // WAL 是恢复辅助层：写失败不阻断业务执行（同 side-effect-ledger
      // 容错定位），但必须醒目告警——静默失效会让恢复器以为没有事务。
      console.error(
        `[wal-writer] WAL 写入失败（恢复能力降级，本次事务不落盘）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 收紧文件权限 0600（文件已存在但权限宽松时兜底；失败不阻断） */
  private chmod0600(): void {
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).isFile()) {
        chmodSync(this.filePath, 0o600);
      }
    } catch {
      /* chmod 失败不阻断——WAL 主要威胁面是同机他用户读取，尽力收紧 */
    }
  }

  /** 读回全部记录（恢复器/测试用；坏行跳过——崩溃可能写半行） */
  readAll(): WalRecord[] {
    if (!existsSync(this.filePath)) return [];
    const out: WalRecord[] = [];
    const content = readFileSync(this.filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed) as WalRecord;
        if (rec && typeof rec.taskId === 'string' && (rec.type === 'begin' || rec.type === 'commit' || rec.type === 'abort')) {
          out.push(rec);
        }
      } catch {
        // 坏行跳过（append 前置换行补丁已把新记录与坏行隔断——坏行只丢自己）
      }
    }
    return out;
  }
}
