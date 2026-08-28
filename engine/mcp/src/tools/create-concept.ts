// ============================================================
// create-concept.ts · MCP tool：创建/更新 concept 页（v1.3.7 S2 新增）
// ============================================================
//
// 写入 knowledge/concepts/<name>.md
// 集成 S4 数据变更审计（D1-D5）——与 create-entity 同流程
// ============================================================

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import {type DataChange,
  diffDataChange,
  runDataRules,
  type DataAuditResult,
  atomicWriteSync, getDataDir } from '@sofagent/core';
import { generateDataThink } from '@sofagent/think';

// ============================================================
// 类型定义
// ============================================================

export interface CreateConceptArgs {
  /** concept 名称 */
  name: string;
  /** concept 内容（Markdown） */
  content: string;
}

export interface CreateConceptResult {
  text: string;
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

function getKnowledgeDir(): string {
  return join(getDataDir(), 'knowledge');
}

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

function ensureTimestamps(name: string, content: string, existingCreatedAt?: string): string {
  const now = new Date().toISOString();
  const fm = parseFrontmatter(content);

  const buildFm = (): Record<string, unknown> => {
    const base: Record<string, unknown> = fm ? { ...fm } : {};
    if (!base['name']) base['name'] = name;
    if (existingCreatedAt && !base['created_at']) {
      base['created_at'] = existingCreatedAt;
    } else if (!base['created_at'] && !existingCreatedAt) {
      base['created_at'] = now;
    }
    base['updated_at'] = now;
    return base;
  };

  const finalFm = buildFm();

  const fmLines = Object.entries(finalFm)
    .map(([k, v]) => {
      if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
        return `${k}: ${JSON.stringify(v)}`;
      }
      return `${k}: ${String(v)}`;
    })
    .join('\n');

  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1] : '';
  return `---\n${fmLines}\n---\n${body}`;
}

function writeConceptFile(filePath: string, content: string): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  atomicWriteSync(filePath, content);
}

function appendDataChangeLog(change: DataChange, auditResult: DataAuditResult): void {
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

// ============================================================
// 主函数
// ============================================================

export function createConcept(args: CreateConceptArgs): CreateConceptResult {
  const { name, content } = args;

  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return {
      text: '[sofagent] concept 名称不合法：不得包含路径分隔符',
      data: { action: 'created', path: '', auditVerdict: 'FAIL', isError: true },
    };
  }

  // v1.3.6 · v1.3.7 开发⑥ OKF ①：type 必填校验（OKF 唯一强制字段——缺 type 拒绝写入返回结构化错误）
  // 存量条目读取容忍缺 type（宽容性原则）；写入侧强制。
  const fmCheck = parseFrontmatter(content);
  if (!fmCheck || typeof fmCheck['type'] !== 'string' || (fmCheck['type'] as string).trim() === '') {
    return {
      text: '[sofagent] OKF 校验失败：concept frontmatter 缺少必填字段 `type`（OKF v0.2 唯一强制字段）。\n  示例：---\ntype: concept\nname: ' + name + '\n---',
      data: {
        action: 'created',
        path: '',
        auditVerdict: 'FAIL',
        isError: true,
        okfViolation: 'missing-required-field:type',
      } as unknown as CreateConceptResult['data'],
    };
  }

  const conceptsDir = join(getKnowledgeDir(), 'concepts');
  const filePath = join(conceptsDir, `${name}.md`);

  // 1. 读取 before
  const before = readBeforeObject(filePath);
  const existingCreatedAt = before?.['created_at'] as string | undefined;

  // 2. 确保 frontmatter
  const finalContent = ensureTimestamps(name, content, existingCreatedAt);

  // 3. 构造 after
  const after: Record<string, unknown> = { name, _content: finalContent, _updated_at: new Date().toISOString() };
  const fm = parseFrontmatter(finalContent);
  if (fm) Object.assign(after, fm);

  // 4. 数据审计
  const change = diffDataChange('concept', name, before, after);
  const auditResult = runDataRules([change]);

  // 5. FAIL → 拒绝写入
  if (auditResult.hasFail) {
    const failSummary = auditResult.violations
      .filter((v) => v.severity === 'FAIL')
      .map((v) => `${v.rule}: ${v.detail}`)
      .join('; ');
    return {
      text: `[sofagent] 数据审计拦截（FAIL）· concept "${name}" 未写入\n  ${failSummary}`,
      data: {
        action: before ? 'updated' : 'created',
        path: filePath,
        auditVerdict: 'FAIL',
        isError: true,
      },
    };
  }

  // 6. 写入
  writeConceptFile(filePath, finalContent);

  // 7. 数据变更回溯
  try {
    generateDataThink([change], auditResult, `create_concept: ${name}`);
  } catch {
    // 非致命
  }

  // 8. 追加日志
  appendDataChangeLog(change, auditResult);

  // 9. 构造返回值
  const action: 'created' | 'updated' = before ? 'updated' : 'created';
  const hasWarn = auditResult.hasWarn;
  const warnList = auditResult.violations.filter((v) => v.severity === 'WARN');

  let text = `[sofagent] concept "${name}" 已${action === 'created' ? '创建' : '更新'}`;
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
