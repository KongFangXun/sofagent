// ============================================================
// shared/env.ts · 环境变量统一读取
// v1.4.4 环境变量命名统一为 SOFAGENT_* 一套，旧名保留为向后兼容别名。
//   ⚠️ v1.4.4 G-06 如实描述：当前实际接入本 helper 的只有 SOFA_* 系列别名
//   （resolveEnvVar 的调用面约 6-8 处）；仓内其余环境变量读取仍为
//   process.env 直读（1.4\111处，历史面）——全量迁移属独立 refactor 议题
//   （登记于 ROADMAP），不要误以为本 helper 已覆盖全部读取点。
// ============================================================

/**
 * 读取环境变量：主名优先，别名（旧名）兜底。
 * @param primary 当前命名（如 SOFAGENT_SANITIZE）
 * @param legacy  向后兼容别名（如 SOFA_SANITIZE），无则只读主名
 */
export function resolveEnvVar(primary: string, legacy?: string): string | undefined {
  const v = process.env[primary];
  if (v !== undefined) return v;
  if (legacy) return process.env[legacy];
  return undefined;
}

/** 布尔环境变量：主名优先 + 别名兜底 */
export function resolveEnvBool(primary: string, legacy: string | undefined, defaultValue: boolean): boolean {
  const val = resolveEnvVar(primary, legacy);
  if (val === undefined || val === '') return defaultValue;
  return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes';
}

/** 数字环境变量：主名优先 + 别名兜底 */
export function resolveEnvNumber(primary: string, legacy: string | undefined, defaultValue: number): number {
  const val = resolveEnvVar(primary, legacy);
  if (val === undefined || val === '') return defaultValue;
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultValue : num;
}
