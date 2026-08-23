// sofagent-rollback OpenClaw 插件测试
// 覆盖：pluginMeta 元数据 / register 注册工具与 CLI / default 导出契约
import { describe, it, expect, vi } from 'vitest';
import register, { pluginMeta } from './index';

function createMockApi() {
  const tools: Record<string, unknown> = {};
  const cliRegistrations: unknown[] = [];
  return {
    tools,
    cliRegistrations,
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
    expect(api.tools['sofagent_rollback'].opts).toEqual({ optional: true });
  });

  it('应注册 sofagent-rollback CLI 命令', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.registerCli).toHaveBeenCalled();
    expect(api.cliRegistrations[0]?.opts).toEqual({ commands: ['sofagent-rollback'] });
  });

  it('default 导出应为 register 函数（OpenClaw 运行时契约）', () => {
    expect(register).toBeTypeOf('function');
  });
});
