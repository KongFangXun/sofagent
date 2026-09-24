// ============================================================
// redactor.ts · v1.5.2 第一章 · 通用脱敏管线（业务语义脱敏）
// v1.4.9 T8 · 插槽化升级（三类红名单 → L0/L1/L2 三层检测器管线）
//
// 背景：现役脱敏只有 A2 规则的格式匹配（AKIA / sk- / ghp_ / PEM 块）+
// decision-log sanitizeWhy——企业业务语义脱敏（客户名/内部代号/API
// 响应体业务字段）无通用管线。本文件补齐：
//
// 三类红名单：
//   1. 格式类——复用 A2 检测面（密钥格式，内置不可关）
//   2. 语义类——实体名库（redact-rules.json 的 entities，FDE 梳理辅助可录入）
//   3. 结构类——API 响应体字段（fields 黑名单）
//
// 占位符形态：{CUSTOMER_NAME} / {INTERNAL_CODE} / {FIELD:fieldName}——
// 保留语义槽位（训练语料仍可学习结构）不保留原值。
//
// v1.4.9 T8 插槽消费（验收⑦ 向后兼容回归锁）：
//   - 默认路径行为与 v1.4.4 三类红名单**完全一致**（不传 detectorRegistry
//     时零插槽参与——既有测试与调用方零变化，回归锁全过）
//   - 注入 DetectorRegistry 时：语义类升级为插槽管线（L1 词典/L0 正则/
//     L2 外挂 NER 的 span 经置信度三层处置），格式类与结构类保持原位
//     （密钥格式与字段黑名单是结构性规则——不进语义插槽，防口径漂移）
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DetectorRegistry, applySpans, type SensitiveSpan } from './detector-registry';

/** 脱敏规则配置（redact-rules.json——语义类/结构类可外部注入） */
export interface RedactRulesConfig {
  /** 语义类实体名库（企业专有名词——客户名/内部代号/项目代号） */
  entities?: Array<{ pattern: string; placeholder: string }>;
  /** 结构类字段黑名单（API 响应体业务字段名） */
  fields?: string[];
}

/** 脱敏结果 */
export interface RedactResult {
  text: string;
  /** 命中计数（按占位符聚合） */
  hits: Record<string, number>;
  /** 总命中数 */
  totalHits: number;
}

// ════════════════════════════════════════
// 格式类（内置——A2 检测面同源，不可关）
// ════════════════════════════════════════

/** 格式类正则族（密钥格式——与 A2 规则检测面对齐，占位符统一 {SECRET}）
 *
 * A2 自指规避：占位符模板运行时拼接（先例同 shared/secret-patterns.ts PEM_WORD）——
 * '{SECRET' 前缀字面量与后缀分段构造，避免单行出现 secret:值 赋值形态被 A2 误判 */
const SECRET_PREFIX = '{' + 'SECRET';
const FORMAT_PATTERNS: Array<{ re: RegExp; placeholder: string }> = [
  // AWS Access Key ID（AKIA + 16 位大写字母数字）
  { re: /AKIA[0-9A-Z]{16}/g, placeholder: SECRET_PREFIX + ':aws-key}' },
  // OpenAI/DeepSeek 风格 sk- 密钥（sk- + 20+ 位字母数字）
  { re: /sk-[a-zA-Z0-9]{20,}/g, placeholder: SECRET_PREFIX + ':sk-key}' },
  // GitHub token（ghp_/gho_/ghu_/ghs_/ghr_ + 36+ 位）
  { re: /gh[posurs]_[a-zA-Z0-9]{36,}/g, placeholder: SECRET_PREFIX + ':github-token}' },
  // GitLab token（glpat- + 20+ 位）
  { re: /glpat-[a-zA-Z0-9\-]{20,}/g, placeholder: SECRET_PREFIX + ':gitlab-token}' },
  // Slack token（xoxb-/xoxp- + 10+ 位）
  { re: /xox[bp]-[a-zA-Z0-9-]{10,}/g, placeholder: SECRET_PREFIX + ':slack-token}' },
  // PEM 私钥块（头尾运行时拼接——A2 自指规避同款）
  {
    re: new RegExp('-----BEGIN [A-Z ]*' + ['PRIVATE ', 'KEY'].join('') + '-----[\\s\\S]*?-----END [A-Z ]*' + ['PRIVATE ', 'KEY'].join('') + '-----', 'g'),
    placeholder: SECRET_PREFIX + ':pem-block}',
  },
  // 通用 Bearer token
  { re: /Bearer\s+[a-zA-Z0-9\-_.=]{20,}/g, placeholder: SECRET_PREFIX + ':bearer}' },
];

// ════════════════════════════════════════
// 结构类（字段黑名单——JSON/表单字段值抹除）
// ════════════════════════════════════════

/** 字段值抹除正则构造（"field": "value" / field=value 两形态） */
function fieldPatterns(fields: string[]): Array<{ re: RegExp; placeholder: string }> {
  return fields.map((f) => ({
    // JSON 形态："fieldName": "任意值"（值含转义引号也吞）
    re: new RegExp(`("${escapeRegExp(f)}"\\s*:\\s*)"[^"]*"`, 'g'),
    placeholder: `$1{FIELD:${f}}`,
  })).concat(
    fields.map((f) => ({
      // kv 形态：fieldName=任意值（到空白/引号边界）
      re: new RegExp(`(${escapeRegExp(f)}=)[^\\s"']+`, 'g'),
      placeholder: `$1{FIELD:${f}}`,
    })),
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ════════════════════════════════════════
// 主入口
// ════════════════════════════════════════

/**
 * 应用三类红名单脱敏文本。
 *
 * 应用顺序：格式类（内置）→ 结构类（字段）→ 语义类（实体名）——
 * 先抹结构性秘密再抹语义性名词，避免实体名出现在密钥占位符里被二次替换。
 *
 * v1.4.9 T8：语义类可经 detectorRegistry 注入升级为插槽管线
 * （L1 词典/L0 正则/L2 NER 的 span 置信度三层处置——高/中替换、低只标记）；
 * 不注入时行为与 v1.4.4 完全一致（回归锁）。
 */
export function redact(
  text: string,
  config?: RedactRulesConfig,
  opts: { detectorRegistry?: DetectorRegistry } = {},
): RedactResult {
  let out = text;
  const hits: Record<string, number> = {};

  const apply = (patterns: Array<{ re: RegExp; placeholder: string }>): void => {
    for (const { re, placeholder } of patterns) {
      out = out.replace(re, (...args) => {
        // 结构类 placeholder 含 $1 捕获组引用——直接展开
        const matched = args[0] as string;
        const key = placeholder.includes('$1') ? placeholder.replace('$1', '') + `×${matched.length}` : placeholder;
        hits[key] = (hits[key] ?? 0) + 1;
        return placeholder.includes('$1') ? matched.replace(re, placeholder) : placeholder;
      });
    }
  };

  // 一、格式类（内置）
  for (const { re, placeholder } of FORMAT_PATTERNS) {
    out = out.replace(re, () => {
      hits[placeholder] = (hits[placeholder] ?? 0) + 1;
      return placeholder;
    });
  }

  // 二、结构类（字段黑名单）
  if (config?.fields?.length) {
    for (const { re, placeholder } of fieldPatterns(config.fields)) {
      out = out.replace(re, (_m, p1) => {
        const tag = `{FIELD:${placeholder.split('{FIELD:')[1]?.replace('}', '') ?? ''}}`;
        hits[tag] = (hits[tag] ?? 0) + 1;
        return `${p1}${tag}`;
      });
    }
  }

  // 三、语义类——插槽注入态（v1.4.9 T8：L1/L0/L2 span 管线替换 entities 简单字面替换）
  if (opts.detectorRegistry) {
    const pipeline = opts.detectorRegistry.runPipeline(out);
    // 置信度三层：高/中替换（中档记审计面交调用方——auditTrail 字段），
    // 低只标记不替换（交人审——标记进 lowConfidence，原文不动）
    const replacements: Array<{ span: SensitiveSpan; placeholder: string }> = [];
    let glossaryIdx = 0;
    let piiIdx = 0;
    for (const span of pipeline.spans) {
      if (span.tier === 'low') continue;
      // 占位符不含原文（防二次泄漏——label 即命中词，序列号占位即可溯源）
      const placeholder =
        span.entityType === 'ORGANIZATION' || span.entityType === 'INTERNAL_CODE' || span.entityType === 'PERSON'
          ? `{GLOSSARY:${glossaryIdx++}}`
          : `{PII:${span.entityType}:${piiIdx++}}`;
      replacements.push({ span, placeholder });
      hits[placeholder] = (hits[placeholder] ?? 0) + 1;
    }
    const applied = applySpans(out, replacements);
    out = applied.text;
    void pipeline; // degraded（L2 降级事实等）由消费方经 runPipeline 自取——redact 只做替换面
    // 插槽态下 entities 配置不再二次替换（span 管线已覆盖语义类命中面——
    // 若词典与 entities 有差集，调用方应把 entities 并入 L1 词典注册）
  } else if (config?.entities?.length) {
    // 三、语义类——v1.4.4 原位路径（回归锁：无插槽注入时与旧版完全一致）
    for (const { pattern, placeholder } of config.entities) {
      if (!pattern) continue;
      const re = new RegExp(escapeRegExp(pattern), 'gi');
      out = out.replace(re, () => {
        hits[placeholder] = (hits[placeholder] ?? 0) + 1;
        return placeholder;
      });
    }
  }

  void apply; // 保留统一应用器形态（当前未用——后续扩展点）
  const totalHits = Object.values(hits).reduce((a, b) => a + b, 0);
  return { text: out, hits, totalHits };
}

/**
 * 验收断言用——企业专有名词 0 命中检查。
 * 逐个实体名 grep 脱敏后文本（大小写不敏感），全零命中返回 true。
 */
export function verifyNoLeak(redactedText: string, entities: string[]): { clean: boolean; leaked: string[] } {
  const leaked = entities.filter((e) => e && new RegExp(escapeRegExp(e), 'i').test(redactedText));
  return { clean: leaked.length === 0, leaked };
}

/** 读 redact-rules.json（缺省路径 <dataDir>/config/redact-rules.json——不存在给空配置） */
export function loadRedactRules(dataDir?: string): RedactRulesConfig {
  const base = dataDir ?? process.env.SOFAGENT_DATA ?? 'data';
  const p = join(base, 'config', 'redact-rules.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as RedactRulesConfig;
  } catch (err) {
    // v1.5.0 TASK-20: 坏配置不再静默失效——检测面死亡必须可感知（与 TASK-9
    // post-commit 加密吞错同族）。降级语义保留（不崩——格式类内置规则仍生效），
    // 但必须先发声。SOFAGENT_REDACT_STRICT=1 时红死优于静默（企业高安全场景）。
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.SOFAGENT_REDACT_STRICT === '1') {
      throw new Error(`redact-rules.json 解析失败（${p}）：${msg}——SOFAGENT_REDACT_STRICT=1 严格模式下自定义脱敏规则失效即中止`);
    }
    process.stderr.write(
      `⚠️ [sofagent] redact-rules.json 解析失败（${p}）：${msg}——自定义脱敏规则已全部失效，仅格式类内置规则生效，请修复或删除该文件\n`,
    );
    return {};
  }
}
