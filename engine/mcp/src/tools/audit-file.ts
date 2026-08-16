// ============================================================
// audit-file.ts · MCP tool: audit_file (单文件变更即时审计)
// v1.3.6: 从 audit-tools.ts 提取
// ============================================================

import {
  runRules,
  loadConfig,
} from '@sofagent/audit';
import type { AuditResult } from '@sofagent/audit';
import type { ToolResult, WebhookPushFn } from './audit-tools';

// ============================================================
// Tool: audit_file
// ============================================================

export function auditFile(
  args: Record<string, unknown>,
  webhookPush?: WebhookPushFn,
): ToolResult | { error: string } {
  const path = args.path as string | undefined;
  const changeType = args.change_type as 'create' | 'modify' | 'delete' | undefined;
  const task = args.task as string | undefined;

  if (!path || typeof path !== 'string') {
    return { error: 'Missing or invalid required argument: path' };
  }
  if (!changeType || !['create', 'modify', 'delete'].includes(changeType)) {
    return { error: `Invalid change_type: ${changeType}（必须为 create|modify|delete）` };
  }

  // 构造 DiffFile（change_type 映射到 status）
  const statusMap: Record<'create' | 'modify' | 'delete', 'added' | 'modified' | 'deleted'> = {
    create: 'added',
    modify: 'modified',
    delete: 'deleted',
  };
  const diffFiles = [
    {
      path,
      status: statusMap[changeType],
      lines: [],
    },
  ];

  // 加载配置（三级 fallback，配置损坏降级为 DEFAULT_CONFIG）
  let config;
  try {
    config = loadConfig(undefined, false);
  } catch {
    config = undefined;
  }

  // runRules 返回完整 24 条规则结果，我们只关心 MCP pipe 作用域内的
  const results = runRules(diffFiles, [], task, false, true /* silent */, undefined, config);

  // 过滤 MCP pipe 作用域：A3 / A7 / A11 / A18 (+ A14 当传 task)
  const scopeRuleNumbers = new Set<number>([7, 11, 18]); // A7/A11/A18 始终跑
  if (task) {
    scopeRuleNumbers.add(3);  // A3 需要 task
    scopeRuleNumbers.add(14); // A14 需要 task
  }

  const violations: Array<{ rule: string; severity: string; message: string }> = [];
  let hasWarn = false;
  let hasFail = false;

  for (const rule of results.rules) {
    // 跳过作用域外的规则
    if (!scopeRuleNumbers.has(rule.number)) continue;
    // 跳过 PASS / SKIPPED
    if (rule.status === 'PASS' || rule.status === 'SKIPPED') continue;

    for (const detail of rule.details) {
      violations.push({
        rule: rule.name,
        severity: rule.status,
        message: detail,
      });
    }
    if (rule.status === 'WARN') hasWarn = true;
    if (rule.status === 'FAIL') hasFail = true;
  }

  const status: 'PASS' | 'WARN' | 'FAIL' = hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS';

  // 首行必须带 [sofagent] 前缀（v1.1.2 三层签名铁律）
  const lines: string[] = [];
  lines.push(`[sofagent] audit_file: ${path} (${changeType})`);
  lines.push(`判定: ${status}`);
  if (violations.length > 0) {
    lines.push('');
    for (const v of violations) {
      lines.push(`${v.severity} ${v.rule}: ${v.message}`);
    }
  } else {
    lines.push('[sofagent] ✅ 单文件审计通过');
  }

  // S5 L4: webhook 推送（WARN/FAIL 时触发）
  if (status !== 'PASS' && webhookPush) {
    webhookPush(status, task, results).catch(() => {
      // webhook 推送失败非致命
    });
  }

  return {
    text: lines.join('\n'),
    data: {
      status,
      violations,
      auditEngine: `sofagent-audit`,
      scope: Array.from(scopeRuleNumbers).sort((a, b) => a - b).map((n) => `A${n}`),
    },
    isError: status === 'FAIL',
  };
}
