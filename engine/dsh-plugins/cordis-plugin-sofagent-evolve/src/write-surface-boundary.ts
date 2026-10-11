// ============================================================
// write-surface-boundary.ts · 写面权限窄化（路径级硬边界 · v1.5.9 章七）
// ============================================================
//
// ── 这一件解决什么 —— 把「治理面在可写面之外」从架构原则压成路径级硬边界 ──
// RSI 治理的第一性红线是「治理面不可被被治理者改写」：若执行模型能改判定规则、
// 注入约束、路由表、运行状态或审计历史，那么整套审计与治理就是自证的——被治理者
// 可以重写尺子。此前这条只是**架构原则**（写在文档里、靠人自觉）；本节把它落成
// **可判定的路径级硬边界**：
//
//   模型（被治理的执行模型）**只能写两类产物**——memory / skill；
//   策略 / 注入 / 路由 / 状态 / 审计历史五类**属控制面，模型写入即失败**。
//
// ── 硬边界形态（fail-closed） ──
// classifyWriteTarget() 只认「可写面」；落不进 memory / skill 的路径**一律判控制面
// 拒绝**（含未分类路径——未知即拒绝，不默认放行）。判定只做**路径形态**匹配，不看
// 内容、不联网、不依赖引擎包——它是插件内的**门禁件**，可独立拔插（换掉本插件
// 只是少了这道闸，主干审计与沉淀不受影响）。
//
// ── 与主干审计面同族的边界（对齐 v1.5.9 章一 write-surface-log.ts） ──
// 章一的 prompt / memory 写面**留痕**（看得见写），本节的 memory / skill 写面**窄化**
// （只准写这两类）；两者同属 RSI 写面治理，一个记录「写了什么」，一个限制「能写什么」。
// 控制面（策略/注入/路由/状态/审计历史）的写入即便由人/系统发起，也**不经宿主
// fs/write-intent 事件**（那是执行模型工具层的路径）——故本闸按事件到达即拦。
// ============================================================

/** 模型可写的两类产物面 */
export const MODEL_WRITABLE_SURFACES = ['memory', 'skill'] as const;
export type ModelWritableSurface = (typeof MODEL_WRITABLE_SURFACES)[number];

/** 控制面五类（模型永不可写；sediment/审计留痕另经主干面，不在此） */
export const CONTROL_PLANE_SURFACES = ['policy', 'inject', 'route', 'state', 'audit-history'] as const;
export type ControlPlaneSurface = (typeof CONTROL_PLANE_SURFACES)[number];

/** 写面判定三态：可写面 / 控制面 / 未分类（未分类按 fail-closed 拒绝） */
export type WriteTargetClass =
  | { kind: 'writable'; surface: ModelWritableSurface }
  | { kind: 'control-plane'; surface: ControlPlaneSurface }
  | { kind: 'unknown' };

/** 控制面写入被拒（模型写入即失败——具名异常，含面名与落点） */
export class ControlPlaneWriteError extends Error {
  readonly surface: ControlPlaneSurface | 'unknown';
  readonly target: string;
  readonly actor: string;
  constructor(surface: ControlPlaneSurface | 'unknown', target: string, actor: string, reason: string) {
    super(`[write-surface] 控制面写入被拒（${surface}）：${reason}——落点「${target}」，发起方「${actor}」`);
    this.name = 'ControlPlaneWriteError';
    this.surface = surface;
    this.target = target;
    this.actor = actor;
  }
}

/** 判定结论（guardWriteIntent 的单次裁决） */
export interface WriteIntentVerdict {
  /** allow = 放行；deny = 拒绝（控制面 / 未分类路径） */
  decision: 'allow' | 'deny';
  /** 命中面（可写面名 / 控制面名 / unknown） */
  surface: ModelWritableSurface | ControlPlaneSurface | 'unknown';
  /** 人类可读原因（具名到面与落点——deny 时进宿主拒绝理由） */
  reason: string;
  /** 归一化后的落点（测试与日志用） */
  normalized: string;
}

/**
 * 归一化落点：统一分隔符、去掉首部 `./`、折叠重复斜杠、去掉尾部斜杠。
 * Windows 反斜杠一并归一到 `/`——路径判据只认形态，不认平台。
 */
export function normalizeWriteTarget(target: string): string {
  if (typeof target !== 'string') return '';
  return target
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    .replace(/^\/+/, '');
}

/** 判定用路径规则：`^` 锚定段首、`(^|/)` 允许落在任意层级下 */
const WRITABLE_RULES: Readonly<Record<ModelWritableSurface, readonly string[]>> = Object.freeze({
  memory: [
    '^memory/',
    '(^|/)memory/',
    '(^|/)think\\.md$',
    '^knowledge/',
    '(^|/)knowledge/',
    '^instinct/',
    '(^|/)instinct/',
    '\\.memory\\.md$',
  ],
  skill: ['^skills?/', '(^|/)skills?/', '\\.skill\\.md$'],
});

const CONTROL_RULES: Readonly<Record<ControlPlaneSurface, readonly string[]>> = Object.freeze({
  // 策略面：判定规则 / 策略清单 / 权限与门禁配置
  policy: ['^polic(y|ies)/', '^rules?/', '(^|/)rules?/', '(^|/)polic(y|ies)\\.json$', '(^|/)gate(s)?\\.json$'],
  // 注入面：四层加载链约束文件（大写 SKILL/ 是注入源，与可写的 skills/ 产物区分）
  inject: [
    '^SKILL/',
    '^load-chain/',
    '(^|/)load-chain/',
    '^inject/',
    '(^|/)overrides/',
    '^prompt/',
    '(^|/)prompt/',
    '(^|/)fde\\.md$',
    '(^|/)AGENTS\\.md$',
    '^constraints?/',
  ],
  // 路由面：模型路由表 / 端点配置
  route: ['^router?/', '^route/', '(^|/)model-routes?\\.json$', '(^|/)models?\\.json$', '^slots?\\.json$'],
  // 状态面：运行状态 / 会话状态
  state: ['^state/', '(^|/)state/', '\\.state\\.json$', '(^|/)session-state', '^status\\.json$'],
  // 审计历史面：审计链 / 决策日志 / 写面链 / 意图链 / 快照
  'audit-history': [
    '^audit/',
    '(^|/)audit/',
    '(^|/)decision-log\\.jsonl$',
    '(^|/)history\\.jsonl$',
    '(^|/)write-surface\\.jsonl$',
    '(^|/)intent\\.jsonl$',
    '(^|/)snapshots?/',
    '(^|/)chain\\.jsonl$',
  ],
});

const compile = (rules: readonly string[]): RegExp[] => rules.map((r) => new RegExp(r));

const WRITABLE_MATCHERS: Readonly<Record<ModelWritableSurface, readonly RegExp[]>> = Object.freeze({
  memory: compile(WRITABLE_RULES.memory),
  skill: compile(WRITABLE_RULES.skill),
});

const CONTROL_MATCHERS: ReadonlyArray<{ surface: ControlPlaneSurface; matchers: readonly RegExp[] }> = (
  Object.keys(CONTROL_RULES) as ControlPlaneSurface[]
).map((surface) => ({ surface, matchers: compile(CONTROL_RULES[surface]) }));

/**
 * 判定写面归属（纯函数，无副作用）。
 *
 * 🔴 顺序即安全语义：**先判控制面，再判可写面**——同一个落点两侧都命中时判控制面
 * （保守面：误挡可写面可由人重放，误放控制面不可由用户补救）。两不命中 ⇒ unknown
 * （fail-closed，由调用方按拒绝处理）。
 */
export function classifyWriteTarget(target: string): WriteTargetClass {
  const normalized = normalizeWriteTarget(target);
  if (normalized === '') return { kind: 'unknown' };
  for (const { surface, matchers } of CONTROL_MATCHERS) {
    if (matchers.some((m) => m.test(normalized))) return { kind: 'control-plane', surface };
  }
  for (const surface of MODEL_WRITABLE_SURFACES) {
    if (WRITABLE_MATCHERS[surface].some((m) => m.test(normalized))) return { kind: 'writable', surface };
  }
  return { kind: 'unknown' };
}

/** 落点是否属模型可写面（memory / skill） */
export function isModelWritable(target: string): boolean {
  return classifyWriteTarget(target).kind === 'writable';
}

/**
 * 断言「模型可写」——不可写即抛 {@link ControlPlaneWriteError}（具名面 + 落点 + 发起方）。
 * 这是引擎/插件侧的**强制闸**：任何「模型将写该落点」的路径都应先过此断言。
 */
export function assertModelWritable(target: string, actor = 'unknown-actor'): ModelWritableSurface {
  const cls = classifyWriteTarget(target);
  if (cls.kind === 'writable') return cls.surface;
  const reason =
    cls.kind === 'control-plane'
      ? `控制面「${cls.surface}」在被治理可写面之外（模型只能写 memory / skill）`
      : '落点不在 memory / skill 可写面内（未分类路径按 fail-closed 拒绝）';
  throw new ControlPlaneWriteError(cls.kind === 'control-plane' ? cls.surface : 'unknown', normalizeWriteTarget(target), actor, reason);
}

/**
 * 文件写入意图裁决（供宿主 `fs/write-intent` waterfall 使用）。
 *
 * 返回 allow 时调用方应放行（调 next）；返回 deny 时**不调 next** 并携带具名原因
 * （对齐 audit 插件 `tools/pre-execute` 的 `{ kind: 'deny', reason }` 形态）。
 */
export function guardWriteIntent(target: string, actor = 'unknown-actor'): WriteIntentVerdict {
  const normalized = normalizeWriteTarget(target);
  const cls = classifyWriteTarget(target);
  if (cls.kind === 'writable') {
    return {
      decision: 'allow',
      surface: cls.surface,
      reason: `可写面「${cls.surface}」——放行`,
      normalized,
    };
  }
  const surface: ControlPlaneSurface | 'unknown' = cls.kind === 'control-plane' ? cls.surface : 'unknown';
  const reason =
    cls.kind === 'control-plane'
      ? `写面窄化：控制面「${cls.surface}」模型不可写（只能写 memory / skill）`
      : '写面窄化：落点不在 memory / skill 可写面内（未分类路径 fail-closed）';
  return { decision: 'deny', surface, reason, normalized };
}
