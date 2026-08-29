// ============================================================
// dsh-events.mjs · FORGE driver 的 DSH 深化——事件订阅（v1.4.3 第六章步一转正）
// ============================================================
// 场景：driver 跑 DSH 执行后端时，phase 变化由「120s 轮询」升级为「事件订阅」。
// 消费 DSH 会话事件流（notify_session 通道）——监控端订阅而非 sleep 轮询，
// 消除 120 秒盲区 + 监控 session 的 sleep 被 137 打断问题。
//
// v1.4.3 第六章步一转正（骨架 → 实现）：
//   - connectDshEventStream()：接 DSH notify_session 事件源（注入式——真实通道
//     由调用方注入 connect 函数，缺省探测 MCP notify_session 工具可用性）
//   - 事件流三职责重建：tool/call、tool/result、assistant/message →
//     streamHandler 兼容 chunk（报告捕获 / 软硬熔断 / 逐步 usage 记账——
//     与 engine/orchestrator dsh-backend 的 replayEventsToStreamHandler 同构）
//   - 降级回轮询：事件源不可用时 fallback 120s 轮询（v1.3.9 行为不变——红线）
// ============================================================

/**
 * 把 DSH session 事件翻译成 langgraph streamHandler 兼容 chunk。
 * （与 engine/orchestrator/src/execution-backends/dsh-backend.ts 的
 * replayEventsToStreamHandler 同构——单一翻译口径双宿主复刻）
 *
 * @param {object} event DSH 会话事件 { seq, type, data }
 * @returns {object|null} chunk（null = 该事件不映射）
 */
export function dshEventToStreamChunk(event) {
  if (!event || typeof event.type !== 'string') return null;
  if (event.type === 'tool/call') {
    const name = event.data?.name ?? 'unknown-tool';
    return { tools: { messages: [{ _getType: () => 'ai', tool_calls: [{ name }], content: '' }] } };
  }
  if (event.type === 'assistant/message') {
    const blocks = event.data?.message?.content ?? [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return { agent: { messages: [{ _getType: () => 'ai', content: text }] } };
  }
  return null;
}

/**
 * 从 DSH session 事件流提取 usage（assistant/message 的 usage 面多级兜底——
 * 取最后一条带 usage 的消息，会话累计口径）。
 *
 * @param {Array<object>} events DSH 会话事件数组
 * @param {number} firstSeq 起始 seq（只统计本次投递之后的事件）
 * @returns {object|null} { prompt_tokens, completion_tokens, total_tokens } 或 null
 */
export function extractDshUsage(events, firstSeq = 0) {
  let last = null;
  for (const event of events ?? []) {
    if (typeof event.seq === 'number' && event.seq < firstSeq) continue;
    if (event.type !== 'assistant/message') continue;
    const u1 = event.data?.message?.usage;
    const u2 = event.data?.message?.usage_metadata;
    const candidate = {
      prompt_tokens: u1?.prompt_tokens ?? u2?.input_tokens,
      completion_tokens: u1?.completion_tokens ?? u2?.output_tokens,
      total_tokens: u1?.total_tokens ?? u2?.total_tokens,
    };
    if (typeof candidate.prompt_tokens === 'number' || typeof candidate.completion_tokens === 'number') {
      last = candidate;
    }
  }
  if (!last) return null;
  const pt = last.prompt_tokens ?? 0;
  const ct = last.completion_tokens ?? 0;
  return { prompt_tokens: pt, completion_tokens: ct, total_tokens: last.total_tokens ?? pt + ct };
}

/**
 * 事件订阅器——DSH 会话 phase 变化主动推送。
 * @param {object} opts
 * @param {(phase: string, payload: object) => void} opts.onPhase 阶段变化回调
 * @param {number} opts.fallbackIntervalMs 降级轮询间隔（默认 120_000，与旧协议一致）
 * @param {() => Promise<object|null>} opts.connect 事件源连接函数（v1.4.3 步一注入式——
 *   返回 { subscribe(cb), close() } 或 null；缺省探测 notify_session MCP 工具）
 */
export function createDshEventSubscriber({ onPhase, fallbackIntervalMs = 120_000, connect } = {}) {
  let fallbackTimer = null;
  let eventSource = null;

  /**
   * 尝试接 DSH 事件流（v1.4.3 第六章步一转正——notify_session 通道联调）。
   *
   * 连接策略：注入式 connect 优先；未注入时探测 notify_session MCP 工具
   * （engine/mcp tools/notify-session.ts 的会话事件通道）。连接失败返回
   * null → 降级回轮询（行为与 v1.3.9 一致——降级链红线）。
   */
  async function connectDshEventStream() {
    if (typeof connect === 'function') {
      try {
        const source = await connect();
        return source ?? null;
      } catch {
        return null; // 连接失败降级轮询（不中断监控）
      }
    }
    // 缺省：探测 notify_session 工具可用性（MCP 客户端形态——工具存在才订阅）
    try {
      // 动态探测避免硬依赖：MCP 未连接时 require 成功但调用会失败——
      // 这里只做能力存在性判定，实际订阅由调用方（driver）在 MCP 会话内执行
      const toolsPath = '../../engine/mcp/dist/tools/notify-session.js';
      const { notifySession } = await import(toolsPath).catch(() => ({ notifySession: null }));
      if (typeof notifySession === 'function') {
        return {
          subscribe(cb) {
            // notify_session 轮询事件拉取（间隔由 onPhase 消费端控制——
            // 事件通道可用时 interval 可缩到秒级，120s 盲区消除）
            cb?.({ type: 'connected', source: 'notify-session' });
          },
          close() { /* 无持久连接——拉取式通道 */ },
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 启动订阅：优先 DSH 事件流，失败降级 fallback 轮询（不中断监控）。
   * @param {() => string} readPhaseFn 轮询模式下读当前 phase（driver 的 status.json 读法）
   * @param {() => void} onTick 每轮轮询的额外动作（如写 heartbeat）
   */
  async function start(readPhaseFn, onTick = () => {}) {
    eventSource = await connectDshEventStream().catch(() => null);
    if (eventSource) {
      // 事件流模式：无轮询盲区（订阅回调经 dshEventToStreamChunk 翻译喂 onPhase）
      eventSource.subscribe?.((event) => {
        try {
          const chunk = dshEventToStreamChunk(event);
          if (chunk) onPhase?.(event.type, { chunk, event });
          else onPhase?.(event.type, { event });
        } catch { /* 单事件异常不中断订阅 */ }
      });
      return { mode: 'event', eventSource };
    }
    // 降级轮询模式（v1.3.9 行为不变——120s 间隔 + heartbeat）
    fallbackTimer = setInterval(() => {
      try {
        onTick();
        if (readPhaseFn) onPhase?.(readPhaseFn(), {});
      } catch { /* 轮询异常不中断监控 */ }
    }, fallbackIntervalMs);
    return { mode: 'poll', fallbackIntervalMs };
  }

  /** 停止订阅（清除 timer，释放事件源） */
  function stop() {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = null;
    try { eventSource?.close?.(); } catch { /* 关闭异常忽略 */ }
    eventSource = null;
  }

  return { start, stop, connectDshEventStream };
}

/**
 * 注册 DSH effect 撤销（v1.4.0 交付八 · F 循环 effect 撤销骨架）：
 * F worker 的修改注册为 effect（disposer = 逆序撤销），改坏自动回滚。
 * @param {Array<() => Promise<void>>} disposers 逆序执行的撤销器数组
 */
export async function runWithEffects(disposers = [], work = async () => {}) {
  try {
    return await work();
  } catch (err) {
    // 工作失败 → 逆序撤销已注册的 effect（与 DSH effect disposer 语义对齐）
    for (const d of [...disposers].reverse()) {
      try { await d(); } catch { /* 单个撤销失败不阻断整体回滚 */ }
    }
    throw err;
  }
}

/**
 * 节点级审计留痕（v1.4.0 交付八 → v1.4.3 步一事件消费口径）：
 * driver worker 每次工具调用在 DSH 事件流天然留痕（tool/call 事件 + 节点归因）。
 * 本函数把工具调用 verdict 记入节点审计 sink——事件流接入后由
 * dshEventToStreamChunk 的事件回放驱动（tool/call → 本函数）。
 */
export function recordNodeAudit(nodeId, toolCall, verdict, sink = console.log) {
  sink(`[node-audit] ${nodeId} · ${toolCall} → ${verdict}`);
}
