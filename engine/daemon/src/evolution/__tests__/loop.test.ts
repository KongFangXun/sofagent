// ============================================================
// evolution/loop.test.ts · 进化循环周度编排单测（v1.5.9 第 2 步）
// ============================================================
// 覆盖：七组能力面在循环内可运行 + default-safe（缺数据不抛错）+ FDE 写入口只读位。

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEvolutionLoop, initializeDomainVerifierRegistry } from '../loop';
import type { StoredInstinct } from '@sofagent/orchestrator/instinct';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'evolve-loop-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function item(over: Partial<StoredInstinct>): StoredInstinct {
  return {
    id: 'inst-1',
    pattern: '遇到并发写冲突先加锁再重试',
    source: 'think',
    occurrences: 3,
    passCount: 3,
    failCount: 0,
    lastSeen: '2026-10-01T00:00:00.000Z',
    verified: 'unexamined',
    sourceTrace: 'trace-abc',
    enterpriseId: 'default',
    ...over,
  };
}

describe('runEvolutionLoop · default-safe', () => {
  it('空数据目录不抛错，七组步骤给出中性读数', async () => {
    const report = await runEvolutionLoop({ dataDir: tmp(), now: '2026-10-11T00:00:00.000Z' });
    expect(report.safety.blocked).toBe(false);
    expect(report.stagnation.stagnant).toBe(false);
    expect(report.admission).toEqual([]);
    expect(report.promotions).toEqual([]);
    expect(report.pool.total).toBe(0);
    expect(report.pool.exported).toBe(0);
    expect(report.pool.lineage).toBeNull();
    expect(report.exam.questions).toEqual([]);
    expect(report.training.disabled).toBe(true);
    expect(report.training.proceed).toBe(true); // 空策略集 + 无域 ⇒ 门默认放行
    expect(report.metrics.availableDims).toBe(0);
    expect(report.metrics.record).toBeNull();
    expect(report.evalSet.registered).toBeNull();
  });

  it('安全套件命中 ⇒ 独立硬阻断（不启动自动触发链）', async () => {
    const report = await runEvolutionLoop({ dataDir: tmp(), safetyHits: ['rule-x'] });
    expect(report.safety.blocked).toBe(true);
    expect(report.optimizations).toEqual([]);
    expect(report.training.proceed).toBe(false); // 安全阻断进并联门
  });
});

describe('组① 准入门 / 门强度', () => {
  it('已登记 deterministic 域 → auto；未登记域 → human-only；门强度非降', async () => {
    const report = await runEvolutionLoop({
      dataDir: tmp(),
      governedDomains: ['code', 'open-writing'],
      registryEntries: [
        { domain: 'code', tier: 'deterministic', basis: '测试/编译', registeredAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const code = report.admission.find((a) => a.domain === 'code');
    const writing = report.admission.find((a) => a.domain === 'open-writing');
    expect(code?.action).toBe('auto');
    expect(code?.gateStrength).toBe('eval-gate');
    expect(writing?.action).toBe('human-only');
    expect(writing?.tier).toBe(report.unregisteredDefaultTier);
    expect(report.gateStrengthNonDecreasing).toBe(true);
  });
});

describe('组② 晋级判据', () => {
  it('高频 + 长存续 + 高通过率 → promote-skill；证据门槛未过 ⇒ 对偶回退建议', async () => {
    const report = await runEvolutionLoop({
      dataDir: tmp(),
      promotionCandidates: [
        {
          input: { itemId: 'i-1', injectionFrequency: 9, persistenceDays: 30, passRate: 0.85, currentLayer: 'skill' },
          evidence: {
            feedbackSetGain: 0.3,
            heldOutGain: 0,
            candidateScore: 0.5,
            historicalBestScore: 0.6,
            changedSurfaces: ['skill-file', 'weights'],
            calibration: { ece: 0.1, brier: 0.1, baselineEce: 0.05, baselineBrier: 0.05 },
            accuracyImproved: true,
          },
        },
      ],
    });
    const p = report.promotions[0];
    expect(p?.verdict.action).toBe('promote-skill');
    expect(p?.evidence?.passed).toBe(false);
    expect(p?.demotion?.action).toBe('demote-inject');
  });
});

describe('组③④ 经验池 / 出题考核器', () => {
  it('达标条目经双成功 ⇒ verified，考核队列落账，池回写', async () => {
    const dataDir = tmp();
    const report = await runEvolutionLoop({
      dataDir,
      now: '2026-10-11T00:00:00.000Z',
      exam: {
        items: [item({})],
        domainTier: 'deterministic',
        answerCheck: () => ({ pass: true, basis: '答案一致' }),
        reproduction: () => ({ pass: true, basis: '复现成功' }),
        signalsOf: () => ({ recovered: true }),
      },
    });
    expect(report.exam.questions).toHaveLength(1);
    expect(report.exam.results[0]?.outcome).toBe('verified');
    expect(report.exam.poolWrites).toBe(1);
    expect(report.exam.queuePath).toContain('exam-queue.jsonl');
    expect(existsSync(report.exam.queuePath)).toBe(true);
  });

  it('不捕获清单命中 ⇒ 拒收（不进考核）', async () => {
    const report = await runEvolutionLoop({
      dataDir: tmp(),
      exam: {
        items: [item({ pattern: '缺少二进制依赖，command not found' })],
        domainTier: 'deterministic',
        answerCheck: () => ({ pass: true, basis: 'x' }),
        reproduction: () => ({ pass: true, basis: 'y' }),
      },
    });
    expect(report.exam.rejected).toHaveLength(1);
    expect(report.exam.questions).toHaveLength(0);
  });
});

describe('组⑦ 评测集谱系', () => {
  it('登记 + 自陈校验：缺自陈 ⇒ ok=false 且具名 missing', async () => {
    const items = [
      { id: 'q1', prompt: 'A', expected: 'a' },
      { id: 'q2', prompt: 'B' },
    ];
    const report = await runEvolutionLoop({
      dataDir: tmp(),
      evalSet: {
        setId: 'heldout-code-v3',
        origin: 'internal',
        version: 3,
        items,
        contaminationSelfReport: { q1: ['public-set-x'] },
      },
    });
    expect(report.evalSet.registered?.changeAuthority).toBe('human-fde');
    expect(report.evalSet.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.evalSet.selfReportOk).toBe(false);
    expect(report.evalSet.missing).toEqual(['q2']);
    expect(report.evalSet.strippedCount).toBe(2);
    expect(report.evalSet.ledger?.successionDeclarations).toHaveLength(1);
  });
});

describe('FDE 写入口', () => {
  it('initializeDomainVerifierRegistry 写入后只读位在位', () => {
    const dataDir = tmp();
    const written = initializeDomainVerifierRegistry(dataDir, [
      { domain: 'code', tier: 'deterministic', basis: 'b', registeredAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(written.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const mode = statSync(written.path).mode & 0o222;
    expect(mode).toBe(0);
  });
});
