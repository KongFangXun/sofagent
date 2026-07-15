// ============================================================
// doctor-checker.ts · Doctor 健康检查代理
// v1.1.1 新增
// ============================================================

import type { InspectorResult } from './types';

/**
 * Doctor 健康检查（轻量代理）
 *
 * 完整实现委托给 @sofagent/core 的 doctor CLI。
 * 此处仅提供 daemon 侧调度入口，避免循环依赖。
 */
export function checkDoctorHealth(_projectDir: string): InspectorResult {
  return {
    name: 'doctor-health',
    triggered: false,
    message: 'Doctor health check delegated to sofagent-core doctor CLI',
    severity: 'info',
  };
}
