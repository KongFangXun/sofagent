// ============================================================
// inspectors/types.ts · 巡检器共享类型
// v1.2.0 新增
// ============================================================

/** 巡检器配置 */
export interface InspectorConfig {
  enabled: boolean;
  schedule: '@daily' | '@weekly' | '@monthly';
}

/** 巡检结果 */
export interface InspectorResult {
  name: string;
  triggered: boolean;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}
