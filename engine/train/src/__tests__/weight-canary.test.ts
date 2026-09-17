// ============================================================
// weight-canary.test.ts · v1.4.9 T9 · 权重灰度 AB 单测
// ============================================================
//
// 覆盖面（第九章验收 ①②）：
//   1. 分流比例（hash 稳定分流 + 比例近似 + 边界 0/100）
//   2. 劣化判定（三维度：正确率/拒绝率/成本 + 样本量噪声保护）
//   3. 回退触发（rollbackWeights 注入语义 + HMAC 留痕 + 未注入指引）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  canaryRouteRequest,
  emptyArmMetrics,
  accumulateMetrics,
  deriveRates,
  judgeDeterioration,
  runCanaryCheck,
  DEFAULT_DETERIORATION_THRESHOLDS,
  type ArmMetrics,
  type CanaryConfig,
} from '../weight-canary';

const CONFIG: CanaryConfig = {
  modelName: 'ent-001-sft',
  oldAdapter: 'lora-v3-prod',
  newAdapter: 'lora-v4-canary',
  newWeightPercent: 5,
};

/** 快速构造臂指标 */
function arm(requests: number, correct: number, refusals: number, costUsd: number): ArmMetrics {
  return { requests, correct, refusals, costUsd };
}

describe('weight-canary · 分流（T9 验收①）', () => {
  it('hash 稳定分流——同 key 恒定同臂（会话不抖动）', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(canaryRouteRequest('session-abc', CONFIG)).toEqual(canaryRouteRequest('session-abc', CONFIG));
    }
  });

  it('分流比例近似——5% 灰度在大样本下命中 ~5%（±2% 容差）', () => {
    let newHits = 0;
    const N = 10_000;
    for (let i = 0; i < N; i += 1) {
      if (canaryRouteRequest(`req-${i}`, CONFIG).isNew) newHits += 1;
    }
    const ratio = newHits / N;
    expect(ratio).toBeGreaterThan(0.03);
    expect(ratio).toBeLessThan(0.07);
  });

  it('边界：0% 全旧 / 100% 全新', () => {
    const allOld = canaryRouteRequest('k', { ...CONFIG, newWeightPercent: 0 });
    expect(allOld.isNew).toBe(false);
    expect(allOld.adapter).toBe('lora-v3-prod');
    const allNew = canaryRouteRequest('k', { ...CONFIG, newWeightPercent: 100 });
    expect(allNew.isNew).toBe(true);
    expect(allNew.adapter).toBe('lora-v4-canary');
  });

  it('不同 key 分散命中两臂（hash 分布性）', () => {
    const arms = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      arms.add(canaryRouteRequest(`spread-${i}`, CONFIG).adapter);
    }
    expect(arms.size).toBe(2); // 两臂都有命中
  });
});

describe('weight-canary · 指标累计与派生', () => {
  it('accumulateMetrics 逐请求累计 + deriveRates 除零保护', () => {
    let a = emptyArmMetrics();
    a = accumulateMetrics(a, { correct: true, refused: false, costUsd: 0.001 });
    a = accumulateMetrics(a, { correct: false, refused: true, costUsd: 0.002 });
    expect(a.requests).toBe(2);
    expect(a.correct).toBe(1);
    expect(a.refusals).toBe(1);
    expect(a.costUsd).toBeCloseTo(0.003);

    const rates = deriveRates(a);
    expect(rates.accuracy).toBeCloseTo(0.5);
    expect(rates.refusalRate).toBeCloseTo(0.5);
    expect(rates.costPerRequest).toBeCloseTo(0.0015);

    const zero = deriveRates(emptyArmMetrics());
    expect(zero.accuracy).toBe(0); // 除零给 0 不炸
  });
});

describe('weight-canary · 劣化判定（T9 验收②）', () => {
  it('健康——正确率持平方差内不判劣化', () => {
    const oldArm = arm(1000, 900, 20, 10); // 90% 正确 / 2% 拒绝
    const newArm = arm(1000, 895, 22, 10.5); // 89.5%（降幅 0.5% < 2% 阈）
    const v = judgeDeterioration(oldArm, newArm);
    expect(v.deteriorated).toBe(false);
    expect(v.sufficientSamples).toBe(true);
  });

  it('正确率劣化超阈——判劣化并给依据', () => {
    const oldArm = arm(1000, 900, 20, 10); // 90%
    const newArm = arm(1000, 850, 20, 10); // 85%（降 5 个点 > 2% 阈）
    const v = judgeDeterioration(oldArm, newArm);
    expect(v.deteriorated).toBe(true);
    expect(v.reasons[0]).toContain('正确率劣化');
  });

  it('拒绝率劣化超阈——判劣化（蒸馏模型常见形态）', () => {
    const oldArm = arm(1000, 900, 20, 10); // 2% 拒绝
    const newArm = arm(1000, 900, 40, 10); // 4%（翻倍 > 10% 增幅阈）
    const v = judgeDeterioration(oldArm, newArm);
    expect(v.deteriorated).toBe(true);
    expect(v.reasons.join('; ')).toContain('拒绝率劣化');
  });

  it('成本劣化超阈——判劣化', () => {
    const oldArm = arm(1000, 900, 20, 10); // 单均 $0.01
    const newArm = arm(1000, 900, 20, 15); // 单均 $0.015（+50% > 20% 阈）
    const v = judgeDeterioration(oldArm, newArm);
    expect(v.deteriorated).toBe(true);
    expect(v.reasons[0]).toContain('成本劣化');
  });

  it('样本量不足——统计噪声保护不判劣化（sufficientSamples=false）', () => {
    const oldArm = arm(10, 9, 0, 0.1);
    const newArm = arm(5, 0, 5, 1); // 表面严重劣化但样本不足
    const v = judgeDeterioration(oldArm, newArm);
    expect(v.deteriorated).toBe(false);
    expect(v.sufficientSamples).toBe(false);
    expect(v.reasons[0]).toContain('样本量不足');
  });

  it('阈值外部化——收紧 maxAccuracyDrop 后同指标判劣化', () => {
    const oldArm = arm(1000, 900, 20, 10);
    const newArm = arm(1000, 897, 20, 10); // 降 0.3 个点
    expect(judgeDeterioration(oldArm, newArm).deteriorated).toBe(false);
    const tight = judgeDeterioration(oldArm, newArm, {
      ...DEFAULT_DETERIORATION_THRESHOLDS,
      maxAccuracyDrop: 0.001,
    });
    expect(tight.deteriorated).toBe(true);
  });
});

describe('weight-canary · 回退触发（T9 验收② HMAC 留痕）', () => {
  it('劣化 → rollbackWeights 复用语义回退 + HMAC 留痕载荷', async () => {
    const oldArm = arm(1000, 900, 20, 10);
    const newArm = arm(1000, 840, 20, 10); // 84%（降 6 个点——超阈）
    const calls: string[] = [];
    const outcome = await runCanaryCheck(CONFIG, oldArm, newArm, {
      rollbackWeights: async (modelName) => {
        calls.push(modelName);
        return { ok: true, message: '已回滚至 lora-v3-prod（权重哈希校验通过）' };
      },
      hmacKey: 'test-canary-key',
      now: () => '2026-09-16T10:00:00.000Z',
    });
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.rollbackOk).toBe(true);
    expect(calls).toEqual(['ent-001-sft']); // 复用 rollback-weights 签名（modelName 单参）
    expect(outcome.message).toContain('自动回退');

    // 留痕载荷结构（auditPayload——调用方 emitDecision 入链）
    expect(outcome.auditPayload?.kind).toBe('weight-canary-rollback');
    expect(outcome.auditPayload?.rolledBackTo).toBe('lora-v3-prod');
    expect(outcome.auditPayload?.canaryAdapter).toBe('lora-v4-canary');
    expect(outcome.auditPayload?.reasons.length).toBeGreaterThanOrEqual(1);
    expect(outcome.auditPayload?.metricsSnapshot.new.requests).toBe(1000);
    // HMAC 签名在位（64 hex）
    expect(outcome.auditSignature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('健康 → 不回退不产留痕', async () => {
    const oldArm = arm(1000, 900, 20, 10);
    const newArm = arm(1000, 899, 20, 10);
    const outcome = await runCanaryCheck(CONFIG, oldArm, newArm, {
      rollbackWeights: async () => ({ ok: true, message: '不应被调用' }),
    });
    expect(outcome.rolledBack).toBe(false);
    expect(outcome.auditPayload).toBeUndefined();
    expect(outcome.message).toContain('继续灰度');
  });

  it('劣化但 rollbackWeights 未注入——人工指引不炸', async () => {
    const oldArm = arm(1000, 900, 20, 10);
    const newArm = arm(1000, 800, 20, 10);
    const outcome = await runCanaryCheck(CONFIG, oldArm, newArm);
    expect(outcome.rolledBack).toBe(false);
    expect(outcome.message).toContain('model_switch action=rollback-weights'); // 人工回滚指引
  });

  it('回退执行失败——rollbackOk=false 且留痕载荷照产（审计不因失败缺失）', async () => {
    const oldArm = arm(1000, 900, 20, 10);
    const newArm = arm(1000, 800, 20, 10);
    const outcome = await runCanaryCheck(CONFIG, oldArm, newArm, {
      rollbackWeights: async () => ({ ok: false, message: '旧权重快照缺失' }),
      hmacKey: 'k',
    });
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.rollbackOk).toBe(false);
    expect(outcome.message).toContain('需人工介入');
    expect(outcome.auditPayload?.rollbackResult.ok).toBe(false);
  });

  it('无 hmacKey——降级无签名（开发/测试环境语义，audit 链同款）', async () => {
    const oldArm = arm(1000, 900, 20, 10);
    const newArm = arm(1000, 800, 20, 10);
    const outcome = await runCanaryCheck(CONFIG, oldArm, newArm, {
      rollbackWeights: async () => ({ ok: true, message: 'done' }),
    });
    expect(outcome.auditPayload).toBeDefined();
    expect(outcome.auditSignature).toBeUndefined();
  });
});
