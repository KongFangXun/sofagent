// ============================================================
// inspectors/types.ts · 巡检器共享类型（re-export shim · ）
// v1.3.9 InspectorResult/InspectorConfig 下沉到 @sofagent/core/federation.ts，
//   本文件 re-export 保持 daemon 全部 inspector 的既有 import 兼容。
// ============================================================

export { InspectorConfig, InspectorResult } from '@sofagent/core';
export type { InspectorResult as InspectorResultType } from '@sofagent/core';

