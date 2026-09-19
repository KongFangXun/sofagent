// ============================================================
// load-chain/compactor.ts · 加载链自动上下文压缩（v1.5.0 第四章）
// ============================================================
// Codex compact 启发：窗口超预算触发摘要压缩。
//   - 保留：红线/铁律（SKILL.md 约束段）/ 最近决策——不可丢
//   - 压缩：历史细节（长背景/日志节选/重复示例）
//   - initial context 保留 + start/end 标记（事后可识别哪些内容来自压缩）
//
// ⚠️ harness 零依赖纪律：压缩事件走**回调出口**（onCompact）由调用方
// （daemon/orchestrator）落审计痕——harness 不 import audit（第七章门禁）。
//
// 双实现纪律（handler.ts 头注）：本文件是 harness npm API 形态；
// OpenClaw hook 形态（engine/hooks/sofagent-load-chain）**本版不消费
// compactor**（out of scope——hook 形态注入体量小且平台侧已有 compact 机制，
// 纳入评估留后续版本），两处同步评估记录在开发日志第四章。
// ============================================================

import { checkBudget, estimateTokens, type BudgetVerdict, type LoadChainBudget } from './budget';

/** 压缩标记（事后可识别） */
export const COMPACT_START_MARKER = '<!-- sofagent-compact:start -->';
export const COMPACT_END_MARKER = '<!-- sofagent-compact:end -->';

/** 不可压缩内容判定——红线/铁律/最近决策段（按行首标记识别） */
const PRESERVE_LINE_PREFIXES: readonly string[] = [
  '🚫', '🔴', '⚠️', '- 🚫', '- 🔴',          // 底线/铁律条目
  '## 红线', '## 铁律', '## 底线', '### 红线',  // 红线章节头
  '> 🔴', '> ⚠️', '> 🚫',                     // 强调引言
];

/** 压缩结果 */
export interface CompactResult {
  /** 压缩后内容（带 start/end 标记） */
  content: string;
  /** 是否发生了压缩 */
  compacted: boolean;
  /** 压缩事件（回调出口素材——调用方落审计） */
  event: {
    triggered: boolean;
    beforeTokens: number;
    afterTokens: number;
    preservedSections: string[];
    compactedLines: number;
    ts: string;
  };
}

/** 压缩回调（调用方接审计落痕——harness 不 import audit） */
export type OnCompactCallback = (result: CompactResult) => void;

/** 判定行是否必须原样保留（红线/铁律/最近决策） */
function isPreservedLine(line: string): boolean {
  return PRESERVE_LINE_PREFIXES.some((p) => line.startsWith(p));
}

/**
 * 段级压缩：对超长段落（非保留行）截断至 maxSectionLines，尾部加省略标记。
 */
function compactSection(lines: string[], maxSectionLines: number): { lines: string[]; compacted: number } {
  if (lines.length <= maxSectionLines) return { lines, compacted: 0 };
  const kept = lines.slice(0, maxSectionLines);
  kept.push(`…（压缩：原 ${lines.length} 行，保留前 ${maxSectionLines} 行）`);
  return { lines: kept, compacted: lines.length - maxSectionLines };
}

/**
 * 自动上下文压缩。
 * 未超预算 → 原样返回（compacted=false，零开销路径）。
 * 超预算 → 保留段原样 + 可压缩段截断 + start/end 标记包裹 + onCompact 回调。
 */
export function compactIfNeeded(
  content: string,
  budget?: LoadChainBudget,
  options?: { onCompact?: OnCompactCallback; maxSectionLines?: number },
): CompactResult {
  const verdict: BudgetVerdict = checkBudget(content, budget);
  const beforeTokens = verdict.estimatedTokens;
  const ts = new Date().toISOString();

  if (!verdict.over) {
    const result: CompactResult = {
      content,
      compacted: false,
      event: { triggered: false, beforeTokens, afterTokens: beforeTokens, preservedSections: [], compactedLines: 0, ts },
    };
    return result;
  }

  // 段级压缩：按保留行分界切 section，非保留 section 截断
  const maxSectionLines = options?.maxSectionLines ?? 30;
  const allLines = content.split('\n');
  const outLines: string[] = [];
  let compactedLines = 0;
  let currentSection: string[] = [];
  let currentIsPreserved = false;
  const preservedSections: string[] = [];

  const flush = (): void => {
    if (currentSection.length === 0) return;
    if (currentIsPreserved) {
      outLines.push(...currentSection);
      preservedSections.push(currentSection[0]?.slice(0, 40) ?? '(段)');
    } else {
      const { lines, compacted } = compactSection(currentSection, maxSectionLines);
      outLines.push(...lines);
      compactedLines += compacted;
    }
    currentSection = [];
  };

  for (const line of allLines) {
    const preserved = isPreservedLine(line);
    if (preserved !== currentIsPreserved) {
      flush();
      currentIsPreserved = preserved;
    }
    currentSection.push(line);
  }
  flush();

  const body = outLines.join('\n');
  const marked = `${COMPACT_START_MARKER}\n${body}\n${COMPACT_END_MARKER}`;
  const afterTokens = estimateTokens(marked);
  const result: CompactResult = {
    content: marked,
    compacted: true,
    event: { triggered: true, beforeTokens, afterTokens, preservedSections, compactedLines, ts },
  };
  options?.onCompact?.(result);
  return result;
}
