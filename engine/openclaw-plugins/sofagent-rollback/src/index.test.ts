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

// v1.4.5 (T7/R4) 防复发：pluginMeta.version 必须与 package.json 一致——
// 此前硬编码 '1.4.0' 落后实际 4 个版本。运行时读取后两者永远同步；
// 本测试锁定「改回硬编码 + 忘 bump」的回归路径。
// v1.4.5 T7 注：CJS 编译态无 import.meta——用 require 双态通吃
// （vitest ESM 转译后 require 可用；tsc CJS 原生可用）
declare const require: (id: string) => { version?: string };
describe('pluginMeta.version 运行时同步（T7 防复发）', () => {
  it('pluginMeta.version === package.json version（不再硬编码漂移）', () => {
    const pkg = require('../package.json');
    expect(pluginMeta.version).toBe(pkg.version);
    expect(pluginMeta.version).not.toBe('0.0.0-unknown'); // 兜底值出现在生产 = 读取路径断了
  });
});
