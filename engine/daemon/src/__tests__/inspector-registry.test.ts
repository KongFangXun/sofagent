// ============================================================
// inspector-registry.test.ts · 金名单测试（v1.4.8 深模块条目 2 第 0 步）
// ============================================================
// 背景：既有 inspector-layers 断言是自指的（拿注册表长度比注册表长度），
// 漏挂时两边一起缩水、测试照样绿——漂移无人察觉的机制。本测试用
// 硬编码金名单（期望名独立于实现），漏挂/错层立即红。
// ============================================================
import { describe, expect, it } from 'vitest';
import { INSPECTORS, listInspectors } from '../inspectors/registry';
import { getLayerInspectorNames, runLayeredInspection } from '../inspector-layers';

// 🔴 金名单（硬编码期望——改注册表须同步改这里，双向锁）
const GOLDEN_L1 = [
  'audit-history', 'doctor-health', 'warn-accumulator', 'data-sovereignty-daily',
  'workspace-summary', 'eval-failures', 'daily-snapshot', 'task-stats',
  'commons-catalog-daily', 'fde-companion-daily', 'fde-registry-daily',
  'train-orphan-scan',
  'audit-trail', // v1.4.8 条目 2：漂移修复入层（v1.3.2 交付后首次进活路径）
];
const GOLDEN_L2 = [
  'conflict-check', 'knowledge-freshness', 'knowledge-health', 'skill-staleness',
  'data-sovereignty-weekly', 'evolve-trigger', 'trend-aggregator', 'commons-health',
];
const GOLDEN_L3 = [
  'federation-distillation', 'failure-pattern', 'ontology-coverage', 'data-sovereignty-monthly',
];

describe('巡检器金名单（条目 2 第 0 步——防漏挂/防漂移）', () => {
  it('L1 金名单精确匹配（13 个，含 audit-trail 漂移修复）', () => {
    expect(listInspectors('L1')).toEqual(GOLDEN_L1);
  });
  it('L2 金名单精确匹配（8 个）', () => {
    expect(listInspectors('L2')).toEqual(GOLDEN_L2);
  });
  it('L3 金名单精确匹配（4 个）', () => {
    expect(listInspectors('L3')).toEqual(GOLDEN_L3);
  });
  it('注册表无重名（25 条目键唯一）', () => {
    const names = Object.keys(INSPECTORS);
    expect(new Set(names).size).toBe(names.length);
  });
  it('调度层名称列表与注册表一致（派生不自指）', () => {
    expect(getLayerInspectorNames('L1')).toEqual(listInspectors('L1'));
    expect(getLayerInspectorNames('L2')).toEqual(listInspectors('L2'));
    expect(getLayerInspectorNames('L3')).toEqual(listInspectors('L3'));
  });
  it('runLayeredInspection 实际执行集合 == 金名单（cron 各层真实跑什么）', () => {
    // 用真执行验证：结果条目名集合（含 disabled 的 skill-staleness 除外）与金名单一致
    // 在临时目录跑（巡检器对空目录安全——大多返回 not-triggered）
    const os = require('os') as typeof import('os');
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-golden-'));
    try {
      const r1 = runLayeredInspection(tmp, 'L1', 'manual');
      const executedNames = r1.results.map((x) => x.name);
      // disabled 条目（skill-staleness）不在 L1；enabled 全跑
      expect(executedNames.sort()).toEqual(GOLDEN_L1.slice().sort());
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
