// ============================================================
// update-entity.ts · MCP tool：字段级更新 entity 页（v1.3.6 交付 5）
// ============================================================
//
// 区别于 create_entity 的全量覆盖：update_entity 只改传入字段，
// 保留其余 frontmatter 与正文——「读现有 frontmatter → 只改传入字段
// → 保留其余 → 写回，updated_at 刷新」。
//
// 集成 S4 数据变更审计（D1-D5），与 create-entity 同流程：
//   1. 读取现有文件作为 before（不存在 → 报错，不自动创建）
//   2. 仅应用传入字段构造 after
//   3. diffDataChange + runDataRules
//   4. FAIL → 拒绝写入，isError: true
//   5. WARN → 写入但返回警告
//   6. 写入成功 → generateDataThink 回溯 + 数据变更日志
// ============================================================

import { existsSync, readFileSync, appendFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import {
  type DataChange,
  diffDataChange,
  runDataRules,
  type DataAuditResult,
  atomicWriteSync,
} from '@sofagent/core';
import { generateDataThink } from '@sofagent/think';

// ============================================================
// 类型定义
// ============================================================

export interface UpdateEntityArgs {
  /** 现有 entity 名称（不含 .md 后缀，定位目标文件） */
  name: string;
  /** 可选：改名（新名称，不含 .md 后缀；省略 = 不改名） */
  newName?: string;
  /** 可选：改业务域归属 */
  domain?: string;
  /** 可选：改 entity 简述 */
  description?: string;
  /** 可选：JSON 格式关联关系（belongs_to / has_many），整体替换 relations */
  relations?: string;
  /** 可选：正文内容（Markdown body，不含 frontmatter；省略 = 保留原正文） */
  content?: string;
}

export interface UpdateEntityResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    action: 'updated' | 'renamed';
    path: string;
    renamedFrom?: string;
    warnings?: DataAuditResult['violations'];
    auditVerdict: 'PASS' | 'WARN' | 'FAIL';
    isError: boolean;
  };
}

// ============================================================
// 辅助函数
// ============================================================

/** 获取知识库根目录 */
function getKnowledgeDir(): string {
  return join(getSofagentDataDir(), 'knowledge');
}

/** 获取数据根目录 */
function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

/**
 * 从 Markdown 内容中解析 frontmatter
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
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
 * 从现有文件读取 before 对象（含 frontmatter + 正文）
 */
function readEntityFile(filePath: string): { fm: Record<string, unknown>; body: string } | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(content) ?? {};
    const bodyMatch = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
    const body = bodyMatch ? (bodyMatch[1] ?? '') : '';
    return { fm, body };
  } catch {
    return undefined;
  }
}

/**
 * 序列化 frontmatter（对象/数组用 JSON 内联，标量用 String）
 */
function serializeFrontmatter(fm: Record<string, unknown>): string {
  return Object.entries(fm)
    .map(([k, v]) => {
      if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
        return `${k}: ${JSON.stringify(v)}`;
      }
      return `${k}: ${String(v)}`;
    })
    .join('\n');
}

/**
 * 写入 entity 文件（原子写入；目录不存在则创建）
 */
function writeEntityFile(filePath: string, content: string): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  atomicWriteSync(filePath, content);
}

/**
 * 追加数据变更日志到 data/audit/data-change-log.jsonl
 */
function appendDataChangeLog(change: DataChange, auditResult: DataAuditResult): void {
  const logDir = join(getSofagentDataDir(), 'audit');
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

// ============================================================
// 主函数
// ============================================================

/**
 * 字段级更新 entity（v1.3.1 交付 5）
 *
 * 只改传入字段（domain/description/relations/content/newName），
 * 其余 frontmatter 与正文保留；updated_at 一律刷新。
 *
 * @param args 更新参数（name 必填；其余字段可选）
 * @returns 结构化结果（text + data）
 */
export function updateEntity(args: UpdateEntityArgs): UpdateEntityResult {
  const { name, newName, domain, description, relations, content } = args;

  // 防路径穿越（新旧名都要查）
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return {
      text: '[sofagent] entity 名称不合法：不得包含路径分隔符',
      data: { action: 'updated', path: '', auditVerdict: 'FAIL', isError: true },
    };
  }
  if (newName !== undefined && (newName.includes('..') || newName.includes('/') || newName.includes('\\'))) {
    return {
      text: '[sofagent] entity 新名称不合法：不得包含路径分隔符',
      data: { action: 'updated', path: '', auditVerdict: 'FAIL', isError: true },
    };
  }

  const entitiesDir = join(getKnowledgeDir(), 'entities');
  const oldPath = join(entitiesDir, `${name}.md`);
  const targetName = newName ?? name;
  const targetPath = join(entitiesDir, `${targetName}.md`);

  // 1. 读取现有文件——update 语义：不存在不自动创建
  const existing = readEntityFile(oldPath);
  if (!existing) {
    return {
      text: `[sofagent] entity "${name}" 不存在，无法更新（update_entity 只更新已有 entity；创建请用 create_entity）`,
      data: { action: 'updated', path: oldPath, auditVerdict: 'FAIL', isError: true },
    };
  }

  // 2. 构造 after frontmatter——只改传入字段，保留其余
  const afterFm: Record<string, unknown> = { ...existing.fm };
  if (domain !== undefined) afterFm['domain'] = domain;
  if (description !== undefined) afterFm['description'] = description;
  if (relations !== undefined) {
    try {
      afterFm['relations'] = JSON.parse(relations);
    } catch {
      afterFm['relations_raw'] = relations;
    }
  }
  // 改名时同步 frontmatter name
  if (newName !== undefined) afterFm['name'] = newName;
  // updated_at 一律刷新（D4 格式一致性）
  const now = new Date().toISOString();
  afterFm['updated_at'] = now;
  // created_at 必须保留（D4 不允许丢）
  if (!afterFm['created_at']) afterFm['created_at'] = existing.fm['created_at'] ?? now;

  // 3. 正文：content 传入则替换，省略保留原正文
  const afterBody = content !== undefined ? content : existing.body;

  // 4. 序列化最终文件内容
  const finalContent = `---\n${serializeFrontmatter(afterFm)}\n---\n${afterBody}`;

  // 5. 构造 before/after 供数据审计
  const before: Record<string, unknown> = { ...existing.fm, _content: readFileSync(oldPath, 'utf-8') };
  const after: Record<string, unknown> = { ...afterFm, _content: finalContent, _updated_at: now };

  // 6. 数据审计（D1-D5）
  const change = diffDataChange('entity', targetName, before, after);
  const auditResult = runDataRules([change]);

  // 7. FAIL → 拒绝写入
  if (auditResult.hasFail) {
    const failSummary = auditResult.violations
      .filter((v) => v.severity === 'FAIL')
      .map((v) => `${v.rule}: ${v.detail}`)
      .join('; ');
    return {
      text: `[sofagent] 数据审计拦截（FAIL）· entity "${name}" 未更新\n  ${failSummary}`,
      data: {
        action: newName !== undefined && newName !== name ? 'renamed' : 'updated',
        path: targetPath,
        ...(newName !== undefined && newName !== name ? { renamedFrom: oldPath } : {}),
        auditVerdict: 'FAIL',
        isError: true,
      },
    };
  }

  // 8. 写入（改名 = 写新文件 + 删旧文件）
  writeEntityFile(targetPath, finalContent);
  if (targetPath !== oldPath && existsSync(oldPath)) {
    try {
      rmSync(oldPath, { force: true });
    } catch {
      // 非致命：旧文件删除失败不阻断（新文件已写入）
    }
  }

  // 9. 数据变更回溯（静默写入 think.md）
  try {
    generateDataThink([change], auditResult, `update_entity: ${targetName}`);
  } catch {
    // 非致命
  }

  // 10. 追加数据变更日志
  appendDataChangeLog(change, auditResult);

  // 11. 构造返回值
  const hasWarn = auditResult.hasWarn;
  const warnList = auditResult.violations.filter((v) => v.severity === 'WARN');
  const isRename = newName !== undefined && newName !== name;

  let text = isRename
    ? `[sofagent] entity "${name}" 已更名为 "${newName}"`
    : `[sofagent] entity "${name}" 已更新`;
  if (hasWarn) {
    text += `（有 ${warnList.length} 项警告）`;
    for (const w of warnList) {
      text += `\n  ⚠️ ${w.rule}: ${w.detail}`;
    }
  }

  return {
    text,
    data: {
      action: isRename ? 'renamed' : 'updated',
      path: targetPath,
      ...(isRename ? { renamedFrom: oldPath } : {}),
      auditVerdict: hasWarn ? 'WARN' : 'PASS',
      isError: false,
      ...(warnList.length > 0 ? { warnings: warnList } : {}),
    },
  };
}
