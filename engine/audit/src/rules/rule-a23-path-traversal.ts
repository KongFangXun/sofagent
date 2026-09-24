// ============================================================
// A23 不逃路径（安全层 · 业务底线）v1.3.7 新增
// 检测 git diff 新增行中是否含路径穿越 / symlink 逃逸
// evidenceMode: git-diff
// ============================================================

import {
  isDiffFileHeader, getAddedLines } from '@sofagent/core';
import type { AuditContext, RuleScan, RuleStatus } from './types';
import { sanitizeDetailLine } from './rule-a9-no-injection';

/** 路径穿越模式（不用 g 标志——避免 lastIndex 状态问题） */
const TRAVERSAL_PATTERNS: { pattern: RegExp; name: string }[] = [
  // 路径穿越到系统敏感目录
  { pattern: /\.\.\/.*?\.\.\/.*?(etc\/passwd|etc\/shadow|\.ssh\/|\.env)/i, name: '路径穿越到系统敏感文件' },
  // 三级以上路径穿越
  { pattern: /(\.\.\/){3,}/, name: '三级以上路径穿越 (../../../)' },
  // 路径穿越到 .ssh
  { pattern: /\.\.\/.*?\.ssh\//i, name: '路径穿越到 .ssh 目录' },
  // 路径穿越到 .env
  { pattern: /\.\.\/.*?\.env/i, name: '路径穿越到 .env 文件' },
  // 变形 basename 绕过 A1（路径前缀 + 敏感文件名）
  { pattern: /\.\.\/.*?(id_rsa|id_dsa|id_ecdsa|authorized_keys|known_hosts)/i, name: '路径穿越到 SSH 密钥' },
];

/** symlink 逃逸模式 */
const SYMLINK_PATTERNS: { pattern: RegExp; name: string }[] = [
  // ln -s 指向系统敏感路径
  { pattern: /ln\s+-s\s+\/etc\//i, name: 'symlink 指向 /etc/' },
  { pattern: /ln\s+-s\s+\/root\//i, name: 'symlink 指向 /root/' },
  { pattern: /ln\s+-s\s+.*?\.ssh\//i, name: 'symlink 指向 .ssh/' },
  // symlink + 立即读取
  { pattern: /ln\s+-s\s+\S+\s+\S+.*?(cat|read|open|fopen)/is, name: 'symlink 创建 + 读取' },
];

/** 安全路径模式（不告警） */
const SAFE_PATH_PATTERNS: RegExp[] = [
  // 正常相对路径 ./src/xxx
  /^\.\//,
  // 正常绝对路径
  /^\/usr\/local\/bin\//,
  /^\/tmp\//,
  /^\/var\/log\//,
  /^\/opt\//,
  /^\/home\//,
];

export function scanA23(ctx: AuditContext): RuleScan {
  let status: RuleStatus = 'PASS';
  const details: string[] = [];

  const { diffFiles } = ctx;

  interface Hit { file: string; line: string; pattern: string }
  const hits: Hit[] = [];

  for (const file of diffFiles) {
    // 跳过文档目录；测试文件不再静默跳过（v1.4.8 fresh-eyes finding-11：文件命名
    // 完全在被审计 Agent 控制下，命中在末尾拆分降级 WARN 人工确认）
    if (file.path.startsWith('docs/')) continue;

    const addedLines = getAddedLines(file);

    // v1.3.1 #47: 真实 symlink 检测——解析 diff 文件头中的 new mode 120000（symlink），
    // 提取 symlink target 路径，对 target 做绝对路径 / ../ 穿越检测。
    // git diff 中 symlink 文件的 `+++` 行后跟 target 路径（非 + 前缀内容）。
    let symlinkTarget: string | null = null;
    for (const rawLine of file.lines) {
      // 检测 new mode 120000（symlink）——v1.4.3 (F-09): 新增 symlink 的 diff 头是 'new file mode 120000'，此前仅匹配修改场景导致漏检
      if (rawLine.startsWith('new mode 120000') || rawLine.startsWith('new file mode 120000')) {
        // 寻找紧随其后的 symlink target（以 + 开头，不含 +++）
        // git diff symlink 格式：+<target_path>
        for (const l of file.lines) {
          if (l.startsWith('+') && !isDiffFileHeader(l) && !l.startsWith('+-')) {
            symlinkTarget = l.substring(1).trim();
            break;
          }
        }
        break;
      }
    }

    if (symlinkTarget) {
      // 对 symlink target 做路径穿越检测
      const isAbsolute = symlinkTarget.startsWith('/');
      const hasTraversal = /(\.\.\/){2,}/.test(symlinkTarget);
      const targetsSensitive = /(\.ssh\/|\.env$|\.env\b|etc\/passwd|etc\/shadow|id_rsa|id_dsa|id_ecdsa|authorized_keys|known_hosts)/i.test(symlinkTarget);

      if (isAbsolute || hasTraversal || targetsSensitive) {
        hits.push({
          file: file.path,
          line: `symlink → ${symlinkTarget.slice(0, 100)}`,
          pattern: '真实 symlink 指向敏感/穿越路径（diff mode 120000）',
        });
      }
    }

    for (const line of addedLines) {
      // 检查路径穿越
      for (const { pattern, name } of TRAVERSAL_PATTERNS) {
        if (pattern.test(line)) {
          hits.push({
            file: file.path,
            line: line.trim().slice(0, 100),
            pattern: name,
          });
          break;
        }
      }

      // 检查 symlink 逃逸
      for (const { pattern, name } of SYMLINK_PATTERNS) {
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

  // v1.4.8 fresh-eyes（finding-11）：测试文件命中拆出主判定——不 FAIL，降级 WARN 人工确认
  const isTestFilePath = (p: string) => p.includes('.test.') || p.includes('__tests__/');
  const testFileHits = hits.filter((h) => isTestFilePath(h.file));
  const mainHits = hits.filter((h) => !isTestFilePath(h.file));

  if (mainHits.length > 0) {
    status = 'FAIL';
    details.push(
      `检测到 ${mainHits.length} 处路径穿越/symlink 逃逸: ` +
      mainHits.map(h => `${h.file}: "${h.line}" (${h.pattern})`).join('; ')
    );
  }
  if (testFileHits.length > 0) {
    if (status === 'PASS') status = 'WARN';
    details.push(
      `测试文件豁免命中（不 FAIL 但需人工确认）: ` +
      testFileHits.slice(0, 5).map(h => `${h.file}: "${sanitizeDetailLine(h.line)}" (${h.pattern})`).join('; ') +
      (testFileHits.length > 5 ? ` 等 ${testFileHits.length} 处` : '') +
      `。测试文件命名在被审计 Agent 控制下，请确认以上命中均为合法 fixture 而非真实路径穿越夹带。`
    );
  }

  return { status, details };
}
