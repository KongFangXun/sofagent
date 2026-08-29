// ============================================================
// A21 不植后门（安全层 · 业务底线）v1.3.7 新增
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
    // v1.3.6 B15 补漏：FORGE/playbook/ 审查清单文档教人 grep 检查 LaunchAgents plist——
    // 字面路径被 A21 误判为后门（docs/ 已豁免，playbook 漏了）
    if (file.path.startsWith('FORGE/playbook/') && file.path.endsWith('.md')) continue;

    const addedLines = getAddedLines(file);

    // v1.4.5 finding-16：多行 systemd unit / LaunchAgent plist 绕过修复。
    // 逐行扫描下 `[Service]` 与 `ExecStart=` 分处两行（heredoc 写入）、无 WantedBy
    // 行时全部持久化模式逃逸。对持久化落点路径做 hunk 级判定：整段新增行拼接后
    // 匹配组合特征，不依赖单行命中。行级已命中时跳过，避免同文件重复计数。
    let fileHit = false;
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
          fileHit = true;
          break;
        }
      }
    }
    if (!fileHit) {
      const hunk = addedLines.join('\n');
      const systemdTarget = /\/etc\/systemd\/system\//.test(file.path) || /\/etc\/systemd\/system\//.test(hunk);
      if (systemdTarget && /\[Service\][\s\S]*?ExecStart/i.test(hunk)) {
        hits.push({ file: file.path, line: hunk.trim().slice(0, 100), pattern: 'systemd service ExecStart（多行 hunk）' });
      }
      const launchAgentTarget = /\/Library\/LaunchAgents\//.test(file.path) || /\/Library\/LaunchAgents\//.test(hunk);
      if (launchAgentTarget && /<plist[^>]*>[\s\S]*?<key>Label<\/key>/i.test(hunk)) {
        hits.push({ file: file.path, line: hunk.trim().slice(0, 100), pattern: 'LaunchAgent plist（多行 hunk）' });
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
