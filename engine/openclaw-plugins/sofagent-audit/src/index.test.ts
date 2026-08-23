// sofagent-audit OpenClaw 插件测试
// 覆盖：pluginMeta 元数据 / register 注册工具与 hook / default 导出契约
import { describe, it, expect, vi } from 'vitest';
import register, { pluginMeta, DANGEROUS_TOOLS } from './index';

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

describe('sofagent-audit pluginMeta', () => {
  it('id 应为 sofagent-audit 且品牌色 #16B8F3', () => {
    expect(pluginMeta.id).toBe('sofagent-audit');
    expect(pluginMeta.brandColor).toBe('#16B8F3');
  });

  it('危险工具黑名单应含 rm/git push 等高危命令', () => {
    expect(DANGEROUS_TOOLS).toContain('rm');
    expect(DANGEROUS_TOOLS).toContain('git_push');
    expect(DANGEROUS_TOOLS).toContain('git_reset_hard');
    expect(DANGEROUS_TOOLS).toContain('drop_table');
  });
});

describe('sofagent-audit register', () => {
  it('应注册 before_tool_execute hook（危险工具拦截）', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.on).toHaveBeenCalledWith('before_tool_execute', expect.any(Function), expect.objectContaining({ priority: 100 }));
    expect(api.hooks['before_tool_execute']?.length).toBe(1);
  });

  it('应注册 sofagent_audit 工具', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.registerTool).toHaveBeenCalled();
    expect(api.tools['sofagent_audit']).toBeDefined();
    expect(api.tools['sofagent_audit'].opts).toEqual({ optional: false });
  });

  it('default 导出应为 register 函数（OpenClaw 运行时契约）', () => {
    expect(register).toBeTypeOf('function');
  });
});
