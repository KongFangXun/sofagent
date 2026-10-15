// ============================================================
// loadchain-write-hook.ts · 写面变更留痕钩子（core 侧唯一入口 · v1.6.0 章一）
// ============================================================
//
// ── 这一件解决什么 ──
// RSI 的四个可写面里，权重面（manifest 验签）与 skill 面（eval-gate）已有覆盖，
// 但 **prompt 面**（加载链配置：SKILL.md / fde.md 的字段变更）与 **memory 面**
// （记忆事实写入 / 失效）此前完全在审计视野外——Agent 改配置、往记忆里写事实，
// 不留任何可举证的变更记录。本节给这两类写面提供**统一的留痕钩子**：
//
//   ① 变更前/后值捕获（before/after）—— 配置面按**字段级**，记忆面按**条目级**
//   ② 发起人（actor）+ 触发来源（origin：自我改进 / 人工 / 系统）+ 时间戳
//   ③ fail-closed：写面变更若**留痕失败** ⇒ 回退 + 告警（拒绝无痕写入）
//
// ── 为什么 tracer 注册表也落在本文件（而非 audit 包）──
// 包依赖是单向的：engine/audit 依赖 @sofagent/core，core **不得**反向依赖 audit
// （会成环）。而写面记录的**落盘实现**（HMAC 挂链 + 两类契约）在
// engine/audit/src/write-surface-log.ts。故 core 侧只提供**注入点 + 守卫 + 捕获**，
// 由外部（audit / 测试 / 未来的 evolve 插件）经 {@link setWriteSurfaceTracer}
// 注入真正的落盘 sink——这是「保护面看得见写面」的接线缝，而非保护面本身。
//
// ── fail-closed 的接线口径（勿误读为「默认拒绝一切写入」）──
// 未注册 tracer 时按**遗留态放行**（写面留痕尚未接线，既有调用方零回归）；
// **一旦注册 tracer**，留痕即为写入的前置条件：
//   · sink 抛错 / 未落盘 ⇒ 调用方提供的 revert() 回退 ⇒ 告警 ⇒ 抛
//     {@link WriteSurfaceUntracedError}（拒绝无痕写入）。
// `requireTrace: true` 可强制「即便未注册 tracer 也要求留痕」（供接线后的强校验态）。
//
// ── 契约权威在 audit 侧 ──
// `WriteSurfaceTrace.diff` 的类型权威（prompt 面「字段级」/ memory 面「条目级」）
// 定义在 engine/audit/src/write-surface-log.ts；core 不依赖 audit，故此处对 diff
// 取不透明结构（{@link WriteSurfaceDiffLike} 只是最小结构镜像），**校验与判定权
// 归 audit 侧**——两侧不各持一份契约判定，避免双事实源。
// ============================================================

import { randomUUID } from 'crypto';
import {
  assertLayerWrite,
  type LoadChainLayer,
} from './loadchain-schema';

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 写面名（与 audit 侧 write-surface-log.ts 的两类契约对齐） */
export type WriteSurfaceName = 'prompt' | 'memory';

/** 触发来源（自我改进 / 人工 / 系统） */
export type WriteSurfaceOrigin = 'self-improvement' | 'human' | 'system';

/**
 * 写面 diff 的最小结构镜像——**结构权威在 audit 侧**
 * （prompt 面 ⇒ `{ mode: 'field-level', ... }`；memory 面 ⇒ `{ mode: 'entry-level', ... }`）。
 * core 不依赖 audit，故此处只声明「有一个 mode 判别字段」；实际字段校验由
 * write-surface-log.ts 的 assertDiffContract 承担。
 */
export interface WriteSurfaceDiffLike {
  mode: string;
  [k: string]: unknown;
}

/**
 * 一条写面变更留痕（core → sink 的载荷）。
 * 记录内容对齐 devlog 章一交付表：变更前后值摘要 + 发起人 + 触发来源 + 时间戳。
 */
export interface WriteSurfaceTrace {
  /** 写面名 */
  surface: WriteSurfaceName;
  /** 变更落点（配置面 = 层名/文件名；记忆面 = 事实 key） */
  target: string;
  /** 发起人（Agent 实例 id / 人） */
  actor: string;
  /** 触发来源 */
  origin: WriteSurfaceOrigin;
  /** 写面 diff（契约权威在 audit 侧；core 侧不透明） */
  diff: WriteSurfaceDiffLike;
  /** ISO 8601 时间戳 */
  ts: string;
  /** 本次变更的追踪 id（与链记录一一对应） */
  traceId: string;
  /**
   * 与改进链绑定：触发本次写面的晋级 / 考核动作记录引用（可举证链）。
   * 对齐 devlog 章一「与改进链绑定」——晋级 / 考核动作自动产生写面记录时带上该引用。
   */
  refTrace?: string;
}

/** 写面留痕落盘 sink（由 audit 侧 write-surface-log.ts 提供实现后注入） */
export type WriteSurfaceTraceSink = (trace: WriteSurfaceTrace) => void;

// ────────────────────────────────────────────────────────────
// tracer 注册表（进程内单例——core 侧唯一注入点）
// ────────────────────────────────────────────────────────────

let activeSink: WriteSurfaceTraceSink | null = null;

/**
 * 注册 / 注销写面留痕 sink。
 * - 传函数：写面留痕接线生效，此后写面变更**必须**落留痕（fail-closed）。
 * - 传 null：注销（回到遗留态放行）。
 *
 * 注入方（audit 侧）用 write-surface-log.ts 的 createWriteSurfaceTracer() 构造 sink。
 */
export function setWriteSurfaceTracer(next: WriteSurfaceTraceSink | null): void {
  activeSink = next;
}

/** 取当前注册的 sink（未接线返回 null）。 */
export function getWriteSurfaceTracer(): WriteSurfaceTraceSink | null {
  return activeSink;
}

// ────────────────────────────────────────────────────────────
// 错误
// ────────────────────────────────────────────────────────────

/** 写面变更无留痕（留痕失败 ⇒ 已回退，拒绝无痕写入） */
export class WriteSurfaceUntracedError extends Error {
  constructor(message: string) {
    super(`[write-surface] ${message}`);
    this.name = 'WriteSurfaceUntracedError';
  }
}

// ────────────────────────────────────────────────────────────
// fail-closed 守卫
// ────────────────────────────────────────────────────────────

/** {@link guardWriteSurface} 选项 */
export interface GuardWriteSurfaceOptions {
  /** 告警出口（缺省 console.error——告警不可静默） */
  alert?: (message: string) => void;
  /**
   * 即便未注册 tracer 也强制要求留痕（缺省 false = 未接线遗留态放行）。
   * 接线完成后可置 true 做「无痕即拒」的强校验态。
   */
  requireTrace?: boolean;
  /** 时间戳注入（测试锚定用；缺省 new Date().toISOString()） */
  now?: () => string;
  /** traceId 注入（测试锚定用；缺省 randomUUID()） */
  makeTraceId?: () => string;
}

/**
 * 写面写入守卫（fail-closed）。
 *
 * 语义：
 *   1. 未注册 tracer 且 `requireTrace !== true` ⇒ **遗留态**：直接 apply()，
 *      不做 fail-closed（写面留痕尚未接线，既有调用方零回归）。
 *   2. 否则：先 apply() 执行真实写入 ⇒ 落留痕；留痕失败 ⇒ revert() 回退 +
 *      告警（走 options.alert，缺省 console.error）⇒ 抛 WriteSurfaceUntracedError。
 *
 * ⚠️ 顺序说明：先 apply 后留痕——因为留痕需要变更后的值（after）。一旦留痕失败，
 * 用调用方提供的 revert() 把已落盘的状态恢复，故**对外净效果 = 无痕写入被拒绝**。
 *
 * @param change 变更描述（ts / traceId 可由 options 或此处注入）
 * @param apply 执行真实写入并返回其结果
 * @param revert 回退回调（把 apply 已落盘的状态恢复到写前）
 * @returns apply() 的返回值
 * @throws WriteSurfaceUntracedError 留痕失败（已回退 + 告警）
 */
export function guardWriteSurface<T>(
  change: Omit<WriteSurfaceTrace, 'ts' | 'traceId'> & { ts?: string; traceId?: string },
  apply: () => T,
  revert: () => void,
  options: GuardWriteSurfaceOptions = {},
): T {
  const sink = activeSink;

  // ── 遗留态：未接线 ⇒ 放行（不新增 fail-closed 面，既有调用方零回归）──
  if (sink === null && options.requireTrace !== true) {
    return apply();
  }

  const result = apply();

  try {
    if (sink === null) {
      throw new Error('写面留痕 sink 未注册（requireTrace=true 的强校验态）');
    }
    sink({
      ...change,
      ts: change.ts ?? (options.now?.() ?? new Date().toISOString()),
      traceId: change.traceId ?? (options.makeTraceId?.() ?? randomUUID()),
    });
  } catch (err) {
    let revertFailure: unknown = null;
    try {
      revert();
    } catch (revertErr) {
      revertFailure = revertErr; // 回退亦失败：不掩盖，随告警一并报告
    }
    const reason = err instanceof Error ? err.message : String(err);
    const revertNote = revertFailure
      ? `；回退亦失败：${revertFailure instanceof Error ? revertFailure.message : String(revertFailure)}`
      : '';
    const alert = options.alert ?? ((message: string) => console.error(message));
    alert(
      `[write-surface] ⚠️ 写面变更无留痕——已回退并告警（fail-closed）：` +
        `surface=${change.surface} target=${change.target} actor=${change.actor} 原因=${reason}${revertNote}`,
    );
    throw new WriteSurfaceUntracedError(
      `写面变更（surface=${change.surface} target=${change.target}）未能落留痕——已回退，拒绝无痕写入。原因：${reason}${revertNote}`,
    );
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// 直接落痕助手（判定即留痕——无独立可回退写目标的动作）
// ────────────────────────────────────────────────────────────

/**
 * 直接落一条写面留痕（无 apply / revert 语义）。
 *
 * 供「判定本身即写面变更」的动作自动留痕——典型：v1.5.8 第二章**晋级动作**与
 * 第四章**考核动作**（晋级判据 / 考核裁决一落定，写面即已改变，无独立可回退的
 * 写入目标）。接线方在这些判定函数的落点处调用本函数即得「不靠调用方自觉」的留痕。
 *
 * - 已注册 sink ⇒ 落留痕并返回 true（sink 抛错则**照实上抛**——由调用方决定是否回退）。
 * - 未接线（sink=null）⇒ 返回 false（遗留态，不抛）。
 *
 * @returns 是否落痕（false = 未接线）
 */
export function emitWriteSurfaceTrace(
  trace: Omit<WriteSurfaceTrace, 'ts' | 'traceId'> & { ts?: string; traceId?: string },
  options: { now?: () => string; makeTraceId?: () => string } = {},
): boolean {
  if (activeSink === null) return false;
  activeSink({
    ...trace,
    ts: trace.ts ?? (options.now?.() ?? new Date().toISOString()),
    traceId: trace.traceId ?? (options.makeTraceId?.() ?? randomUUID()),
  });
  return true;
}

// ────────────────────────────────────────────────────────────
// 配置面（prompt 面）before/after 捕获
// ────────────────────────────────────────────────────────────
/** 配置面单字段变更（字段级 before/after） */
export interface LoadChainFieldChange {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

/** 配置面 diff 契约（字段级）——mode 与 audit 侧契约判别对齐 */
export interface LoadChainFieldDiff extends WriteSurfaceDiffLike {
  mode: 'field-level';
  layer: LoadChainLayer;
  changes: LoadChainFieldChange[];
}

/** 把任意值归一化为可序列化摘要（标量原样；非标量按 JSON 摘要；undefined 视同 null） */
function toScalar(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return value as string | number | boolean;
  }
  return JSON.stringify(value);
}

/**
 * 配置面字段级 diff（before/after 捕获）。
 *
 * - 对 `before` / `after` 的**每个键**做越界检测（复用章三 loadchain-schema 的
 *   assertLayerWrite / resolveOwner）——字段未登记或归他层 ⇒ 抛对应错误并具名，
 *   fail-closed（配置面写入本身即非法，不产生留痕）。
 * - 仅保留**变化字段**（before !== after）。
 *
 * @param layer 写入层（LOAD_CHAIN_LAYERS 之一）
 * @param before 写前该层字段值视图
 * @param after 写后该层字段值视图
 */
export function diffLoadChainFields(
  layer: LoadChainLayer,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): LoadChainFieldDiff {
  // 越界 / 未登记检测（③：配置值只能写本层字段）——两边都查，防止「借用他层键」
  for (const key of Object.keys(before)) assertLayerWrite(layer, key);
  for (const key of Object.keys(after)) assertLayerWrite(layer, key);

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: LoadChainFieldChange[] = [];
  for (const key of keys) {
    const b = toScalar(before[key]);
    const a = toScalar(after[key]);
    if (b !== a) changes.push({ field: key, before: b, after: a });
  }
  return { mode: 'field-level', layer, changes };
}

/** 配置面写入捕获入参 */
export interface CaptureLoadChainWriteInput {
  layer: LoadChainLayer;
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  /** 发起人（Agent 实例 id / 人） */
  actor: string;
  /** 触发来源 */
  origin: WriteSurfaceOrigin;
  /** 变更落点（缺省 = layer 名） */
  target?: string;
  /** 触发本次配置变更的晋级 / 考核记录引用（与改进链绑定） */
  refTrace?: string;
  ts?: string;
  traceId?: string;
}

/**
 * 捕获一次加载链配置写入（before/after）为可留痕的 trace 载荷。
 * 返回 `{ trace, diff }`——`trace` 可直接交给 guardWriteSurface / sink，`diff` 供审计面消费。
 */
export function captureLoadChainWrite(input: CaptureLoadChainWriteInput): {
  trace: WriteSurfaceTrace;
  diff: LoadChainFieldDiff;
} {
  const diff = diffLoadChainFields(input.layer, input.before, input.after);
  const trace: WriteSurfaceTrace = {
    surface: 'prompt',
    target: input.target ?? input.layer,
    actor: input.actor,
    origin: input.origin,
    diff,
    ts: input.ts ?? new Date().toISOString(),
    traceId: input.traceId ?? randomUUID(),
    ...(input.refTrace ? { refTrace: input.refTrace } : {}),
  };
  return { trace, diff };
}
