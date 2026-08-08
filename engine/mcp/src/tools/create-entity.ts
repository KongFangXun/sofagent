// ============================================================
// create-entity.ts · MCP tool：创建/更新 entity 页（v1.2.9 S2 新增）
// ============================================================
//
// 写入 knowledge/entities/<name>.md，含 frontmatter + created_at/updated_at
// 集成 S4 数据变更审计（D1-D5）：
//   1. 读取现有文件作为 before
//   2. 构造 after
//   3. diffDataChange + runDataRules
//   4. FAIL → 拒绝写入，isError: true
//   5. WARN → 写入但返回警告
//   6. 写入成功 → generateDataThink 回溯 + 数据变更日志
// ============================================================

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
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

export interface CreateEntityArgs {
  /** entity 名称（不含 .md 后缀） */
  name: string;
  /** 业务域归属 */
  domain: string;
  /** entity 页面内容（Markdown，含 frontmatter） */
  content: string;
  /** JSON 格式关联关系（belongs_to / has_many），可选 */
  relations?: string;
}

export interface CreateEntityResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    action: 'created' | 'updated';
    path: string;
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
 * 从文件内容构造结构化 after 对象
 */
function buildAfterObject(name: string, domain: string, content: string, relations?: string): Record<string, unknown> {
  const fm = parseFrontmatter(content) ?? {};
  const after: Record<string, unknown> = { ...fm, name, domain };
  if (relations) {
    try {
      after['relations'] = JSON.parse(relations);
    } catch {
      after['relations_raw'] = relations;
    }
  }
  after['_content'] = content;
  after['_updated_at'] = new Date().toISOString();
  return after;
}

/**
 * 从现有文件读取 before 对象
 */
function readBeforeObject(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(content) ?? {};
    return { ...fm, _content: content };
  } catch {
    return undefined;
  }
}

/**
 * 保留原有 created_at，补充 updated_at
 */
function ensureTimestamps(name: string, domain: string, content: string, existingCreatedAt?: string): string {
  const now = new Date().toISOString();
  const fm = parseFrontmatter(content);

  const buildFm = (): Record<string, unknown> => {
    const base: Record<string, unknown> = fm ? { ...fm } : {};
    if (!base['name']) base['name'] = name;
    if (!base['domain']) base['domain'] = domain;
    if (existingCreatedAt && !base['created_at']) {
      base['created_at'] = existingCreatedAt;
    } else if (!base['created_at'] && !existingCreatedAt) {
      base['created_at'] = now;
    }
    base['updated_at'] = now;
    return base;
  };

  const finalFm = buildFm();

  // 序列化 frontmatter
  const fmLines = Object.entries(finalFm)
    .map(([k, v]) => {
      if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
        return `${k}: ${JSON.stringify(v)}`;
      }
      return `${k}: ${String(v)}`;
    })
    .join('\n');

  // 提取 body（frontmatter 之后的正文）
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1] : '';
  return `---\n${fmLines}\n---\n${body}`;
}

/**
 * 写入 entity 文件（原子写入）
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
 * 创建/更新 entity
 *
 * @param args 创建参数
 * @returns 结构化结果（text + data）
 */
export function createEntity(args: CreateEntityArgs): CreateEntityResult {
  const { name, domain, content, relations } = args;

  // 防路径穿越
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return {
      text: '[sofagent] entity 名称不合法：不得包含路径分隔符',
      data: { action: 'created', path: '', auditVerdict: 'FAIL', isError: true },
    };
  }

  const entitiesDir = join(getKnowledgeDir(), 'entities');
  const filePath = join(entitiesDir, `${name}.md`);

  // 1. 读取 before
  const before = readBeforeObject(filePath);
  const existingCreatedAt = before?.['created_at'] as string | undefined;

  // 2. 确保 frontmatter 有 created_at/updated_at
  const finalContent = ensureTimestamps(name, domain, content, existingCreatedAt);

  // 3. 构造 after
  const after = buildAfterObject(name, domain, finalContent, relations);

  // 4. 数据审计
  const change = diffDataChange('entity', name, before, after);
  const auditResult = runDataRules([change]);

  // 5. FAIL → 拒绝写入
  if (auditResult.hasFail) {
    const failSummary = auditResult.violations
      .filter((v) => v.severity === 'FAIL')
      .map((v) => `${v.rule}: ${v.detail}`)
      .join('; ');
    return {
      text: `[sofagent] 数据审计拦截（FAIL）· entity "${name}" 未写入\n  ${failSummary}`,
      data: {
        action: before ? 'updated' : 'created',
        path: filePath,
        auditVerdict: 'FAIL',
        isError: true,
      },
    };
  }

  // 6. 写入文件
  writeEntityFile(filePath, finalContent);

  // 7. 数据变更回溯（静默写入 think.md）
  try {
    generateDataThink([change], auditResult, `create_entity: ${name}`);
  } catch {
    // 非致命
  }

  // 8. 追加数据变更日志
  appendDataChangeLog(change, auditResult);

  // 9. 构造返回值
  const action: 'created' | 'updated' = before ? 'updated' : 'created';
  const hasWarn = auditResult.hasWarn;
  const warnList = auditResult.violations.filter((v) => v.severity === 'WARN');

  let text = `[sofagent] entity "${name}" 已${action === 'created' ? '创建' : '更新'}`;
  if (hasWarn) {
    text += `（有 ${warnList.length} 项警告）`;
    for (const w of warnList) {
      text += `\n  ⚠️ ${w.rule}: ${w.detail}`;
    }
  }

  return {
    text,
    data: {
      action,
      path: filePath,
      auditVerdict: hasWarn ? 'WARN' : 'PASS',
      isError: false,
      ...(warnList.length > 0 ? { warnings: warnList } : {}),
    },
  };
}
