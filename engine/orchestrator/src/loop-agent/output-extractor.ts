// ============================================================
// loop-agent/output-extractor.ts · L2 输出提取器（v1.3.2 交付 1）
// ============================================================
//
// 节点实际输出（非结构化 / 半结构化文本）→ 结构化提取。
// 供 ontology-comparator 与 Ontology 预期输出对比。
//
// 提取策略：
//   1. 先尝试 JSON 解析（输出已是结构化）
//   2. JSON 失败 → LLM 辅助提取（复用 v1.3.1 model-client + Trace）
//   3. LLM 不可用 → 降级到正则/关键词启发式提取
//
// 输出统一为 Record<string, unknown>（字段名 → 值），
// comparator 拿这个与 Ontology 预期逐字段对比。
// ============================================================

import type { ModelMessage } from '@sofagent/core';

/** 提取结果 */
export interface ExtractionResult {
  /** 提取出的结构化字段（字段名 → 值） */
  fields: Record<string, unknown>;
  /** 提取方式 */
  method: 'json-parse' | 'llm-assist' | 'heuristic' | 'empty';
  /** 提取置信度（0-1，LLM 辅助时有意义） */
  confidence: number;
}

/** LLM 辅助提取选项（复用 v1.3.1 model-client） */
export interface LlmExtractOptions {
  /** 可注入的 LLM 调用函数（测试 mock 用；默认 callModelAPI） */
  callLlm?: (messages: ModelMessage[]) => Promise<string>;
  /** 调用 Trace 的 taskId（写入 LLM 调用级 Trace） */
  taskId?: string;
  /** agentId（写入 Trace） */
  agentId?: string;
}

/**
 * 从节点输出中提取结构化字段。
 *
 * @param output 节点原始输出文本
 * @param expectedFields 预期字段名列表（从 Ontology 预期输出推导）
 * @param llmOptions LLM 辅助选项（可选）
 * @returns ExtractionResult
 */
export async function extractStructuredOutput(
  output: string,
  expectedFields: string[],
  llmOptions?: LlmExtractOptions,
): Promise<ExtractionResult> {
  if (!output || output.trim().length === 0) {
    return { fields: {}, method: 'empty', confidence: 0 };
  }

  // 1. 先尝试 JSON 解析（输出已是结构化）
  const jsonResult = tryJsonParse(output);
  if (jsonResult !== null && typeof jsonResult === 'object') {
    return {
      fields: jsonResult as Record<string, unknown>,
      method: 'json-parse',
      confidence: 1.0,
    };
  }

  // 2. JSON 失败 → 尝试提取 JSON 片段（模型常把 JSON 包在 markdown code block 里）
  const jsonFragment = extractJsonFragment(output);
  if (jsonFragment !== null) {
    return {
      fields: jsonFragment as Record<string, unknown>,
      method: 'json-parse',
      confidence: 0.9,
    };
  }

  // 3. LLM 辅助提取（复用 v1.3.1 model-client + Trace）
  if (llmOptions?.callLlm) {
    try {
      const llmResult = await llmExtract(output, expectedFields, llmOptions);
      if (llmResult.fields && Object.keys(llmResult.fields).length > 0) {
        return llmResult;
      }
    } catch {
      // LLM 提取失败 → 降级到启发式
    }
  }

  // 4. 启发式提取（正则/关键词）
  const heuristicFields = heuristicExtract(output, expectedFields);
  return {
    fields: heuristicFields,
    method: Object.keys(heuristicFields).length > 0 ? 'heuristic' : 'empty',
    confidence: 0.3,
  };
}

/** 尝试 JSON 解析（严格） */
function tryJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** 从 markdown code block 或文本中提取 JSON 片段 */
function extractJsonFragment(text: string): unknown | null {
  // ```json\n{...}\n``` 或 ```\n{...}\n```
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch?.[1]) {
    const parsed = tryJsonParse(codeBlockMatch[1]);
    if (parsed !== null) return parsed;
  }
  // 文本中第一个 { 到最后一个 } 的片段
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const fragment = text.slice(firstBrace, lastBrace + 1);
    const parsed = tryJsonParse(fragment);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** LLM 辅助提取（复用 v1.3.1 model-client） */
async function llmExtract(
  output: string,
  expectedFields: string[],
  options: LlmExtractOptions,
): Promise<ExtractionResult> {
  const systemPrompt = [
    '你是结构化数据提取器。从以下文本中提取字段，输出严格 JSON。',
    `需要提取的字段：${expectedFields.join(', ')}`,
    '输出格式：{"field1": value1, "field2": value2}',
    '如果某字段无法从文本中提取，省略该字段（不要输出 null）。',
    '只输出 JSON，不要其他文字。',
  ].join('\n');

  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: output },
  ];

  const response = await options.callLlm!(messages);
  const parsed = tryJsonParse(response) ?? extractJsonFragment(response);
  if (parsed !== null && typeof parsed === 'object') {
    return {
      fields: parsed as Record<string, unknown>,
      method: 'llm-assist',
      confidence: 0.7,
    };
  }
  return { fields: {}, method: 'empty', confidence: 0 };
}

/** 启发式提取（正则/关键词——LLM 不可用时的降级） */
function heuristicExtract(output: string, expectedFields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of expectedFields) {
    // 尝试 "field": value 或 field: value 或 field=value 格式
    const patterns = [
      new RegExp(`"${field}"\\s*:\\s*"?([^",\\n}]+)"?`, 'i'),
      new RegExp(`${field}\\s*[:=]\\s*"?([^,\\n;]+)"?`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match?.[1]) {
        result[field] = match[1].trim();
        break;
      }
    }
  }
  return result;
}
