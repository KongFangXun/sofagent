// ============================================================
// exporter.ts · v1.4.4 第一章 · 规则 + 样本序列化导出
//
// 职责：
// 1. 规则语料导出（rule-schema.ts 的格式 → JSON/YAML 双格式落盘）
// 2. 版本化（schemaVersion + engineVersion 双标记）
// 3. HMAC 签名（复用 @sofagent/core 的 getHmacKey + stableStringify——
//    与 audit-history / artifact-signing 同源纪律，密钥 ~/.sofagent-key）
//
// 导出审计：每次导出记 corpus_export 事件（谁导的、范围、签名）——
// 导出行为本身受审计（changelog 合规红线）。
// ============================================================

import { createHmac } from 'crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getHmacKey, stableStringify } from '@sofagent/core';
import { defaultRules, extendedRules } from '../rules/index';
import type { Rule } from '../rules/types';
import {
  RULE_EXPORT_SCHEMA_VERSION,
  allRuleSlots,
  toRuleExportEntry,
  type RuleCorpusBody,
  type RuleCorpusExport,
  type RuleExportEntry,
} from './rule-schema';
import { generateVerifiers } from './reward-mapping';
// re-export（cli/corpus.ts 与 audit index 面从本文件统一引——避免两处 import 路径）
export { generateVerifiers };

/** 引擎版本读取（audit 包 package.json——失败回退 '0.0.0' 不阻断导出） */
function readEngineVersion(): string {
  try {
    // import.meta 不可用（CJS 编译目标）——两层上取 audit 包 package.json
    // （src/export 与 dist/export 两种运行态同构，勿再加层）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    return pkg.version as string;
  } catch {
    return '0.0.0';
  }
}

/** body → HMAC（与 artifact-signing 同款：stableStringify 归一 + sha256 截 32） */
export function signBody(body: unknown, key: string): string {
  return createHmac('sha256', key).update(stableStringify(body)).digest('hex').slice(0, 32);
}

/** 构造规则语料导出主体（27 编号位 + counts 统计） */
export function buildRuleCorpusBody(
  scope: 'default' | 'extended' | 'all' = 'all',
  engineVersion?: string,
): RuleCorpusBody {
  const pool: Rule[] =
    scope === 'default' ? defaultRules : scope === 'extended' ? extendedRules : [...defaultRules, ...extendedRules];
  // 27 编号位全集只在 all 范围给（default/extended 范围不含跳号占位——
  // 编号空间完整性是全量导出的验收口径）
  const entries = scope === 'all' ? allRuleSlots(pool) : pool.map((r) => toEntry(r));
  const implemented = entries.filter((e) => e.status === 'implemented').length;
  const merged = entries.length - implemented;
  return {
    schemaVersion: RULE_EXPORT_SCHEMA_VERSION,
    engineVersion: engineVersion ?? readEngineVersion(),
    exportedAt: new Date().toISOString(),
    scope,
    rules: entries,
    counts: { implemented, mergedPlaceholders: merged, totalSlots: entries.length },
  };
}

/** 单规则 → 导出条目（部分范围直接映射，无占位） */
function toEntry(rule: Rule): RuleExportEntry {
  return toRuleExportEntry(rule);
}

/** JSON → YAML（轻量手写序列化——不引 js-yaml 依赖，导出结构是平铺对象数组） */
export function jsonToYaml(root: unknown): string {
  const lines: string[] = [];
  const emit = (value: unknown, indent: number, key?: string): void => {
    const pad = '  '.repeat(indent);
    const prefix = key !== undefined ? `${pad}${key}:` : pad;
    if (value === null || value === undefined) {
      lines.push(`${prefix} null`);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) { lines.push(`${prefix} []`); return; }
      lines.push(prefix);
      for (const item of value) emit(item, indent + 1);
      return;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 0) { lines.push(`${prefix} {}`); return; }
      if (key === undefined) {
        for (const k of keys) emit(obj[k], indent, k);
      } else {
        lines.push(prefix);
        for (const k of keys) emit(obj[k], indent + 1, k);
      }
      return;
    }
    // 基本类型
    if (typeof value === 'string') {
      const needsQuote = /[:{}\[\]&*#?|\-<>=!%@`"']|^\s|\s$|^$|^~|^true$|^false$|^null$/u.test(value) || /^\d+(\.\d+)?$/.test(value);
      lines.push(`${prefix} ${needsQuote ? JSON.stringify(value) : value}`);
    } else {
      lines.push(`${prefix} ${String(value)}`);
    }
  };
  emit(root, 0);
  return lines.join('\n') + '\n';
}

/** 导出入口参数 */
export interface ExportRuleCorpusOptions {
  /** 导出范围 */
  scope?: 'default' | 'extended' | 'all';
  /** 输出目录（缺省 data/export/corpus/） */
  outDir?: string;
  /** 数据根目录（定位 data/，测试注入用） */
  dataDir?: string;
  /** 覆盖引擎版本（测试注入用） */
  engineVersion?: string;
  /** 只返回内容不落盘（测试/预览用） */
  dryRun?: boolean;
}

/** 导出结果 */
export interface ExportRuleCorpusResult {
  ok: boolean;
  /** 落盘的文件绝对路径（dryRun 时为空数组） */
  files: string[];
  /** 签名（无密钥时为 null——告警不阻断） */
  hmac: string | null;
  body: RuleCorpusBody;
  /** 导出审计事件（调用方落 decision-log 或 audit 事件面） */
  auditEvent: { event: 'corpus_export'; scope: string; ruleCount: number; signed: boolean; at: string };
}

/**
 * 规则语料导出——JSON + YAML 双格式落盘 + HMAC 签名。
 *
 * 密钥纪律（同 audit-history）：~/.sofagent-key 缺失时签名段给 null 并
 * 在结果里标记 signed: false（告警不阻断——脱敏聚合数据非个体级，但
 * 消费侧应校验签名存在性后再入训练管线）。
 */
export function exportRuleCorpus(opts: ExportRuleCorpusOptions = {}): ExportRuleCorpusResult {
  const scope = opts.scope ?? 'all';
  const body = buildRuleCorpusBody(scope, opts.engineVersion);
  const key = getHmacKey();
  const hmac = key ? signBody(body, key) : null;

  const auditEvent = {
    event: 'corpus_export' as const,
    scope,
    ruleCount: body.counts.totalSlots,
    signed: hmac !== null,
    at: body.exportedAt,
  };

  if (opts.dryRun) {
    return { ok: true, files: [], hmac, body, auditEvent };
  }

  const base = opts.outDir ?? join(opts.dataDir ?? 'data', 'export', 'corpus');
  mkdirSync(base, { recursive: true });

  const exportObj: RuleCorpusExport = { body, ...(hmac ? { hmac } : {}) };
  const jsonPath = join(base, `rules-${scope}.json`);
  const yamlPath = join(base, `rules-${scope}.yaml`);
  writeFileSync(jsonPath, JSON.stringify(exportObj, null, 2), 'utf-8');
  writeFileSync(yamlPath, jsonToYaml(exportObj), 'utf-8');

  return { ok: existsSync(jsonPath) && existsSync(yamlPath), files: [jsonPath, yamlPath], hmac, body, auditEvent };
}
