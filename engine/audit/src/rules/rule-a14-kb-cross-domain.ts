// ============================================================
// A14 知识库越权访问（扩展层 · 能力拐杖）
// 检测 Agent 是否读取了不在当前 Workflow 节点 knowledge-domain 内的页面
// evidenceMode: hybrid——有日志走精确检查，无日志跳过
// v1.3.4 新增
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import type { AuditContext, RuleCheck } from './types';
import type { AuditConfig } from '@sofagent/core';
import { loadEnvConfig } from '@sofagent/core';

/**
 * Workflow 节点的 knowledge-domain 配置
 */
interface WorkflowNode {
  id: string;
  knowledgeDomain?: {
    include?: string[];
    exclude?: string[];
  };
}

/**
 * 尝试加载 workflow.yml 中的 knowledge-domain 配置
 */
function loadWorkflowDomains(workflowPath: string): Map<string, WorkflowNode> {
  const nodes = new Map<string, WorkflowNode>();
  if (!existsSync(workflowPath)) return nodes;

  try {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = yamlLoad(content) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return nodes;

    const nodesArr = parsed['nodes'] as WorkflowNode[] | undefined;
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
 * 检查页面路径是否在节点的 knowledge-domain 内
 */
function isPageAccessible(
  pagePath: string,
  domain: { include?: string[]; exclude?: string[] }
): boolean {
  const exclude = domain.exclude ?? [];
  for (const pattern of exclude) {
    if (matchGlob(pagePath, pattern)) return false;
  }

  const include = domain.include ?? ['*'];
  for (const pattern of include) {
    if (matchGlob(pagePath, pattern)) return true;
  }

  return false;
}

/**
 * 简化 glob 匹配——支持 * 和 ** 通配符
 */
function matchGlob(str: string, pattern: string): boolean {
  // ** 匹配任意路径段（包括 /）
  // * 匹配单层（不含 /）
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE_STAR___/g, '.*');
  return new RegExp(regexStr, 'i').test(str);
}

export function checkRuleA14(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A14 知识库越权',
    number: 14,
    status: 'PASS',
    details: [],
    evidenceMode: 'hybrid',
    ruleClass: '能力拐杖',
  };

  const { logEntries, config } = ctx;

  // 尝试定位 workflow.yml（配置检查不依赖日志）
  const dataDir = loadEnvConfig().dataDir;
  const workflowPath = join(dataDir, 'orchestrator', 'workflows', 'workflow.yml');
  const workflowNodes = loadWorkflowDomains(workflowPath);

  // 无 workflow 配置时跳过
  if (workflowNodes.size === 0) {
    rule.details.push('未找到 workflow.yml，跳过。');
    return rule;
  }

  // 有 nodes 但无任何 knowledgeDomain 配置时跳过
  const hasDomainConfig = [...workflowNodes.values()].some((n) => n.knowledgeDomain);
  if (!hasDomainConfig) {
    rule.details.push('workflow.yml 无 knowledge-domain 配置，跳过。');
    return rule;
  }

  // 检测 include: ['*'] 全放开配置——等同于关闭知识库隔离（配置问题，不依赖日志）
  const wideOpenNodes: string[] = [];
  for (const [nodeId, node] of workflowNodes) {
    if (node.knowledgeDomain?.include) {
      const include = node.knowledgeDomain.include;
      // include 只有 '*' 或 '**' 等通配符 = 全放开
      if (include.length === 1 && (include[0] === '*' || include[0] === '**')) {
        wideOpenNodes.push(nodeId);
      }
    }
  }
  if (wideOpenNodes.length > 0) {
    rule.status = 'WARN';
    rule.details.push(
      `知识库隔离未生效: 节点 ${wideOpenNodes.join(', ')} 的 knowledge-domain include 设为 '*'（全放开），等同于关闭隔离。建议按最小权限原则配置 include 列表。`
    );
    return rule;
  }

  // 无日志时跳过越权检查（hybrid 模式降级）——配置检查已在上方完成
  if (!logEntries || logEntries.length === 0) {
    rule.details.push('无 Agent 日志，跳过知识库越权检查。');
    return rule;
  }

  // 扫描日志中的 knowledge/ 读取记录
  const violations: string[] = [];
  for (const entry of logEntries) {
    const text = `${entry.operation || ''} ${entry.raw || ''}`;
    // 匹配 knowledge/ 路径引用
    const kbMatches = text.match(/knowledge\/(entities|concepts|comparisons|summaries)\/[\w.-]+/gi);
    if (!kbMatches) continue;

    for (const match of kbMatches) {
      const pagePath = match.replace(/^knowledge\//i, '');
      // 检查每个 workflow 节点
      for (const [nodeId, node] of workflowNodes) {
        if (node.knowledgeDomain) {
          if (!isPageAccessible(pagePath, node.knowledgeDomain)) {
            violations.push(`${nodeId} 尝试读取 ${match}（不在 knowledge-domain 内）`);
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    rule.status = 'WARN';
    rule.details.push(
      `知识库越权访问: ${violations.slice(0, 3).join('; ')}${violations.length > 3 ? ` 等 ${violations.length} 处` : ''}。跨域查询有时合理，仅告警。`
    );
    // 设计限制说明
    rule.details.push(
      '注意：A14 是事后审计提醒，不是强制访问控制。Agent 不写日志时此规则不生效。企业场景需配合文件系统权限实现真正的隔离。'
    );
  }

  return rule;
}
