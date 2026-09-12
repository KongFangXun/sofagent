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
  it('应注册 before_tool_call hook（危险工具拦截）', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.on).toHaveBeenCalledWith('before_tool_call', expect.any(Function), expect.objectContaining({ priority: 100 }));
    expect(api.hooks['before_tool_call']?.length).toBe(1);
  });

  // 防复发（双缺陷：幽灵事件名 + 错误的返回值契约）：
  // 旧实现挂 `before_tool_execute`（宿主 0 命中，2026.5.20 / 2026.6.1 均无此事件），
  // 且返回 DSH/cordis 形状 `{ allowed: false }`——宿主 hook-runner 只读 `.block`，
  // `allowed` 被静默忽略。名字与形状各错一次，合起来让「危险工具拦截」永不生效。
  // 本用例锁死 OpenClaw 契约：拦停必须是 `{ block: true, blockReason }`。
  it('危险工具应返回 { block: true, blockReason }（宿主可拦停），而非 allowed 形状', () => {
    const api = createMockApi();
    register(api as never);
    const entry = api.hooks['before_tool_call']?.[0] as { handler: (event: unknown) => unknown };
    const blocked = entry.handler({ toolName: 'rm', params: {} }) as { block?: boolean; blockReason?: string };
    expect(blocked?.block).toBe(true);
    expect(typeof blocked?.blockReason).toBe('string');
    expect(blocked?.blockReason).toContain('rm');
  });

  it('非危险工具应返回 void（明确「无意见」放行，不伪造 allowed 形状）', () => {
    const api = createMockApi();
    register(api as never);
    const entry = api.hooks['before_tool_call']?.[0] as { handler: (event: unknown) => unknown };
    expect(entry.handler({ toolName: 'read_file', params: {} })).toBeUndefined();
  });

  it('应注册 sofagent_audit 工具', () => {
    const api = createMockApi();
    register(api as never);
    expect(api.registerTool).toHaveBeenCalled();
    expect(api.tools['sofagent_audit']).toBeDefined();
    // v1.4.5 T7 顺手修：tools 索引签名是 unknown（tsc 严格模式编译报 TS2571，
    // 该错误导致 npm run build 一直失败——存量问题，最小修：显式断言）
    expect((api.tools['sofagent_audit'] as { opts?: unknown }).opts).toEqual({ optional: false });
  });

  it('default 导出应为 register 函数（OpenClaw 运行时契约）', () => {
    expect(register).toBeTypeOf('function');
  });
});

// v1.4.5 (T7/R4) 防复发：pluginMeta.version 必须与 package.json 一致——
// 此前硬编码 '1.4.0' 落后实际 4 个版本。运行时读取后两者永远同步；
// 本测试锁定「改回硬编码 + 忘 bump」的回归路径。
// 注：src 经 vitest 以 ESM 直跑、tsc 编译为 CJS——两种形态下 __dirname 仅 CJS 有。
// 用 process.cwd() 无效（测试可从任意目录起跑）。最稳妥：node:path + 相对
// module 自身——但 ESM 无 __filename。此处用 require('../package.json') 双态
// 通吃（vitest ESM 转译后 require 可用；CJS 原生可用）。
declare const require: (id: string) => { version?: string };
describe('pluginMeta.version 运行时同步（T7 防复发）', () => {
  it('pluginMeta.version === package.json version（不再硬编码漂移）', () => {
    const pkg = require('../package.json');
    expect(pluginMeta.version).toBe(pkg.version);
    expect(pluginMeta.version).not.toBe('0.0.0-unknown'); // 兜底值出现在生产 = 读取路径断了
  });
});
