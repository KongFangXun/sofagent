// ============================================================
// harness-sdk/index.ts · SubAgent 托管 SDK 公共门面（v1.3.7 交付 ③ · v1.3.8 交付⑥ 沙箱）
// ============================================================
//
// 开发者视角的单一入口：
//   import { harness } from '@sofagent/orchestrator';
//   const agent = harness.wrap(myAgent, { approval: 'allow-with-audit', sandbox: true, trace: true });
//   const tools = harness.wrapTools(myTools, options);  // 工具层（双形态共享）
// ============================================================
import { wrap, wrapTools, createSandboxHandle } from './wrap';
import {
  registerGraphBuilder,
  getGraphBuilder,
  listGraphBuilders,
  clearGraphBuilders,
} from './builder-registry';

/** SDK 门面对象（开发者一行使用） */
export const harness = {
  /** 托管 agent（agent 层：身份 + registry + trace + 沙箱） */
  wrap,
  /** 包装工具集（工具层：审计 + 审批拦截 + 沙箱三层——双形态共享内核） */
  wrapTools,
  /** 创建沙箱会话句柄（v1.3.8 交付⑥——外部签发场景；sandbox:true 时 wrap 自动创建） */
  createSandboxHandle,
  /** 手动注册 graph 构建器（高级用法——wrap 已自动注册） */
  registerGraphBuilder,
  /** 按名查找构建器 */
  getGraphBuilder,
  /** 列出所有构建器 */
  listGraphBuilders,
};

// 具名导出（测试与宿主按需）
export { wrap, wrapTools, createSandboxHandle } from './wrap';
export {
  registerGraphBuilder,
  getGraphBuilder,
  listGraphBuilders,
  clearGraphBuilders,
} from './builder-registry';
export type { GraphBuilder } from './builder-registry';
export {
  isSideEffectTool,
  SIDE_EFFECT_TOOL_PATTERNS,
} from './types';
export type {
  ApprovalMode,
  HarnessWrapOptions,
  HarnessToolCallEvent,
  HarnessApprovalEvent,
  WrappableAgent,
  WrappedAgent,
  SandboxHandle,
} from './types';
