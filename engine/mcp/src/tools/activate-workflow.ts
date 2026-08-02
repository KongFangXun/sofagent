// ============================================================
// activate-workflow.ts · MCP tool：激活企业工作流 (v1.2.5 新增)
// ============================================================
//
// 读取 FDE 交付物（workflow.yml + skills/ + entities/），
// 注册企业 SubAgent 到 .sofagent/subagents/*.yml
//
// 委托给 @sofagent/orchestrator 的 activateWorkflow()
// ============================================================

import { loadEnvConfig } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

export interface ActivateWorkflowArgs {
  /** 只预览不真正注册，默认 false */
  dry_run?: boolean;
  /** 只激活指定节点（默认全部） */
  node_filter?: string[];
}

export interface ActivateWorkflowResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    registeredAgents: string[];
    skippedNodes: Array<{ name: string; reason: string }>;
    hitlNodes: string[];
    workflowGraph: string;
    dryRun: boolean;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 激活企业工作流
 *
 * 延迟导入 @sofagent/orchestrator 避免循环依赖和启动时加载。
 * MCP 包 optionalDependencies 不含 orchestrator——如果未安装，返回友好错误。
 *
 * @param args 激活参数
 * @returns 结构化结果（text + data）
 */
export async function activateWorkflowTool(args: ActivateWorkflowArgs): Promise<ActivateWorkflowResult> {
  const dryRun = args.dry_run ?? false;
  const nodeFilter = args.node_filter;

  // 延迟导入——orchestrator 可能未安装
  let activateWorkflow: (opts: {
    dataDir: string;
    dryRun: boolean;
    nodeFilter?: string[];
  }) => Promise<{
    registeredAgents: string[];
    workflowGraph: string;
    skippedNodes: Array<{ name: string; reason: string }>;
    hitlNodes: string[];
  }>;

  try {
    const mod = await import('@sofagent/orchestrator');
    if (typeof mod.activateWorkflow !== 'function') {
      throw new Error('activateWorkflow 不可用');
    }
    activateWorkflow = mod.activateWorkflow;
  } catch {
    return {
      text: '[sofagent] 激活失败：@sofagent/orchestrator 未安装或不可用',
      data: {
        registeredAgents: [],
        skippedNodes: [],
        hitlNodes: [],
        workflowGraph: '',
        dryRun,
      },
    };
  }

  const dataDir = loadEnvConfig().dataDir;

  try {
    const result = await activateWorkflow({ dataDir, dryRun, nodeFilter });

    const lines: string[] = [];
    lines.push(`[sofagent] ${dryRun ? '激活预览（dry-run）' : '激活完成'}`);
    lines.push(`注册了 ${result.registeredAgents.length} 个企业 Agent`);

    if (result.registeredAgents.length > 0) {
      lines.push('');
      for (const name of result.registeredAgents) {
        const hitlTag = result.hitlNodes.includes(name) ? ' [HITL]' : '';
        lines.push(`  - ${name}${hitlTag}`);
      }
    }

    if (result.skippedNodes.length > 0) {
      lines.push('');
      lines.push(`跳过 ${result.skippedNodes.length} 个节点:`);
      for (const s of result.skippedNodes) {
        lines.push(`  - ${s.name}: ${s.reason}`);
      }
    }

    return {
      text: lines.join('\n'),
      data: {
        registeredAgents: result.registeredAgents,
        skippedNodes: result.skippedNodes,
        hitlNodes: result.hitlNodes,
        workflowGraph: result.workflowGraph,
        dryRun,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] 激活失败: ${err instanceof Error ? err.message : String(err)}`,
      data: {
        registeredAgents: [],
        skippedNodes: [],
        hitlNodes: [],
        workflowGraph: '',
        dryRun,
      },
    };
  }
}
