// ============================================================
// auto-trigger.test.ts · 自动触发优化测试（v1.2.9 · P1）
// ============================================================
//
// 覆盖：
// - AUTO_TRIGGER_THRESHOLD 常量值 = 3
// - optimize()：失败 < 3 次不触发（返回 skipReason）
// - optimize()：失败 >= 3 次尝试触发（检查 isSkillOptAvailable）
// - optimize()：skillopt-sleep 不可用时跳过
// - getPendingTriggerCount：统计待触发聚类数
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock skillopt-integration（隔离 CLI subprocess 调用）
vi.mock('../skillopt-integration', () => ({
  isSkillOptAvailable: vi.fn(() => false),
  runSkillOpt: vi.fn(() => ({ success: false, error: 'mocked' })),
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
import { isSkillOptAvailable } from '../skillopt-integration';

describe('auto-trigger', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-at-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    clearFailureCache();
    vi.mocked(isSkillOptAvailable).mockReturnValue(false);
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
  // optimize() — 达到阈值但 skillopt 不可用
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
      vi.mocked(isSkillOptAvailable).mockReturnValue(false);

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

      vi.mocked(isSkillOptAvailable).mockReturnValue(true);
      const { runSkillOpt } = await import('../skillopt-integration');
      vi.mocked(runSkillOpt).mockReturnValue({
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

    it('CLI 可用但 runSkillOpt 失败：triggered=true 但含 skipReason', async () => {
      for (let i = 0; i < 2; i++) {
        recordFailure({
          timestamp: `2025-01-0${i + 1}T00:00:00Z`,
          skillId: 'skill-a',
          failureMode: 'format-mismatch',
          reason: 'test',
          source: 'test',
        });
      }

      vi.mocked(isSkillOptAvailable).mockReturnValue(true);
      const { runSkillOpt } = await import('../skillopt-integration');
      vi.mocked(runSkillOpt).mockReturnValue({
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
