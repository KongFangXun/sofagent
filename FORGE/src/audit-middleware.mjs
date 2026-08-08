// ============================================================
// audit-middleware.mjs · 运行时审计 tool wrapper（v1.3.0 交付 1）
// + 交付 8：运行时审计日志按 git 仓库隔离存储
// ============================================================
//
// 定位：在 createReactAgent 的 tools 上包一层 tool wrapper（对标
// progressMw.wrapToolCall 模式），把 tool-gate 规则从静态 gate 升级为
// 运行时动态拦截 + 审计日志留证。
//
// ⚠️ 技术约束（已验证）：@langchain/langgraph v1.4.7 的 createReactAgent
// 不支持 middleware 参数——采用 tool wrapper 模式（包裹工具 func），
// 不引入新依赖。
//
// 审计日志存储：
//   data/audit/runtime/<repo-hash>/runtime-audit.jsonl
//   - repo-hash = git rev-parse --show-toplevel 的 sha256 前 12 位
//   - 非 git 目录 fallback：'nogit-' + hash(process.cwd())
//   - 路径解析走 @sofagent/core resolveDataDir()，不硬编码 ~/.sofagent/data/
//
// 容错铁律（与 progress-middleware 一致）：middleware 自身任何异常
// （磁盘写失败等）不得阻断 worker 主流程——观测失败仅告警。
// ============================================================

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';

// CJS interop——dist 产物是 CommonJS，.mjs 里用 createRequire 导入
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 懒加载——避免模块加载期就 require 未 build 的 dist 导致 MODULE_NOT_FOUND
let _core = null;
let _audit = null;
let _rules = null;
function core() {
  if (!_core) _core = require('../../engine/core/dist/index.js');
  return _core;
}
function audit() {
  if (!_audit) _audit = require('../../engine/audit/dist/public-api.js');
  return _audit;
}
function rules() {
  if (!_rules) _rules = require('../../engine/rules/dist/index.js');
  return _rules;
}

/**
 * 计算 git 仓库标识 hash——用于运行时审计日志按仓库隔离（交付 8）。
 *
 * 优先 `git rev-parse --show-toplevel`（仓库根路径），sha256 前 12 位；
 * 非 git 目录回退 `'nogit-' + hash(process.cwd())`——避免所有非 git 运行
 * 混到同一个目录。
 *
 * @param {string} cwd 工作目录（默认 process.cwd()）
 * @returns {string} 仓库标识 hash
 */
export function computeRepoHash(cwd = process.cwd()) {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    if (root) {
      return createHash('sha256').update(root).digest('hex').slice(0, 12);
    }
  } catch {
    // git 不可用 / 非 git 目录——fallback
  }
  return 'nogit-' + createHash('sha256').update(cwd).digest('hex').slice(0, 12);
}

/**
 * 解析运行时审计日志路径：data/audit/runtime/<repo-hash>/runtime-audit.jsonl
 *
 * 走 @sofagent/core resolveDataDir()（SOFAGENT_HOME 可被环境变量覆盖），
 * 不硬编码 ~/.sofagent/data/。
 *
 * @param {string} [cwd] 工作目录（默认 process.cwd()）
 * @returns {string} 日志文件绝对路径
 */
export function resolveRuntimeAuditPath(cwd = process.cwd()) {
  const dataDir = core().resolveDataDir();
  const repoHash = computeRepoHash(cwd);
  return join(dataDir, 'audit', 'runtime', repoHash, 'runtime-audit.jsonl');
}

/**
 * 追加一条运行时审计日志（append-only JSONL）。
 *
 * 记录：{ ts, toolName, agentName, args_summary, verdict, session_id }
 * args_summary 为参数脱敏摘要（截断 + 不记录 content/command 等大字段原文）。
 *
 * 容错：写入失败仅 console.warn，绝不阻断工具执行。
 *
 * @param {object} record 日志记录（不含 ts——自动补）
 * @param {string} [cwd] 工作目录（默认 process.cwd()）
 */
export function appendRuntimeAuditLog(record, cwd = process.cwd()) {
  try {
    const filePath = resolveRuntimeAuditPath(cwd);
    mkdirSync(join(filePath, '..'), { recursive: true, mode: 0o700 });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...record,
    });
    core().atomicAppendSync(filePath, line);
    // 权限收紧 0o600
    try {
      const { chmodSync } = require('fs');
      chmodSync(filePath, 0o600);
    } catch { /* 权限设置失败不阻断 */ }
  } catch (err) {
    console.warn(`[audit-middleware] 运行时审计日志写入失败（不影响工具执行）: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 生成参数摘要——截断 + 跳过 content/command 等大字段，防止审计日志携带敏感原文。
 *
 * @param {object} args 工具调用参数
 * @returns {object} 摘要对象
 */
function summarizeArgs(args) {
  const SKIP_KEYS = /content|command|instruction|code|text|input|prompt|patch|diff/i;
  const out = {};
  if (!args || typeof args !== 'object') return out;
  for (const [key, value] of Object.entries(args)) {
    if (SKIP_KEYS.test(key)) {
      out[key] = '<redacted>';
      continue;
    }
    if (typeof value === 'string') {
      out[key] = value.length > 200 ? value.slice(0, 200) + '…' : value;
    } else if (value !== null && typeof value === 'object') {
      out[key] = '<object>';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 创建运行时审计 middleware——返回 { wrapTool, check }。
 *
 * wrapTool(originalFunc, toolName)：包裹工具 func，执行前跑规则引擎检查，
 *   FAIL → 拦截（返回拒绝消息，不执行原 func）；WARN → 放行但记日志；
 *   PASS → 放行。所有判定写运行时审计日志。
 *
 * check(ctx)：独立检查入口（供 loadTools 回调最外层调用）。
 *
 * @param {object} rulesEngine RulesEngine 实例（来自 @sofagent/rules）
 * @param {object} opts 可选配置 { agentName, taskDesc, cwd, sessionId, emitDecision:boolean }
 * @returns {{ wrapTool: Function, check: Function }}
 */
export function createAuditMiddleware(rulesEngine, opts = {}) {
  const agentName = opts.agentName ?? 'unknown';
  const taskDesc = opts.taskDesc ?? '';
  const cwd = opts.cwd ?? process.cwd();
  const sessionId = opts.sessionId ?? `sess-${process.pid}`;
  const emitDecisionEnabled = opts.emitDecision !== false;

  /**
   * 执行规则检查 + 记日志 + 返回判定。
   *
   * @param {string} toolName 工具名
   * @param {object} args 工具参数
   * @returns {{ blocked: boolean, reason?: string, status: string }}
   */
  function check(toolName, args) {
    const { RulesEngine } = rules();
    // 兼容传入 RulesEngine 实例或裸规则数组
    const engine = rulesEngine instanceof RulesEngine
      ? rulesEngine
      : new RulesEngine(rulesEngine);

    const ctx = {
      toolName,
      args: args ?? {},
      agentName,
      taskDesc,
      cwd,
    };
    const verdicts = engine.check(ctx);
    const agg = engine.aggregate(verdicts);

    // 记运行时审计日志
    appendRuntimeAuditLog({
      toolName,
      agentName,
      args_summary: summarizeArgs(args),
      verdict: {
        status: agg.status,
        ruleName: agg.ruleName,
        details: agg.details,
      },
      session_id: sessionId,
    }, cwd);

    // 决策日志（交付 6 T03 联动）——TOOL_GATE 决策留证
    if (emitDecisionEnabled) {
      try {
        audit().emitDecision({
          agentId: agentName,
          sessionId,
          kind: 'TOOL_GATE',
          moment: 'ACT',
          why: {
            text: `tool-gate ${agg.status === 'FAIL' ? '拦截' : agg.status === 'WARN' ? '告警' : '放行'} ${toolName}`,
            tags: [toolName],
            confidence: agg.status === 'PASS' ? 'high' : 'med',
            ...(agg.ruleName ? { triggeredRule: agg.ruleName } : {}),
          },
        });
      } catch (err) {
        // 决策日志失败不阻断工具执行（与审计日志同容错铁律）
        console.warn(`[audit-middleware] emitDecision 失败（不影响工具执行）: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (agg.status === 'FAIL') {
      return {
        blocked: true,
        status: 'FAIL',
        reason: `[${agg.ruleName}] ${agg.details.join('; ')} — ${agg.suggestion}`,
      };
    }
    if (agg.status === 'WARN') {
      return {
        blocked: false,
        status: 'WARN',
        reason: agg.details.length > 0 ? `[${agg.ruleName}] ${agg.details.join('; ')}` : undefined,
      };
    }
    return { blocked: false, status: 'PASS' };
  }

  /**
   * 包裹工具 func——执行前检查，FAIL 拦截优先。
   *
   * @param {Function} originalFunc 原始工具函数
   * @param {string} toolName 工具名
   * @returns {Function} 包裹后的 async 函数
   */
  function wrapTool(originalFunc, toolName) {
    return async function (...args) {
      const input = args[0] ?? {};
      const verdict = check(toolName, input);
      if (verdict.blocked) {
        return `⛔ [Audit 拦截] ${toolName} 被拒绝执行：${verdict.reason}`;
      }
      return await originalFunc(...args);
    };
  }

  return { wrapTool, check };
}
