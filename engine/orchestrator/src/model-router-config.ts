// ============================================================
// model-router-config.ts · ModelRouter 配置加载 + 验证（v1.5.2 · P1）
// ============================================================
//
// 职责：
//   1. 从 data/config/model-router.json 加载路由配置
//   2. zod 严格 schema 验证（provider/model/endpoint/policy 字段在场）
//   3. 缺文件 / 解析失败 → 降级到 DEFAULT_ROUTER_CONFIG 骨架
//      （骨架不写死模型选型——模型名留空表示「未配置」，见下方常量注释）
//
// 安全铁律：policy.fallbackOnLocalFailure.restricted / confidential
// 必须为 'block-and-alert'——绝不允许配置成云端 fallback（违背数据主权）。
// schema 层就用 z.literal('block-and-alert') 写死，从配置上封死逃逸口。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { readActiveEndpoints, type ModelRegistryEntry } from './model-registry';

// ============================================================
// Schema 定义
// ============================================================

/** 云端模型配置 */
const CloudModelSchema = z.object({
  provider: z.string().min(1),
  /**
   * 模型名——空串表示「未配置」。
   * 本组件不预设任何厂商模型选型，实际模型由 data/config/model-router.json 提供。
   */
  model: z.string(),
});

/**
 * 本地模型配置。
 *
 * `client_type` 决定本地模型走哪种客户端协议：
 *   - 'ollama'（缺省）：Ollama 原生 API（/api/chat、/api/tags 探针）——
 *     缺省值与内置可达性探测实现保持一致
 *   - 'openai-compatible'：标准 OpenAI 兼容协议（/v1/chat/completions）——
 *     适用于 vLLM / SGLang / 自建兼容服务 / Ollama 兼容模式；
 *     选用此档需自备匹配的 `localProbe` 实现（内置探测只覆盖 Ollama 原生协议）
 *
 * `model` 允许空串——语义是「未配置」（不预设本地模型选型）。
 *
 * 安全铁律不变：client_type 只改变连接协议，不改变数据主权策略
 * （restricted/confidential 仍 block-and-alert，不因 client_type 变化逃逸）。
 */
const LocalModelSchema = z.object({
  provider: z.enum(['ollama', 'openai-compatible']),
  /** 模型名——空串表示「未配置」（不预设本地模型选型） */
  model: z.string(),
  endpoint: z.string().url(),
  /** 客户端协议类型（缺省 ollama——与内置可达性探测实现一致） */
  client_type: z.enum(['ollama', 'openai-compatible']).default('ollama'),
  /** openai-compatible 模式的 API key（环境变量注入优先） */
  apiKey: z.string().optional(),
});

/**
 * 本地模型不可用时的降级策略
 * 安全铁律：restricted / confidential 必须 block-and-alert，绝不 fallback 云端
 */
const FallbackPolicySchema = z.object({
  public: z.enum(['cloud-strong', 'cloud-fast']),
  internal: z.enum(['cloud-strong', 'cloud-fast']),
  restricted: z.literal('block-and-alert'),
  confidential: z.literal('block-and-alert'),
});

/** 路由策略 */
const PolicySchema = z.object({
  restrictedForcesLocal: z.boolean(),
  confidentialForcesPipeline: z.boolean(),
  fallbackOnLocalFailure: FallbackPolicySchema,
});

/** 顶层配置 */
export const ModelRouterConfigSchema = z.object({
  cloud: z.object({
    strong: CloudModelSchema,
    fast: CloudModelSchema,
  }),
  local: z.object({
    executor: LocalModelSchema,
    pipeline: LocalModelSchema,
  }),
  policy: PolicySchema,
});

export type ModelRouterConfig = z.infer<typeof ModelRouterConfigSchema>;
export type FallbackPolicy = z.infer<typeof FallbackPolicySchema>;

// ============================================================
// 默认配置（缺文件时的降级骨架）
// ============================================================

/**
 * 设计纪律：**不写死模型选型**。
 *
 * - 档位是**抽象槽位**，实际模型由 `data/config/model-router.json` 或
 *   `model_switch` 注册表（model-registry）决定；默认配置只给「协议 +
 *   本机位置」这类与客户环境无关的骨架值
 * - **模型名一律留空**（`''`），语义是「未配置」——调用侧检测到空值即明确
 *   忽略或阻断。不预设模型：写死会造成「默认指向一个客户机上不存在的模型」，
 *   后果是发出一次注定失败的请求后静默降级，比显式阻断差
 * - `client_type` 默认 `ollama`——**与内置可达性探测实现保持一致**
 *   （`defaultLocalProbe` 走 Ollama 原生 `/api/tags`）。改用
 *   `openai-compatible` 的客户需自备匹配的 `localProbe` 实现
 * - 本地两档 `endpoint` 相同是有意的：`local-executor` 与 `local-pipeline`
 *   的区分是**任务形态**（执行 vs 管道），不是模型规格——同一台一体机上
 *   两者通常指向同一个本地推理模型，差别在调用参数（执行档给足上下文；
 *   管道档走约束解码 + 低 token 预算）
 *
 * 数据主权策略（`policy`）不受本骨架影响：restricted / confidential 恒为
 * `block-and-alert`，绝不因配置缺失而 fallback 云端。
 */
export const DEFAULT_ROUTER_CONFIG: ModelRouterConfig = {
  cloud: {
    strong: { provider: 'openai', model: '' },
    fast: { provider: 'openai', model: '' },
  },
  local: {
    executor: { provider: 'ollama', model: '', endpoint: 'http://localhost:11434', client_type: 'ollama' },
    pipeline: { provider: 'ollama', model: '', endpoint: 'http://localhost:11434', client_type: 'ollama' },
  },
  policy: {
    restrictedForcesLocal: true,
    confidentialForcesPipeline: true,
    fallbackOnLocalFailure: {
      public: 'cloud-strong',
      internal: 'cloud-strong',
      restricted: 'block-and-alert',
      confidential: 'block-and-alert',
    },
  },
};

// ============================================================
// 加载
// ============================================================

/**
 * 解析配置文件路径
 * 优先级：overridePath > cwd/data/config/model-router.json
 */
export function resolveRouterConfigPath(cwd?: string, overridePath?: string): string {
  if (overridePath) return overridePath;
  const base = cwd ?? process.cwd();
  return join(base, 'data', 'config', 'model-router.json');
}

/**
 * 加载路由配置
 *
 * 行为：
 *   - 文件不存在 → 返回 DEFAULT_ROUTER_CONFIG（不抛错）
 *   - 文件存在但 JSON 损坏 → 抛 ConfigLoadError
 *   - 文件存在但 schema 校验失败 → 抛 ConfigLoadError（含 zod 详情）
 *
 * @param cwd 项目根目录（默认 process.cwd()）
 * @param overridePath 测试隔离用配置路径
 */
export function loadModelRouterConfig(cwd?: string, overridePath?: string): ModelRouterConfig {
  const filePath = resolveRouterConfigPath(cwd, overridePath);
  if (!existsSync(filePath)) {
    return DEFAULT_ROUTER_CONFIG;
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new ModelRouterConfigError(`读取配置失败: ${filePath} — ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ModelRouterConfigError(`配置 JSON 损坏: ${filePath} — ${(err as Error).message}`);
  }

  const result = ModelRouterConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ModelRouterConfigError(`配置 schema 校验失败: ${filePath}\n${issues}`);
  }

  return result.data;
}

/** 配置加载错误（带上下文） */
export class ModelRouterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRouterConfigError';
  }
}

// ============================================================
// 注册表覆盖（活动模型从 model-registry 读取）
// ============================================================

/**
 * 用模型注册表的活动 endpoint 覆盖路由配置的 local 档位。
 *
 * 语义：model_register/model_switch 注册的活跃模型成为各档位的实际指向——
 * 替代「手改 model-router.json」。注册表无活动模型时保持原配置（降级不破坏）。
 *
 * 安全铁律不变：只覆盖 local.executor / local.pipeline 的连接信息，
 * policy（restricted/confidential block-and-alert）原样保留——
 * 数据主权路由不因注册表覆盖逃逸。
 *
 * @param config 基础路由配置（loadModelRouterConfig 产物）
 * @param dataDir 数据根目录（model-registry.json 所在）
 * @returns 覆盖后的配置（无活动模型时返回原对象引用）
 */
export function applyRegistryOverrides(config: ModelRouterConfig, dataDir: string): ModelRouterConfig {
  let active: { executor?: ModelRegistryEntry; pipeline?: ModelRegistryEntry };
  try {
    active = readActiveEndpoints(dataDir);
  } catch {
    return config; // 注册表损坏 → 降级用基础配置（绝不因注册表问题阻塞路由）
  }

  const toLocalModel = (entry: ModelRegistryEntry): ModelRouterConfig['local']['executor'] => ({
    provider: entry.clientType === 'openai-compatible' ? 'openai-compatible' : 'ollama',
    model: entry.model,
    endpoint: entry.endpoint,
    client_type: entry.clientType,
  });

  const next: ModelRouterConfig = {
    ...config,
    local: { ...config.local },
  };
  let changed = false;
  if (active.executor) {
    next.local.executor = toLocalModel(active.executor);
    changed = true;
  }
  if (active.pipeline) {
    next.local.pipeline = toLocalModel(active.pipeline);
    changed = true;
  }
  return changed ? next : config;
}
