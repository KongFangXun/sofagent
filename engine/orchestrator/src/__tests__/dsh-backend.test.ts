// dsh-backend.test.ts · v1.3.6 交付⑤ 测试
//
// 覆盖：
// 1. convertTools 三段式转换（define 段模型可见 / execute 段保 wrapper / 防御式过滤）
// 2. 预算守卫 + waterfall next() 纪律（soft 透传 / hard 中断）
// 3. createDshBackend 入口校验（缺 Context 抛错）
// 4. Trajectory 采集 PoC（事件落记录 / flush JSONL / failure-log 同步消费）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  convertTools,
  createBudgetGuard,
  createBudgetPlugin,
  createDshBackend,
  ToolBudgetExhaustedError,
  type CordisRuntime,
} from '../execution-backends/dsh-backend.js';
import { createTrajectoryCollector } from '../execution-backends/trajectory.js';
import { readFailureLog } from '../instinct/failure-log.js';

// ────────────────────────────────────────────────────────────
// 假 Cordis 运行时（duck-typing 最小实现）
// ────────────────────────────────────────────────────────────

function createFakeRuntime() {
  const onListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const waterfallListeners = new Map<
    string,
    Array<(data: unknown, next: (d: unknown) => void) => void>
  >();
  const plugins: Array<(ctx: CordisRuntime) => unknown> = [];
  let disposed = false;

  const ctx: CordisRuntime & {
    emit: (event: string, ...args: unknown[]) => void;
    emitWaterfall: (event: string, data: unknown) => unknown;
    runPlugins: () => void;
    wasDisposed: () => boolean;
  } = {
    plugin(p) {
      plugins.push(p);
    },
    on(event, listener) {
      if (!onListeners.has(event)) onListeners.set(event, []);
      onListeners.get(event)!.push(listener);
      return () => {
        const arr = onListeners.get(event);
        if (arr) onListeners.set(event, arr.filter((l) => l !== listener));
      };
    },
    waterfall(event, listener) {
      if (!waterfallListeners.has(event)) waterfallListeners.set(event, []);
      waterfallListeners.get(event)!.push(listener);
      return () => {
        const arr = waterfallListeners.get(event);
        if (arr) waterfallListeners.set(event, arr.filter((l) => l !== listener));
      };
    },
    dispose() {
      disposed = true;
    },
    emit(event, ...args) {
      for (const l of onListeners.get(event) ?? []) l(...args);
    },
    emitWaterfall(event, data) {
      let current = data;
      for (const l of waterfallListeners.get(event) ?? []) {
        l(current, (d) => {
          current = d;
        });
      }
      return current;
    },
    runPlugins() {
      for (const p of plugins) p(ctx);
    },
    wasDisposed: () => disposed,
  };
  return ctx;
}

describe('convertTools 三段式转换', () => {
  it('func 型工具（ExecutableTool 形状）转三段式且 execute 保 wrapper', () => {
    const calls: string[] = [];
    const tools = [
      {
        name: 'sf_read',
        description: '读文件',
        schema: { type: 'object', properties: { path: { type: 'string' } } },
        // 模拟被 audit wrapper 包裹——wrapper 语义必须保留
        func: (input: Record<string, unknown>) => {
          calls.push(`wrapped:${String(input.path)}`);
          return 'content';
        },
      },
    ];
    const defs = convertTools(tools);
    expect(defs).toHaveLength(1);
    // define 段（模型可见）
    expect(defs[0].name).toBe('sf_read');
    expect(defs[0].description).toBe('读文件');
    expect(defs[0].parameters).toEqual({ type: 'object', properties: { path: { type: 'string' } } });
    // execute 段（宿主私有）——原样引用保 wrapper
    const out = defs[0].execute({ path: '/tmp/a' });
    expect(out).toBe('content');
    expect(calls).toEqual(['wrapped:/tmp/a']);
    // output 段渲染
    expect(defs[0].output?.render?.({ k: 1 })).toBe('{"k":1}');
    expect(defs[0].output?.render?.('plain')).toBe('plain');
  });

  it('invoke 型工具（LangGraph ToolInterface 形状）同样可转换', () => {
    const defs = convertTools([
      { name: 'task_worker', description: '', invoke: () => 'done' },
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0].execute({})).toBe('done');
    // schema 缺失 → 空对象签名兜底
    expect(defs[0].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('防御式过滤：无名 / 无执行体的工具不注册', () => {
    const defs = convertTools([
      { description: '没有名字' },
      { name: 'no-executor', description: '没有执行体' },
      null,
    ]);
    expect(defs).toHaveLength(0);
  });
});

describe('预算守卫 + waterfall next() 纪律', () => {
  it('soft 判定不中断——waterfall 必须 next(data) 透传（头号坑防御）', () => {
    const guard = createBudgetGuard({ softLimit: 2, hardLimit: 4 });
    const softCounts: number[] = [];
    const ctx = createFakeRuntime();
    ctx.plugin(createBudgetPlugin(guard, (c) => softCounts.push(c)));
    ctx.runPlugins();

    // 前两次调用：ok 与 soft——数据必须透传（emitWaterfall 返回原数据）
    expect(ctx.emitWaterfall('tools/pre-execute', { name: 't1' })).toEqual({ name: 't1' });
    expect(ctx.emitWaterfall('tools/pre-execute', { name: 't2' })).toEqual({ name: 't2' });
    expect(softCounts).toEqual([2]); // 第二次达 softLimit 触发回调
  });

  it('hard 熔断抛 ToolBudgetExhaustedError 且不透传（next 未调=管道中断）', () => {
    const guard = createBudgetGuard({ softLimit: 1, hardLimit: 2 });
    const ctx = createFakeRuntime();
    ctx.plugin(createBudgetPlugin(guard));
    ctx.runPlugins();

    ctx.emitWaterfall('tools/pre-execute', { name: 't1' }); // 第 1 次 ok
    // 第 2 次撞 hardLimit——监听器抛错，waterfall 链条中断
    expect(() => ctx.emitWaterfall('tools/pre-execute', { name: 't2' })).toThrow(
      ToolBudgetExhaustedError,
    );
  });

  it('无预算配置 → 恒 ok 零计数', () => {
    const guard = createBudgetGuard(undefined);
    expect(guard.check()).toBe('ok');
    expect(guard.count()).toBe(0);
  });
});

describe('createDshBackend 入口校验', () => {
  it('缺 Context 构造器抛错（真实入口是 new Context()）', () => {
    expect(() => createDshBackend({} as never)).toThrow(/Context/);
  });
});

describe('Trajectory 采集 PoC', () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'traj-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('订阅事件域 → 全链记录（turn/tool 两层）', () => {
    const collector = createTrajectoryCollector({ agentId: 'test-agent' });
    const ctx = createFakeRuntime();
    ctx.plugin(collector.plugin);
    ctx.runPlugins();

    ctx.emit('agent/turn-started', { turnId: 1 });
    ctx.emit('tools/pre-execute', { name: 'sf_read', args: { path: '/a' } });
    ctx.emit('tools/result', { name: 'sf_read', output: 'ok' });
    ctx.emit('agent/turn-stopped', { output: 'done' });

    expect(collector.records).toHaveLength(4);
    expect(collector.records[0].kind).toBe('turn');
    expect(collector.records[1].kind).toBe('tool');
    expect(collector.records.every((r) => r.agentId === 'test-agent')).toBe(true);
  });

  it('flush 落 JSONL（reward 样本格式，一行一条）', () => {
    const collector = createTrajectoryCollector({ agentId: 'flush-test' });
    const ctx = createFakeRuntime();
    ctx.plugin(collector.plugin);
    ctx.runPlugins();
    ctx.emit('tools/result', { name: 'run_bash', output: 'ok' });

    const file = collector.flush(dataDir);
    expect(file).toBeTruthy();
    const lines = readFileSync(file!, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.kind).toBe('tool');
    expect(parsed.data.name).toBe('run_bash');
  });

  it('空记录不落盘返回 null', () => {
    const collector = createTrajectoryCollector({ agentId: 'empty' });
    expect(collector.flush(dataDir)).toBeNull();
  });

  it('失败轨迹 → failure-log 同步消费（source=trajectory）', () => {
    const collector = createTrajectoryCollector({ agentId: 'fail-test' });
    const ctx = createFakeRuntime();
    ctx.plugin(collector.plugin);
    ctx.runPlugins();

    // 工具失败（error 字段）+ 轮次零产出（空转负样本）
    ctx.emit('tools/result', { name: 'run_bash', error: 'permission denied' });
    ctx.emit('agent/turn-stopped', { output: '' });

    const written = collector.consumeFailure(dataDir);
    expect(written).toBe(2);

    const log = readFailureLog(dataDir);
    expect(log).toHaveLength(2);
    expect(log[0].source).toBe('trajectory');
    expect(log[0].pattern).toBe('tool-failure:run_bash');
    expect(log[1].pattern).toBe('turn-failure:empty-output');
  });

  it('正常成功轨迹不污染错题本（保守判定）', () => {
    const collector = createTrajectoryCollector({ agentId: 'ok-test' });
    const ctx = createFakeRuntime();
    ctx.plugin(collector.plugin);
    ctx.runPlugins();

    ctx.emit('tools/result', { name: 'sf_read', output: 'content' });
    ctx.emit('agent/turn-stopped', { output: '任务完成' });

    expect(collector.consumeFailure(dataDir)).toBe(0);
    expect(existsSync(join(dataDir, 'instinct', 'failure-log.jsonl'))).toBe(false);
  });
});
