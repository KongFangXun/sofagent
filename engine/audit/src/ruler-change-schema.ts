// ============================================================
// ruler-change-schema.ts · v1.7.0 §七 · 尺子变更事件 schema（RulerChangeEvent）
//
// 「人否机器 → 判据修订 → 再训练」飞轮上，判据修订环节此前无任何留痕
// （W2 数据飞轮链路缺口）。本文件把「人为什么改判据」结构化：
//   - 六 aspect（criterion/question/threshold/cost/domain/evidence）——
//     尺子的六个可变更载体穷尽全部可动部件，换尺子 = 对六者之一的变更；
//   - delta（op + before/after 结构化快照）——机器可理解 = 结构化 diff，
//     不需要 NLU；缺 before 或 after 拒载（fail-closed——「有变更但无从
//     比对前后」等于丢失了偏离模式的解释面）；
//   - actor（id + role）——换尺子的主人（品味的主人）；
//   - rationale（trigger 五档 + refs[] 回指 decision-log 条目 + note 自由
//     文本仅供人读不入训练）；trigger=override 时 refs 必填（人否机器的
//     那几条不许缺席——写侧校验不静默放过）；
//   - target.version（from/to 判据版本锚）——判据版本化为后续承接件
//     （承接版本待定），本版 schema 支持可空 + 显式 unversioned 标记：
//     未就位期间只落「有变更 + 六载体 delta」不落「从什么到什么」；
//     version.from/to 的生产写入面不在本版私建（防双 SSOT），版本化就位
//     后回填不视为 schema 破坏；
//   - prevHash/hmacSig/envFingerprint——与 decision-log 同族链纪律
//     （chain-kernel.appendChained 同协议：prevHash 相接 + HMAC 可验）。
//
// zod schema（本包新依赖，与 train/orchestrator 同版本 ^4.6.5）——
// fail-closed：校验失败即拒载（不静默丢弃、不部分写入）。
// ============================================================

import { z } from 'zod';

/** 尺子的六个可变更载体（六载体穷尽全部可动部件） */
export type RulerAspect =
  | 'criterion' // 判据本体（增/改/删/停用）
  | 'question' // 问句集（原语类型/候选集/兜底项）
  | 'threshold' // 档位阈值
  | 'cost' // 代价参数（escalateCost/mistakeCost）
  | 'domain' // 判定域边界
  | 'evidence'; // 证据需求层级（structural/trace/none）

/** 变更操作四态 */
export type RulerDeltaOp = 'add' | 'modify' | 'remove' | 'disable';

/** 变更触发五档（为什么换尺子） */
export type RulerTrigger =
  | 'override' // 人否机器（ HITL/人工裁决推翻判定——refs 必填）
  | 'incident' // 事故驱动
  | 'new-requirement' // 新需求
  | 'calibration-drift' // 校准漂移
  | 'peer-comparison'; // 同行对照

/** 责任人角色三档 */
export type RulerActorRole = 'author' | 'reviewer' | 'operator';

/**
 * 结构化 delta 快照：按 aspect 对应形态的任意 JSON 值。
 * 「机器可理解 = 结构化 diff」——before/after 是快照本体，schema 不
 * 硬编码各 aspect 的内部形态（判据/问句/阈值各有自己的 schema 面，
 * 由消费方按 aspect 二次校验）；本层只锁「两态齐备」这一硬约束。
 */
const SnapshotSchema = z.unknown();

/** 结构化 delta（op + before/after——缺任一即拒载） */
export const RulerDeltaSchema = z
  .object({
    op: z.enum(['add', 'modify', 'remove', 'disable']),
    /** 变更前快照（op=add 时可缺——新增无前态） */
    before: SnapshotSchema.optional(),
    /** 变更后快照（op=remove 时可缺——删除无后态） */
    after: SnapshotSchema.optional(),
  })
  .strict()
  .superRefine((delta, ctx) => {
    // 缺 before/after 拒载：add 允许缺 before、remove 允许缺 after，
    // 其余（modify/disable）两者必齐——「有变更无从比对前后」= 留痕面残缺。
    if (delta.op !== 'add' && delta.before === undefined) {
      ctx.addIssue({ code: 'custom', message: `delta.op=${delta.op} 缺 before（只有 add 可缺前态——变更事件须可比对前后）` });
    }
    if (delta.op !== 'remove' && delta.after === undefined) {
      ctx.addIssue({ code: 'custom', message: `delta.op=${delta.op} 缺 after（只有 remove 可缺后态——变更事件须可比对前后）` });
    }
  });

/** 责任锚点（换尺子的主人） */
export const RulerActorSchema = z
  .object({
    id: z.string().min(1, 'actor.id 必填（责任不可匿名）'),
    role: z.enum(['author', 'reviewer', 'operator']),
  })
  .strict();

/**
 * 版本锚：from/to 判据版本前后。
 * 降级口径（SSOT §七验收第 5 条）：判据版本化承接版本待定——本版
 * 支持可空（undefined）+ 显式 unversioned 标记；两者互斥（同时出现即
 * 口径含混拒载）。
 */
export const RulerTargetVersionSchema = z.union([
  z
    .object({
      unversioned: z.literal(true),
    })
    .strict(),
  z
    .object({
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
    })
    .strict()
    .refine((v) => v.from !== undefined || v.to !== undefined, {
      message: 'target.version 非 unversioned 时 from/to 至少一项非空（全空版本锚 = 变更无从接续）',
    }),
]);

/** 变更依据（trigger 五档 + refs 回指 + note 人读自由文本） */
export const RulerRationaleSchema = z
  .object({
    trigger: z.enum(['override', 'incident', 'new-requirement', 'calibration-drift', 'peer-comparison']),
    /** 回指 decision-log 条目 id（ts）——「人否机器」的那几条 */
    refs: z.array(z.string().min(1)),
    /** 自由文本（仅供人读——不入训练输入，机器消费面不认此字段） */
    note: z.string().optional(),
  })
  .strict()
  .superRefine((rationale, ctx) => {
    // trigger=override 时 refs 必填（写侧校验，不静默放过）——
    // 「人否机器」却指不出是哪几条 = 品味样本的事发情境缺席。
    if (rationale.trigger === 'override' && rationale.refs.length === 0) {
      ctx.addIssue({ code: 'custom', message: "trigger='override' 时 rationale.refs 必填且非空（人否机器的 decision-log 条目不许缺席）" });
    }
  });

/**
 * RulerChangeEvent 完整 schema（业务字段——链字段由 chain-kernel 生成）。
 * 链字段（prevHash/hashVersion/envFingerprint/hmacAlgo/hmacSig）不在
 * 本 schema：写入经 decision-log.appendRulerChange 走 appendChained，
 * 链字段由内核装配（与 DecisionLogEntry 同族纪律）。
 */
export const RulerChangeEventSchema = z
  .object({
    /** ISO 8601 UTC 时间戳 */
    ts: z.string().min(1),
    agentId: z.string().min(1),
    sessionId: z.string().min(1),
    /** 六载体之一（aspect 决定 delta 快照的二次校验面） */
    aspect: z.enum(['criterion', 'question', 'threshold', 'cost', 'domain', 'evidence']),
    /** 变更目标（判据 id / 问句 id / 阈值名——按 aspect 指认） */
    targetId: z.string().min(1, 'targetId 必填（变更须可指认到具体载体）'),
    /** 版本锚（可空 + unversioned 显式标记——降级口径见 schema 注释） */
    version: RulerTargetVersionSchema.optional(),
    /** 结构化 delta（缺 before/after 拒载） */
    delta: RulerDeltaSchema,
    /** 责任锚点 */
    actor: RulerActorSchema,
    /** 变更依据（trigger=override ⇒ refs 必填） */
    rationale: RulerRationaleSchema,
    /** effect 回填（变更生效后窗口对比——由 effect-backfill 写入；构造期可缺） */
    effect: z
      .object({
        windowDays: z.number().int().positive(),
        overrideRateBefore: z.number().min(0),
        overrideRateAfter: z.number().min(0),
        verdict: z.enum(['improved', 'neutral', 'regressed']),
      })
      .strict()
      .optional(),
  })
  .strict();

/** RulerChangeEvent 类型（z.infer——与 schema 单一事实源） */
export type RulerChangeEvent = z.infer<typeof RulerChangeEventSchema>;

/** 校验失败错误（fail-closed 载体——拒载不静默） */
export class RulerChangeSchemaError extends Error {
  /** 缺失/非法字段清单（显式列出——不静默丢弃） */
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(`[ruler-change-schema] ${message}${issues.length > 0 ? `：${issues.join('；')}` : ''}`);
    this.name = 'RulerChangeSchemaError';
    this.issues = issues;
  }
}

/**
 * fail-closed 校验入口：非法即抛 RulerChangeSchemaError（含缺失项清单）。
 * @returns 通过校验的强类型事件（不返回部分写入）
 */
export function validateRulerChange(input: unknown): RulerChangeEvent {
  const parsed = RulerChangeEventSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new RulerChangeSchemaError('尺子变更事件 schema 校验失败（拒载）', issues);
  }
  return parsed.data;
}

/**
 * 判据版本可接续断言（schema 级——SSOT §七验收第 4 条）：
 * 同一 criterionId 的 version.to 能被下一次变更的 version.from 接上。
 * 只做 schema 级验证（fixture 构造两次变更），不要求本版存在生产写入方。
 */
export function assertVersionContinuable(
  prev: Pick<RulerChangeEvent, 'targetId' | 'version'>,
  next: Pick<RulerChangeEvent, 'targetId' | 'version'>,
): void {
  if (prev.targetId !== next.targetId) {
    throw new RulerChangeSchemaError(
      `版本接续断言失败：targetId 不一致（${prev.targetId} ≠ ${next.targetId}——接续只对同一载体成立）`,
    );
  }
  const pv = prev.version;
  const nv = next.version;
  // 降级口径兼容：unversioned/缺席的版本锚无接续义务（只落「有变更」不落「从什么到什么」）
  if (pv === undefined || nv === undefined) return;
  if (typeof pv === 'object' && 'unversioned' in pv) return;
  if (typeof nv === 'object' && 'unversioned' in nv) return;
  const prevTo = pv.to;
  const nextFrom = nv.from;
  if (prevTo === undefined || nextFrom === undefined) return; // 端点缺席 = 未行使接续（不构成断裂）
  if (prevTo !== nextFrom) {
    throw new RulerChangeSchemaError(
      `版本接续断言失败：前次 version.to=${prevTo} ≠ 后次 version.from=${nextFrom}（版本链断裂）`,
    );
  }
}
