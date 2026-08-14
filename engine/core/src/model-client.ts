// ============================================================
// model-client.ts · 模型 API 客户端
// v1.3.4 新增：Node.js 原生 fetch（Node 18+ 内置）调 OpenAI 兼容接口
// v1.3.4 交付 12：isRetryableError 字符串匹配 → stop_reason 六值分类
//   + 指数退避重连（2s→4s→8s→16s→30s，≤5 次）+ auth 永不重试（铁律）
//   + 工具失败收敛为结构化消息（convergeToolError，不 throw）
// v1.3.4 交付 11：调用前后打点写 LLM 调用级 Trace（llm-calls.jsonl），
//   打点失败不阻断调用（容错铁律：try/catch + warn）
// ============================================================
import { classifyError, isRetryableStopReason, backoffDelayMs, MAX_RETRY_COUNT } from './stop-reason';
import type { StopReason } from './stop-reason';
import { appendLlmCallRecord } from './llm-call-trace';

/** 带 stop_reason 分类的模型调用错误（auth 永不重试直接抛出） */
export class ModelCallError extends Error {
  /** 终止原因六值分类 */
  readonly stopReason: StopReason;
  /** HTTP 状态码（若可识别） */
  readonly httpStatus?: number;

  constructor(message: string, stopReason: StopReason, httpStatus?: number) {
    super(message);
    this.name = 'ModelCallError';
    this.stopReason = stopReason;
    this.httpStatus = httpStatus;
  }
}

/**
 * 模型 API 响应格式（OpenAI 兼容）
 */
interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 模型 API 调用选项
 */
export interface ModelCallOptions {
  /** 温度（0-2），默认 0.3 */
  temperature?: number;
  /** 超时时间（ms），默认 60000 */
  timeout?: number;
  /** 最大重试次数，默认 5（v1.3.1：从 1 升级为退避阶梯上限） */
  maxRetries?: number;
  /** v1.3.1 交付 11：发起调用的 Agent 身份码（写入调用 Trace） */
  agentId?: string;
  /** v1.3.1 交付 11：关联任务 ID（写入调用 Trace） */
  taskId?: string;
  /** v1.3.1 交付 12：可注入的 sleep 函数（测试用，默认真实延时） */
  sleepFn?: (ms: number) => Promise<void>;
  /** v1.3.1 交付 11：Trace 写入目录覆盖（测试隔离用 SOFAGENT_HOME） */
  traceHome?: string;
  /** v1.3.1 交付 11：Trace 打点开关（默认 true；设 false 可完全跳过打点） */
  traceEnabled?: boolean;
  /** v1.3.2 交付 7：本地模型端点注入（client_type='openai-compatible' 接入 vLLM 等） */
  endpointConfig?: LocalEndpointConfig;
}

/**
 * v1.3.2 交付 7：本地模型端点配置（用于 openai-compatible 路径）
 * 传入此配置时，model-client 直接用注入的 base_url + key + model，
 * 不读环境变量，复用同一 Trace + 错误处理链路。
 */
export interface LocalEndpointConfig {
  /** base URL（如 http://localhost:8000/v1） */
  baseUrl: string;
  /** API key（本地 vLLM 等可不鉴权，留空即可） */
  apiKey?: string;
  /** 模型名 */
  model: string;
  /** provider 标识（Trace 用，如 'vllm' / 'openai-compatible'） */
  provider?: string;
}

/**
 * 模型 API 消息格式
 */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 默认 sleep 实现（真实等待） */
const defaultSleepFn = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 获取 API 配置（从环境变量读取）
 */
function getAPIConfig(): { apiKey: string; baseUrl: string; modelName: string } {
  const apiKey = process.env.SOFAGENT_MODEL_API_KEY || '';
  const baseUrl = process.env.SOFAGENT_MODEL_BASE_URL || 'https://api.openai.com/v1';
  const modelName = process.env.SOFAGENT_MODEL_NAME || 'gpt-3.5-turbo';
  return { apiKey, baseUrl, modelName };
}

/** 从 baseUrl 提取 provider 标识（Trace 用，如 'api.openai.com'） */
function providerFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 单次 LLM 请求（不含重试）——返回内容 + token 用量。
 * HTTP 非 2xx 抛带 httpStatus 的错误，便于外层 stop_reason 分类。
 */
async function singleRequest(
  url: string,
  apiKey: string,
  body: string,
  timeout: number,
): Promise<{ content: string; tokenInput: number; tokenOutput: number; rawResponse: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '未知错误');
      const err = new Error(`模型 API 返回错误 ${response.status}: ${errorText.slice(0, 200)}`);
      (err as Error & { httpStatus?: number }).httpStatus = response.status;
      throw err;
    }

    // v1.3.2 交付 8：先取原始响应文本（provider 透传 rawResponse，不归一化）
    const rawText = await response.text();

    let data: ChatCompletionResponse;
    try {
      data = JSON.parse(rawText) as ChatCompletionResponse;
    } catch (parseErr) {
      // 流截断 / 非法 JSON → malformed 分类（消息带「解析」关键词供 classifyError 识别）
      throw new Error(
        `模型 API 响应解析失败（疑似流截断）: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
      );
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('模型 API 返回空内容');
    }

    return {
      content,
      tokenInput: data.usage?.prompt_tokens ?? 0,
      tokenOutput: data.usage?.completion_tokens ?? 0,
      rawResponse: rawText,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调用模型 API（OpenAI 兼容接口）
 *
 * v1.3.1 重试策略（替换字符串匹配 + 固定重试 1 次）：
 *   - 每次失败先做 stop_reason 六值分类
 *   - auth（401/403）→ 永不重试，直接抛带 stopReason 的 ModelCallError（铁律）
 *   - aborted（用户中断）→ 不重试
 *   - timeout / malformed / failed → 按退避阶梯重连（2s→4s→8s→16s→30s，≤maxRetries 次）
 *
 * 每次请求（成功与失败）都写一条 LLM 调用级 Trace（交付 11），
 * 打点失败仅 warn，绝不阻断调用。
 *
 * v1.3.2 交付 7：支持本地配置注入（client_type='openai-compatible' 接入 vLLM 等）。
 * 传入 endpointConfig 时优先使用注入的 base_url + key + model（不经环境变量），
 * 复用同一 Trace 写入点 + stop_reason 错误处理链路。
 *
 * @param messages 消息列表
 * @param options  调用选项
 * @returns 模型返回的文本内容
 */
export async function callModelAPI(
  messages: ModelMessage[],
  options: ModelCallOptions = {}
): Promise<string> {
  const {
    temperature = 0.3,
    timeout = 60_000,
    maxRetries = MAX_RETRY_COUNT,
    agentId,
    taskId,
    sleepFn = defaultSleepFn,
    traceHome,
    traceEnabled = true,
  } = options;

  // v1.3.2 交付 7：本地配置注入优先（client_type='openai-compatible'）
  let apiKey: string;
  let baseUrl: string;
  let modelName: string;
  let provider: string;

  if (options.endpointConfig) {
    const ec = options.endpointConfig;
    apiKey = ec.apiKey || '';
    baseUrl = ec.baseUrl;
    modelName = ec.model;
    provider = ec.provider || providerFromBaseUrl(ec.baseUrl);
    // openai-compatible 本地模型不需要 key（vLLM 等可不鉴权）——空 key 不拦截
  } else {
    const envConfig = getAPIConfig();
    apiKey = envConfig.apiKey;
    baseUrl = envConfig.baseUrl;
    modelName = envConfig.modelName;
    provider = providerFromBaseUrl(baseUrl);
  }

  if (!apiKey && !options.endpointConfig) {
    throw new Error(
      'SOFAGENT_MODEL_API_KEY 环境变量未设置。请设置 API key 后重试。'
    );
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = JSON.stringify({
    model: modelName,
    messages,
    temperature,
  });

  // 交付 11：Trace 打点——容错铁律，打点失败不阻断调用
  const writeTrace = (record: {
    tokenInput: number;
    tokenOutput: number;
    durationMs: number;
    stopReason: StopReason;
    error: string | null;
    rawResponse?: string;
  }): void => {
    if (!traceEnabled) return;
    try {
      appendLlmCallRecord(
        {
          ...(agentId ? { agentId } : {}),
          ...(taskId ? { taskId } : {}),
          provider,
          model: modelName,
          tokenInput: record.tokenInput,
          tokenOutput: record.tokenOutput,
          durationMs: record.durationMs,
          stopReason: record.stopReason,
          error: record.error,
          ...(record.rawResponse ? { rawResponse: record.rawResponse } : {}),
        },
        traceHome,
      );
    } catch (err) {
      console.warn(
        `[sofagent] model-client: LLM 调用 Trace 写入失败（不影响调用）: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await singleRequest(url, apiKey, body, timeout);
      // 成功打点：stopReason = completed（v1.3.2 交付 8：携带 rawResponse）
      writeTrace({
        tokenInput: result.tokenInput,
        tokenOutput: result.tokenOutput,
        durationMs: Date.now() - startedAt,
        stopReason: 'completed',
        error: null,
        rawResponse: result.rawResponse,
      });
      return result.content;
    } catch (err) {
      const httpStatus =
        typeof (err as { httpStatus?: unknown })?.httpStatus === 'number'
          ? (err as { httpStatus: number }).httpStatus
          : undefined;
      const stopReason = classifyError(err, httpStatus);
      lastError = err instanceof Error ? err : new Error(String(err));

      // 失败打点（stop_reason 六值分类）
      writeTrace({
        tokenInput: 0,
        tokenOutput: 0,
        durationMs: Date.now() - startedAt,
        stopReason,
        error: lastError.message,
      });

      // 铁律：auth（401/403）永不重试——重试不会让错误凭证变有效
      if (stopReason === 'auth') {
        throw new ModelCallError(lastError.message, 'auth', httpStatus);
      }
      // 用户中断不重试
      if (stopReason === 'aborted') {
        break;
      }
      // timeout / malformed / failed → 退避重连
      if (attempt < maxRetries && isRetryableStopReason(stopReason)) {
        await sleepFn(backoffDelayMs(attempt));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('模型 API 调用失败');
}

/** 工具失败收敛结果——结构化消息（不 throw，交回模型决策） */
export interface ConvergedToolError {
  /** 固定状态标记 */
  status: 'tool_error';
  /** 失败工具名 */
  tool: string;
  /** 错误信息（截断保护） */
  error: string;
  /** 给模型的处置建议 */
  suggestion: string;
}

/** 收敛错误消息最大长度（防止大段错误文本灌入模型上下文） */
const TOOL_ERROR_MAX_LEN = 500;

/**
 * 工具失败收敛为结构化消息（v1.3.1 交付 12）。
 *
 * 工具执行失败不再抛异常中断任务——收敛为结构化消息返回给 Agent，
 * 由模型决定重试/换方案/放弃。绝不 throw。
 *
 * @param tool 工具名
 * @param err 错误对象（Error 或任意可字符串化值）
 * @returns 结构化错误消息
 */
export function convergeToolError(tool: string, err: unknown): ConvergedToolError {
  const raw = err instanceof Error ? err.message : String(err ?? '未知错误');
  return {
    status: 'tool_error',
    tool,
    error: raw.slice(0, TOOL_ERROR_MAX_LEN),
    suggestion: '工具执行失败。可检查参数/权限/路径后重试，或换用其他方案；若反复失败请放弃该路径并说明原因。',
  };
}
