// ============================================================
// events/router.ts · 事件 → 节点路由（v1.5.2 第一章新建）
// ============================================================
//
// 读 workflow 节点的 `on:` 声明，把到达总线的事件派发到目标节点执行，
// 节点执行完成后产出新事件（workflow.node.completed）驱动下游——形成
// workflow 内部事件链。
//
// 职责边界：
//   - 本文件**只做路由与派发**：订阅声明解析 / 校验 / 匹配 / 调节点执行器。
//   - 节点执行本体由注入的 NodeRunner 提供（宿主位——执行属既有编排链路）。
//   - 事件留痕与死信由 bus.ts 承载（本文件不写盘、不另造通道）。
//
// 🔴 注册点：`EventRouter.attach(workflowText)` 把 router 挂到总线
//    （bus.subscribe('*')）+ 绑定该 workflow 的订阅表；`detach()` 摘下。
//    不 attach = 订阅声明不生效（默认配置下静默不触发）。
//
// 🔴 级联防环：事件链深度记在 event.metadata.chainDepth，超过 maxChainDepth
//    拒绝继续执行并进死信（事件环 = 无限触发，必须显式卡住而非任其自转）。
// ============================================================

import * as yaml from 'js-yaml';
import { EventBus, type EventHandler } from './bus';
import { createNodeOutputSource } from './adapters';
import {
  EVENT_TYPES,
  REGISTERED_EVENT_TYPES,
  type EventRoutingTarget,
  type EventSubscription,
  type SofagentEvent,
} from './types';

/** 节点执行结果（NodeRunner 返回） */
export interface NodeRunResult {
  /** 节点输出文本 */
  output: string;
  /** 是否成功 */
  success: boolean;
}

/** 节点执行上下文 */
export interface NodeRunContext {
  /** 目标节点 id */
  nodeId: string;
  /** 触发本节点的事件 */
  event: SofagentEvent;
  /** 命中的订阅声明 */
  subscription: EventSubscription;
}

/**
 * 节点执行器（宿主位）——由持有编排执行链路的接入方注入。
 *
 * 缺省不提供：此时 router 对事件**显式报错并入死信**（fail-loud——
 * 「没有执行器」必须是可见故障，不能静默不执行）。
 */
export type NodeRunner = (ctx: NodeRunContext) => Promise<NodeRunResult>;

/** 路由处理结局 */
export interface RoutingOutcome {
  /** 命中并执行的节点 */
  executed: string[];
  /** 未命中任何订阅（事件被忽略——正常形态） */
  matched: number;
  /** 执行失败的节点 */
  failed: Array<{ nodeId: string; error: string }>;
}

/** router 构造选项 */
export interface EventRouterOptions {
  /** 总线（必填——路由靠它收事件、发布级联事件） */
  bus: EventBus;
  /** 节点执行器（缺省 = 无执行器，事件进死信并告警） */
  nodeRunner?: NodeRunner;
  /** 事件链深度上限（缺省 32——防事件环无限触发） */
  maxChainDepth?: number;
}

/** 订阅声明解析结果 */
export interface ParsedSubscriptions {
  /** workflow 名（缺省 unnamed-workflow） */
  workflowName: string;
  /** 订阅声明（按节点顺序） */
  subscriptions: EventSubscription[];
}

// ────────────────────────────────────────────────────────────
// `on:` 声明解析与校验（mcp 侧 workflow-submit 复用同一实现——单一事实源）
// ────────────────────────────────────────────────────────────

/**
 * 解析 workflow 文本的节点 `on:` 声明。
 *
 * 支持两种写法（YAML）：
 *   on: webhook.form.submitted                 # 简写
 *   on: { event: ..., from?: ..., filter?: ... }  # 完整形态
 *
 * 解析失败 / 结构非法抛错（调用方需要「错误清单」请用
 * `validateEventSubscriptions`——它把同一批判据转成字符串清单）。
 *
 * @param workflowText workflow YAML / JSON 文本
 * @returns 解析结果（workflowName + 订阅声明）
 */
export function parseEventSubscriptions(workflowText: string): ParsedSubscriptions {
  const doc = loadWorkflowDoc(workflowText);
  const nodes = readNodes(doc);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    const id = readNodeId(node);
    if (id !== null) nodeIds.add(id);
  }

  const subscriptions: EventSubscription[] = [];
  for (const node of nodes) {
    const id = readNodeId(node);
    if (id === null) throw new Error('[events:router] 节点缺少 id，无法解析 on: 声明');
    const on = node.on;
    if (on === undefined || on === null) continue;
    subscriptions.push(parseOneSubscription(id, on, nodeIds));
  }

  const name = typeof doc.name === 'string' && doc.name.trim() !== '' ? doc.name : 'unnamed-workflow';
  return { workflowName: name, subscriptions };
}

/**
 * 校验 workflow 文本的 `on:` 声明——返回错误清单（空数组 = 通过）。
 *
 * 判据（fail-loud 拒绝，不静默丢弃）：
 *   ① workflow 可解析、nodes 存在
 *   ② `on` 形态合法（字符串 或 对象；其它形态拒绝）
 *   ③ 事件类型在注册表内（拼错 = 永不触发的静默失效）
 *   ④ `from` 指向存在的节点，且只用于 workflow.node.completed
 *   ⑤ `filter` 为扁平对象（值为字符串/数字/布尔）
 *
 * @param workflowText workflow YAML / JSON 文本
 * @returns 错误清单
 */
export function validateEventSubscriptions(workflowText: string): string[] {
  try {
    parseEventSubscriptions(workflowText);
    return [];
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
}

/** 载入 workflow 文档（兼容 `workflow:` 包裹与顶层扁平两种形态） */
function loadWorkflowDoc(workflowText: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = yaml.load(workflowText);
  } catch (err) {
    throw new Error(`[events:router] workflow YAML 解析失败：${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('[events:router] workflow 文本必须是 YAML/JSON 对象');
  }
  const root = parsed as Record<string, unknown>;
  const inner = root.workflow;
  if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return root;
}

/** 读 nodes 数组 */
function readNodes(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const nodes = doc.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error('[events:router] 找不到节点列表（workflow.nodes 必须是数组）');
  }
  return nodes.map((node, idx) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      throw new Error(`[events:router] nodes[${idx}] 不是对象`);
    }
    return node as Record<string, unknown>;
  });
}

/** 读节点 id（缺失返回 null） */
function readNodeId(node: Record<string, unknown>): string | null {
  const id = node.id;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/** 解析单条 `on:` 声明 */
function parseOneSubscription(
  nodeId: string,
  on: unknown,
  nodeIds: Set<string>,
): EventSubscription {
  // 简写形态：on: <事件类型>
  if (typeof on === 'string') {
    const event = on.trim();
    assertRegisteredEvent(nodeId, event);
    return { nodeId, event };
  }
  if (typeof on !== 'object' || on === null || Array.isArray(on)) {
    throw new Error(
      `[events:router] 节点 ${nodeId} 的 on 形态非法（应为事件类型字符串或 { event, from?, filter? } 对象；本版不支持数组/多声明）`,
    );
  }
  const decl = on as Record<string, unknown>;
  const event = typeof decl.event === 'string' ? decl.event.trim() : '';
  if (event === '') {
    throw new Error(`[events:router] 节点 ${nodeId} 的 on.event 必填且为非空字符串`);
  }
  assertRegisteredEvent(nodeId, event);

  let from: string | undefined;
  if (decl.from !== undefined) {
    if (typeof decl.from !== 'string' || decl.from.trim() === '') {
      throw new Error(`[events:router] 节点 ${nodeId} 的 on.from 必须是非空字符串（上游节点 id）`);
    }
    from = decl.from.trim();
    if (!nodeIds.has(from)) {
      throw new Error(
        `[events:router] 节点 ${nodeId} 的 on.from 指向不存在的节点「${from}」（悬空引用 = 永不触发）`,
      );
    }
    if (event !== EVENT_TYPES.NODE_OUTPUT) {
      throw new Error(
        `[events:router] 节点 ${nodeId} 的 on.from 只对 ${EVENT_TYPES.NODE_OUTPUT} 有效（当前 event=${event}）`,
      );
    }
  }

  let filter: Record<string, string | number | boolean> | undefined;
  if (decl.filter !== undefined) {
    const raw = decl.filter;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`[events:router] 节点 ${nodeId} 的 on.filter 必须是对象（键值等值过滤）`);
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0) {
      throw new Error(`[events:router] 节点 ${nodeId} 的 on.filter 为空对象（无过滤语义——删掉该字段）`);
    }
    filter = {};
    for (const [key, value] of entries) {
      const t = typeof value;
      if (t !== 'string' && t !== 'number' && t !== 'boolean') {
        throw new Error(`[events:router] 节点 ${nodeId} 的 on.filter.${key} 必须是字符串/数字/布尔`);
      }
      filter[key] = value as string | number | boolean;
    }
  }

  return {
    nodeId,
    event,
    ...(from !== undefined ? { from } : {}),
    ...(filter !== undefined ? { filter } : {}),
  };
}

/** 事件类型必须在注册表内（拼错的事件名 = 永不触发的静默失效） */
function assertRegisteredEvent(nodeId: string, event: string): void {
  if (!REGISTERED_EVENT_TYPES.includes(event)) {
    throw new Error(
      `[events:router] 节点 ${nodeId} 的 on 引用了未登记的事件类型「${event}」（已登记：${REGISTERED_EVENT_TYPES.join(' / ')}）`,
    );
  }
}

// ────────────────────────────────────────────────────────────
// 路由
// ────────────────────────────────────────────────────────────

/**
 * 事件路由器——订阅声明 → 事件匹配 → 节点执行 → 级联产出。
 */
export class EventRouter {
  private readonly bus: EventBus;
  private readonly nodeRunner?: NodeRunner;
  private readonly maxChainDepth: number;
  private readonly nodeOutput: ReturnType<typeof createNodeOutputSource>;
  private workflowName = 'unnamed-workflow';
  private subscriptions: EventSubscription[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(options: EventRouterOptions) {
    this.bus = options.bus;
    this.nodeRunner = options.nodeRunner;
    this.maxChainDepth = options.maxChainDepth ?? 32;
    this.nodeOutput = createNodeOutputSource(options.bus);
  }

  /**
   * 挂载 workflow 的订阅表（**注册点**：bus.subscribe('*') + 绑定声明）。
   *
   * 重复 attach 时先自动 detach（同一 router 只保持一份订阅）。
   *
   * @param workflowText workflow YAML/JSON 文本
   * @returns 解析出的订阅声明
   */
  attach(workflowText: string): EventSubscription[] {
    const parsed = parseEventSubscriptions(workflowText);
    this.detach();
    this.workflowName = parsed.workflowName;
    this.subscriptions = parsed.subscriptions;
    const handler: EventHandler = async (event) => {
      await this.handleEvent(event);
    };
    this.unsubscribe = this.bus.subscribe('*', handler);
    return this.subscriptions;
  }

  /** 摘下订阅（不再接收事件） */
  detach(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** 已绑定的订阅声明 */
  get boundSubscriptions(): readonly EventSubscription[] {
    return this.subscriptions;
  }

  /** 已绑定的 workflow 名 */
  get boundWorkflowName(): string {
    return this.workflowName;
  }

  /**
   * 事件 → 目标节点（纯匹配，不执行）。
   *
   * 匹配规则：事件类型相等；node-output 事件若声明了 from 必须来自该节点；
   * filter 键值全等（先查 payload 顶层字段，未命中再查 payload.body——
   * webhook 入站的字段在 body 内）。
   */
  route(event: SofagentEvent): EventRoutingTarget[] {
    const targets: EventRoutingTarget[] = [];
    for (const sub of this.subscriptions) {
      if (sub.event !== event.type) continue;
      if (sub.from !== undefined && !matchesFrom(sub, event)) continue;
      if (sub.filter !== undefined && !matchesFilter(sub.filter, event.payload)) continue;
      targets.push({ nodeId: sub.nodeId, subscription: sub });
    }
    return targets;
  }

  /**
   * 处理事件——对每个命中节点调 NodeRunner 执行，执行完成后产出
   * workflow.node.completed 事件（causationId = 本次事件 id）驱动下游。
   *
   * 失败形态：无执行器 / 执行抛错 / 链深超限 → 事件进死信（由 bus 统一
   * 记录留痕与死信条目），本函数不抛错（事件源不被下游失败拖垮）。
   */
  async handleEvent(event: SofagentEvent): Promise<RoutingOutcome> {
    const targets = this.route(event);
    const outcome: RoutingOutcome = { executed: [], matched: targets.length, failed: [] };
    if (targets.length === 0) return outcome;

    const chainDepth = readChainDepth(event);
    if (chainDepth > this.maxChainDepth) {
      this.bus.sendToDeadLetter(
        { ...event, targetNodeId: targets.map((t) => t.nodeId).join(',') },
        {
          nodeId: targets[0]!.nodeId,
          error: `事件链深度超限（${chainDepth} > ${this.maxChainDepth}）——疑似事件环，拒绝继续执行`,
          stopReason: 'aborted',
          attempts: event.attempt ?? 1,
        },
      );
      outcome.failed.push({ nodeId: targets[0]!.nodeId, error: '事件链深度超限' });
      return outcome;
    }

    if (!this.nodeRunner) {
      // fail-loud：没有执行器是可见故障（不静默丢弃事件）
      for (const target of targets) {
        console.error(
          `[events:router] 无节点执行器（未注入 NodeRunner）——事件 ${event.id}（${event.type}）无法派发到节点 ${target.nodeId}`,
        );
        this.bus.sendToDeadLetter(
          { ...event, targetNodeId: target.nodeId },
          {
            nodeId: target.nodeId,
            error: '未注入节点执行器（EventRouter 缺 nodeRunner）——事件无法派发',
            stopReason: 'failed',
            attempts: event.attempt ?? 1,
          },
        );
        outcome.failed.push({ nodeId: target.nodeId, error: '未注入节点执行器' });
      }
      return outcome;
    }

    for (const target of targets) {
      const targeted: SofagentEvent = { ...event, targetNodeId: target.nodeId };
      try {
        const result = await this.nodeRunner({
          nodeId: target.nodeId,
          event: targeted,
          subscription: target.subscription,
        });
        outcome.executed.push(target.nodeId);
        // 级联：节点产出 → 新事件（同链条，causationId 指向本次事件）
        await this.nodeOutput.emitCompletion({
          workflowId: event.workflowId ?? this.workflowName,
          nodeId: target.nodeId,
          output: result.output,
          success: result.success,
          correlationId: event.correlationId,
          causationId: event.id,
          metadata: { ...(event.metadata ?? {}), chainDepth: chainDepth + 1 },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcome.failed.push({ nodeId: target.nodeId, error: message });
        this.bus.sendToDeadLetter(targeted, {
          nodeId: target.nodeId,
          error: message,
          attempts: event.attempt ?? 1,
        });
      }
    }
    return outcome;
  }
}

/** from 约束：事件必须来自该上游节点 */
function matchesFrom(sub: EventSubscription, event: SofagentEvent): boolean {
  const payload = event.payload as { nodeId?: unknown } | null;
  return !!payload && typeof payload === 'object' && payload.nodeId === sub.from;
}

/** filter 等值匹配（payload 顶层优先，其次 payload.body——webhook 字段在 body 内） */
function matchesFilter(
  filter: Record<string, string | number | boolean>,
  payload: unknown,
): boolean {
  const top = (payload ?? {}) as Record<string, unknown>;
  const body =
    typeof top.body === 'object' && top.body !== null && !Array.isArray(top.body)
      ? (top.body as Record<string, unknown>)
      : {};
  return Object.entries(filter).every(([key, expected]) => {
    const actual = key in top ? top[key] : body[key];
    return actual === expected;
  });
}

/** 读事件链深度（metadata.chainDepth，缺省 0） */
function readChainDepth(event: SofagentEvent): number {
  const depth = event.metadata?.chainDepth;
  return typeof depth === 'number' && Number.isFinite(depth) ? depth : 0;
}
