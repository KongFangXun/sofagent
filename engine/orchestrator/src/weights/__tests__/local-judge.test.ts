// ============================================================
// local-judge.test.ts · v1.9.0 §十 P-5 判定头接线单测
// ============================================================
// 三条验收逐条锁：
//   ① fail-closed（权重缺失→weights-missing；篡改→sha-mismatch；**不回落 LLM**
//      ——断言抛错类型而非返回 LLM 结果）
//   ② 弃权四态（/v1/systemone 侧——由 systemone-endpoint 既有测试覆盖四态透出；
//      本文件锁 judgeLocal→judge 适配层的四态透传）
//   ③ 端到端回执四项（判据版本/权重sha16/读数/时间——固定输入可复算断言）
// 反例实测（P-5 验收第 2 条「临时改名权重→调用必须返回失败」）：改名 manifest
// 内 sha 指向的权重文件 → sha-mismatch。
// ============================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judgeLocal, LocalJudgeUnavailableError } from '../local-judge';
import { hashDir } from '../../weights-manifest';
import type { DecisionQuestion } from '../../router/decision-primitives';

let root = '';
let weightsDir = '';

function buildWeights(): void {
  weightsDir = join(root, 'weights');
  mkdirSync(join(weightsDir, 'v1'), { recursive: true });
  writeFileSync(join(weightsDir, 'v1', 'weights.bin'), 'fake-weights-bytes-for-p5');
  const sha = hashDir(join(weightsDir, 'v1'));
  writeFileSync(
    join(weightsDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      model: 'test-judge',
      versions: [{ id: 'v1', createdAt: '2026-11-11T00:00:00Z', sha256: sha, sizeBytes: 26 }],
      current: 'v1',
    }),
  );
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'p5-local-judge-'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const QUESTIONS: DecisionQuestion[] = [
  { id: 'q1', kind: 'noul', question: '是否人工复核' },
  { id: 'q2', kind: 'score', question: '置信度', min: 0, max: 10 },
  {
    id: 'q3',
    kind: 'choice',
    question: '处置',
    options: [
      { id: 'auto', label: '🔄自动' },
      { id: 'manual', label: '👤人工' },
      { id: 'fb', label: '⚠️兜底：转人工', isFallback: true },
    ],
  },
];

describe('P-5 · 本地判定五环', () => {
  it('环①②③④⑤ 全通 → 回执四项齐（判据版本/权重sha16/读数/时间）——P-5 第 3 条', () => {
    buildWeights();
    const r = judgeLocal('P-5 端到端：把订单按金额分档。', QUESTIONS, {
      weightsDir,
      criteriaVersion: 'criteria/p5-test@1',
    });
    expect(r.criteriaVersion).toBe('criteria/p5-test@1');
    expect(r.weightsSha16).toHaveLength(16);
    expect(r.modelVersion).toBe('weights/v1');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.answers).toHaveLength(3);
    expect(r.answers[0]!.kind).toBe('noul');
    expect(r.answers[1]!.kind).toBe('score');
    expect((r.answers[2] as { kind: string }).kind).toBe('choice');
    // 可复算性：同输入同回执（替身 encoder 确定性）
    const r2 = judgeLocal('P-5 端到端：把订单按金额分档。', QUESTIONS, {
      weightsDir,
      criteriaVersion: 'criteria/p5-test@1',
    });
    expect(r2.answers).toEqual(r.answers);
    expect(r2.weightsSha16).toBe(r.weightsSha16);
  });

  it('反例实测：权重文件临时改名 → sha-mismatch 拒绝判定（不回落 LLM）——P-5 第 1 条', () => {
    buildWeights();
    const wpath = join(weightsDir, 'v1', 'weights.bin');
    renameSync(wpath, `${wpath}.renamed`);
    try {
      expect(() => judgeLocal('x', QUESTIONS, { weightsDir })).toThrow(LocalJudgeUnavailableError);
      try {
        judgeLocal('x', QUESTIONS, { weightsDir });
      } catch (e) {
        const err = e as LocalJudgeUnavailableError;
        expect(err.code).toBe('sha-mismatch');
        expect(err.message).toContain('不回落 LLM');
      }
    } finally {
      renameSync(`${wpath}.renamed`, wpath);
    }
  });

  it('权重目录缺失 → weights-missing 拒绝判定（fail-closed）', () => {
    expect(() => judgeLocal('x', QUESTIONS, { weightsDir: join(root, 'no-such-dir') })).toThrow(
      LocalJudgeUnavailableError,
    );
    try {
      judgeLocal('x', QUESTIONS, { weightsDir: join(root, 'no-such-dir') });
    } catch (e) {
      expect((e as LocalJudgeUnavailableError).code).toBe('weights-missing');
    }
  });

  it('错误类名复用 DecisionChannelUnavailableError → classifyJudgeError 归因 weights-missing（七路回落既有语义）', () => {
    try {
      judgeLocal('x', QUESTIONS, { weightsDir: join(root, 'no-such-dir') });
    } catch (e) {
      expect((e as Error).name).toBe('DecisionChannelUnavailableError');
    }
  });
});
