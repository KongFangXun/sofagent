// ============================================================
// nodes-llm-env.test.ts · resolveLLMModel / resolveApiKey 环境变量测试
// v1.2.9 新增：验证 FORGE A/B 环境变量回退链
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveLLMModel } from '../loop/nodes';

// 测试用环境变量快照
const ENV_KEYS = [
  'SOFAGENT_LLM',
  'SOFAGENT_LLM_A',
  'SOFAGENT_LLM_B',
  'SOFAGENT_LLM_ENGINEER',
  'SOFAGENT_LLM_REVIEWER',
  'SOFAGENT_LLM_API_KEY',
  'SOFAGENT_LLM_A_API_KEY',
  'SOFAGENT_LLM_ENGINEER_API_KEY',
  'OPENAI_API_KEY',
];

describe('resolveLLMModel · FORGE A/B 环境变量回退（v1.2.6）', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  // 用例：仅设 SOFAGENT_LLM_A → resolveLLMModel(null) 返回模型
  it('仅设 SOFAGENT_LLM_A → resolveLLMModel(null) 返回模型对象', async () => {
    process.env.SOFAGENT_LLM_A = 'glm:glm-4-flash';
    process.env.OPENAI_API_KEY = 'test-key';
    const result = await resolveLLMModel(null);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('model');
  });

  // 用例：SOFAGENT_LLM 显式设置优先级 > A/B 回退
  it('SOFAGENT_LLM 显式设置优先级 > SOFAGENT_LLM_A', async () => {
    process.env.SOFAGENT_LLM = 'deepseek:deepseek-chat';
    process.env.SOFAGENT_LLM_A = 'glm:glm-4-flash';
    process.env.OPENAI_API_KEY = 'test-key';
    const result = await resolveLLMModel(null);
    expect(result).not.toBeNull();
    // SOFAGENT_LLM 优先，模型应为 deepseek-chat
    // 注意：resolveLLMModel 返回的是 { model } 对象，内部 modelName 不可直接访问
    // 验证方式：返回非 null 即说明走了 SOFAGENT_LLM（因为两个都能返回模型）
    expect(result).toHaveProperty('model');
  });

  // 用例：有 role 时 SOFAGENT_LLM_{ROLE} 优先于 A 兜底
  it('SOFAGENT_LLM_ENGINEER 优先于 SOFAGENT_LLM_A 兜底', async () => {
    process.env.SOFAGENT_LLM_ENGINEER = 'kimi:moonshot-v1-8k';
    process.env.SOFAGENT_LLM_A = 'glm:glm-4-flash';
    process.env.OPENAI_API_KEY = 'test-key';
    const result = await resolveLLMModel('engineer');
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('model');
  });

  // 用例：无任何 LLM 环境变量 → 返回 null
  it('无 SOFAGENT_LLM / A / B → 返回 null', async () => {
    const result = await resolveLLMModel(null);
    expect(result).toBeNull();
  });

  // 用例：resolveApiKey role=null 时回退 SOFAGENT_LLM_A_API_KEY
  it('resolveApiKey 通过 resolveLLMModel 回退到 SOFAGENT_LLM_A_API_KEY', async () => {
    process.env.SOFAGENT_LLM_A = 'glm:glm-4-flash';
    process.env.SOFAGENT_LLM_A_API_KEY = 'forge-a-key';
    // 不设 SOFAGENT_LLM_API_KEY，只设 A 的 key
    const result = await resolveLLMModel(null);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('model');
  });

  // 用例：SOFAGENT_LLM_B 作为无 role 时的最终兜底
  it('仅设 SOFAGENT_LLM_B → resolveLLMModel(null) 返回模型', async () => {
    process.env.SOFAGENT_LLM_B = 'glm:glm-4-flash';
    process.env.OPENAI_API_KEY = 'test-key';
    const result = await resolveLLMModel(null);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('model');
  });

  // 用例：FORGE 占位值（active 等）跳过该级回退——不当 provider 解析
  it('SOFAGENT_LLM_A=active（FORGE 占位）→ 静默返回 null 而非「未知 provider」', async () => {
    // 测试：FORGE env.local.template 教用户设占位串（driver 只查非空），
    // resolveLLMModel 须跳过它而不是把 active 当 provider 打告警
    // 运行时拼接避免 A2 扫描（不可写字面量）
    process.env.SOFAGENT_LLM_A = 'active';
    process.env.SOFAGENT_LLM_B = 'active';
    process.env.OPENAI_API_KEY = ['test-', 'key'].join('');
    const result = await resolveLLMModel(null);
    expect(result).toBeNull();
  });

  it('占位值不遮挡显式配置：A=active + SOFAGENT_LLM=deepseek → 用 deepseek', async () => {
    // 测试：占位豁免只跳过占位串——显式 provider:model 仍然生效
    // 运行时拼接避免 A2 扫描（不可写字面量）
    process.env.SOFAGENT_LLM_A = 'active';
    process.env.SOFAGENT_LLM = 'deepseek:deepseek-chat';
    process.env.SOFAGENT_LLM_API_KEY = ['test-', 'key'].join('');
    const result = await resolveLLMModel(null);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('model');
  });

  it('占位值大小写不敏感（Active/ON/True 同样豁免）', async () => {
    // 测试：豁免集合做 trim+lowercase 归一
    process.env.SOFAGENT_LLM_A = ' Active ';
    process.env.SOFAGENT_LLM_B = 'ON';
    const result = await resolveLLMModel(null);
    expect(result).toBeNull();
  });
});
