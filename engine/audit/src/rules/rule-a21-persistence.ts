// ============================================================
// A21 不植后门（安全层 · 业务底线）v1.3.3 新增
// 检测 git diff 新增行中是否含持久化执行通道
// evidenceMode: git-diff
// ============================================================

import { getAddedLines } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './types';

/** 持久化模式（不用 g 标志——避免 lastIndex 状态问题） */
const PERSISTENCE_PATTERNS: { pattern: RegExp; name: string }[] = [
  // macOS LaunchAgent plist
  { pattern: /Library\/LaunchAgents\/.*\.plist/i, name: 'macOS LaunchAgent plist' },
  { pattern: /\bKeepAlive\b/i, name: 'LaunchAgent KeepAlive' },
  { pattern: /\bRunAtLoad\b/i, name: 'LaunchAgent RunAtLoad' },
  { pattern: /<plist[^>]*>[\s\S]*?<key>Label<\/key>/i, name: 'plist 配置' },

  // Linux systemd service——单行检测（多行模式在逐行扫描时不生效）
  { pattern: /WantedBy\s*=\s*multi-user\.target/i, name: 'systemd service WantedBy' },
  { pattern: /\[Service\][\s\S]*?ExecStart/i, name: 'systemd service ExecStart' },
  { pattern: /systemctl\s+(enable|start|daemon-reload)/i, name: 'systemctl 操作' },

  // Linux crontab
  { pattern: /crontab\s+-e/i, name: 'crontab 编辑' },
  { pattern: /@(reboot|daily|hourly)\s/i, name: 'cron 定时任务' },
  { pattern: /\*\/\d+\s+\*\s+\*\s+\*\s+\*\s+/i, name: 'cron 时间表达式' },

  // Windows 注册表自启
  { pattern: /HKLM\\.*\\Run/i, name: 'Windows 注册表 HKLM Run' },
  { pattern: /HKCU\\.*\\Run/i, name: 'Windows 注册表 HKCU Run' },
  { pattern: /\breg\s+add\s+.*\\Run/i, name: 'reg add 自启' },

  // 通用持久化——at 命令、nohup + &
  { pattern: /\bat\b\s+\d|at\s+now\s*\+/i, name: 'at 定时执行' },
];

export function checkRuleA21(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A21 不植后门',
    number: 21,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  interface Hit { file: string; line: string; pattern: string }
  const hits: Hit[] = [];

  for (const file of diffFiles) {
    // 跳过文档和测试文件
    if (file.path.startsWith('docs/')) continue;
    if (file.path.includes('.test.') || file.path.includes('__tests__/')) continue;
    // 跳过 changelog 和设计文档
    if (file.path.includes('changelog') || file.path.includes('CHANGELOG')) continue;

    const addedLines = getAddedLines(file);
    for (const line of addedLines) {
      // 跳过纯注释行（// · * · #）——注释不可执行，@daily 等巡检调度标记不是后门。
      // v1.2.5 教训：daemon inspectors 的 @daily 注释曾被误判为 crontab 后门。
      if (/^\s*(\/\/|\*|#)/.test(line)) continue;
      for (const { pattern, name } of PERSISTENCE_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({
            file: file.path,
            line: line.trim().slice(0, 100),
            pattern: name,
          });
          break;
        }
      }
    }
  }

  if (hits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${hits.length} 处持久化后门模式: ` +
      hits.map(h => `${h.file}: "${h.line}" (${h.pattern})`).join('; ')
    );
  }

  return rule;
}
