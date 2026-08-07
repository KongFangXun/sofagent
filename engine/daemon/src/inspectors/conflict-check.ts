// ============================================================
// conflict-check.ts · knowledge 矛盾/孤儿/死链巡检（re-export shim · ）
// v1.2.5 实现已下沉到 @sofagent/core/federation.ts（checkConflict），
//   audit 静态 import core 获得类型安全。本文件 re-export 兼容 daemon
//   inspector-layers / 测试的既有 import。
// ============================================================

export { checkConflict } from '@sofagent/core';
