// ============================================================
// industry-overlay.ts · 行业 overlay 自动发现（竞品吸收②）
// v1.3.7 交付④ 新增
//
// 机制：FDE 进场在 context.md 顶部 frontmatter 标注 industry: fintech 等
//   → 约束层读取时自动发现并加载对应 overlay（复用 --ruleset 通道）。
//
// 优先级语义（开工决议 5，2026-08-18 已定）：
//   - 默认叠加：24 条默认规则 + overlay 行业规则同时生效
//   - 显式 --ruleset X：用户显式指定优先，overlay 自动加载让位
//   - 两者冲突：显式指定优先，并在审计日志留痕
//   - 未标注 industry：只跑 24 条默认（保守默认，不误加载）
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

/** 支持的行业标注值 → overlay 规则包名 */
export const INDUSTRY_OVERLAY_MAP: Record<string, string> = {
  fintech: 'fintech',
  finance: 'fintech',
  medical: 'medical',
  healthcare: 'medical',
  government: 'government',
  gov: 'government',
  ai: 'ai',
};

export interface OverlayDecision {
  /** 是否加载 overlay */
  load: boolean;
  /** overlay 规则包名（load=true 时有值） */
  rulesetName?: string;
  /** 检测到的行业标注 */
  industry?: string;
  /** 决策原因（审计留痕） */
  reason: string;
  /** 显式 --ruleset 让位（决议 5：冲突时显式优先 + 留痕） */
  deferredToExplicit?: boolean;
}

/**
 * 从 context.md 内容解析 industry 标注。
 *
 * 标注位置：文件顶部 frontmatter（--- 包围块）的 industry: 字段。
 *
 * @param content context.md 文件内容
 * @returns 行业标注值（小写），未标注返回 null
 */
export function parseIndustryMark(content: string): string | null {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm || !fm[1]) return null;
  const m = fm[1].match(/^industry:\s*(\S+)\s*$/m);
  if (!m || !m[1]) return null;
  return m[1].toLowerCase();
}

/**
 * 行业 overlay 加载决策。
 *
 * @param contextMdPath context.md 路径（不存在 = 未标注，保守默认）
 * @param explicitRuleset 用户显式 --ruleset 值（有值时 overlay 让位）
 * @returns 加载决策（含留痕原因）
 */
export function decideOverlay(contextMdPath: string, explicitRuleset?: string): OverlayDecision {
  if (!existsSync(contextMdPath)) {
    return { load: false, reason: `context.md 不存在（${contextMdPath}）——未标注行业，只跑默认规则（保守默认）` };
  }
  let content: string;
  try {
    content = readFileSync(contextMdPath, 'utf-8');
  } catch (err) {
    return { load: false, reason: `context.md 读取失败（${(err as Error).message}）——保守默认不加载 overlay` };
  }

  const industry = parseIndustryMark(content);
  if (!industry) {
    return { load: false, reason: 'context.md 未标注 industry:——只跑默认规则（保守默认，不误加载）' };
  }

  const overlayName = INDUSTRY_OVERLAY_MAP[industry];
  if (!overlayName) {
    return { load: false, industry, reason: `industry=${industry} 无对应 overlay（支持：${Object.keys(INDUSTRY_OVERLAY_MAP).join('/')}）——只跑默认` };
  }

  // 决议 5：显式 --ruleset 时显式指定优先、overlay 让位、留痕
  if (explicitRuleset) {
    return {
      load: false,
      industry,
      deferredToExplicit: true,
      reason: `显式 --ruleset ${explicitRuleset} 优先——industry=${industry} 的 overlay ${overlayName} 让位（冲突留痕）`,
    };
  }

  return {
    load: true,
    rulesetName: overlayName,
    industry,
    reason: `industry=${industry} → 自动加载 overlay ${overlayName}（叠加 24 条默认规则）`,
  };
}

/**
 * 便捷入口：从项目根目录探测（约定 context.md 在项目根或 .sofagent/ 下）。
 */
export function decideOverlayFromProjectRoot(projectRoot: string, explicitRuleset?: string): OverlayDecision {
  const candidates = [
    join(projectRoot, 'context.md'),
    join(projectRoot, '.sofagent', 'context.md'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return decideOverlay(c, explicitRuleset);
  }
  // 用第一个路径生成「不存在」决策（保守默认）
  return decideOverlay(candidates[0]!, explicitRuleset);
}
