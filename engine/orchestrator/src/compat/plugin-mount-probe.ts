// ============================================================
// compat/plugin-mount-probe.ts · 插件可用性预检（挂载探针·四段两态 + 第五段安全段） · v1.5.9
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
// 🆕 第五段 **安全段**（v1.5.9 章六）：在四段可用性预检之上补一段
//   **敌手面预检**——跑「hub 时代恶意插件」四个最小用例（越权调 services /
//   事件投毒 / instinct 池毒数据 / apply 供应链注入），结论给出**三态安全评级**
//   （pass 通过 / restricted 受限通过〔某能力降级挂载〕/ reject 拒载）。
//   恶意插件在**预检段暴露而非运行时**（四段只看「能不能用」，不看「用起来干不干净」）。
//
// 🔴 复检纪律：预检结论**随版本复检**——宿主接口集升级（DSH 发新版）时既有插件
//   预检重跑，上次可用不代表这次可用（接口集漂移靠复检暴露，不等运行时炸）。
//   故结论携带 `checkedAt` + `hostInterface` 快照（对照源当时的样子）——两次
//   预检快照不同 = 接口集漂移，须人工复核插件侧。
//
// 🔴 兼容面向「接口集」不面向「具体插件」（红线 A-2①）：本探针只对照
//   「宿主公开接口集」（事件名集 / 服务命名空间集 / 事件 kind 契约集），**不为任何
//   具体插件写特例**。任何消费该接口集的插件（含未来更大更专业的 RSI 类）都走同一把尺子。
//
// 🔴 降级红线：本文件纯 TS（不 import cordis / 宿主 SDK 类型）——桥面（两个
//   桥实例）、槽位（apply / fireProbe）与安全声明（security）都是注入的契约，
//   探针只做对照与汇总。
// ============================================================

import type { CordisServiceBridge } from './cordis-service-bridge';
import type { CordisEventBridge } from './cordis-event-bridge';
import { REGISTERED_EVENT_TYPES } from '../events/types';
import { exportInstinctRecords } from '../instinct/exporter';

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

/** 五段预检的稳定标识（顺序即执行序——①→④ 可用性 + ⑤ 安全段） */
export const PROBE_SEGMENTS = Object.freeze([
  'events-declared',
  'services-called',
  'apply-succeeds',
  'probe-fires',
  'security-scan',
] as const);

export type ProbeSegment = (typeof PROBE_SEGMENTS)[number];

/** 段标识 → 人类可读名（结论文案用） */
export const SEGMENT_LABELS: Readonly<Record<ProbeSegment, string>> = Object.freeze({
  'events-declared': '①声明的事件主干有没有',
  'services-called': '②调的服务在不在',
  'apply-succeeds': '③apply 是否成功',
  'probe-fires': '④探针事件是否触发产出',
  'security-scan': '⑤安全段（恶意插件四个最小用例 + 三态安全评级）',
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
  /**
   * 段⑤ 安全面声明（可选——缺省按「最小面挂载」评估：无越权 / 无投毒 /
   * 无池写 / 无挂载外写声明 ⇒ 安全评级 pass）。恶意插件在此暴露其攻击意图。
   */
  security?: PluginSecurityDeclaration;
}

/**
 * 恶意插件四项最小用例的**声明面**（v1.5.9 章六·第五段安全段）。
 *
 * 每项对应用户端可见的一个攻击意图——探针在挂载前对照宿主契约判定：
 *   ① 越权 services：`attemptedServices` 超出插件自身声明面 / 宿主公开面
 *   ② 事件投毒：`eventInjections` 投递未登记事件 kind 或携带判定覆盖字段
 *   ③ instinct 池毒数据：`instinctWrites` 的自证「假经验」能否过入池审核三道门
 *   ④ apply 供应链注入：`mountSideEffects` 的挂载外写动作（挂载即写文件/改配置）
 */
export interface PluginSecurityDeclaration {
  /** ①越权面：插件**实际尝试**调用的服务（超出自身声明面 / 宿主公开面 = 越权） */
  attemptedServices?: ReadonlyArray<{ pkg: string; api: string }>;
  /** ②事件投毒样本：插件向该事件位投递该载荷 */
  eventInjections?: ReadonlyArray<{ event: string; payload?: Readonly<Record<string, unknown>> }>;
  /** ③instinct 池毒数据样本：假经验候选（经入池审核链真实性/考核/置信三道门判定） */
  instinctWrites?: ReadonlyArray<InstinctPoisonSample>;
  /** ④apply 阶段挂载外写动作（挂载即写文件 / 改配置） */
  mountSideEffects?: ReadonlyArray<{ kind: string; target: string }>;
}

/** instinct 池毒数据样本（自证「假经验」候选） */
export interface InstinctPoisonSample {
  id: string;
  pattern: string;
  /** 出现次数（缺省 3 = 覆盖度饱和，模型「充分复现」的假经验） */
  occurrences?: number;
  /** 关联 PASS 次数（缺省 3） */
  passCount?: number;
  /** 关联 FAIL 次数（缺省 0） */
  failCount?: number;
  /** 来源类型（缺省 'think'） */
  source?: 'think' | 'decision' | 'audit';
  /** 最近出现时间（缺省当前时间） */
  lastSeen?: string;
  /** 自证考核态（恶意插件常自封 'verified'） */
  verified?: string;
  /** 伪造来源轨迹（插件的自证来源，未与审计链核对） */
  sourceTrace?: string;
  enterpriseId?: string;
}

/** 三态安全评级 */
export type SecurityRating = 'pass' | 'restricted' | 'reject';

/** 单项安全发现（case = 四个最小用例之一） */
export interface SecurityFinding {
  case: 'unauthorized-service' | 'event-poisoning' | 'instinct-poisoning' | 'mount-side-effect';
  /** 单项严重度：restricted = 能力被现有机制中和（降级挂载）；reject = 可穿透/越红线（拒载） */
  severity: 'restricted' | 'reject';
  detail: string;
}

/** 安全段评估结论 */
export interface SecurityScanResult {
  rating: SecurityRating;
  findings: SecurityFinding[];
  /** 人类可读结论文案（含三态评级） */
  detail: string;
}

/** 预检对照面（注入的契约——桥实例 + 宿主事件名集） */
export interface PluginProbeContext {
  /** 宿主 ctx 订阅点事件名集（对照源①；缺省用 DSH_HOST_CTX_EVENTS） */
  hostEvents?: readonly string[];
  /** 宿主事件 **kind 契约集**（段⑤事件投毒对照源；缺省用 REGISTERED_EVENT_TYPES） */
  hostEventKinds?: readonly string[];
  /** services 桥（对照源②：namespaces()/get()；段⑤越权面亦对照其公开面） */
  serviceBridge: CordisServiceBridge;
  /** 事件桥（对照源④：stats.forwarded 读数——「事件桥有读数」佐证） */
  eventBridge: CordisEventBridge;
}

/** 预检结论（两态 + 缺口明细 + 三态安全评级） */
export interface PluginMountProbeVerdict {
  pluginId: string;
  /** 两态结论：'usable' = 可用（四段全过且安全评级非拒载）；'mounted-inert' = 只挂载不生效（任一不过 / 安全拒载） */
  verdict: 'usable' | 'mounted-inert';
  /** 人类可读结论文案（用户看到的「读得出 / 读不出」） */
  summary: string;
  /** 五段逐段结果（顺序 = PROBE_SEGMENTS） */
  segments: ProbeSegmentResult[];
  /** 缺口汇总（verdict='mounted-inert' 时非空） */
  gaps: string[];
  /** 🆕 三态安全评级（段⑤结论——通过 / 受限通过〔某能力降级挂载〕/ 拒载） */
  securityRating: SecurityRating;
  /** 🆕 安全段发现明细（四个最小用例的命中项） */
  securityFindings: SecurityFinding[];
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
 * 事件载荷中「判定覆盖字段」——插件若向主干事件投递这些字段，等于尝试用事件流
 * 冒充判定输出（诱导下游判据）。段⑤事件投毒用例对照集。
 */
const DECISION_OVERRIDE_FIELDS: readonly string[] = Object.freeze([
  'verdict',
  'allow',
  'decision',
  'approved',
  'score',
  'safe',
]);

/**
 * 段⑤：安全段（恶意插件四个最小用例 + 三态安全评级）。
 *
 * 四个用例（对齐 v1.5.9 章六第四类攻击面）：
 *   ① 越权 services —— attemptedServices 超出插件自身声明面（宿主运行时不强制
 *      声明面 ⇒ 可穿透 ⇒ reject）；超出宿主公开面（调用 fail-loud ⇒ 被中和 ⇒ restricted）。
 *   ② 事件投毒 —— 投递未登记 kind（publish 契约层拒落盘 ⇒ restricted）；投递已登记
 *      kind 且携带判定覆盖字段（无字段级中和 ⇒ reject）。
 *   ③ instinct 池毒数据 —— 自证「假经验」过入池审核三道门（sourceTrace 仅查存在性、
 *      未与审计链核对 ⇒ 该写入能力降级 ⇒ restricted）。
 *   ④ apply 供应链注入 —— 挂载外写动作（挂载即写文件/改配置 ⇒ reject）。
 *
 * 评级：任一 reject ⇒ 拒载；否则任一 restricted ⇒ 受限通过；否则通过。
 * 安全声明缺省 ⇒ 按最小面挂载（无攻击意图声明）⇒ 通过。
 */
function probeSecurityScan(
  decl: PluginProbeDeclaration,
  ctx: PluginProbeContext,
): SecurityScanResult {
  const sec = decl.security;
  const findings: SecurityFinding[] = [];

  // ① 越权 services
  const attempted = sec?.attemptedServices ?? [];
  if (attempted.length > 0) {
    const declaredSurface = new Set(decl.declaredServices.map((s) => `${s.pkg}.${s.api}`));
    const hostSurface = new Set<string>();
    for (const ns of ctx.serviceBridge.namespaces()) {
      const provider = ctx.serviceBridge.get(ns);
      if (provider) for (const api of provider.meta.apis) hostSurface.add(`${provider.meta.pkg}.${api}`);
    }
    for (const a of attempted) {
      const key = `${a.pkg}.${a.api}`;
      if (!hostSurface.has(key)) {
        findings.push({
          case: 'unauthorized-service',
          severity: 'restricted',
          detail: `越权调用「${key}」不在宿主公开服务面内——services 桥 fail-loud 拒绝（该能力不可用）`,
        });
      } else if (!declaredSurface.has(key)) {
        findings.push({
          case: 'unauthorized-service',
          severity: 'reject',
          detail: `越权调用「${key}」超出插件自身声明面（declaredServices）——services 桥运行时不强制声明面，可穿透`,
        });
      }
    }
  }

  // ② 事件投毒
  const injections = sec?.eventInjections ?? [];
  if (injections.length > 0) {
    const contractKinds = new Set(ctx.hostEventKinds ?? REGISTERED_EVENT_TYPES);
    for (const inj of injections) {
      if (!contractKinds.has(inj.event)) {
        findings.push({
          case: 'event-poisoning',
          severity: 'restricted',
          detail: `投毒事件 kind「${inj.event}」不在宿主登记契约内——publish 契约层拒绝落盘（投递被中和）`,
        });
        continue;
      }
      const overrideFields = Object.keys(inj.payload ?? {}).filter((k) => DECISION_OVERRIDE_FIELDS.includes(k));
      if (overrideFields.length > 0) {
        findings.push({
          case: 'event-poisoning',
          severity: 'reject',
          detail: `已登记 kind「${inj.event}」携带判定覆盖字段（${overrideFields.join(', ')}）——事件流无字段级中和，可诱导下游判据`,
        });
      } else {
        findings.push({
          case: 'event-poisoning',
          severity: 'restricted',
          detail: `向已登记 kind「${inj.event}」投递诱导载荷——投递能力降级（仅允许只读订阅）`,
        });
      }
    }
  }

  // ③ instinct 池毒数据（复用入池审核链真机制——三道门判定）
  const writes = sec?.instinctWrites ?? [];
  if (writes.length > 0) {
    const samples = writes.map((w) => ({
      id: w.id,
      pattern: w.pattern,
      source: w.source ?? 'think',
      occurrences: w.occurrences ?? 3,
      passCount: w.passCount ?? 3,
      failCount: w.failCount ?? 0,
      lastSeen: w.lastSeen ?? new Date().toISOString(),
      verified: (w.verified ?? 'unexamined') as 'unexamined' | 'verified' | 'failed',
      sourceTrace: w.sourceTrace,
      enterpriseId: w.enterpriseId ?? 'default',
    }));
    const res = exportInstinctRecords(samples, { enterpriseId: 'default' });
    for (const rec of res.records) {
      findings.push({
        case: 'instinct-poisoning',
        severity: 'restricted',
        detail: `自证「假经验」${rec.instinctId} 通过入池审核三道门（真实/考核/置信）——sourceTrace 仅查存在性未与审计链核对；该插件 instinct 写入能力降级（仅允许可回溯条目）`,
      });
    }
    // 被三道门拒收的样本 = 审核链拦下（不产生 finding，即该用例未穿透）
  }

  // ④ apply 供应链注入
  const sideEffects = sec?.mountSideEffects ?? [];
  for (const e of sideEffects) {
    findings.push({
      case: 'mount-side-effect',
      severity: 'reject',
      detail: `apply 阶段挂载外写动作（${e.kind} → ${e.target}）——挂载即写文件/改配置（供应链注入红线）`,
    });
  }

  const rejected = findings.filter((f) => f.severity === 'reject');
  const restricted = findings.filter((f) => f.severity === 'restricted');
  const rating: SecurityRating = rejected.length > 0 ? 'reject' : restricted.length > 0 ? 'restricted' : 'pass';
  const ratingLabel =
    rating === 'pass'
      ? '通过'
      : rating === 'restricted'
        ? `受限通过（${restricted.length} 项能力降级挂载）`
        : `拒载（${rejected.length} 项红线）`;
  const detail =
    findings.length === 0
      ? '安全评级：通过——四项最小用例（越权 services / 事件投毒 / instinct 池毒 / apply 供应链注入）均无命中'
      : `安全评级：${ratingLabel}——命中 ${findings.length} 项（${findings.map((f) => f.case).join(', ')}）`;
  return { rating, findings, detail };
}

/**
 * 五段挂载预检（①→⑤ 顺序执行；可用性四段任一不过或安全拒载即判「只挂载不生效」）。
 *
 * 不短路：五段**全部执行**后才下结论——用户一次看到完整缺口清单，
 * 不必「修一个跑一次」（预检是诊断不是门禁）。
 *
 * @param declaration 插件声明（被预检对象）
 * @param ctx 对照面（桥实例 + 宿主事件名集 + 事件 kind 契约集）
 * @returns 两态结论 + 逐段结果 + 缺口明细 + 三态安全评级 + 对照源快照
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

  // 段⑤ 安全段（恶意插件四个最小用例 + 三态安全评级）
  const scan = probeSecurityScan(declaration, ctx);
  const securityGaps = scan.findings
    .filter((f) => f.severity === 'reject')
    .map((f) => `安全段红线：${f.detail}`);
  segments.push({
    segment: 'security-scan',
    label: SEGMENT_LABELS['security-scan'],
    ok: scan.rating !== 'reject',
    detail: scan.detail,
    gaps: securityGaps,
  });

  const gaps = segments.flatMap((s) => s.gaps);
  const usable = segments.every((s) => s.ok);
  const ratingTag =
    scan.rating === 'pass' ? '安全通过' : scan.rating === 'restricted' ? '安全受限通过' : '安全拒载';
  const summary = usable
    ? `「${declaration.pluginId}」可用——五段预检全过（事件可读 / 服务可调 / apply 成功 / 探针有产出 / ${ratingTag}）`
    : `「${declaration.pluginId}」只挂载不生效——五段中 ${segments.filter((s) => !s.ok).length} 段不过，缺口 ${gaps.length} 项（${ratingTag}，详见 gaps）`;

  return {
    pluginId: declaration.pluginId,
    verdict: usable ? 'usable' : 'mounted-inert',
    summary,
    segments,
    gaps,
    securityRating: scan.rating,
    securityFindings: scan.findings,
    checkedAt: new Date().toISOString(),
    hostInterface: {
      eventCount: hostEvents.length,
      serviceNamespaces: ctx.serviceBridge.namespaces(),
      bridgeForwarded: ctx.eventBridge.stats.forwarded,
    },
  };
}
