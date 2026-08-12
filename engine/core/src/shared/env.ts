// ============================================================
// shared/env.ts · 环境变量统一读取
// v1.3.3 环境变量三套命名（SOFA_* vs SOFAGENT_*、DATA_DIR vs SOFAGENT_DATA、
//   LLM_* vs MODEL_*）统一为 SOFAGENT_* 一套；旧名保留为向后兼容别名。
//   所有读取点都应走本 helper，避免各自 process.env 直读导致前缀漂移。
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
