// ============================================================
// workflow-parser.ts · workflow YAML → SubAgent 映射
// v1.2.8 新增
// ============================================================
//
// 把 compose 产出的 workflow YAML 解析为 SubAgent 配置：
//   - 节点抽取：js-yaml 解析（orchestrator 既有依赖），非法 YAML 抛 WorkflowParseError
//   - agent 映射表（架构师定稿）：
//       developer        → ENGINEER_AGENT
//       qa-engineer      → REVIEWER_AGENT
//       researcher       → FDE_AGENT（sustain 模式）
//       technical-writer → 内置 general-purpose（minimal prompt，其余类型未知时同路降级）
//   - DAG 校验：depends_on 必须无环、无悬空引用、无自依赖
//   - 每个 SubAgent 的 systemPrompt 由 dag-runner 统一前置
//     buildConstrainedSystemPrompt 四层加载链（本模块只负责映射）

import * as yaml from 'js-yaml';
import {
  ENGINEER_AGENT,
  REVIEWER_AGENT,
  BUILTIN_AGENTS,
} from './builtin-agents';
import type { SubAgentDefinition } from './registry';
import { listAgents } from './registry';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** workflow YAML 中的单个节点 */
export interface WorkflowNode {
  id: string;
  agent: string;
  task: string;
  depends_on: string[];
}

/** 解析后的 workflow（结构化） */
export interface ParsedWorkflow {
  name: string;
  description: string;
  nodes: WorkflowNode[];
}

/** SubAgent 配置（供 dag-runner 封装为 task tool） */
export interface SubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  /**
   * 工具名列表（来自 SubAgentDefinition.tools）。
   * 注意：此字段为语义标签（'read'/'write'/'bash' 等），用于审计日志和
   * SubAgent 行为约束文档。dag-runner 中每个 SubAgent 封装为 task tool，
   * 内部子 Agent 继承 ENGINEER_TOOLS 默认工具集。
   */
  tools: string[];
}

/** workflow 解析错误（带原因，供 CLI 展示） */
export class WorkflowParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowParseError';
  }
}

// ────────────────────────────────────────────────────────────
// agent 映射表（架构师定稿 · T04 映射依据）
// ────────────────────────────────────────────────────────────

/** FDE sustain 模式变体（researcher 映射目标）：复用 FDE systemPrompt，mode=sustain */
const FDE_SUSTAIN_AGENT: SubAgentDefinition = {
  ...(BUILTIN_AGENTS.find((a) => a.name === 'fde') as SubAgentDefinition),
  mode: 'sustain',
};

/** technical-writer 内置定义（通用写作 Agent 的 sofagent 化） */
const TECHNICAL_WRITER_AGENT: SubAgentDefinition = {
  name: 'technical-writer',
  type: 'development',
  description: '技术文档撰写——README / changelog / API 文档 / 用户手册',
  tools: ['read', 'write', 'grep', 'glob'],
  systemPrompt:
    '你是技术文档撰写者。职责：把工程师的实现转译为清晰、准确、可维护的文档。' +
    '原则：文档与代码同源更新；先读者后作者；示例必须可运行。',
  modelName: null,
};

/** YAML agent 值 → SubAgentDefinition 映射表 */
const AGENT_MAP: Record<string, SubAgentDefinition> = {
  developer: ENGINEER_AGENT,
  'qa-engineer': REVIEWER_AGENT,
  researcher: FDE_SUSTAIN_AGENT,
  'technical-writer': TECHNICAL_WRITER_AGENT,
};

/**
 * 查询 agent 映射（未知类型降级为 technical-writer 内置定义，不阻塞执行）
 * @param agentType YAML 节点中的 agent 字段
 * @returns { definition, fallback } —— fallback=true 表示走了降级
 */
export function mapAgentType(agentType: string): { definition: SubAgentDefinition; fallback: boolean } {
  const hit = AGENT_MAP[agentType];
  if (hit) return { definition: hit, fallback: false };
  return { definition: TECHNICAL_WRITER_AGENT, fallback: true };
}

/**
 * v1.2.6: 解析 agent 类型 → SubAgentDefinition（含 enterprise 动态查找）
 *
 * - 内置 4 个（developer/qa-engineer/researcher/technical-writer）走 AGENT_MAP
 * - `enterprise` 类型：调 listAgents(dataDir) 动态查找 YML 中 name 匹配的 Agent
 *   - 找到 → 返回该 Agent 定义
 *   - 未找到 → 抛错提示「enterprise Agent 未注册，请先运行 activate」
 * - 未知类型：仍降级到 TECHNICAL_WRITER_AGENT（现有行为不变）
 *
 * @param node workflow 节点
 * @param dataDir .sofagent 数据目录（用于 listAgents 查找企业 Agent）
 * @returns { definition, fallback }
 * @throws Error 当 enterprise agent 未注册时
 */
export function resolveAgent(
  node: WorkflowNode,
  dataDir?: string,
): { definition: SubAgentDefinition; fallback: boolean } {
  // 内置 agent 走 AGENT_MAP
  const hit = AGENT_MAP[node.agent];
  if (hit) return { definition: hit, fallback: false };

  // enterprise agent 动态查找
  if (node.agent === 'enterprise') {
    if (!dataDir) {
      throw new Error(
        `enterprise Agent 解析需要 dataDir，但未提供。请确保 workflow-parser 收到 dataDir 参数。`,
      );
    }
    // 节点 name 就是 enterprise agent 的注册名（FDE 激活后写入 subagents/*.yml）
    // 在 workflow.yml 中，enterprise 节点的 name 字段映射到节点 id
    const agents = listAgents(dataDir);
    const found = agents.find((a) => a.name === node.id);
    if (!found) {
      throw new Error(
        `enterprise Agent '${node.id}' 未注册，请先运行 activate`,
      );
    }
    return { definition: found, fallback: false };
  }

  // 未知类型降级到 technical-writer
  return { definition: TECHNICAL_WRITER_AGENT, fallback: true };
}

// ────────────────────────────────────────────────────────────
// YAML 解析 + DAG 校验
// ────────────────────────────────────────────────────────────

/**
 * 解析 workflow YAML 文本为结构化 ParsedWorkflow
 * @param workflowYaml compose 产出的 YAML 文本
 * @returns ParsedWorkflow（nodes 已归一化：depends_on 缺省补 []）
 * @throws WorkflowParseError YAML 非法 / 缺 workflow.nodes / 节点字段缺失 /
 *         depends_on 悬空引用 / 自依赖 / 存在环
 */
export function parseWorkflowYaml(workflowYaml: string): ParsedWorkflow {
  let doc: unknown;
  try {
    doc = yaml.load(workflowYaml);
  } catch (e) {
    throw new WorkflowParseError(`YAML 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof doc !== 'object' || doc === null) {
    throw new WorkflowParseError('YAML 顶层不是对象');
  }
  const root = doc as Record<string, unknown>;
  const wf = root['workflow'];
  if (typeof wf !== 'object' || wf === null) {
    throw new WorkflowParseError('缺少 workflow 根节点');
  }
  const wfObj = wf as Record<string, unknown>;
  const rawNodes = wfObj['nodes'];
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    throw new WorkflowParseError('workflow.nodes 缺失或为空数组');
  }

  // 节点归一化 + 字段校验
  const nodes: WorkflowNode[] = rawNodes.map((raw, idx) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new WorkflowParseError(`nodes[${idx}] 不是对象`);
    }
    const n = raw as Record<string, unknown>;
    if (typeof n.id !== 'string' || n.id.trim() === '') {
      throw new WorkflowParseError(`nodes[${idx}] 缺 id`);
    }
    if (typeof n.agent !== 'string' || n.agent.trim() === '') {
      throw new WorkflowParseError(`节点 ${n.id} 缺 agent`);
    }
    if (typeof n.task !== 'string' || n.task.trim() === '') {
      throw new WorkflowParseError(`节点 ${n.id} 缺 task`);
    }
    const deps = n.depends_on;
    if (deps !== undefined && !Array.isArray(deps)) {
      throw new WorkflowParseError(`节点 ${n.id} 的 depends_on 不是数组`);
    }
    return {
      id: n.id.trim(),
      agent: n.agent.trim(),
      task: n.task,
      depends_on: (deps as unknown[] | undefined)?.map((d) => String(d)) ?? [],
    };
  });

  // 节点总数上限（防资源耗尽）
  const MAX_NODES = 20;
  if (nodes.length > MAX_NODES) {
    throw new WorkflowParseError(`节点数 ${nodes.length} 超过上限 ${MAX_NODES}`);
  }

  // task 字段长度上限（防 prompt 注入）
  const MAX_TASK_LENGTH = 2000;
  for (const n of nodes) {
    if (n.task.length > MAX_TASK_LENGTH) {
      console.warn(`⚠️ [workflow-parser] 节点 ${n.id} 的 task 描述超长（${n.task.length} 字符），截断至 ${MAX_TASK_LENGTH}`);
      n.task = n.task.slice(0, MAX_TASK_LENGTH);
    }
  }

  // id 唯一性
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) throw new WorkflowParseError(`节点 id 重复：${n.id}`);
    ids.add(n.id);
  }

  // depends_on 引用校验（悬空 / 自依赖）
  for (const n of nodes) {
    for (const dep of n.depends_on) {
      if (dep === n.id) throw new WorkflowParseError(`节点 ${n.id} 自依赖`);
      if (!ids.has(dep)) throw new WorkflowParseError(`节点 ${n.id} 依赖悬空节点 ${dep}`);
    }
  }

  // 环检测（DFS 三色标记）
  assertAcyclic(nodes);

  return {
    name: typeof wfObj.name === 'string' ? wfObj.name : 'unnamed-workflow',
    description: typeof wfObj.description === 'string' ? wfObj.description : '',
    nodes,
  };
}

/** DFS 三色环检测：白=未访问，灰=在栈上，黑=已完成 */
function assertAcyclic(nodes: WorkflowNode[]): void {
  const color = new Map<string, 'white' | 'gray' | 'black'>(nodes.map((n) => [n.id, 'white']));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  function visit(id: string, stack: string[]): void {
    color.set(id, 'gray');
    for (const dep of byId.get(id)!.depends_on) {
      if (color.get(dep) === 'gray') {
        throw new WorkflowParseError(`depends_on 存在环：${[...stack, id, dep].join(' → ')}`);
      }
      if (color.get(dep) === 'white') visit(dep, [...stack, id]);
    }
    color.set(id, 'black');
  }

  for (const n of nodes) {
    if (color.get(n.id) === 'white') visit(n.id, []);
  }
}

/**
 * workflow YAML → SubAgent 配置数组
 *
 * 同一 agent 类型出现多次时按节点 id 去重命名（<agent>-<nodeId>），
 * 保证 task tool 的名字唯一。
 *
 * @param parsed 已解析的 workflow
 * @param dataDir .sofagent 数据目录（v1.2.6: 用于 resolveAgent 查找 enterprise Agent）
 * @returns SubAgentConfig 数组（每个节点一个 SubAgent）
 */
export function toSubAgentConfigs(parsed: ParsedWorkflow, dataDir?: string): SubAgentConfig[] {
  const seenAgent = new Map<string, number>();
  return parsed.nodes.map((node) => {
    const { definition, fallback } = resolveAgent(node, dataDir);
    const count = (seenAgent.get(node.agent) ?? 0) + 1;
    seenAgent.set(node.agent, count);
    // 同类型第二个起加节点 id 后缀保唯一
    const name = count === 1 ? definition.name : `${definition.name}-${node.id}`;
    const description = fallback
      ? `${definition.description}（未知 agent 类型 ${node.agent} 的降级映射）`
      : definition.description;
    return {
      name,
      description,
      systemPrompt: definition.systemPrompt,
      tools: definition.tools,
    };
  });
}

/**
 * 一站式入口：YAML 文本 → SubAgent 配置数组
 * @param workflowYaml compose 产出的 YAML 文本
 * @param dataDir .sofagent 数据目录（v1.2.6: 用于 resolveAgent 查找 enterprise Agent）
 */
export function parseWorkflowToSubAgents(workflowYaml: string, dataDir?: string): SubAgentConfig[] {
  return toSubAgentConfigs(parseWorkflowYaml(workflowYaml), dataDir);
}
