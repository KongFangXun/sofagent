// ============================================================
// TDD_PRE_CODE: 此测试文件在功能代码编写之前创建
// 预期：所有测试当前 FAIL（被测模块 FORGE/src/progress-middleware.ts 尚不存在，
//       import 即失败——这是 TDD Red 的正常起点）。
// 工程师铁律：严禁修改此测试文件中的任何断言和测试用例。
//
// progress-middleware.test.ts · SubAgent 可见性 L2（v1.2.1 · P3）
//
// 🔴 TDD Red — 功能未实现，预期全部 FAIL。
//
// 背景：L1（driver 层 progress.jsonl + status.json）已交付，但 worker（SubAgent）
//   内部是黑盒——A 正在读哪些文件、B 正在改哪行、模型推理是否卡死，driver 不可见。
//   L2 用 middleware 机制在 worker 内部埋点，写 sub-progress-<role>.jsonl。
//
// 被测契约（本测试文件即规格——工程师按此实现 FORGE/src/progress-middleware.ts）：
//
//   export interface ProgressMiddlewareOptions {
//     roundDir: string;      // 本轮目录（sub-progress-<role>.jsonl 写在这里）
//     role: string;          // worker 角色标识（'A' | 'B'）
//     heartbeatMs?: number;  // LLM 心跳间隔，默认 1000
//   }
//
//   export interface ToolCallRequest {
//     tool: string;                        // 工具名（sf_read / sf_write / sf_edit / ls / glob / grep ...）
//     args?: Record<string, unknown>;      // 工具参数（target 从 args.path 等提取）
//   }
//
//   export interface ProgressMiddleware {
//     name: string;                        // middleware 名称（非空字符串）
//     // 包工具调用：写 start 事件 → 执行 handler → 写 end 事件（含 duration）→ 返回 handler 结果
//     wrapToolCall(request: ToolCallRequest, handler: () => unknown | Promise<unknown>): Promise<unknown>;
//     // 包模型调用：handler 执行期间按 heartbeatMs 间隔写 llm-chunk 心跳事件
//     wrapModelCall(request: unknown, handler: () => Promise<unknown>): Promise<unknown>;
//   }
//
//   export function createProgressMiddleware(options: ProgressMiddlewareOptions): ProgressMiddleware;
//
//   事件文件：<roundDir>/sub-progress-<role>.jsonl，每行一个 JSON：
//     {"ts":"...","role":"A","tool":"sf_read","target":"README.md","phase":"start"}
//     {"ts":"...","role":"A","tool":"sf_read","target":"README.md","phase":"end","duration":120}
//     {"ts":"...","role":"B","event":"llm-chunk","tokens":523}
//
//   行为规格（来自 changelog v1.2.1 验收标准 + 主理人任务表）：
//     1. worker 启动后 3 秒内 sub-progress-<role>.jsonl 出现 ≥1 条事件
//     2. sf_read/sf_write/sf_edit 每次调用产生 start+end 两条（配对、有序、end 含 duration）
//     3. 模型推理期间每 ~1s ≥1 条 llm-chunk 心跳事件
//     4. middleware 自身抛错（如磁盘写失败）不得阻断 worker 主流程
//     5. 工具 handler 抛错时 end 事件仍要落盘，原错误向上传播（配对完整性 + 不吞异常）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// 🔴 被测模块尚不存在——import 失败即 TDD Red 起点
import { createProgressMiddleware } from '../progress-middleware';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

function tmpRoundDir(): string {
  const dir = join(tmpdir(), `sofagent-l2-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 读取 sub-progress-<role>.jsonl 并逐行解析为事件对象数组 */
function readEvents(roundDir: string, role: string): Array<Record<string, unknown>> {
  const file = join(roundDir, `sub-progress-${role}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ════════════════════════════════════════
// Tests
// ════════════════════════════════════════

describe('ProgressMiddleware · SubAgent 可见性 L2（v1.2.1 P3）', () => {
  let roundDir: string;

  beforeEach(() => {
    roundDir = tmpRoundDir();
  });

  afterEach(() => {
    rmSync(roundDir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────
  // 用例 1 · worker 启动后 3s 内出现首条事件
  // ────────────────────────────────────────

  // 测试：middleware 创建并完成首次工具调用后，sub-progress-A.jsonl 必须在
  //       3 秒内出现 ≥1 条事件——Dashboard 靠这个判断 "worker 活着且在干活"。
  // 输入：createProgressMiddleware({roundDir, role:'A'}) + 一次 wrapToolCall
  // 预期：文件存在、非空，且首条事件 ts 与 middleware 创建时间的间隔 ≤ 3000ms。
  // 边界：单测中调用是即时的，3s 上限防的是"延迟初始化/批量缓冲"类错误实现——
  //       事件必须即调即写，不允许攒批。
  it('testProgressMiddleware_workerStart_firstEventAppearsWithin3s', async () => {
    const createdAt = Date.now();
    const mw = createProgressMiddleware({ roundDir, role: 'A' });

    await mw.wrapToolCall({ tool: 'sf_read', args: { path: 'README.md' } }, () => 'file-content');

    const file = join(roundDir, 'sub-progress-A.jsonl');
    expect(existsSync(file)).toBe(true);
    const events = readEvents(roundDir, 'A');
    expect(events.length).toBeGreaterThanOrEqual(1);

    const firstTs = new Date(String(events[0].ts)).getTime();
    expect(Number.isNaN(firstTs)).toBe(false);
    expect(firstTs - createdAt).toBeLessThanOrEqual(3000);
  });

  // ────────────────────────────────────────
  // 用例 2 · 工具调用 start+end 配对
  // ────────────────────────────────────────

  // 测试：sf_read / sf_write / sf_edit 每次调用必须产生 start+end 两条事件——
  //       3 次调用共 6 条，按调用顺序 start→end 交替，end 事件含 duration ≥ 0。
  // 输入：依次 wrapToolCall(sf_read) / wrapToolCall(sf_write) / wrapToolCall(sf_edit)
  // 预期：每个工具恰有 1 条 start + 1 条 end，且 start 在对应 end 之前；
  //       start/end 的 tool 名一致；target 从 args.path 提取。
  // 覆盖：changelog 验收标准——"工具调用事件完整性"。
  it('testProgressMiddleware_toolCalls_produceOrderedStartEndPairs', async () => {
    const mw = createProgressMiddleware({ roundDir, role: 'A' });

    await mw.wrapToolCall({ tool: 'sf_read', args: { path: 'README.md' } }, () => 'r');
    await mw.wrapToolCall({ tool: 'sf_write', args: { path: 'a.ts' } }, () => 'w');
    await mw.wrapToolCall({ tool: 'sf_edit', args: { path: 'b.ts' } }, () => 'e');

    const events = readEvents(roundDir, 'A');
    expect(events).toHaveLength(6);

    for (const tool of ['sf_read', 'sf_write', 'sf_edit']) {
      const toolEvents = events.filter((e) => e.tool === tool);
      expect(toolEvents).toHaveLength(2);
      // start 在 end 之前（事件数组即时间序）
      expect(toolEvents[0].phase).toBe('start');
      expect(toolEvents[1].phase).toBe('end');
      // end 事件携带耗时
      expect(typeof toolEvents[1].duration).toBe('number');
      expect(toolEvents[1].duration as number).toBeGreaterThanOrEqual(0);
      // target 从 args.path 提取
      expect(toolEvents[0].target).toBeDefined();
    }

    // 全局顺序：3 组 start→end 依调用顺序排列
    expect(events.map((e) => e.phase)).toEqual([
      'start', 'end', 'start', 'end', 'start', 'end',
    ]);
  });

  // ────────────────────────────────────────
  // 用例 3 · LLM 推理心跳
  // ────────────────────────────────────────

  // 测试：模型推理期间，每 ~heartbeatMs 至少产生 1 条 llm-chunk 心跳事件——
  //       一次 ~260ms 的推理（heartbeatMs=50）应产生 ≥2 条心跳。
  // 输入：wrapModelCall(req, handler)，handler sleep 260ms
  // 预期：≥2 条 event==='llm-chunk' 的记录，且 handler 的返回值原样返回。
  // 覆盖：changelog 验收标准——"LLM chunk 事件：推理期间每 ~1s 至少 1 条"。
  // 边界：心跳意义是"推理没卡死"——长推理零心跳 = Dashboard 误判卡死。
  it('testProgressMiddleware_modelCall_emitsHeartbeatChunksDuringInference', async () => {
    const mw = createProgressMiddleware({ roundDir, role: 'A', heartbeatMs: 50 });

    const result = await mw.wrapModelCall({}, async () => {
      await sleep(260);
      return 'llm-final-answer';
    });

    // handler 结果原样透传
    expect(result).toBe('llm-final-answer');

    const events = readEvents(roundDir, 'A');
    const chunks = events.filter((e) => e.event === 'llm-chunk');
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // 每条心跳都带 ts + role（心跳的消费者是"最后一条事件的时间戳"）
    for (const chunk of chunks) {
      expect(chunk.ts).toBeDefined();
      expect(chunk.role).toBe('A');
    }
  }, 10_000);

  // ────────────────────────────────────────
  // 用例 4 · middleware 抛错不阻断 worker 主流程
  // ────────────────────────────────────────

  // 测试：事件写入失败（模拟磁盘错误——把 sub-progress-A.jsonl 预建为目录，
  //       使追加写必抛 EISDIR）时，wrapToolCall 不得把异常抛给 worker，
  //       handler 必须照常执行并返回结果。
  // 输入：roundDir 内预建目录 sub-progress-A.jsonl → 写事件必失败
  // 预期：wrapToolCall resolve 且返回 handler 结果 'tool-result'，不 throw。
  // 覆盖：changelog 验收标准——"容错：middleware 抛错不阻断 worker 主流程（与 L1 一致）"。
  it('testProgressMiddleware_writeFailure_doesNotBlockWorkerMainFlow', async () => {
    // 构造必坏的写入路径：同名目录让 appendFileSync 抛 EISDIR/EPERM
    mkdirSync(join(roundDir, 'sub-progress-A.jsonl'));

    const mw = createProgressMiddleware({ roundDir, role: 'A' });
    let handlerRan = false;

    const result = await mw.wrapToolCall({ tool: 'sf_edit', args: { path: 'x.ts' } }, () => {
      handlerRan = true;
      return 'tool-result';
    });

    expect(handlerRan).toBe(true);
    expect(result).toBe('tool-result');
  });

  // ────────────────────────────────────────
  // 用例 5 · 事件 schema 完整性
  // ────────────────────────────────────────

  // 测试：写入 jsonl 的每一行必须是合法 JSON，且工具事件具备
  //       ts（可解析时间）/ role / tool / phase('start'|'end') 四个必填字段。
  // 输入：两次工具调用 → 预期：4 行全部 JSON 可解析、字段齐全、role 正确。
  // 边界：jsonl 是 L3 Dashboard 的消费接口——schema 漂移会让下游解析崩。
  it('testProgressMiddleware_eventSchema_eachLineValidJsonWithRequiredFields', async () => {
    const mw = createProgressMiddleware({ roundDir, role: 'B' });

    await mw.wrapToolCall({ tool: 'grep', args: { pattern: 'TODO' } }, () => 'g');
    await mw.wrapToolCall({ tool: 'ls', args: { path: '.' } }, () => 'l');

    const file = join(roundDir, 'sub-progress-B.jsonl');
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(4);

    for (const line of lines) {
      // JSON.parse 抛错即测试失败——每行必须合法
      const event = JSON.parse(line) as Record<string, unknown>;
      expect(event.ts).toBeDefined();
      expect(Number.isNaN(new Date(String(event.ts)).getTime())).toBe(false);
      expect(event.role).toBe('B');
      expect(typeof event.tool).toBe('string');
      expect(['start', 'end']).toContain(event.phase);
    }
  });

  // ────────────────────────────────────────
  // 用例 6 · 双 worker 文件隔离
  // ────────────────────────────────────────

  // 测试：role='B' 的 middleware 必须写 sub-progress-B.jsonl，
  //       且不得碰 sub-progress-A.jsonl——双 agent 各有独立事件流，
  //       Dashboard 按文件区分 A/B 心跳。
  // 输入：createProgressMiddleware({role:'B'}) + 一次工具调用
  // 预期：sub-progress-B.jsonl 存在且事件 role==='B'；sub-progress-A.jsonl 不存在。
  it('testProgressMiddleware_roleB_writesRoleBFileOnly', async () => {
    const mw = createProgressMiddleware({ roundDir, role: 'B' });
    await mw.wrapToolCall({ tool: 'sf_read', args: { path: 'CHANGELOG.md' } }, () => 'r');

    expect(existsSync(join(roundDir, 'sub-progress-B.jsonl'))).toBe(true);
    expect(existsSync(join(roundDir, 'sub-progress-A.jsonl'))).toBe(false);

    const events = readEvents(roundDir, 'B');
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const e of events) {
      expect(e.role).toBe('B');
    }
  });

  // ────────────────────────────────────────
  // 用例 7 · 工具 handler 抛错：end 事件仍落盘 + 原错误传播
  // ────────────────────────────────────────

  // 测试：被包装的工具 handler 自身抛错时，middleware 仍要写 end 事件
  //       （保证 start/end 严格配对——否则 Dashboard 显示一个永远"进行中"的工具），
  //       同时把原始错误原样向上抛给 worker（不吞异常、不伪装成功）。
  // 输入：handler throw new Error('tool exploded')
  // 预期：wrapToolCall reject 且 message 含 'tool exploded'；
  //       jsonl 中该工具有 1 start + 1 end（配对完整）。
  it('testProgressMiddleware_toolHandlerThrows_endEventStillWritten_errorPropagates', async () => {
    const mw = createProgressMiddleware({ roundDir, role: 'A' });

    await expect(
      mw.wrapToolCall({ tool: 'sf_write', args: { path: 'boom.ts' } }, () => {
        throw new Error('tool exploded');
      }),
    ).rejects.toThrow('tool exploded');

    const events = readEvents(roundDir, 'A');
    const toolEvents = events.filter((e) => e.tool === 'sf_write');
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0].phase).toBe('start');
    expect(toolEvents[1].phase).toBe('end');
  });
});
