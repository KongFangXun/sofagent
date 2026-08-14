// ============================================================
// loop-agent/error-localizer.ts · L3 自动定位器（v1.3.4 交付 2）
// ============================================================
//
// L2 差异报告 + 审计日志 + Ontology 定义 → LLM 推理 → 定位结果
// （错误源 + 置信度）。
//
// 四类错误源（LLM 推理输出）：
//   skill     Skill 工具描述/few-shot 不够 → Agent 选错工具
//   ontology  Ontology 实体/关系定义缺 → Agent 无法识别
//   prompt    system prompt 偏 → Agent 行为偏
//   knowledge 知识库缺概念 → Agent 无参考
//
// 复用 v1.3.1 model-client（含 stop_reason 错误处理 + Trace 写入）。
//
// 定位错了不致命——L4 改完 L1 再跑，循环收敛兜底。
// ============================================================

import type { DiffReport } from './diff-report';
import { summarizeDiff } from './diff-report';
import type { ModelMessage } from '@sofagent/core';

/** 错误源（四类——LLM 推理输出） */
export type ErrorSource = 'skill' | 'ontology' | 'prompt' | 'knowledge';

/** L3 定位结果 */
export interface LocalizationResult {
  /** 定位到的错误源 */
  errorSource: ErrorSource;
  /** 置信度（0-1） */
  confidence: number;
  /** 定位理由（人可读） */
  reasoning: string;
  /** 定位依据（差异数 + 上下文摘要） */
  evidence: {
    diffCount: number;
    contextSummary: string;
  };
}

/** LLM 推理调用接口（复用 v1.3.1 model-client，可注入 mock） */
export interface LlmLocalizerDeps {
  /** 可注入的 LLM 调用函数（默认 callModelAPI） */
  callLlm?: (messages: ModelMessage[]) => Promise<string>;
  /** LLM 调用选项（传入 model-client 的 options——Trace/agentId/taskId） */
  taskId?: string;
  agentId?: string;
}

/** 上下文材料（定位推理输入） */
export interface LocalizationContext {
  /** Skill 定义文本（SKILL.md / 工具描述） */
  skillText?: string;
  /** Ontology 定义文本（entities/ 定义） */
  ontologyText?: string;
  /** Prompt 文本（system prompt） */
  promptText?: string;
  /** 知识库文本（knowledge/ 摘要） */
  knowledgeText?: string;
  /** 审计日志摘要 */
  auditLogSummary?: string;
}

/** LLM 返回的 JSON 结构（解析用） */
interface LlmLocalizationResponse {
  errorSource: ErrorSource;
  confidence: number;
  reasoning: string;
}

/**
 * L3 自动定位——L2 差异报告 + 上下文 → LLM 推理 → 定位结果。
 *
 * @param diffReport L2 差异报告
 * @param context 上下文材料
 * @param deps LLM 依赖（可注入 mock）
 * @returns LocalizationResult
 */
export async function localizeError(
  diffReport: DiffReport,
  context: LocalizationContext,
  deps?: LlmLocalizerDeps,
): Promise<LocalizationResult> {
  // 无差异 → 无需定位（L2 已 PASS）
  if (diffReport.mismatches.length === 0) {
    return {
      errorSource: 'skill',
      confidence: 0,
      reasoning: 'L2 差异报告为空——无需定位（L2 已 PASS）',
      evidence: {
        diffCount: 0,
        contextSummary: '无差异',
      },
    };
  }

  // LLM 不可用 → 降级到规则启发式定位
  if (!deps?.callLlm) {
    return heuristicLocalize(diffReport, context);
  }

  // 构造 LLM 推理 prompt
  const systemPrompt = buildLocalizerSystemPrompt(context);
  const userPrompt = buildLocalizerUserPrompt(diffReport);

  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let response: string;
  try {
    response = await deps.callLlm(messages);
  } catch (err) {
    // LLM 调用失败 → 降级到启发式（不致命——L4 兜底）
    const heuristic = heuristicLocalize(diffReport, context);
    heuristic.reasoning = `[LLM 调用失败，降级启发式] ${heuristic.reasoning}（LLM 错误：${err instanceof Error ? err.message : String(err)}）`;
    return heuristic;
  }

  // 解析 LLM 返回的 JSON
  const parsed = parseLlmResponse(response);
  if (parsed !== null) {
    return {
      errorSource: parsed.errorSource,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      evidence: {
        diffCount: diffReport.mismatches.length,
        contextSummary: summarizeContext(context),
      },
    };
  }

  // LLM 返回不可解析 → 降级启发式
  const heuristic = heuristicLocalize(diffReport, context);
  heuristic.reasoning = `[LLM 返回不可解析，降级启发式] ${heuristic.reasoning}`;
  return heuristic;
}

/** 构造定位器的 system prompt */
function buildLocalizerSystemPrompt(context: LocalizationContext): string {
  const lines: string[] = [
    '你是 sofagent Onboard Agent 的 L3 自动定位器。',
    '基于 L2 差异报告和上下文材料，推理最可能的错误源。',
    '',
    '四类错误源：',
    '- skill：Skill 工具描述/few-shot 不够，导致 Agent 选错工具或用法',
    '- ontology：Ontology 实体/关系定义缺，导致 Agent 无法识别某些概念',
    '- prompt：system prompt 偏，导致 Agent 行为偏离预期',
    '- knowledge：知识库缺概念，导致 Agent 无参考',
    '',
    '输出严格 JSON：{"errorSource": "...", "confidence": 0.0-1.0, "reasoning": "..."}',
    '只输出 JSON，不要其他文字。',
  ];

  if (context.skillText) {
    lines.push('', '## Skill 定义（截取）', truncate(context.skillText, 500));
  }
  if (context.ontologyText) {
    lines.push('', '## Ontology 定义（截取）', truncate(context.ontologyText, 500));
  }
  if (context.promptText) {
    lines.push('', '## System Prompt（截取）', truncate(context.promptText, 500));
  }
  if (context.knowledgeText) {
    lines.push('', '## 知识库（截取）', truncate(context.knowledgeText, 500));
  }
  if (context.auditLogSummary) {
    lines.push('', '## 审计日志摘要', truncate(context.auditLogSummary, 300));
  }

  return lines.join('\n');
}

/** 构造定位器的 user prompt（差异报告） */
function buildLocalizerUserPrompt(diffReport: DiffReport): string {
  const mismatchLines = diffReport.mismatches.map((m) => {
    switch (m.type) {
      case 'field_missing':
        return `- field_missing: 字段「${m.field}」缺失（预期 ${m.expected}）[${m.severity}]`;
      case 'value_error':
        return `- value_error: 字段「${m.field}」值不对（预期 ${m.expected}，实际 ${m.actual}）[${m.severity}]`;
      case 'relation_broken':
        return `- relation_broken: ${m.fromEntity} →${m.relation}→ ${m.toEntity} 关系断裂 [${m.severity}]`;
    }
  });
  return [
    `## L2 差异报告（${summarizeDiff(diffReport)}）`,
    ...mismatchLines,
    '',
    '请推理最可能的错误源（skill / ontology / prompt / knowledge）。',
  ].join('\n');
}

/** 解析 LLM 返回的 JSON（容错） */
function parseLlmResponse(response: string): LlmLocalizationResponse | null {
  // 尝试直接 JSON 解析
  try {
    const parsed = JSON.parse(response.trim());
    if (isValidErrorSource(parsed.errorSource) && typeof parsed.confidence === 'number') {
      return {
        errorSource: parsed.errorSource,
        confidence: parsed.confidence,
        reasoning: String(parsed.reasoning ?? ''),
      };
    }
  } catch {
    // 尝试提取 JSON 片段
  }
  // 提取 JSON 片段
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isValidErrorSource(parsed.errorSource) && typeof parsed.confidence === 'number') {
        return {
          errorSource: parsed.errorSource,
          confidence: parsed.confidence,
          reasoning: String(parsed.reasoning ?? ''),
        };
      }
    } catch {
      // 解析失败
    }
  }
  return null;
}

/** 启发式定位（LLM 不可用时的降级——规则驱动） */
function heuristicLocalize(
  diffReport: DiffReport,
  context: LocalizationContext,
): LocalizationResult {
  const mismatches = diffReport.mismatches;

  // 规则 1：field_missing 占主导 → ontology 定义缺
  const fieldMissingCount = mismatches.filter((m) => m.type === 'field_missing').length;
  if (fieldMissingCount > mismatches.length / 2) {
    return {
      errorSource: 'ontology',
      confidence: 0.6,
      reasoning: `差异以 field_missing 为主（${fieldMissingCount}/${mismatches.length}）——Ontology 预期字段在输出中缺失，可能是 Ontology 定义缺实体或 Agent 未生成预期字段`,
      evidence: {
        diffCount: mismatches.length,
        contextSummary: summarizeContext(context),
      },
    };
  }

  // 规则 2：value_error 占主导 → prompt 偏（行为偏离预期）
  const valueErrorCount = mismatches.filter((m) => m.type === 'value_error').length;
  if (valueErrorCount > mismatches.length / 2) {
    return {
      errorSource: 'prompt',
      confidence: 0.55,
      reasoning: `差异以 value_error 为主（${valueErrorCount}/${mismatches.length}）——输出值与预期不符，可能是 system prompt 未约束正确行为`,
      evidence: {
        diffCount: mismatches.length,
        contextSummary: summarizeContext(context),
      },
    };
  }

  // 规则 3：relation_broken → knowledge 缺概念
  const relationBrokenCount = mismatches.filter((m) => m.type === 'relation_broken').length;
  if (relationBrokenCount > 0) {
    return {
      errorSource: 'knowledge',
      confidence: 0.5,
      reasoning: `存在 relation_broken（${relationBrokenCount} 条）——实体间关系断裂，可能是知识库缺概念关联`,
      evidence: {
        diffCount: mismatches.length,
        contextSummary: summarizeContext(context),
      },
    };
  }

  // 默认：skill 工具描述不够
  return {
    errorSource: 'skill',
    confidence: 0.4,
    reasoning: '无法明确分类——默认归因 Skill 工具描述/few-shot 不够（LLM 不可用，启发式置信度低）',
    evidence: {
      diffCount: mismatches.length,
      contextSummary: summarizeContext(context),
    },
  };
}

/** 上下文摘要（调试用） */
function summarizeContext(context: LocalizationContext): string {
  const parts: string[] = [];
  if (context.skillText) parts.push('skill');
  if (context.ontologyText) parts.push('ontology');
  if (context.promptText) parts.push('prompt');
  if (context.knowledgeText) parts.push('knowledge');
  if (context.auditLogSummary) parts.push('audit');
  return parts.length > 0 ? parts.join('+') : '无上下文';
}

/** 截断文本 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...（截断）';
}

/** 校验错误源合法性 */
function isValidErrorSource(v: unknown): v is ErrorSource {
  return v === 'skill' || v === 'ontology' || v === 'prompt' || v === 'knowledge';
}
