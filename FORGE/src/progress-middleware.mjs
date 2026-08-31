// ============================================================
// progress-middleware.mjs · SubAgent 可见性 L2（v1.2.1 · P3）
// + 心跳停顿 watchdog（v1.2.4 · P0）
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
// v1.2.4 新增 stall watchdog：run-03 Round 5 在 macOS 后台被节流冻结 2h44m，
// setInterval 心跳 14 段完全静默 140 分钟，driver 零感知。watchdog 通过比对
// tick 的实际墙钟间隔检测节流/挂起，超 STALL_THRESHOLD_MS（默认 3 分钟）即
// 落 stall-detected 事件；累计达 STALL_MAX 次则抛 StallError 中止当前 agent
// 调用，由 driver 层捕获做 step 级重试。阈值可由 FORGE_STALL_THRESHOLD_MS
// 环境变量覆盖。
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
//   4. watchdog 是观测层延伸：检测/记录不阻断正常路径，仅累计到阈值时
//      通过 AbortController 中止（让 driver 知道"我被冻住了"而非无限等）
// ============================================================

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ────────────────────────────────
// StallError（v1.2.4 · watchdog 专用错误类）
// ────────────────────────────────

/**
 * StallError：心跳停顿超阈值时抛出，由 driver 捕获做 step 级重试。
 * Thrown when heartbeat stall count exceeds STALL_MAX.
 * Caught by driver for step-level retry (max 2 attempts).
 */
export class StallError extends Error {
  /**
   * @param {number} stallCount  累计停顿次数 / cumulative stall count
   * @param {number[]} gapMsArr  每次停顿间隔（毫秒）/ per-stall gap array
   */
  constructor(stallCount, gapMsArr) {
    const maxGap = Math.max(...gapMsArr);
    super(
      `[stall-watchdog] ${stallCount} stalls detected, max gap ${maxGap}ms` +
      ` — event loop frozen, aborting`
    );
    this.name = 'StallError';
    this.stallCount = stallCount;
    this.gapMsArr = gapMsArr;
  }
}

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

/** 默认 LLM 心跳间隔（毫秒） / Default heartbeat interval (ms) */
const DEFAULT_HEARTBEAT_MS = 1000;

/**
 * 读取心跳停顿检测阈值（毫秒）——默认 5 分钟。
 * 为什么 5 分钟：macOS App Nap 节流周期 ~10s，正常心跳 1s 一次，
 * 如果连续 5 分钟没有 tick，说明事件循环被冻结而非 API 慢。
 * 实测正常心跳间隔上界 176s，180s 阈值仅 4s 余量存在边缘误报，
 * 300s 远离正常上界（留 124s 余量），同时仍能捕获真实冻结。
 * 可由 FORGE_STALL_THRESHOLD_MS 环境变量覆盖。
 *
 * Stall detection threshold (ms) — default 5 min.
 * Rationale: macOS App Nap throttle cycle ~10s, normal heartbeat 1s.
 * 5 min without tick = event loop frozen, not slow API.
 * Measured normal heartbeat upper bound 176s; 300s leaves 124s margin
 * vs. only 4s with the old 180s threshold.
 * Override via FORGE_STALL_THRESHOLD_MS env var.
 *
 * 注意：在函数调用时读取（而非模块顶层），以支持测试时动态设置环境变量。
 */
function getStallThreshold() {
  return parseInt(process.env.FORGE_STALL_THRESHOLD_MS || '300000', 10);
}

/**
 * 读取累计停顿次数上限——达到后抛 StallError 中止当前 agent 调用。
 * 默认 3 次（= 9 分钟无响应），可由 FORGE_STALL_MAX 覆盖。
 *
 * Max stall count before aborting. Default 3 (= ~9 min unresponsive).
 * Override via FORGE_STALL_MAX env var.
 *
 * 注意：在函数调用时读取（而非模块顶层），以支持测试时动态设置环境变量。
 */
function getStallMax() {
  return parseInt(process.env.FORGE_STALL_MAX || '3', 10);
}

/**
 * 读取单次停顿立即中止阈值（毫秒）——默认 10 分钟。
 * 当单次心跳间隔超过此值，判定为"极端严重 stall"，立即 abort 当前调用，
 * 不等 STALL_MAX 累计。平时零噪声，仅极端场景触发。
 *
 * Immediate abort threshold for extreme single stall (ms) — default 10 min.
 * When a single heartbeat gap exceeds this, abort immediately without waiting
 * for STALL_MAX accumulation. Zero noise normally, only triggers on extremes.
 * Override via FORGE_STALL_ABORT_MS env var.
 */
function getStallAbortMs() {
  return parseInt(process.env.FORGE_STALL_ABORT_MS || '600000', 10);
}

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
    } catch (err) {
      console.error('[sofagent:forge] progress-middleware 步骤失败', err);
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
      //
      // v1.2.4 stall watchdog:
      //   setInterval 每次 tick 记录 Date.now() 到 lastTickTime。
      //   下一次 tick 对比 now - lastTickTime：若 > STALL_THRESHOLD_MS，
      //   说明中间发生了事件循环冻结（macOS App Nap / timer throttling）。
      //   累计达 STALL_MAX 次通过 AbortController 中止 handler。
      //
      //   为什么 setInterval 能检测到自己的冻结：
      //   macOS 冻结 setInterval 回调时，回调不触发，lastTickTime 停止更新。
      //   冻结解除后，setInterval 立即 catch-up 触发下一次回调，
      //   此时 Date.now() - lastTickTime = 冻结时长 + heartbeatMs，
      //   远超 STALL_THRESHOLD_MS → 检测到 stall。
      //
      //   为什么用 AbortController：setInterval 回调里 throw 会变成
      //   unhandled rejection，无法被外层 await 捕获。AbortController
      //   是 Node.js 标准中止机制，abort 信号触发 stallPromise reject。
      const controller = new AbortController();
      let lastTickTime = Date.now();
      let lastTickMono = process.hrtime.bigint();
      let stallCount = 0;
      const gapMsArr = [];
      // 在 wrapModelCall 入口处读取阈值（每次调用可独立配置，支持测试动态覆盖）
      // Read thresholds at call entry (each call can have independent config, supports test overrides)
      const STALL_THRESHOLD_MS = getStallThreshold();
      const STALL_MAX = getStallMax();
      const STALL_ABORT_MS = getStallAbortMs();

      const timer = setInterval(() => {
        try {
          const now = Date.now();
          const nowMono = process.hrtime.bigint();
          const actualGap = now - lastTickTime;
          // 双钟睡眠鉴别：墙钟（Date.now）在系统睡眠时继续走，
          // 单调钟（hrtime，mach_absolute_time）睡眠时暂停——
          // 墙钟跳变大而单调钟几乎没走 = 睡眠；两者都大 = 真冻结。
          const monoGapMs = Number(nowMono - lastTickMono) / 1e6;
          const sleptMs = Math.max(0, actualGap - monoGapMs);
          const isSleep = sleptMs > STALL_THRESHOLD_MS;

          // 发心跳事件（即使检测到 stall 也照常发——stall 已过去，心跳恢复正常）
          // Emit heartbeat (even if stall detected — stall has passed, heartbeat resumes)
          emit({ ts: new Date().toISOString(), role, event: 'llm-chunk' });

          // watchdog：检测停顿（系统睡眠不计——run-06 实证：合盖 777s 被
          // 误判 775s 冻结并 abort，worker 无辜被杀、regression.md 空文件）
          if (isSleep) {
            emit({
              ts: new Date().toISOString(),
              role,
              event: 'sleep-detected',
              gapMs: actualGap,
              sleptMs,
            });
          } else if (actualGap > STALL_THRESHOLD_MS) {
            stallCount++;
            gapMsArr.push(actualGap);

            // 落 stall-detected 事件（Dashboard 可见 / visible to Dashboard）
            emit({
              ts: new Date().toISOString(),
              role,
              event: 'stall-detected',
              gapMs: actualGap,
            });

            console.warn(
              `[watchdog] 心跳停顿 #${stallCount}: ` +
              `间隔 ${actualGap}ms > 阈值 ${STALL_THRESHOLD_MS}ms ` +
              `(${stallCount}/${STALL_MAX})`
            );

            // 自愈层：单次 stall 极端严重（>10min）立即 abort
            // Self-heal: extreme single stall (>10min) triggers immediate abort
            if (actualGap > STALL_ABORT_MS) {
              clearInterval(timer);
              console.warn(
                `[watchdog] 极端停顿: 间隔 ${actualGap}ms > 自愈阈值 ${STALL_ABORT_MS}ms，` +
                `立即 abort 当前调用`
              );
              emit({
                ts: new Date().toISOString(),
                role,
                event: 'stall-abort-immediate',
                gapMs: actualGap,
                thresholdMs: STALL_ABORT_MS,
              });
              controller.abort(new StallError(1, [actualGap]));
              return; // 退出 setInterval 回调
            }

            // 累计达上限：通过 AbortController 中止
            if (stallCount >= STALL_MAX) {
              clearInterval(timer);
              controller.abort(new StallError(stallCount, gapMsArr));
            }
          }

          lastTickTime = now;
          lastTickMono = nowMono;
        } catch (err) {
          console.error('[sofagent:forge] progress-middleware 清理失败', err);
        }
      }, heartbeatMs);

      // stallPromise：监听 AbortController 的 abort 信号，reject 触发 Promise.race
      // stallPromise: listen for abort signal, reject triggers Promise.race
      const stallPromise = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(controller.signal.reason);
        });
      });

      try {
        return await Promise.race([handler(), stallPromise]);
      } finally {
        clearInterval(timer);
      }
    },
  };
}
