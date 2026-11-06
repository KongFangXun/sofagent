// L228 收口补件：内存档守卫（超阈拒绝加载 · 按档位预算判，不按瞬时空闲）
import { describe, it, expect } from 'vitest';
import { checkMemoryTier, tierOf } from '../router/memory-tier-guard';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

describe('L228 内存档守卫（超阈拒绝加载 · 不降档）', () => {
  it('test_checkMemoryTier_8GB档跑1.7B_可加载（回归：防按瞬时空闲误拒）', () => {
    // 8GB 档：预算 = 8 × 0.8 = 6.4GB；1.7B bf16 = 3.44GB × 1.25 = 4.3GB ⇒ 可加载
    const v = checkMemoryTier({ totalMemBytes: 8 * GB, freeMemBytes: 190 * MB, modelSizeBytes: 3440 * MB });
    expect(v.ok).toBe(true);
    expect(v.tier).toBe('8gb');
    expect(v.requiredBytes).toBe(Math.ceil(3440 * MB * 1.25));
    expect(v.budgetBytes).toBe(Math.floor(8 * GB * 0.8));
    expect(v.detail).toContain('可加载');
    expect(v.detail).toContain('不参与判定');
  });

  it('test_checkMemoryTier_4GB档跑1.7B_拒绝（预算不足）', () => {
    // 4GB 档：预算 3.2GB < 4.3GB ⇒ 拒绝
    const v = checkMemoryTier({ totalMemBytes: 4 * GB, freeMemBytes: 3 * GB, modelSizeBytes: 3440 * MB });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('insufficient-memory');
    expect(v.tier).toBe('4gb');
    expect(v.detail).toContain('拒绝加载');
    expect(v.detail).toContain('缺口');
  });

  it('test_checkMemoryTier_超大模型_16GB档亦拒绝', () => {
    const v = checkMemoryTier({ totalMemBytes: 16 * GB, freeMemBytes: 12 * GB, modelSizeBytes: 200000 * MB });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('insufficient-memory');
    expect(v.tier).toBe('16gb');
  });

  it('test_checkMemoryTier_恰好等于预算_判为可加载（边界含）', () => {
    const total = 16 * GB;
    const budget = Math.floor(total * 0.8);
    // 反推一个刚好等于预算的 requiredBytes
    const modelMaybe = Math.floor(budget / 1.25);
    const v = checkMemoryTier({ totalMemBytes: total, freeMemBytes: 1 * GB, modelSizeBytes: modelMaybe });
    expect(v.requiredBytes <= budget).toBe(true);
    expect(v.ok).toBe(true);
  });

  it('test_checkMemoryTier_非法输入_返回invalid而非抛错（CLI 可统一 exit 码）', () => {
    expect(checkMemoryTier({ totalMemBytes: 0, freeMemBytes: 1 * GB, modelSizeBytes: 100 * MB }).reason).toBe('invalid-input');
    expect(checkMemoryTier({ totalMemBytes: 16 * GB, freeMemBytes: -1, modelSizeBytes: 100 * MB }).reason).toBe('invalid-input');
    expect(checkMemoryTier({ totalMemBytes: 16 * GB, freeMemBytes: 8 * GB, modelSizeBytes: 0 }).reason).toBe('invalid-input');
    expect(checkMemoryTier({ totalMemBytes: 16 * GB, freeMemBytes: 8 * GB, modelSizeBytes: 100 * MB, headroomRatio: 0.5 }).reason).toBe('invalid-input');
    expect(checkMemoryTier({ totalMemBytes: 16 * GB, freeMemBytes: 8 * GB, modelSizeBytes: 100 * MB, usableRatio: 1.5 }).reason).toBe('invalid-input');
    expect(checkMemoryTier({ totalMemBytes: 16 * GB, freeMemBytes: 8 * GB, modelSizeBytes: 100 * MB, usableRatio: 0 }).reason).toBe('invalid-input');
  });

  it('test_tierOf_按总内存分档_四档边界', () => {
    expect(tierOf(4 * GB)).toBe('4gb');
    expect(tierOf(8 * GB)).toBe('8gb');
    expect(tierOf(16 * GB)).toBe('16gb');
    expect(tierOf(64 * GB)).toBe('32gb+');
    expect(tierOf(5.9 * GB)).toBe('4gb');
    expect(tierOf(12 * GB)).toBe('16gb');
  });

  it('test_checkMemoryTier_默认系数与显式传入等价（防默认值漂移）', () => {
    const a = checkMemoryTier({ totalMemBytes: 16 * GB, freeMemBytes: 8 * GB, modelSizeBytes: 2000 * MB });
    const b = checkMemoryTier({ totalMemBytes: 16 * GB, freeMemBytes: 8 * GB, modelSizeBytes: 2000 * MB, headroomRatio: 1.25, usableRatio: 0.8 });
    expect(a.requiredBytes).toBe(b.requiredBytes);
    expect(a.budgetBytes).toBe(b.budgetBytes);
    expect(a.ok).toBe(b.ok);
  });
});
