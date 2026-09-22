// sofagent-rollback OpenClaw 插件测试
// 覆盖：pluginMeta 元数据 / register 注册工具与 CLI / pluginConfig.projectRoot 读取 / default 导出契约
import { describe, it, expect, vi, afterEach } from 'vitest';
import register, { pluginMeta } from './index';

// v1.4.5 T7 注：CJS 编译态无 import.meta——用 require 双态通吃
// （vitest ESM 转译后 require 可用；tsc CJS 原生可用）。
declare const require: (id: string) => {
  version?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

afterEach(() => {
  vi.restoreAllMocks();
});

function createMockApi(pluginConfig?: unknown) {
  const tools: Record<string, unknown> = {};
  const cliRegistrations: unknown[] = [];
  return {
    tools,
    cliRegistrations,
    pluginConfig,
    registerTool: vi.fn((tool: { name: string }, opts?: unknown) => {
      tools[tool.name] = { tool, opts };
    }),
    registerCli: vi.fn((fn: unknown, opts?: unknown) => {
      cliRegistrations.push({ fn, opts });
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('sofagent-rollback pluginMeta', () => {
  it('id 应为 sofagent-rollback 且品牌色 #16B8F3', () => {
    expect(pluginMeta.id).toBe('sofagent-rollback');
    expect(pluginMeta.brandColor).toBe('#16B8F3');
  });
});

describe('sofagent-rollback register', () => {
  it('应注册 sofagent_rollback 工具（optional=true 副作用需白名单）', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.tools['sofagent_rollback']).toBeDefined();
    expect((api.tools['sofagent_rollback'] as { opts?: unknown }).opts).toEqual({ optional: true });
  });

  it('应注册 sofagent-rollback CLI 命令', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.registerCli).toHaveBeenCalled();
    // v1.4.5 T7 顺手修：cliRegistrations 数组元素是 {}——tsc 严格模式报 TS2339
    expect((api.cliRegistrations[0] as { opts?: unknown } | undefined)?.opts).toEqual({ commands: ['sofagent-rollback'] });
  });

  it('default 导出应为 register 函数（OpenClaw 运行时契约）', () => {
    expect(register).toBeTypeOf('function');
  });
});

// 防复发（配置静默失效）：manifest 声明了 `configSchema.projectRoot`，宿主把该配置经
// schema 校验后从**插件 API 顶层 `pluginConfig`** 注入。旧实现硬编码 `process.cwd()`，
// 于是「配置里写了 projectRoot」在真实宿主里完全没人读——快照 / 回滚会落到宿主进程当前
// 目录，而不是配置里那个仓库（对回滚工具而言是「回滚到错误仓库」的高危面）。
//
// 断言手法：插件工具在**执行期**动态 `require('@sofagent/core')`，Node 的 require 缓存
// 保证它与测试里 require 到的是同一个模块对象，因此在测试侧 spy 该模块即可观测
// 「工具把哪个根交给了 core」。不用 vi.mock：它拦不到源码里的动态 require。
describe('projectRoot 配置读取（防「声明了配置但没人读」）', () => {
  const toolOf = (pluginConfig?: unknown) => {
    const api = createMockApi(pluginConfig);
    register(api as never);
    return (api.tools['sofagent_rollback'] as { tool: { execute: (id: string, p: unknown) => Promise<unknown> } }).tool;
  };

  it('pluginConfig.projectRoot 应传给 @sofagent/core（而非宿主 cwd）', async () => {
    const core = require('@sofagent/core');
    const spy = vi.spyOn(core, 'listSnapshots').mockReturnValue([]);
    await toolOf({ projectRoot: '/tmp/configured-proj' }).execute('id-1', { action: 'list' });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[0]).toBe('/tmp/configured-proj');
  });

  it('未配置 projectRoot → 回落宿主 cwd', async () => {
    const core = require('@sofagent/core');
    const spy = vi.spyOn(core, 'listSnapshots').mockReturnValue([]);
    await toolOf(undefined).execute('id-2', { action: 'list' });
    expect(spy.mock.calls[0]?.[0]).toBe(process.cwd());
  });

  it('projectRoot 为空白串 → 视同未配置，回落 cwd（不注入空根）', async () => {
    const core = require('@sofagent/core');
    const spy = vi.spyOn(core, 'listSnapshots').mockReturnValue([]);
    await toolOf({ projectRoot: '   ' }).execute('id-3', { action: 'list' });
    expect(spy.mock.calls[0]?.[0]).toBe(process.cwd());
  });
});

describe('pluginMeta.version 运行时同步（T7 防复发）', () => {
  it('pluginMeta.version === package.json version（不再硬编码漂移）', () => {
    const pkg = require('../package.json');
    expect(pluginMeta.version).toBe(pkg.version);
    expect(pluginMeta.version).not.toBe('0.0.0-unknown'); // 兜底值出现在生产 = 读取路径断了
  });
});
