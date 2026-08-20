// ============================================================
// asi01-prompt-injection.ts · OWASP ASI01 目标劫持检测
// v1.3.9（一）：扫描 SKILL.md / fde.md 等 system prompt 类文件中的
// 对抗性注入模式——「忽略上述指令」类指令覆盖（Microsoft AGT 启发）
//
// 边界说明：markdown 没有 TS AST，语义级检测落在
// 「指令覆盖模式 + 角色劫持模式 + 结构伪装模式」三类文本特征上
// ============================================================

import type { AstRule } from '../types';

/** 注入模式三类（命中任一即报） */
const INJECTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // 一、指令覆盖类：「忽略上述指令」的多种语言形态
  { re: /忽略(以上|上述|之前|前面|先前|上面)(的)?(所有|全部)?(指令|规则|要求|约束|设定)/, label: '指令覆盖' },
  { re: /无视(以上|上述|之前|前面)(的)?(所有|全部)?(指令|规则|要求|约束)/, label: '指令覆盖' },
  { re: /(?<![\w])(ignore|disregard|forget|override)\s+(?:(?:all|any|the|previous|prior|above|earlier|preceding|system)\s+)*(?:instructions?|rules?|constraints?|prompts?|directions?|guardrails?)/i, label: '指令覆盖' },
  { re: /(?<![\w])disregard\s+(all|any|the)\s+(safety|security|content)/i, label: '安全约束覆盖' },
  // 二、角色劫持类：强制改写 agent 身份
  { re: /(你现在是|从现在开始你是|你不再是你|你的新(身份|角色|任务)是)/, label: '角色劫持' },
  { re: /(?<![\w])you\s+are\s+now\s+(a|an|the)\s+(?!silicon|machine)/i, label: '角色劫持' },
  { re: /(?<![\w])(pretend|act)\s+(to\s+be|as\s+if\s+you\s+(are|were))\s+(a|an|the)/i, label: '角色劫持' },
  // 三、结构伪装类：伪造系统消息边界（分隔符逃逸）
  { re: /<\/?(system|assistant|instruction|工具|系统)(>|消息|提示)/i, label: '结构伪装' },
  { re: /###\s*(system\s*prompt|系统提示词|真实指令)/i, label: '结构伪装' },
];

/** ASI01 适用文件：system prompt 载体（SKILL.md / fde.md / role-*.md） */
const PROMPT_FILE = /(SKILL\.md|fde\.md|role-[^/]+\.md|system[-_]?prompt)/i;

export const asi01PromptInjectionRule: AstRule = {
  id: 'asi01-prompt-injection',
  name: 'OWASP ASI01 目标劫持检测',
  severity: 'FAIL',
  description: '扫描 system prompt 类文件中的对抗性注入模式（指令覆盖/角色劫持/结构伪装）',
  filePattern: PROMPT_FILE,
  checkText(ctx) {
    const lines = ctx.text.split('\n');
    lines.forEach((line, idx) => {
      for (const { re, label } of INJECTION_PATTERNS) {
        if (re.test(line)) {
          ctx.report(idx + 1, `[ASI01·${label}] 检测到疑似 prompt 注入：${line.trim().slice(0, 80)}`);
          break; // 每行只报一次，避免同一行多模式重复计数
        }
      }
    });
  },
};
