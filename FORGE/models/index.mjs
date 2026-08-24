// ─── 模型配置 resolver ──────────────────────────────────────────
// 把 profile.mjs 的角色映射 + 各模型文件的定义，组装成 driver 需要的
// MODEL_CONFIGS 和 MODEL_PRICING 对象。
//
// 用法（在 driver 里）：
//   import { resolveConfigs, resolvePricing } from '../models/index.mjs';
//   const MODEL_CONFIGS = resolveConfigs(AGENTS_DIR);
//   const MODEL_PRICING = resolvePricing();

import profile from './profile.mjs';

// 预加载所有模型定义——resolvePricing 需要全量收集（即使 profile 没引用的模型也要进定价表，
// 这样从 GLM 切回 DeepSeek 时成本估算不需要手动改定价表）
import qwen38max from './qwen3.8-max.mjs';
import glm53 from './glm-5.3.mjs';
import deepseekV4Pro from './deepseek-v4-pro.mjs';
import deepseekV4Flash from './deepseek-v4-flash.mjs';

const ALL_MODELS = [qwen38max, glm53, deepseekV4Pro, deepseekV4Flash];

// 角色到工具集的映射
const ROLE_TOOLS = {
  reviewer: 'REVIEWER_TOOLS',
  engineer: 'ENGINEER_TOOLS',
};

// 默认 maxTokens（模型文件里没定义时用这个）
const DEFAULT_MAX_TOKENS = 16000;

/**
 * 组装 MODEL_CONFIGS——driver 里每个角色需要的完整配置对象。
 *
 * 输出 shape（与旧 driver 硬编码的完全一致）：
 *   {
 *     baseURL, model, maxTokens, apiKeyEnv, specEnv,
 *     agentSkillPath, toolsKey, billing,
 *     thinking?, reasoningEffort?, temperature?  // 可选
 *   }
 *
 * @param {string} agentsDir  SKILL/agents 的绝对路径（driver 传入）
 * @returns {Object} 以角色名为 key 的配置对象
 */
export function resolveConfigs(agentsDir) {
  const configs = {};

  for (const [roleName, roleDef] of Object.entries(profile)) {
    const m = roleDef.model;

    // 从模型定义展开基础字段
    const cfg = {
      baseURL:    m.baseURL,
      model:      m.model,
      maxTokens:  m.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    // API key 环境变量优先级：profile 显式覆盖 > 模型文件自带 > 默认拼接角色名
    // 这样切模型时 key 自动跟着走（每个模型文件标注自己用哪个厂商的 key 变量）
    cfg.apiKeyEnv = roleDef.apiKeyEnv ?? m.apiKeyEnv ?? `SOFAGENT_LLM_${roleName}_API_KEY`;
    cfg.specEnv   = roleDef.specEnv   ?? m.specEnv   ?? `SOFAGENT_LLM_${roleName}`;

    // 角色相关字段
    cfg.agentSkillPath = join(agentsDir, `${roleDef.role}/SKILL.md`);
    cfg.toolsKey       = ROLE_TOOLS[roleDef.role] ?? 'REVIEWER_TOOLS';

    // 计费模式（从 pricing 提取）
    cfg.billing = m.pricing?.billing ?? 'pay-as-you-go';

    // 可选参数（GLM/DeepSeek 有，Qwen 没有）
    if (m.thinking)        cfg.thinking        = m.thinking;
    if (m.reasoningEffort) cfg.reasoningEffort = m.reasoningEffort;
    if (m.temperature !== undefined) cfg.temperature = m.temperature;

    configs[roleName] = cfg;
  }

  return configs;
}

/**
 * 组装 MODEL_PRICING——以 model 名为 key 的定价表。
 * 遍历所有模型文件（不仅仅是 profile 当前引用的），确保切回历史模型时定价表也有数据。
 *
 * @returns {Object} 以 model 名为 key 的定价对象
 */
export function resolvePricing() {
  const pricing = {};

  for (const m of ALL_MODELS) {
    if (m.pricing && !pricing[m.model]) {
      pricing[m.model] = m.pricing;
    }
  }

  return pricing;
}

// 简易 join（避免 import path 模块——index.mjs 被 driver import 时 __dirname 不可用）
function join(dir, file) {
  return dir.endsWith('/') ? dir + file : dir + '/' + file;
}
