// ============================================================
// dsh-events.mjs · FORGE driver 的 DSH 深化——事件订阅骨架（v1.4.0 交付八）
// ============================================================
// 场景：driver 跑 DSH 执行后端时，phase 变化由「120s 轮询」升级为「事件订阅」。
// 消费 DSH 会话事件流（notify_session 通道）——监控端订阅而非 sleep 轮询，
// 消除 120 秒盲区 + 监控 session 的 sleep 被 137 打断问题。
//
// ⚠️ 依赖边界：DSH 事件通道的实际协议（会话事件流格式/notify_session 契约）以
// DSH 运行时为准——本模块提供「订阅抽象 + 降级回轮询」骨架，DSH 通道联调后
// 在 connectDshEventStream() 内接真实事件源。
// ============================================================

/**
 * 事件订阅器——DSH 会话 phase 变化主动推送。
 * @param {object} opts
 * @param {(phase: string, payload: object) => void} opts.onPhase 阶段变化回调
 * @param {number} opts.fallbackIntervalMs 降级轮询间隔（默认 120_000，与旧协议一致）
 */
export function createDshEventSubscriber({ onPhase, fallbackIntervalMs = 120_000 } = {}) {
  let fallbackTimer = null;
  let eventSource = null;

  /** 尝试接 DSH 事件流（真实通道联调后填充——当前返回 false 走降级轮询） */
  async function connectDshEventStream() {
    // TODO(v1.4.0): DSH 会话事件流通道（notify_session 契约）实测后填充真实订阅。
    // 当前 DSH rc 期无稳定事件流协议，返回 false → 降级回轮询（行为与 v1.3.9 一致）。
    return false;
  }

  /**
   * 启动订阅：优先 DSH 事件流，失败降级 fallback 轮询（不中断监控）。
   * @param {() => string} readPhaseFn 轮询模式下读当前 phase（driver 的 status.json 读法）
   * @param {() => void} onTick 每轮轮询的额外动作（如写 heartbeat）
   */
  async function start(readPhaseFn, onTick = () => {}) {
    eventSource = await connectDshEventStream().catch(() => null);
    if (eventSource) {
      // 事件流模式：无轮询盲区（此处为骨架——真实订阅实现接入 eventSource.onPhase）
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
 * 节点级审计留痕骨架（v1.4.0 交付八）：
 * driver worker 每次工具调用在 DSH 事件流天然留痕（pre-execute + 节点归因）。
 * 本函数提供「把工具调用记入节点审计」的统一入口——DSH 事件流接入后替换为事件消费。
 */
export function recordNodeAudit(nodeId, toolCall, verdict, sink = console.log) {
  sink(`[node-audit] ${nodeId} · ${toolCall} → ${verdict}`);
}
