// ============================================================
// launcher.ts · Sub Agent 启动器
// v1.0.6 新增：动态 import deepagents，启动/关闭 Agent 实例
// v1.0.6 新增：runtime.json 状态管理（name/status/startedAt/lastActive/pid）
// deepagents 是 optionalDependency——未安装时 graceful fallback
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { loadEnvConfig } from '../config-loader';
import type { SubAgentDefinition } from './registry';

/** Agent 实例接口 */
interface AgentInstance {
  close?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

/** runtime.json 中单个 Agent 的状态记录 */
interface RuntimeEntry {
  name: string;
  status: 'active' | 'idle' | 'stopped';
  startedAt: string;
  lastActive: string;
  pid?: number;
}

/** 完整的 runtime.json 结构 */
interface RuntimeState {
  agents: RuntimeEntry[];
}

/** 活跃的心跳定时器引用（用于 shutdown 时清理） */
const activeHeartbeats = new Map<string, ReturnType<typeof setInterval>>();

/**
 * 获取 runtime.json 路径
 */
function getRuntimePath(): string {
  const envConfig = loadEnvConfig();
  return join(envConfig.dataDir, 'subagents', 'runtime.json');
}

/**
 * 原子写入——先写临时文件，再 rename 覆盖目标。
 * rename 在同文件系统上是原子操作，防止并发写脏读。
 */
function atomicWriteSync(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      copyFileSync(tmp, filePath);
      unlinkSync(tmp);
    } else {
      throw err;
    }
  }
}

/**
 * 读取 runtime.json，不存在时返回空状态
 */
export function readRuntimeState(): RuntimeState {
  const runtimePath = getRuntimePath();
  if (!existsSync(runtimePath)) {
    return { agents: [] };
  }
  try {
    const content = readFileSync(runtimePath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.agents)) {
      return parsed as RuntimeState;
    }
    return { agents: [] };
  } catch {
    return { agents: [] };
  }
}

/**
 * 写入 runtime.json（原子写）
 */
export function writeRuntimeState(state: RuntimeState): void {
  const runtimePath = getRuntimePath();
  const dir = join(runtimePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  atomicWriteSync(runtimePath, JSON.stringify(state, null, 2));
}

/**
 * 更新单个 Agent 的 runtime 状态
 */
function upsertRuntimeEntry(entry: RuntimeEntry): void {
  const state = readRuntimeState();
  const idx = state.agents.findIndex((a) => a.name === entry.name);
  if (idx >= 0) {
    state.agents[idx] = entry;
  } else {
    state.agents.push(entry);
  }
  writeRuntimeState(state);
}

/**
 * 启动心跳——每 30s 更新 lastActive
 */
function startHeartbeat(agentName: string): void {
  // 清理已有心跳（防止重复启动）
  stopHeartbeat(agentName);

  const interval = setInterval(() => {
    const state = readRuntimeState();
    const agent = state.agents.find((a) => a.name === agentName);
    if (agent && agent.status !== 'stopped') {
      agent.lastActive = new Date().toISOString();
      writeRuntimeState(state);
    }
  }, 30_000);

  activeHeartbeats.set(agentName, interval);
}

/**
 * 停止心跳
 */
function stopHeartbeat(agentName: string): void {
  const interval = activeHeartbeats.get(agentName);
  if (interval) {
    clearInterval(interval);
    activeHeartbeats.delete(agentName);
  }
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

    // 记录 runtime 状态
    const now = new Date().toISOString();
    upsertRuntimeEntry({
      name: definition.name,
      status: 'active',
      startedAt: now,
      lastActive: now,
      pid: process.pid,
    });

    // 启动 30s 心跳
    startHeartbeat(definition.name);

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
 * @param agentName Agent 名称（用于更新 runtime 状态）
 */
export async function shutdown(instance: AgentInstance | null, agentName?: string): Promise<void> {
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

  // 更新 runtime 状态 + 停止心跳
  if (agentName) {
    stopHeartbeat(agentName);
    const now = new Date().toISOString();
    upsertRuntimeEntry({
      name: agentName,
      status: 'stopped',
      startedAt: now, // 保持不变（upsertRuntimeEntry 会覆盖，需要保留原始 startedAt）
      lastActive: now,
      pid: process.pid,
    });

    // 保留原始 startedAt：重新读取并只更新 status 和 lastActive
    const state = readRuntimeState();
    const agent = state.agents.find((a) => a.name === agentName);
    if (agent) {
      agent.status = 'stopped';
      agent.lastActive = now;
      writeRuntimeState(state);
    }
  }
}
