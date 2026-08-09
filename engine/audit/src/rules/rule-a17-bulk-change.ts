// ============================================================
// A17 异常批量变更（安全层 · 工程规范）
// 检测短时间内大量文件变更（Agent 失控/注入攻击信号）
// evidenceMode: filesystem
// v1.3.0 新增
// ============================================================

import type { AuditContext, RuleCheck } from './types';

export function checkRuleA17(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A17 异常批量变更',
    number: 17,
    status: 'PASS',
    details: [],
    evidenceMode: 'filesystem',
    ruleClass: '工程规范',
  };

  const config = ctx.config?.A17;
  if (!config?.enabled) return rule;

  const threshold: number = config.bulk_threshold || 50;
  const windowMs: number = config.bulk_window_ms || 300000;
  const now = Date.now();

  // 窗口内累计变更文件数 = 本次 diff 文件数 + 窗口内历史审计的累计文件数
  const currentFiles = ctx.diffFiles?.length || 0;
  const historyFiles = (ctx.history || [])
    .filter((h) => now - new Date(h.timestamp).getTime() < windowMs)
    .reduce((sum, h) => sum + (h.diffFileCount || 0), 0);
  const totalChangedFiles = currentFiles + historyFiles;

  if (totalChangedFiles >= threshold) {
    rule.status = 'WARN';
    rule.details.push(
      `批量变更告警：窗口（${windowMs / 1000}s）内累计变更 ${totalChangedFiles} 个文件（阈值 ${threshold}）。本次 ${currentFiles} + 历史 ${historyFiles}。可能是 Agent 失控或注入攻击，建议人工检查。`
    );
  }

  return rule;
}
