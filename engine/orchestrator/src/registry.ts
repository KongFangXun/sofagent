// ============================================================
// registry.ts · Sub Agent 注册机制
// v1.3.7 新增：从 YML 文件加载 Sub Agent 定义
// v1.4.5：迁移至 @sofagent/orchestrator
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { BUILTIN_AGENTS } from './builtin-agents';

export interface SubAgentDefinition {
  /** 唯一标识名称 */
  name: string;
  /** 类型：development | audit | enterprise */
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
  /** v1.0.8: FDE 运行模式 */
  mode?: 'deploy' | 'sustain';
  /** v1.2.6: 是否需要 Human-in-the-Loop 确认 */
  hitl?: boolean;
  /** v1.2.6: HITL 配置（触发条件 + 描述） */
  hitlConfig?: { trigger: string; description?: string };
  /** v1.2.6: 知识域（用于约束 Agent 的知识访问范围） */
  knowledgeDomain?: string;
  /**
   * v1.3.6 交付 ③：Graph 构建器名（运行时字段——不持久化到 YML）。
   * harness.wrap 产物注册进 builder-registry 后，resolveAgent 命中时回填此字段；
   * dag-runner 经 getGraphBuilder(name).build() 按需实例化执行。
   */
  graphBuilderName?: string;
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
      // v1.2.6: 解析 enterprise agent 扩展字段（camelCase）
      hitl: parsed.hitl as boolean | undefined,
      hitlConfig: parsed.hitlConfig as { trigger: string; description?: string } | undefined,
      knowledgeDomain: parsed.knowledgeDomain as string | undefined,
    };
  } catch {
    // 单个 agent yml 解析失败跳过该条——registry 整体可用，不让一个坏文件拖垮加载
    return null;
  }
}

/**
 * 列出 .sofagent/subagents/ 下所有 Sub Agent 定义
 * @param dataDir .sofagent 数据目录
 * @returns SubAgentDefinition 数组
 */
export function listAgents(dataDir: string): SubAgentDefinition[] {
  const definitions: SubAgentDefinition[] = [...BUILTIN_AGENTS]; // v1.0.7: 预装 FDE + Audit

  const subagentsDir = join(dataDir, 'subagents');
  if (!existsSync(subagentsDir)) return definitions;

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
