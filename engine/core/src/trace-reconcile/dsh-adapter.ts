// ============================================================
// dsh-adapter.ts · DSH session 接入适配器（v1.5.2 章八）
// ============================================================
//
// 读 $DSH_HOME/sessions/（zstd JSONL 事件流），解析为统一 trace 模型。
// 目录结构（2026-09-17 实测 936 个 session）：
//   $DSH_HOME/sessions/<cwd 转义目录>/<session-id>/session.jsonl.zstd
//
// $DSH_HOME 环境变量在仓库代码中本适配器是首个消费方——
// 缺省回退 ~/.dsh/。
//
// zstd 解压：fzstd（纯 JS，零原生依赖）。多 frame 流式文件用
// fzstd.decompress 单次全量（fzstd 原生支持 concatenated frames）。
// decompressFn 可注入——测试隔离不依赖真实压缩格式。
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  type TraceEvent,
  type TraceModelExport,
  type DshRawEvent,
  type FileOpKind,
  TRACE_MODEL_SCHEMA_VERSION,
  extractFilePathFromArgs,
  classifyFileOp,
} from './trace-model';

/** zstd 解压函数签名（fzstd.decompress 兼容——Uint8Array → Uint8Array） */
export type DecompressFn = (input: Uint8Array) => Uint8Array;

/** 缺省解压器——惰性加载 fzstd（可选依赖，缺失时抛清晰错误） */
const defaultDecompress: DecompressFn = (input) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fzstd = require('fzstd') as { decompress: DecompressFn };
  return fzstd.decompress(input);
};

/** DSH sessions 根目录（$DSH_HOME 或 ~/.dsh 回退） */
export function dshSessionsRoot(dshHome?: string): string {
  return join(dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions');
}

/** 单个 DSH session 目录内的轨迹文件名 */
const SESSION_FILE = 'session.jsonl.zstd';

/**
 * 解析单个 DSH session 文件（zstd JSONL）为统一 trace 模型。
 *
 * 事件映射（DSH → 统一模型）：
 *   turn/start|turn/end          → turn
 *   step/start|step/end          → step
 *   tool/call                    → tool-call（+ 文件工具补 file-op 事件）
 *   其余（reasoning-chunks 等）   → 不入模型（对账不消费）
 *
 * @param sessionFile session.jsonl.zstd 绝对路径
 * @param decompressFn 解压注入（缺省 fzstd）
 */
export function parseDshSession(sessionFile: string, decompressFn: DecompressFn = defaultDecompress): TraceModelExport {
  const buf = readFileSync(sessionFile);
  const text = Buffer.from(decompressFn(new Uint8Array(buf))).toString('utf-8');

  const events: TraceEvent[] = [];
  let sessionId = '';
  let cwd: string | undefined;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let raw: DshRawEvent;
    try {
      raw = JSON.parse(trimmed) as DshRawEvent;
    } catch {
      continue; // 坏行跳过（事件流以 seq 单调——不重排）
    }
    const type = raw.type ?? '';
    const ts = typeof raw.time === 'number' ? new Date(raw.time).toISOString() : new Date(0).toISOString();
    const seq = typeof raw.seq === 'number' ? raw.seq : events.length;
    const data = raw.data ?? {};

    if (type === 'session') {
      const id = (raw as { id?: string }).id;
      if (typeof id === 'string') sessionId = id;
      // cwd 在 session 事件顶层（2026-09-17 实测样本核对——不在 data 内）
      const topCwd = (raw as { cwd?: string }).cwd;
      if (typeof topCwd === 'string') cwd = topCwd;
      if (typeof data.cwd === 'string') cwd = data.cwd;
      continue;
    }

    if (type === 'turn/start' || type === 'turn/end') {
      events.push({ type: 'turn', seq, ts, source: 'dsh', sessionId, turn: data.turn });
      continue;
    }
    if (type === 'step/start' || type === 'step/end') {
      events.push({ type: 'step', seq, ts, source: 'dsh', sessionId, turn: data.turn, step: data.step });
      continue;
    }
    if (type === 'tool/call') {
      events.push({
        type: 'tool-call',
        seq,
        ts,
        source: 'dsh',
        sessionId,
        turn: data.turn,
        step: data.step,
        callId: data.callId,
        toolName: data.name,
      });
      // 文件类工具补 file-op 事件（对账证据粒度）
      const fileOp = typeof data.name === 'string' ? classifyFileOp(data.name) : undefined;
      const filePath = extractFilePathFromArgs(data.arguments);
      if (fileOp && filePath) {
        events.push({
          type: 'file-op',
          seq,
          ts,
          source: 'dsh',
          sessionId,
          turn: data.turn,
          step: data.step,
          toolName: data.name,
          filePath,
          fileOp,
        });
      }
      continue;
    }
    // 其余事件类型不入模型（reasoning-chunks/assistant/chunk/…——对账不消费）
  }

  return {
    schemaVersion: TRACE_MODEL_SCHEMA_VERSION,
    source: 'dsh',
    sessionId,
    cwd,
    exportedAt: new Date().toISOString(),
    events,
  };
}

/**
 * 扫描 DSH sessions 根目录，按 cwd 前缀过滤并解析。
 *
 * @param options.dshHome DSH home（缺省 $DSH_HOME / ~/.dsh）
 * @param options.cwdFilter 只保留 session cwd 以此前缀开头的（对账对齐仓库根）
 * @param options.limit 最多解析的 session 数（防大目录全量扫——缺省 50）
 * @param options.decompressFn 解压注入（测试隔离）
 */
export function loadDshSessions(
  options: {
    dshHome?: string;
    cwdFilter?: string;
    limit?: number;
    decompressFn?: DecompressFn;
  } = {},
): TraceModelExport[] {
  const root = dshSessionsRoot(options.dshHome);
  if (!existsSync(root)) return [];

  const results: TraceModelExport[] = [];
  const limit = options.limit ?? 50;

  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const sessionDir of readdirSync(join(root, dir.name), { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) continue;
      const file = join(root, dir.name, sessionDir.name, SESSION_FILE);
      if (!existsSync(file)) continue;
      try {
        const parsed = parseDshSession(file, options.decompressFn);
        if (options.cwdFilter && !(parsed.cwd ?? '').startsWith(options.cwdFilter)) continue;
        results.push(parsed);
        if (results.length >= limit) return results;
      } catch {
        // 单 session 坏文件跳过——不阻断整体扫描
      }
    }
  }
  return results;
}
