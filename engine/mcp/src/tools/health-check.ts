// ============================================================
// tools/health-check.ts · health_check MCP tool（v1.2.4 · P3 S2）
// ============================================================

import { runDoctor, runAllChecks } from '@sofagent/core';

export interface HealthCheckArgs {
  mode?: 'doctor' | 'verify';
  platform?: string;
}

export function healthCheck(args: HealthCheckArgs): { text: string; data: unknown } {
  const mode = args.mode ?? 'doctor';

  if (mode === 'verify') {
    try {
      const checks = runAllChecks({
        platform: args.platform as 'workbuddy' | 'openclaw' | undefined,
      });
      const allOk = checks.every((c: { status: string }) => c.status === 'pass' || c.status === 'ok');

      const lines: string[] = ['[sofagent] 环境验证（verify）:', ''];
      for (const check of checks) {
        const icon = check.status === 'pass' || check.status === 'ok' ? '✅' : '❌';
        lines.push(`${icon} ${check.name}: ${check.detail ?? check.status}`);
      }
      lines.push('', allOk ? '✅ 全部通过' : '❌ 有检查未通过');

      return {
        text: lines.join('\n'),
        data: { allOk, checks },
      };
    } catch (err) {
      return {
        text: `[sofagent] 验证异常：${err instanceof Error ? err.message : String(err)}`,
        data: { error: true, allOk: false, checks: [] },
      };
    }
  }

  // doctor 模式
  try {
    const report = runDoctor();
    const allOk = report.items.every((item: { status: string }) => item.status === 'ok' || item.status === 'pass');

    const lines: string[] = ['[sofagent] 环境健康检查（doctor）:', ''];
    for (const item of report.items) {
      const icon = item.status === 'ok' || item.status === 'pass' ? '✅' : item.status === 'warn' ? '⚠️' : '❌';
      lines.push(`${icon} ${item.name}: ${item.detail ?? item.status}`);
    }
    lines.push('', allOk ? '✅ 全部正常' : '⚠️ 部分检查需关注');

    return {
      text: lines.join('\n'),
      data: { allOk, checks: report.items },
    };
  } catch (err) {
    return {
      text: `[sofagent] 健康检查异常：${err instanceof Error ? err.message : String(err)}`,
      data: { error: true, allOk: false, checks: [] },
    };
  }
}
