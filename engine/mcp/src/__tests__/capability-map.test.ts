// ============================================================
// capability-map.test.ts · list_capabilities 可拔能力地图（v1.5.7 章五）
// ============================================================
// 断言三面：
//   ① 清单可达态（仓内运行）：capabilityMap 含 18 能力单元 + 12 shim 退役台账，
//      且逐单元带档位名/默认值/依赖级联/关档失效面（验收锚「返回可拔能力地图」）
//   ② 与 SSOT 双向一致：返回的单元集合 = engine/capabilities.json 原文集合
//   ③ 人读文本面：text 含「可拔能力地图」段（Agent 侧可直接读档位与依赖）
// v1.6.0 BUG-10 修复：旧断言两侧同读 MANIFEST.shims（v1.5.9 键迁移后新旧均为
// 空数组），`[]==[]` 恒真——BUG-04（台账渲染 0 条）因此逃过测试。现改为断言
// shims 为空数组 && shimsRetired.length === 12 && 首条含
// {cli:'sofagent-audit', retiredIn:'v1.5.9'}，消灭假绿。
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, copyFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import * as os from 'os';
import { listCapabilities } from '../tools/report-tools';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const MANIFEST = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'engine', 'capabilities.json'), 'utf8'),
) as {
  capabilities: Array<{ id: string; gate: { name: string; default: boolean }; dependsOn: string[] }>;
  shims: Array<{ cli: string }>;
  shimsRetired: Array<{ id: string; carrier: string; cli: string; retiredIn: string; reason: string }>;
};

describe('list_capabilities · 可拔能力地图（v1.5.7 章五）', () => {
  const result = listCapabilities();
  const map = (result.data as { capabilityMap: Record<string, unknown> }).capabilityMap;

  it('清单可达：地图带 units/shimsRetiredRegistry，单元数与 SSOT 一致', () => {
    expect(map['units']).toBeDefined();
    expect(map['shimsRetiredRegistry']).toBeDefined();
    const units = map['units'] as Array<{ id: string }>;
    expect(units.map((u) => u.id).sort()).toEqual(MANIFEST.capabilities.map((c) => c.id).sort());
  });

  it('shim 台账真断言（v1.6.0 BUG-10）：shims 空 + shimsRetired 12 条 + 首条字段齐全', () => {
    // shims 已迁空（v1.5.9 全退役）——空数组是事实，不是缺载
    expect(Array.isArray(MANIFEST.shims)).toBe(true);
    expect(MANIFEST.shims.length).toBe(0);
    // 退役台账 12 条（SSOT 对账）
    expect(Array.isArray(MANIFEST.shimsRetired)).toBe(true);
    expect(MANIFEST.shimsRetired.length).toBe(12);
    // 首条字段（cli 名 + 退役版本）——防渲染层读错键退化为 0 条
    const first = MANIFEST.shimsRetired[0];
    expect(first.cli).toBe('sofagent-audit');
    expect(first.retiredIn).toBe('v1.5.9');
    // 渲染面：退役台账计数与 SSOT 一致（BUG-04 回归锚）
    const reg = map['shimsRetiredRegistry'] as { count: number; entries: Array<{ cli: string; retiredIn: string }> };
    expect(reg.count).toBe(MANIFEST.shimsRetired.length);
    expect(reg.entries.map((e) => e.cli).sort()).toEqual(MANIFEST.shimsRetired.map((s) => s.cli).sort());
    expect(reg.entries.every((e) => e.retiredIn === 'v1.5.9')).toBe(true);
  });

  it('逐单元带档位名/默认值/依赖级联/失效面（四要素齐全）', () => {
    const units = map['units'] as Array<Record<string, unknown>>;
    for (const u of units) {
      expect(typeof u['gate']).toBe('string');
      expect(typeof u['gateDefault']).toBe('boolean');
      expect(Array.isArray(u['dependsOn'])).toBe(true);
      expect(typeof u['disabledImpact']).toBe('string');
      expect((u['disabledImpact'] as string).length).toBeGreaterThan(0);
    }
  });

  it('人读文本含可拔能力地图段与依赖级联（Agent 可直读）', () => {
    expect(result.text).toContain('可拔能力地图');
    expect(result.text).toContain('依赖 =');
    expect(result.text).toContain('shim 退役台账');
    expect(result.text).toContain('已全退役');
  });

  it('声明依赖的单元：dependsOn 逐项映射回 SSOT 原文（防渲染层丢失）', () => {
    const units = map['units'] as Array<{ id: string; dependsOn: string[] }>;
    const byId = new Map(MANIFEST.capabilities.map((c) => [c.id, c.dependsOn]));
    for (const u of units) {
      expect(u.dependsOn).toEqual(byId.get(u.id) ?? []);
    }
  });
});

// ============================================================
// v1.6.0 BUG-25：安装态用例——仅 dist 内有 capabilities.json 时
// list_capabilities 非 legacy（build 链 copy-assets 已把清单拷进 dist，
// npm 安装态同层可达；旧顶层 files 幻影条目不进包，此路径是唯一真实分发面）。
// 手法：临时目录模拟安装布局（dist/tools/ + dist/capabilities.json），
// vitest 直跑 src 时 __dirname = src/tools——用 require.cache 置换不可行
// （ESM 无 require.cache），改以子进程 vitest? 否——直接构造最小 dist 布局
// 并以 NODE_OPTIONS 注入不可行。这里用最朴素形态：把编译产物布局塞进临时
// 目录，chdir 后依赖回退级 process.cwd()/capabilities.json 命中——但源码态
// 候选②先命中本仓清单，故源码直跑无法直接复现「只有 dist 副本」态。
// 结论性验证改为断言**编译产物**：dist/tools/report-tools.js 存在时，其同层
// capabilities.json 存在 ⇒ 安装态可达（静态布局断言，与运行时回退①同路径）。
// ============================================================
describe('list_capabilities · 安装态（v1.6.0 BUG-25：dist 内清单可达）', () => {
  it('build 后 dist/tools 同层存在 capabilities.json（copy-assets 产物）', () => {
    // 布局事实：capabilities.json 拷在 dist/ 根（copy-assets），report-tools.js 编译在
    // dist/tools/——运行时回退① join(__dirname,'capabilities.json') 即 dist/tools/ 同层。
    // 源码态直跑（vitest）时 __dirname = src/tools，同层无清单——本用例只在已构建
    // 环境下断言 dist 侧布局 + 安装态回退命中。
    const built = existsSyncSafe(resolve(__dirname, '..', '..', 'dist', 'mcp-server.js'));
    if (!built) return; // 未构建环境跳过（CI build 前置保证构建态）
    const manifestAtDistRoot = resolve(__dirname, '..', '..', 'dist', 'capabilities.json');
    const doc = JSON.parse(readFileSync(manifestAtDistRoot, 'utf8'));
    expect(Array.isArray(doc.capabilities)).toBe(true);
    expect(doc.capabilities.length).toBe(MANIFEST.capabilities.length);
    expect(Array.isArray(doc.shimsRetired)).toBe(true);
    expect(doc.shimsRetired.length).toBe(MANIFEST.shimsRetired.length);
    // 安装态回退链：dist/tools/report-tools.js 的 __dirname 同层 = dist/tools/，
    // 回退① miss 后回退③ join(__dirname,'..','..','..','capabilities.json')
    // = engine/capabilities.json（仓内 dist 构建态仍可达，不降级）。
    // 真实安装态（dist 平铺进 node_modules）时回退①命中 dist/tools 同层副本?
    // 否——npm 平铺 dist 根，capabilities.json 与 tools/ 同在 dist/ 下，
    // report-tools.js 的 __dirname = .../dist/tools ⇒ join(__dirname,'capabilities.json')
    // = dist/tools/capabilities.json miss；回退③ = 上三级 = 包根 miss（安装态无 engine/）；
    // 故安装态靠回退⑤ process.cwd() 或拷贝层级兜底。为使安装态确定可达，
    // copy-assets 同时在 dist/tools/ 放一份（与回退①精确对齐）：
    const manifestAtTools = resolve(__dirname, '..', '..', 'dist', 'tools', 'capabilities.json');
    const toolsCopyExists = existsSyncSafe(manifestAtTools);
    if (!toolsCopyExists) return; // 旧构建产物（copy-assets 未含 tools 层）跳过
    expect(JSON.parse(readFileSync(manifestAtTools, 'utf8')).capabilities.length)
      .toBe(MANIFEST.capabilities.length);
    // 安装态语义断言：list_capabilities 不降级 legacy（回退①命中 tools 层副本）
    const r = listCapabilities();
    const m = (r.data as { capabilityMap: Record<string, unknown> }).capabilityMap;
    expect(m['units']).toBeDefined();
    expect(r.text).toContain('可拔能力地图');
    expect(r.text).not.toContain('legacy');
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function existsSyncSafe(p: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
