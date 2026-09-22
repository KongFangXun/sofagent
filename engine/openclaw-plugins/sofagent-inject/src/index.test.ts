// sofagent-inject OpenClaw 插件测试
// 覆盖：pluginMeta 元数据 / register 注册 hook 与工具 / pluginConfig.projectRoot 读取 / default 导出契约
import { describe, it, expect, vi, afterEach } from 'vitest';
import register, { pluginMeta } from './index';

declare const require: (id: string) => {
  version?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('sofagent-inject pluginMeta', () => {
  it('id 应为 sofagent-inject 且品牌色 #16B8F3', () => {
    expect(pluginMeta.id).toBe('sofagent-inject');
    expect(pluginMeta.brandColor).toBe('#16B8F3');
  });
});

describe('sofagent-inject register', () => {
  it('应注册 before_prompt_build hook（约束注入）', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.on).toHaveBeenCalledWith('before_prompt_build', expect.any(Function), expect.objectContaining({ priority: 100 }));
  });

  it('应注册 sofagent_inject 工具', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.tools['sofagent_inject']).toBeDefined();
  });

  it('default 导出应为 register 函数（OpenClaw 运行时契约）', () => {
    expect(register).toBeTypeOf('function');
  });
});

// 防复发（配置静默失效 + 错误通道）：manifest 声明了 `configSchema.projectRoot`，宿主把该
// 配置经 schema 校验后从**插件 API 顶层 `pluginConfig`** 注入。旧实现在 hook 内读
// `ctx?.config?.plugins?.entries?.['sofagent-inject']?.config?.projectRoot`——而 agent 类
// hook 的 ctx 由宿主白名单构造（`buildAgentHookContext` 只展开 runId / agentId / sessionKey /
// workspaceDir / modelId 等 15 个字段，**不含 config**），该表达式恒得 undefined，
// 「配置写了 projectRoot 却不生效」由此而来。
//
// 断言手法：hook 与工具都调用 `require('@sofagent/inject').buildConstrainedSystemPrompt(root)`，
// Node 的 require 缓存保证测试侧 spy 该模块即为同一对象，可直接观测传入的根。
// 不用 vi.mock：它拦不到源码里的动态 require。
describe('projectRoot 配置读取（防「声明了配置但没人读」）', () => {
  const hookOf = (pluginConfig?: unknown) => {
    const api = createMockApi(pluginConfig);
    register(api as never);
    return (api.hooks['before_prompt_build']?.[0] as { handler: (e: unknown, c: unknown) => unknown }).handler;
  };

  it('根取自 register 期 pluginConfig；hook ctx.config 不是通道', () => {
    const m = require('@sofagent/inject');
    const spy = vi.spyOn(m, 'buildConstrainedSystemPrompt').mockReturnValue('INJECTED');
    // 即使 hook ctx 里塞了「看似正确」的 config，也不应改变解析结果——真实宿主的 ctx 根本没有它
    const ctxWithLegacyConfig = { config: { plugins: { entries: { 'sofagent-inject': { config: { projectRoot: '/tmp/from-ctx' } } } } } };
    const out = hookOf({ projectRoot: '/tmp/from-plugin-config' })({}, ctxWithLegacyConfig) as { prependSystemContext?: string };
    expect(spy.mock.calls[0]?.[0]).toBe('/tmp/from-plugin-config');
    expect(out?.prependSystemContext).toBe('INJECTED');
  });

  it('未配置 projectRoot → 回落宿主 cwd（hook 与工具同源）', () => {
    const m = require('@sofagent/inject');
    const spy = vi.spyOn(m, 'buildConstrainedSystemPrompt').mockReturnValue('INJECTED');
    hookOf(undefined)({}, {});
    expect(spy.mock.calls[0]?.[0]).toBe(process.cwd());
  });

  it('projectRoot 为空白串 → 视同未配置，回落 cwd（不注入空根）', () => {
    const m = require('@sofagent/inject');
    const spy = vi.spyOn(m, 'buildConstrainedSystemPrompt').mockReturnValue('INJECTED');
    hookOf({ projectRoot: '   ' })({}, {});
    expect(spy.mock.calls[0]?.[0]).toBe(process.cwd());
  });

  it('工具侧与 hook 同源（同一 configuredRoot，不各自解析）', async () => {
    const m = require('@sofagent/inject');
    const spy = vi.spyOn(m, 'buildConstrainedSystemPrompt').mockReturnValue('INJECTED');
    const api = createMockApi({ projectRoot: '/tmp/configured-proj' });
    register(api as never);
    const tool = (api.tools['sofagent_inject'] as { tool: { execute: (id: string, p: unknown) => Promise<unknown> } }).tool;
    await tool.execute('id-1', {});
    expect(spy.mock.calls[0]?.[0]).toBe('/tmp/configured-proj');
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
