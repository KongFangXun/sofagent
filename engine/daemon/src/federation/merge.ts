// ============================================================
// merge.ts · 联邦结果合并（re-export shim · 下沉到 core）
// v1.3.3 实现已下沉到 @sofagent/core/federation.ts——audit 静态 import core
//   获得类型安全（此前 any + 变量名动态 import）。本文件保留 re-export 兼容
//   daemon 内部及外部消费者（offline-fallback / federation/index / mcp）。
// ============================================================

export { mergeFederationResults, pickWinner } from '@sofagent/core';
export type { MergedKnowledge } from '@sofagent/core';

