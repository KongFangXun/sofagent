// dsh-backend.test.ts · v1.3.6 交付⑤ 测试
//
// 覆盖：
// 1. convertTools 三段式转换（define 段模型可见 / execute 段保 wrapper / 防御式过滤）
// 2. 预算守卫 + waterfall next() 纪律（soft 透传 / hard 中断）
// 3. createDshBackend 入口校验（缺 Context 抛错）
// 4. Trajectory 采集 PoC（事件落记录 / flush JSONL / failure-log 同步消费）
// 5. argv[1] 守卫（v1.4.0：node -e 宿主下 cordis-plugin-hmr 兼容）
// 6. 工具注入（v1.4.1：registerSofagentTools——tools.register 接线 + 防御式降级）
// 7. zod schema 泄漏防御（v1.4.1：normalizeParameters zod 优先检测——判断层 run-01 根因修复）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  convertTools,
  createBudgetGuard,
  createBudgetPlugin,
  createDshBackend,
  createArgv1Guard,
  registerSofagentTools,
  ToolBudgetExhaustedError,
  extractSessionUsage,
  type CordisRuntime,
  type CordisToolDefinition,
  type DshToolsService,
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

// ────────────────────────────────────────────────────────────
// zod schema 泄漏防御（v1.4.1：normalizeParameters zod 优先检测）
//
// 根因：LangChain tool 的 schema 字段是 zod 对象，zod v4 起自带 type 属性（值
// 'object'），'type' in s 检测被骗过 → 整个 zod 实例（含 toJSONSchema/parse/def
// 等方法）透传给 tools.register → DSH 组装 LLM 请求序列化含函数的 parameters
// 失败 → turn 立即 end、零 LLM 调用、静默空返回。此组用例锁死该泄漏路径。
// ────────────────────────────────────────────────────────────

/** 模拟 zod v4 对象形态（duck-typing，不依赖真实 zod 包）：type 属性 + toJSONSchema/parse/def 方法 */
function fakeZodV4(overrides: Partial<{ toJSONSchema: () => unknown }> = {}) {
  return {
    type: 'object',
    toJSONSchema: () => ({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    }),
    parse: (input: unknown) => input,
    def: { typeName: 'ZodObject' },
    ...overrides,
  };
}

describe('normalizeParameters zod schema 泄漏防御', () => {
  it('zod v4 对象 → toJSONSchema() 转纯 JSON Schema，无任何 zod 方法残留', () => {
    const defs = convertTools([
      { name: 'check_version', description: '门禁', schema: fakeZodV4(), func: () => 'ok' },
    ]);
    expect(defs).toHaveLength(1);
    const params = defs[0].parameters as Record<string, unknown>;
    // 纯 JSON Schema——绝无 zod 实例泄漏（序列化安全）
    expect(typeof (params as { toJSONSchema?: unknown }).toJSONSchema).toBe('undefined');
    expect(typeof (params as { parse?: unknown }).parse).toBe('undefined');
    expect('def' in params).toBe(false);
    // 内容来自 toJSONSchema() 产物
    expect(params.type).toBe('object');
    expect(params.properties).toEqual({ path: { type: 'string' } });
    expect(params.required).toEqual(['path']);
  });

  it('toJSONSchema() 抛错（zod 版本差异）→ 空对象签名兜底，绝不透传 zod 实例', () => {
    const throwing = fakeZodV4({
      toJSONSchema: () => {
        throw new Error('zod version mismatch');
      },
    });
    const defs = convertTools([
      { name: 'bad_gate', description: '', schema: throwing, func: () => 'ok' },
    ]);
    expect(defs[0].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('toJSONSchema() 返回非对象（null 等）→ 空对象签名兜底', () => {
    const weird = fakeZodV4({ toJSONSchema: () => null });
    const defs = convertTools([
      { name: 'weird_gate', description: '', schema: weird, func: () => 'ok' },
    ]);
    expect(defs[0].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('zod v3 老形态（_def/shape 无 toJSONSchema）→ 空对象签名兜底', () => {
    const zodV3 = { _def: { typeName: 'ZodObject' }, shape: {} };
    const defs = convertTools([
      { name: 'v3_tool', description: '', schema: zodV3, func: () => 'ok' },
    ]);
    expect(defs[0].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('zod 转纯 JSON Schema 后可直接喂 registerSofagentTools（转换-注册管道贯通）', () => {
    const ctx = createFakeRuntime();
    const { svc, registered } = createFakeToolsService();
    (ctx as unknown as { get: (k: string) => unknown }).get = (k: string) =>
      k === 'tools' ? svc : undefined;

    const defs = convertTools([
      { name: 'gate_check', description: '门禁', schema: fakeZodV4(), func: () => 'gate-ok' },
    ]);
    const n = registerSofagentTools(ctx, defs);
    expect(n).toBe(1);
    // 注册产物 execute 保 wrapper + parameters 为纯 JSON Schema
    const def = registered[0].def as {
      parameters: Record<string, unknown>;
      execute: (a: Record<string, unknown>) => unknown;
    };
    expect(def.parameters.properties).toEqual({ path: { type: 'string' } });
    expect(def.execute({ path: '/a' })).toBe('gate-ok');
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

describe('argv[1] 守卫（v1.4.0：node -e 宿主下 cordis-plugin-hmr 兼容）', () => {
  const REAL_ARGV1 = process.argv[1];

  afterEach(() => {
    // 兜底恢复（测试中途断言失败也不泄漏）
    if (REAL_ARGV1 === undefined) delete process.argv[1];
    else process.argv[1] = REAL_ARGV1;
  });

  it('argv[1] undefined（node -e 宿主）→ 守卫注入 fallback，restore 后恢复 undefined', () => {
    delete process.argv[1];
    const restore = createArgv1Guard('/fake/main.js');
    expect(process.argv[1]).toBe('/fake/main.js'); // 守卫生效期：hmr 可 resolve
    restore();
    expect(process.argv[1]).toBeUndefined(); // 恢复原状（稀疏数组）
  });

  it('argv[1] 空串（另一无主脚本形态）→ 同样注入 fallback', () => {
    process.argv[1] = '';
    const restore = createArgv1Guard('/fake/main.js');
    expect(process.argv[1]).toBe('/fake/main.js');
    restore();
    expect(process.argv[1]).toBe('');
  });

  it('argv[1] 有主脚本（正常宿主）→ 零侵入（不注入不恢复）', () => {
    process.argv[1] = '/real/script.mjs';
    const restore = createArgv1Guard('/fake/main.js');
    expect(process.argv[1]).toBe('/real/script.mjs'); // 原值不动
    restore();
    expect(process.argv[1]).toBe('/real/script.mjs');
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

// ────────────────────────────────────────────────────────────
// 工具注入（v1.4.1：registerSofagentTools——tools.register 接线）
// ────────────────────────────────────────────────────────────

/** 假 tools 服务（DshToolsService 契约——可注入失败行为） */
function createFakeToolsService(failNames: Set<string> = new Set()) {
  const registered: Array<{ name: string; def: unknown }> = [];
  const svc: DshToolsService = {
    register(def) {
      if (failNames.has(def.name)) {
        throw new TypeError(`tool "${def.name}" must declare output { schema, render, presentationMeta? }`);
      }
      registered.push({ name: def.name, def });
      return () => registered.pop();
    },
  };
  return { svc, registered };
}

describe('registerSofagentTools 工具注入', () => {
  it('tools 服务就绪——全部注册成功，output 双字段补全', () => {
    const ctx = createFakeRuntime();
    const { svc, registered } = createFakeToolsService();
    (ctx as unknown as { get: (k: string) => unknown }).get = (k: string) =>
      k === 'tools' ? svc : undefined;

    const tools: CordisToolDefinition[] = [
      {
        name: 'check_version',
        description: '运行版本门禁',
        parameters: { type: 'object', properties: {} },
        execute: () => ({ ok: true }),
        output: { schema: { type: 'string' }, render: (r) => JSON.stringify(r) },
      },
      {
        name: 'check_docs',
        description: '运行文档门禁',
        parameters: { type: 'object', properties: {} },
        execute: () => 'docs-ok',
        // 无 output 段——注册时应补全 schema 兜底 + safeRender
      },
    ];
    const n = registerSofagentTools(ctx, tools);

    expect(n).toBe(2);
    expect(registered).toHaveLength(2);
    // output.render 双参签名（args, value）——无自定义 render 时走 safeRender
    const docsDef = registered[1].def as {
      output: { schema: unknown; render: (a: unknown, v: unknown) => string };
    };
    expect(docsDef.output.render(undefined, 'docs-ok')).toBe('docs-ok');
    expect(docsDef.output.render(undefined, { ok: 1 })).toBe('{"ok":1}');
  });

  it('单项注册失败——跳过该工具，其余照常注册（防御式不中断）', () => {
    const ctx = createFakeRuntime();
    const { svc, registered } = createFakeToolsService(new Set(['bad_tool']));
    (ctx as unknown as { get: (k: string) => unknown }).get = (k: string) =>
      k === 'tools' ? svc : undefined;

    const tools: CordisToolDefinition[] = [
      { name: 'bad_tool', description: '', parameters: { type: 'object', properties: {} }, execute: () => null },
      { name: 'good_tool', description: '', parameters: { type: 'object', properties: {} }, execute: () => null },
    ];
    const n = registerSofagentTools(ctx, tools);

    expect(n).toBe(1);
    expect(registered.map((r) => r.name)).toEqual(['good_tool']);
  });

  it('tools 服务缺失——返回 0 降级不崩（rc 形态变化防御）', () => {
    const ctx = createFakeRuntime();
    // 假 runtime 无 get 面时 CordisRuntime.get 可选——补一个返回 undefined 的 get
    (ctx as unknown as { get: (k: string) => unknown }).get = () => undefined;

    const n = registerSofagentTools(ctx, [
      { name: 'x', description: '', parameters: { type: 'object', properties: {} }, execute: () => null },
    ]);
    expect(n).toBe(0);
  });

  it('convertTools 产物可直接喂 registerSofagentTools（转换-注册管道贯通）', () => {
    const ctx = createFakeRuntime();
    const { svc, registered } = createFakeToolsService();
    (ctx as unknown as { get: (k: string) => unknown }).get = (k: string) =>
      k === 'tools' ? svc : undefined;

    // LangGraph 形状工具（invoke 型）→ convertTools → register
    const langGraphTools = [
      {
        name: 'gate_check',
        description: '门禁',
        schema: { type: 'object', properties: {} },
        invoke: (input: Record<string, unknown>) => ({ gate: 'ok', ...input }),
      },
    ];
    const converted = convertTools(langGraphTools);
    const n = registerSofagentTools(ctx, converted);

    expect(n).toBe(1);
    // execute 段保 wrapper：注册后的 def.execute 仍调原 invoke
    const def = registered[0].def as { execute: (a: Record<string, unknown>) => unknown };
    expect(def.execute({ k: 1 })).toEqual({ gate: 'ok', k: 1 });
  });
});

// ────────────────────────────────────────────────────────────
// extractSessionUsage 多通道提取（v1.4.4 第七章·十：DSH 内嵌路径 usage 修复）
//
// 实测背景（probe 落地结论）：alpha.1 事件流的 usage 在 `assistant/chunk`
// （chunk.type === 'usage'，camelCase 字段）里，assistant/message 顶层仅
// role/content/source/id 无 usage 面——老实现只扫 assistant/message 恒返 null，
// v1.4.3 第六章步三「token 自动计量」在内嵌路径实际失效。
// ────────────────────────────────────────────────────────────

describe('extractSessionUsage 多通道提取（v1.4.4 第七章·十）', () => {
  it('通道一（alpha.1 主通道）：assistant/chunk type:usage camelCase 提取', () => {
    const events = [
      { seq: 1, type: 'turn/start', data: {} },
      { seq: 2, type: 'assistant/chunk', data: { chunk: { type: 'block-start', blockType: 'reasoning' } } },
      {
        seq: 3,
        type: 'assistant/chunk',
        data: { chunk: { type: 'usage', usage: { inputTokens: 5250, outputTokens: 16, totalTokens: 8594, cacheReadTokens: 3328 } } },
      },
      { seq: 4, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'pong' }] } } },
    ];
    const u = extractSessionUsage(events, 1);
    expect(u).toEqual({ prompt_tokens: 5250, completion_tokens: 16, total_tokens: 8594 });
  });

  it('通道一缺 totalTokens——prompt+completion 求和兜底', () => {
    const events = [
      { seq: 1, type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } } } },
    ];
    const u = extractSessionUsage(events, 1);
    expect(u).toEqual({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  });

  it('通道二（老形态）：assistant/message 的 message.usage snake_case 提取', () => {
    const events = [
      {
        seq: 1,
        type: 'assistant/message',
        data: { message: { usage: { prompt_tokens: 800, completion_tokens: 50, total_tokens: 850 } } },
      },
    ];
    const u = extractSessionUsage(events, 1);
    expect(u).toEqual({ prompt_tokens: 800, completion_tokens: 50, total_tokens: 850 });
  });

  it('通道三（LangGraph 命名）：message.usage_metadata input/output_tokens 提取', () => {
    const events = [
      {
        seq: 1,
        type: 'assistant/message',
        data: { message: { usage_metadata: { input_tokens: 300, output_tokens: 30, total_tokens: 330 } } },
      },
    ];
    const u = extractSessionUsage(events, 1);
    expect(u).toEqual({ prompt_tokens: 300, completion_tokens: 30, total_tokens: 330 });
  });

  it('alpha.1 真实序列回放：chunk 流 + 无 usage 面 assistant/message——从 chunk 通道拿数', () => {
    // probe4 实测形态：assistant/message 顶层键仅 role/content/source/id
    const events = [
      { seq: 4, type: 'turn/start', data: { turn: 1 } },
      { seq: 15, type: 'assistant/chunk', data: { chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } },
      { seq: 47, type: 'assistant/chunk', data: { chunk: { type: 'text-delta', index: 1, text: 'pong' } } },
      {
        seq: 50,
        type: 'assistant/chunk',
        data: { chunk: { type: 'usage', usage: { inputTokens: 7039, outputTokens: 33, totalTokens: 8608 } } },
      },
      { seq: 51, type: 'assistant/chunk', data: { chunk: { type: 'finish', reason: { kind: 'stop' } } } },
      { seq: 52, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'reasoning' }, { type: 'text', text: 'pong' }] } } },
    ];
    const u = extractSessionUsage(events, 4);
    expect(u).toEqual({ prompt_tokens: 7039, completion_tokens: 33, total_tokens: 8608 });
  });

  it('多轮会话取最后一条有效样本（会话累计口径）', () => {
    const events = [
      { seq: 1, type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } } } },
      { seq: 2, type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { inputTokens: 5000, outputTokens: 40, totalTokens: 5040 } } } },
    ];
    const u = extractSessionUsage(events, 1);
    expect(u).toEqual({ prompt_tokens: 5000, completion_tokens: 40, total_tokens: 5040 });
  });

  it('firstSeq 之前的事件跳过（同 session 复用隔离）', () => {
    const events = [
      { seq: 1, type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } } } },
      { seq: 5, type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { inputTokens: 200, outputTokens: 5 } } } },
    ];
    const u = extractSessionUsage(events, 5);
    expect(u).toEqual({ prompt_tokens: 200, completion_tokens: 5, total_tokens: 205 });
  });

  it('无任何 usage 面（三通道全 miss）→ null（调用方降级手记）', () => {
    const events = [
      { seq: 1, type: 'turn/start', data: {} },
      { seq: 2, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } } },
    ];
    expect(extractSessionUsage(events, 1)).toBeNull();
  });

  it('chunk 流里非 usage 类型的 chunk 不误判（block-start/text-delta/finish 不产样本）', () => {
    const events = [
      { seq: 1, type: 'assistant/chunk', data: { chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } },
      { seq: 2, type: 'assistant/chunk', data: { chunk: { type: 'text-delta', index: 1, text: 'hi' } } },
      { seq: 3, type: 'assistant/chunk', data: { chunk: { type: 'block-end', index: 1, block: { type: 'text', text: 'hi' } } } },
      { seq: 4, type: 'assistant/chunk', data: { chunk: { type: 'finish', reason: { kind: 'stop' } } } },
    ];
    expect(extractSessionUsage(events, 1)).toBeNull();
  });
});
