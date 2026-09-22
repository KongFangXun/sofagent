// ============================================================
// inspector-layers.ts · 分层巡检调度薄层（v1.2.4 · v1.5.1 收敛为派生层）
// ============================================================
// v1.4.9 深模块条目 2：巡检器清单的唯一事实源已收敛至
// ./inspectors/registry.ts（INSPECTORS 单源）。本文件保留分层调度
// 语义与既有导出面（runLayeredInspection / runAllLayers /
// getLayerInspectorNames / LAYER_SCHEDULE / InspectorLayer——cron.ts
// 与测试消费面不变），内部全部从注册表派生。
// ============================================================
import type { InspectorResult } from './inspectors/types';
import {
  runLayer as registryRunLayer,
  runAll as registryRunAll,
  listInspectors,
  type InspectorLayer,
} from './inspectors/registry';

export type { InspectorLayer } from './inspectors/registry';

/** 层级对应的 cron 频率 */
export const LAYER_SCHEDULE: Record<InspectorLayer, '@daily' | '@weekly' | '@monthly'> = {
  L1: '@daily',
  L2: '@weekly',
  L3: '@monthly',
};

/** 分层巡检结果 */
export interface LayeredInspectionResult {
  /** 执行的层级 */
  layer: InspectorLayer;
  /** 该层各 inspector 的结果 */
  results: InspectorResult[];
  /** 执行时间 ISO */
  executedAt: string;
}

/**
 * 按指定层级执行巡检（注册表派生——清单见 ./inspectors/registry.ts）
 */
export function runLayeredInspection(
  projectDir: string,
  layer: InspectorLayer,
  source: 'scheduled' | 'manual' = 'manual',
): LayeredInspectionResult {
  const names = listInspectors(layer).filter((n) => n);
  console.log(
    `[inspector] 层 ${layer} 开始执行（${names.length} 个 inspector · 触发源 ${source}）`,
  );
  return {
    layer,
    results: registryRunLayer(projectDir, layer),
    executedAt: new Date().toISOString(),
  };
}

/**
 * 执行所有层级的巡检（全量执行——兼容旧调用方）
 */
export function runAllLayers(projectDir: string): InspectorResult[] {
  return registryRunAll(projectDir);
}

/**
 * 获取指定层级的 inspector 名称列表（注册表派生）
 */
export function getLayerInspectorNames(layer: InspectorLayer): string[] {
  return listInspectors(layer);
}
