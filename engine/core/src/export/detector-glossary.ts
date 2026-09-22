// ============================================================
// detector-glossary.ts · v1.5.1 T8 · L1 企业专名词典检测器（最高优先级零模型）
// ============================================================
//
// 从企业已有结构化数据自动生成实体名单（v1.5.1 本版最高优先级件）：
//   - 知识库 entity/concept 名录（listEntities 产出的名称清单）
//   - 客户/供应商/项目代号表（CSV/Excel 经 data-ingest 接入后的记录）
//   - 手工录入名录（redact-rules.json entities 同源语义）
//
// 零模型、零算力、零部署——制造业客户的敏感数据（客户名/产品代号/工艺
// 参数）多已在企业既有名录里，覆盖率常优于通用 NER（通用 NER 不认识
// 企业内部代号），投入产出比最高。
//
// 匹配语义：全词不区分大小写（企业专名多为多字节中文——无需词边界
// 正则；英文代号用两侧非字母数字断言防子串误命中）。
// 置信度：词典命中固定 0.9（高置信——名单即事实，直接替换档）。
// ============================================================

import {
  type Detector,
  type SensitiveSpan,
} from './detector-registry';
import { toPresidioType } from './detector-presidio-schema';

/** 词典条目（企业专名 → 占位符） */
export interface GlossaryEntry {
  /** 企业专名（原文——大小写不敏感匹配） */
  term: string;
  /** 占位符（如 {CUSTOMER_NAME}——缺省 {GLOSSARY}） */
  placeholder?: string;
  /** 专名类别（organization/person/product/project——Presidio 类型细分） */
  kind?: string;
}

/** L1 检测器名（注册表键） */
export const L1_GLOSSARY_DETECTOR_NAME = 'l1-glossary';

/** 词典加载结果（fail-closed：坏输入给空词典 + issues 登记，不崩） */
export interface GlossaryLoadResult {
  entries: GlossaryEntry[];
  issues: string[];
}

/**
 * 从 IngestRecord 风格记录构建词典（CSV/Excel 经 data-ingest 接入后的形态）。
 *
 * @param records 中间格式记录（fields: 列名 → 值）
 * @param column 列名（该列的值即企业专名——如「客户名」列）
 * @param kind 专名类别（缺省 organization）
 * @param placeholderPrefix 占位符前缀（缺省 GLOSSARY——条目占位符形如 {GLOSSARY:0}）
 */
export function buildGlossaryFromRecords(
  records: ReadonlyArray<{ fields: Record<string, unknown> }>,
  column: string,
  opts: { kind?: string; placeholderPrefix?: string } = {},
): GlossaryLoadResult {
  const issues: string[] = [];
  const entries: GlossaryEntry[] = [];
  const prefix = opts.placeholderPrefix ?? 'GLOSSARY';
  const kind = opts.kind ?? 'organization';
  let idx = 0;
  for (const rec of records) {
    const v = rec.fields[column];
    if (typeof v !== 'string' || v.trim() === '') {
      issues.push(`记录列 ${column} 非字符串或空——跳过`);
      continue;
    }
    entries.push({ term: v.trim(), placeholder: `{${prefix}:${idx}}`, kind });
    idx += 1;
  }
  return { entries, issues };
}

/**
 * 从知识库 entity 名录构建词典（listEntities 产出的名称清单）。
 *
 * @param names entity/concept 名称数组
 * @param kind 缺省 organization（knowledge entity 多为组织/业务对象）
 */
export function buildGlossaryFromEntityNames(
  names: readonly string[],
  opts: { kind?: string; placeholderPrefix?: string } = {},
): GlossaryLoadResult {
  const issues: string[] = [];
  const entries: GlossaryEntry[] = [];
  const prefix = opts.placeholderPrefix ?? 'GLOSSARY';
  const kind = opts.kind ?? 'organization';
  let idx = 0;
  for (const n of names) {
    if (typeof n !== 'string' || n.trim() === '') {
      issues.push('entity 名为空——跳过');
      continue;
    }
    // 过短名（单字）误报面大——登记但不入词典（交人审扩充）
    if (n.trim().length < 2) {
      issues.push(`entity 名「${n}」过短（<2 字符，误报面大）——不入词典`);
      continue;
    }
    entries.push({ term: n.trim(), placeholder: `{${prefix}:${idx}}`, kind });
    idx += 1;
  }
  return { entries, issues };
}

/** 词条转正则（含中文直接匹配；纯 ASCII 词条加词边界断言防子串误命中） */
function termToRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 纯 ASCII 词条：两侧断言非字母数字（「Acme」不命中「AcmeCorp」中段）
  if (/^[\x20-\x7e]+$/.test(term)) {
    return new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'gi');
  }
  return new RegExp(escaped, 'gi');
}

/**
 * L1 词典检测器（企业专名——最高优先级零模型）。
 *
 * 注册顺序建议：L1 先于 L0/L2（短专名先定位，避免被 L0 密钥占位符
// 替换后的文本错位）；聚合层的长吞短规则会消解重叠。
 */
export function createGlossaryDetector(glossary: readonly GlossaryEntry[]): Detector {
  // 预编译（词典通常百级——构造期一次编译，检测期纯执行）
  const compiled = glossary
    .filter((g) => g.term.length > 0)
    .map((g) => ({ ...g, re: termToRegex(g.term) }));
  return {
    name: L1_GLOSSARY_DETECTOR_NAME,
    layer: 'L1',
    detect(text: string): SensitiveSpan[] {
      const out: SensitiveSpan[] = [];
      for (const g of compiled) {
        g.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = g.re.exec(text)) !== null) {
          out.push({
            start: m.index,
            end: m.index + m[0].length,
            text: m[0],
            label: g.term,
            entityType: toPresidioType(g.kind ?? 'organization'),
            score: 0.9, // 名单即事实——高置信直接替换档
            detector: L1_GLOSSARY_DETECTOR_NAME,
            layer: 'L1',
          });
          if (m[0].length === 0) g.re.lastIndex += 1;
        }
      }
      return out;
    },
  };
}

/** 词典占位符提取（span → 替换占位符——无 placeholder 的条目给 {GLOSSARY}） */
export function placeholderOf(entry: { placeholder?: string }): string {
  return entry.placeholder ?? '{GLOSSARY}';
}
