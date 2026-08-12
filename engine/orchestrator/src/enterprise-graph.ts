// ============================================================
// enterprise-graph.ts · 企业编排图构建核心
// v1.3.3 新建 · 功能 ⑥ 激活链 Phase 2 后半
//
// 从 workflow.yml 直接构建 LangGraph StateGraph：
//   1. 读 workflow.yml → parseWorkflowYaml() → ParsedWorkflow
//   2. 每个 enterprise 节点调 resolveAgent() → listAgents() 查找企业 Agent
//   3. 构建 DataFlowMapping（stateFields → Annotation / entityMappings → readEntity/writeEntity）
//   4. 为每个 node 创建 StateGraph 节点
//   5. 按 depends_on 构建 DAG 边
//
// 数据流三层架构：
//   | 数据类型     | 传法                                      |
//   | 实时业务数据 | LangGraph State（内存，Annotation 通道）    |
//   | 知识数据     | ontology entity（磁盘持久化，readEntity/writeEntity）|
//   | 状态标记     | State + entity 双写                        |
//
// v1.2.7 不碰 dag-runner.ts——只构建图配置不执行
// v1.2.7 composeEnterpriseWorkflow 无运行时调用方——验收仅靠单测
// ============================================================

import { readFileSync } from 'fs';
import type {
  ParsedWorkflow,
  SubAgentConfig,
  WorkflowNode,
} from './workflow-parser';
import {
  parseWorkflowYaml,
  resolveAgent,
  toSubAgentConfigs,
} from './workflow-parser';
import { listAgents } from './registry';
import { readEntity, writeEntity, type OntologyEntity } from './entity-store';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 数据流配置 */
export interface DataFlowConfig {
  /** State 通道字段列表 */
  stateFields: string[];
  /** entity 映射：stateField → entityName */
  entityMappings: Record<string, string>;
  /** 是否启用双写（State + entity） */
  dualWrite: boolean;
}

/** 数据流映射结果 */
export interface DataFlowMapping {
  /** state 字段 → entity 名称 */
  stateToEntity: Record<string, string>;
  /** entity 名称 → state 字段（反向映射） */
  entityToState: Record<string, string>;
  /** 需要双写的字段列表 */
  dualWriteFields: string[];
}

/** 企业编排输入 */
export interface EnterpriseComposeInput {
  /** FDE 交付的 workflow.yml 路径 */
  workflowYmlPath: string;
  /** .sofagent 数据目录（用于 listAgents 查找企业 Agent） */
  dataDir: string;
  /** 数据流配置（可选，缺省用默认三层映射） */
  dataFlow?: DataFlowConfig;
}

/** 企业编排结果 */
export interface EnterpriseComposeResult {
  /** 解析后的 workflow */
  workflow: ParsedWorkflow;
  /** SubAgent 配置数组 */
  subagents: SubAgentConfig[];
  /** 数据流映射 */
  dataFlowMapping: DataFlowMapping;
  /** 构建好的 LangGraph StateGraph 配置（序列化） */
  graph: StateGraphConfig;
}

/** 序列化的 StateGraph 配置（不执行，仅描述） */
export interface StateGraphConfig {
  /** 节点列表 */
  nodes: Array<{
    id: string;
    agent: string;
    task: string;
    dependsOn: string[];
    /** 是否需要 HITL */
    interruptBefore: boolean;
    /** 数据流映射（此节点特有） */
    dataFlow?: DataFlowMapping;
  }>;
  /** 边列表 */
  edges: Array<{
    from: string;
    to: string;
    condition?: string;
  }>;
  /** 工作流名称 */
  name: string;
  /** 工作流描述 */
  description: string;
}

// ────────────────────────────────────────────────────────────
// 核心函数
// ────────────────────────────────────────────────────────────

/** 默认数据流配置 */
const DEFAULT_DATA_FLOW: DataFlowConfig = {
  stateFields: ['task', 'result', 'status', 'artifacts'],
  entityMappings: {},
  dualWrite: true,
};

/**
 * 构建数据流映射。
 *
 * @param config 数据流配置
 * @returns DataFlowMapping（双向映射 + 双写字段）
 */
function buildDataFlowMapping(config: DataFlowConfig): DataFlowMapping {
  const stateToEntity: Record<string, string> = {};
  const entityToState: Record<string, string> = {};

  for (const [stateField, entityName] of Object.entries(config.entityMappings)) {
    stateToEntity[stateField] = entityName;
    entityToState[entityName] = stateField;
  }

  const dualWriteFields = config.dualWrite
    ? config.stateFields.filter((f) => f in stateToEntity)
    : [];

  return { stateToEntity, entityToState, dualWriteFields };
}

/**
 * 读取 workflow.yml 文件内容。
 */
function readWorkflowYml(ymlPath: string): string {
  try {
    return readFileSync(ymlPath, 'utf-8');
  } catch (err) {
    throw new Error(`读取 workflow.yml 失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 构建单个 StateGraph 节点配置。
 */
function buildNodeConfig(
  node: WorkflowNode,
  dataFlowMapping: DataFlowMapping,
  dataDir?: string,
): StateGraphConfig['nodes'][0] {
  // v1.2.9 功能④：HITL 标记从 resolveAgent → SubAgentDefinition.hitl 读取
  // （v1.2.7 硬编码 false，TODO v1.2.9 已消除）
  let interruptBefore = false;
  if (dataDir && node.agent === 'enterprise') {
    try {
      const agents = listAgents(dataDir);
      const def = agents.find((a) => a.name === node.id);
      if (def?.hitl) {
        interruptBefore = true;
      }
    } catch {
      // listAgents 失败时不阻塞图构建，默认无 HITL
    }
  }

  return {
    id: node.id,
    agent: node.agent,
    task: node.task,
    dependsOn: node.depends_on,
    interruptBefore,
    dataFlow: dataFlowMapping.dualWriteFields.length > 0 ? dataFlowMapping : undefined,
  };
}

/**
 * 构建 StateGraph 配置（不执行）。
 *
 * @param workflow 解析后的 ParsedWorkflow
 * @param dataDir 数据目录
 * @param dataFlow 数据流配置
 * @returns StateGraphConfig（序列化配置，v1.2.9 dag-runner 接线执行）
 */
export function buildStateGraphConfig(
  workflow: ParsedWorkflow,
  dataDir: string,
  dataFlow: DataFlowConfig = DEFAULT_DATA_FLOW,
): StateGraphConfig {
  const dataFlowMapping = buildDataFlowMapping(dataFlow);

  // 构建节点配置
  const nodes = workflow.nodes.map((node) => buildNodeConfig(node, dataFlowMapping, dataDir));

  // 构建边：depends_on → 直接边
  const edges: StateGraphConfig['edges'] = [];
  for (const node of workflow.nodes) {
    if (node.depends_on.length === 0) {
      // 入口节点：虚拟 START → node
      edges.push({ from: '__START__', to: node.id });
    }
    for (const dep of node.depends_on) {
      edges.push({ from: dep, to: node.id });
    }
  }

  return {
    nodes,
    edges,
    name: workflow.name,
    description: workflow.description,
  };
}

/**
 * 构建企业编排 StateGraph。
 *
 * 完整流程：
 *   1. 读 workflow.yml → parseWorkflowYaml()
 *   2. 每个 enterprise 节点调 resolveAgent() 查找企业 Agent
 *   3. 构建 DataFlowMapping
 *   4. 为每个 node 创建 StateGraph 节点配置
 *   5. 按 depends_on 构建 DAG 边
 *   6. 序列化 graph 配置
 *
 * @param input 企业编排输入
 * @returns EnterpriseComposeResult（含 graph 配置，不执行）
 */
export async function buildEnterpriseStateGraph(
  input: EnterpriseComposeInput,
): Promise<EnterpriseComposeResult> {
  const { workflowYmlPath, dataDir, dataFlow } = input;

  // 1. 读取并解析 workflow.yml
  const ymlContent = readWorkflowYml(workflowYmlPath);
  const workflow = parseWorkflowYaml(ymlContent);

  // 2. 解析 SubAgent 配置（resolveAgent 会查找 enterprise agent）
  const subagents = toSubAgentConfigs(workflow, dataDir);

  // 3. 构建数据流映射
  const effectiveDataFlow = dataFlow ?? DEFAULT_DATA_FLOW;
  const dataFlowMapping = buildDataFlowMapping(effectiveDataFlow);

  // 4. 构建 StateGraph 配置
  const graph = buildStateGraphConfig(workflow, dataDir, effectiveDataFlow);

  return {
    workflow,
    subagents,
    dataFlowMapping,
    graph,
  };
}
