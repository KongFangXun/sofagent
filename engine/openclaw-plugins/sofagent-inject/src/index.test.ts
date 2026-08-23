// sofagent-inject OpenClaw 插件测试
// 覆盖：pluginMeta 元数据 / register 注册 hook 与工具 / default 导出契约
import { describe, it, expect, vi } from 'vitest';
import register, { pluginMeta } from './index';

function createMockApi() {
  const hooks: Record<string, unknown[]> = {};
  const tools: Record<string, unknown> = {};
  return {
    hooks,
    tools,
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
