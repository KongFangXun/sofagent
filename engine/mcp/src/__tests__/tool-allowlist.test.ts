// ============================================================
// tool-allowlist.test.ts · v1.9 §五 A37 七条（机制面逐条可跑）
// ------------------------------------------------------------
// 覆盖：① 每项有「何时该用它」 ② instructions 顺序与声明序逐位一致
//      ③ 名单项不存在 ⇒ 启动失败 ④ 暴露比台账 ⑤ 禁服务级 token
//      ⑥ 默认拒绝 ⑦ 误导就绪接口为空集且被挡在名单外
// ============================================================

import { describe, it, expect } from 'vitest';
import { TOOLS } from '../tool-registry';
import {
  DEFAULT_MCP_ALLOWLIST,
  MISLEADING_READINESS_TOOLS,
  assertAllowList,
  assertNoMisleadingTools,
  assertNoServiceToken,
  buildInstructions,
  exposureLedger,
  isAllowed,
  resolveAllowList,
} from '../tool-allowlist';

describe('A37 ① · 每项写「何时该用它」', () => {
  it('清单非空，且每项 whenToUse 是场景句（含「时」字，不是功能描述）', () => {
    expect(DEFAULT_MCP_ALLOWLIST.length).toBeGreaterThanOrEqual(8);
    for (const e of DEFAULT_MCP_ALLOWLIST) {
      expect(e.name.trim()).not.toBe('');
      expect(e.whenToUse.length).toBeGreaterThan(6);
      expect(e.whenToUse).toContain('时');
    }
  });

  it('清单项全部存在于真实工具面（TOOLS）', () => {
    expect(() => assertAllowList(TOOLS.map((t) => t.name))).not.toThrow();
  });
});

describe('A37 ② · 握手 instructions 的声明顺序', () => {
  it('条目顺序与 allow-list 声明序逐位一致', () => {
    const text = buildInstructions();
    const lines = text.split('\n').filter((l) => /^\d+\./.test(l));
    expect(lines).toHaveLength(DEFAULT_MCP_ALLOWLIST.length);
    lines.forEach((line, i) => {
      expect(line).toContain(DEFAULT_MCP_ALLOWLIST[i]!.name);
      expect(line).toContain(DEFAULT_MCP_ALLOWLIST[i]!.whenToUse);
    });
  });
});

describe('A37 ③ · 启动期对账（不存在即启动失败）', () => {
  it('故意删一条名单项 ⇒ 抛错并指名（不静默跳过）', () => {
    const available = TOOLS.map((t) => t.name).filter((n) => n !== 'run_audit');
    expect(() => assertAllowList(available)).toThrow(/run_audit.*不存在/);
  });

  it('env 名单含未登记文案的工具 ⇒ 解析即拒（新接口进面须先补「何时该用」）', () => {
    expect(() => resolveAllowList({ SOFAGENT_MCP_ALLOWLIST: 'run_audit,ghost_tool' }))
      .toThrow(/ghost_tool 未登记/);
  });

  it('未设 / 设 0 ⇒ 不启用（保持既有全量暴露语义）', () => {
    expect(resolveAllowList({})).toBeNull();
    expect(resolveAllowList({ SOFAGENT_MCP_ALLOWLIST: '0' })).toBeNull();
    expect(resolveAllowList({ SOFAGENT_MCP_ALLOWLIST: '1' })?.source).toBe('default');
  });
});

describe('A37 ④ · 暴露比台账', () => {
  it('按真实工具面算比值（形如「暴露 N / 可用 104」）', () => {
    expect(exposureLedger(TOOLS.length)).toBe(`暴露 ${DEFAULT_MCP_ALLOWLIST.length} / 可用 ${TOOLS.length}`);
    expect(TOOLS.length).toBe(104);
  });
});

describe('A37 ⑤ · 禁服务级 token', () => {
  it('干净环境通过；出现服务级长期凭证即抛错并指名', () => {
    expect(() => assertNoServiceToken({})).not.toThrow();
    expect(() => assertNoServiceToken({ SOFAGENT_SERVICE_TOKEN: 'sk-xxx' }))
      .toThrow(/SOFAGENT_SERVICE_TOKEN.*账户/);
  });
});

describe('A37 ⑥ · 默认拒绝', () => {
  it('名单内 true / 名单外 false（新工具默认不进面）', () => {
    expect(isAllowed('run_audit')).toBe(true);
    expect(isAllowed('delete_entity')).toBe(false);
  });
});

describe('A37 ⑦ · 误导就绪的接口', () => {
  it('当前为零（口径：声称就绪但无探测）；若登记则被挡在名单外', () => {
    expect(MISLEADING_READINESS_TOOLS).toHaveLength(0);
    expect(() => assertNoMisleadingTools()).not.toThrow();
  });

  it('守卫本身有效：把清单项登记为「声称就绪」⇒ 立刻抛错指名', () => {
    expect(() => assertNoMisleadingTools(DEFAULT_MCP_ALLOWLIST, ['health_check']))
      .toThrow(/health_check.*须先删\/改/);
  });
});
