// ============================================================
// domain/runtime.ts · 运行时装配域（介质读源持久化 / 挂-4 影子门 live 装载）——域级 barrel（v1.9.0 S476 补分拣）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/daemon/domain/runtime），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/runtime"。
// 由来：ce6ef1dc8/25d37cdca 新增 media-env 4 + judge-mode 2 导出时只进根 barrel
// 未建域分拣（S476 barrel 等价守卫拦截）——本文件即补分拣。
// ============================================================

// 介质读源持久化读回（F6.7 R8-5 · 内部件，不标 @public）
export { loadMediaEnv, mediaEnvPath, MEDIA_ENV_FILE, MEDIA_ENV_KEYS } from '../media-env';

// 挂-4 影子门 live 装载（F6.5 #5 · 内部件，不标 @public：部署面专用）
export { bootJudgeMode, switchJudgeModeLive } from '../judge-mode-control';
export type { BootResult, SwitchInput, SwitchResult } from '../judge-mode-control';
