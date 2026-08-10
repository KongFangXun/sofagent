// ============================================================
// audit-middleware.mjs · 运行时审计 tool wrapper（v1.3.0 交付 1）
// + 交付 8：运行时审计日志按 git 仓库隔离存储
// + v1.3.1 交付 10：工具审批四模式（allow-with-audit / deny-all /
//   read-only / always-ask）——规则引擎判定通过后增加审批模式判定分支，
//   每次审批决定（放行与拒绝都记）写 approval_decision 审计事件；
//   保守默认拒绝（无审批回调时拒绝一切）；子 Agent 审批继承（模块默认值）。
// + v1.3.1 交付 4 L2：副作用登记簿（Durable Execution 工具幂等性）——
//   wrapTool 在审批放行后、执行原 func 前，按 taskId+action 写一条
//   副作用登记（JSONL append-only，复用 @sofagent/orchestrator 的
//   SideEffectLedger）。默认关闭（不传 opts.sideEffectLedgerPath 时
//   行为零变化）；写失败仅告警不阻断工具执行（容错铁律）。
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
let _orchestrator = null;
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
// v1.3.1 交付 4 L2：副作用登记簿（Durable Execution 工具幂等性）
function orchestrator() {
  if (!_orchestrator) _orchestrator = require('../../engine/orchestrator/dist/index.js');
  return _orchestrator;
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
 * 记录 HITL 决策结果到运行时审计日志（交付 3）。
 *
 * 人工通过 hitl_resolve 决策后（或超时/拒绝时），把该工具的挂起决策归档：
 *   - decision='approve' → status='HITL_APPROVED'（放行）
 *   - decision='reject'  → status='HITL_REJECTED'（拒绝 = 审计 FAIL）
 *   - 超时 → status='HITL_TIMEOUT'（默认按拒绝处理 = 审计 FAIL）
 *
 * @param {object} opts 记录选项
 * @param {string} opts.toolName 工具名
 * @param {string} opts.decision 'approve' | 'reject' | 'timeout'
 * @param {string} [opts.reason] 决策理由
 * @param {string} [opts.cwd] 工作目录
 */
export function recordHitlAudit({ toolName, decision, reason = '', cwd = process.cwd() }) {
  const statusMap = {
    approve: 'HITL_APPROVED',
    reject: 'HITL_REJECTED',
    timeout: 'HITL_TIMEOUT',
  };
  const status = statusMap[decision] ?? 'HITL_UNKNOWN';
  appendRuntimeAuditLog({
    toolName,
    agentName: 'hitl-resolve',
    args_summary: { reason: reason.slice(0, 200) },
    verdict: {
      status,
      ruleName: 'HITL',
      details: [reason || `人工决策: ${decision}`],
    },
    session_id: `hitl-${Date.now()}`,
  }, cwd);
}

// ============================================================
// v1.3.1 交付 10：审批模式——模块默认值（审批继承）
//
// 子 Agent 创建 middleware 不传 opts.approvalMode 时继承模块默认值
// （父 Agent 用 setDefaultApprovalMode 设置）——审批继承。
// 默认 'allow-with-audit' = v1.3.0 行为 + 审计（不破坏既有）。
// ============================================================

let _defaultApprovalMode = 'allow-with-audit';

/**
 * 设置模块级默认审批模式（父 Agent 调用，子 Agent 继承）。
 * @param {'allow-with-audit'|'deny-all'|'read-only'|'always-ask'} mode 审批模式
 */
export function setDefaultApprovalMode(mode) {
  _defaultApprovalMode = mode;
}

/**
 * 读取模块级默认审批模式。
 * @returns {'allow-with-audit'|'deny-all'|'read-only'|'always-ask'} 当前默认模式
 */
export function getDefaultApprovalMode() {
  return _defaultApprovalMode;
}

/**
 * 写一条 approval_decision 审计事件（复用 appendRuntimeAuditLog 通道）。
 *
 * verdict.status = APPROVAL_ALLOWED / APPROVAL_DENIED——放行与拒绝都记录，
 * 审计可回放每一次审批决定。
 *
 * @param {object} p 事件参数
 * @param {string} p.toolName 工具名
 * @param {string} p.agentName Agent 名称
 * @param {string} p.mode 审批模式
 * @param {'r'|'rw'} p.permission 工具权限标记
 * @param {boolean} p.allowed 是否放行
 * @param {string} p.reason 判定理由
 * @param {string} p.sessionId 会话 ID
 * @param {string} [p.cwd] 工作目录
 */
function appendApprovalDecision({ toolName, agentName, mode, permission, allowed, reason, sessionId, cwd }) {
  appendRuntimeAuditLog({
    toolName,
    agentName,
    args_summary: {},
    verdict: {
      status: allowed ? 'APPROVAL_ALLOWED' : 'APPROVAL_DENIED',
      ruleName: 'approval_decision',
      details: [reason],
    },
    approval: { mode, permission, allowed },
    session_id: sessionId,
  }, cwd);
}

/**
 * 创建运行时审计 middleware——返回 { wrapTool, check }。
 *
 * wrapTool(originalFunc, toolName, permission='rw')：包裹工具 func，执行前跑规则引擎检查，
 *   FAIL → 拦截（返回拒绝消息，不执行原 func）；WARN → 放行但记日志；
 *   PASS → 放行，随后进入 v1.3.1 审批模式判定分支。所有判定写运行时审计日志。
 *
 * check(ctx)：独立检查入口（供 loadTools 回调最外层调用）。
 *
 * v1.3.1 交付 10 审批模式：
 *   opts.approvalMode 缺省 → 继承模块默认值（setDefaultApprovalMode，审批继承）；
 *   模块默认初始为 'allow-with-audit'（= v1.3.0 行为 + 审计，不破坏既有）。
 *   opts.approvalCallback 可选人工确认回调 async ({toolName, permission, reason}) => boolean；
 *   read-only 遇 rw 工具 / always-ask 需人工确认——无回调时**保守默认拒绝**（铁律 #7）。
 *   每次审批决定（放行与拒绝）写 approval_decision 审计事件；
 *   拒绝返回合成中止消息「工具调用被拒绝（模式：{mode}）」，不崩溃。
 *
 * @param {object} rulesEngine RulesEngine 实例（来自 @sofagent/rules）
 * @param {object} opts 可选配置 { agentName, taskDesc, cwd, sessionId, emitDecision:boolean,
 *   approvalMode?: 'allow-with-audit'|'deny-all'|'read-only'|'always-ask',
 *   approvalCallback?: ({toolName, permission, reason}) => Promise<boolean>|boolean,
 *   sideEffectLedgerPath?: string|null,   // v1.3.1 交付 4 L2：副作用登记簿路径（不传=不登记）
 *   taskId?: string }                      // v1.3.1 交付 4 L2：登记维度（缺省用 sessionId）
 * @returns {{ wrapTool: Function, check: Function }}
 */
export function createAuditMiddleware(rulesEngine, opts = {}) {
  const agentName = opts.agentName ?? 'unknown';
  const taskDesc = opts.taskDesc ?? '';
  const cwd = opts.cwd ?? process.cwd();
  const sessionId = opts.sessionId ?? `sess-${process.pid}`;
  const emitDecisionEnabled = opts.emitDecision !== false;
  // v1.3.1 交付 10：审批模式——未传时继承模块默认值（审批继承）
  const approvalMode = opts.approvalMode ?? getDefaultApprovalMode();
  const approvalCallback = typeof opts.approvalCallback === 'function' ? opts.approvalCallback : null;
  // v1.3.1 交付 4 L2：副作用登记簿——不传 sideEffectLedgerPath = 不登记（行为零变化）
  const sideEffectLedgerPath = opts.sideEffectLedgerPath ?? null;
  const taskId = opts.taskId ?? sessionId;

  // 副作用登记簿实例（懒加载——仅在提供路径时创建）
  let _ledger = null;
  function ledger() {
    if (!_ledger) {
      const { SideEffectLedger } = orchestrator();
      _ledger = new SideEffectLedger(sideEffectLedgerPath);
    }
    return _ledger;
  }

  /**
   * v1.3.1 交付 4 L2：工具执行前写副作用登记（append-only JSONL）。
   * 容错铁律：登记失败仅告警，绝不阻断工具执行。
   *
   * @param {string} toolName 工具名
   * @param {object} args 工具参数（脱敏摘要后登记）
   */
  function recordSideEffect(toolName, args) {
    if (!sideEffectLedgerPath) return;
    try {
      ledger().record(taskId, `tool.${toolName}`, { args: summarizeArgs(args) });
    } catch (err) {
      console.warn(`[audit-middleware] 副作用登记失败（不影响工具执行）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
    // v1.3.0 (交付 3)：任一规则 requireApproval=true → 挂起人工批准（HITL）
    const requireApproval = verdicts.some((v) => v.requireApproval === true);
    const hitlRule = verdicts.find((v) => v.requireApproval === true);

    // 记运行时审计日志（含 HITL 挂起状态）
    appendRuntimeAuditLog({
      toolName,
      agentName,
      args_summary: summarizeArgs(args),
      verdict: {
        status: requireApproval ? 'HITL_PENDING' : agg.status,
        ruleName: hitlRule?.ruleName ?? agg.ruleName,
        details: hitlRule?.details ?? agg.details,
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
            text: `tool-gate ${requireApproval ? '待人工批准' : agg.status === 'FAIL' ? '拦截' : agg.status === 'WARN' ? '告警' : '放行'} ${toolName}`,
            tags: [toolName],
            confidence: agg.status === 'PASS' ? 'high' : 'med',
            ...((hitlRule?.ruleName ?? agg.ruleName) ? { triggeredRule: hitlRule?.ruleName ?? agg.ruleName } : {}),
          },
        });
      } catch (err) {
        // 决策日志失败不阻断工具执行（与审计日志同容错铁律）
        console.warn(`[audit-middleware] emitDecision 失败（不影响工具执行）: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // HITL 挂起（交付 3）——不真正阻塞，返回待批准消息由 Agent 暂停该动作
    if (requireApproval) {
      return {
        blocked: true,
        status: 'HITL',
        hitlPending: true,
        reason: hitlRule
          ? `[${hitlRule.ruleName}] ${hitlRule.details.join('; ')}`
          : '需要人工批准',
      };
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
   * 包裹工具 func——执行前检查，FAIL 拦截优先，requireApproval 挂起 HITL。
   * 规则引擎判定通过后进入审批模式判定分支（v1.3.1 交付 10）。
   *
   * @param {Function} originalFunc 原始工具函数
   * @param {string} toolName 工具名
   * @param {'r'|'rw'} [permission='rw'] 工具权限标记（只读 'r' / 读写 'rw'，默认 'rw'）
   * @returns {Function} 包裹后的 async 函数
   */
  function wrapTool(originalFunc, toolName, permission = 'rw') {
    return async function (...args) {
      const input = args[0] ?? {};
      const verdict = check(toolName, input);
      if (verdict.hitlPending) {
        // 交付 3：HITL 待批准消息——不真正阻塞（LangGraph tool func 同步返回限制），
        // 返回明确消息让 Agent 暂停该动作，等人工通过 hitl_resolve 决策后重试。
        return `⛔ [HITL 待批准] ${toolName} 需要人工批准：${verdict.reason}。请等待人工通过 hitl_resolve 决策后再重试。`;
      }
      if (verdict.blocked) {
        return `⛔ [Audit 拦截] ${toolName} 被拒绝执行：${verdict.reason}`;
      }

      // ── v1.3.1 交付 10：审批模式判定分支（规则引擎通过后） ──
      const { shouldApprove } = rules();
      const approval = shouldApprove(approvalMode, permission);
      if (!approval.allow) {
        // 需人工确认的场景（read-only 遇 rw / always-ask）
        if (approvalCallback) {
          let humanAllowed = false;
          try {
            humanAllowed = await approvalCallback({ toolName, permission, reason: approval.reason });
          } catch (err) {
            // 回调异常 → 保守拒绝（不放行）
            console.warn(`[audit-middleware] approvalCallback 异常，保守拒绝 ${toolName}: ${err instanceof Error ? err.message : String(err)}`);
            humanAllowed = false;
          }
          if (!humanAllowed) {
            // 人工拒绝（或回调异常）→ 写 APPROVAL_DENIED 审计事件 + 合成中止消息
            appendApprovalDecision({
              toolName, agentName, mode: approvalMode, permission,
              allowed: false, reason: `人工确认拒绝：${approval.reason}`, sessionId, cwd,
            });
            return `工具调用被拒绝（模式：${approvalMode}）`;
          }
          // 人工放行 → 写 APPROVAL_ALLOWED 审计事件后执行
          appendApprovalDecision({
            toolName, agentName, mode: approvalMode, permission,
            allowed: true, reason: `人工确认放行：${approval.reason}`, sessionId, cwd,
          });
          // v1.3.1 交付 4 L2：执行前写副作用登记（幂等查重底座）
          recordSideEffect(toolName, input);
          return await originalFunc(...args);
        }

        // 保守默认拒绝铁律（#7）：需人工确认但 SDK 未传审批回调 → 拒绝一切，不放行
        appendApprovalDecision({
          toolName, agentName, mode: approvalMode, permission,
          allowed: false, reason: `${approval.reason}；未提供审批回调，保守默认拒绝`, sessionId, cwd,
        });
        return `工具调用被拒绝（模式：${approvalMode}）`;
      }

      // 放行（allow-with-audit / read-only 只读）——放行也记 approval_decision
      appendApprovalDecision({
        toolName, agentName, mode: approvalMode, permission,
        allowed: true, reason: approval.reason, sessionId, cwd,
      });
      // v1.3.1 交付 4 L2：执行前写副作用登记（幂等查重底座）
      recordSideEffect(toolName, input);
      return await originalFunc(...args);
    };
  }

  return { wrapTool, check };
}
