// ============================================================
// audit-stream-push.ts · 审计事件流对外订阅桥（v1.5.2 章一「订阅推送」）
// ============================================================
//
// 交付原文（docs/changelog/v1.5/v1.5.2.md §一）：
//   | 订阅推送 | 审计事件流对外订阅（复用 webhook 三态推送通道，对齐 v1.5.1 事件总线出站面） |
//
// 设计意图（本章探索注记）：audit 数据对外暴露是 meta-harness（v1.3.9）的延伸——
// **外部 SIEM / 商业平台可订阅审计流**，而不是靠轮询。故本模块 = 审计事件流的
// **对外订阅桥**：外部消费方通过既有 webhook 三态推送通道订阅，形态上对齐
// v1.5.1 事件总线的**出站面**（订阅机制出站，不另造轮询器）。
//
// ── 落点约束（依赖方向）────────────────────────────────────
// dependency-direction.yml：daemon(L3).allow ∋ orchestrator，orchestrator **不**依赖
// daemon。故订阅桥必须落在 daemon 侧——daemon 既已持有 webhook 推送器
// （./index.ts 的 createWebhookPusher），又能订阅 orchestrator 的总线。放 orchestrator
// 侧会违反依赖方向（orchestrator → daemon）。
//
// ── 复用不重造（铁律）────────────────────────────────────
//   · 推送本体**一律复用** createWebhookPusher（同目录 ./index.ts）：不新造 HTTP
//     客户端、不新造重试/退避/降级/SSRF/通道健康逻辑。
//   · 推送语义沿用既有通道铁律：**push() 永不 reject**；失败降级写
//     data/webhook-fallback.log 并落通道健康（writeWebhookChannelHealth）。
//   · 参照模板：./audit-report-push.ts（读配置 → 建 pusher → 定 verdict → push）与
//     cli.ts:187-199（设备离线告警，verdict='FAIL'）。
//
// ── 「审计事件流」口径（关键判断——见本文件末「口径结论」）────────
// 仓内**没有**现成的「审计裁决事件」类型：审计裁决（PASS/WARN/FAIL）由
// run_audit（engine/mcp/src/tools/audit-tools.ts 的 runAudit，经 webhookPush 出口）
// 与 daemon 侧 runFilesystemAudit 直接产出，**不经事件总线**。事件总线（v1.5.1
// engine/orchestrator/src/events）登记的是业务触发源 + 设备面 + 异常面。
// 故本桥的「审计事件流」口径 = **事件总线中携带审计语义（失败 / 异常 / 需 SIEM
// 在场的治理动作）的已登记事件子集**——逐条映射见 mapEventToAuditPush。
//
// 铁律：**默认关档（L1）**——未配置任何 webhook endpoint 时，attach 不订阅、
// 不推送、不落盘，行为与今日逐字一致（这是本桥的 opt-in 语义）。
// ============================================================

import { join } from 'path';
import { EVENT_TYPES, type EventBus, type SofagentEvent } from '@sofagent/orchestrator';
import {
  createWebhookPusher,
  type AuditVerdict,
  type WebhookPlatform,
  type WebhookPusher,
  type WebhookPusherOptions,
  type WebhookPushResult,
} from './index';

// ────────────────────────────────
// 公开类型
// ────────────────

/**
 * 事件总线订阅端口。
 *
 * 结构性等于 v1.5.1 第一章 `EventBus` 的公开订阅面（`subscribe(type, handler) => 退订句柄`），
 * 故真实 `new EventBus(...)` 实例可直接传入；测试可用同形假总线（照
 * engine/daemon/src/ota/subscriptions.ts 的 `DeviceEventBusPort` 先例）。
 */
export type AuditStreamBusPort = Pick<EventBus, 'subscribe'>;

/** attachAuditStreamToBus / pushAuditStreamEvent 配置项 */
export interface AuditStreamPusherOptions {
  /** 数据根目录（缺省不消费；提供且未给 logPath 时用于推导降级日志落点） */
  dataDir?: string;
  /**
   * 目标平台清单（缺省按 env 中**已配置 endpoint** 的平台决定）。
   *
   * 显式传入即以此为准（含空数组 = 显式关档）；未配置 endpoint 的平台应被跳过
   * 而非报错——「配置缺失是部署问题不是平台问题」（对齐 ./index.ts 语义）。
   */
  platforms?: WebhookPlatform[];
  /** endpoint 来源（缺省 process.env——与 createWebhookPusher 同源） */
  env?: Record<string, string | undefined>;
  /** 降级本地日志路径（jsonl 追加；缺省走 createWebhookPusher 默认或 dataDir 推导） */
  logPath?: string;
  /** 推送器注入（测试用假 pusher，或宿主复用同一 pusher；缺省新建一个） */
  pusher?: WebhookPusher;
}

/** 事件 → 审计推送映射结果（null 表示该事件**不进审计流**） */
export interface AuditPushMapping {
  verdict: AuditVerdict;
  message: string;
}

// ────────────────────────────────
// 常量
// ────────────────

/** 平台 → endpoint 环境变量（与 ./index.ts 的 ENDPOINT_ENV 同口径——此处仅用于探测「是否已配置」） */
const PLATFORM_ENDPOINT_ENV: Record<WebhookPlatform, string> = {
  feishu: 'SOFAGENT_WEBHOOK_FEISHU',
  dingtalk: 'SOFAGENT_WEBHOOK_DINGTALK',
  wecom: 'SOFAGENT_WEBHOOK_WECOM',
};

/** 平台枚举顺序（决定缺省探测次序——稳定输出便于测试） */
const ALL_PLATFORMS: WebhookPlatform[] = ['feishu', 'dingtalk', 'wecom'];

/** 三态闭合域（显式声明通道仅接受这三值） */
const VERDICT_DOMAIN: ReadonlySet<string> = new Set<AuditVerdict>(['PASS', 'WARN', 'FAIL']);

/** 展示用单字段最大长度（外部 IM 通道——防超长 payload 撑爆平台限流） */
const MAX_FIELD_LEN = 200;

// ────────────────────────────────
// 平台解析
// ────────────────

/**
 * 解析目标平台清单。
 *
 * 规则（与任务书「未配置 endpoint 的平台跳过，不是报错」对齐）：
 *   · 显式 `options.platforms` 优先（含空数组——表示显式关档）；
 *   · 否则按 env 中**已配置（非空）endpoint** 的平台决定——未配置即不选。
 *
 * @param options 配置项（缺省读 process.env）
 * @returns 平台清单（可能为空——空即「审计流未启用」，调用方据此零副作用）
 */
export function resolveAuditStreamPlatforms(options: AuditStreamPusherOptions = {}): WebhookPlatform[] {
  if (options.platforms) return [...options.platforms];
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  return ALL_PLATFORMS.filter((platform) => {
    const endpoint = env[PLATFORM_ENDPOINT_ENV[platform]];
    return typeof endpoint === 'string' && endpoint.trim() !== '';
  });
}

// ────────────────────────────────
// 事件 → 三态裁决映射（纯函数，便于单测，不依赖总线）
// ────────────────────────────────

/** 截断展示字段（超长 → 省略号；null/undefined → ''） */
function clampText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length > MAX_FIELD_LEN ? `${value.slice(0, MAX_FIELD_LEN)}…` : value;
}

/**
 * 组装人读消息（含事件类型 / id / 触发链 / payload 摘要 / stop_reason）。
 *
 * 内容面向外部 SIEM——给出「谁在何时发生了什么」的最小可定位集，其余细节由
 * 消费方按 correlationId 回查（不在此内联全量 payload，防泄漏与超长）。
 */
function describeEvent(event: SofagentEvent): string {
  const parts: string[] = [`[审计事件流] ${event.type}`, `event=${event.id}`, `correlation=${event.correlationId}`];
  const payload = event.payload;
  if (payload !== null && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const wf = clampText(p['workflowId']);
    const node = clampText(p['nodeId']);
    const error = clampText(p['error']);
    const output = clampText(p['output']);
    const targetVersion = clampText(p['targetVersion']);
    const bundleId = clampText(p['bundleId']);
    if (wf !== '') parts.push(`workflow=${wf}`);
    if (node !== '') parts.push(`node=${node}`);
    if (error !== '') parts.push(`error=${error}`);
    if (output !== '') parts.push(`output=${output}`);
    if (targetVersion !== '') parts.push(`targetVersion=${targetVersion}`);
    if (bundleId !== '') parts.push(`bundleId=${bundleId}`);
  }
  const stopReason = clampText(event.metadata?.['stopReason']);
  if (stopReason !== '') parts.push(`stop_reason=${stopReason}`);
  return parts.join(' · ');
}

/**
 * 事件 → { verdict, message } 映射（**纯函数**——不触总线、不触网络，可直接单测）。
 *
 * 三态映射表（verdict 只取 PASS | WARN | FAIL；逐条依据见下）：
 *
 * | 事件类型                                   | verdict | 理由                                                                 |
 * |--------------------------------------------|---------|----------------------------------------------------------------------|
 * | `anomaly.reported`                         | FAIL    | 异常上报是审计异常流的**正源**（第三章异常总线的合成事件类型）——节点/编排失败进异常总线，SIEM 必须立即在场 |
 * | `workflow.node.completed`（payload.success=false） | FAIL | 节点执行失败＝审计可见的失败事件（与异常同源、走节点产出通道）——须告警 |
 * | `device.upgrade`                           | WARN    | 设备 OTA 升级是**治理动作**（改设备固件状态）——非失败但须 SIEM 可见（谁把哪台设备升到什么版本） |
 * | `device.deploy`                            | WARN    | 平台→设备内容下发同为治理动作（改设备内容）——须 SIEM 可见            |
 *
 * **不进审计流（返回 null）的已登记事件及理由**（不硬塞成 PASS 制造噪声）：
 *   · `workflow.node.completed`（success=true）——正常业务流量，逐节点进流会淹没 SIEM；
 *   · `webhook.form.submitted` / `webhook.im.message`——**入站触发源（输入）**，非审计裁决；
 *   · `timer.tick`——调度心跳，非审计裁决；
 *   · `device.task.dispatch`——纯任务调度（与 timer.tick 同类），非裁决。
 *
 * **PASS 为何缺省不产出**：总线事件里没有「一次审计干净通过」的表征（审计 PASS 由
 * 既有 `pushAuditReport` 通道覆盖）。无据可依即不产出——照任务书「不要硬塞成 PASS」。
 *
 * **显式裁决声明通道**：事件 `metadata.auditVerdict ∈ {PASS,WARN,FAIL}` 时以其为准
 * （凌驾于上表类型缺省）。用途：审计事件的产生方（如 daemon 侧文件系统审计回调）
 * 需精确表达三态（WARN vs FAIL）时，挂 `metadata.auditVerdict` 声明——静态表无法
 * 覆盖「同一类型、不同严重度」的场景。该通道仍在进程内（发布方 opt-in），非外部注入面。
 *
 * @param event 总线事件本体（v1.5.1 SofagentEvent）
 * @returns { verdict, message }；该事件不进审计流时返回 null
 */
export function mapEventToAuditPush(event: SofagentEvent): AuditPushMapping | null {
  // ① 显式裁决声明优先（产生方精确声明三态）
  const declared = event.metadata?.['auditVerdict'];
  if (typeof declared === 'string' && VERDICT_DOMAIN.has(declared)) {
    return { verdict: declared as AuditVerdict, message: describeEvent(event) };
  }

  // ② 静态类型映射（缺省口径）
  switch (event.type) {
    case EVENT_TYPES.ANOMALY_REPORTED:
      return { verdict: 'FAIL', message: describeEvent(event) };

    case EVENT_TYPES.NODE_OUTPUT: {
      const payload = event.payload;
      const success = payload !== null && typeof payload === 'object'
        ? (payload as Record<string, unknown>)['success']
        : undefined;
      // 仅失败节点进流；成功节点是业务流量（不进审计流）
      if (success === false) return { verdict: 'FAIL', message: describeEvent(event) };
      return null;
    }

    case EVENT_TYPES.DEVICE_UPGRADE:
    case EVENT_TYPES.DEVICE_DEPLOY:
      return { verdict: 'WARN', message: describeEvent(event) };

    // 入站触发源 / 调度心跳 / 任务下发 / 其余已登记或未知类型——非审计裁决，不进流
    default:
      return null;
  }
}

// ────────────────────────────────
// 推送
// ────────────────

/** 组装 createWebhookPusher 配置（env + 可选 logPath——dataDir 未给 logPath 时推导） */
function buildPusherOptions(options: AuditStreamPusherOptions): WebhookPusherOptions {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const derivedLogPath = options.logPath ?? (options.dataDir !== undefined ? join(options.dataDir, 'webhook-fallback.log') : undefined);
  return {
    env,
    ...(derivedLogPath !== undefined ? { logPath: derivedLogPath } : {}),
  };
}

/**
 * 把单个事件按三态裁决推送到所有目标平台。
 *
 * 语义：
 *   · 事件不进审计流（mapEventToAuditPush 返回 null）→ 返回空数组（零副作用）；
 *   · 未配置任何平台（零 endpoint）→ 返回空数组（零副作用，不建 pusher、不落盘）；
 *   · 多平台：**一个平台失败不中断对其他平台的推送**——逐个 await 并收集结果；
 *   · 失败不抛：push() 铁律永不 reject；即便注入的 pusher 违约 reject，也在此吞掉
 *     并合成一条 degraded 结果（防单平台异常中断其余平台与订阅回调）。
 *
 * @param event 总线事件本体
 * @param options 配置项（platforms / env / pusher / dataDir / logPath）
 * @returns 各平台推送结果数组（不进流 / 无平台时为 []）
 */
export async function pushAuditStreamEvent(
  event: SofagentEvent,
  options: AuditStreamPusherOptions = {},
): Promise<WebhookPushResult[]> {
  const mapping = mapEventToAuditPush(event);
  if (mapping === null) return [];

  const platforms = resolveAuditStreamPlatforms(options);
  if (platforms.length === 0) return [];

  const pusher = options.pusher ?? createWebhookPusher(buildPusherOptions(options));
  const results: WebhookPushResult[] = [];
  for (const platform of platforms) {
    try {
      results.push(await pusher.push(platform, mapping.verdict, mapping.message));
    } catch (err) {
      // push() 铁律永不 reject——但仍兜一层，防注入 pusher 违约中断其余平台
      results.push({
        success: false,
        platform,
        attempts: 0,
        degraded: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/**
 * 把审计事件流订阅桥挂到事件总线——**订阅机制出站**（对齐 v1.5.1 事件总线出站面）。
 *
 * 行为：
 *   · 解析目标平台；**为空（未配置任何 endpoint）→ 不订阅**，返回 no-op detach——
 *     未启用时零订阅、零推送、零落盘，行为与今日逐字一致（L1 关档 opt-in）。
 *   · 有平台 → 以 `'*'` 订阅（通配——出站面必须覆盖所有事件，由纯映射函数决定
 *     谁进审计流；新增审计相关事件类型只需扩 mapEventToAuditPush，无需改订阅面）。
 *   · 处理器**永不抛**：订阅者抛错会被总线判为投递失败（走重试/死信）——推送是
 *     辅助通道，绝不能因其故障污染总线投递语义。异常显式 warn（不静默）。
 *
 * @param bus 事件总线（真实 EventBus 或其同形实现）
 * @param options 配置项（platforms / env / pusher / dataDir / logPath）
 * @returns detach 函数（真退订；未启用时为 no-op）
 */
export function attachAuditStreamToBus(
  bus: AuditStreamBusPort,
  options: AuditStreamPusherOptions = {},
): () => void {
  const platforms = resolveAuditStreamPlatforms(options);
  if (platforms.length === 0) {
    // L1 关档：未配置任何 endpoint → 零副作用（不订阅、不推送、不落盘）
    return () => undefined;
  }

  const handler = async (event: SofagentEvent): Promise<void> => {
    try {
      await pushAuditStreamEvent(event, options);
    } catch (err) {
      // 订阅者抛错 ⇒ 总线判投递失败 ⇒ 走重试/死信——本桥绝不把自身故障带回总线。
      // 但仍显式告警（静默降级正是本桥要防的失效形态）。
      console.warn(
        `[audit-stream] 审计事件流推送异常（不阻断总线投递）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // '*' = 通配订阅（出站面对齐第一章 subscribe 通配语义）
  return bus.subscribe('*', handler);
}
