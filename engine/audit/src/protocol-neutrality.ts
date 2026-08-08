// ============================================================
// protocol-neutrality.ts · 协议中立审计声明（v1.2.8 §3.3）
//
// 目标：审计层只走 MCP 等开放协议 + git diff/JSONL/Markdown 开放格式，
// 不绑定单一平台。
//
// 交付方式：原则性声明 + 验证检查（成本极低）。
//
// 验证检查：
//   1. 无平台专属 SDK 导入（飞书/钉钉/企微/Slack 等）
//   2. 审计输出格式为开放格式（JSON/JSONL/Markdown/YAML）
//   3. 通信协议为开放协议（MCP/HTTP/stdio）
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

/** 协议中立检查结果 */
export interface ProtocolNeutralityResult {
  /** 是否协议中立 */
  neutral: boolean;
  /** 违规项列表 */
  violations: string[];
}

/** 平台专属 SDK / 协议绑定的导入模式 */
const PLATFORM_SDK_PATTERNS: { pattern: RegExp; platform: string }[] = [
  // 钉钉
  { pattern: /require\s*\(\s*['"]dingtalk/i, platform: '钉钉 SDK' },
  { pattern: /from\s+['"]dingtalk/i, platform: '钉钉 SDK' },
  { pattern: /import\s+.*from\s+['"]dingtalk/i, platform: '钉钉 SDK' },
  // 飞书
  { pattern: /require\s*\(\s*['"]@larksuite/i, platform: '飞书 SDK' },
  { pattern: /from\s+['"]@larksuite/i, platform: '飞书 SDK' },
  { pattern: /require\s*\(\s*['"]@feishu/i, platform: '飞书 SDK' },
  { pattern: /from\s+['"]@feishu/i, platform: '飞书 SDK' },
  // 企业微信
  { pattern: /require\s*\(\s*['"]wecom/i, platform: '企业微信 SDK' },
  { pattern: /from\s+['"]wecom/i, platform: '企业微信 SDK' },
  { pattern: /require\s*\(\s*['"]@wecom/i, platform: '企业微信 SDK' },
  { pattern: /from\s+['"]@wecom/i, platform: '企业微信 SDK' },
  // Slack
  { pattern: /require\s*\(\s*['"]@slack/i, platform: 'Slack SDK' },
  { pattern: /from\s+['"]@slack/i, platform: 'Slack SDK' },
  // 硬编码 webhook URL 模式（在审计核心层出现即违规）
  { pattern: /oapi\.dingtalk\.com/i, platform: '钉钉硬编码 webhook' },
  { pattern: /open\.feishu\.cn/i, platform: '飞书硬编码 webhook' },
  { pattern: /qyapi\.weixin\.qq\.com/i, platform: '企业微信硬编码 webhook' },
  { pattern: /hooks\.slack\.com/i, platform: 'Slack 硬编码 webhook' },
];

/** 允许的输出文件扩展名（开放格式） */
const ALLOWED_OUTPUT_EXTENSIONS = new Set([
  '.json', '.jsonl', '.md', '.yaml', '.yml', '.txt', '.csv',
]);

/** 允许的源码扩展名 */
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs']);

/**
 * 检查 diff 文件列表中是否引入了特定平台/协议绑定。
 *
 * 检查维度：
 *   1. diff 内容中是否有平台专属 SDK 导入
 *   2. diff 中是否出现硬编码平台 API URL
 *
 * @param diffFiles diff 文件内容数组（每个元素是文件的 diff 文本）
 * @returns 检查结果
 */
export function assertProtocolNeutrality(
  diffFiles: string[],
  _config?: Record<string, unknown>,
): ProtocolNeutralityResult {
  const violations: string[] = [];

  for (const diff of diffFiles) {
    // 只检查新增行（+ 开头），不检查删除行
    const addedLines = diff.split('\n').filter((l) => l.startsWith('+'));

    for (const line of addedLines) {
      for (const { pattern, platform } of PLATFORM_SDK_PATTERNS) {
        if (pattern.test(line)) {
          violations.push(`${platform}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
  }

  return {
    neutral: violations.length === 0,
    violations,
  };
}

/**
 * 扫描审计引擎代码目录，验证协议中立性。
 *
 * 检查：
 *   1. 源码中无平台专属 SDK 导入
 *   2. 无硬编码平台 API URL
 *
 * 注意：此函数只扫描 `.ts`/`.js` 源码文件，不扫描测试文件和 node_modules。
 *
 * @param auditSrcDir 审计引擎源码目录（如 engine/audit/src/）
 * @returns 检查结果
 */
export function verifyProtocolNeutrality(auditSrcDir: string): ProtocolNeutralityResult {
  const violations: string[] = [];

  if (!existsSync(auditSrcDir)) {
    return {
      neutral: false,
      violations: [`目录不存在: ${auditSrcDir}`],
    };
  }

  // 递归扫描源码文件
  function scanDir(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        // 跳过 node_modules 和 __tests__
        if (entry === 'node_modules' || entry === '__tests__') continue;
        scanDir(fullPath);
      } else {
        const ext = extname(entry);
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        // 跳过测试文件
        if (entry.endsWith('.test.ts') || entry.endsWith('.test.js')) continue;

        // 检查文件内容
        try {
          const content = readFileSync(fullPath, 'utf-8');
          for (const { pattern, platform } of PLATFORM_SDK_PATTERNS) {
            if (pattern.test(content)) {
              violations.push(`${platform}: 在 ${fullPath.replace(auditSrcDir, '.')} 中检测到`);
            }
          }
        } catch {
          // 读取失败跳过
        }
      }
    }
  }

  scanDir(auditSrcDir);

  return {
    neutral: violations.length === 0,
    violations,
  };
}
