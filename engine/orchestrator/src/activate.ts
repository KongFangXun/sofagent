// ============================================================
// activate.ts · 激活链 Phase 1 ACTIVATE (v1.4.3)
// ============================================================
//
// 读取 FDE 交付物（workflow.yml + skills/ + entities/），
// 组装企业 SubAgent 定义，写入 .sofagent/subagents/*.yml。
//
// 核心函数: activateWorkflow(opts) → ActivateResult
//
// 路径说明（关键！）：
//   输入（workflow.yml/skills/entities）在 dataDir/data/ 下
//   输出（subagents/）在 dataDir/subagents/（无 data/ 子层）
//   这是 registry.ts L73 join(dataDir, 'subagents') 的实际行为
//
// 不碰 LangGraph——只注册 Agent，不构建编排图
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { loadDefinition } from './registry';
import { generateAgentIdentity, extractConstraintsFromPrompt } from '@sofagent/core';
import type { AgentIdentity } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

/** 企业 Agent 配置——组装后写入 YML */
export interface EnterpriseAgentConfig {
  /** 节点 id（如 customer-intake） */
  name: string;
  /** 节点中文名（如 客户接单） */
  displayName: string;
  /** 🔄=auto, ⚡=assist */
  type: 'auto' | 'assist';
  /** 描述 */
  description: string;
  /** 从 SKILL.md 提取 + knowledge_domain 约束组装 */
  systemPrompt: string;
  /** 从 actions 映射（read→[Read,Glob,Grep] 等） */
  tools: string[];
  /** null = 用主 Agent 模型 */
  modelName: string | null;
  /** ⚡=true, 🔄=false（默认推断） */
  hitl: boolean;
  /** HITL 配置 */
  hitlConfig?: { interruptBefore: boolean; prompt?: string };
  /** v1.2.5 §3.1: Agent 身份码 */
  identity?: AgentIdentity;
  /** v1.2.6: 知识域（用于约束 Agent 的知识访问范围） */
  knowledgeDomain?: string;
}

/** activateWorkflow 返回值 */
export interface ActivateResult {
  /** 注册的 Agent name 列表 */
  registeredAgents: string[];
  /** 拓扑描述（文本格式，给 Phase 2 composeEnterpriseWorkflow 用） */
  workflowGraph: string;
  /** 👤 节点等跳过记录 */
  skippedNodes: Array<{ name: string; reason: string }>;
  /** 需要 HITL 的节点列表 */
  hitlNodes: string[];
}

/** activateWorkflow 入参 */
export interface ActivateOptions {
  /** resolveDataDir() 解析出的 .sofagent/ 路径（不含 data/ 子层） */
  dataDir: string;
  /** true = 只预览不写文件 */
  dryRun: boolean;
  /** 只激活指定节点 id */
  nodeFilter?: string[];
}

// ============================================================
// 内部类型——FDE workflow.yml 节点格式（宽松解析）
// ============================================================

interface FdeWorkflowNode {
  id: string;
  name?: string;
  type?: string;
  agent?: string;
  skill_ref?: string;
  entity_ref?: string;
  task?: string;
  depends_on?: string[];
  actions?: string[];
  knowledge_domain?: {
    include?: string[];
    exclude?: string[];
  };
  hitl?: boolean;
  hitl_config?: {
    interrupt_before?: boolean;
    prompt?: string;
  };
}

interface FdeWorkflow {
  name?: string;
  description?: string;
  nodes?: FdeWorkflowNode[];
}

// ============================================================
// 工具权限映射（§2.8 决策表）
// ============================================================

/** actions 声明 → tools 数组映射 */
const ACTION_TO_TOOLS: Record<string, string[]> = {
  read: ['Read', 'Glob', 'Grep'],
  write: ['Write', 'Edit'],
  bash: ['Bash'],
  audit: ['run_audit', 'audit_file'],
  mcp: ['*'],
};

/**
 * 将 actions 数组映射为 tools 数组
 * 未声明 actions → 默认 ['read'] 映射的 ['Read', 'Glob', 'Grep']（最小权限原则）
 */
function resolveTools(actions: string[] | undefined): string[] {
  if (!actions || actions.length === 0) {
    return ACTION_TO_TOOLS['read']!;
  }

  const toolSet = new Set<string>();
  for (const action of actions) {
    const mapped = ACTION_TO_TOOLS[action.toLowerCase()];
    if (mapped) {
      for (const t of mapped) {
        toolSet.add(t);
      }
    }
  }

  // 如果映射结果为空（如 actions 声明了未知值），降级为最小权限
  if (toolSet.size === 0) {
    return ACTION_TO_TOOLS['read']!;
  }

  return Array.from(toolSet);
}

// ============================================================
// SKILL.md 正文提取（frontmatter 之后的 body）
// ============================================================

/**
 * 从 SKILL.md 提取正文——去掉 frontmatter（--- 之间的 YAML）取 body
 *
 * 与 builtin-agents.ts 的 parseSkillMd 不同：
 * activate 只需要 body 正文（identity header 由 activate 自行拼接），
 * 不需要 parseSkillMd 那样的 frontmatter → 身份标签转换。
 */
function extractSkillBody(content: string): string {
  const parts = content.split('---');
  if (parts.length < 3) {
    return content.trim();
  }
  // body = frontmatter 之后的全部内容
  const body = parts.slice(2).join('---').trim();
  return body;
}

// ============================================================
// entity 知识域提取
// ============================================================

interface KnowledgeDomain {
  include: string[];
  exclude: string[];
}

/**
 * 从 entity markdown 文件中提取 knowledge_domain（include/exclude）
 *
 * entity 文件格式（FDE 产出）：
 *   ---
 *   name: 客户管理
 *   knowledge_domain:
 *     include: [客户信息, 订单格式]
 *     exclude: [其他客户数据]
 *   ---
 *   正文...
 *
 * 如果文件没有 knowledge_domain frontmatter，返回空数组。
 */
function extractKnowledgeDomain(entityPath: string): KnowledgeDomain {
  const result: KnowledgeDomain = { include: [], exclude: [] };

  if (!existsSync(entityPath)) {
    return result;
  }

  let content: string;
  try {
    content = readFileSync(entityPath, 'utf-8');
  } catch {
    return result;
  }

  // 提取 frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch || !fmMatch[1]) {
    return result;
  }

  const fmRaw = fmMatch[1];
  try {
    const fm = yamlLoad(fmRaw) as Record<string, unknown> | null;
    if (fm && typeof fm === 'object') {
      const kd = fm['knowledge_domain'] as { include?: string[]; exclude?: string[] } | undefined;
      if (kd) {
        if (Array.isArray(kd.include)) {
          result.include = kd.include.map(String);
        }
        if (Array.isArray(kd.exclude)) {
          result.exclude = kd.exclude.map(String);
        }
      }
    }
  } catch {
    // YAML 解析失败——返回空
  }

  return result;
}

// ============================================================
// systemPrompt 组装
// ============================================================

/**
 * 自行组装 systemPrompt（不使用 buildConstrainedSystemPrompt——其签名从磁盘读，不接受传入内容）
 *
 * 结构：
 *   [Agent: {nodeId} — {displayName}]
 *   你是企业"{displayName}"岗位的 AI Agent。
 *
 *   ## 任务
 *   {nodeTask}
 *
 *   ## 岗位技能（SKILL.md 正文）
 *   {skillBody}
 *
 *   ## 知识域约束
 *   允许访问的知识域: {include.join(', ')}
 *   禁止访问的知识域: {exclude.join(', ')}
 */
function assembleSystemPrompt(
  nodeId: string,
  displayName: string,
  nodeTask: string,
  skillBody: string,
  knowledgeDomain: KnowledgeDomain,
): string {
  const lines: string[] = [];

  lines.push(`[Agent: ${nodeId} — ${displayName}]`);
  lines.push(`你是企业"${displayName}"岗位的 AI Agent。`);
  lines.push('');

  if (nodeTask) {
    lines.push('## 任务');
    lines.push(nodeTask);
    lines.push('');
  }

  lines.push('## 岗位技能（SKILL.md 正文）');
  lines.push(skillBody || '(SKILL.md 正文为空)');
  lines.push('');

  const includeStr = knowledgeDomain.include.length > 0
    ? knowledgeDomain.include.join(', ')
    : '(无限制)';
  const excludeStr = knowledgeDomain.exclude.length > 0
    ? knowledgeDomain.exclude.join(', ')
    : '(无)';

  lines.push('## 知识域约束');
  lines.push(`允许访问的知识域: ${includeStr}`);
  lines.push(`禁止访问的知识域: ${excludeStr}`);

  return lines.join('\n');
}

// ============================================================
// YML 序列化
// ============================================================

/**
 * 将 EnterpriseAgentConfig 序列化为 YML 字符串
 *
 * 输出格式与 registry.ts 的 loadDefinition() 兼容：
 *   name, type, description, tools, systemPrompt, modelName, mode
 * 外加 v1.2.6 预留字段：displayName, hitl, hitlConfig
 */
function serializeToYml(config: EnterpriseAgentConfig): string {
  const ymlObj: Record<string, unknown> = {
    name: config.name,
    displayName: config.displayName,
    type: config.type,
    description: config.description,
    tools: config.tools,
    modelName: config.modelName,
    systemPrompt: config.systemPrompt,
    mode: 'deploy',
    hitl: config.hitl,
  };

  if (config.hitlConfig) {
    ymlObj['hitlConfig'] = config.hitlConfig;
  }

  // v1.2.6: 写入 knowledgeDomain（camelCase，与 displayName/hitl/hitlConfig 一致）
  if (config.knowledgeDomain) {
    ymlObj['knowledgeDomain'] = config.knowledgeDomain;
  }

  // v1.2.5 §3.1: 写入身份码
  if (config.identity) {
    ymlObj['identity'] = config.identity;
  }

  return yamlDump(ymlObj, {
    indent: 2,
    lineWidth: -1, // 不换行长字符串（systemPrompt）
    noRefs: true,
  });
}

// ============================================================
// 拓扑描述生成
// ============================================================

/**
 * 生成工作流拓扑描述文本（给 Phase 2 composeEnterpriseWorkflow 用）
 *
 * 格式：
 *   工作流: {workflowName}
 *   描述: {workflowDescription}
 *
 *   节点拓扑:
 *   - {id} ({name}) → type={type}, hitl={hitl}, depends_on=[...]
 *   ...
 *
 *   跳过节点:
 *   - {id}: {reason}
 *   ...
 */
function generateTopologyDescription(
  workflowName: string,
  workflowDesc: string,
  configs: EnterpriseAgentConfig[],
  skipped: Array<{ name: string; reason: string }>,
): string {
  const lines: string[] = [];

  lines.push(`工作流: ${workflowName || '(未命名)'}`);
  if (workflowDesc) {
    lines.push(`描述: ${workflowDesc}`);
  }
  lines.push('');
  lines.push('节点拓扑:');

  for (const c of configs) {
    const deps = configs
      .filter((other) => other !== c)
      .map((other) => other.name);
    const depStr = deps.length > 0 ? `[${deps.join(', ')}]` : '[]';
    lines.push(`- ${c.name} (${c.displayName}) → type=${c.type}, hitl=${c.hitl}`);
  }

  if (skipped.length > 0) {
    lines.push('');
    lines.push('跳过节点:');
    for (const s of skipped) {
      lines.push(`- ${s.name}: ${s.reason}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// 主函数
// ============================================================

/**
 * 激活工作流——读 FDE 交付物，组装企业 SubAgent，写入 subagents/*.yml
 *
 * 处理流程（9 步）：
 * 1. 读 dataDir/data/workflow.yml
 * 2. 遍历节点——type 判断（👤 跳过 / 🔄 auto / ⚡ assist）
 * 3. 读 skill_ref + entity_ref
 * 4. 从 SKILL.md 提取正文
 * 5. 从 entity 提取 knowledge_domain
 * 6. 组装 EnterpriseAgentConfig
 * 7. 如果 !dryRun 写入 dataDir/subagents/<node-id>.yml
 * 8. 生成拓扑描述
 * 9. 返回 ActivateResult
 *
 * @param opts 激活选项
 * @returns ActivateResult
 */
export async function activateWorkflow(opts: ActivateOptions): Promise<ActivateResult> {
  const { dataDir, dryRun, nodeFilter } = opts;

  const dataSubDir = join(dataDir, 'data');

  // ── Step 1: 读 workflow.yml ──
  const workflowPath = join(dataSubDir, 'workflow.yml');
  if (!existsSync(workflowPath)) {
    throw new Error(`workflow.yml 不存在: ${workflowPath}\n请先运行 FDE 诊断生成 workflow.yml`);
  }

  let workflow: FdeWorkflow;
  try {
    const content = readFileSync(workflowPath, 'utf-8');
    const parsed = yamlLoad(content) as Record<string, unknown> | FdeWorkflow | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('workflow.yml 解析结果为空或非对象');
    }
    // v1.2.6: 兼容平铺（旧）和嵌套（新标准）两种格式
    // 嵌套格式：{ workflow: { name, description, nodes } }
    // 平铺格式：{ name, description, nodes }
    const root = (parsed as Record<string, unknown>)['workflow'] as Record<string, unknown> | undefined;
    if (root && typeof root === 'object') {
      workflow = {
        name: (root['name'] as string) || ((parsed as Record<string, unknown>)['name'] as string),
        description: (root['description'] as string) || ((parsed as Record<string, unknown>)['description'] as string),
        nodes: (root['nodes'] as FdeWorkflowNode[]) || ((parsed as Record<string, unknown>)['nodes'] as FdeWorkflowNode[]),
      };
    } else {
      workflow = parsed as FdeWorkflow;
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('不存在')) {
      throw err;
    }
    throw new Error(`workflow.yml 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  const workflowName = workflow.name || '(未命名工作流)';
  const workflowDesc = workflow.description || '';
  const nodes = workflow.nodes || [];

  // ── 初始化结果容器 ──
  const configs: EnterpriseAgentConfig[] = [];
  const skippedNodes: Array<{ name: string; reason: string }> = [];

  // ── Step 2-6: 遍历每个节点 ──
  for (const node of nodes) {
    const nodeId = node.id;

    // node-filter 过滤
    if (nodeFilter && nodeFilter.length > 0 && !nodeFilter.includes(nodeId)) {
      continue;
    }

    // Step 2: type 判断
    const nodeType = node.type || '🔄'; // 缺 type 默认自动

    // 👤 人工节点 → 跳过
    if (nodeType === '👤') {
      skippedNodes.push({
        name: nodeId,
        reason: '人工节点（type=👤），无需激活为 AI Agent',
      });
      continue;
    }

    // 映射 type：🔄 → auto，⚡ → assist
    let agentType: 'auto' | 'assist';
    let defaultHitl: boolean;

    if (nodeType === '⚡') {
      agentType = 'assist';
      defaultHitl = true;
    } else {
      // 🔄 或其他默认为 auto
      agentType = 'auto';
      defaultHitl = false;
    }

    // ── Step 3: 读 skill_ref + entity_ref ──
    const skillRef = node.skill_ref;
    const entityRef = node.entity_ref;

    // SKILL.md 正文（默认空字符串，降级处理）
    let skillBody = '';
    if (skillRef) {
      const skillPath = join(dataSubDir, skillRef);
      if (existsSync(skillPath)) {
        try {
          const skillContent = readFileSync(skillPath, 'utf-8');
          skillBody = extractSkillBody(skillContent);
        } catch {
          // 读取失败降级为空
        }
      }
    }

    // entity knowledge_domain（默认空 include/exclude）
    let knowledgeDomain: KnowledgeDomain = { include: [], exclude: [] };
    if (entityRef) {
      const entityPath = join(dataSubDir, entityRef);
      knowledgeDomain = extractKnowledgeDomain(entityPath);
    }

    // ── Step 4-5: 已在上一步完成 ──

    // ── Step 6: 组装 EnterpriseAgentConfig ──

    // 降级处理：
    // - 缺 agent → 默认 'enterprise'
    // - 缺 actions → 默认 [read]（resolveTools 内部处理）
    // - 缺 knowledge_domain → 空 include/exclude（已在上面处理）
    // - 缺 hitl → 根据 type 推断（已在上面设置 defaultHitl）

    const displayName = node.name || nodeId;
    const nodeTask = node.task || '';

    // hitl 降级：显式声明优先，否则根据 type 推断
    const hitl = node.hitl !== undefined ? node.hitl : defaultHitl;

    // tools 映射
    const tools = resolveTools(node.actions);

    // systemPrompt 组装
    const systemPrompt = assembleSystemPrompt(
      nodeId,
      displayName,
      nodeTask,
      skillBody,
      knowledgeDomain,
    );

    const config: EnterpriseAgentConfig = {
      name: nodeId,
      displayName,
      type: agentType,
      description: nodeTask || displayName,
      systemPrompt,
      tools,
      modelName: null,
      hitl,
      // v1.2.6: 知识域作为字符串写入 YML（include/exclude 序列化为逗号分隔）
      knowledgeDomain: knowledgeDomain.include.length > 0 || knowledgeDomain.exclude.length > 0
        ? `include: ${knowledgeDomain.include.join(', ')}; exclude: ${knowledgeDomain.exclude.join(', ')}`
        : undefined,
    };

    // v1.2.5 §3.1: 生成 Agent 身份码（确定性 fingerprint）
    const constraints = extractConstraintsFromPrompt(systemPrompt);
    config.identity = generateAgentIdentity(nodeId, {
      systemPrompt,
      tools,
      constraints,
    });

    // hitlConfig（仅 ⚡ 节点或显式声明时）
    if (node.hitl_config) {
      config.hitlConfig = {
        interruptBefore: node.hitl_config.interrupt_before ?? hitl,
        prompt: node.hitl_config.prompt,
      };
    } else if (hitl) {
      // 有 HITL 但没显式配置 → 默认 interruptBefore
      config.hitlConfig = { interruptBefore: true };
    }

    configs.push(config);

    // ── Step 7: 写入 YML（如果 !dryRun）──
    if (!dryRun) {
      const subagentsDir = join(dataDir, 'subagents');
      if (!existsSync(subagentsDir)) {
        mkdirSync(subagentsDir, { recursive: true });
      }

      const ymlPath = join(subagentsDir, `${nodeId}.yml`);
      const ymlContent = serializeToYml(config);
      writeFileSync(ymlPath, ymlContent, 'utf-8');
    }
  }

  // ── Step 8: 生成拓扑描述 ──
  const workflowGraph = generateTopologyDescription(
    workflowName,
    workflowDesc,
    configs,
    skippedNodes,
  );

  // ── Step 9: 返回 ActivateResult ──
  const hitlNodes = configs.filter((c) => c.hitl).map((c) => c.name);

  return {
    registeredAgents: configs.map((c) => c.name),
    workflowGraph,
    skippedNodes,
    hitlNodes,
  };
}

// ============================================================
// 导出辅助函数（供测试和外部调用）
// ============================================================

export { resolveTools, extractSkillBody, extractKnowledgeDomain, assembleSystemPrompt, serializeToYml, generateTopologyDescription };
