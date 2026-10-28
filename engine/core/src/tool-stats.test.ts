// ============================================================
// tool-stats.test.ts · N13 回归锁：called 视图 registry 过滤 + external 视图
// ============================================================
// 缺陷背景：usage-tracker 无差别记录宿主侧工具（WorkBuddy 的
// conversation_search）——called 视图曾直接按遥测聚合，registry 外名字
// 混入「被调用清单」致计数面污染（实测 11+94=105 ≠ registry 104）。
//
// 锁定契约：
//   1. called 仅含 registry 内工具名（外部名不混入）
//   2. external 含外部名 + 次数（升序，不丢弃不静默）
//   3. totalRecords 仍为全量数（分面不改账本）
//   4. registry 不可达软降级时行为不变（原样聚合，external 空）
//   5. 频次分布与 called 同源同过滤
//
// 沙箱：SOFAGENT_DATA 预置到 tmp 目录（vitest-setup.mjs 已全局兜底；
// 本文件显式设自己的沙箱目录，避免与其他测试文件共享 dataDir 状态）。
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildToolStats, renderToolStats, resolveToolUsagePath } from './tool-stats';

let sandboxDir: string;
let prevDataEnv: string | undefined;

/** 造一条遥测行（schemaVersion=1，与 usage-tracker 落盘形状同构） */
function usageLine(tool: string, ts: string): string {
  return JSON.stringify({ schemaVersion: 1, tool, ts, sessionId: 'test-session' });
}

beforeAll(() => {
  sandboxDir = mkdtempSync(join(tmpdir(), 'sofagent-tool-stats-test-'));
  prevDataEnv = process.env.SOFAGENT_DATA;
  process.env.SOFAGENT_DATA = sandboxDir;
});

afterAll(() => {
  if (prevDataEnv === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = prevDataEnv;
  try { rmSync(sandboxDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('buildToolStats · N13 registry 过滤（四视图契约）', () => {
  it('called 只含 registry 内工具；external 含外部名+次数；totalRecords 仍为全量数', () => {
    // fixture：registry 内 2 工具 + 外部 1 工具（conversation_search——宿主侧）
    writeFileSync(
      resolveToolUsagePath(),
      [
        usageLine('audit_diff', '2026-01-02T00:00:00.000Z'),
        usageLine('audit_diff', '2026-01-03T00:00:00.000Z'),
        usageLine('memory_search', '2026-01-01T00:00:00.000Z'),
        usageLine('conversation_search', '2026-01-04T00:00:00.000Z'),
      ].join('\n') + '\n',
      'utf-8',
    );

    const report = buildToolStats(['audit_diff', 'memory_search', 'never_used_tool']);

    // ① called 只含 registry 内两工具（conversation_search 不混入）
    expect(report.called.map((c) => c.tool).sort()).toEqual(['audit_diff', 'memory_search']);
    expect(report.called.find((c) => c.tool === 'audit_diff')?.count).toBe(2);
    expect(report.called.find((c) => c.tool === 'memory_search')?.count).toBe(1);

    // ② 零调用清单 = registry 全集 − 已调用
    expect(report.neverCalled).toEqual(['never_used_tool']);

    // ③ 频次分布与 called 同源同过滤（不含外部名）
    expect(report.distribution.map((d) => d.tool).sort()).toEqual(['audit_diff', 'memory_search']);
    expect(report.registryAvailable).toBe(true);

    // ④ external 含外部名 + 次数；totalRecords 仍为全量 4 条（分面不改账本）
    expect(report.external).toEqual([{ tool: 'conversation_search', count: 1 }]);
    expect(report.totalRecords).toBe(4);
  });

  it('多个外部工具按名字升序排列，次数保留全量', () => {
    writeFileSync(
      resolveToolUsagePath(),
      [
        usageLine('zzz_host_tool', '2026-01-01T00:00:00.000Z'),
        usageLine('conversation_search', '2026-01-02T00:00:00.000Z'),
        usageLine('conversation_search', '2026-01-03T00:00:00.000Z'),
        usageLine('aaa_legacy_tool', '2026-01-04T00:00:00.000Z'),
      ].join('\n') + '\n',
      'utf-8',
    );

    const report = buildToolStats(['audit_diff']);

    // called 只剩 registry 内（此处零命中——遥测全是外部名）
    expect(report.called).toEqual([]);
    // external 按名字升序 + 次数聚合正确
    expect(report.external).toEqual([
      { tool: 'aaa_legacy_tool', count: 1 },
      { tool: 'conversation_search', count: 2 },
      { tool: 'zzz_host_tool', count: 1 },
    ]);
    expect(report.totalRecords).toBe(4);
  });

  it('无参调用走动态 require 路径：registry 可达时外部名同样被滤出 called', () => {
    writeFileSync(
      resolveToolUsagePath(),
      [
        usageLine('audit_diff', '2026-01-01T00:00:00.000Z'),
        usageLine('conversation_search', '2026-01-02T00:00:00.000Z'),
      ].join('\n') + '\n',
      'utf-8',
    );

    // 无参调用：走动态 require 分支——本仓 workspace 链接下 registry 可达，
    // conversation_search 必在 registry（全集）之外 ⇒ external 必含它
    // （对真实安装态也成立：registry 里确无此名——宿主侧工具）。此用例
    // 同时锁住「有 registry 时过滤生效」的动态路径。软降级态（require 失败、
    // registryAvailable=false、不滤不改账）在 CI 无 mcp dist 的环境下天然覆盖。
    const report = buildToolStats();

    expect(report.registryAvailable).toBe(true);
    expect(report.called.some((c) => c.tool === 'conversation_search')).toBe(false);
    expect(report.external.some((e) => e.tool === 'conversation_search')).toBe(true);
    expect(report.totalRecords).toBe(2);
  });

  it('显式空数组是「可达且空全集」语义：一切遥测名入 external，不与不可达混淆', () => {
    writeFileSync(
      resolveToolUsagePath(),
      [usageLine('audit_diff', '2026-01-01T00:00:00.000Z')].join('\n') + '\n',
      'utf-8',
    );

    // 空数组是显式全集（[] !== undefined）——一切遥测名都在全集外：
    // called 空、external 含全部、registryAvailable=true（显式全集语义，
    // 不与「不可达」混淆）
    const report = buildToolStats([]);

    expect(report.called).toEqual([]);
    expect(report.external).toEqual([{ tool: 'audit_diff', count: 1 }]);
    expect(report.neverCalled).toEqual([]);
    expect(report.registryAvailable).toBe(true);
  });

  it('无遥测数据：全视图空面 + totalRecords=0（外部行不打印）', () => {
    rmSync(resolveToolUsagePath(), { force: true });
    const report = buildToolStats(['audit_diff']);
    expect(report.called).toEqual([]);
    expect(report.neverCalled).toEqual(['audit_diff']);
    expect(report.external).toEqual([]);
    expect(report.totalRecords).toBe(0);

    const out = renderToolStats(report, true);
    expect(out).not.toContain('registry 外工具');
  });
});

describe('renderToolStats · external 视图渲染（N13 输出面）', () => {
  it('registry 外工具打印为末尾 ⓘ 行（名字 ×次数，逗号分隔）', () => {
    writeFileSync(
      resolveToolUsagePath(),
      [
        usageLine('audit_diff', '2026-01-01T00:00:00.000Z'),
        usageLine('conversation_search', '2026-01-02T00:00:00.000Z'),
        usageLine('conversation_search', '2026-01-03T00:00:00.000Z'),
      ].join('\n') + '\n',
      'utf-8',
    );

    const report = buildToolStats(['audit_diff', 'cold_tool']);
    const out = renderToolStats(report, report.registryAvailable);

    // called 清单不含外部名；末尾 ⓘ 行显式呈现外部工具（不丢弃不静默）
    expect(out).not.toMatch(/^\s+conversation_search/m);
    expect(out).toContain('ⓘ registry 外工具 1 个（宿主侧/历史残留——不计入本仓盘点）：conversation_search ×2');
  });

  it('无外部名时不打印 ⓘ 行（渲染面不噪声）', () => {
    writeFileSync(
      resolveToolUsagePath(),
      [usageLine('anything', '2026-01-01T00:00:00.000Z')].join('\n') + '\n',
      'utf-8',
    );

    const report = buildToolStats(['anything']);
    expect(report.external).toEqual([]);
    const out = renderToolStats(report, report.registryAvailable);
    expect(out).not.toContain('ⓘ registry 外工具');
  });
});
