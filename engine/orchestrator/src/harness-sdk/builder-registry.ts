// ============================================================
// harness-sdk/builder-registry.ts · Graph 构建器注册表（v1.3.7 交付 ③）
// ============================================================
//
// registry 执行链衔接方案（changelog 三、registry 执行链补充）：
//   registry 存「怎么构建」（构建器工厂函数），dag-runner 管「什么时候构建」——
//   避免「注册了但跑不起来」（dag-runner 不直接引用 registry，走解析链，
//   链上命中构建器时按需实例化）。
//
// 与 registry.ts（SubAgentDefinition YML 配置注册表）职责区分：
//   - registry.ts：配置描述（YML 静态定义——builtin + subagents/*.yml）
//   - builder-registry.ts：运行时构建器（harness.wrap 产物——内存注册，进程生命周期）
// ============================================================

import type { ApprovalMode } from './types';

/** Graph 构建器——「怎么构建」的工厂函数 */
export interface GraphBuilder {
  /** 构建器名（resolveAgent 查找键） */
  name: string;
  /** 构建器种类（harness-wrapped = 托管 SDK 产物） */
  kind: 'harness-wrapped' | 'custom';
  /** 工厂函数——dag-runner 命中时调用，返回可 invoke 的 agent */
  build: () => { invoke(input: unknown, options?: Record<string, unknown>): Promise<unknown> };
  /** 治理配置快照（审计追溯用——构建时的审批/trace 语义） */
  options?: { approval: ApprovalMode; trace: boolean };
  /** 注册时间戳（ISO 8601） */
  registeredAt?: string;
}

/** 进程级构建器注册表（Map——同名后注册覆盖，对齐「最新生效」语义） */
const builders = new Map<string, GraphBuilder>();

/**
 * 注册 graph 构建器（wrap() 自动调用；宿主也可手动注册自定义构建器）。
 * @returns 注册后的构建器（含时间戳）
 */
export function registerGraphBuilder(builder: GraphBuilder): GraphBuilder {
  const entry: GraphBuilder = { ...builder, registeredAt: new Date().toISOString() };
  builders.set(builder.name, entry);
  return entry;
}

/**
 * 按名查找构建器（resolveAgent 解析链调用——命中则按需实例化）。
 * @returns GraphBuilder 或 undefined（未注册）
 */
export function getGraphBuilder(name: string): GraphBuilder | undefined {
  return builders.get(name);
}

/** 列出所有已注册构建器（listAgents 运行时扩展用） */
export function listGraphBuilders(): GraphBuilder[] {
  return [...builders.values()];
}

/** 清空注册表（测试隔离用——生产路径不调用） */
export function clearGraphBuilders(): void {
  builders.clear();
}
