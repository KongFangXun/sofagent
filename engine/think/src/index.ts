// ── API 分级契约（v1.4.0 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/think
 *
 * 思考链分析 — 推理路径追踪 / 决策可视化 / 思维审计
 */

/* @public */ export { generateThinkEntry, generateThinkFromEval, generateDataThink } from './think-generator';
/* @public */ export type { ThinkEntryOptions } from './think-generator';
