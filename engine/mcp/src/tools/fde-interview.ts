// ============================================================
// fde-interview.ts · MCP tool：fde_interview（v1.4.2 章八 · 引擎一）
// ============================================================
//
// FDE 访谈结构化落盘——多轮追加 + nodeId 幂等合并 + profile 自动重算
// + fde-audit 留痕。附 action=Prompts 返回五要素追问话术（访谈前引导）。
// 委托 @sofagent/orchestrator fde/fde-workbench.recordInterview。
// ============================================================

import { getDataDir } from '@sofagent/core';
import { join } from 'path';


/** 访谈节点入参（snake_case——MCP 面） */
export interface FdeInterviewNode {
  node_id: string;
  description: string;
  elements: {
    input: string;
    output: string;
    owner: string;
    duration: string;
    bottleneck: string;
  };
  questions: {
    input_automatable: boolean;
    rules_codifiable: boolean;
    output_predictable: boolean;
  };
  depends_on?: string[];
}

export interface FdeInterviewArgs {
  /** 企业标识（fde 工作台分区） */
  enterprise_id: string;
  /** 访谈节点列表（本轮——prompts_only 模式可缺省） */
  nodes?: FdeInterviewNode[];
  /** 只取五要素追问话术（不落盘） */
  prompts_only?: boolean;
}

export interface FdeInterviewToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    /** 访谈落盘路径 */
    interviewPath?: string;
    /** profile 摘要 */
    profile?: Record<string, unknown>;
    /** 追问话术（prompts_only 时返回） */
    prompts?: Array<{ field: string; question: string }>;
  };
}

/**
 * fde_interview——引擎一：访谈结构化落盘。
 * 多轮追加按 nodeId 幂等合并（重访谈覆盖旧记录不重复计数）。
 */
export async function fdeInterviewTool(args: FdeInterviewArgs): Promise<FdeInterviewToolResult> {
  const { enterprise_id } = args;

  const orch = await import('@sofagent/orchestrator');
  const dataDir = getDataDir();

  // 话术模式（访谈前引导——不落盘）
  if (args.prompts_only) {
    const prompts = orch.interviewPrompts();
    return {
      text: [`[sofagent] fde_interview：五要素追问话术`, ...prompts.map((p) => `  · ${p.field}：${p.question}`)].join('\n'),
      data: { isError: false, ok: true, prompts },
    };
  }

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return { text: '[sofagent] fde_interview 失败：enterprise_id 必填且非空', data: { isError: true, ok: false } };
  }
  if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
    return { text: '[sofagent] fde_interview 失败：nodes 必填且非空（或 prompts_only 取话术）', data: { isError: true, ok: false } };
  }

  try {
    const nodes = args.nodes.map((n) => ({
      nodeId: n.node_id,
      description: n.description,
      elements: n.elements,
      questions: {
        inputAutomatable: n.questions.input_automatable,
        rulesCodifiable: n.questions.rules_codifiable,
        outputPredictable: n.questions.output_predictable,
      },
      tag: orch.classifyAutomation({
        inputAutomatable: n.questions.input_automatable,
        rulesCodifiable: n.questions.rules_codifiable,
        outputPredictable: n.questions.output_predictable,
      }),
      dependsOn: n.depends_on ?? [],
    }));

    const record = orch.recordInterview(dataDir, enterprise_id, nodes);

    const lines = [
      `[sofagent] FDE 访谈已落盘 ✅（${enterprise_id}）`,
      `  · 本轮 ${nodes.length} 节点，累计 ${record.profile.nodeCount} 节点`,
      `  · 岗位分布：${record.profile.roles.join(' / ') || '—'}`,
      `  · 高频痛点：${record.profile.painKeywords.join('、') || '—'}`,
      `  · 归档：data/fde/${enterprise_id}/interview.json`,
    ];
    return {
      text: lines.join('\n'),
      data: {
        isError: false,
        ok: true,
        interviewPath: `data/fde/${enterprise_id}/interview.json`,
        profile: record.profile as unknown as Record<string, unknown>,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: `[sofagent] fde_interview 异常：${msg}`, data: { isError: true, ok: false } };
  }
}
