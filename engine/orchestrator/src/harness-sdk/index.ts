// ============================================================
// harness-sdk/index.ts · SubAgent 托管 SDK 公共门面（v1.3.6 交付 ③）
// ============================================================
//
// 开发者视角的单一入口：
//   import { harness } from '@sofagent/orchestrator';
//   const agent = harness.wrap(myAgent, { approval: 'allow-with-audit', trace: true });
//   const tools = harness.wrapTools(myTools, options);  // 工具层（双形态共享）
// ============================================================

import { wrap, wrapTools } from './wrap';
import {
  registerGraphBuilder,
  getGraphBuilder,
  listGraphBuilders,
  clearGraphBuilders,
} from './builder-registry';

/** SDK 门面对象（开发者一行使用） */
export const harness = {
  /** 托管 agent（agent 层：身份 + registry + trace） */
  wrap,
  /** 包装工具集（工具层：审计 + 审批拦截——双形态共享内核） */
  wrapTools,
  /** 手动注册 graph 构建器（高级用法——wrap 已自动注册） */
  registerGraphBuilder,
  /** 按名查找构建器 */
  getGraphBuilder,
  /** 列出所有构建器 */
  listGraphBuilders,
};

// 具名导出（测试与宿主按需）
export { wrap, wrapTools } from './wrap';
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
} from './types';
