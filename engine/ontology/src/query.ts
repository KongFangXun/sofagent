// ============================================================
// ontology/query.ts · 双时态时点快照 + 渐进加载三层
// v1.5.0 第二章交付：本体数据双时态事实
//
// 设计：
//   - stateAt(date)：返回该时点有效实体集——「上个月报价单上的联系人是谁」
//     可回答。判定式：validFrom ≤ t（或无 validFrom）且（无 validTo 或 t < validTo）。
//   - 渐进加载三层（商业平台机制对账）：entity 摘要（卡片级）→ relations
//     （图结构）→ 页面全文。控制 token 成本——千级实体不全量入窗，
//     超预算自动降层并留痕（降层进审计叙事）。
//   - 检索协议衔接：三层管「喂多少」，检索（语义/关键词/图遍历）管「找哪个」，
//     两者正交——本模块只做前者的预算控制。
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/** 实体摘要（第一层：卡片级——名称 + 类型 + 一句话） */
export interface EntityDigest {
  name: string;
  type: string;
  summary: string;
  validFrom?: string;
  validTo?: string;
}

/** 实体图结构（第二层：关联实体与边类型） */
export interface EntityRelations {
  name: string;
  relations: {
    has_many?: string[];
    belongs_to?: string[];
    depends_on?: string[];
    produces?: string[];
    consumes?: string[];
  };
}

/** 渐进加载层级行政层级——L1 摘要 / L2 关系 / L3 全文 */
export type LoadTier = 1 | 2 | 3;

/** 单次召回的预算账本（token 预算联动 v1.4.8 自动上下文压缩口径） */
export interface TokenBudget {
  /** 本层 token 上限（超限触发降层） */
  maxTokens: number;
  /** 粗估 token 数（字符数 / 4，中文与代码混合场景的通行近似） */
  estimate(text: string): number;
}

/** 默认预算器：maxTokens 默认 8000，估算 = ceil(字符数 / 4) */
export function defaultBudget(maxTokens = 8000): TokenBudget {
  return {
    maxTokens,
    estimate: (text: string) => Math.ceil(text.length / 4),
  };
}

/** 降层留痕记录（超预算触发降层时产出，入审计叙事） */
export interface DowngradeTrace {
  entity: string;
  fromTier: LoadTier;
  toTier: LoadTier;
  reason: 'budget-exceeded';
}

/**
 * 时点有效性判定——双时态核心谓词。
 * 规则：validFrom 缺省 = 自古有效；validTo 缺省 = 仍有效；
 *       有效 ⇔ (无 validFrom 或 validFrom ≤ t) 且 (无 validTo 或 t < validTo)。
 */
export function isValidAt(entity: { validFrom?: string; validTo?: string }, at: string): boolean {
  if (entity.validFrom && entity.validFrom > at) return false;
  if (entity.validTo && at >= entity.validTo) return false;
  return true;
}

/**
 * stateAt —— 时点快照查询。
 * 扫描 knowledge/entities/*.md 的 frontmatter，返回在 `at` 时刻有效的实体集。
 * 旧数据（无 validFrom/validTo 字段）按「永久有效」语义自然兼容。
 */
export function stateAt(knowledgeDir: string, at: string): EntityDigest[] {
  const entitiesDir = join(knowledgeDir, 'entities');
  if (!existsSync(entitiesDir)) return [];
  let files: string[];
  try {
    files = readdirSync(entitiesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out: EntityDigest[] = [];
  for (const file of files) {
    const fm = parseFrontmatterSafe(readFileSync(join(entitiesDir, file), 'utf-8'));
    if (!fm) continue;
    // js-yaml 可能把 ISO 时间串解析为 Date——归一为 ISO 字符串再判定
    const toIso = (v: unknown): string | undefined =>
      v instanceof Date ? v.toISOString() : typeof v === 'string' && v ? v : undefined;
    const validFrom = toIso(fm['validFrom']);
    const validTo = toIso(fm['validTo']);
    if (!isValidAt({ validFrom, validTo }, at)) continue;
    out.push({
      name: (fm['title'] || fm['name'] || file.replace('.md', '')) as string,
      type: (fm['type'] || 'entity') as string,
      summary: (fm['description'] || '') as string,
      validFrom,
      validTo,
    });
  }
  return out;
}

/**
 * 渐进加载三层——按预算逐层取实体内容。
 * L1 摘要（卡片级）→ L2 命中再展开 relations → L3 确需细读才取页面全文。
 * 超预算自动降层（全文→relations→摘要）并留痕——「降了多少、为什么降」可审计。
 *
 * @param names       要加载的实体名列表（检索层已选定「找哪个」，本函数只管「喂多少」）
 * @param budget      token 预算（默认 8000）
 * @param tierHint    期望层级（默认 L3 全文；预算不足时自动降层）
 * @returns 加载结果 + 降层留痕。三层内容同源（摘要/关系都取自同一 frontmatter 与页面，
 *          无第二份表示）。
 */
export function progressiveLoad(
  knowledgeDir: string,
  names: string[],
  budget: TokenBudget = defaultBudget(),
  tierHint: LoadTier = 3,
): { tier: LoadTier; digests: EntityDigest[]; relations: EntityRelations[]; fullTexts: Array<{ name: string; content: string }>; downgrades: DowngradeTrace[] } {
  const entitiesDir = join(knowledgeDir, 'entities');
  const downgrades: DowngradeTrace[] = [];
  const digests: EntityDigest[] = [];
  const relations: EntityRelations[] = [];
  const fullTexts: Array<{ name: string; content: string }> = [];

  let used = 0;
  let achievedTier: LoadTier = tierHint;

  for (const name of names) {
    const filePath = join(entitiesDir, `${name}.md`);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatterSafe(content) ?? {};

    const digest: EntityDigest = {
      name,
      type: (fm['type'] || 'entity') as string,
      summary: (fm['description'] || '') as string,
      validFrom: typeof fm['validFrom'] === 'string' ? fm['validFrom'] : undefined,
      validTo: typeof fm['validTo'] === 'string' ? fm['validTo'] : undefined,
    };
    const rel: EntityRelations = {
      name,
      relations: (fm['relations'] || {}) as EntityRelations['relations'],
    };

    if (achievedTier >= 3) {
      const cost = budget.estimate(content);
      if (used + cost <= budget.maxTokens) {
        used += cost;
        digests.push(digest);
        relations.push(rel);
        fullTexts.push({ name, content });
        continue;
      }
      // L3 超预算 → 降 L2，留痕
      downgrades.push({ entity: name, fromTier: 3, toTier: 2, reason: 'budget-exceeded' });
      achievedTier = 2;
    }
    if (achievedTier === 2) {
      const relText = JSON.stringify(rel);
      const cost = budget.estimate(relText);
      if (used + cost <= budget.maxTokens) {
        used += cost;
        digests.push(digest);
        relations.push(rel);
        continue;
      }
      // L2 超预算 → 降 L1，留痕
      downgrades.push({ entity: name, fromTier: 2, toTier: 1, reason: 'budget-exceeded' });
      achievedTier = 1;
    }
    if (achievedTier === 1) {
      const digestText = JSON.stringify(digest);
      used += budget.estimate(digestText);
      digests.push(digest);
    }
  }

  return { tier: achievedTier, digests, relations, fullTexts, downgrades };
}

/** frontmatter 安全解析（坏文件返回 null，不抛） */
function parseFrontmatterSafe(content: string): Record<string, unknown> | null {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return null;
  try {
    // 延迟 require 避免 js-yaml 成为 query 层硬依赖面（与 merge-engine 同款加载）
    const { load } = require('js-yaml') as typeof import('js-yaml');
    return load(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}
