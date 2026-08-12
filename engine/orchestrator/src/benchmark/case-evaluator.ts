// ============================================================
// benchmark/case-evaluator.ts · 隔离评测执行（v1.3.3 交付 9）
// ============================================================
//
// PenguinHarness 方法论：
//   - 隔离执行：独立 workspace（mkdtemp），只暴露 statement 不暴露
//     rubric（物理分离——被测 Agent 无法访问 rubric 目录）
//   - 0..100 固定分值：协议化评分，partial credit
//   - **强制 approvalMode:'read-only'**：Test Agent 工具经
//     shouldApprove('read-only', permission) 包裹——rw 工具被拦截，
//     无法写文件/执行命令（交付 10 read-only 模式直接复用）
//   - 四种失败码：invalid_request / benchmark_invalid /
//     version_changed / evaluation_failed
//
// 零新依赖——复用 @sofagent/rules 的 shouldApprove（与 audit-middleware
// 同源原语）。
// ============================================================

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { shouldApprove } from '@sofagent/rules';
import type { ApprovalMode } from '@sofagent/rules';

// ⚠️ 环境修复说明：波次 4 曾因 node_modules/@sofagent/rules 链接到 registry
// 1.2.9（旧版无 approval-mode）本地镜像 read-only 判定；波次 5 npm install
// 重链后 workspace engine/rules@1.3.0 已接入 node_modules，恢复官方 import
// （单一事实源——与 FORGE/audit-middleware 同源 shouldApprove）。

/** 四种失败码 */
export type EvaluationFailureCode =
  | 'invalid_request'      // 入参不合法（缺 benchmarkId/caseId/statement/rubric）
  | 'benchmark_invalid'    // Benchmark 不存在 / 配置解析失败
  | 'version_changed'      // revision 不匹配（Freeze 后题被改过）
  | 'evaluation_failed';   // 评测自身失败（agent 崩溃/超时/workspace 异常）

/** 评测入参 */
export interface EvaluateCaseInput {
  /** Benchmark ID */
  benchmarkId: string;
  /** Case ID */
  caseId: string;
  /** 公开任务描述（只暴露给被测 Agent） */
  statement: string;
  /** 私有评分标准（写入 rubric 目录——不暴露给被测 Agent） */
  rubric: string;
  /** 期望 revision（不匹配 → version_changed；缺省跳过检查） */
  expectedRevision?: number;
  /** 实际 revision（从 benchmark 定义读入） */
  actualRevision?: number;
  /** 超时阈值 ms（默认 120000） */
  timeoutMs?: number;
  /**
   * 被测 Agent 执行函数（可注入 mock——测试不调 LLM）。
   * 接收隔离 workspace + 只读工具集，返回产出文本。
   */
  agentFn?: (ctx: AgentExecutionContext) => Promise<string>;
  /** 评分函数（可注入；默认协议化评分：完成 100 / 异常 0） */
  scoringFn?: (ctx: { output: string; rubric: string; durationMs: number }) => number;
  /** 审批模式（默认强制 'read-only'——Test Agent 只读） */
  approvalMode?: ApprovalMode;
  /** 日志输出 */
  log?: (msg: string) => void;
}

/** 被测 Agent 执行上下文（隔离 workspace + 只读工具） */
export interface AgentExecutionContext {
  /** 独立 workspace 路径（mkdtemp——评测隔离） */
  workspace: string;
  /** 公开 statement（已写入 workspace/statement.md） */
  statement: string;
  /**
   * 只读工具集——每个工具已按 approvalMode（默认 read-only）包裹：
   * 读工具放行，写/执行工具拦截（保守拒绝语义）。
   */
  tools: ReadonlyArray<{
    name: string;
    permission: 'r' | 'rw';
    call: (args: Record<string, unknown>) => string;
  }>;
}

/** 评测结果 */
export interface CaseEvaluation {
  /** Benchmark ID */
  benchmarkId: string;
  /** Case ID */
  caseId: string;
  /** 实际 revision */
  revision: number;
  /** 协议化评分 0..100 */
  score: number;
  /** 失败码（null = 正常完成） */
  failureCode: EvaluationFailureCode | null;
  /** 判定详情（人工可读） */
  details: string[];
  /** 隔离 workspace 路径（评测后清理） */
  workspace: string;
  /** 评测耗时 ms */
  durationMs: number;
}

/** 默认超时阈值 ms */
export const DEFAULT_EVALUATE_TIMEOUT_MS = 120_000;

/** 只读工具集（Test Agent 的受限工具面——read-only 模式） */
const READONLY_TOOLSET: Array<{ name: string; permission: 'r' | 'rw' }> = [
  { name: 'read_file', permission: 'r' },
  { name: 'list_dir', permission: 'r' },
  { name: 'search_knowledge', permission: 'r' },
  { name: 'write_file', permission: 'rw' },
  { name: 'exec_command', permission: 'rw' },
];

/**
 * 构造只读工具调用——经 shouldApprove(approvalMode, permission) 判定。
 * read-only 模式遇 rw 工具 → 拦截（保守拒绝，返回合成消息）。
 */
function makeReadOnlyTools(
  workspace: string,
  approvalMode: ApprovalMode,
  log: (msg: string) => void,
): AgentExecutionContext['tools'] {
  return READONLY_TOOLSET.map((t) => ({
    name: t.name,
    permission: t.permission,
    call: (args) => {
      const approval = shouldApprove(approvalMode, t.permission);
      if (!approval.allow) {
        log(`⛔ [read-only] ${t.name} 被拦截：${approval.reason}`);
        return `工具调用被拒绝（模式：${approvalMode}）——${approval.reason}`;
      }
      // 只读工具的最小实现：read_file 读 workspace 内文件，其余返回提示
      if (t.name === 'read_file' && typeof args.path === 'string') {
        try {
          return readFileSync(join(workspace, args.path), 'utf-8');
        } catch (err) {
          return `读取失败：${err instanceof Error ? err.message : String(err)}`;
        }
      }
      if (t.name === 'list_dir') {
        try {
          return readdirSync(workspace).join('\n');
        } catch (err) {
          return `列目录失败：${err instanceof Error ? err.message : String(err)}`;
        }
      }
      return `[read-only 工具] ${t.name} 放行（只读）。`;
    },
  }));
}

/**
 * 默认协议化评分——0..100 固定分值。
 * 被测 Agent 正常返回产出 → 100（协议完成）；异常/超时 → 0。
 * 语义对错由 rubric + 自定义 scoringFn 承担（本默认值只判协议完成度）。
 */
export function defaultScoringFn(ctx: { output: string; rubric: string; durationMs: number }): number {
  void ctx.rubric;
  const completed = typeof ctx.output === 'string' && ctx.output.length > 0;
  return completed ? 100 : 0;
}

/**
 * 隔离评测一个 Case——强制 read-only + statement/rubric 物理分离。
 *
 * @param input 评测入参
 * @returns CaseEvaluation
 */
export async function evaluateCase(input: EvaluateCaseInput): Promise<CaseEvaluation> {
  const log = input.log ?? (() => {});
  const startedAt = Date.now();
  const approvalMode = input.approvalMode ?? 'read-only'; // 强制 read-only（默认）
  const timeoutMs = input.timeoutMs ?? DEFAULT_EVALUATE_TIMEOUT_MS;
  const scoringFn = input.scoringFn ?? defaultScoringFn;

  const fail = (code: EvaluationFailureCode, detail: string, extra: Partial<CaseEvaluation> = {}): CaseEvaluation => ({
    benchmarkId: input.benchmarkId,
    caseId: input.caseId,
    revision: input.actualRevision ?? 0,
    score: 0,
    failureCode: code,
    details: [detail],
    workspace: '',
    durationMs: Date.now() - startedAt,
    ...extra,
  });

  // ── 失败码 1：invalid_request ──
  if (!input.benchmarkId || !input.caseId || !input.statement || !input.rubric) {
    return fail('invalid_request', '入参不合法：benchmarkId/caseId/statement/rubric 均必填');
  }

  // ── 失败码 2：version_changed（Freeze 后 revision 不匹配）──
  if (input.expectedRevision !== undefined && input.actualRevision !== undefined) {
    if (input.expectedRevision !== input.actualRevision) {
      return fail(
        'version_changed',
        `Benchmark revision 不匹配：期望 ${input.expectedRevision}，实际 ${input.actualRevision}（题被改过？）`,
        { revision: input.actualRevision },
      );
    }
  }

  // ── 隔离执行：独立 workspace，只写 statement（rubric 不落 workspace）──
  let workspace = '';
  let agentOutput = '';
  try {
    workspace = mkdtempSync(join(tmpdir(), 'sofagent-bench-'));
    mkdirSync(workspace, { recursive: true });
    // statement 公开给被测 Agent（物理上在 workspace 内）
    writeFileSync(join(workspace, 'statement.md'), input.statement, 'utf-8');
    // rubric 不写入 workspace——物理分离（被测 Agent 无法访问）

    const agentFn =
      input.agentFn ??
      (async () => {
        throw new Error('agentFn 未注入——评测需要一个被测 Agent 执行函数（测试注入 mock）');
      });

    const ctx: AgentExecutionContext = {
      workspace,
      statement: input.statement,
      tools: makeReadOnlyTools(workspace, approvalMode, log),
    };

    // 超时保护
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
    }, timeoutMs);
    try {
      agentOutput = await agentFn(ctx);
    } finally {
      clearTimeout(timer);
    }
    if (timedOut) {
      return fail('evaluation_failed', `评测超时（>${timeoutMs}ms）`, { workspace, revision: input.actualRevision ?? 0 });
    }
  } catch (err) {
    // ── 失败码 3：evaluation_failed（agent 崩溃 / workspace 异常）──
    const msg = err instanceof Error ? err.message : String(err);
    const result = fail('evaluation_failed', `评测执行失败：${msg}`, {
      ...(workspace ? { workspace } : {}),
      revision: input.actualRevision ?? 0,
    });
    try {
      if (workspace) rmSync(workspace, { recursive: true, force: true });
    } catch { /* 清理失败不阻断 */ }
    return result;
  }

  // ── 协议化评分 0..100 ──
  const score = scoringFn({ output: agentOutput, rubric: input.rubric, durationMs: Date.now() - startedAt });
  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  const result: CaseEvaluation = {
    benchmarkId: input.benchmarkId,
    caseId: input.caseId,
    revision: input.actualRevision ?? 0,
    score: clamped,
    failureCode: null,
    details: [`评测完成 · 评分 ${clamped}/100 · approvalMode=${approvalMode}`],
    workspace,
    durationMs: Date.now() - startedAt,
  };

  // 评测结束清理隔离 workspace（产出已提取，不留垃圾）
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch { /* 清理失败不阻断 */ }

  return result;
}
