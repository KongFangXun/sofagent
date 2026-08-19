// ============================================================
// orchestrator-tools.ts · MCP tool: sofagent_compose
// v1.3.8: 从 mcp-server.ts 提取
// ============================================================

import { execFileSync } from 'child_process';
import type { ToolResult } from './audit-tools';

// ============================================================
// Tool: sofagent_compose
// ============================================================

export async function compose(args: Record<string, unknown>): Promise<ToolResult> {
  if (typeof args.task !== 'string' || !args.task) {
    return {
      text: '[sofagent] compose 错误: Missing or invalid required argument: task',
      data: { error: 'Missing or invalid required argument: task' },
    };
  }

  const cmd = ['compose', '--task', args.task];
  if (typeof args.agent === 'string' && args.agent) {
    cmd.push('--agent', args.agent);
  }
  if (args.run === true) {
    cmd.push('--run');
  }

  try {
    const result = execFileSync('sofagent-orchestrator', cmd, { encoding: 'utf-8', timeout: 30000 });
    return {
      text: `[sofagent] compose 结果:\n${result}`,
      data: { yaml: result },
    };
  } catch (err) {
    const msg = (err as Error).message;
    return {
      text: `❌ [sofagent] 提示：compose 未完成——底层编排工具报告了问题: ${msg}`,
      data: { error: msg },
    };
  }
}
