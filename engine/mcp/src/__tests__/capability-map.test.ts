// ============================================================
// capability-map.test.ts · list_capabilities 可拔能力地图（v1.5.7 章五）
// ============================================================
// 断言三面：
//   ① 清单可达态（仓内运行）：capabilityMap 含 18 能力单元 + 12 shim 台账，
//      且逐单元带档位名/默认值/依赖级联/关档失效面（验收锚「返回可拔能力地图」）
//   ② 与 SSOT 双向一致：返回的单元集合 = engine/capabilities.json 原文集合
//   ③ 人读文本面：text 含「可拔能力地图」段（Agent 侧可直接读档位与依赖）
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { listCapabilities } from '../tools/report-tools';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const MANIFEST = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'engine', 'capabilities.json'), 'utf8'),
) as {
  capabilities: Array<{ id: string; gate: { name: string; default: boolean }; dependsOn: string[] }>;
  shims: Array<{ cli: string }>;
};

describe('list_capabilities · 可拔能力地图（v1.5.7 章五）', () => {
  const result = listCapabilities();
  const map = (result.data as { capabilityMap: Record<string, unknown> }).capabilityMap;

  it('清单可达：地图带 units/shimRegistry，单元数与 SSOT 一致', () => {
    expect(map['units']).toBeDefined();
    expect(map['shimRegistry']).toBeDefined();
    const units = map['units'] as Array<{ id: string }>;
    expect(units.map((u) => u.id).sort()).toEqual(MANIFEST.capabilities.map((c) => c.id).sort());
    const shims = (map['shimRegistry'] as { shims: Array<{ cli: string }> }).shims;
    expect(shims.map((s) => s.cli).sort()).toEqual(MANIFEST.shims.map((s) => s.cli).sort());
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
    expect(result.text).toContain('shim 台账');
  });

  it('声明依赖的单元：dependsOn 逐项映射回 SSOT 原文（防渲染层丢失）', () => {
    const units = map['units'] as Array<{ id: string; dependsOn: string[] }>;
    const byId = new Map(MANIFEST.capabilities.map((c) => [c.id, c.dependsOn]));
    for (const u of units) {
      expect(u.dependsOn).toEqual(byId.get(u.id) ?? []);
    }
  });
});
