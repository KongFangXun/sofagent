// ============================================================
// progress-middleware.mjs · SubAgent 可见性 L2（v1.2.1 · P3）
// ============================================================
// L1（driver 层 progress.jsonl + status.json）已交付，但 worker（SubAgent）
// 内部是黑盒——A 正在读哪些文件、B 正在改哪行、模型推理是否卡死，driver
// 在 worker 退出前完全不可见。L2 用 middleware 机制在 worker 内部埋点，
// 往 <roundDir>/sub-progress-<role>.jsonl 追加微事件：
//
//   {"ts":"...","role":"A","tool":"sf_read","target":"README.md","phase":"start"}
//   {"ts":"...","role":"A","tool":"sf_read","target":"README.md","phase":"end","duration":120}
//   {"ts":"...","role":"B","event":"llm-chunk"}
//
// 文件格式说明（v1.2.1）：本文件是 .mjs 而非 .ts——fresh-eyes-driver.mjs
// 在裸 node（>=18）下运行，无法 import TypeScript；vitest 解析
// '../progress-middleware' 时 .mjs 扩展名优先命中，测试契约不受影响。
//
// 路径说明（v1.2.1 数据目录重构）：roundDir 由 driver 注入，v1.2.1 起
// 位于 data/forge-runs/（原 FORGE/SKILL/fresh-eyes-loop/runs/）——
// 本文件不自行解析路径，roundDir 是唯一事实来源。
//
// 设计铁律（与 L1 visibility 一致）：
//   1. 事件即调即写——不攒批（Dashboard 靠事件时间戳判断 worker 心跳）
//   2. middleware 自身任何异常（磁盘写失败等）不得阻断 worker 主流程
//   3. 工具 handler 抛错时 end 事件仍落盘（start/end 严格配对），原错误上抛
// ============================================================

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ────────────────────────────────
// 类型约定（JSDoc）
// ────────────────────────────────

/**
 * @typedef {Object} ProgressMiddlewareOptions
 * @property {string} roundDir      本轮目录（sub-progress-<role>.jsonl 写在这里）
 * @property {string} role          worker 角色标识（'A' | 'B'）
 * @property {number} [heartbeatMs] LLM 心跳间隔（毫秒），默认 1000
 */

/**
 * @typedef {Object} ToolCallRequest
 * @property {string} tool                    工具名（sf_read / sf_write / sf_edit / ls / glob / grep ...）
 * @property {Record<string, unknown>} [args] 工具参数（target 从 args.path 等提取）
 */

/**
 * @typedef {Object} ProgressMiddleware
 * @property {string} name  middleware 名称
 * @property {(request: ToolCallRequest, handler: () => unknown | Promise<unknown>) => Promise<unknown>} wrapToolCall
 *   包工具调用：写 start 事件 → 执行 handler → 写 end 事件（含 duration）
 *   → 返回 handler 结果；handler 抛错时 end 仍写 + 原错误上抛
 * @property {(request: unknown, handler: () => Promise<unknown>) => Promise<unknown>} wrapModelCall
 *   包模型调用：handler 执行期间按 heartbeatMs 间隔写 llm-chunk 心跳事件
 */

/** 默认 LLM 心跳间隔（毫秒） */
const DEFAULT_HEARTBEAT_MS = 1000;

// ────────────────────────────────
// 内部实现
// ────────────────────────────────

/**
 * 从工具参数中提取 target（文件路径 / 搜索模式 / 命令）。
 * 非字符串值序列化为 JSON；无可用字段时返回 undefined（事件缺省 target 键）。
 *
 * @param {Record<string, unknown> | undefined} args
 * @returns {string | undefined}
 */
function extractTarget(args) {
  if (!args) return undefined;
  const candidate = args.path ?? args.pattern ?? args.command ?? args.file;
  if (candidate === undefined || candidate === null) return undefined;
  return typeof candidate === 'string' ? candidate : JSON.stringify(candidate);
}

// ────────────────────────────────
// 公开工厂
// ────────────────────────────────

/**
 * 创建 SubAgent 进度埋点 middleware。
 *
 * @param {ProgressMiddlewareOptions} options
 * @returns {ProgressMiddleware}
 */
export function createProgressMiddleware(options) {
  const { roundDir, role } = options;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const eventFile = join(roundDir, `sub-progress-${role}.jsonl`);

  /**
   * 追加一条事件到 jsonl——即调即写。
   * 任何写失败（磁盘满 / EISDIR / 权限）都静默吞掉：
   * middleware 是观测层，绝不能把异常抛给 worker 主流程。
   */
  function emit(event) {
    try {
      mkdirSync(roundDir, { recursive: true });
      appendFileSync(eventFile, `${JSON.stringify(event)}\n`, 'utf-8');
    } catch {
      // 观测层写失败不阻断主流程
    }
  }

  /** 工具事件骨架（ts/role/tool 必填，target 可选） */
  function toolEvent(request, phase, duration) {
    const event = {
      ts: new Date().toISOString(),
      role,
      tool: request.tool,
      phase,
    };
    const target = extractTarget(request.args);
    if (target !== undefined) event.target = target;
    if (duration !== undefined) event.duration = duration;
    return event;
  }

  return {
    name: `sofagent-progress-${role}`,

    async wrapToolCall(request, handler) {
      emit(toolEvent(request, 'start'));
      const startedAt = Date.now();
      try {
        // handler 可同步可异步——统一走 Promise 语义
        const result = await handler();
        emit(toolEvent(request, 'end', Date.now() - startedAt));
        return result;
      } catch (err) {
        // end 事件仍落盘（配对完整性），原错误不吞、原样上抛
        emit(toolEvent(request, 'end', Date.now() - startedAt));
        throw err;
      }
    },

    async wrapModelCall(_request, handler) {
      // 心跳意义是「推理没卡死」——长推理零心跳 = Dashboard 误判卡死。
      // 心跳回调内任何异常都不得影响 interval 与 handler。
      const timer = setInterval(() => {
        emit({ ts: new Date().toISOString(), role, event: 'llm-chunk' });
      }, heartbeatMs);
      try {
        return await handler();
      } finally {
        clearInterval(timer);
      }
    },
  };
}
