// ============================================================
// fde-registry-loader-parity.test.ts · F-49：降级实现与正典对账
// ============================================================
// daemon 的 fde-registry-loader 在 orchestrator 不可用时用**本地等价实现**
// （highRiskNodes = filter(risk==='high')）——上游改语义即静默漂移。
// 本测试做双实现对账（同输入同输出）+ 报错分因两态验证。
// ============================================================

import { describe, it, expect } from 'vitest';
import { highRiskNodes as canonicalHighRiskNodes } from '@sofagent/orchestrator';
import {
  highRiskNodes as fallbackHighRiskNodes,
  loadFDERegistry,
  _resetFdeRegistryModuleCache,
} from '../fde-registry-loader';
import type { FDERegistryNode } from '../fde-registry-types';

function node(id: string, risk: string, cadence = '@daily'): FDERegistryNode {
  return {
    id,
    risk,
    cadence,
    humanGates: [],
    skills: [],
  } as unknown as FDERegistryNode;
}

describe('F-49 · fde-registry-loader 降级实现对账', () => {
  it('降级 highRiskNodes 与正典同输入同输出（三组样本）', () => {
    const samples: FDERegistryNode[][] = [
      [],
      [node('a', 'high'), node('b', 'low'), node('c', 'medium')],
      [node('x', 'low'), node('y', 'low')],
    ];
    for (const s of samples) {
      // 正典（orchestrator 导出）
      const canonical = canonicalHighRiskNodes(s).map((n) => n.id).sort();
      // 降级本地实现
      const fallback = fallbackHighRiskNodes(s).map((n) => n.id).sort();
      expect(fallback).toEqual(canonical);
    }
  });

  it('orchestrator 可用时：loadFDERegistry 走正典（不降级）', () => {
    _resetFdeRegistryModuleCache();
    const r = loadFDERegistry('/tmp/nonexistent-project-for-f49');
    // 正典对不存在的注册表返回 ok:false 且 errors 含「不存在」（非引擎不可用措辞）
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/不存在|not found|missing/i);
    expect(r.errors.join(' ')).not.toContain('模块不可加载');
    expect(r.errors.join(' ')).not.toContain('导出面变更');
  });
});
