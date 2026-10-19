// ============================================================
// audit-tools.ts · MCP tool: run_audit + 共享类型
// v1.6.0: 从 mcp-server.ts 提取；auditFile 拆至 audit-file.ts
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
// 公共类型（被多个 tool 文件引用）
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
  } catch (err) {
    // 非 git 仓库或无提交记录——正常情况，不报错；留痕可见（commitMsg 取空）
    console.error('[sofagent] git log 取 commitMsg 失败（按空处理，auditRunTool）:', err);
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
  // v1.6.0 C8+L10 对齐 CLI（engine/audit/src/index.ts:1953-1989）：SKIPPED 从逐条详情面**移出**。
  //   改前 `status !== 'PASS'` 把 SKIPPED 一并纳入，被跳过的规则各渲染一行
  //   「FAIL ... critical 层 N 条规则命中 FAIL，跳过后续层规则」——把「未检查」渲染成 FAIL，
  //   与 CLI 终端语义不一致（真实违规 N 条却看起来像 N 红 + M 黄）。现改为：SKIPPED 只在
  //   末尾**汇总一行**（含被跳过的规则码清单，用「本批未检查」而非「跳过」）。
  //   机器可读契约不动：下方 data.triggeredRules/allRules 与各 status 取值一字未改。
  const triggeredRules = results.rules.filter(
    (r: AuditResult['rules'][number]) => r.status !== 'PASS' && r.status !== 'SKIPPED',
  );
  const skippedRules = results.rules.filter((r: AuditResult['rules'][number]) => r.status === 'SKIPPED');
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

  if (triggeredRules.length === 0 && skippedRules.length === 0) {
    lines.push('[sofagent] ✅ 全部审计规则通过。');
  }

  // fail-fast 汇总（对齐 CLI index.ts:1981-1989）：早退未执行项集中一行，逐条行不渲染。
  // 规则码取法与 CLI 一致：`id` 优先（插件/规则集条目），否则 A/E/R 系列编号，无编号回退规则名。
  if (skippedRules.length > 0) {
    const codeOf = (r: AuditResult['rules'][number]) => {
      if (r.id) return r.id;
      if (r.number >= 500) return `R${r.number - 500}`;
      if (r.number >= 200) return `E${r.number - 200}`;
      if (r.number > 0) return `A${r.number}`;
      return r.name;
    };
    const codes = skippedRules.map(codeOf);
    lines.push('');
    lines.push(
      `⏭️ [sofagent] fail-fast：critical 层已有 FAIL，以下 ${skippedRules.length} 条规则本批未检查——`
      + `${codes.join(' ')}`,
    );
    lines.push('   未检查 ≠ 通过：这些规则本次未执行，事后取证不得把本行读成「无问题」（见 docs/LIMITATIONS.md）');
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
