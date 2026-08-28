// ============================================================
// acceptance.ts · MCP tool：define_acceptance / check_acceptance（v1.3.7 交付⑨）
// ============================================================
//
// 验收 MCP tool 先行版——收敛鸿沟的直接解。任务创建时附机器可判定
// 的验收条件（define_acceptance），修改后跑验收返回结构化结果
// （check_acceptance）。四类条件复用 Benchmark 判定引擎结构：
//   test / build / grep-absent / schema
//
// 定位：通用 MCP tool（任何宿主可调）。DSH Agent 经 v1.3.5 MCP 互通
// 获得软约束版验收（Agent 主动调用，prompt 引导）；v1.4.0 cordis-plugin
// 升级为硬门禁。本版为软约束先行。
// ============================================================

import { join } from 'path';
import { getDataDir } from '@sofagent/core';

// ============================================================
// define_acceptance
// ============================================================

export interface DefineAcceptanceArgs {
  /** 任务标识（同一 taskId 重复定义 = 覆盖更新） */
  task_id: string;
  /** 验收条件列表（至少一条，机器可判定） */
  criteria: Array<Record<string, unknown>>;
  /** 备注（验收意图说明，审计可读） */
  notes?: string;
}

export interface DefineAcceptanceResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    task_id?: string;
    /** 已登记的验收条件数 */
    criteriaCount?: number;
  };
}

export async function defineAcceptance(args: DefineAcceptanceArgs): Promise<DefineAcceptanceResult> {
  const { task_id, criteria, notes } = args;

  if (typeof task_id !== 'string' || task_id.trim() === '') {
    return {
      text: '[sofagent] define_acceptance 失败：task_id 必填且非空',
      data: { isError: true, ok: false, issues: ['task_id 必填且非空'] },
    };
  }
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return {
      text: '[sofagent] define_acceptance 失败：criteria 必填且至少一条',
      data: { isError: true, ok: false, issues: ['criteria 必填且至少一条'], task_id },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const def = orch.validateAcceptanceDefinition({ taskId: task_id, criteria, ...(notes ? { notes } : {}) });
    const dataDir = getDataDir();
    orch.saveAcceptanceDefinition(dataDir, def);

    // decision-log 留痕（对齐 train_budget / model_register 审计模式）
    try {
      const audit = (await import('@sofagent/audit')) as unknown as {
        emitDecision: (input: Record<string, unknown>) => unknown;
      };
      audit.emitDecision({
        agentId: 'sofagent-mcp-acceptance',
        sessionId: `define-acceptance-${task_id}`,
        kind: 'SPEC_CHANGE',
        moment: 'INDUC',
        // v1.3.6 交付⑮：选定这些条件作为验收标准 = 方案选择（判断时刻分类 select）
        category: 'select',
        why: `定义验收条件：任务 ${task_id} 附 ${def.criteria.length} 条机器可判定条件（${def.criteria.map((c) => c.type).join(', ')}）`,
        evidence: [`task=${task_id}`, `criteria=${def.criteria.length}`],
      });
    } catch {
      // 留痕降级不阻塞
    }

    return {
      text: `[sofagent] 已为任务 ${task_id} 登记 ${def.criteria.length} 条验收条件 ✅（check_acceptance 可执行）`,
      data: { isError: false, ok: true, issues: [], task_id, criteriaCount: def.criteria.length },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] define_acceptance 失败：${msg}`,
      data: { isError: true, ok: false, issues: [msg], task_id },
    };
  }
}

// ============================================================
// check_acceptance
// ============================================================

export interface CheckAcceptanceArgs {
  /** 任务标识 */
  task_id: string;
  /** 项目根（验收命令执行工作目录；缺省 cwd） */
  project_root?: string;
}

export interface CheckAcceptanceResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    task_id?: string;
    /** 验收是否全部通过（taskId 未定义时 false） */
    accepted?: boolean;
    /** 是否未定义（区别于「定义了但失败」） */
    notDefined?: boolean;
    /** 各条件执行结果 */
    results?: Array<{ type: string; pass: boolean; detail: string }>;
    /** 未通过条件数 */
    failedCount?: number;
  };
}

export async function checkAcceptance(args: CheckAcceptanceArgs): Promise<CheckAcceptanceResult> {
  const { task_id, project_root } = args;

  if (typeof task_id !== 'string' || task_id.trim() === '') {
    return {
      text: '[sofagent] check_acceptance 失败：task_id 必填且非空',
      data: { isError: true, ok: false, issues: ['task_id 必填且非空'] },
    };
  }

  try {
    const orch = await import('@sofagent/orchestrator');
    const dataDir = getDataDir();
    const root = project_root ?? process.cwd();
    const check = orch.checkAcceptance(dataDir, task_id, root);

    // 未定义
    if (check.failedCount === -1) {
      return {
        text: `[sofagent] check_acceptance：任务 ${task_id} 尚未定义验收条件（先调 define_acceptance）`,
        data: { isError: true, ok: false, issues: ['任务未定义验收条件'], task_id, accepted: false, notDefined: true },
      };
    }

    const results = check.results.map((r) => ({ type: r.criterion.type, pass: r.pass, detail: r.detail }));

    // decision-log 留痕（验收结果是决策事件）
    try {
      const audit = (await import('@sofagent/audit')) as unknown as {
        emitDecision: (input: Record<string, unknown>) => unknown;
      };
      audit.emitDecision({
        agentId: 'sofagent-mcp-acceptance',
        sessionId: `check-acceptance-${task_id}`,
        kind: 'TOOL_GATE',
        moment: 'ACT',
        why: check.ok
          ? `验收通过：任务 ${task_id} 全部 ${check.results.length} 条条件满足`
          : `验收未通过：任务 ${task_id} 有 ${check.failedCount}/${check.results.length} 条条件失败`,
        evidence: [`task=${task_id}`, `passed=${check.results.length - check.failedCount}/${check.results.length}`],
      });
    } catch {
      // 留痕降级不阻塞
    }

    if (check.ok) {
      return {
        text: `[sofagent] 验收通过 ✅：任务 ${task_id} 全部 ${check.results.length} 条条件满足`,
        data: { isError: false, ok: true, issues: [], task_id, accepted: true, results, failedCount: 0 },
      };
    }

    const failedDetails = results.filter((r) => !r.pass).map((r) => r.detail);
    return {
      text: `[sofagent] 验收未通过 ❌：任务 ${task_id} 有 ${check.failedCount}/${check.results.length} 条条件失败`,
      data: { isError: true, ok: true, issues: failedDetails, task_id, accepted: false, results, failedCount: check.failedCount },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] check_acceptance 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg], task_id },
    };
  }
}
