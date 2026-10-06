// ============================================================
// E6 提示注入防护（扩展层 · 业务底线）· v1.5.7 章三新增
// OWASP ASI03（提示注入防护）对位规则——检测 **prompt 载体文件**
// （SKILL.md / fde.md / role-*.md / system-prompt 类）的 diff 新增行中
// 的三类 ASI03 特有注入载荷：
//   ① 隐藏指令载荷：HTML 注释 / 零宽字符包裹的指令——对人类读者不可见，
//      对读取文件的模型可见（ASI03 最典型的载荷形态）
//   ② 系统消息边界伪造：伪造 <system>…</system> / [SYSTEM] 分隔符——
//      试图让模型把注入内容当作系统级指令
//   ③ 持续角色操控指令：「在后续所有回复中…」类多轮持续 hijack 指令
//
// ── 与 A9（不纳注入）的判定面边界（本任务书要求先对照再落点）──
// A9 = 全文件类型的**单行注入指令模式**评分（ignore previous instructions
//      类指令覆盖 + DAN 角色切换——攻击载荷是「一句话改写目标」）；
// E6 = **prompt 载体文件专属**的**载荷结构**检测——
//      - 隐藏载荷（HTML 注释/零宽包裹）：A9 无任何模式覆盖（实测 A9 的
//        HIGH/MEDIUM 正则均不含注释载荷形态）；
//      - 边界伪造（[SYSTEM]/<system> 伪造）：A9 只有 <|im_start|> 一个形态；
//      - 多轮持续操控（"在后续所有回复中"）：A9 模式全部是单轮指令覆盖。
// 三类均非 A9 判定面重叠——故按任务书正路新增 E6，不改道 A9 双编号映射。
//
// 编号归属：扩展位 E6（number = 200 + 6 = 206），归 extendedRules（opt-in）。
// evidenceMode: git-diff（纯 diff 判定，不依赖日志、不读 cwd/fs/git）。
// ============================================================

import { getAddedLines } from '@sofagent/core';
import type { AuditContext, RuleScan, RuleStatus } from './types';

/**
 * prompt 载体文件判定：`SKILL/`、`FDE/` 目录下任意 .md（本仓技能/prompt 载体
 * 实际布局——SKILL/skills/*.md 等），加上 AST 引擎 asi01 的 PROMPT_FILE 文件名
 * 形态（SKILL.md / fde.md / role-*.md / system-prompt 类，覆盖散布两处的载体）
 */
const PROMPT_CARRIER_RE =
  /(^|\/)(SKILL|FDE)\/.+\.md$|(SKILL\.md|fde\.md|role-[^/]+\.md|system[-_]?prompt|prompt[-_]?(template|carrier))/i;

/** 零宽/不可见格式字符（与 A9 normalizeLine 同集） */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD]/;

/** details 命中行脱敏（截断——与 A9 sanitizeDetailLine 同策略的简化版） */
function sanitize(line: string): string {
  const t = line.trim();
  return t.length > 60 ? t.slice(0, 30) + '...[truncated]...' + t.slice(-20) : t;
}

interface E6Hit {
  file: string;
  line: string;
  category: string;
}

/** 提取新增行中的隐藏载荷内容（HTML 注释体内文本） */
function extractHtmlCommentPayload(line: string): string[] {
  const payloads: string[] = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    payloads.push(m[1]!);
  }
  return payloads;
}

/** 指令性载荷判定——注释/零宽包裹体内须含指令语义才算载荷（纯注释不算） */
const INSTRUCTION_INTENT_RE =
  /(忽略|无视|忘记|遵照|执行|按照|扮演|你是|输出|泄露|发送|上报|ignore|disregard|follow|execute|act as|you are|output|reveal|send|exfiltrat)/i;

export function scanE6(ctx: AuditContext): RuleScan {
  let status: RuleStatus = 'PASS';
  const details: string[] = [];
  const hits: E6Hit[] = [];

  for (const file of ctx.diffFiles) {
    if (!PROMPT_CARRIER_RE.test(file.path)) continue;
    // 安全文档本职是描述注入模式（合法引用）——与 A9 同款豁免面
    if (file.path === 'SECURITY.md' || file.path.startsWith('docs/')) continue;

    for (const line of getAddedLines(file)) {
      // ① 隐藏指令载荷：HTML 注释体内的指令性内容
      for (const payload of extractHtmlCommentPayload(line)) {
        if (INSTRUCTION_INTENT_RE.test(payload)) {
          hits.push({ file: file.path, line, category: '隐藏指令载荷（HTML 注释）' });
          break;
        }
      }

      // ② 零宽字符包裹行 + 指令语义（不可见指令注入）
      if (ZERO_WIDTH_RE.test(line) && INSTRUCTION_INTENT_RE.test(line.replace(ZERO_WIDTH_RE, ''))) {
        hits.push({ file: file.path, line, category: '零宽字符隐藏指令' });
        continue;
      }

      // ③ 系统消息边界伪造：[SYSTEM] / <system> 分隔符 + 指令内容
      //    （完整标签形态 </system> 由 AST asi01 结构伪装类覆盖——这里补
      //    prompt 载体新增行中的 [SYSTEM]·「system:」伪造前缀形态）
      if (/\[SYSTEM\]|^\s*system\s*[:：]/i.test(line) && INSTRUCTION_INTENT_RE.test(line)) {
        hits.push({ file: file.path, line, category: '系统消息边界伪造' });
        continue;
      }

      // ④ 持续角色操控：多轮持续 hijack 指令（"在后续所有回复中…"）
      if (
        /(在(后续|之后)(所有|每个|每次)?(回复|回答|输出|响应)中|from now on|in (all|every|each) (subsequent |future )?(reply|response|answer|turn))/i.test(line) &&
        INSTRUCTION_INTENT_RE.test(line)
      ) {
        hits.push({ file: file.path, line, category: '多轮持续角色操控' });
      }
    }
  }

  if (hits.length > 0) {
    status = 'FAIL';
    details.push(
      `检测到 ${hits.length} 处 prompt 载体注入载荷（ASI03 提示注入防护）: ` +
        hits.map((h) => `${h.file}: [${h.category}] "${sanitize(h.line)}"`).join('; ')
    );
  }

  return { status, details };
}
