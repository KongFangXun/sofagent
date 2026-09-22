// sofagent-evolve OpenClaw 插件测试
// 覆盖：pluginMeta 元数据 / register 注册 hook 与工具 / reflectHint 开关读取 / default 导出契约
import { describe, it, expect, vi } from 'vitest';
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
