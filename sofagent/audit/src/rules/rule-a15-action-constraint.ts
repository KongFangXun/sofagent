// ============================================================
// A15 不越约束（扩展层 · 能力拐杖）
// 检查 Agent action 是否在 Workflow 节点声明的 actions 范围内
// evidenceMode: hybrid——需要读 config + diff
// v1.1.4 新增
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import type { AuditContext, RuleCheck } from './types';
import { loadEnvConfig } from '@sofagent/core';
import { getAddedLines } from '@sofagent/core';

/**
 * Workflow 节点的 action 声明
 */
interface WorkflowNodeActions {
  id: string;
  actions?: string[];
  constraints?: Record<string, unknown>;
}

/**
 * 从 workflow.yml 加载节点 action 声明
 */
function loadWorkflowActions(workflowPath: string): Map<string, WorkflowNodeActions> {
  const nodes = new Map<string, WorkflowNodeActions>();
  if (!existsSync(workflowPath)) return nodes;

  try {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = yamlLoad(content) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return nodes;

    const nodesArr = parsed['nodes'] as WorkflowNodeActions[] | undefined;
    if (!Array.isArray(nodesArr)) return nodes;

    for (const node of nodesArr) {
      if (node?.id) {
        nodes.set(node.id, node);
      }
    }
  } catch {
    // workflow.yml 不存在或格式错误——跳过
  }
  return nodes;
}

/**
 * 从代码行中提取可能的 action 名称
 */
function extractActionsFromLines(lines: string[]): string[] {
  const actions: string[] = [];
  // 匹配常见的 action 调用模式
  const actionPatterns = [
    /action\s*[:=]\s*["']?(\w+)["']?/gi,
    /\.(approve|reject|escalate|review|deploy|execute|validate|check)\(/gi,
    /perform\s+["']?(\w+)["']?/gi,
    /do\s+["']?(\w+)["']?/gi,
  ];

  for (const line of lines) {
    for (const pattern of actionPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) {
        if (match[1] && match[1].length > 1) {
          actions.push(match[1].toLowerCase());
        }
      }
    }
  }

  return [...new Set(actions)]; // 去重
}

export function checkRuleA15(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A15 不越约束',
    number: 15,
    status: 'PASS',
    details: [],
    evidenceMode: 'hybrid',
    ruleClass: '能力拐杖',
  };

  const { diffFiles } = ctx;

  // 尝试定位 workflow.yml
  const dataDir = loadEnvConfig().dataDir;
  const workflowPath = join(dataDir, 'orchestrator', 'workflows', 'workflow.yml');
  const workflowNodes = loadWorkflowActions(workflowPath);

  // 无 workflow 配置时跳过
  if (workflowNodes.size === 0) {
    rule.details.push('未找到 workflow.yml 或 nodes 配置，跳过。');
    return rule;
  }

  // 检查哪些节点有声明的 actions
  const nodesWithActions = [...workflowNodes.values()].filter((n) => n.actions && n.actions.length > 0);
  if (nodesWithActions.length === 0) {
    // P2 修复（v1.1.3 发布后审查）：无 actions 声明应 FAIL 而非 WARN，
    // 否则 Agent 可通过"不声明 actions"绕过所有约束检查。
    // 仅当 workflow.yml 存在且有 nodes 但零 actions 声明时触发——
    // 如果 workflow.yml 不存在或无 nodes，上面已跳过。
    rule.status = 'FAIL';
    rule.details.push('workflow.yml 存在 nodes 但均未声明 actions。为防止绕过约束检查，A15 要求每个节点显式声明 allowed actions。请在各节点添加 actions 字段，或删除 workflow.yml。');
    return rule;
  }

  // 收集所有变更行中检测到的 action 调用
  const allActions: string[] = [];
  for (const file of diffFiles) {
    const addedLines = getAddedLines(file);
    const actions = extractActionsFromLines(addedLines);
    allActions.push(...actions);
  }

  if (allActions.length === 0) {
    // 无 action 调用检测到，PASS
    return rule;
  }

  // 构建所有声明的 action 集合
  const allDeclaredActions = new Set<string>();
  for (const node of nodesWithActions) {
    for (const action of (node.actions ?? [])) {
      allDeclaredActions.add(action.toLowerCase());
    }
  }

  // 检查是否有未声明的 action
  const outOfScope: string[] = [];
  for (const action of allActions) {
    if (!allDeclaredActions.has(action)) {
      outOfScope.push(action);
    }
  }

  if (outOfScope.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${outOfScope.length} 个未在 workflow 节点中声明的 action: ${outOfScope.join(', ')}。建议在 workflow.yml 对应节点的 actions 声明中添加。`
    );
  } else {
    rule.details.push(
      `检测到的 ${allActions.length} 个 action 均在 workflow 节点声明的 actions 范围内。`
    );
  }

  return rule;
}
