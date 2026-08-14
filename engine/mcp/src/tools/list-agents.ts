// ============================================================
// list-agents.ts · MCP tool：列出已注册的 Agent（v1.3.4 新增）
// ============================================================
//
// 延迟导入 @sofagent/orchestrator 的 listAgents()，
// 列出内置 Agent + 企业已激活的 SubAgent。
//
// 不加 orchestrator 硬依赖到 mcp/package.json——
// 未安装时返回友好错误（与 activate-workflow.ts 模式一致）。
// ============================================================

import { loadEnvConfig } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

export interface ListAgentsResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    agents: Array<{
      name: string;
      type: string;
      description: string;
      hitl?: boolean;
      knowledgeDomain?: string;
      builtin: boolean;
    }>;
    count: number;
    builtinCount: number;
    enterpriseCount: number;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 列出已注册的 Agent（内置 + 企业）
 *
 * 延迟导入 @sofagent/orchestrator 避免循环依赖和启动时加载。
 * MCP 包 optionalDependencies 不含 orchestrator——如果未安装，返回友好错误。
 *
 * @returns 结构化结果（text + data）
 */
export async function listAgentsTool(): Promise<ListAgentsResult> {
  let listAgents: (dataDir: string) => Array<{
    name: string;
    type: string;
    description: string;
    tools: string[];
    systemPrompt: string;
    modelName: string | null;
    mode?: string;
    hitl?: boolean;
    hitlConfig?: { trigger: string; description?: string };
    knowledgeDomain?: string;
  }>;

  try {
    const mod = await import('@sofagent/orchestrator');
    if (typeof mod.listAgents !== 'function') {
      throw new Error('listAgents 不可用');
    }
    listAgents = mod.listAgents;
  } catch {
    return {
      text: '[sofagent] 列出 Agent 失败：@sofagent/orchestrator 未安装或不可用',
      data: {
        agents: [],
        count: 0,
        builtinCount: 0,
        enterpriseCount: 0,
      },
    };
  }

  try {
    const dataDir = loadEnvConfig().dataDir;
    const allAgents = listAgents(dataDir);

    // 区分内置和企业 Agent
    const BUILTIN_NAMES = new Set(['fde', 'auditor', 'engineer', 'reviewer']);
    const agents = allAgents.map((a) => ({
      name: a.name,
      type: a.type,
      description: a.description,
      hitl: a.hitl,
      knowledgeDomain: a.knowledgeDomain,
      builtin: BUILTIN_NAMES.has(a.name),
    }));

    const builtinCount = agents.filter((a) => a.builtin).length;
    const enterpriseCount = agents.length - builtinCount;

    const lines: string[] = [];
    lines.push('[sofagent] 已注册 Agent 列表');
    lines.push(`共 ${agents.length} 个（内置 ${builtinCount} + 企业 ${enterpriseCount}）`);
    lines.push('');

    if (builtinCount > 0) {
      lines.push('内置 Agent:');
      for (const a of agents.filter((a) => a.builtin)) {
        lines.push(`  - ${a.name} (${a.type}): ${a.description}`);
      }
    }

    if (enterpriseCount > 0) {
      lines.push('');
      lines.push('企业 Agent:');
      for (const a of agents.filter((a) => !a.builtin)) {
        const hitlTag = a.hitl ? ' [HITL]' : '';
        const kdTag = a.knowledgeDomain ? ` [${a.knowledgeDomain}]` : '';
        lines.push(`  - ${a.name} (${a.type}): ${a.description}${hitlTag}${kdTag}`);
      }
    }

    return {
      text: lines.join('\n'),
      data: {
        agents,
        count: agents.length,
        builtinCount,
        enterpriseCount,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] 列出 Agent 异常: ${err instanceof Error ? err.message : String(err)}`,
      data: {
        agents: [],
        count: 0,
        builtinCount: 0,
        enterpriseCount: 0,
      },
    };
  }
}
