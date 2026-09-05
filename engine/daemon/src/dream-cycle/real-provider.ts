// ============================================================
// dream-cycle/real-provider.ts · 真 LLM Provider（v1.4.5 第七章五 · Maintainer 真脑）
// ============================================================
//
// 依赖缺口收编（arXiv:2608.27454 · 2026-09-03 用户拍板）：
//   Dream Cycle 6 阶段管道真实，但 LLM 层此前是 MockLLM 占位
//   （LIMITATIONS 自披露「格式正确但内容为零」）。第七章「持续样本
//   采集 ≥7 天」若不先换真脑，跑出来的全是占位符，实证收口必然
//   失败——本文件是第七章一（采样）的硬前置。
//
// 调用方式（复用已验证基建，不重复实现）：
//   - 走模型注册表（v1.3.6 @sofagent/orchestrator loadRegistry）解析
//     pipeline 档活动模型 → LocalEndpointConfig
//   - 经 @sofagent/core callModelAPI（v1.3.7 起 FORGE loop 同源基建：
//     OpenAI 兼容 /chat/completions + stop_reason 六值分类 + 指数退避
//     重连 + auth 永不重试 + LLM 调用级 Trace 打点）
//   - 注册表无活动模型时 fallback 到环境变量（SOFAGENT_MODEL_* 同源语义）
//
// 质量门槛（防「正确的废话」污染知识库）：
//   extract/synthesize 产出过 validateKnowledgeQuality 非占位符校验
//   （长度/信息量/与 MockLLM 输出差异度三轴）——不达标即抛错，
//   由 state-machine 落 failed:<stage> 游标，绝不静默放行。
//
// Mock 退化语义（显式降级，永不默默）：
//   - createDefaultProvider()：模型不可用（无注册条目且无环境变量）时
//     显式降级为 MockLLM，status 标 'mock'——周报与 evolution report
//     据此带降级标注，「占位符跑 7 天」永不默默发生。
//   - 测试经 opts.llm 注入 MockLLM / 假真脑（见 __tests__/real-provider.test.ts）。
//
// 铁律：任何 stage 不直接调 LLM SDK，必须经 LLMProvider（本文件是
//       LLMProvider 的真实现；MockLLM 降级为测试专用）。
// ============================================================

import { callModelAPI } from '@sofagent/core';
import type { ModelMessage } from '@sofagent/core';
import { loadRegistry } from '@sofagent/orchestrator';

import type { LLMProvider } from './types';
import { DREAM_CYCLE_SYSTEM_ROLE, validateExtractOutput } from './injection-guard';
import { MockLLM } from './llm-mock';
import {
  validateKnowledgeQuality,
  mockExtractForDiff,
  mockSynthesizeForDiff,
} from './quality-gate';

/** Provider 运行状态（降级标注的数据源——周报/采样报告消费） */
export type ProviderStatus = 'real' | 'mock';

/** createDefaultProvider 解析结果 */
export interface ProviderResolution {
  /** 实际使用的 provider（real = 真脑；mock = 显式降级） */
  provider: LLMProvider;
  /** 运行状态（周报/evolution report 降级标注位） */
  status: ProviderStatus;
  /** 降级原因（status=mock 时非空） */
  degradedReason?: string;
  /** 真脑解析到的端点描述（status=real 时非空——报告/审计用） */
  endpointDesc?: string;
}

/**
 * 从模型注册表解析 pipeline 档活动模型端点。
 * 注册表缺失/无活动模型/条目非法 → null（调用方决定 fallback 语义）。
 */
/** 端点配置（与 @sofagent/core LocalEndpointConfig 同构——本地声明避免依赖未导出类型） */
interface EndpointConfig {
  /** base URL（如 http://localhost:8000/v1） */
  baseUrl: string;
  /** API key（本地 vLLM 等可不鉴权，留空即可） */
  apiKey?: string;
  /** 模型名 */
  model: string;
  /** provider 标识（如 'vllm' / 'model-registry:<name>'） */
  provider?: string;
}

export function resolveActiveEndpoint(dataDir: string): EndpointConfig | null {
  try {
    const registry = loadRegistry(dataDir);
    const activeName = registry.active.pipeline ?? registry.active.executor;
    if (!activeName) return null;
    const entry = registry.models[activeName];
    if (!entry || entry.status === 'retired') return null;
    return {
      baseUrl: entry.endpoint,
      apiKey: process.env.SOFAGENT_MODEL_API_KEY || '',
      model: entry.model,
      provider: `model-registry:${activeName}`,
    };
  } catch {
    // 注册表损坏等异常 → null（降级决策交给调用方，不在此抛）
    return null;
  }
}

/** 从环境变量解析端点（注册表不可用时的 fallback——与 callModelAPI 环境变量语义同源） */
function resolveEnvEndpoint(): { hasKey: boolean } {
  // callModelAPI 内部读 SOFAGENT_MODEL_API_KEY / SOFAGENT_MODEL_BASE_URL /
  // SOFAGENT_MODEL_NAME；此处只探测 key 是否存在（openai-compatible 本地端点
  // 可不鉴权，key 缺失不必然阻断——返回 hasKey 供降级判断）
  return { hasKey: Boolean(process.env.SOFAGENT_MODEL_API_KEY) };
}

/** 单次底层调用签名（测试注入点——与 FORGE driver __inject 同模式） */
export type CallModelFn = (messages: ModelMessage[], options: { agentId: string }) => Promise<string>;

/**
 * RealLLM——LLMProvider 的真实现。
 *
 * - extract/cluster/synthesize：组装 SYSTEM_ROLE + 任务 prompt →
 *   callModelAPI → JSON 解析 → 质量门槛校验
 * - embed：真模型不保证有 embedding 端点——用确定性的 hash 派生向量
 *   （与 MockLLM.embed 同构，供去重等本地用途；检索服务本版不做）
 * - 每次调用经 injection-guard 三层隔离（SYSTEM_ROLE 只提取不执行 +
 *   输出 schema 校验回退 + A9 注入扫描在 extract-facts 侧）
 * - callImpl 可注入（测试用）：缺省走 callModelAPI 真链路
 */
export class RealLLM implements LLMProvider {
  /** 系统角色隔离声明（每次调用作为 system message 注入——只提取不执行） */
  static readonly SYSTEM_ROLE = DREAM_CYCLE_SYSTEM_ROLE;

  /** 端点配置（注册表或环境变量解析） */
  readonly endpointConfig: EndpointConfig | null;

  /** 底层调用实现（缺省 callModelAPI；测试注入模拟真实响应形态） */
  private readonly callImpl: CallModelFn;

  constructor(endpointConfig: EndpointConfig | null = null, callImpl?: CallModelFn) {
    this.endpointConfig = endpointConfig;
    this.callImpl =
      callImpl ??
      (async (messages, options) => {
        const content = await callModelAPI(messages, {
          temperature: 0.2,
          timeout: 120_000,
          maxRetries: 2,
          agentId: options.agentId,
          endpointConfig: endpointConfig ?? undefined,
        });
        return content;
      });
  }

  /** 组装消息并调模型（统一出口——四个认知方法共用） */
  private async chat(userPrompt: string, agentId: string): Promise<string> {
    const messages: ModelMessage[] = [
      { role: 'system', content: RealLLM.SYSTEM_ROLE },
      { role: 'user', content: userPrompt },
    ];
    return this.callImpl(messages, { agentId });
  }

  /** 从 JSON 文本提取数组（容忍 markdown 代码块包裹） */
  private static parseStringArray(raw: string): string[] | null {
    const jsonBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = jsonBlockMatch ? jsonBlockMatch[1]!.trim() : raw.trim();
    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return null;
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      return null;
    }
  }

  /**
   * 提取事实/原子——真 LLM 输出过质量门槛（长度/信息量/差异度三轴），
   * 不达标抛错（state-machine 落 failed 游标，不进知识库）。
   */
  async extract(input: string): Promise<string[]> {
    const prompt =
      `从以下文本中提取独立、原子化的知识点列表。要求：\n` +
      `一、每条一个完整陈述句，不含 markdown 标记\n` +
      `二、只提取文本中真实存在的信息，不添加、不演绎\n` +
      `三、输出 JSON 字符串数组，不要其他文字\n\n文本：\n${input}`;
    const raw = await this.chat(prompt, 'dream-cycle:extract');
    const parsed = RealLLM.parseStringArray(raw);
    if (parsed === null) {
      throw new Error('RealLLM.extract 输出非 JSON 数组（质量门槛拦截：格式不合法）');
    }
    // injection-guard 第二层：schema 安全校验（控制字符/超长过滤），失败回退按行切分
    const safe = validateExtractOutput(parsed, input);
    // 质量门槛：非占位符三轴校验（vs MockLLM 同输入输出）
    const gate = validateKnowledgeQuality(safe.join('\n'), input, mockExtractForDiff(input));
    if (!gate.ok) {
      throw new Error(`RealLLM.extract 质量门槛拦截：${gate.reasons.join('；')}`);
    }
    return safe;
  }

  /**
   * 聚类——按 hash 分桶的确定性语义已被 MockLLM 占位；真脑版让模型给
   * 每条输入打语义标签，解析失败回退 MockLLM 语义（保证 M<N 聚类效果）。
   */
  async cluster(inputs: string[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    const prompt =
      `把以下知识点按语义相近程度分组。要求：\n` +
      `一、为每条分配一个简短语义标签（如「部署纪律」「测试习惯」），同组必须同标签\n` +
      `二、标签数必须少于条目数（合并相近项）\n` +
      `三、输出 JSON 数组，第 i 个元素是第 i 条输入的标签，不要其他文字\n\n` +
      `输入列表：\n${JSON.stringify(inputs, null, 0)}`;
    const raw = await this.chat(prompt, 'dream-cycle:cluster');
    const parsed = RealLLM.parseStringArray(raw);
    if (parsed === null || parsed.length !== inputs.length) {
      // 解析失败/长度不齐 → 回退 MockLLM 聚类语义（pipeline 不中断）
      return new MockLLM().cluster(inputs);
    }
    return parsed;
  }

  /**
   * 合成概念——真 LLM 输出过质量门槛（标题/正文长度 + 信息量 + 差异度），
   * 不达标抛错（不污染 knowledge/entities/）。
   */
  async synthesize(inputs: string[]): Promise<{ title: string; body: string }> {
    const prompt =
      `把以下同组知识点合成为一个概念。要求：\n` +
      `一、输出 JSON 对象 {"title": "...", "body": "..."}\n` +
      `二、title 是不超过 30 字的概括性标题\n` +
      `三、body 是 markdown 正文，把每条知识点融合成连贯段落，保留全部具体信息（命令/路径/数字），不要泛泛而谈\n\n` +
      `知识点列表：\n${JSON.stringify(inputs, null, 0)}`;
    const raw = await this.chat(prompt, 'dream-cycle:synthesize');
    const jsonBlockMatch = raw.match(/\{[\s\S]*\}/);
    let title = '';
    let body = '';
    if (jsonBlockMatch) {
      try {
        const obj = JSON.parse(jsonBlockMatch[0]) as { title?: unknown; body?: unknown };
        if (typeof obj.title === 'string') title = obj.title.trim();
        if (typeof obj.body === 'string') body = obj.body.trim();
      } catch {
        // 解析失败走质量门槛（空标题/正文必然被拦）
      }
    }
    // 质量门槛：vs MockLLM 同输入输出（差异度轴）
    const mockOut = mockSynthesizeForDiff(inputs);
    const gate = validateKnowledgeQuality(
      `${title}\n${body}`,
      inputs.join('\n'),
      `${mockOut.title}\n${mockOut.body}`,
    );
    if (!gate.ok) {
      throw new Error(`RealLLM.synthesize 质量门槛拦截：${gate.reasons.join('；')}`);
    }
    return { title, body };
  }

  /**
   * 向量化——真 embedding 端点本版不接（检索服务是 v1.1.8+ 明确不做项），
   * 与 MockLLM.embed 同构的确定性 hash 派生向量（供本地去重用途）。
   */
  embed(input: string): Promise<number[]> {
    return new MockLLM().embed(input);
  }
}

/**
 * 默认 Provider 工厂——cron/采样器生产入口。
 *
 * 解析序：注册表 pipeline 档活动模型 → 注册表 executor 档 →
 * 环境变量（SOFAGENT_MODEL_API_KEY）→ 显式降级 MockLLM（status='mock'）。
 *
 * 「模型不可用时显式降级」语义在此落地：返回的 status/degradedReason
 * 进周报与 evolution report 降级标注，「占位符跑 7 天」永不默默发生。
 */
export function createDefaultProvider(dataDir: string): ProviderResolution {
  const endpoint = resolveActiveEndpoint(dataDir);
  if (endpoint) {
    return {
      provider: new RealLLM(endpoint),
      status: 'real',
      endpointDesc: `${endpoint.provider ?? 'endpoint'} → ${endpoint.baseUrl} (${endpoint.model})`,
    };
  }
  const env = resolveEnvEndpoint();
  if (env.hasKey) {
    // 有环境变量 key——走 callModelAPI 内置环境变量路径（endpointConfig=null）
    return {
      provider: new RealLLM(null),
      status: 'real',
      endpointDesc: 'env:SOFAGENT_MODEL_*（注册表无活动模型，环境变量 fallback）',
    };
  }
  return {
    provider: new MockLLM(),
    status: 'mock',
    degradedReason:
      '模型注册表无活动模型且 SOFAGENT_MODEL_API_KEY 未设置——显式降级 MockLLM（测试专用占位输出，产物不可当真实知识）',
  };
}
