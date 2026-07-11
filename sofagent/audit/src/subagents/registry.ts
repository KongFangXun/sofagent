// ============================================================
// registry.ts · Sub Agent 注册机制
// v1.0.3 新增：从 YML 文件加载 Sub Agent 定义
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

export interface SubAgentDefinition {
  /** 唯一标识名称 */
  name: string;
  /** 类型：development | audit */
  type: string;
  /** 描述 */
  description: string;
  /** 可用工具列表 */
  tools: string[];
  /** 系统 prompt */
  systemPrompt: string;
  /** 使用的模型名称（null = 使用主 Agent 的） */
  modelName: string | null;
  /** 触发条件（仅 audit 类型） */
  triggerOn?: string[];
  /** YML 文件路径 */
  _sourcePath?: string;
}

/**
 * 从 YML 文件加载单个 Sub Agent 定义
 * @param ymlPath YML 文件路径
 * @returns SubAgentDefinition 或 null（文件不存在/解析失败）
 */
export function loadDefinition(ymlPath: string): SubAgentDefinition | null {
  if (!existsSync(ymlPath)) {
    return null;
  }

  try {
    const content = readFileSync(ymlPath, 'utf-8');
    const parsed = yamlLoad(content) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      name: String(parsed.name ?? ''),
      type: String(parsed.type ?? ''),
      description: String(parsed.description ?? ''),
      tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : [],
      systemPrompt: String(parsed.systemPrompt ?? ''),
      modelName: parsed.modelName ? String(parsed.modelName) : null,
      triggerOn: Array.isArray(parsed.triggerOn) ? parsed.triggerOn.map(String) : undefined,
      _sourcePath: ymlPath,
    };
  } catch {
    return null;
  }
}

/**
 * 列出 .sofagent/subagents/ 下所有 Sub Agent 定义
 * @param dataDir .sofagent 数据目录
 * @returns SubAgentDefinition 数组
 */
export function listAgents(dataDir: string): SubAgentDefinition[] {
  const subagentsDir = join(dataDir, 'subagents');
  if (!existsSync(subagentsDir)) return [];

  const definitions: SubAgentDefinition[] = [];

  try {
    const files = readdirSync(subagentsDir);
    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
      const def = loadDefinition(join(subagentsDir, file));
      if (def) definitions.push(def);
    }
  } catch {
    // 读取失败返回空
  }

  return definitions;
}
