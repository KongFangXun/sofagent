// ============================================================
// workflow-parser.ts · workflow YAML → SubAgent 映射
// v1.3.7 新增
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
import { deriveAgentFromRequirement } from './onboard/agent-creator';
import { getGraphBuilder } from './harness-sdk/builder-registry';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** workflow YAML 中的单个节点 */
export interface WorkflowNode {
  id: string;
  agent: string;
  task: string;
  depends_on: string[];
  /**
   * 节点类型——控制执行引擎选择（v1.3.3 新增）
   * - 'loop'：循环引擎（Onboard/Refine Agent），需迭代收敛
   * - 'auto'：自动执行（默认值），一次性产出
   * - 'manual'：人工节点（HITL 确认）
   *
   * 缺省值 'auto'——向后兼容旧 workflow YAML（无 type 字段时归一化为 auto）。
   */
  type: 'loop' | 'auto' | 'manual';
  /**
   * 是否需要人工确认（HITL）——v1.3.3 新增。
   *
   * type='manual' 时隐含 hitl=true；其余类型可选显式声明 hitl=true 强制卡关。
   * 缺省值 false。
   */
  hitl?: boolean;
}

// ────────────────────────────────────────────────────────────
// 审阅协议字段（v1.3.6 新增 · GitHub 式协作底座）
// ────────────────────────────────────────────────────────────

/**
 * merge_criteria 单条验收条件——机器可判定（复用 ⑨ define_acceptance
 * 的 Benchmark 判定引擎结构）。三类可叠加「组织宪法」：
 *   技术验收：test_pass / build_success / grep_absent / schema_valid
 *   业务审批规则：business_approval（如「财务节点产出必须 CFO 批准」）
 *   数据合规规则：data_compliance（如「涉及用户数据必须 DPO 签字」）
 *
 * 语义来源：workflow 从「步骤列表」升级为「变更提案的审阅协议」——
 * 每个 AI 节点 = 一根待审阅的枝条，审计引擎（git diff 硬证据）
 * 就是 merge_criteria 的执行器，无需新增审计逻辑。
 */
export interface MergeCriterion {
  /** 验收条件类型 */
  kind:
    | 'test_pass'
    | 'build_success'
    | 'grep_absent'
    | 'schema_valid'
    | 'business_approval'
    | 'data_compliance';
  /** 人类可读描述（可选） */
  detail?: string;
  /** test_pass/build_success：执行命令 */
  command?: string;
  /** grep_absent：不得出现的模式 */
  pattern?: string;
  /** schema_valid：校验目标 Schema 引用 */
  schema_ref?: string;
  /** business_approval/data_compliance：必需审批角色（如 CFO / DPO） */
  approver_role?: string;
}

/**
 * approver 审阅批准者（对齐 v1.3.5 promote_ab 强制人审语义）。
 * 缺省视为强制人审——破坏性变更必须人审。
 */
export interface WorkflowApprover {
  /** 审阅批准者标识（agentId / 角色名 / 用户 ID） */
  id: string;
  /** 审阅者类型（缺省 human） */
  kind?: 'human' | 'role' | 'agent';
  /** 是否强制审阅（缺省 true） */
  required?: boolean;
  /** 审阅说明（可选） */
  note?: string;
}

/** 解析后的 workflow（结构化） */
export interface ParsedWorkflow {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  /** 审阅协议：merge_criteria（可组合验收条件，v1.3.6 新增） */
  mergeCriteria?: MergeCriterion[];
  /** 审阅协议：approver（审阅批准者，v1.3.6 新增） */
  approver?: WorkflowApprover;
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
  /**
   * Graph 构建器名（v1.3.6 交付 ③ 托管 SDK registry 集成）。
   * 有值时 dag-runner 经 getGraphBuilder(name).build() 按需实例化执行，
   * 不走内置 createReactAgent 封装——registry 存「怎么构建」，
   * dag-runner 管「什么时候构建」。
   */
  graphBuilderName?: string;
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
 * v1.3.2 交付 5: 解析 agent 类型 → SubAgentDefinition（registry 动态查找 + agent-creation 兜底）
 *
 * 解析链（v1.3.2 升级——移除「未知降级 general-purpose」）：
 *   ① 内置 4 个（developer/qa-engineer/researcher/technical-writer）走 AGENT_MAP
 *   ② registry 动态查找（已注册的 sub-agent 直接复用，不重复生成）
 *   ③ 查不到 → agent-creation 兜底生成（从节点 task 描述推导 Role + 域规则）
 *   ④ 生成后注册进 registry（后续复用）
 *
 * - `enterprise` 类型：调 listAgents(dataDir) 动态查找 YML 中 name 匹配的 Agent
 *   - 找到 → 返回该 Agent 定义
 *   - 未找到 → 抛错提示「enterprise Agent 未注册，请先运行 activate」
 *
 * v1.3.2 变更：未知类型不再降级到 TECHNICAL_WRITER_AGENT——走 agent-creation 推导生成。
 *
 * v1.3.3 变更（T03）：deriveAgentFromRequirement 调用后接入 team-manager 入队 API
 * （协议设计 §6.2 自动入队挂点）。传入 onAgentDerived 回调时，推导生成的 sub-agent
 * 自动入队。回调由调用方注入（team-manager 实例），workflow-parser 不直接依赖 team-manager。
 *
 * @param node workflow 节点
 * @param dataDir .sofagent 数据目录（用于 registry 查找）
 * @param onAgentDerived v1.3.3 新增：agent 推导生成后的入队回调（自动入队挂点）
 * @returns { definition, fallback } —— fallback=true 表示走了 agent-creation 兜底
 * @throws Error 当 enterprise agent 未注册时
 */
export function resolveAgent(
  node: WorkflowNode,
  dataDir?: string,
  onAgentDerived?: (agentId: string) => void,
): { definition: SubAgentDefinition; fallback: boolean } {
  // ① 内置 agent 走 AGENT_MAP
  const hit = AGENT_MAP[node.agent];
  if (hit) return { definition: hit, fallback: false };

  // ①.5 Graph 构建器查找（v1.3.6 交付 ③ 托管 SDK——harness.wrap 产物）
  //     registry 存「怎么构建」，dag-runner 管「什么时候构建」：
  //     命中构建器 → 返回带 graphBuilderName 的代理 definition（按需实例化）
  const builderHit = getGraphBuilder(node.agent) ?? getGraphBuilder(node.id);
  if (builderHit) {
    return {
      definition: {
        name: builderHit.name,
        type: 'harness-wrapped',
        description: `托管 SDK agent（graph 构建器按需实例化）`,
        tools: [],
        systemPrompt: '',
        modelName: null,
        graphBuilderName: builderHit.name,
      },
      fallback: false,
    };
  }

  // ② registry 动态查找（已注册的 sub-agent 直接复用）
  if (dataDir) {
    const agents = listAgents(dataDir);
    const registryHit = agents.find((a) => a.name === node.agent || a.name === node.id);
    if (registryHit) return { definition: registryHit, fallback: false };

    // enterprise agent 专路径
    if (node.agent === 'enterprise') {
      const found = agents.find((a) => a.name === node.id);
      if (!found) {
        throw new Error(
          `enterprise Agent '${node.id}' 未注册，请先运行 activate`,
        );
      }
      return { definition: found, fallback: false };
    }
  }

  // ③ 查不到 → agent-creation 兜底生成（从节点 task 描述推导）
  const creation = deriveAgentFromRequirement(node.task);
  if (creation.status === 'derived' && creation.config) {
    const config = creation.config;
    const generatedDefinition: SubAgentDefinition = {
      name: config.name,
      type: 'enterprise',
      description: config.role,
      tools: ['read', 'write', 'grep', 'glob'],
      systemPrompt: config.thinkMd,
      modelName: null, // 不持久化 provider/model_id（铁律）
      knowledgeDomain: config.domain,
    };

    // v1.3.3 T03：自动入队挂点——推导生成的 sub-agent 自动加入团队（协议设计 §6.2）
    // 回调由调用方注入（team-manager.enqueueSubAgent），workflow-parser 不直接依赖 team-manager
    if (onAgentDerived) {
      try {
        onAgentDerived(config.name);
      } catch (err) {
        // 入队失败不阻断 workflow 解析（best-effort——团队功能是可选增强）
        console.warn(`[workflow-parser] sub-agent 自动入队失败（不阻断）: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { definition: generatedDefinition, fallback: true };
  }

  // agent-creation 也推导不出来（需求太泛）→ 最后降级（向后兼容）
  // 但标注 fallback=true 提示用户补充需求
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

    // ── type / hitl 字段解析（v1.3.3 新增）──
    // type：可选，缺省 'auto'；仅接受 'loop' | 'auto' | 'manual'
    const rawType = n.type;
    let nodeType: 'loop' | 'auto' | 'manual' = 'auto';
    if (rawType !== undefined) {
      if (rawType !== 'loop' && rawType !== 'auto' && rawType !== 'manual') {
        throw new WorkflowParseError(
          `节点 ${n.id} 的 type 非法（${String(rawType)}），必须为 loop|auto|manual`,
        );
      }
      nodeType = rawType;
    }

    // hitl：可选布尔；type='manual' 时隐含 true
    let hitl = false;
    if (typeof n.hitl === 'boolean') {
      hitl = n.hitl;
    }
    if (nodeType === 'manual') {
      hitl = true; // manual 节点强制 HITL
    }

    return {
      id: n.id.trim(),
      agent: n.agent.trim(),
      task: n.task,
      depends_on: (deps as unknown[] | undefined)?.map((d) => String(d)) ?? [],
      type: nodeType,
      hitl,
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

  // ── 审阅协议字段提取（v1.3.6 新增 · GitHub 式协作底座）──
  // merge_criteria / approver 原样透传（schema 结构校验在 container.ts，
  // 语义校验 validateMergeCriteria / validateApprover 同在 container 收口）。
  const mergeCriteria = Array.isArray(wfObj['merge_criteria'])
    ? (wfObj['merge_criteria'] as MergeCriterion[])
    : undefined;
  const approver =
    typeof wfObj['approver'] === 'object' && wfObj['approver'] !== null
      ? (wfObj['approver'] as WorkflowApprover)
      : undefined;

  return {
    name: typeof wfObj.name === 'string' ? wfObj.name : 'unnamed-workflow',
    description: typeof wfObj.description === 'string' ? wfObj.description : '',
    nodes,
    ...(mergeCriteria !== undefined ? { mergeCriteria } : {}),
    ...(approver !== undefined ? { approver } : {}),
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
 * @param onAgentDerived v1.3.3：agent 推导生成后的入队回调（自动入队挂点）
 * @returns SubAgentConfig 数组（每个节点一个 SubAgent）
 */
export function toSubAgentConfigs(
  parsed: ParsedWorkflow,
  dataDir?: string,
  onAgentDerived?: (agentId: string) => void,
): SubAgentConfig[] {
  const seenAgent = new Map<string, number>();
  return parsed.nodes.map((node) => {
    const { definition, fallback } = resolveAgent(node, dataDir, onAgentDerived);
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
      // v1.3.6 交付 ③：托管 SDK graph 构建器透传（dag-runner 按需实例化）
      ...(definition.graphBuilderName ? { graphBuilderName: definition.graphBuilderName } : {}),
    };
  });
}

/**
 * 一站式入口：YAML 文本 → SubAgent 配置数组
 * @param workflowYaml compose 产出的 YAML 文本
 * @param dataDir .sofagent 数据目录（v1.2.6: 用于 resolveAgent 查找 enterprise Agent）
 * @param onAgentDerived v1.3.3：agent 推导生成后的入队回调（自动入队挂点）
 */
export function parseWorkflowToSubAgents(
  workflowYaml: string,
  dataDir?: string,
  onAgentDerived?: (agentId: string) => void,
): SubAgentConfig[] {
  return toSubAgentConfigs(parseWorkflowYaml(workflowYaml), dataDir, onAgentDerived);
}
