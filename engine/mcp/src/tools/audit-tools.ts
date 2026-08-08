// ============================================================
// audit-tools.ts · MCP tools: run_audit / audit_file
// v1.2.9: 从 mcp-server.ts 提取
// ============================================================

import { execFileSync } from 'child_process';
import {
  parseDiff,
  checkLogs,
  runRules,
  loadConfig,
} from '@sofagent/audit';
import { generateThinkEntry } from '@sofagent/think';
import type { AuditResult } from '@sofagent/audit';

// ============================================================
// 公共类型
// ============================================================

export interface ToolResult {
  text: string;
  data: unknown;
  isError?: boolean;
}

export type WebhookPushFn = (verdict: string, task: string | undefined, results: AuditResult) => Promise<void>;

// ============================================================
// Tool: run_audit
// ============================================================

export function runAudit(
  args: Record<string, unknown>,
  webhookPush?: WebhookPushFn,
): ToolResult {
  const diffRange = (args.diff as string) || 'HEAD~1..HEAD';
  const task = args.task as string | undefined;
  const strict = (args.strict as boolean) ?? false;
  const silent = (args.silent as boolean) ?? false;

  // 1. 解析 git diff
  const diffFiles = parseDiff(diffRange);
  if (diffFiles.length === 0) {
    return {
      text: '[sofagent] 没有文件变更，无需审计。',
      data: { exitCode: 0, rules: [], fileCount: 0 },
    };
  }

  // 2. 读取任务日志
  const logEntries = checkLogs();

  // 3. commit message（用于 E2/A5 回退）
  let commitMsg = '';
  try {
    commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf-8' }).trim();
  } catch {
    // 非 git 仓库或无提交记录——正常情况，不报错
  }

  // 4. 加载审计配置
  const config = loadConfig();

  // 5. 运行规则
  const results = runRules(diffFiles, logEntries, task, strict, silent, commitMsg, config);

  // 6. 自动生成 think.md 条目
  try {
    generateThinkEntry(diffFiles, results, task);
  } catch {
    process.stderr.write('[sofagent-mcp] 警告: think.md 反思生成失败，跳过\n');
  }

  // 7. 格式化输出
  const triggeredRules = results.rules.filter((r: AuditResult['rules'][number]) => r.status !== 'PASS');
  const verdict = results.exitCode === 0 ? 'PASS' : results.exitCode === 1 ? 'WARN' : 'FAIL';

  const lines: string[] = [];
  lines.push(`[sofagent] 扫描 ${diffFiles.length} 个变更文件`);
  lines.push(`判定: ${verdict}（exit code ${results.exitCode}）`);
  lines.push('');

  for (const rule of triggeredRules) {
    const icon = rule.status === 'WARN' ? 'WARN' : 'FAIL';
    const classTag = rule.ruleClass === '业务底线' ? '[底线]' : '[拐杖]';
    for (const detail of rule.details) {
      lines.push(`${icon} ${rule.name} ${classTag}: ${detail}`);
    }
  }

  if (triggeredRules.length === 0) {
    lines.push('[sofagent] ✅ 全部审计规则通过。');
  }

  // S5 L4: webhook 推送（WARN/FAIL 时触发，推送失败不阻断审计）
  if (verdict !== 'PASS' && webhookPush) {
    webhookPush(verdict, task, results).catch(() => {
      // webhook 推送失败非致命——静默忽略
    });
  }

  return {
    text: lines.join('\n'),
    data: {
      exitCode: results.exitCode,
      verdict,
      fileCount: diffFiles.length,
      triggeredRules: triggeredRules.map((r: AuditResult['rules'][number]) => ({
        name: r.name,
        status: r.status,
        ruleClass: r.ruleClass,
      })),
      allRules: results.rules.map((r: AuditResult['rules'][number]) => ({
        name: r.name,
        status: r.status,
      })),
    },
    isError: verdict === 'FAIL',
  };
}

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
