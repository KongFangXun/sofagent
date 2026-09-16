// ============================================================
// tools/knowledge-page.ts · 知识页写入管道共用件（v1.4.9 深模块条目 6）
// ============================================================
// 背景：5 个知识页 tool 文件（create-entity/create-concept/update-entity/
// delete-entity/delete-concept）各自复制同一套管道件——
//   parseFrontmatter ×6（≤8 行微差）/ appendDataChangeLog ×5（diff=0）/
//   防路径穿越三连 ×5+。
// 本模块下沉三个共用函数（零行为变化——函数体从 create-entity.ts 逐字迁移），
// tool 文件退化为 import 消费。
// 保留：OKF type 写入强制、D1-D5「FAIL 拒写」语义、confirmed 人审语义（各 tool 内）。
// ============================================================

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { getDataDir } from '@sofagent/core';
import type { DataChange, DataAuditResult } from '@sofagent/core';

/**
 * 从 Markdown 内容中解析 frontmatter。
 * （逐字迁移自 create-entity.ts——BOM 剥离 + CRLF 归一 + yaml 解析失败返 null）
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return null;
  try {
    return yamlLoad(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 追加数据变更日志到 data/audit/data-change-log.jsonl。
 * （逐字迁移自 create-entity.ts / delete-entity.ts——两处 diff=0 的单源化）
 */
export function appendDataChangeLog(change: DataChange, auditResult: DataAuditResult): void {
  const logDir = join(getDataDir(), 'audit');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const logPath = join(logDir, 'data-change-log.jsonl');
  const entry = {
    timestamp: change.timestamp,
    type: change.type,
    name: change.name,
    action: change.action,
    auditVerdict: auditResult.hasFail ? 'FAIL' : auditResult.hasWarn ? 'WARN' : 'PASS',
    violations: auditResult.violations.map((v) => ({ rule: v.rule, detail: v.detail })),
  };
  try {
    appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // 非致命
  }
}

/**
 * 防路径穿越校验（知识页 name → 文件路径前的守卫）。
 * 返回 null = 安全；string = 拒绝原因（含路径分隔符/绝对路径逃逸细节）。
 * （三连校验单源化——各 tool 原内联形态一致）
 */
export function checkPageNameSafety(name: string): string | null {
  // 语义逐字对齐各 tool 内联形态（.. 与分隔符都拦——穿越守卫）
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return `name 含路径穿越特征（.. 或分隔符）：${name}`;
  }
  return null;
}
