// ============================================================
// launcher.ts · Sub Agent 启动器
// v1.0.3 新增：动态 import deepagents，启动/关闭 Agent 实例
// deepagents 是 optionalDependency——未安装时 graceful fallback
// ============================================================

import type { SubAgentDefinition } from './registry';

/** Agent 实例接口 */
interface AgentInstance {
  close?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

/**
 * 动态加载 deepagents——未安装时返回 null
 */
async function loadDeepAgents(): Promise<((config: Record<string, unknown>) => Promise<unknown>) | null> {
  try {
    // @ts-ignore - deepagents is an optional dependency, may not be installed
    const { createDeepAgent } = await import('deepagents');
    return createDeepAgent as unknown as (config: Record<string, unknown>) => Promise<unknown>;
  } catch {
    console.warn('deepagents 未安装，Sub Agent 功能不可用。npm install deepagents 启用。');
    return null;
  }
}

/**
 * 启动 Sub Agent
 * @param definition Sub Agent 定义
 * @returns Agent 实例，或 null（deepagents 未安装）
 */
export async function launch(definition: SubAgentDefinition): Promise<AgentInstance | null> {
  const createDeepAgent = await loadDeepAgents();
  if (!createDeepAgent) return null;

  try {
    const instance = await createDeepAgent({
      name: definition.name,
      systemPrompt: definition.systemPrompt,
      tools: definition.tools,
      ...(definition.modelName ? { modelName: definition.modelName } : {}),
    });
    return instance as AgentInstance;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Sub Agent "${definition.name}" 启动失败: ${msg}`);
    return null;
  }
}

/**
 * 关闭 Agent 实例
 * @param instance Agent 实例
 */
export async function shutdown(instance: AgentInstance | null): Promise<void> {
  if (!instance) return;
  try {
    if (typeof instance.close === 'function') {
      await instance.close();
    } else if (typeof instance.shutdown === 'function') {
      await instance.shutdown();
    }
  } catch {
    // 关闭失败不影响主流程
  }
}
