// split-config.test.ts · v1.7.0 §六 · 家族级键切分复算 + 交集空断言
// ============================================================
import { describe, it, expect } from 'vitest';
import { splitByFamily, DEFAULT_SPLIT_CONFIG } from '../rlcd/split-config';

function families(nFamilies: number, perFamily: number): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (let f = 0; f < nFamilies; f++) {
    const ids: string[] = [];
    for (let i = 0; i < perFamily; i++) ids.push(`fam-${f}-item-${i}`);
    m.set(`fam-${f}`, ids);
  }
  return m;
}

describe('家族级键切分（§六验收：切分口径可复现）', () => {
  it('test_切分_同家族整体留同侧', () => {
    const r = splitByFamily(families(50, 4));
    const trainSet = new Set(r.trainIds);
    const calibSet = new Set(r.calibIds);
    // 家族成员不跨侧：fam-K-item-* 的四个 id 全部落在同一侧
    for (let f = 0; f < 50; f++) {
      const inTrain = trainSet.has(`fam-${f}-item-0`);
      const allSame = [0, 1, 2, 3].every((i) =>
        inTrain ? trainSet.has(`fam-${f}-item-${i}`) : calibSet.has(`fam-${f}-item-${i}`),
      );
      expect(allSame).toBe(true);
    }
  });

  it('test_切分_两侧交集恒空', () => {
    const r = splitByFamily(families(50, 4));
    expect(r.intersection).toHaveLength(0);
    // 双向核（train∩calib 从两侧各查一遍）
    const trainSet = new Set(r.trainIds);
    for (const id of r.calibIds) expect(trainSet.has(id)).toBe(false);
  });

  it('test_切分_同配置同切分（确定性）', () => {
    const a = splitByFamily(families(50, 4), { calibRatio: 0.3, seed: 7 });
    const b = splitByFamily(families(50, 4), { calibRatio: 0.3, seed: 7 });
    expect(a.trainIds).toEqual(b.trainIds);
    expect(a.calibIds).toEqual(b.calibIds);
  });

  it('test_切分_异种子切分不同（种子生效）', () => {
    const a = splitByFamily(families(50, 4), { seed: 1 });
    const b = splitByFamily(families(50, 4), { seed: 2 });
    expect(a.calibIds).not.toEqual(b.calibIds);
  });

  it('test_切分_比例近似生效（家族粒度容差内）', () => {
    // 200 家族单成员——0.2 比例应在统计上接近（|实际占比 − 0.2| < 0.1）
    const single = new Map<string, string[]>();
    for (let i = 0; i < 200; i++) single.set(`f-${i}`, [`id-${i}`]);
    const r = splitByFamily(single, { calibRatio: 0.2, seed: 42 });
    const ratio = r.calibIds.length / (r.calibIds.length + r.trainIds.length);
    expect(Math.abs(ratio - 0.2)).toBeLessThan(0.1);
  });

  it('test_切分_非法比例拒绝', () => {
    expect(() => splitByFamily(families(2, 1), { calibRatio: 0 })).toThrow();
    expect(() => splitByFamily(families(2, 1), { calibRatio: 1 })).toThrow();
  });

  it('test_切分_缺省配置回显', () => {
    const r = splitByFamily(families(4, 1));
    expect(r.config.calibRatio).toBe(DEFAULT_SPLIT_CONFIG.calibRatio);
    expect(r.config.seed).toBe(DEFAULT_SPLIT_CONFIG.seed);
  });
});
