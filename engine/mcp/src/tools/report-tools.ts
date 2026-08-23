// ============================================================
// report-tools.ts · MCP tool: list_capabilities
// v1.4.0: 从 mcp-server.ts 提取
// ============================================================

import type { ToolResult } from './audit-tools';
import { VERSION } from '@sofagent/audit';

// ============================================================
// Tool: list_capabilities
// ============================================================

export function listCapabilities(): ToolResult {
  const capabilities = {
    tools: [
      { name: 'run_audit', description: '对 git diff 跑全量审计规则（24 条）' },
      { name: 'get_think', description: '读取 think.md 最近 N 条反思条目' },
      { name: 'write_think', description: '向 think.md 追加反思记录' },
      { name: 'sofagent_compose', description: '编排引擎——产出 Sub Agent 编排方案 YAML' },
      { name: 'audit_file', description: '单文件变更即时审计（A3/A7/A11/A18 + 可选 A14）' },
      { name: 'search_knowledge', description: '跨 entities/concepts 模糊搜索' },
      { name: 'read_entity', description: '读单个 entity 页' },
      { name: 'read_concept', description: '读单个 concept 页' },
      { name: 'list_entities', description: '列出所有 entity（可选 domain 过滤）' },
      { name: 'read_lessons', description: '读 lessons-missteps.md' },
      { name: 'read_think_md', description: '读 think.md 完整内容（含 [sofagent] 前缀）' },
      { name: 'stats', description: 'knowledge 库统计' },
      { name: 'list_capabilities', description: '返回本能力清单' },
      { name: 'data_sovereignty_report', description: '查询数据主权审计报告摘要（today/yesterday/YYYY-MM-DD）' },
      { name: 'create_entity', description: '创建/更新 entity（含 D1-D5 数据审计）' },
      { name: 'create_concept', description: '创建/更新 concept（含 D1-D5 数据审计）' },
      { name: 'validate_ontology', description: '本体结构完整性校验' },
      { name: 'evaluate_output', description: '用 golden set 评估 Agent 产出质量' },
      { name: 'optimize_skill', description: '优化 Skill 文件（skillopt 引擎）' },
      { name: 'health_check', description: '环境健康检查（doctor/verify）' },
      { name: 'audit_data_change', description: '数据变更审计（D1-D5 规则）' },
      { name: 'notify_session', description: '审计结果汇报（预格式化 [sofagent] 返回）' },
      { name: 'activate_workflow', description: '激活 FDE 交付物，注册企业 SubAgent' },
      { name: 'daemon_status', description: '查询 daemon 运行状态（只读）' },
      { name: 'list_agents', description: '列出已注册 Agent（内置 + 企业）' },
      { name: 'list_concepts', description: '列出 knowledge/concepts/ 下所有 concept' },
      { name: 'hitl_resolve', description: 'HITL 异步决议——提交决策触发 LOOP 恢复' },
    ],
    resources: [
      { uri: 'think://latest', description: 'think.md 最后一条条目' },
      { uri: 'logs://today', description: '今日任务日志' },
      { uri: 'audit://last-report', description: '最近一次审计报告' },
      { uri: 'orchestrator://latest-comparison', description: '最新 A/B 对比报告' },
    ],
    auditEngine: `sofagent-audit v${VERSION}`,
    rulesCount: 24,
  };
  const lines: string[] = ['[sofagent] 能力清单:', ''];
  lines.push('Tools:');
  for (const t of capabilities.tools) lines.push(`  - ${t.name}: ${t.description}`);
  lines.push('');
  lines.push('Resources:');
  for (const r of capabilities.resources) lines.push(`  - ${r.uri}: ${r.description}`);
  lines.push('');
  lines.push(`Audit engine: ${capabilities.auditEngine} (${capabilities.rulesCount} 条规则)`);
  return {
    text: lines.join('\n'),
    data: capabilities,
  };
}
