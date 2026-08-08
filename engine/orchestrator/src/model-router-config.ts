// ============================================================
// model-router-config.ts · ModelRouter 配置加载 + 验证（v1.2.9 · P1）
// ============================================================
//
// 职责：
//   1. 从 data/config/model-router.json 加载路由配置
//   2. zod 严格 schema 验证（provider/model/endpoint/policy 字段必填）
//   3. 缺文件 / 解析失败 → 降级到 DEFAULT_ROUTER_CONFIG（保证开箱可用）
//
// 安全铁律：policy.fallbackOnLocalFailure.restricted / confidential
// 必须为 'block-and-alert'——绝不允许配置成云端 fallback（违背数据主权）。
// schema 层就用 z.literal('block-and-alert') 写死，从配置上封死逃逸口。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

// ============================================================
// Schema 定义
// ============================================================

/** 云端模型配置 */
const CloudModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

/** 本地模型配置（Ollama） */
const LocalModelSchema = z.object({
  provider: z.literal('ollama'),
  model: z.string().min(1),
  endpoint: z.string().url(),
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
// 默认配置（缺文件时降级）
// ============================================================

export const DEFAULT_ROUTER_CONFIG: ModelRouterConfig = {
  cloud: {
    strong: { provider: 'openai', model: 'gpt-4o' },
    fast: { provider: 'deepseek', model: 'deepseek-chat' },
  },
  local: {
    executor: { provider: 'ollama', model: 'qwen2.5:7b', endpoint: 'http://localhost:11434' },
    pipeline: { provider: 'ollama', model: 'qwen2.5:0.5b', endpoint: 'http://localhost:11434' },
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
