// ============================================================
// A7 不存盲改（过程层 · 能力拐杖）
// 被修改的文件，修改前是否有 Read 操作记录（检查 data/task/logs/ 目录，v1.4.4 起）
// 违规 → exit code 2
// v0.94：新增 --silent 双路径——无日志 + silent 走 diff 启发式，只 WARN 不 FAIL
// v1.5.2：改用相对路径匹配——消除同名文件误判（src/foo.ts ≠ lib/foo.ts）
// v1.5.0 章八：证据面升级——trace 有无对应读取工具调用优先（harness 独立
//   事件流），logs 读取记录保留兜底（无 trace 时回落旧路径）
// ============================================================
import { getReadAccessMap, loadDshSessionsCached, collectTraceReadSet } from '@sofagent/core';
import type { AuditContext, RuleScan, RuleStatus } from './types';

export function scanA7(ctx: AuditContext): RuleScan {
  const { diffFiles, logEntries } = ctx;
  let status: RuleStatus = 'PASS';
  const details: string[] = [];

  const readFiles = getReadAccessMap(logEntries);
  const modifiedFiles = diffFiles
    .filter((f) => f.status === 'modified' || f.status === 'added')
    .map((f) => f.path);

  // 如果没有需要检查的修改文件（全是 deleted 或 renamed），跳过检查
  if (modifiedFiles.length === 0) {
    return { status, details };
  }

  // silent 模式：无 Agent 日志，不做盲改检查（CI 环境无需此日志依赖规则）
  if (ctx.silent && logEntries.length === 0) {
    status = 'PASS';
    details.push('⚠️ A7 silent: 无 Agent 日志，跳过「不存盲改」检查（CI/非交互环境预期行为）。');
    return { status, details };
  }

  // 如果没有日志记录（可能是新项目或日志被清空），发出提示但不判定违规
  if (logEntries.length === 0) {
    if (ctx.strict) {
      status = 'FAIL';
      details.push('--strict 模式：未找到任务日志，「不存盲改」检查失败。Agent 必须记录操作日志。');
    } else {
      status = 'WARN';
      details.push('未找到 data/task/logs/ 任务记录——可能是首次使用或日志目录为空。跳过「不存盲改」检查。');
    }
    return { status, details };
  }

  /**
   * 使用相对路径精确匹配——避免同名文件误判（src/foo.ts ≠ lib/foo.ts）。
   * readFiles 中的路径可能是相对路径（如 src/foo.ts）或绝对路径（如 /abs/path/src/foo.ts），
   * diffFiles[].path 恒为 git diff 输出的相对路径。匹配时同时检查相等和 endsWith 两种形式。
   */
  function isPathInReadSet(diffPath: string, readSet: Set<string>): boolean {
    for (const rf of readSet) {
      if (rf === diffPath || rf.endsWith('/' + diffPath)) {
        return true;
      }
    }
    return false;
  }

  // ── v1.5.0 章八：trace 证据面（优先）──
  // DSH session 独立事件流中的读取工具调用（read/view/…）——比 Agent
  // 自写 logs 更可信（harness 侧记录）。cwd 对齐仓库根（process.cwd()）。
  // 任何 trace 命中即采信；全部未命中再走 logs 兜底（trace 缺席不降级判定）。
  // SOFAGENT_TRACE_EVIDENCE=off 显式关闭（测试隔离——真实 ~/.dsh 有
  // 936 session，A7 同步路径靠 mtime 缓存控成本，测试默认关）。
  let traceReadSet: Set<string> = new Set();
  if (process.env.SOFAGENT_TRACE_EVIDENCE !== 'off') {
    try {
      const traces = loadDshSessionsCached({ cwdFilter: process.cwd(), limit: 20 });
      traceReadSet = new Set(collectTraceReadSet(traces));
      if (traceReadSet.size > 0) {
        details.push(`A7 trace 证据面：${traces.length} 个 DSH session 命中 cwd，${traceReadSet.size} 个读取路径入证。`);
      }
    } catch {
      // trace 读取失败静默回落 logs 兜底（harness 缺席是常态而非异常）
    }
  }

  const uncheckedFiles: string[] = [];
  for (const path of modifiedFiles) {
    // 第一优先：trace 独立证据面（v1.5.0 章八）
    let found = isPathInReadSet(path, traceReadSet);

    // 第二优先：仅匹配日志中 Read 操作条目（不匹配整篇日志的任意文件名引用）
    if (!found) {
      found = isPathInReadSet(path, readFiles);
    }
    if (!found) {
      for (const entry of logEntries) {
        if (entry.operation !== 'read') continue;
        if (entry.file && (entry.file === path || entry.file.endsWith('/' + path))) {
          found = true;
          break;
        }
      }
    }
    if (!found) {
      uncheckedFiles.push(path);
    }
  }

  if (uncheckedFiles.length > 0) {
    status = 'FAIL';
    details.push(
      `${uncheckedFiles.length} 个文件被修改但无读取记录（trace 与 logs 双源均无）: ${uncheckedFiles.slice(0, 3).join(', ')}${uncheckedFiles.length > 3 ? ` 等 ${uncheckedFiles.length} 个` : ''}`
    );
  } else {
    status = 'PASS';
  }

  return { status, details };
}
