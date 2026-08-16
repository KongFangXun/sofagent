// ============================================================
// commons-owner.test.ts · owner 声明 + trust 三态 + 退役恢复测试（v1.3.4 交付 3）
//
// 验收：
//   - owner 声明（新建初始 trust=0.5）
//   - trust 三态：初始 0.5 → 5 条好评 ≥0.6 → 退役后 ≤0.4
//   - 退役不删除（可恢复）
//   - 强制 owner 确认
//   - 养护记录进审计（kind=EVOLUTION）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  declareOwner,
  getTrust,
  getOwner,
  updateTrustOnRating,
  penalizeOnRetire,
  clampTrust,
  classifyTrust,
  readOwners,
  TRUST_INITIAL,
  TRUST_GOOD_THRESHOLD,
  TRUST_BAD_THRESHOLD,
  TRUST_UPVOTE_COUNT,
} from '../commons/owner';
import {
  markRetired,
  restoreCapability,
  getCapabilityStatus,
  scanRetireCandidates,
} from '../commons/retire';
import { publishCapability, type CapabilityMetadata } from '../commons/publisher';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-owner-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 构造合法能力元数据 */
function makeMeta(overrides: Partial<CapabilityMetadata> = {}): CapabilityMetadata {
  return {
    id: 'test-cap',
    kind: 'skill',
    name: '测试 Skill',
    description: '测试用 Skill',
    version: '1.0.0',
    owner: 'agent-owner-001',
    tags: ['test'],
    sourcePath: '',
    ...overrides,
  };
}

// v1.3.5 阶段五：全量并行 IO 争用偶发超时——文件级 timeout 20s
describe('commons-owner + retire 养护环', { timeout: 20000 }, () => {
  let testDir: string;
  let skillDir: string;

  beforeEach(() => {
    testDir = tmpDir();
    skillDir = join(testDir, 'skills', 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '# 测试 Skill\n\n安全的 Skill。\n\n## 示例\n\n测试用。\n',
    );
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  describe('clampTrust + classifyTrust 辅助', () => {
    it('clampTrust 边界 [0.0, 1.0]', () => {
      expect(clampTrust(-0.5)).toBe(0.0);
      expect(clampTrust(1.5)).toBe(1.0);
      expect(clampTrust(0.5)).toBe(0.5);
    });

    it('classifyTrust 三态判定', () => {
      expect(classifyTrust(0.6)).toBe('good');
      expect(classifyTrust(0.5)).toBe('initial');
      expect(classifyTrust(0.4)).toBe('bad');
      expect(classifyTrust(0.3)).toBe('bad');
      expect(classifyTrust(0.55)).toBe('initial');
    });
  });

  describe('declareOwner owner 声明', () => {
    it('新建 owner → 初始 trust=0.5', () => {
      const rec = declareOwner('agent-owner-001', 'FDE 张三', testDir);
      expect(rec.ownerId).toBe('agent-owner-001');
      expect(rec.trust).toBe(TRUST_INITIAL);
      expect(rec.upvotes).toBe(0);
      expect(rec.capabilityCount).toBe(1);
    });

    it('同 owner 再次声明 → capabilityCount++，trust 不变', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      const rec = declareOwner('agent-owner-001', undefined, testDir);
      expect(rec.capabilityCount).toBe(2);
      expect(rec.trust).toBe(TRUST_INITIAL);
    });

    it('ownerId 为空 → 抛错（无 owner 不可发布）', () => {
      expect(() => declareOwner('', undefined, testDir)).toThrow();
    });

    it('getTrust 不存在的 owner → 返回初始值 0.5', () => {
      expect(getTrust('nonexistent-agent', testDir)).toBe(TRUST_INITIAL);
    });

    it('getTrust 存在的 owner → 返回记录的 trust', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      expect(getTrust('agent-owner-001', testDir)).toBe(TRUST_INITIAL);
    });
  });

  describe('trust 三态曲线（核心验收）', () => {
    it('初始 0.5 → 收到 5 条好评 → trust ≥ 0.6', () => {
      declareOwner('agent-owner-001', undefined, testDir);

      // 4 条好评还不到阈值
      for (let i = 0; i < TRUST_UPVOTE_COUNT - 1; i++) {
        updateTrustOnRating('agent-owner-001', 0.9, testDir);
      }
      let trust = getTrust('agent-owner-001', testDir);
      // 4 条好评时可能还在 initial 区间
      expect(classifyTrust(trust)).toBe('initial');

      // 第 5 条好评 → 上调到 ≥ 0.6
      trust = updateTrustOnRating('agent-owner-001', 0.9, testDir);
      expect(trust).toBeGreaterThanOrEqual(TRUST_GOOD_THRESHOLD);
      expect(classifyTrust(trust)).toBe('good');
    });

    it('退役后 → trust 下调（向 ≤ 0.4 靠拢）', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      // 先上调到 good
      for (let i = 0; i < TRUST_UPVOTE_COUNT; i++) {
        updateTrustOnRating('agent-owner-001', 0.9, testDir);
      }
      const trustBefore = getTrust('agent-owner-001', testDir);
      expect(trustBefore).toBeGreaterThanOrEqual(TRUST_GOOD_THRESHOLD);

      // 多次退役惩罚 → 下调到 ≤ 0.4
      let trust = trustBefore;
      for (let i = 0; i < 10; i++) {
        trust = penalizeOnRetire('agent-owner-001', testDir);
      }
      expect(trust).toBeLessThanOrEqual(TRUST_BAD_THRESHOLD);
      expect(classifyTrust(trust)).toBe('bad');
    });

    it('差评集中 → trust 下调', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      // 多条差评
      let trust = TRUST_INITIAL;
      for (let i = 0; i < 10; i++) {
        trust = updateTrustOnRating('agent-owner-001', 0.1, testDir);
      }
      expect(trust).toBeLessThan(TRUST_INITIAL);
    });

    it('trust 不超出 [0.0, 1.0] 范围', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      // 大量好评
      let trust = 0;
      for (let i = 0; i < 50; i++) {
        trust = updateTrustOnRating('agent-owner-001', 0.99, testDir);
      }
      expect(trust).toBeLessThanOrEqual(1.0);
    });

    it('不存在的 owner 评价 → trust 不变（返回初始值）', () => {
      const trust = updateTrustOnRating('nonexistent', 0.9, testDir);
      expect(trust).toBe(TRUST_INITIAL);
    });
  });

  describe('退役 + 恢复（不删除）', () => {
    it('owner 声明 → 能力发布 → 声明累计', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      const pub = publishCapability(meta, testDir);
      expect(pub.ok).toBe(true);

      // 发布后由调用方显式声明 owner（owner 声明是独立机制）
      const rec = declareOwner('agent-owner-001', undefined, testDir);
      expect(rec.capabilityCount).toBeGreaterThanOrEqual(1);

      const owner = getOwner('agent-owner-001', testDir);
      expect(owner).not.toBeNull();
    });

    it('退役 → status=retired（不删除，可恢复）', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);

      // 退役前 active
      expect(getCapabilityStatus('test-cap', testDir)).toBe('active');

      // 强制 owner 确认 → 退役成功
      const r = markRetired('test-cap', 'owner_request', true, testDir);
      expect(r.ok).toBe(true);
      expect(getCapabilityStatus('test-cap', testDir)).toBe('retired');
    });

    it('退役需 owner 确认（confirmedByOwner=false → 拒绝）', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);

      const r = markRetired('test-cap', 'owner_request', false, testDir);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('确认');
      // 仍未退役
      expect(getCapabilityStatus('test-cap', testDir)).toBe('active');
    });

    it('退役 → 恢复 → status 改回 active', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);
      markRetired('test-cap', 'low_rating', true, testDir);
      expect(getCapabilityStatus('test-cap', testDir)).toBe('retired');

      const r = restoreCapability('test-cap', testDir);
      expect(r.ok).toBe(true);
      expect(getCapabilityStatus('test-cap', testDir)).toBe('active');
    });

    it('重复退役 → 拒绝（已退役）', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);
      markRetired('test-cap', 'manual', true, testDir);

      const r = markRetired('test-cap', 'manual', true, testDir);
      expect(r.ok).toBe(false);
    });

    it('恢复未退役的能力 → 拒绝', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);

      const r = restoreCapability('test-cap', testDir);
      expect(r.ok).toBe(false);
    });

    it('退役不存在的能力 → 拒绝', () => {
      const r = markRetired('nonexistent', 'manual', true, testDir);
      expect(r.ok).toBe(false);
    });
  });

  describe('退役候选扫描', () => {
    it('扫描低评分能力 → 标记为候选', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);

      const stats = new Map<string, { invokeCount: number; avgRating: number }>([
        ['test-cap', { invokeCount: 10, avgRating: 0.2 }],
      ]);
      const candidates = scanRetireCandidates(testDir, stats);
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      const c = candidates.find((x) => x.capabilityId === 'test-cap');
      expect(c).toBeDefined();
      expect(c!.reason).toBe('low_rating');
    });

    it('扫描低调用量能力 → 标记为候选', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);

      const stats = new Map<string, { invokeCount: number; avgRating: number }>([
        ['test-cap', { invokeCount: 1, avgRating: 0.8 }],
      ]);
      const candidates = scanRetireCandidates(testDir, stats);
      expect(candidates.some((x) => x.capabilityId === 'test-cap')).toBe(true);
    });

    it('已退役能力不在候选中', () => {
      const meta = makeMeta({ sourcePath: skillDir });
      publishCapability(meta, testDir);
      markRetired('test-cap', 'manual', true, testDir);

      const stats = new Map<string, { invokeCount: number; avgRating: number }>([
        ['test-cap', { invokeCount: 0, avgRating: 0.1 }],
      ]);
      const candidates = scanRetireCandidates(testDir, stats);
      expect(candidates.some((x) => x.capabilityId === 'test-cap')).toBe(false);
    });
  });

  describe('readOwners 持久化', () => {
    it('多次更新 → 同 ownerId 取末行（最新覆盖）', () => {
      declareOwner('agent-owner-001', undefined, testDir);
      updateTrustOnRating('agent-owner-001', 0.9, testDir);
      updateTrustOnRating('agent-owner-001', 0.9, testDir);

      const owners = readOwners(testDir);
      const rec = owners.get('agent-owner-001');
      expect(rec).toBeDefined();
      expect(rec!.upvotes).toBe(2);
    });
  });
});
