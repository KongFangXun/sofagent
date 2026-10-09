// ============================================================
// auto-trigger.test.ts · 自动触发优化测试（v1.2.9 · P1）
// ============================================================
//
// 覆盖：
// - AUTO_TRIGGER_THRESHOLD 常量值 = 3
// - optimize()：失败 < 3 次不触发（返回 skipReason）
// - optimize()：失败 >= 3 次尝试触发（检查 isEvolveAvailable）
// - optimize()：外部 gate CLI 兼容层不可用时跳过
// - getPendingTriggerCount：统计待触发聚类数
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock evolve-integration（隔离 CLI subprocess 调用）
vi.mock('../evolve-integration', () => ({
  isEvolveAvailable: vi.fn(() => false),
  runEvolve: vi.fn(() => ({ success: false, error: 'mocked' })),
  validateCandidate: vi.fn(() => ({ canReplace: false, reason: 'mocked' })),
}));

import {
  AUTO_TRIGGER_THRESHOLD,
  optimize,
  getPendingTriggerCount,
} from '../auto-trigger';
import {
  recordFailure,
  clearFailureCache,
} from '../failure-ledger';
import { initializeRegistryProtected } from '../domain-verifier-registry';
import { isEvolveAvailable } from '../evolve-integration';

/** 写一份 deterministic 档登记表（skill-a → 全自动准入） */
function writeRegistry(dir: string, domains: string[]): void {
  initializeRegistryProtected(dir, domains.map((domain) => ({
    domain,
    tier: 'deterministic' as const,
    basis: 'test-fixture',
    registeredAt: '2026-01-01T00:00:00Z',
  })));
}

describe('auto-trigger', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-at-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    // 准入门 fixture：skill-a 登记 deterministic 档（既有行为测试按全自动准入路径走）
    writeRegistry(tmpDir, ['skill-a']);
    clearFailureCache();
    vi.mocked(isEvolveAvailable).mockReturnValue(false);
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════
  // 常量
  // ════════════════════════════════════════

  describe('AUTO_TRIGGER_THRESHOLD', () => {
    it('阈值为 3', () => {
      expect(AUTO_TRIGGER_THRESHOLD).toBe(3);
    });
  });

  // ════════════════════════════════════════
  // optimize() — 未达阈值路径
  // ════════════════════════════════════════

  describe('optimize — 未达阈值', () => {
    it('第 1 次失败：triggered=false，skipReason 含 "1/3"', async () => {
      const result = await optimize({
        skillId: 'skill-a',
        failureMode: 'format-mismatch',
      });
      expect(result.triggered).toBe(false);
      expect(result.skillId).toBe('skill-a');
      expect(result.skipReason).toContain('1');
      expect(result.skipReason).toContain('3');
    });

    it('第 2 次失败：triggered=false，skipReason 含 "2/3"', async () => {
      // 先记录 1 次
      recordFailure({
        timestamp: '2025-01-01T00:00:00Z',
        skillId: 'skill-a',
        failureMode: 'format-mismatch',
        reason: 'test',
        source: 'test',
      });
      // optimize 内部再记录 1 次（总 2 次）
      const result = await optimize({
        skillId: 'skill-a',
        failureMode: 'format-mismatch',
      });
      expect(result.triggered).toBe(false);
      expect(result.skipReason).toContain('2');
    });
  });

  // ════════════════════════════════════════
  // optimize() — 达到阈值但 evolve 不可用
  // ════════════════════════════════════════

  describe('optimize — 达阈值但 CLI 不可用', () => {
    it('第 3 次失败：triggered=false，skipReason 含 "不可用"', async () => {
      // 先记录 2 次
      for (let i = 0; i < 2; i++) {
        recordFailure({
          timestamp: `2025-01-0${i + 1}T00:00:00Z`,
          skillId: 'skill-a',
          failureMode: 'format-mismatch',
          reason: 'test',
          source: 'test',
        });
      }
      // optimize 记录第 3 次 → 达到阈值
      vi.mocked(isEvolveAvailable).mockReturnValue(false);

      const result = await optimize({
        skillId: 'skill-a',
        failureMode: 'format-mismatch',
      });
      expect(result.triggered).toBe(false);
      expect(result.skipReason).toContain('不可用');
    });
  });

  // ════════════════════════════════════════
  // optimize() — 达到阈值且 CLI 可用
  // ════════════════════════════════════════

  describe('optimize — 达阈值且 CLI 可用', () => {
    it('第 3 次失败 + CLI 可用：triggered=true', async () => {
      for (let i = 0; i < 2; i++) {
        recordFailure({
          timestamp: `2025-01-0${i + 1}T00:00:00Z`,
          skillId: 'skill-a',
          failureMode: 'format-mismatch',
          reason: 'test',
          source: 'test',
        });
      }

      vi.mocked(isEvolveAvailable).mockReturnValue(true);
      const { runEvolve } = await import('../evolve-integration');
      vi.mocked(runEvolve).mockReturnValue({
        success: true,
        candidatePath: '/tmp/candidate.md',
      });

      const result = await optimize({
        skillId: 'skill-a',
        failureMode: 'format-mismatch',
      });
      expect(result.triggered).toBe(true);
      expect(result.skillOptResult).toBeDefined();
      expect(result.skillOptResult?.success).toBe(true);
    });

    it('CLI 可用但 runEvolve 失败：triggered=true 但含 skipReason', async () => {
      for (let i = 0; i < 2; i++) {
        recordFailure({
          timestamp: `2025-01-0${i + 1}T00:00:00Z`,
          skillId: 'skill-a',
          failureMode: 'format-mismatch',
          reason: 'test',
          source: 'test',
        });
      }

      vi.mocked(isEvolveAvailable).mockReturnValue(true);
      const { runEvolve } = await import('../evolve-integration');
      vi.mocked(runEvolve).mockReturnValue({
        success: false,
        error: 'CLI crash',
      });

      const result = await optimize({
        skillId: 'skill-a',
        failureMode: 'format-mismatch',
      });
      expect(result.triggered).toBe(true);
      expect(result.skipReason).toContain('失败');
    });
  });

  // ════════════════════════════════════════
  // optimize() — 进化准入门（v1.5.8 章一接线）
  // ════════════════════════════════════════

  describe('optimize — 进化准入门', () => {
    it('磁盘无登记表 → fail-closed 不启动进化（skipReason 含「准入登记表不可用」）', async () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-at-noreg-'));
      try {
        const result = await optimize({
          skillId: 'skill-a',
          failureMode: 'format-mismatch',
          admission: { dataDir: emptyDir },
        });
        expect(result.triggered).toBe(false);
        expect(result.skipReason).toContain('准入登记表不可用');
        expect(result.skipReason).toContain('fail-closed');
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });

    it('human-only 档 → 零自动晋升：达阈值也阻断（skipReason 含「准入门阻断」+ admissionVerdict 随行）', async () => {
      // 达阈值：先记 2 次，optimize 内部记第 3 次
      for (let i = 0; i < 2; i++) {
        recordFailure({
          timestamp: `2025-01-0${i + 1}T00:00:00Z`,
          skillId: 'skill-human',
          failureMode: 'format-mismatch',
          reason: 'test',
          source: 'test',
        });
      }
      const hitlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-at-hitl-'));
      try {
        initializeRegistryProtected(hitlDir, [{
          domain: 'skill-human',
          tier: 'human-only',
          basis: '开放式产出域——强制 HITL',
          registeredAt: '2026-01-01T00:00:00Z',
        }]);
        const result = await optimize({
          skillId: 'skill-human',
          failureMode: 'format-mismatch',
          admission: { dataDir: hitlDir },
        });
        expect(result.triggered).toBe(false);
        expect(result.skipReason).toContain('准入门阻断');
        expect(result.skipReason).toContain('human-only');
        expect(result.admissionVerdict?.action).toBe('human-only');
      } finally {
        fs.rmSync(hitlDir, { recursive: true, force: true });
      }
    });

    it('model-judge 档 → action=auto-with-review ≠ auto：阻断待采样人审', async () => {
      const mjDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-at-mj-'));
      try {
        initializeRegistryProtected(mjDir, [{
          domain: 'skill-mj',
          tier: 'model-judge',
          basis: 'LLM 评分域——评分 + 采样人审',
          registeredAt: '2026-01-01T00:00:00Z',
        }]);
        const result = await optimize({
          skillId: 'skill-mj',
          failureMode: 'format-mismatch',
          admission: { dataDir: mjDir },
        });
        expect(result.triggered).toBe(false);
        expect(result.skipReason).toContain('准入门阻断');
        expect(result.skipReason).toContain('auto-with-review');
      } finally {
        fs.rmSync(mjDir, { recursive: true, force: true });
      }
    });

    it('未登记域 → fail-closed 按最高档 human-only 阻断', async () => {
      const result = await optimize({
        skillId: 'skill-unregistered',
        failureMode: 'format-mismatch',
      });
      expect(result.triggered).toBe(false);
      expect(result.skipReason).toContain('准入门阻断');
      expect(result.skipReason).toContain('human-only');
    });

    it('deterministic 档 → 放行进主流程（skipReason 不含「准入门」）', async () => {
      const result = await optimize({
        skillId: 'skill-a', // beforeEach fixture：deterministic
        failureMode: 'format-mismatch',
      });
      expect(result.triggered).toBe(false); // 未达阈值被阈值门拦，非准入门
      expect(result.skipReason ?? '').not.toContain('准入门');
      expect(result.skipReason ?? '').not.toContain('准入登记表');
    });
  });

  // ════════════════════════════════════════
  // optimize() — 源标记
  // ════════════════════════════════════════

  describe('optimize — source 默认值', () => {
    it('未传 source 时默认为 "auto-trigger"', async () => {
      await optimize({
        skillId: 'skill-a',
        failureMode: 'mode-1',
      });
      // 验证记录写入 ledger
      const { getFailurePatternsBySkill } = await import('../failure-ledger');
      const patterns = getFailurePatternsBySkill('skill-a');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].sample.source).toBe('auto-trigger');
    });
  });

  // ════════════════════════════════════════
  // getPendingTriggerCount
  // ════════════════════════════════════════

  describe('getPendingTriggerCount', () => {
    it('无失败记录时返回 0', () => {
      expect(getPendingTriggerCount()).toBe(0);
    });

    it('有 >= 3 次同类失败时返回对应聚类数', () => {
      for (let i = 0; i < 3; i++) {
        recordFailure({
          timestamp: `2025-01-0${i + 1}T00:00:00Z`,
          skillId: 'skill-a',
          failureMode: 'mode-1',
          reason: 'test',
          source: 'test',
        });
      }
      expect(getPendingTriggerCount()).toBe(1);
    });
  });
});
