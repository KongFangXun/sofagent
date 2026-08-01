// ============================================================
// core/data-diff.ts · 结构化数据变更审计（v1.2.4 · P3 S4）
// ============================================================
//
// 数据变更审计——区别于代码审计（git diff），针对知识库
// 结构化数据（entity/concept）的 before/after 对比。
//
// D1-D5 数据规则：
//   D1 关键字段保护 — domain/name 不允许从有值改为空（FAIL）
//   D2 关联完整性 — belongs_to 引用目标必须存在（WARN）
//   D3 批量删除告警 — 单次删除 >3 个时告警（WARN）
//   D4 格式一致性 — frontmatter 必须含 created_at + updated_at（WARN）
//   D5 敏感信息检测 — 内容不含 secret-like 串（FAIL）
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from './config-loader';

/** 结构化数据变更记录（区别于 git diff 的 DiffFile） */
export interface DataChange {
  type: 'entity' | 'concept' | 'config';
  name: string;
  action: 'create' | 'update' | 'delete';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  timestamp: string;
}

/** 数据规则违规 */
export interface DataRuleViolation {
  rule: string;
  severity: 'FAIL' | 'WARN';
  detail: string;
}

/** 数据审计结果 */
export interface DataAuditResult {
  hasFail: boolean;
  hasWarn: boolean;
  failCount: number;
  warnCount: number;
  violations: DataRuleViolation[];
}

/** Secret-like 串检测正则（与 A2/A9 同源逻辑） */
const SECRET_PATTERNS = [
  /(?:sk-|pk-|Bearer\s)[a-zA-Z0-9]{20,}/i,
  /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"{}]{8,}/i,
  /-----BEGIN\s(?:RSA\s|EC\s|OPENSSH\s)?PRIVATE\sKEY-----/,
  /[a-zA-Z0-9+/]{40,}={0,2}/, // base64 长串
];

/**
 * 对比两个结构化对象，生成 DataChange
 */
export function diffDataChange(
  type: DataChange['type'],
  name: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): DataChange {
  const action: DataChange['action'] = before === undefined ? 'create' : after === undefined ? 'delete' : 'update';
  return {
    type,
    name,
    action,
    before,
    after,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 从 DataChange[] 跑数据规则 D1-D5，返回 DataAuditResult
 */
export function runDataRules(changes: DataChange[]): DataAuditResult {
  const violations: DataRuleViolation[] = [];

  // 加载现有 entity 列表（用于 D2 关联完整性校验）
  const existingEntities = getExistingEntityNames();

  for (const change of changes) {
    // D1: 关键字段保护（entity 的 domain/name 不允许从有值改为空）
    if (change.action === 'update' && change.before && change.after) {
      const beforeDomain = change.before['domain'];
      const afterDomain = change.after['domain'];
      if (beforeDomain && !afterDomain) {
        violations.push({
          rule: 'D1',
          severity: 'FAIL',
          detail: `${change.type} "${change.name}" 的 domain 字段从有值改为空`,
        });
      }
      const beforeName = change.before['name'];
      const afterName = change.after['name'];
      if (beforeName && !afterName) {
        violations.push({
          rule: 'D1',
          severity: 'FAIL',
          detail: `${change.type} "${change.name}" 的 name 字段从有值改为空`,
        });
      }
    }

    // D2: 关联完整性（belongs_to 引用目标必须存在）
    if (change.after && change.type === 'entity') {
      const relations = change.after['relations'] as string | undefined;
      if (relations) {
        try {
          const parsed = JSON.parse(relations) as Record<string, unknown>;
          const belongsTo = parsed['belongs_to'];
          if (typeof belongsTo === 'string' && !existingEntities.has(belongsTo) && belongsTo !== change.name) {
            violations.push({
              rule: 'D2',
              severity: 'WARN',
              detail: `${change.type} "${change.name}" 的 belongs_to 引用 "${belongsTo}" 不存在`,
            });
          }
        } catch {
          // relations 不是合法 JSON，跳过
        }
      }
    }

    // D3: 批量删除告警
    const deleteCount = changes.filter((c) => c.action === 'delete').length;
    if (deleteCount > 3) {
      // 只报一次
      if (change === changes.find((c) => c.action === 'delete')) {
        violations.push({
          rule: 'D3',
          severity: 'WARN',
          detail: `单次操作删除 ${deleteCount} 个 ${change.type}，超过 3 个阈值`,
        });
      }
    }

    // D4: 格式一致性（frontmatter 必须含 created_at + updated_at）
    if (change.action !== 'delete' && change.after && change.type === 'entity') {
      if (!change.after['created_at']) {
        violations.push({
          rule: 'D4',
          severity: 'WARN',
          detail: `${change.type} "${change.name}" 缺少 created_at 字段`,
        });
      }
      if (!change.after['updated_at']) {
        violations.push({
          rule: 'D4',
          severity: 'WARN',
          detail: `${change.type} "${change.name}" 缺少 updated_at 字段`,
        });
      }
    }

    // D5: 敏感信息检测
    if (change.after && change.type !== 'config') {
      const content = JSON.stringify(change.after);
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) {
          violations.push({
            rule: 'D5',
            severity: 'FAIL',
            detail: `${change.type} "${change.name}" 内容疑似含敏感信息（secret-like 串）`,
          });
          break;
        }
      }
    }
  }

  const failCount = violations.filter((v) => v.severity === 'FAIL').length;
  const warnCount = violations.filter((v) => v.severity === 'WARN').length;

  return {
    hasFail: failCount > 0,
    hasWarn: warnCount > 0,
    failCount,
    warnCount,
    violations,
  };
}

/** 获取现有 entity 名称集合（用于 D2 校验） */
function getExistingEntityNames(): Set<string> {
  const env = loadEnvConfig();
  const entitiesDir = join(env.dataDir, 'knowledge', 'entities');
  const names = new Set<string>();
  if (!existsSync(entitiesDir)) return names;
  try {
    for (const file of readdirSync(entitiesDir)) {
      if (file.endsWith('.md')) {
        names.add(file.replace(/\.md$/, ''));
      }
    }
  } catch {
    // 读取失败返回空集合
  }
  return names;
}
