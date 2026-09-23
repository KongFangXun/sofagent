// ============================================================
// ruleset-export.ts · v1.5.2 章二 · 规则集导出（开放规则格式 · 双向可逆）
//
// 定位：把 24 条 TS 硬编码审计规则导出为**机器可读 JSON**，且该 JSON 与
// v1.2.9 `--ruleset-path` 加载格式**同构**——导出格式即加载格式，双向可逆：
//   导出物 → loadRulesetFile() 能读出 + validateRuleset() 不报错。
// 这是「约束导出通道」（规划文档 §2.5 四缺口最后一块）的落地面。
//
// 开放规则格式（引擎与语料分离）落地口径：
//   每条导出规则 = 一条 `type: 'pattern'` 的 RulesetRule——pattern 由规则自带的
//   违规样例（examples.match）正则转义后锚定。消费方引擎加载该 ruleset 后，对随
//   导出物走的样例跑一遍即可自证合规（自证机制见 MCP tool / 单测）。导出物不携带
//   任何引擎私有语义（判定函数体不导出）——能被第三方引擎消费的才是开放格式。
//
// 元数据承载：每条规则除 RulesetRule 必需面（id/name/severity/type/pattern/message）
//   外，另带训练消费元数据（rule_id/intent/sampleViolation，来自 export-metadata.ts）。
//   validateRuleset() 只校验必需字段、**忽略未知字段**（见 ruleset-loader.ts:141-197）——
//   故扩展字段随 ruleset JSON round-trip 原样保留，不破坏可加载性。
//
// 版本与指纹：
//   - 版本号：ruleset.version（规则集版本，缺省对齐 audit 包 package.json 版本）
//   - 内容指纹：对规则体做 stableStringify 后 sha256/hmac 取前 32 位 hex——
//     与 @sofagent/core 的 signBody 口径一致（复用 signBody，不重造）；
//     无 HMAC 密钥时降级 sha256（仍 32 hex），消费侧校验签名存在性后入管线。
//   指纹**不含** volatile 段（exportedAt）——同内容恒同指纹，规则变更即指纹变。
//
// 审计留痕：每次导出写一条 history.jsonl（谁在何时导出了哪个版本的规则集 + 指纹）。
//   ⚠️ appendHistory 会写真实数据目录——测试必须传临时 dataDir（禁止污染 ~/.sofagent）。
//
// 只读语义：导出只读规则源（defaultRules/extendedRules 内存数组）+ 只写导出产物，
//   不修改任何规则源文件。
// ============================================================

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { getHmacKey, stableStringify } from '@sofagent/core';
import { defaultRules, extendedRules } from '../rules/index';
import type { Rule } from '../rules/types';
import { buildExportMetadata, type RuleExportMetadata } from '../rules/export-metadata';
import { appendHistory } from '../audit-history';
import { signBody } from './exporter';

/** 导出 schema 版本（与 v1.5.1 规则语料导出的 RULE_EXPORT_SCHEMA_VERSION 对齐） */
export const RULESET_EXPORT_SCHEMA_VERSION = 'v1';

/** 默认规则集名称（对齐内置 rulesets/sofagent.json） */
export const DEFAULT_RULESET_NAME = 'sofagent';

/** 导出物顶层元信息（ruleset.version 语义见文件头「版本与指纹」） */
export const RULESET_AUTHOR = 'sofagent';
export const RULESET_HOMEPAGE = 'https://github.com/KongFangXun/sofagent';

/** 指纹算法标注（有 HMAC 密钥 / 无密钥降级） */
export type FingerprintAlgo = 'hmac-sha256' | 'sha256';

/**
 * 导出规则的形态——RulesetRule 必需面（保证可被 loadRulesetFile 加载）+
 * 训练消费元数据扩展面（rule_id/intent/sampleViolation）。
 * 结构上是 RulesetRule 的超集，故整体可赋给 Ruleset。
 */
export interface ExportedRulesetRule {
  // ── RulesetRule 必需面 ──
  /** 规则唯一 ID（= Rule.id；同时作为训练消费的 rule_id） */
  id: string;
  /** 规则显示名 */
  name: string;
  /** 规则描述（拦截理由优先） */
  description?: string;
  /** 严重级别：FAIL = 违规（exit 2）/ WARN = 警告（exit 1） */
  severity: 'FAIL' | 'WARN';
  /** 规则类型（本导出恒为 pattern——开放格式，第三方引擎可消费） */
  type: 'pattern';
  /** 正则匹配模式（由违规样例锚定） */
  pattern: string;
  /** 命中时输出的消息模板（用检测意图——人类可读） */
  message: string;
  // ── 训练消费元数据扩展面（validateRuleset 忽略未知字段，可安全随 ruleset 走）──
  /** 训练消费 rule_id（与 id 同值，显式承载以满足元数据契约） */
  rule_id: string;
  /** 检测意图 */
  intent: string;
  /** 违规样例 */
  sampleViolation: string;
  /** 违规样例来源 */
  sampleViolationSource: 'examples.match' | 'synthesized';
}

/** 导出的规则集（Ruleset 的超集——可直接 loadRulesetFile 回读） */
export interface ExportedRuleset {
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  /** 导出 schema 版本（格式兼容性判定） */
  schemaVersion: string;
  /** 生成时间（ISO 8601——volatile，不参与指纹） */
  exportedAt: string;
  /** 内容指纹（32 hex） */
  fingerprint: string;
  /** 指纹算法标注 */
  fingerprintAlgo: FingerprintAlgo;
  /** 规则计数（FAIL/WARN 分桶对账） */
  counts: { total: number; fail: number; warn: number };
  rules: ExportedRulesetRule[];
}

/** 规则集「稳定核心」（指纹输入——不含 volatile 段 exportedAt/fingerprint） */
export interface RulesetCore {
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  schemaVersion: string;
  counts: { total: number; fail: number; warn: number };
  rules: ExportedRulesetRule[];
}

/** buildRulesetExport 入参 */
export interface RulesetExportOptions {
  /** 规则集名称（缺省 'sofagent'） */
  rulesetName?: string;
  /** 规则集版本（缺省读 audit 包 package.json 版本） */
  rulesetVersion?: string;
  /** 规则集描述（缺省自动生成） */
  description?: string;
  /** 数据根目录（appendHistory 定位用；测试注入临时目录） */
  dataDir?: string;
  /** 导出 JSON 落盘目录（缺省 <dataDir|'data'>/export/ruleset） */
  outDir?: string;
  /** 只构造不落盘（预览用）——⚠️ 审计留痕仍写：导出行为本身受审计，dryRun 只抑制产物文件 */
  dryRun?: boolean;
}

/** 导出审计事件（调用方落 audit 事件面） */
export interface RulesetExportAuditEvent {
  event: 'ruleset_export';
  rulesetVersion: string;
  fingerprint: string;
  ruleCount: number;
  signed: boolean;
  at: string;
}

/** buildRulesetExport 结果 */
export interface RulesetExportResult {
  ok: boolean;
  ruleset: ExportedRuleset;
  fingerprint: string;
  fingerprintAlgo: FingerprintAlgo;
  schemaVersion: string;
  rulesetVersion: string;
  ruleCount: number;
  /** 落盘文件绝对路径（dryRun 时为空数组） */
  files: string[];
  auditEvent: RulesetExportAuditEvent;
}

/** 引擎版本读取（audit 包 package.json——失败回退 '0.0.0' 不阻断导出） */
function readEngineVersion(): string {
  try {
    // CJS 编译目标：__dirname 可用；src/export 与 dist/export 两种运行态同构（两层上取包根）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    // package.json 不可读（打包异常）——回退 0.0.0 不阻断导出（版本非导出物核心）
    return '0.0.0';
  }
}

/** 正则元字符转义——样例串作为 pattern 字面锚点时必须转义，否则样例里的 . * 等被当元字符 */
function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 单条元数据 → 导出规则（RulesetRule 必需面 + 训练元数据扩展面） */
function toExportedRule(meta: RuleExportMetadata, rule: Rule): ExportedRulesetRule {
  return {
    id: meta.ruleId,
    name: rule.name,
    ...(rule.justification ? { description: rule.justification } : {}),
    severity: meta.severity,
    type: 'pattern',
    // pattern 由违规样例锚定：消费方引擎可就样例自证合规（转义后为字面匹配）
    pattern: `(${escapeRegexLiteral(meta.sampleViolation)})`,
    message: meta.intent,
    rule_id: meta.ruleId,
    intent: meta.intent,
    sampleViolation: meta.sampleViolation,
    sampleViolationSource: meta.sampleViolationSource,
  };
}

/**
 * 从规则列表构造「稳定核心」——纯函数，不触碰文件系统/审计留痕（可单元测）。
 *
 * @param rules 规则列表
 * @param meta 规则集元信息（name/version/description）
 * @returns 稳定核心（指纹输入）
 */
export function buildRulesetCore(
  rules: Rule[],
  meta: { name: string; version: string; description: string },
): RulesetCore {
  const metadata = buildExportMetadata(rules);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const exportedRules: ExportedRulesetRule[] = metadata.map((m) => {
    const rule = byId.get(m.ruleId);
    if (!rule) {
      // buildExportMetadata 与 rules 同源——构造上不可达，仅为类型收窄
      throw new Error(`规则集构造内部不一致：元数据 ${m.ruleId} 找不到对应规则`);
    }
    return toExportedRule(m, rule);
  });
  const fail = exportedRules.filter((r) => r.severity === 'FAIL').length;
  const warn = exportedRules.length - fail;
  return {
    name: meta.name,
    version: meta.version,
    description: meta.description,
    author: RULESET_AUTHOR,
    homepage: RULESET_HOMEPAGE,
    schemaVersion: RULESET_EXPORT_SCHEMA_VERSION,
    counts: { total: exportedRules.length, fail, warn },
    rules: exportedRules,
  };
}

/**
 * 内容指纹——对规则体做 stableStringify 后 sha256/hmac 取前 32 位 hex。
 *
 * 有 HMAC 密钥 → 复用 signBody（与 audit-history / artifact-signing 同款口径）；
 * 无密钥 → 降级为 sha256（仍 32 hex）——指纹恒存在，「内容变则指纹变」不依赖密钥。
 *
 * @param core 规则集稳定核心（不含 volatile 段）
 * @param key HMAC 密钥（null = 无密钥降级 sha256）
 * @returns 32 位十六进制指纹
 */
export function computeRulesetFingerprint(core: RulesetCore, key: string | null): string {
  if (key) return signBody(core, key);
  return createHash('sha256').update(stableStringify(core)).digest('hex').slice(0, 32);
}

/**
 * 构造导出规则集（纯函数——含指纹，不落盘、不留痕）。
 *
 * @param rules 规则列表
 * @param opts 规则集元信息 + 规则集版本
 * @param key HMAC 密钥（null = 降级 sha256）
 * @returns 完整导出规则集（含 fingerprint/exportedAt）
 */
export function buildExportedRuleset(
  rules: Rule[],
  opts: { name: string; version: string; description: string },
  key: string | null,
): ExportedRuleset {
  const core = buildRulesetCore(rules, opts);
  const fingerprint = computeRulesetFingerprint(core, key);
  return {
    ...core,
    exportedAt: new Date().toISOString(),
    fingerprint,
    fingerprintAlgo: key ? 'hmac-sha256' : 'sha256',
  };
}

/**
 * 规则集导出入口——构造 → 落盘 → 审计留痕（MCP `ruleset_export` / CLI 复用）。
 *
 * 导出内容 = 24 条默认规则（defaultRules 17）+ 扩展规则（extendedRules 7）。
 * 导出物 = 与 `--ruleset-path` 加载格式同构的 Ruleset JSON（双向可逆）。
 *
 * @param opts 导出选项（测试须传临时 dataDir/outDir，避免污染真实数据目录）
 * @returns 导出结果（ruleset + 指纹 + 落盘路径 + 审计事件）
 */
export function buildRulesetExport(opts: RulesetExportOptions = {}): RulesetExportResult {
  const name = opts.rulesetName ?? DEFAULT_RULESET_NAME;
  const version = opts.rulesetVersion ?? readEngineVersion();
  const description =
    opts.description ?? `sofagent 审计规则集导出（${RULESET_EXPORT_SCHEMA_VERSION}）——开放检测规则格式`;
  const rules: Rule[] = [...defaultRules, ...extendedRules];

  const key = getHmacKey();
  const ruleset = buildExportedRuleset(rules, { name, version, description }, key);
  const ruleCount = ruleset.counts.total;

  const auditEvent: RulesetExportAuditEvent = {
    event: 'ruleset_export',
    rulesetVersion: version,
    fingerprint: ruleset.fingerprint,
    ruleCount,
    signed: key !== null,
    at: ruleset.exportedAt,
  };

  // 审计留痕：每次导出写一条 history.jsonl（规则集版本 + 指纹 + 谁在何时导出）
  // ⚠️ 测试必须传临时 dataDir——否则写入开发者真实 ~/.sofagent/data。
  appendHistory(
    {
      timestamp: ruleset.exportedAt,
      diffRange: 'ruleset-export',
      exitCode: 0,
      ruleResults: [],
      diffFileCount: 0,
      task: `导出规则集 ${name}@${version}（规则 ${ruleCount} 条，指纹 ${ruleset.fingerprint}）`,
      commitMsg: `ruleset_export ${name}@${version}`,
      engine: 'ruleset-export',
    },
    opts.dataDir,
  );

  if (opts.dryRun) {
    return {
      ok: true,
      ruleset,
      fingerprint: ruleset.fingerprint,
      fingerprintAlgo: ruleset.fingerprintAlgo,
      schemaVersion: RULESET_EXPORT_SCHEMA_VERSION,
      rulesetVersion: version,
      ruleCount,
      files: [],
      auditEvent,
    };
  }

  const outDir = opts.outDir ?? join(opts.dataDir ?? 'data', 'export', 'ruleset');
  mkdirSync(outDir, { recursive: true });
  const filePath = join(outDir, `ruleset-${name}.json`);
  writeFileSync(filePath, JSON.stringify(ruleset, null, 2), 'utf-8');

  return {
    ok: true,
    ruleset,
    fingerprint: ruleset.fingerprint,
    fingerprintAlgo: ruleset.fingerprintAlgo,
    schemaVersion: RULESET_EXPORT_SCHEMA_VERSION,
    rulesetVersion: version,
    ruleCount,
    files: [filePath],
    auditEvent,
  };
}
