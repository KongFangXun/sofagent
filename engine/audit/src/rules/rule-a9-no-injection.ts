// ============================================================
// A9 不纳注入（安全层 · 业务底线）
// 检测 git diff 新增行中是否含 prompt injection 模式
// evidenceMode: git-diff（纯正则检测，--silent 可跑）
// v1.1.9: 追加中文注入检测正则（T01）
// 上下文感知扫描——字符串字面量/注释仅走 HIGH 置信度，
// 消除 MEDIUM 模糊档在文案/注释中的整类误报（详见 splitCodeContext）。
// ============================================================

import { getAddedLines } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './types';

/**
 * 说明：splitCodeContext 采用启发式正则拆分，并非完整 parser。
 * 其唯一用途是把一行代码拆成「代码/正文」与「字符串字面量 + 注释文本」，
 * 以便注入扫描在字符串/注释语境下降级（关闭 MEDIUM 模糊档），降低误报。
 * 不要求覆盖所有语言的所有边界情况。
 */

/** 高置信度注入模式——精确匹配 → score += 1.0 */
const HIGH_CONFIDENCE_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /ignore (all )?previous (instructions|prompts)/i, name: 'ignore previous instructions/prompts' },
  { pattern: /(you are now|你现在是|你的新角色是) (DAN|jailbreak)/i, name: 'DAN/jailbreak 角色切换' },
  { pattern: /do not follow (the |your )?(rules|guidelines|instructions)/i, name: 'do not follow rules/guidelines/instructions' },
  { pattern: /(ignore|forget) (everything|all) (above|before)/i, name: 'ignore/forget everything/all above/before' },
  { pattern: /<\|im_start\|>/i, name: 'im_start 标记注入' },
  // v1.1.0: 中文注入检测
  { pattern: /忽略(以上|之前|先前|所有|上面).{0,6}(指令|约束|限制|规则|设定|系统提示)/i, name: '中文：忽略+指令/约束/限制' },
  { pattern: /无视(以上|之前|先前|所有|上面).{0,6}(规则|约束|限制|要求|指令)/i, name: '中文：无视+规则/约束/限制' },
  { pattern: /忘记(之前|以上|先前|所有|上面).{0,6}(指令|约束|要求|设定|规则)/i, name: '中文：忘记+指令/约束/要求' },
  { pattern: /解除(所有)?(限制|约束|封印)/i, name: '中文：解除限制/约束/封印' },
  { pattern: /你现在(开始)?(不再受|无需遵守|可以无视|可以忽略)/i, name: '中文：不再受约束' },
  { pattern: /(你现在是|你的新角色是|角色切换为).{0,8}(DAN|越狱|jailbreak|无限制|自由模式|开发者模式)/i, name: '中文角色切换' },
  { pattern: /(系统提示词|system prompt).{0,4}(已更新|已修改|已重置|已替换)/i, name: '中文：系统提示词篡改' },
];

/** 中等置信度模式——含关键词但未命中完整模式 → score += 0.3 */
const MEDIUM_CONFIDENCE_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /ignore.*(instruction|prompt|rule)/i, name: 'ignore + instruction/prompt/rule（模糊）' },
  { pattern: /(bypass|override|disable).*(audit|check|rule)/i, name: 'bypass/override/disable audit/check/rule' },
  { pattern: /system\s*(prompt|message|instruction)\s*[:=]/i, name: 'system prompt/message/instruction 赋值' },
  // v1.1.0: 中文注入检测（中等置信度）
  { pattern: /越狱|jailbreak|开发者模式|developer mode/i, name: '越狱/开发者模式关键词' },
  { pattern: /(绕过|跳过|关闭|禁用).{0,4}(审计|检查|规则|限制|安全)/i, name: '中文：绕过审计/检查' },
];

/**
 * NFKC 归一化 + leet speak 反转（供两处评分复用）
 * P1-6: 全角字符转半角；P1-7: leet 字符反转（1→i, 0→o, 3→e 等）
 * @returns 归一化后的字符串
 */
export function normalizeLine(line: string): string {
  let normalized = line.normalize('NFKC');
  normalized = normalized
    .replace(/1/gi, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a');
  return normalized;
}

/**
 * 对单行计算可疑度评分（v1.0.5 新增）
 * 精确命中高置信度模式 → +1.0
 * 模糊命中中等模式 → +0.3
 * 经过 NFKC/leet 反转才匹配 → ×0.8（降低置信度）
 * @returns 0.0 ~ 1.0 的可疑度评分
 */
function scoreLine(line: string, wasTransformed: boolean): number {
  let score = 0;

  // 高置信度精确匹配
  for (const { pattern } of HIGH_CONFIDENCE_PATTERNS) {
    if (pattern.test(line)) {
      score += 1.0;
      break; // 一行只计一次高分命中
    }
  }

  // 如果高置信度已命中，不再检查中等模式
  if (score >= 1.0) {
    return wasTransformed ? Math.min(score * 0.8, 1.0) : Math.min(score, 1.0);
  }

  // 中等置信度模糊匹配
  for (const { pattern } of MEDIUM_CONFIDENCE_PATTERNS) {
    if (pattern.test(line)) {
      score += 0.3;
      break;
    }
  }

  // 经过 NFKC/leet 反转才匹配 → 降低置信度
  if (wasTransformed && score > 0) {
    score *= 0.8;
  }

  return Math.min(score, 1.0);
}

/**
 * 仅遍历高置信度模式评分（用于字符串/注释上下文降级）。
 * 与 scoreLine 逻辑一致，但跳过 MEDIUM 模糊档。
 * @returns 0.0 ~ 1.0 的可疑度评分
 */
export function scoreLineHighOnly(line: string, wasTransformed: boolean): number {
  let score = 0;

  for (const { pattern } of HIGH_CONFIDENCE_PATTERNS) {
    if (pattern.test(line)) {
      score += 1.0;
      break; // 一行只计一次高分命中
    }
  }

  if (wasTransformed && score > 0) {
    score *= 0.8;
  }

  return Math.min(score, 1.0);
}

/**
 * 代码/正文上下文评分：完整模式（HIGH + MEDIUM）。
 * 与改动前 checkRuleA9 对单行的评分语义保持一致。
 */
export function scoreFullContext(s: string): number {
  const norm = normalizeLine(s);
  return Math.max(scoreLine(s, false), s !== norm ? scoreLine(norm, true) : 0);
}

/**
 * 字符串/注释上下文评分：仅高置信度模式（MEDIUM 模糊档关闭）。
 * 用于消除 MEDIUM 档在文案/注释中的误报；HIGH 真注入仍照常检测。
 */
export function scoreHighOnlyContext(s: string): number {
  const norm = normalizeLine(s);
  return Math.max(scoreLineHighOnly(s, false), s !== norm ? scoreLineHighOnly(norm, true) : 0);
}

/**
 * 启发式地把一行代码拆成「代码/正文」与「字符串字面量 + 注释文本」。
 * 注意：这是启发式实现，不是完整 parser，仅用于注入扫描的上下文降级判定。
 *
 * @returns
 *  - code: 去掉字符串字面量与注释后的代码骨架（用空格替换被移除片段，长度无关）
 *  - literals: 提取出的字符串字面量内容（不含引号）+ 注释文本（不含注释标记）数组
 */
export function splitCodeContext(line: string): { code: string; literals: string[] } {
  const literals: string[] = [];

  // 第一遍：提取字符串字面量（单/双/模板串，支持转义），并从 code 中移除
  const STRING_RE = /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)/g;
  let code = line.replace(STRING_RE, (full) => {
    // 去掉两端引号，保留内部内容
    literals.push(full.slice(1, -1));
    return ' '.repeat(full.length);
  });

  // 第二遍：在已无字符串的 code 上提取注释（//  #  /* */  <!-- -->）
  const COMMENT_RE = /(\/\/.*$|#.*$|<!--[\s\S]*-->|\/\*[\s\S]*\*\/)/g;
  code = code.replace(COMMENT_RE, (full) => {
    // 去掉注释起始标记，保留注释文本
    let inner = full;
    if (inner.startsWith('//')) {
      inner = inner.slice(2);
    } else if (inner.startsWith('#')) {
      inner = inner.slice(1);
    } else if (inner.startsWith('<!--')) {
      inner = inner.slice(4, -3);
    } else if (inner.startsWith('/*')) {
      inner = inner.slice(2, -2);
    }
    literals.push(inner);
    return ' '.repeat(full.length);
  });

  return { code, literals };
}

export function checkRuleA9(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A9 不纳注入',
    number: 9,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  interface Hit { file: string; line: string; pattern: string; score: number }
  const hits: Hit[] = [];

  for (const file of diffFiles) {
    // 跳过文档目录——changelog/设计文档等会合法引用注入模式作为案例
    if (file.path.startsWith('docs/')) continue;
    if (file.path.startsWith('.sofagent/')) continue;
    // 跳过测试文件——测试用例合法包含注入向量作为 fixture
    if (file.path.includes('.test.') || file.path.includes('__tests__/') || file.path.endsWith('.fixture')) continue;
    const addedLines = getAddedLines(file);
    for (const line of addedLines) {
      // 上下文感知扫描：
      //  - code（代码/正文）走完整模式（HIGH + MEDIUM）
      //  - literals（字符串字面量 + 注释）仅走 HIGH 置信度模式（MEDIUM 模糊档关闭）
      const { code, literals } = splitCodeContext(line);
      const codeScore = scoreFullContext(code);
      const literalScore = scoreHighOnlyContext(literals.join(' '));
      const finalScore = Math.max(codeScore, literalScore);

      if (finalScore >= 0.8) {
        // 高置信度 → FAIL
        const matchedPattern = findBestPattern(line, normalizeLine(line));
        hits.push({ file: file.path, line: line.trim(), pattern: matchedPattern, score: finalScore });
      } else if (finalScore >= 0.3) {
        // 中等置信度 → 记录为可疑（后续统一判定 WARN）
        const matchedPattern = findBestPattern(line, normalizeLine(line));
        hits.push({ file: file.path, line: line.trim(), pattern: matchedPattern, score: finalScore });
      }
    }
  }

  // P1-8: 扫描 commit message 中的 prompt injection（正文语境，仍走全模式）
  if (ctx.commitMsg) {
    const rawMsgScore = scoreLine(ctx.commitMsg, false);
    const normalizedMsg = normalizeLine(ctx.commitMsg);
    const transformedMsgScore = normalizedMsg !== ctx.commitMsg ? scoreLine(normalizedMsg, true) : 0;
    const msgScore = Math.max(rawMsgScore, transformedMsgScore);

    if (msgScore >= 0.5) {
      hits.push({ file: '(commit message)', line: ctx.commitMsg.trim(), pattern: 'commit message 注入', score: msgScore });
    }
  }

  // v1.0.5: score-based 分级判定
  const failHits = hits.filter((h) => h.score >= 0.8);
  const warnHits = hits.filter((h) => h.score >= 0.3 && h.score < 0.8);

  if (failHits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${failHits.length} 处高置信度 prompt injection 模式: ` +
      failHits.map((h) => `${h.file}: "${h.line}" (${h.pattern}, score=${h.score.toFixed(1)})`).join('; ')
    );
  }
  if (warnHits.length > 0 && rule.status === 'PASS') {
    rule.status = 'WARN';
    rule.details.push(
      `检测到 ${warnHits.length} 处可疑注入模式（建议人工审查）: ` +
      warnHits.map((h) => `${h.file}: "${h.line}" (${h.pattern}, score=${h.score.toFixed(1)})`).join('; ')
    );
  } else if (warnHits.length > 0) {
    // 已有 FAIL，WARN 追加为详情
    rule.details.push(
      `另有 ${warnHits.length} 处可疑注入模式（建议人工审查）: ` +
      warnHits.map((h) => `${h.file}: "${h.line}" (${h.pattern}, score=${h.score.toFixed(1)})`).join('; ')
    );
  }

  return rule;
}

/** 找到最佳匹配模式名 */
function findBestPattern(line: string, normalized: string): string {
  for (const { pattern, name } of HIGH_CONFIDENCE_PATTERNS) {
    if (pattern.test(line) || pattern.test(normalized)) return name;
  }
  for (const { pattern, name } of MEDIUM_CONFIDENCE_PATTERNS) {
    if (pattern.test(line) || pattern.test(normalized)) return name;
  }
  return 'unknown';
}
