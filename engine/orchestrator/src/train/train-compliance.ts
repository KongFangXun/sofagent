// train-compliance.ts · v1.4.5 第三章 · 训练数据合规扫描（train compliance）
//
// 定位：合规红线的代码化闸门——训练集进训练前先过合规检查（个保法 PII /
// 敏感字段 / 企业专有名词三类风险项）。v1.4.4 的 redactor 在语料导出时
// 脱敏（导出闸防「泄漏出去」），本模块在训练管线入口检查（训练闸防
// 「不该训的数据进了训练」）——**检测能力共用（复用 redactor 红名单 +
// REDACTION_PATTERNS），处置逻辑独立（两道闸不合并）**。
//
// ── spec（最小接口签名 + 数据结构 · spec-first）──
//
//   type DataProvenance = 'enterprise' | 'synthetic' | 'public';
//   type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low';
//   type ComplianceAction = 'redact' | 'remove' | 'human-review' | 'pass';
//
//   interface ComplianceFinding {
//     kind: 'pii' | 'sensitive-field' | 'proprietary-noun' | 'secret';
//     severity: ComplianceSeverity;
//     matchedPattern: string;      // 命中形态描述（不含原文——报告不留敏感值）
//     sampleCount: number;         // 命中样本行数
//     action: ComplianceAction;    // 处置建议
//     advice: string;              // 人读处置说明
//   }
//
//   interface ComplianceReport {
//     datasetId: string; version: string; enterpriseId: string;
//     scannedAt: string; sampleCount: number;
//     provenance: DataProvenance;  // 数据来源标记
//     findings: ComplianceFinding[];
//     passed: boolean;             // 无 critical/high 即过闸
//     blockedBy?: string;          // 未过闸时的阻断原因
//   }
//
//   function scanDatasetCompliance(input): ComplianceReport;   // 扫描（纯读）
//   function assertComplianceGate(report): void;               // 闸门（阻断提交）
//   function markProvenance(dataDir, ent, datasetId, ver, p): DatasetVersionRecord;
//
// 严重度映射（规则驱动——可审计可解释）：
//   - 密钥（REDACTION_PATTERNS 命中）→ critical（阻断——密钥进训练集零容忍）
//   - 身份证 / 敏感字段（健康·财务）→ critical（阻断——个保法敏感个人信息）
//   - 手机号 → high（阻断——PII 需先脱敏）
//   - 企业专有名词（redactor entities 命中）→ medium（人工确认——专有词
//     是否可训由企业自定，不代为决定）

import { readFileSync } from 'fs';
import { REDACTION_PATTERNS, redact, loadRedactRules } from '@sofagent/core';
import { getDatasetVersion, recordDatasetVersion, type DatasetVersionRecord } from './dataset-version';

// ════════════════════════════════════════
// 数据模型（spec 落地）
// ════════════════════════════════════════

/** 数据来源标记（合规可追溯——训练集记录来源三分类） */
export type DataProvenance = 'enterprise' | 'synthetic' | 'public';

/** 严重度四级（critical/high 阻断训练提交；medium/low 记录放行） */
export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low';

/** 处置建议（脱敏 / 剔除 / 人工确认 / 无需处置） */
export type ComplianceAction = 'redact' | 'remove' | 'human-review' | 'pass';

/** 风险项分类（四类——PII/敏感字段/专有名词/密钥） */
export type ComplianceFindingKind = 'pii' | 'sensitive-field' | 'proprietary-noun' | 'secret';

/** 单条合规发现（报告单元——不含命中原文，只有形态与计数） */
export interface ComplianceFinding {
  kind: ComplianceFindingKind;
  severity: ComplianceSeverity;
  /** 命中形态描述（如「中国大陆手机号」「身份证号」「health_status 字段」） */
  matchedPattern: string;
  /** 命中样本行数（第几行不记——报告粒度到计数不到行号，防报告反成泄露面） */
  sampleCount: number;
  action: ComplianceAction;
  /** 人读处置建议 */
  advice: string;
}

/** 合规报告（写训练集版本——dataset-version 扩展字段） */
export interface ComplianceReport {
  datasetId: string;
  version: string;
  enterpriseId: string;
  scannedAt: string;
  /** 训练集样本数（扫描口径） */
  sampleCount: number;
  /** 数据来源标记（企业提供/合成/公开语料） */
  provenance: DataProvenance;
  findings: ComplianceFinding[];
  /** 闸门结论（无 critical/high 即 true） */
  passed: boolean;
  /** 未过闸时的阻断原因（passed=false 时非空） */
  blockedBy?: string;
}

/** 合规闸门异常（阻断训练提交——train-submit 路径消费） */
export class ComplianceGateError extends Error {
  readonly report: ComplianceReport;
  constructor(message: string, report: ComplianceReport) {
    super(`[train-compliance] ${message}`);
    this.name = 'ComplianceGateError';
    this.report = report;
  }
}

// ════════════════════════════════════════
// 检测正则（PII / 敏感字段——redactor 检测面之外的增量红名单）
// ════════════════════════════════════════

/**
 * PII / 敏感字段检测正则族（本模块自持）。
 *
 * 复用声明（铁律：复用不重写）：
 *   - 密钥检测：REDACTION_PATTERNS（core 包——与 redactor 同源）
 *   - 企业专有名词：redact-rules.json 的 entities（loadRedactRules 同源）
 *   - 手机号：REDACTION_PATTERNS #10 已含（PII 检测复用，此处只分类不复测）
 * 本文件只补 redactor 检测面没有的身份证号与敏感字段两类。
 */
const ID_CARD_RE = /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g;

/** 敏感字段黑名单（健康/财务——字段名命中即报 critical） */
const SENSITIVE_FIELD_NAMES: readonly string[] = [
  'health', 'health_status', 'medical', 'diagnosis', '病历', '健康',
  'salary', 'income', 'financial', 'bank_account', 'credit', '财务', '薪酬', '病历号',
];

// ════════════════════════════════════════
// 扫描主流程
// ════════════════════════════════════════

/** 扫描入参 */
export interface ScanComplianceInput {
  dataDir: string;
  enterpriseId: string;
  datasetId: string;
  version: string;
  /** 数据来源标记（缺省 enterprise——企业提供是后训主路径） */
  provenance?: DataProvenance;
  /** 时钟注入（测试——缺省 Date.now） */
  now?: () => number;
}

/**
 * 扫描训练集合规风险（纯读——不修改数据集本体）。
 *
 * 检测三源（检测能力与 v1.4.4 redactor 共用，处置逻辑独立）：
 *   一、REDACTION_PATTERNS（密钥 + 手机号——与导出闸同源检测面）
 *   二、身份证号 + 敏感字段（本模块增量红名单）
 *   三、redact-rules.json entities（企业专有名词——FDE 梳理录入的实体名库）
 *
 * 报告纪律：findings 只记形态与计数，不记命中原文（合规报告本身不得成为
 * 二次泄露面——与 audit 脱敏铁律同哲学）。
 *
 * @throws 数据集版本不存在（缺版本记录 = 无从扫描——fail fast）
 */
export function scanDatasetCompliance(input: ScanComplianceInput): ComplianceReport {
  const versionRecord = getDatasetVersion(
    input.dataDir,
    input.enterpriseId,
    input.datasetId,
    input.version,
  );
  if (versionRecord === null) {
    throw new Error(
      `[train-compliance] 数据集版本不存在：${input.datasetId}@${input.version}（enterprise=${input.enterpriseId}）——先构建训练集再扫描`,
    );
  }

  // 数据集本体读取（坏文件按空处理——空数据集无风险项但 sampleCount=0）
  let content = '';
  try {
    content = readFileSync(versionRecord.datasetFile, 'utf-8');
  } catch {
    content = '';
  }
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  const sampleCount = lines.length;
  const findings: ComplianceFinding[] = [];

  // ── 一、密钥 + 手机号（检测能力与 redactor/REDACTION_PATTERNS 同源）──
  // 密钥面走 redact() 的 FORMAT_PATTERNS（hits 按 placeholder 聚合——天然
  // 满足「不留原文」的报告纪律）；手机号是 REDACTION_PATTERNS #10 的 PII
  // 项（不在 redact() 的 FORMAT_PATTERNS 内），单独计数——同一正则源
  // import 复用，检测能力共用、处置逻辑独立。
  // ⚠️ hits 里除密钥占位符外还混着 entities 替换占位符（{CUSTOMER_NAME}
  // 等）——那归第三类专有名词，此处按 entities 配置排除，不重复计。
  const rules = loadRedactRules(input.dataDir);
  const entityPlaceholders = new Set((rules.entities ?? []).map((e) => e.placeholder));
  const redactResult = redact(content, rules);
  for (const [placeholder, count] of Object.entries(redactResult.hits)) {
    if (count === 0) continue;
    if (entityPlaceholders.has(placeholder)) continue; // 语义类占位符——第三类消费
    // 密钥：critical（阻断——密钥进训练集零容忍）
    findings.push({
      kind: 'secret',
      severity: 'critical',
      matchedPattern: `密钥格式（${placeholder}）`,
      sampleCount: count,
      action: 'remove',
      advice: `发现 ${count} 处密钥形态文本——剔除涉密样本后重建数据集（密钥进训练零容忍，脱敏也不行）`,
    });
  }
  // 手机号（REDACTION_PATTERNS #10 同一检测面——非密钥类 PII 单列 high）
  const phonePattern = REDACTION_PATTERNS.find((p) => p.replacement.includes('1**'));
  if (phonePattern) {
    const phoneMatches = content.match(phonePattern.pattern);
    if (phoneMatches !== null && phoneMatches.length > 0) {
      findings.push({
        kind: 'pii',
        severity: 'high',
        matchedPattern: '个人可识别信息（中国大陆手机号）',
        sampleCount: phoneMatches.length,
        action: 'redact',
        advice: `发现 ${phoneMatches.length} 处手机号——过脱敏管线（redactor）后重扫，通过再提交`,
      });
    }
  }

  // ── 二、身份证号（增量红名单——critical）──
  const idCardHits = content.match(ID_CARD_RE);
  if (idCardHits !== null && idCardHits.length > 0) {
    findings.push({
      kind: 'pii',
      severity: 'critical',
      matchedPattern: '身份证号（18 位 GB 11643 格式）',
      sampleCount: idCardHits.length,
      action: 'remove',
      advice: `发现 ${idCardHits.length} 处身份证号——个保法敏感个人信息，剔除涉敏样本（不可仅脱敏）`,
    });
  }

  // ── 二（续）、敏感字段（健康/财务——JSON 行字段名命中即报）──
  let sensitiveFieldLines = 0;
  const sensitiveFieldNamesHit: string[] = [];
  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 非 JSON 行（文本数据集）——字段级检查跳过
    }
    for (const key of Object.keys(parsed)) {
      if (SENSITIVE_FIELD_NAMES.some((f) => key.toLowerCase().includes(f))) {
        sensitiveFieldLines += 1;
        if (!sensitiveFieldNamesHit.includes(key)) sensitiveFieldNamesHit.push(key);
        break; // 单行命中一次即计（行粒度计数）
      }
    }
  }
  if (sensitiveFieldLines > 0) {
    findings.push({
      kind: 'sensitive-field',
      severity: 'critical',
      matchedPattern: `敏感字段（${sensitiveFieldNamesHit.slice(0, 5).join('、')}${sensitiveFieldNamesHit.length > 5 ? ' 等' : ''}）`,
      sampleCount: sensitiveFieldLines,
      action: 'human-review',
      advice: `${sensitiveFieldLines} 行含健康/财务类敏感字段——个保法敏感个人信息，人工确认数据获取同意链后剔除或匿名化`,
    });
  }

  // ── 三、企业专有名词（redactor entities 同源——medium 人工确认）──
  const entityNames = (rules.entities ?? []).map((e) => e.pattern).filter((p) => p.length > 0);
  const entityHits = entityNames.filter((name) => content.toLowerCase().includes(name.toLowerCase()));
  if (entityHits.length > 0) {
    findings.push({
      kind: 'proprietary-noun',
      severity: 'medium',
      matchedPattern: `企业专有名词（${entityHits.slice(0, 5).join('、')}${entityHits.length > 5 ? ' 等' : ''}）`,
      sampleCount: entityHits.length,
      action: 'human-review',
      advice: `发现 ${entityHits.length} 个企业专有名词（redact-rules.json entities 命中）——专有词是否可训由企业合规自定，人工确认`,
    });
  }

  // ── 闸门结论（critical/high 即阻断——对齐质量闸门模式）──
  const blockers = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const passed = blockers.length === 0;
  const report: ComplianceReport = {
    datasetId: input.datasetId,
    version: input.version,
    enterpriseId: input.enterpriseId,
    scannedAt: new Date((input.now ?? Date.now)()).toISOString(),
    sampleCount,
    provenance: input.provenance ?? 'enterprise',
    findings,
    passed,
    ...(passed ? {} : { blockedBy: `${blockers.length} 项 critical/high 发现未处置（${blockers.map((b) => b.matchedPattern).join('；')}）——处理完重扫通过再提交训练` }),
  };
  return report;
}

// ════════════════════════════════════════
// 合规闸门（阻断训练提交）
// ════════════════════════════════════════

/**
 * 合规闸门断言——严重级发现存在即抛 ComplianceGateError（阻断训练提交）。
 *
 * 挂载点：训练提交路径（train-submit / continuous-training 触发前）调
 * scanDatasetCompliance 后调本函数——「数据不处理完不让训」。
 * 幂等语义：passed=true 是 no-op；passed=false 抛错（调用方转结构化拒绝）。
 */
export function assertComplianceGate(report: ComplianceReport): void {
  if (report.passed) return;
  throw new ComplianceGateError(
    `合规闸门阻断：数据集 ${report.datasetId}@${report.version} 存在未处置的 critical/high 发现——${report.blockedBy ?? '处置建议见报告 findings'}`,
    report,
  );
}

/**
 * 闸门 + 扫描一体（提交路径便捷入口——scan → gate 两步合一）。
 * @throws ComplianceGateError 严重级发现阻断
 */
export function scanAndGate(input: ScanComplianceInput): ComplianceReport {
  const report = scanDatasetCompliance(input);
  assertComplianceGate(report);
  return report;
}

// ════════════════════════════════════════
// 数据来源标记（写训练集版本）
// ════════════════════════════════════════

/**
 * 数据来源标记——为指定数据集版本补录 provenance 字段。
 *
 * 落盘语义：dataset-version 台账是 append-only；来源标记作为新版本记录
 * 追加（同 contentHash 重新登记，version 后缀 -<provenance> 区分）——不
 * 改写历史行（台账不可变纪律），读取侧按最后一条为准。
 */
export function markProvenance(
  dataDir: string,
  enterpriseId: string,
  datasetId: string,
  version: string,
  provenance: DataProvenance,
  now: () => number = Date.now,
): DatasetVersionRecord {
  const existing = getDatasetVersion(dataDir, enterpriseId, datasetId, version);
  if (existing === null) {
    throw new Error(
      `[train-compliance] 数据集版本不存在：${datasetId}@${version}——先构建再标记来源`,
    );
  }
  return recordDatasetVersion(
    {
      dataDir,
      enterpriseId,
      datasetId,
      contentHash: existing.contentHash,
      sampleCount: existing.sampleCount,
      algorithm: existing.algorithm,
      columnMapping: existing.columnMapping,
      datasetFile: existing.datasetFile,
      createdAt: new Date(now()).toISOString(),
      provenance,
    },
    `${version}#${provenance}`,
  );
}
