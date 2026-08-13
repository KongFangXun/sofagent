// ============================================================
// market-rating.test.ts · 评分聚合 + 加权排序 + 防刷测试（v1.3.4 交付 2）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  addRating,
  readRatingsForCapability,
  aggregateRating,
  computeRankScore,
  coldStartFactor,
  rankCapabilities,
  appendInvokeCount,
  getTrustStub,
  getTrustForRating,
  COLD_START_THRESHOLD,
} from '../market/rating';
import { declareOwner, updateTrustOnRating } from '../market/owner';
import { publishCapability, type CapabilityMetadata } from '../market/publisher';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-rating-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeMeta(overrides: Partial<CapabilityMetadata> = {}): CapabilityMetadata {
  return {
    id: 'cap-a',
    kind: 'skill',
    name: '能力 A',
    description: '测试能力',
    version: '1.0.0',
    owner: 'agent-owner-001',
    tags: ['test'],
    sourcePath: '',
    ...overrides,
  };
}

describe('market-rating 评分聚合 + 防刷', () => {
  let testDir: string;
  let skillDir: string;

  beforeEach(() => {
    testDir = tmpDir();
    skillDir = join(testDir, 'skills', 'test');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# 安全 Skill\n\n## 示例\n\n测试。\n');
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  describe('trust 桩 + getTrustForRating', () => {
    it('getTrustStub 返回固定 0.5', () => {
      expect(getTrustStub('any')).toBe(0.5);
      expect(getTrustStub()).toBe(0.5);
    });

    it('getTrustForRating 不存在的 owner → 返回初始 0.5', () => {
      expect(getTrustForRating('nonexistent', testDir)).toBe(0.5);
    });

    it('getTrustForRating 存在的 owner → 返回真实 trust', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      // 提交好评提升 trust
      for (let i = 0; i < 6; i++) {
        updateTrustOnRating('agent-owner-001', 0.9, testDir);
      }
      expect(getTrustForRating('agent-owner-001', testDir)).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe('addRating 评价写入', () => {
    it('写入一条评价', () => {
      addRating({ capabilityId: 'cap-a', raterId: 'r1', score: 0.8 }, testDir);
      const ratings = readRatingsForCapability('cap-a', testDir);
      expect(ratings.length).toBe(1);
      expect(ratings[0]!.score).toBe(0.8);
    });

    it('score 超范围 → 抛错', () => {
      expect(() => addRating({ capabilityId: 'cap-a', raterId: 'r1', score: 1.5 }, testDir)).toThrow();
      expect(() => addRating({ capabilityId: 'cap-a', raterId: 'r1', score: -0.1 }, testDir)).toThrow();
    });

    it('缺 capabilityId/raterId → 抛错', () => {
      expect(() => addRating({ capabilityId: '', raterId: 'r1', score: 0.5 }, testDir)).toThrow();
    });
  });

  describe('防刷：同 rater 同能力仅一票（后评覆盖前评）', () => {
    it('同一 rater 多次评价 → 只计最后一票', () => {
      addRating({ capabilityId: 'cap-a', raterId: 'r1', score: 0.9 }, testDir);
      addRating({ capabilityId: 'cap-a', raterId: 'r1', score: 0.1 }, testDir); // 后评覆盖
      addRating({ capabilityId: 'cap-a', raterId: 'r1', score: 0.5 }, testDir); // 再覆盖

      const ratings = readRatingsForCapability('cap-a', testDir);
      expect(ratings.length).toBe(1); // 防刷：只 1 票
      expect(ratings[0]!.score).toBe(0.5); // 最后一次
    });

    it('不同 rater 各计一票', () => {
      addRating({ capabilityId: 'cap-a', raterId: 'r1', score: 0.8 }, testDir);
      addRating({ capabilityId: 'cap-a', raterId: 'r2', score: 0.6 }, testDir);
      addRating({ capabilityId: 'cap-a', raterId: 'r3', score: 0.9 }, testDir);

      const ratings = readRatingsForCapability('cap-a', testDir);
      expect(ratings.length).toBe(3);
    });
  });

  describe('computeRankScore 排序分公式', () => {
    it('公式 = trust × averageScore × log(invokeCount+1)', () => {
      const score = computeRankScore(0.5, 0.8, 10, 1.0);
      const expected = Math.round(0.5 * 0.8 * Math.log(11) * 10000) / 10000;
      expect(score).toBe(expected);
    });

    it('invokeCount=0 → log(1)=0 → 排序分为 0', () => {
      expect(computeRankScore(1.0, 1.0, 0, 1.0)).toBe(0);
    });

    it('冷启动折扣生效（×0.8）', () => {
      const normal = computeRankScore(0.5, 0.8, 10, 1.0);
      const cold = computeRankScore(0.5, 0.8, 10, 0.8);
      expect(cold).toBeLessThan(normal);
    });
  });

  describe('coldStartFactor 冷启动折扣', () => {
    it('评价数 < 阈值 → 折扣 0.8', () => {
      expect(coldStartFactor(0)).toBe(0.8);
      expect(coldStartFactor(COLD_START_THRESHOLD - 1)).toBe(0.8);
    });

    it('评价数 ≥ 阈值 → 折扣 1.0', () => {
      expect(coldStartFactor(COLD_START_THRESHOLD)).toBe(1.0);
      expect(coldStartFactor(100)).toBe(1.0);
    });
  });

  describe('aggregateRating 聚合评分', () => {
    it('无评价 → 平均 0，冷启动', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      const agg = aggregateRating('cap-a', 'agent-owner-001', testDir);
      expect(agg.averageScore).toBe(0);
      expect(agg.count).toBe(0);
      expect(agg.coldStart).toBe(true);
    });

    it('多条评价 → 算术平均', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      addRating({ capabilityId: 'cap-a', raterId: 'r1', score: 0.8 }, testDir);
      addRating({ capabilityId: 'cap-a', raterId: 'r2', score: 0.6 }, testDir);

      const agg = aggregateRating('cap-a', 'agent-owner-001', testDir);
      expect(agg.count).toBe(2);
      expect(agg.averageScore).toBeCloseTo(0.7, 5);
    });
  });

  describe('rankCapabilities 加权排序（高频高价值上浮）', () => {
    it('高频高价值能力排在低价值前面', () => {
      // owner 声明
      declareOwner('owner-good', undefined, testDir);
      declareOwner('owner-bad', undefined, testDir);

      // 能力 A：高频高评分
      publishCapability(makeMeta({ id: 'cap-good', owner: 'owner-good', sourcePath: skillDir }), testDir);
      for (let i = 0; i < 12; i++) {
        addRating({ capabilityId: 'cap-good', raterId: `r-${i}`, score: 0.9 }, testDir);
      }
      // 模拟调用量（写 invoke-count）
      for (let i = 0; i < 20; i++) appendInvokeCount('cap-good', testDir);

      // 能力 B：低频低评分
      publishCapability(makeMeta({ id: 'cap-bad', owner: 'owner-bad', sourcePath: skillDir }), testDir);
      addRating({ capabilityId: 'cap-bad', raterId: 'r1', score: 0.2 }, testDir);
      appendInvokeCount('cap-bad', testDir);

      const ranked = rankCapabilities(
        [
          { id: 'cap-bad', owner: 'owner-bad' },
          { id: 'cap-good', owner: 'owner-good' },
        ],
        testDir,
      );

      // cap-good 排在前面
      expect(ranked[0]!.id).toBe('cap-good');
      expect(ranked[0]!.rating.rankScore).toBeGreaterThan(ranked[1]!.rating.rankScore);
    });
  });
});
