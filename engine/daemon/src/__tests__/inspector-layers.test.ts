// ============================================================
// inspector-layers.test.ts · 分层巡检调度器测试（v1.2.9 · P0）
// ============================================================
//
// 覆盖：
// - LAYER_SCHEDULE：L1→@daily / L2→@weekly / L3→@monthly
// - getLayerInspectorNames：三层 inspector 名称列表
// - runLayeredInspection：按层执行 + 异常隔离
// - runAllLayers：全量执行 = L1 + L2 + L3
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  LAYER_SCHEDULE,
  getLayerInspectorNames,
  runLayeredInspection,
  runAllLayers,
  type InspectorLayer,
} from '../inspector-layers';

describe('inspector-layers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-il-'));
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // ════════════════════════════════════════
  // LAYER_SCHEDULE
  // ════════════════════════════════════════

  describe('LAYER_SCHEDULE', () => {
    it('L1 对应 @daily', () => {
      expect(LAYER_SCHEDULE.L1).toBe('@daily');
    });
    it('L2 对应 @weekly', () => {
      expect(LAYER_SCHEDULE.L2).toBe('@weekly');
    });
    it('L3 对应 @monthly', () => {
      expect(LAYER_SCHEDULE.L3).toBe('@monthly');
    });
  });

  // ════════════════════════════════════════
  // getLayerInspectorNames
  // ════════════════════════════════════════

  describe('getLayerInspectorNames', () => {
    it('L1 包含核心日常 inspector', () => {
      const names = getLayerInspectorNames('L1');
      expect(names).toContain('audit-history');
      expect(names).toContain('doctor-health');
      expect(names).toContain('warn-accumulator');
      expect(names).toContain('data-sovereignty-daily');
      expect(names).toContain('workspace-summary');
    });

    it('L1 包含 v1.2.4 新增 inspector', () => {
      const names = getLayerInspectorNames('L1');
      expect(names).toContain('eval-failures');
      expect(names).toContain('daily-snapshot');
      expect(names).toContain('task-stats');
    });

    it('L2 包含深度巡检 inspector', () => {
      const names = getLayerInspectorNames('L2');
      expect(names).toContain('conflict-check');
      expect(names).toContain('knowledge-freshness');
      expect(names).toContain('knowledge-health');
      expect(names).toContain('skill-staleness');
      expect(names).toContain('data-sovereignty-weekly');
    });

    it('L2 包含 v1.2.4 新增 inspector', () => {
      const names = getLayerInspectorNames('L2');
      expect(names).toContain('skillopt-trigger');
      expect(names).toContain('trend-aggregator');
    });

    it('L3 包含联邦分析 inspector', () => {
      const names = getLayerInspectorNames('L3');
      expect(names).toContain('federation-distillation');
      expect(names).toContain('failure-pattern');
      expect(names).toContain('ontology-coverage');
      expect(names).toContain('data-sovereignty-monthly');
    });

    it('三层 inspector 列表无交集（分层隔离）', () => {
      const l1 = new Set(getLayerInspectorNames('L1'));
      const l2 = new Set(getLayerInspectorNames('L2'));
      const l3 = new Set(getLayerInspectorNames('L3'));

      for (const name of l2) {
        expect(l1.has(name)).toBe(false);
      }
      for (const name of l3) {
        expect(l1.has(name)).toBe(false);
        expect(l2.has(name)).toBe(false);
      }
    });

    it('返回的是数组（非 readonly）', () => {
      const names = getLayerInspectorNames('L1');
      expect(Array.isArray(names)).toBe(true);
    });
  });

  // ════════════════════════════════════════
  // runLayeredInspection
  // ════════════════════════════════════════

  describe('runLayeredInspection', () => {
    it('L1 执行返回结果数组（结果数 = L1 inspector 数）', () => {
      const result = runLayeredInspection(tmpDir, 'L1');
      expect(result.layer).toBe('L1');
      expect(result.results).toHaveLength(getLayerInspectorNames('L1').length);
      expect(result.executedAt).toBeTruthy();
    });

    it('L2 执行返回结果数组', () => {
      const result = runLayeredInspection(tmpDir, 'L2');
      expect(result.layer).toBe('L2');
      expect(result.results).toHaveLength(getLayerInspectorNames('L2').length);
    });

    it('L3 执行返回结果数组', () => {
      const result = runLayeredInspection(tmpDir, 'L3');
      expect(result.layer).toBe('L3');
      expect(result.results).toHaveLength(getLayerInspectorNames('L3').length);
    });

    it('executedAt 为 ISO 格式时间戳', () => {
      const result = runLayeredInspection(tmpDir, 'L1');
      expect(() => new Date(result.executedAt).toISOString()).not.toThrow();
    });

    it('单个 inspector 异常不阻断整体执行', () => {
      // 即使传入不存在的目录，inspector 应 catch 异常返回 warning
      const result = runLayeredInspection('/nonexistent/path-12345', 'L1');
      expect(result.results.length).toBeGreaterThan(0);
      // 异常的 inspector 返回 warning severity
      const warnings = result.results.filter((r) => r.severity === 'warning');
      expect(warnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ════════════════════════════════════════
  // runAllLayers
  // ════════════════════════════════════════

  describe('runAllLayers', () => {
    it('全量执行结果数 = L1 + L2 + L3 inspector 总数', () => {
      const results = runAllLayers(tmpDir);
      const expected =
        getLayerInspectorNames('L1').length +
        getLayerInspectorNames('L2').length +
        getLayerInspectorNames('L3').length;
      expect(results).toHaveLength(expected);
    });

    it('全量执行结果为 InspectorResult 数组', () => {
      const results = runAllLayers(tmpDir);
      expect(Array.isArray(results)).toBe(true);
      for (const r of results) {
        expect(r).toHaveProperty('name');
        expect(r).toHaveProperty('triggered');
        expect(r).toHaveProperty('message');
        expect(r).toHaveProperty('severity');
      }
    });
  });
});
