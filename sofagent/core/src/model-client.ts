// ============================================================
// model-client.ts · 模型 API 客户端
// v1.1.9 新增
// 用 Node.js 原生 fetch（Node 18+ 内置）调模型 API
// API 配置从环境变量读取，支持 OpenAI 兼容接口
// ============================================================

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
  /** 最大重试次数，默认 1 */
  maxRetries?: number;
}

/**
 * 模型 API 消息格式
 */
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 获取 API 配置（从环境变量读取）
 */
function getAPIConfig(): { apiKey: string; baseUrl: string; modelName: string } {
  const apiKey = process.env.SOAGENT_MODEL_API_KEY || '';
  const baseUrl = process.env.SOAGENT_MODEL_BASE_URL || 'https://api.openai.com/v1';
  const modelName = process.env.SOAGENT_MODEL_NAME || 'gpt-3.5-turbo';
  return { apiKey, baseUrl, modelName };
}

/**
 * 调用模型 API（OpenAI 兼容接口）
 * 使用 Node.js 原生 fetch，单次 60s 超时，失败重试 1 次
 *
 * @param messages 消息列表
 * @param options  调用选项
 * @returns 模型返回的文本内容
 */
export async function callModelAPI(
  messages: ModelMessage[],
  options: ModelCallOptions = {}
): Promise<string> {
  const { temperature = 0.3, timeout = 60_000, maxRetries = 1 } = options;
  const { apiKey, baseUrl, modelName } = getAPIConfig();

  if (!apiKey) {
    throw new Error(
      'SOAGENT_MODEL_API_KEY 环境变量未设置。请设置 API key 后重试。'
    );
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = JSON.stringify({
    model: modelName,
    messages,
    temperature,
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
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
          throw new Error(
            `模型 API 返回错误 ${response.status}: ${errorText.slice(0, 200)}`
          );
        }

        const data = (await response.json()) as ChatCompletionResponse;
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
          throw new Error('模型 API 返回空内容');
        }

        return content;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // 如果是超时或网络错误，且还有重试次数，则重试
      if (attempt < maxRetries && isRetryableError(lastError)) {
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('模型 API 调用失败');
}

/**
 * 判断错误是否可重试（超时、网络错误等）
 */
function isRetryableError(err: Error): boolean {
  const message = err.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('abort') ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('429') ||
    message.includes('503') ||
    message.includes('502')
  );
}
