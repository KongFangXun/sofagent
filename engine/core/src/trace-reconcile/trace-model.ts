// ============================================================
// trace-model.ts · 统一 trace 模型（v1.5.1 章八 · 跨层证据对账）
// ============================================================
//
// 定位：别当摄像头，当法医——吃所有 harness 的轨迹，出同一份判定。
// DSH session JSONL / OpenClaw 事件流各自解析为该统一模型后，
// 对账引擎只面对一种 trace 表示（单一表示原则——与章二渐进加载
// 三层同源纪律一致：不造第二份表示）。
//
// schemaVersion 纪律：本模型导出/对账缓存落盘第一行起带
// schemaVersion——首个破坏性变更出现前不建迁移管道，版本号先埋上。
// ============================================================

/** trace 统一模型 schema 版本（破坏性变更时 bump） */
export const TRACE_MODEL_SCHEMA_VERSION = 'v1' as const;

/** 统一 trace 事件四分类 */
export type TraceEventType = 'turn' | 'step' | 'tool-call' | 'file-op';

/**
 * 文件操作子类——对账核心维度。
 * read/write 是 A7 盲改检测与「漏报/幻觉」判定的证据粒度。
 */
export type FileOpKind = 'read' | 'write' | 'delete' | 'rename' | 'other';

/** 统一 trace 事件（harness 无关） */
export interface TraceEvent {
  /** 事件类型四分类 */
  type: TraceEventType;
  /** 事件序号（源事件流内单调） */
  seq: number;
  /** 事件时间（ISO——源 epoch ms 归一） */
  ts: string;
  /** harness 来源标识（'dsh' / 'openclaw'） */
  source: 'dsh' | 'openclaw';
  /** 所属 session 标识 */
  sessionId: string;
  /** turn 编号（DSH data.turn；无则 undefined） */
  turn?: number;
  /** step 编号（DSH data.step；无则 undefined） */
  step?: number;
  /** tool-call：工具名（read/write/edit/bash…） */
  toolName?: string;
  /** tool-call：调用 ID（DSH callId——与 tool/result 配对） */
  callId?: string;
  /** file-op：文件路径 */
  filePath?: string;
  /** file-op：操作子类 */
  fileOp?: FileOpKind;
}

/** 统一 trace 模型导出（落盘形态——首行 schemaVersion 头） */
export interface TraceModelExport {
  schemaVersion: typeof TRACE_MODEL_SCHEMA_VERSION;
  source: 'dsh' | 'openclaw';
  sessionId: string;
  /** session 工作目录（对账时与 git 仓库根对齐用） */
  cwd?: string;
  exportedAt: string;
  events: TraceEvent[];
}

/** DSH session 事件流原始行（解析前形态——只声明对账消费的字段） */
export interface DshRawEvent {
  type?: string;
  seq?: number;
  time?: number;
  data?: {
    turn?: number;
    step?: number;
    callId?: string;
    name?: string;
    arguments?: string;
    cwd?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * 从 DSH 工具调用参数中提取文件路径。
 * 已知形态：arguments 是 JSON 字符串，file_path / path / files 等键。
 */
export function extractFilePathFromArgs(argsJson: string | undefined): string | undefined {
  if (!argsJson) return undefined;
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const candidates = ['file_path', 'filePath', 'path', 'target_file', 'filename'];
    for (const key of candidates) {
      const v = args[key];
      if (typeof v === 'string' && v.trim() !== '') return v;
    }
    // bash 命令内的重定向目标不解析（噪声大——trace 对账以结构化工具为准）
    return undefined;
  } catch {
    return undefined;
  }
}

/** 工具名 → 文件操作子类映射（DSH/OpenClaw 常见工具面） */
export function classifyFileOp(toolName: string): FileOpKind | undefined {
  const n = toolName.toLowerCase();
  if (n === 'read' || n === 'view' || n === 'cat' || n.startsWith('read_')) return 'read';
  if (n === 'write' || n === 'edit' || n === 'multiedit' || n === 'str_replace' || n === 'notebookedit' || n.startsWith('write_')) return 'write';
  if (n === 'delete' || n === 'rm' || n === 'remove') return 'delete';
  if (n === 'rename' || n === 'mv' || n === 'move') return 'rename';
  // 非文件操作工具（bash/grep/glob/…）不产 file-op 事件
  return undefined;
}
