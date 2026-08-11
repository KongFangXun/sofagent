// ============================================================
// onboard/creation-validator.ts · agent-creation 结构完整性验证（v1.3.2 交付 5）
// ============================================================
//
// 建完 Agent 后自动检查验证清单（dev-prompt 验收标准）：
//   - config 可 parse + 结构正确
//   - think.md 非空
//   - knowledge 条目结构正确
//   - 未改 Agent 目录外的文件
//   - 不持久化 provider/model_id（只写 thinking_level）
// ============================================================

import type { DerivedAgentConfig } from './agent-creator';

/** 验证结果 */
export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 验证 agent-creation 产出的结构完整性。
 *
 * @param config 推导出的 Agent 配置
 * @returns ValidationResult
 */
export function validateAgentCreation(config: DerivedAgentConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. config 可 parse + 结构正确
  if (!config.name || config.name.trim().length === 0) {
    errors.push('Agent name 为空');
  }
  if (!config.role || config.role.trim().length === 0) {
    errors.push('Agent role 为空');
  }
  if (!config.domain || config.domain.trim().length === 0) {
    errors.push('Agent domain 为空');
  }
  if (!config.action || config.action.trim().length === 0) {
    errors.push('Agent action 为空');
  }

  // 2. think.md 非空
  if (!config.thinkMd || config.thinkMd.trim().length === 0) {
    errors.push('think.md 为空');
  } else {
    // think.md 应含角色 + 规则
    if (!config.thinkMd.includes('# ') && !config.thinkMd.includes('## ')) {
      warnings.push('think.md 缺少 Markdown 标题结构');
    }
    if (!config.thinkMd.includes('应做') && !config.thinkMd.includes('禁止')) {
      warnings.push('think.md 缺少应做/禁止规则段');
    }
  }

  // 3. knowledge 条目结构正确（非空字符串数组）
  if (config.matchedKnowledge) {
    for (const kw of config.matchedKnowledge) {
      if (typeof kw !== 'string' || kw.trim().length === 0) {
        errors.push(`knowledge 条目结构错误：${JSON.stringify(kw)}`);
      }
    }
  }

  // 4. inclusionRules / exclusionRules 非空
  if (!config.inclusionRules || config.inclusionRules.length === 0) {
    warnings.push('inclusionRules（应做规则）为空');
  }
  if (!config.exclusionRules || config.exclusionRules.length === 0) {
    warnings.push('exclusionRules（禁止规则）为空');
  }

  // 5. thinking_level 必须有值（唯一持久化的运行时参数）
  if (!config.thinkingLevel || config.thinkingLevel.trim().length === 0) {
    errors.push('thinkingLevel 为空（必须持久化——是唯一写入 Agent State 的运行时参数）');
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证不持久化 provider/model_id（铁律检查）。
 *
 * @param config 推导出的 Agent 配置
 * @returns 是否违反铁律（true = 违反）
 */
export function checkNoModelPersistence(config: DerivedAgentConfig): boolean {
  // think.md 中不应出现 provider/model_id 硬编码
  const forbiddenPatterns = [
    /provider\s*[:=]\s*['"]?(openai|deepseek|ollama|anthropic)['"]?/i,
    /model_id\s*[:=]\s*['"]?(gpt-|deepseek-|qwen|claude)['"]?/i,
    /modelName\s*[:=]\s*['"]?(gpt-|deepseek-|qwen|claude)['"]?/i,
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(config.thinkMd)) {
      return true;
    }
  }
  return false;
}
