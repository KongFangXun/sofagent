// confidence-semantics.ts · F6.2「假概率正名」的语义标记载体
// ============================================================
// 为什么需要这个模块：引擎内散布的「置信度」数值有三种完全不同的性质——
//   ① 概率（probability）：由概率模型算出（sigmoid / softmax），**可** 谈校准；
//   ② 启发式权重（heuristic-weight）：人手写死的经验值（0.7 / 0.6 / 0.3…），
//      没有校准依据，**不得**用于「按错误率设门槛」；
//   ③ 序数等级（ordinal-level）：由枚举映射出的数（confirmed→1.0 / suggested→0.5、
//      high / med / low），只保证**顺序**，不保证间距，也不是概率。
// 把三者混为一谈的后果不是「数字难看」，而是**门槛含义失真**：拿权重当概率设 0.7 门槛，
// 等于声称「错误率 30%」，而该数字从未被任何校准集测过（v1.9.0 §二）。
//
// 设计取舍：**类型层标记 + 运行时恒等**
//   `hw(0.7) === 0.7`——标记只存在于类型系统，编译后消失，因此
//   · 不改变任何既有行为（验收条「正名不改变既有判定行为」由构造保证）；
//   · 不新增运行时字段（不会撞上 `.strict()` 校验或快照）；
//   · 但 `number` 与 `HeuristicWeight` 在类型层不可互赋，**新代码想混用必须显式转换**。
// 运行时可辨识性由 `semanticsOf()` 提供（显式登记表，见 SEMANTICS_REGISTRY 注释）。
// ============================================================

/** 语义三类（v1.9.0 §二 的三类；无第四类——「无信息哨兵 0」不进标记，见普查表处置） */
export type ConfidenceSemantics = 'probability' | 'heuristic-weight' | 'ordinal-level';

/** 带语义标记的数（标记在类型层，运行时就是 number） */
export type TaggedNumber<S extends ConfidenceSemantics> = number & {
  readonly __confidenceSemantics?: S;
};

/** 启发式权重：手写经验值，无校准依据 */
export type HeuristicWeight = TaggedNumber<'heuristic-weight'>;
/** 序数等级：枚举映射出的数，只有顺序没有间距 */
export type OrdinalLevel = TaggedNumber<'ordinal-level'>;
/** 概率：由概率模型算出（未校准仍是概率，「未校准」由 calibration-registry 另行声明） */
export type Probability = TaggedNumber<'probability'>;

/** 标记一个启发式权重（运行时恒等） */
export const hw = (v: number): HeuristicWeight => v as HeuristicWeight;
/** 标记一个序数等级（运行时恒等） */
export const ol = (v: number): OrdinalLevel => v as OrdinalLevel;
/** 标记一个概率（运行时恒等） */
export const prob = (v: number): Probability => v as Probability;

/**
 * 语义的**唯一登记表**（按消费文件，不按行号——行号会随 import 增删漂移，登记表必须稳定）。
 *
 * 运行期可辨识性由这里提供：类型标记编译后消失，审计/回执无法从数值本身判断性质。
 * 注意 `decision-schema.ts` 的 `'high'|'med'|'low'` **不入表**：它是类型层的序数等级
 * （`ConfidenceTier`），没有数值字面量可标记——由该类型的文档注释与
 * `registerLegacyConfidenceClaims` 的 `audit-decision-schema/confidence-tier` 登记承载。
 *
 * 双向核对（`tools/audit/fake-probability-census.mjs`）：
 *   · 表里有而代码里没有对应标记 = 陈旧登记；
 *   · 代码里有标记而表里没登记文件 = 漏登记。
 * 普查器**不从本表取数**（避免自证）：它按代码里是否出现 hw()/ol()/prob() 包装判定，
 * 本表只用于「该文件是否应被普查覆盖」的闭合校验。
 */
export const SEMANTICS_REGISTRY: ReadonlyArray<{
  /** 消费文件（相对仓根） */
  readonly file: string;
  readonly semantics: ConfidenceSemantics;
  /** 一句话说明该数值从哪来 */
  readonly origin: string;
}> = [
  { file: 'engine/audit/src/audit-root-cause.ts', semantics: 'heuristic-weight', origin: '根因分类经验权重（0.7/0.6/0.3）' },
  { file: 'engine/daemon/src/dream-cycle/extract-facts.ts', semantics: 'heuristic-weight', origin: '事实抽取经验权重（0.8/0.9）' },
  { file: 'engine/orchestrator/src/loop-agent/error-localizer.ts', semantics: 'heuristic-weight', origin: '错误定位模式匹配权重（0.6/0.55/0.5/0.4）' },
  { file: 'engine/orchestrator/src/loop-agent/output-extractor.ts', semantics: 'heuristic-weight', origin: '输出抽取方法权重（1.0/0.9/0.3/0.7）' },
  { file: 'engine/orchestrator/src/router/judge-heads/index.ts', semantics: 'probability', origin: 'sigmoid(logit) —— 真概率，未校准' },
  { file: 'engine/audit/src/pr-store.ts', semantics: 'ordinal-level', origin: 'confirmed→1.0 / suggested→0.5 两态映射' },
  { file: 'engine/orchestrator/src/router/intent-triage.ts', semantics: 'ordinal-level', origin: 'L0 声明式映射命中 ⇒ 确定性路由（1，非概率）' },
  { file: 'engine/train/src/rlcd/calibration.ts', semantics: 'probability', origin: '温度校准后 sigmoid(logit/T) —— 真概率' },
] as const;
