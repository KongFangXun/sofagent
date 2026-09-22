// ============================================================
// events/types.ts · 事件驱动执行触发——事件与订阅类型定义（v1.5.1 第一章新建）
// ============================================================
//
// 触发源从「人派活 / cron」泛化到**业务事件**：上游节点产出 / 外部 webhook
// 入站 / 定时器 → 事件总线 → 按 workflow 节点的 `on:` 声明路由到节点。
//
// 设计约束：
//   - 事件类型注册表（EVENT_TYPES）是**单一事实源**：`on:` 声明只允许引用
//     表内类型（拼错的事件名 = 永不触发的静默失效，故 fail-loud 拒绝）。
//   - 事件带 correlationId / causationId 两个追溯键：前者标识一次触发链
//     （根事件 id），后者指向直接触发本事件的上游事件——链条可还原。
//   - 死信条目复用 v1.3.1 stop_reason 六值分类 + 指数退避（@sofagent/core），
//     不另造错误分类。
//
// 与后续版本的依赖（v1.5.2 / v2.0.0 消费）：事件类型注册表可扩展，总线接口
// 保持可订阅；本章只登记类型与基础底座，不改既有调用面。
// ============================================================

import type { StopReason } from '@sofagent/core';

// ────────────────────────────────────────────────────────────
// 事件类型注册表（单一事实源）
// ────────────────────────────────────────────────────────────

/**
 * 事件类型常量表——`on:` 声明只允许引用本表内取值。
 *
 * 前三类为 v1.5.1 第一章交付的三类触发源；device.* 三行为第四章
 * （`device.upgrade` / `device.deploy`）与第五章（任务下发）**同批登记**——
 * 事件类型定义收敛在本文件（按任务书「第四章新建该文件，本章同批扩展登记」），
 * 消费侧（设备 daemon 订阅）在各自章节接线。
 */
export const EVENT_TYPES = {
  /** 上游节点产出——workflow 内部事件链（节点执行完成后发布） */
  NODE_OUTPUT: 'workflow.node.completed',
  /** webhook 入站 · 表单提交 */
  WEBHOOK_FORM: 'webhook.form.submitted',
  /** webhook 入站 · IM 消息 */
  WEBHOOK_IM: 'webhook.im.message',
  /** 定时器（v1.3.8 cron 既有调度面到期后发布） */
  TIMER_TICK: 'timer.tick',
  /**
   * 异常上报（第三章异常总线的合成事件类型——节点失败但无来源事件时，
   * 异常仍需带事件上下文进死信通道）。登记在此使类型门对它同样生效，
   * 节点也可 `on: anomaly.reported` 订阅异常流。
   */
  ANOMALY_REPORTED: 'anomaly.reported',
  /** 第四章 G12：设备 OTA 升级指令（payload：目标版本 + 组件清单 + 灰度策略 + 截止窗口） */
  DEVICE_UPGRADE: 'device.upgrade',
  /** 第四章 G12：平台→设备内容下发（payload：skill/workflow 模板包） */
  DEVICE_DEPLOY: 'device.deploy',
  /** 第五章：任务下发（payload：任务清单 + 目标设备 + 时效） */
  DEVICE_TASK_DISPATCH: 'device.task.dispatch',
} as const;

/** 已登记的事件类型取值 */
export type RegisteredEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/** 事件类型全量取值列表（校验用） */
export const REGISTERED_EVENT_TYPES: readonly string[] = Object.values(EVENT_TYPES);

// ────────────────────────────────────────────────────────────
// 事件来源
// ────────────────────────────────────────────────────────────

/** 事件来源类型——三类触发源 + 设备面（第四/五章同批登记） */
export type EventSourceType = 'node-output' | 'webhook' | 'timer' | 'device';

/** webhook 入站子类型（≥2 类：表单提交 / IM 消息） */
export type WebhookKind = 'form' | 'im';

// ────────────────────────────────────────────────────────────
// 事件本体
// ────────────────────────────────────────────────────────────

/** 上游节点产出事件的 payload */
export interface NodeOutputPayload {
  workflowId: string;
  /** 产出该输出的节点 id */
  nodeId: string;
  /** 节点输出文本 */
  output: string;
  /** 节点是否成功 */
  success: boolean;
}

/** webhook 入站事件的 payload */
export interface WebhookPayload {
  kind: WebhookKind;
  /** 归一化后的入站体（表单字段 / IM 消息字段） */
  body: Record<string, unknown>;
  /** 来源标识（表单 id / IM 群标识——由调用方按接入面填入） */
  origin?: string;
}

/** 定时器事件的 payload */
export interface TimerPayload {
  /** 定时器 id */
  timerId: string;
  /** 定时器声明（三档糖宏或五段 cron；非 cron 形态为自然语言周期） */
  schedule: string;
}

// ────────────────────────────────────────────────────────────
// 设备面事件 payload（v1.5.1 第四 / 五章契约——**唯一登记处**）
// ────────────────────────────────────────────────────────────
//
// 🔴 契约单一事实源：`device.upgrade` / `device.deploy` / `device.task.dispatch`
//    三个 payload 的**唯一定义**在本文件；消费侧（daemon 设备订阅
//    `engine/daemon/src/ota/subscriptions.ts`、MCP 侧下发 `device_data_push`）
//    一律从 `@sofagent/orchestrator` 导入，不得在本地复制第二份
//    （同一契约两处定义 = 两侧漂移后类型仍能通过编译的静默失效）。
//
// 事件类型常量在 `EVENT_TYPES`（同批登记），此处只定义 payload 形状。

/** 组件层级——灰度次序判据：non-core 先升，core 后升 */
export type DeviceUpgradeTier = 'non-core' | 'core';

/** 单个待升级组件 */
export interface DeviceUpgradeComponent {
  /** 组件名（文件名词法，防路径穿越——消费侧按 COMPONENT_NAME_PATTERN 复核） */
  name: string;
  /** 组件目标版本 */
  version: string;
  /** 组件层级（灰度次序：non-core → core） */
  tier: DeviceUpgradeTier;
  /** 制品标识（npm 包名 / 制品库路径——拉取通道入参） */
  artifact?: string;
  /** 制品内容（内联，小包场景；优先级高于拉取通道） */
  content?: string;
}

/** 灰度策略 */
export interface DeviceUpgradeRollout {
  /**
   * 灰度比例（0-100，**平台侧语义**）。
   *
   * ⚠️ **设备侧不读该字段做采样**：执行器只按 `batchSize` 分批（非核心 → 核心），
   * 组件清单里的**全部**组件都会被升级——即便 `percentage: 0`。仓内该字段唯一消费点
   * 是审计证据行 `rolloutPercentage=`（`engine/daemon/src/ota/upgrade-executor.ts`），
   * 无任何采样分支。服务侧要按比例抽样，须在下发前自行裁剪 `components`。
   */
  percentage?: number;
  /** 分批大小（每批组件数；缺省 = 每个层级一批） */
  batchSize?: number;
}

/**
 * 交付签名信封（Ed25519——升级与下发两个 payload 共用）。
 *
 * 消费侧验签 fail-closed：缺签名 → 拒绝执行（不静默跳过验签）。
 */
export interface DeviceDeliverySignature {
  /** 签名者委托人标识（企业 / 平台） */
  principal: string;
  /** Ed25519 公钥（hex，SPKI/DER） */
  publicKey: string;
  /** 对交付摘要的签名（hex） */
  signature: string;
  /** 约束版本（缺省 1） */
  constraintVersion?: number;
  /** 责任声明位（承载交付摘要：'<label>|sha256=<digest>'） */
  responsibility: string;
}

/** `device.upgrade` 事件 payload：目标版本 + 组件清单 + 灰度策略 + 截止窗口 */
export interface DeviceUpgradePayload {
  /** 目标版本 */
  targetVersion: string;
  /** 组件清单 */
  components: DeviceUpgradeComponent[];
  /** 灰度策略 */
  rollout: DeviceUpgradeRollout;
  /** 截止窗口（ISO 8601——已过则挂起等待人工处置，不静默跳过） */
  deadline?: string;
  /** 交付签名信封（缺省 → 验签 fail-closed 拒绝） */
  signature?: DeviceDeliverySignature;
}

/** `device.deploy` 事件 payload：平台 → 设备内容下发（携 skill/workflow 模板包） */
export interface DeviceDeployPayload {
  /** 目标设备（缺省 = 当前设备自身；亦支持事件 `metadata.targetDevice`） */
  targetDevice?: string;
  /** 下发批次标识（签名标签用） */
  bundleId?: string;
  /** skill / workflow 模板包（G1 五件套：manifest + workflow.yml + 伴生件） */
  bundle: Record<string, unknown>;
  /** 落盘注册的 workflow id（缺省 = 源 id + '-imported'） */
  importedAs?: string;
  /** 交付签名信封（缺省 → 验签 fail-closed 拒绝） */
  signature?: DeviceDeliverySignature;
}

/** 任务下发条目（任务清单元素） */
export interface DeviceTaskItem {
  /** 任务标题（设备侧队列主键） */
  title: string;
  /** 任务载荷（下发正文） */
  payload: string;
  /** 派发方标识（缺省 orchestrator） */
  dispatchedBy?: string;
}

/** `device.task.dispatch` 事件 payload：任务清单 + 目标设备 + 时效 */
export interface DeviceTaskDispatchPayload {
  /** 目标设备 deviceId（缺省 = 当前设备自身；亦支持事件 `metadata.targetDevice`） */
  targetDevice?: string;
  /** 任务清单 */
  tasks: DeviceTaskItem[];
  /** 时效（毫秒——以事件 ts 起算，超时视为过期不投递，fail-closed） */
  ttlMs?: number;
}

/** 总线内流转的事件 */
export interface SofagentEvent<T = unknown> {
  /** 事件唯一 id */
  id: string;
  /** 事件类型（EVENT_TYPES 注册表取值） */
  type: string;
  /** 事件来源 */
  source: EventSourceType;
  /** 事件产生时刻（ISO 8601） */
  ts: string;
  /** 事件载荷 */
  payload: T;
  /**
   * 触发链根事件 id——同一因果链共享同一 correlationId，是
   * 「每条事件触发链可追溯」的主键。
   */
  correlationId: string;
  /**
   * 直接触发本事件的上游事件 id（根事件无此字段）。
   * correlationId 定位链条、causationId 定位链条内的父子边。
   */
  causationId?: string;
  /** 所属 workflow（node-output 源必填） */
  workflowId?: string;
  /** 事件投递目标节点（由路由匹配后回填，便于留痕对照） */
  targetNodeId?: string;
  /** 第几次投递尝试（1-based；重放时递增） */
  attempt?: number;
  /** 附加元数据（agentId / sessionId 等留痕字段） */
  metadata?: Record<string, unknown>;
}

/** 发布入参（总线补齐 id / ts / correlationId 等） */
export interface EventPublishInput<T = unknown> {
  type: string;
  source: EventSourceType;
  payload: T;
  /** 缺省 = 自身 id（即根事件） */
  correlationId?: string;
  causationId?: string;
  workflowId?: string;
  targetNodeId?: string;
  metadata?: Record<string, unknown>;
  /** 测试/重放可显式指定事件 id；缺省自动生成 */
  id?: string;
  /** 测试可显式指定时刻；缺省当前时间 */
  ts?: string;
}

// ────────────────────────────────────────────────────────────
// 订阅声明（workflow 节点的 `on:` 字段）
// ────────────────────────────────────────────────────────────

/**
 * 事件订阅声明——workflow 节点 `on:` 字段的解析结果。
 *
 * YAML 两种写法：
 *   on: webhook.form.submitted                      # 简写（仅事件类型）
 *   on:                                             # 完整形态
 *     event: workflow.node.completed
 *     from: intake                                  # 上游节点约束（node-output 源）
 *     filter: { formId: contact-us }                # payload 等值过滤
 */
export interface EventSubscription {
  /** 声明该订阅的节点 id（`on:` 所在的节点） */
  nodeId: string;
  /** 订阅的事件类型 */
  event: string;
  /** 上游节点约束——仅对 node-output 源有意义 */
  from?: string;
  /** payload 等值过滤（键值全等才命中） */
  filter?: Record<string, string | number | boolean>;
}

/** 路由命中结果（事件 → 目标节点） */
export interface EventRoutingTarget {
  nodeId: string;
  subscription: EventSubscription;
}

// ────────────────────────────────────────────────────────────
// 投递留痕 / 死信
// ────────────────────────────────────────────────────────────

/** 投递结局（投递留痕条目的 kind 取值——同一组值即链内核 validKinds） */
export type DeliveryOutcome = 'DELIVERED' | 'FAILED' | 'DEAD_LETTER' | 'REPLAYED';

/** 投递留痕条目（HMAC 链上的一条——每行一 JSON） */
export interface DeliveryRecord {
  /** 留痕条目类型（链内核 kind 门取值） */
  kind: DeliveryOutcome;
  /** 留痕时刻 */
  ts: string;
  /** 事件 id */
  eventId: string;
  /** 事件类型 */
  eventType: string;
  /** 触发链根事件 id */
  correlationId: string;
  causationId?: string;
  /** 投递目标节点 */
  nodeId?: string;
  /** 本次尝试序号（1-based） */
  attempt: number;
  /** stop_reason 六值分类（失败/死信时） */
  stopReason?: StopReason;
  /** 失败原因（失败/死信时） */
  error?: string;
  /** 该事件本次留痕关联的决策条目 ts（kind=ORCHESTRATION 事件路由决策） */
  decisionTs?: string;
  /** 死信 id（DEAD_LETTER / REPLAYED 时） */
  deadLetterId?: string;
  /** 链字段（由 chain-kernel 生成） */
  prevHash?: string;
  hashVersion?: number;
  hmacAlgo?: string;
  hmacSig?: string;
  envFingerprint?: string;
}

/**
 * 死信条目——事件处理失败进死信队列，可重放。
 *
 * 分类复用 v1.3.1 stop_reason 六值（classifyError）+ isRetryableStopReason +
 * backoffDelayMs（@sofagent/core），不另造分类与退避表。
 */
export interface DeadLetterEntry {
  /** 死信 id */
  id: string;
  /** 死信入队时刻 */
  ts: string;
  /** 原始事件 */
  event: SofagentEvent;
  /** 投递失败的节点（路由命中时） */
  nodeId?: string;
  /** 失败原因（人类可读） */
  error: string;
  /** stop_reason 六值分类 */
  stopReason: StopReason;
  /** 是否可按退避阶梯重试（isRetryableStopReason 判定） */
  retryable: boolean;
  /** 已尝试次数 */
  attempts: number;
  /** 建议的下次重试退避延时（ms，backoffDelayMs 取值） */
  nextRetryDelayMs: number;
  /** 重放次数 */
  replayCount: number;
  /** 最近一次重放时刻（未重放过则缺省） */
  replayedAt?: string;
  /** 异常总线写入的决策条目 ts（第三章复用本通道时回填——链条可追溯） */
  decisionTs?: string;
  /** 异常分类（第三章复用本通道时回填：retryable / needs-human / needs-rollback） */
  anomalyClass?: string;
}

/** 投递结果（publish / replay 的返回） */
export interface EventPublishResult {
  event: SofagentEvent;
  /** 是否全部命中订阅者成功（无订阅者视为 delivered——事件已落盘待后续消费） */
  delivered: boolean;
  /** 命中订阅者数 */
  subscriberCount: number;
  /** 尝试次数 */
  attempts: number;
  /** 失败时的 stop_reason 分类 */
  stopReason?: StopReason;
  /** 失败/进死信时的死信 id */
  deadLetterId?: string;
  /** 失败原因 */
  error?: string;
  /** 本次发布/投递留痕的决策条目 ts */
  decisionTs?: string;
}
