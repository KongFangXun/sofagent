// ============================================================
// launcher.ts · Sub Agent 启动器
// v1.0.9 新增：动态 import deepagents，启动/关闭 Agent 实例
// v1.0.9 新增：runtime.json 状态管理（name/status/startedAt/lastActive/pid）
// v1.0.9：deepagents 提升为正式依赖，移除 as unknown as 类型转换
// v1.0.9 新增：buildConstrainedSystemPrompt() 四层约束加载链
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { loadEnvConfig } from '../config-loader';
import { getPersonaContent } from '../filesystem/memory-sync';
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

// ════════════════════════════════════════
// 四层约束自加载链（v1.0.7 新增）
// ════════════════════════════════════════

/**
 * 尝试读取文件——文件不存在时返回 null（静默跳过）
 */
function tryRead(filePath: string): string | null {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8');
    }
  } catch {
    // 读取失败静默跳过
  }
  return null;
}

/**
 * 扫描知识库目录，按 mtime 降序取前 N 个 .md 文件
 * 每篇截取前 2000 字符
 */
function listKnowledgeTopN(dir: string, n: number): string[] {
  const results: string[] = [];
  try {
    if (!existsSync(dir)) return results;

    const files = readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => join(dir, f))
      .filter(f => {
        try { return statSync(f).isFile(); } catch { return false; }
      })
      .sort((a, b) => {
        try {
          return statSync(b).mtimeMs - statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });

    for (let i = 0; i < Math.min(files.length, n); i++) {
      const content = tryRead(files[i]!);
      if (content) {
        results.push(content.slice(0, 2000));
      }
    }
  } catch {
    // 目录不存在等异常静默跳过
  }
  return results;
}

/**
 * 构建带约束的 system prompt（四层加载链）
 *
 * 纯文件系统读取，不依赖任何 Agent 平台的 Skill 注入机制。
 * 总注入量控制在 ~4000 token 以内。
 *
 * 加载顺序：
 * 1. 宪法层：SKILL.md（4 底线 + 7 铁律）
 * 2. 规范层：fde.md（企业专属规则）
 * 3. 反思层：think.md（历史踩坑）
 * 4. 知识库：knowledge/ top-N（按 mtime 排序，每篇截取前 2000 字符）
 * 5. v1.0.8: persona.md（TencentDB Agent 记忆，前 500 字符）
 *
 * @param skillDir 约束文件目录（如 .sofagent/）
 * @returns 拼接后的 system prompt 字符串
 */
export function buildConstrainedSystemPrompt(skillDir: string): string {
  const parts: string[] = [];

  // 1. 宪法层：SKILL.md
  const skillContent = tryRead(join(skillDir, 'SKILL.md'));
  if (skillContent) parts.push(`# 宪法约束\n${skillContent}`);

  // 2. 规范层：fde.md
  const fdeContent = tryRead(join(skillDir, 'fde.md'));
  if (fdeContent) parts.push(`# 企业规则\n${fdeContent}`);

  // 3. 反思层：think.md
  const thinkContent = tryRead(join(skillDir, 'think.md'));
  if (thinkContent) parts.push(`# 历史经验\n${thinkContent}`);

  // 4. 知识库：knowledge/ top-N（按 mtime 排序）
  const knowledgeFiles = listKnowledgeTopN(join(skillDir, 'knowledge'), 5);
  for (const file of knowledgeFiles) {
    parts.push(file);
  }

  // 5. v1.0.8: persona.md（TencentDB Agent 记忆，前 500 字符）
  try {
    const personaContent = getPersonaContent(skillDir, 500);
    if (personaContent) {
      parts.push(`# 用户画像 (persona)\n${personaContent}`);
    }
  } catch {
    // persona 注入失败不影响主流程
  }

  return parts.join('\n\n---\n\n');
}

// ════════════════════════════════════════
// DeepAgents 启动/关闭（v1.0.7：正式依赖）
// ════════════════════════════════════════

/**
 * 动态加载 deepagents（v1.0.7：正式依赖）
 */
async function loadDeepAgents(): Promise<Function | null> {
  try {
    const { createDeepAgent } = await import('deepagents');
    return createDeepAgent as Function;
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
    const instance = await (createDeepAgent as any)({
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

// ============================================================
// spawnSubAgent — v1.0.7 CLI 入口
// 从 CLI `subagent run <name> --task "..."` 调用
// v1.0.8: 支持 --mode sustain（持续优化模式）
// ============================================================
export async function spawnSubAgent(
  agent: SubAgentDefinition,
  task: string,
  mode?: 'deploy' | 'sustain'
): Promise<string> {
  // v1.0.8: 根据 mode 调整 system prompt
  const effectiveMode = mode ?? agent.mode ?? 'deploy';
  let systemPrompt = agent.systemPrompt ?? '';

  if (effectiveMode === 'sustain') {
    // sustain 模式：附加审计报告趋势分析指令
    const sustainBlock = [
      '',
      '## 持续优化模式（sustain）',
      '当前处于 sustain 模式。你必须：',
      '1. 读取 audit 报告趋势（权重最高）——分析历史审计记录的违规模式、频率变化、规则命中趋势',
      '2. 读取 think.md 反思趋势——从反思记录中提取重复踩坑模式和改进建议',
      '3. 分析 scoring 数据——评估各节点/规则的得分变化',
      '4. 生成周度/月度优化建议——包含 knowledge-domain 漏洞、节点效率、规则盲区',
      '5. 双 Agent 闭环：Audit 问"合规吗？"（底线）+ FDE sustain 问"能更好吗？"（上限）',
    ].join('\n');
    systemPrompt = systemPrompt + sustainBlock;
  }

  // 生成编排 prompt：将任务 + agent 定义拼装
  const prompt = [
    `# 任务`,
    task,
    '',
    '# Agent 角色',
    `名称: ${agent.name}`,
    `类型: ${agent.type}`,
    `模式: ${effectiveMode}`,
    systemPrompt ? `\n${systemPrompt}` : '',
    '# 指令',
    '请使用可用工具完成上述任务，完成后输出结果摘要。',
  ].filter(Boolean).join('\n');

  try {
    // 尝试通过 compose 编排执行（DeepAgents 内部分发到对应 agent）
    const { composeWithDeepAgents } = await import('./composer');
    // composeTask 自带 agent 名称信息
    const result = await composeWithDeepAgents(prompt);
    return result ?? `Agent "${agent.name}" 已接收任务，但编排引擎未返回结果。`;
  } catch (err) {
    // DeepAgents 不可用时返回提示
    return [
      `⚠️ DeepAgents 不可用——Agent "${agent.name}" 的 prompt 已生成，可手动执行：`,
      '',
      '```yaml',
      `agent: ${agent.name}`,
      `type: ${agent.type}`,
      `task: ${task}`,
      `tools: [${agent.tools.join(', ')}]`,
      '```',
      '',
      agent.systemPrompt ? `\n${agent.systemPrompt}\n` : '',
    ].join('\n');
  }
}
