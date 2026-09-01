// ============================================================
// asi01-prompt-injection.ts · OWASP ASI01 目标劫持检测
// v1.4.3（一）：扫描 SKILL.md / fde.md 等 system prompt 类文件中的
// 对抗性注入模式——「忽略上述指令」类指令覆盖（Microsoft AGT 启发）
//
// 边界说明：markdown 没有 TS AST，语义级检测落在
// 「指令覆盖模式 + 角色劫持模式 + 结构伪装模式」三类文本特征上
// ============================================================

import type { AstRule } from '../types';

/** 注入模式三类（命中任一即报）——模式统一容忍空白（\s*），配合 normalizeLine 归一化 */
const INJECTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // 一、指令覆盖类：「忽略上述指令」的多种语言形态
  // v1.3.9 阶段四修复（fresh-eyes 视角7）：模式加 \s* 容忍注入空白——「忽略 上述 指令」「忽略
  // 上述 指令」等空白折叠变体不再绕过（归一化见 normalizeLine）。
  { re: /忽略\s*(以上|上述|之前|前面|先前|上面)\s*(的)?\s*(所有|全部)?\s*(指令|规则|要求|约束|设定)/, label: '指令覆盖' },
  { re: /无视\s*(以上|上述|之前|前面)\s*(的)?\s*(所有|全部)?\s*(指令|规则|要求|约束)/, label: '指令覆盖' },
  { re: /(?<![\w])(ignore|disregard|forget|override)\s+(?:(?:all|any|the|previous|prior|above|earlier|preceding|system)\s+)*(?:instructions?|rules?|constraints?|prompts?|directions?|guardrails?)/i, label: '指令覆盖' },
  { re: /(?<![\w])disregard\s+(all|any|the)\s+(safety|security|content)/i, label: '安全约束覆盖' },
  // 二、角色劫持类：强制改写 agent 身份
  { re: /(你现在\s*是|从现在开始\s*你是|你不再\s*是你|你的新\s*(身份|角色|任务)\s*是)/, label: '角色劫持' },
  { re: /(?<![\w])you\s+are\s+now\s+(a|an|the)\s+(?!silicon|machine)/i, label: '角色劫持' },
  { re: /(?<![\w])(pretend|act)\s+(to\s+be|as\s+if\s+you\s+(are|were))\s+(a|an|the)/i, label: '角色劫持' },
  // 三、结构伪装类：伪造系统消息边界（分隔符逃逸）
  { re: /<\/?(system|assistant|instruction|工具|系统)\s*(>|消息|提示)/i, label: '结构伪装' },
  { re: /###\s*(system\s*prompt|系统提示词|真实指令)/i, label: '结构伪装' },
];

/**
 * 归一化行——对抗编码变体绕过（v1.3.9 阶段四 fresh-eyes 视角7 修复）：
 * ① 剥离零宽字符（ZWSP U+200B / ZWNJ U+200C / ZWJ U+200D / WJ U+2060 / BOM U+FEFF）
 *    ——攻击者用零宽字符插入「忽略[ZWSP]上述指令」即绕过原正则；
 * ② 全角空格（U+3000）→ 半角；
 * ③ 折叠连续空白（多个空格/Tab → 单个空格）。
 * 注：同形字替换（西里尔 а vs 拉丁 a）超出纯正则能力，留 L3 语义检测（与 LIMITATIONS A9 口径一致）。
 */
function normalizeLine(raw: string): string {
  return raw
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** ASI01 适用文件：system prompt 载体（SKILL.md / fde.md / role-*.md） */
const PROMPT_FILE = /(SKILL\.md|fde\.md|role-[^/]+\.md|system[-_]?prompt)/i;

export const asi01PromptInjectionRule: AstRule = {
  id: 'asi01-prompt-injection',
  name: 'OWASP ASI01 目标劫持检测',
  severity: 'FAIL',
  description: '扫描 system prompt 类文件中的对抗性注入模式（指令覆盖/角色劫持/结构伪装，含编码变体归一化）',
  filePattern: PROMPT_FILE,
  checkText(ctx) {
    const lines = ctx.text.split('\n');
    lines.forEach((line, idx) => {
      const normalized = normalizeLine(line);
      for (const { re, label } of INJECTION_PATTERNS) {
        if (re.test(normalized)) {
          ctx.report(idx + 1, `[ASI01·${label}] 检测到疑似 prompt 注入：${line.trim().slice(0, 80)}`);
          break; // 每行只报一次，避免同一行多模式重复计数
        }
      }
    });
  },
};
