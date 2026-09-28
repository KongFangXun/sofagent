// ============================================================
// compat/plugin-mount-probe.ts · 插件可用性预检（挂载探针·四段两态）
// ============================================================
//
// 目的（任务书原文）：第三方 cordis 插件挂载前跑**四段预检**——
//   ① 声明的事件主干有没有（SEAMS 词汇表对照）
//   ② 调的服务在不在（services 桥命名空间对照）
//   ③ apply 是否成功
//   ④ 探针事件是否触发产出（主干事件走事件桥，桥有读数）
// **四段全过标「可用」，任一不过标「只挂载不生效」并明示缺口**——
// 用户看到的是「这个插件读得出 / 读不出」，不是装完才发现空壳。
//
// 🔴 复检纪律：预检结论**随版本复检**——宿主接口集升级（DSH 发新版）时既有插件
//   预检重跑，上次可用不代表这次可用（接口集漂移靠复检暴露，不等运行时炸）。
//   故结论携带 `checkedAt` + `hostInterface` 快照（对照源当时的样子）——两次
//   预检快照不同 = 接口集漂移，须人工复核插件侧。
//
// 🔴 兼容面向「接口集」不面向「具体插件」（红线 A-2①）：本探针只对照
//   「宿主公开接口集」（事件名集 / 服务命名空间集），**不为任何具体插件写特例**。
//   任何消费该接口集的插件（含未来更大更专业的 RSI 类）都走同一把尺子。
//
// 🔴 降级红线：本文件纯 TS（不 import cordis / 宿主 SDK 类型）——桥面（两个
//   桥实例）与槽位（apply / fireProbe）都是注入的契约，探针只做对照与汇总。
// ============================================================

import type { CordisServiceBridge } from './cordis-service-bridge';
import type { CordisEventBridge } from './cordis-event-bridge';

/**
 * 宿主 **ctx 订阅点**事件名快照（对照源——SEAMS.md §1 词汇表）。
 *
 * ⚠️ 只收「宿主真实派发、`ctx.on` 能收到」的 19 条；SEAMS.md §1 明确标注
 * `@deepseek-ai/dsh-hook-protocol` 的 5 条（`turn/end` / `turn/start` /
 * `session/created` / `hook/invoked` / `hook/result`）是**载荷类型**、
 * 交付对象是仓外 hook 进程、**不是 ctx 订阅点**——把 `turn/end` 当订阅点写
 * 会得到「grep 能过、探针必挂」的假接线，故显式排除。
 *
 * SSOT 仍是 `engine/dsh-plugins/SEAMS.md`（本常量是其 DSH-HOST 块的运行期投影；
 * 词汇表变更时本快照须同批更新——`hostEvents` 亦可由调用方注入覆盖以接真实探测）。
 */
export const DSH_HOST_CTX_EVENTS: readonly string[] = Object.freeze([
  'tools/change',
  'tools/execute',
  'tools/post-execute',
  'tools/pre-execute',
  'tools/ptc-dispatch-log',
  'tools/result',
  'fs/edit-intent',
  'fs/observed',
  'fs/write-intent',
  'agent/pre-step',
  'agent/request',
  'agent/request-error',
  'agent/turn-stopping',
  'agent/error',
  'agent/session-start',
  'agent/created',
  'agent/disposed',
  'agent/status',
  'session/event',
]);

/** 四段预检的稳定标识（顺序即执行序——①→④） */
export const PROBE_SEGMENTS = Object.freeze([
  'events-declared',
  'services-called',
  'apply-succeeds',
  'probe-fires',
] as const);

export type ProbeSegment = (typeof PROBE_SEGMENTS)[number];

/** 段标识 → 人类可读名（结论文案用） */
export const SEGMENT_LABELS: Readonly<Record<ProbeSegment, string>> = Object.freeze({
  'events-declared': '①声明的事件主干有没有',
  'services-called': '②调的服务在不在',
  'apply-succeeds': '③apply 是否成功',
  'probe-fires': '④探针事件是否触发产出',
});

/** 单段预检结果 */
export interface ProbeSegmentResult {
  segment: ProbeSegment;
  label: string;
  ok: boolean;
  /** 人类可读结论（含读数） */
  detail: string;
  /** 缺口明细（ok=false 时非空——「明示缺口」的落点） */
  gaps: string[];
}

/** 插件侧声明（被预检对象——只含接口集消费面，不含插件实现） */
export interface PluginProbeDeclaration {
  /** 插件 id（结论与缺口归属） */
  pluginId: string;
  /** 声明订阅的宿主事件名（SEAMS 词汇表值） */
  declaredEvents: readonly string[];
  /** 声明桥接调用的 @sofagent/* 服务（pkg + api） */
  declaredServices: ReadonlyArray<{ pkg: string; api: string }>;
  /**
   * 段③ apply 执行器（真实调用插件 apply；返回是否成功）。
   * 缺省 = 无 apply 面（段③判缺口——「只挂载不生效」的典型态）。
   */
  apply?: () => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  /**
   * 段④ 探针事件触发器（触发一次主干事件走事件桥；返回是否触发 + 产出数）。
   * 缺省 = 无探针槽（段④判缺口）。
   */
  fireProbe?: () => Promise<{ fired: boolean; produced: number }> | { fired: boolean; produced: number };
}

/** 预检对照面（注入的契约——桥实例 + 宿主事件名集） */
export interface PluginProbeContext {
  /** 宿主 ctx 订阅点事件名集（对照源①；缺省用 DSH_HOST_CTX_EVENTS） */
  hostEvents?: readonly string[];
  /** services 桥（对照源②：namespaces()/get()） */
  serviceBridge: CordisServiceBridge;
  /** 事件桥（对照源④：stats.forwarded 读数——「事件桥有读数」佐证） */
  eventBridge: CordisEventBridge;
}

/** 预检结论（两态 + 缺口明细） */
export interface PluginMountProbeVerdict {
  pluginId: string;
  /** 两态结论：'usable' = 可用（四段全过）；'mounted-inert' = 只挂载不生效（任一不过） */
  verdict: 'usable' | 'mounted-inert';
  /** 人类可读结论文案（用户看到的「读得出 / 读不出」） */
  summary: string;
  /** 四段逐段结果（顺序 = PROBE_SEGMENTS） */
  segments: ProbeSegmentResult[];
  /** 缺口汇总（verdict='mounted-inert' 时非空） */
  gaps: string[];
  /** 预检时刻（ISO 8601——复检对账用） */
  checkedAt: string;
  /** 对照源快照（复检对账：两次快照不同 = 接口集漂移） */
  hostInterface: {
    eventCount: number;
    serviceNamespaces: readonly string[];
    /** 事件桥累计转发读数（段④旁证） */
    bridgeForwarded: number;
  };
}

/** 段①：声明的事件主干有没有（逐事件对照宿主事件名集） */
function probeDeclaredEvents(
  declaredEvents: readonly string[],
  hostEvents: readonly string[],
): ProbeSegmentResult {
  const known = new Set(hostEvents);
  const gaps: string[] = [];
  for (const evt of declaredEvents) {
    if (!known.has(evt)) gaps.push(`宿主未派发事件「${evt}」（不在 SEAMS 词汇表 ctx 订阅点内）`);
  }
  const ok = gaps.length === 0;
  const detail = ok
    ? `声明 ${declaredEvents.length} 个事件全部命中宿主事件名集（对照 ${hostEvents.length} 条）`
    : `声明 ${declaredEvents.length} 个事件中 ${gaps.length} 个宿主未派发——假接线（grep 可过、探针必挂）`;
  return { segment: 'events-declared', label: SEGMENT_LABELS['events-declared'], ok, detail, gaps };
}

/** 段②：调的服务在不在（按 pkg 找命名空间，再核对 api 在声明面内） */
function probeDeclaredServices(
  declared: ReadonlyArray<{ pkg: string; api: string }>,
  bridge: CordisServiceBridge,
): ProbeSegmentResult {
  const namespaces = bridge.namespaces();
  const gaps: string[] = [];
  for (const { pkg, api } of declared) {
    const provider = namespaces
      .map((ns) => bridge.get(ns))
      .find((p) => p !== undefined && p.meta.pkg === pkg);
    if (!provider) {
      gaps.push(`服务包「${pkg}」未注册进 services 桥（插件调用将拿到 undefined）`);
      continue;
    }
    if (!provider.meta.apis.includes(api)) {
      gaps.push(`服务「${pkg}.${api}」不在已注册 API 面内（已注册：${provider.meta.apis.join(', ')}）`);
    }
  }
  const ok = gaps.length === 0;
  const detail = ok
    ? `声明 ${declared.length} 个服务调用全部命中 services 桥已注册面`
    : `声明 ${declared.length} 个服务调用中 ${gaps.length} 个缺口`;
  return { segment: 'services-called', label: SEGMENT_LABELS['services-called'], ok, detail, gaps };
}

/**
 * 四段挂载预检（①→④ 顺序执行；任一不过即判「只挂载不生效」并汇总全部缺口）。
 *
 * 不短路：四段**全部执行**后才下结论——用户一次看到完整缺口清单，
 * 不必「修一个跑一次」（预检是诊断不是门禁）。
 *
 * @param declaration 插件声明（被预检对象）
 * @param ctx 对照面（桥实例 + 宿主事件名集）
 * @returns 两态结论 + 逐段结果 + 缺口明细 + 对照源快照
 */
export async function probePluginMount(
  declaration: PluginProbeDeclaration,
  ctx: PluginProbeContext,
): Promise<PluginMountProbeVerdict> {
  const hostEvents = ctx.hostEvents ?? DSH_HOST_CTX_EVENTS;
  const segments: ProbeSegmentResult[] = [];

  // 段① 声明的事件主干有没有
  segments.push(probeDeclaredEvents(declaration.declaredEvents, hostEvents));

  // 段② 调的服务在不在
  segments.push(probeDeclaredServices(declaration.declaredServices, ctx.serviceBridge));

  // 段③ apply 是否成功
  if (!declaration.apply) {
    segments.push({
      segment: 'apply-succeeds',
      label: SEGMENT_LABELS['apply-succeeds'],
      ok: false,
      detail: '插件未提供 apply 面——无挂载入口（无法判定生效）',
      gaps: ['插件 apply 槽缺失（装配方未提供 apply 执行器）'],
    });
  } else {
    let applyOk = false;
    let applyDetail = '';
    const gaps: string[] = [];
    try {
      const res = await declaration.apply();
      applyOk = res.ok === true;
      applyDetail = applyOk ? 'apply 执行成功（插件已挂载）' : `apply 返回失败：${res.error ?? '未提供原因'}`;
      if (!applyOk) gaps.push(`apply 失败：${res.error ?? '未提供原因'}`);
    } catch (err) {
      applyOk = false;
      applyDetail = `apply 抛错：${err instanceof Error ? err.message : String(err)}`;
      gaps.push(`apply 抛错：${err instanceof Error ? err.message : String(err)}`);
    }
    segments.push({
      segment: 'apply-succeeds',
      label: SEGMENT_LABELS['apply-succeeds'],
      ok: applyOk,
      detail: applyDetail,
      gaps,
    });
  }

  // 段④ 探针事件是否触发产出
  if (!declaration.fireProbe) {
    segments.push({
      segment: 'probe-fires',
      label: SEGMENT_LABELS['probe-fires'],
      ok: false,
      detail: '插件未提供探针事件槽——无法验证「读得出」',
      gaps: ['插件探针事件槽缺失（装配方未提供 fireProbe 触发器）'],
    });
  } else {
    let firesOk = false;
    let firesDetail = '';
    const gaps: string[] = [];
    try {
      const res = await declaration.fireProbe();
      firesOk = res.fired === true && res.produced > 0;
      firesDetail = `探针 fired=${res.fired} · produced=${res.produced}（事件桥累计转发 ${ctx.eventBridge.stats.forwarded}）`;
      if (!firesOk) {
        gaps.push(
          res.fired
            ? `探针事件已触发但零产出（produced=${res.produced}）——插件挂载但读不到主干事件流`
            : '探针事件未触发（插件未订阅主干事件 / 订阅面缺失）',
        );
      }
    } catch (err) {
      firesOk = false;
      firesDetail = `探针触发抛错：${err instanceof Error ? err.message : String(err)}`;
      gaps.push(`探针触发抛错：${err instanceof Error ? err.message : String(err)}`);
    }
    segments.push({
      segment: 'probe-fires',
      label: SEGMENT_LABELS['probe-fires'],
      ok: firesOk,
      detail: firesDetail,
      gaps,
    });
  }

  const gaps = segments.flatMap((s) => s.gaps);
  const usable = segments.every((s) => s.ok);
  const summary = usable
    ? `「${declaration.pluginId}」可用——四段预检全过（事件可读 / 服务可调 / apply 成功 / 探针有产出）`
    : `「${declaration.pluginId}」只挂载不生效——四段中 ${segments.filter((s) => !s.ok).length} 段不过，缺口 ${gaps.length} 项（详见 gaps）`;

  return {
    pluginId: declaration.pluginId,
    verdict: usable ? 'usable' : 'mounted-inert',
    summary,
    segments,
    gaps,
    checkedAt: new Date().toISOString(),
    hostInterface: {
      eventCount: hostEvents.length,
      serviceNamespaces: ctx.serviceBridge.namespaces(),
      bridgeForwarded: ctx.eventBridge.stats.forwarded,
    },
  };
}
