// ============================================================
// fde-registry-types.ts · FDE 注册表类型（daemon 侧本地声明 · v1.3.7 交付 5 #4）
// ============================================================
//
// 与 orchestrator/src/fde-registry.ts 的公开类型保持结构一致。
// 独立声明（不静态 import orchestrator 类型）的原因：daemon 的 loader
// 走 require(dist) 动态消费，静态 import 类型会把 orchestrator 拉进
// daemon 编译依赖（与 cron.ts 同范式——动态消费保持构建独立）。
// 结构漂移由 orchestrator 侧的 fde-registry 单测守卫。
// ============================================================

/** 巡检频率（与 daemon inspector-layers 的 LAYER_SCHEDULE 同枚举） */
export type FDECadence = '@daily' | '@weekly' | '@monthly';

/** 风险等级 */
export type FDERisk = 'low' | 'medium' | 'high';

/** 单个 FDE 注册节点 */
export interface FDERegistryNode {
  id: string;
  cadence: FDECadence;
  risk: FDERisk;
  skills: string[];
  humanGates: string[];
  description?: string;
}

/** 注册表校验结果 */
export interface FDERegistryParseResult {
  ok: boolean;
  nodes: FDERegistryNode[];
  errors: string[];
}
