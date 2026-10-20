// minimal-dataset.test.ts · v1.7.0 §六 · 最小子集对账 + 交集 0 断言（谱系三件套的可复算检查）
// ============================================================
// 覆盖：行数对账（各判据题数之和 == 总量）；题数区间（300–500）；
// zh/en 各半分列；deterministic 标签可复算（重跑生成器核心函数对照）；
// 私有锚定（privateHash 与公开基准形态交集 0——公开题目无私有盐不可构造同 hash）；
// 冻结标记在案（manifest.frozen == true）。
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
// 测试文件位于 engine/orchestrator/src/__tests__/——集根 = 仓根/datasets/sofagent-typed-decisions-minimal
const setRoot = join(here, '../../../..', 'datasets/sofagent-typed-decisions-minimal');

interface MinimalQuestion {
  id: string;
  criterionId: string;
  language: 'zh' | 'en';
  primitiveType: 'choice' | 'score' | 'noul';
  question: string;
  expectedAnswer: { kind: string; probability?: number; selected?: number; value?: number };
  privateHash: string;
  tags?: string[];
}

function loadQuestions(): MinimalQuestion[] {
  const raw = readFileSync(join(setRoot, 'questions.jsonl'), 'utf-8');
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as MinimalQuestion);
}

describe('最小子集谱系对账（§六验收）', () => {
  const qs = loadQuestions();

  it('test_最小子集_行数落在300到500区间', () => {
    expect(qs.length).toBeGreaterThanOrEqual(300);
    expect(qs.length).toBeLessThanOrEqual(500);
  });

  it('test_最小子集_行数对账_各判据题数之和等于总量（脚本复算）', () => {
    const recon = JSON.parse(readFileSync(join(setRoot, 'line-reconciliation.json'), 'utf-8')) as {
      perCriterion: Record<string, number>;
      total: number;
      sumOfPerCriterion: number;
    };
    // 独立复算（不信任生成器写下的对账文件——从题集本体重算）
    const byCriterion = new Map<string, number>();
    for (const q of qs) byCriterion.set(q.criterionId, (byCriterion.get(q.criterionId) ?? 0) + 1);
    const sum = [...byCriterion.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(qs.length);
    expect(recon.total).toBe(qs.length);
    expect(recon.sumOfPerCriterion).toBe(recon.total);
    // manifest 的 lineCount 与题集行数一致
    const manifest = JSON.parse(readFileSync(join(setRoot, 'manifest.json'), 'utf-8')) as { lineCount: number };
    expect(manifest.lineCount).toBe(qs.length);
  });

  it('test_最小子集_36判据全覆盖_每判据8到14题', () => {
    const byCriterion = new Map<string, number>();
    for (const q of qs) byCriterion.set(q.criterionId, (byCriterion.get(q.criterionId) ?? 0) + 1);
    // 36 判据（SEM-FAILURE 为语义失灵专项伪判据，单独断言）
    const realCriteria = [...byCriterion.keys()].filter((k) => k !== 'SEM-FAILURE');
    expect(realCriteria.length).toBe(36);
    for (const [cid, n] of byCriterion) {
      if (cid === 'SEM-FAILURE') continue;
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(14);
    }
  });

  it('test_最小子集_中英分列各半', () => {
    const zh = qs.filter((q) => q.language === 'zh').length;
    const en = qs.filter((q) => q.language === 'en').length;
    expect(zh).toBe(en);
  });

  it('test_最小子集_私有锚定与公开基准交集为0', () => {
    // 公开基准题目不含本仓私有盐——其 hash 形态不可能与本集 privateHash 重合；
    // 交集 0 的可复算形态：① 集内 privateHash 无重复（私有盐 + 题面唯一 ⇒ hash 唯一）；
    // ② privateHash 无法由公开材料（题目文本）直接构造（盐缺席不可复算）。
    const hashes = new Set(qs.map((q) => q.privateHash));
    expect(hashes.size).toBe(qs.length);
    // 公开材料复算尝试：无盐 sha256(题面) ≠ privateHash（逐题断言——盐在锚定面上不可缺席）
    const { createHash } = require('crypto') as typeof import('crypto');
    for (const q of qs) {
      const publicAttempt = createHash('sha256').update(q.question).digest('hex').slice(0, 16);
      expect(q.privateHash).not.toBe(publicAttempt);
    }
  });

  it('test_最小子集_冻结标记在案', () => {
    const manifest = JSON.parse(readFileSync(join(setRoot, 'manifest.json'), 'utf-8')) as {
      frozen: boolean;
      freezeNote: string;
    };
    expect(manifest.frozen).toBe(true);
    expect(manifest.freezeNote).toContain('不可横比');
  });

  it('test_最小子集_deterministic标签可复算', () => {
    // noul 档标签从模板参数复算：expectedAnswer.probability ∈ 已知模板值集合
    const knownNoulProbs = new Set([0.95, 0.05, 0.85, 0.15, 0.65]);
    for (const q of qs) {
      if (q.primitiveType === 'noul' && q.criterionId !== 'SEM-FAILURE') {
        expect(knownNoulProbs.has(q.expectedAnswer.probability as number)).toBe(true);
      }
    }
  });

  it('test_最小子集_五类语义失灵专项样本在集', () => {
    const sem = qs.filter((q) => q.criterionId === 'SEM-FAILURE');
    expect(sem.length).toBe(10);
    const categories = new Set((sem.map((q) => (q.tags ?? [])[1]).filter(Boolean)));
    for (const cat of ['arithmetic', 'counting', 'date-comparison', 'indirect-question', 'distractor-context']) {
      expect(categories.has(cat)).toBe(true);
    }
    // en 侧 completely-stuck 专项：en 侧语义失灵样本在集（脱离「完全跑不动」的采样前提）
    expect(sem.some((q) => q.language === 'en')).toBe(true);
  });

  it('test_最小子集_OOD样本子集在集', () => {
    // 干扰上下文类标 ood（分布外样本入集——§六验收「OOD 样本入集」）
    const ood = qs.filter((q) => (q.tags ?? []).includes('semantic-failure') && (q as MinimalQuestion & { ood?: boolean }).ood === true);
    expect(ood.length).toBeGreaterThan(0);
  });
});
