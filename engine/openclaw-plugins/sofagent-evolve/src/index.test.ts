// sofagent-evolve OpenClaw 插件测试
// 覆盖：pluginMeta 元数据 / register 注册 hook 与工具 / reflectHint 开关读取 / default 导出契约
//      / sofagent_evolve 工具写入回执如实回报（v1.5.2 章八-2 防复发）
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import register, { pluginMeta } from './index';

declare const require: (id: string) => {
  version?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

function createMockApi(pluginConfig?: unknown) {
  const hooks: Record<string, unknown[]> = {};
  const tools: Record<string, unknown> = {};
  return {
    hooks,
    tools,
    pluginConfig,
    on: vi.fn((name: string, handler: unknown, opts?: unknown) => {
      hooks[name] = hooks[name] ?? [];
      hooks[name].push({ handler, opts });
    }),
    registerTool: vi.fn((tool: { name: string }, opts?: unknown) => {
      tools[tool.name] = { tool, opts };
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('sofagent-evolve pluginMeta', () => {
  it('id 应为 sofagent-evolve 且品牌色 #16B8F3', () => {
    expect(pluginMeta.id).toBe('sofagent-evolve');
    expect(pluginMeta.brandColor).toBe('#16B8F3');
  });
});

describe('sofagent-evolve register', () => {
  it('应注册 before_prompt_build hook（默认不注入，见下方默认关用例）', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.on).toHaveBeenCalledWith('before_prompt_build', expect.any(Function), expect.objectContaining({ priority: 50 }));
  });

  // 防复发（重复注入噪声）：inject 的 L2 已注入 think.md，本插件此前每轮再无条件下发同一句
  // 样板提示——同一件事两处注入。改为配置开关 reflectHint，默认关。
  //
  // 防复发（配置读错通道）：宿主把插件配置经 schema 校验后从**插件 API 顶层 `pluginConfig`**
  // 注入；而 agent 类 hook 的 ctx 由宿主白名单构造（`buildAgentHookContext` 只展开 15 个
  // 字段，**不含 config**）。旧实现在 hook 内读 `ctx?.config?.plugins?.entries?...`，
  // 该表达式在真实宿主恒为 undefined——「把 reflectHint 打开」从来没生效过，
  // 默认关的语义恰好把这个缺陷掩盖了。最后一个用例把错误通道钉死。
  describe('reflectHint（register 期读 pluginConfig）', () => {
    const handlerOf = (pluginConfig?: unknown) => {
      const api = createMockApi(pluginConfig);
      register(api as never);
      return (api.hooks['before_prompt_build']?.[0] as { handler: (e: unknown, c: unknown) => unknown }).handler;
    };

    it('未配置 reflectHint → 不注入（返回 undefined）', () => {
      expect(handlerOf()({}, {})).toBeUndefined();
      expect(handlerOf({ enabled: true })({}, {})).toBeUndefined();
    });

    it('reflectHint: true → 注入收尾提示', () => {
      const out = handlerOf({ reflectHint: true })({}, {}) as { prependSystemContext?: string };
      expect(typeof out?.prependSystemContext).toBe('string');
      expect(out?.prependSystemContext).toContain('sofagent_evolve');
    });

    it('开关仅认 pluginConfig——hook ctx.config 不是通道（真实宿主 ctx 无 config）', () => {
      const ctxWithLegacyConfig = { config: { plugins: { entries: { 'sofagent-evolve': { config: { reflectHint: true } } } } } };
      expect(handlerOf(undefined)({}, ctxWithLegacyConfig)).toBeUndefined();
    });
  });

  it('应注册 sofagent_evolve 工具（optional=true 写文件副作用）', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.tools['sofagent_evolve']).toBeDefined();
    expect((api.tools['sofagent_evolve'] as { opts?: unknown }).opts).toEqual({ optional: true });
  });

  it('default 导出应为 register 函数（OpenClaw 运行时契约）', () => {
    expect(register).toBeTypeOf('function');
  });
});

// v1.4.5 (T7/R4) 防复发：pluginMeta.version 必须与 package.json 一致——
// 此前硬编码 '1.4.0' 落后实际 4 个版本。运行时读取后两者永远同步；
// 本测试锁定「改回硬编码 + 忘 bump」的回归路径。
// v1.4.5 T7 注：CJS 编译态无 import.meta——用 require 双态通吃
// （vitest ESM 转译后 require 可用；tsc CJS 原生可用）
describe('pluginMeta.version 运行时同步（T7 防复发）', () => {
  it('pluginMeta.version === package.json version（不再硬编码漂移）', () => {
    const pkg = require('../package.json');
    expect(pluginMeta.version).toBe(pkg.version);
    expect(pluginMeta.version).not.toBe('0.0.0-unknown'); // 兜底值出现在生产 = 读取路径断了
  });
});

// v1.5.2 章八-2 防复发：工具假成功。
// 病根：execute 传空 diff 数组调 generateThinkEntry（其首行 `if (diffFiles.length === 0) return;`
// 直接空转零写入），却**无条件**回报「反思条目已写入 think.md」——进化闭环数据源长期空转。
// 修法：改调 appendManualThinkEntry（口述沉淀入口），并**按写入回执分支**，封死假成功路径。
// 说明：插件用动态 require('@sofagent/think')，vi.mock 拦不到动态 require；改用 vi.spyOn
// 作用在真实模块对象（require 同一缓存实例）上——既有 require 双态写法见本文件顶部声明。
describe('sofagent_evolve 工具：写入回执如实回报（v1.5.2 章八-2 防复发）', () => {
  const executeOf = () => {
    const api = createMockApi();
    register(api as never);
    return (api.tools['sofagent_evolve'] as {
      tool: { execute: (id: string, p: { task: string; summary: string }) => Promise<{ content: Array<{ text: string }> }> };
    }).tool.execute;
  };

  it('回执 written:true → 文案含「已写入」与字节数', async () => {
    const think = require('@sofagent/think');
    const spy = vi.spyOn(think, 'appendManualThinkEntry').mockReturnValue({
      written: true, path: '/tmp/think.md', before: 0, bytes: 123,
      timestamp: '2026-01-01 00:00', task: 't', lesson: 's',
    });
    try {
      const out = await executeOf()('id', { task: 't', summary: 's' });
      const text = out.content[0]?.text ?? '';
      expect(text).toContain('已写入');
      expect(text).toContain('123');
      expect(spy).toHaveBeenCalledWith('t', 's');
    } finally {
      spy.mockRestore();
    }
  });

  it('回执 written:false → 文案含「未写入」且不含「已写入」（不谎报成功）', async () => {
    const think = require('@sofagent/think');
    const spy = vi.spyOn(think, 'appendManualThinkEntry').mockReturnValue({
      written: false, reason: 'empty-lesson', path: '/tmp/think.md', before: 0, bytes: 0,
      timestamp: '2026-01-01 00:00', task: 't', lesson: '',
    });
    try {
      const out = await executeOf()('id', { task: 't', summary: '' });
      const text = out.content[0]?.text ?? '';
      expect(text).toContain('未写入');
      expect(text).not.toContain('已写入');
      expect(text).toContain('empty-lesson');
    } finally {
      spy.mockRestore();
    }
  });

  // 关键反证：不 mock，走真实 think 模块 + 临时数据目录（SOFAGENT_DATA 隔离）。
  // 空 summary 时 think.md 必须不存在/不增长，且工具文案不谎报成功；非空 summary 时真落盘。
  it('反证：真实写入路径——空 summary 不写盘且不谎报，非空 summary 真增长', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'sofagent-evolve-'));
    const dataDir = join(tmpRoot, 'data');
    const thinkPath = join(dataDir, 'think.md');
    const prevData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = dataDir;
    try {
      const think = require('@sofagent/think');
      // 确认未被上一条用例的 spy 污染（真实实现）
      expect(vi.isMockFunction(think.appendManualThinkEntry)).toBe(false);

      // 空 summary（含换行/空格）→ 不写盘、不谎报
      const outEmpty = await executeOf()('id', { task: '空教训任务', summary: '  \n\t ' });
      expect(existsSync(thinkPath)).toBe(false);
      const textEmpty = outEmpty.content[0]?.text ?? '';
      expect(textEmpty).toContain('未写入');
      expect(textEmpty).not.toContain('已写入');

      // 非空 summary → 真实落盘增长、文案含「已写入」
      const outOk = await executeOf()('id', { task: '真任务', summary: '真教训' });
      expect(existsSync(thinkPath)).toBe(true);
      const content = readFileSync(thinkPath, 'utf-8');
      expect(content).toContain('真任务');
      expect(content).toContain('真教训');
      expect(outOk.content[0]?.text ?? '').toContain('已写入');
    } finally {
      if (prevData === undefined) delete process.env.SOFAGENT_DATA;
      else process.env.SOFAGENT_DATA = prevData;
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  // 防复发（清洗顺序口径分歧）：lesson 清洗必须与 @sofagent/mcp 的 write_think 逐字一致
  // = 先截断到 10000 → 折行 → trim。若被改成「先折行后截断」，本条钉子的精确长度断言即红。
  it('超长且含换行的 summary → 落盘 lesson 无换行且按「先截断后折行」口径产出（顺序钉）', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'sofagent-evolve-'));
    const dataDir = join(tmpRoot, 'data');
    const thinkPath = join(dataDir, 'think.md');
    const prevData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = dataDir;
    try {
      // 10057 字符，中途夹一段连续换行（\n\n 折行为 1 个空格 → 折行会缩短长度）：
      //   先截断后折行 → 取前 10000 原始字符再折行 = 9999 字符
      //   先折行后截断 → 折行后 10056 字符再截到 10000 = 10000 字符
      const summary = 'A'.repeat(9995) + '\n\n' + 'B'.repeat(60);
      expect(summary.length).toBeGreaterThan(10000);

      const out = await executeOf()('id', { task: '超长任务', summary });
      expect(out.content[0]?.text ?? '').toContain('已写入');

      const content = readFileSync(thinkPath, 'utf-8');
      const m = content.match(/- #教训: ([\s\S]*?)\n\n/);
      expect(m).not.toBeNull();
      const lesson = m?.[1] ?? '';
      expect(lesson).not.toContain('\n'); // 折行生效——不得把换行写进条目
      expect(lesson.length).toBeLessThanOrEqual(10000);
      expect(lesson.length).toBe(9999); // 精确钉住「先截断 → 后折行 → trim」顺序
    } finally {
      if (prevData === undefined) delete process.env.SOFAGENT_DATA;
      else process.env.SOFAGENT_DATA = prevData;
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
