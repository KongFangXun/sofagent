// ============================================================
// f6-confidence-semantics.test.ts · F6.2「假概率正名」验收
// ------------------------------------------------------------
// v1.9.0 §二 六条里，可被自动化证明的四条落在这里：
//   S1 语义标记**不改变数值**（运行时恒等）——验收条「正名不改变既有判定行为」
//   S2 登记表与代码**双向闭合**——每个登记文件里至少出现对应包装函数（防「登记了但没标」）
//   S3 门禁拒绝「非概率却标 calibrated」——这是正名的实质：权重/等级没有校准一说
//   S4 普查器与登记表一致——登记文件都在普查范围内，且无「标了却没登记」的文件
//
// 不证的部分：不证任何数值的准确度（那是校准的事，不是正名的事）。
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hw,
  ol,
  prob,
  SEMANTICS_REGISTRY,
  type ConfidenceSemantics,
} from '../confidence-semantics';
import { CalibrationClaimRegistry } from '../calibration-registry';

const ROOT = join(__dirname, '..', '..', '..', '..');
const WRAPPER: Record<ConfidenceSemantics, RegExp> = {
  'heuristic-weight': /\bhw\(/,
  'ordinal-level': /\bol\(/,
  probability: /\bprob\(/,
};

describe('F6.2 S1 语义标记不改变数值（运行时恒等）', () => {
  it('S1 三个标记函数都是恒等（标记只活在类型层）', () => {
    for (const v of [0, 0.3, 0.5, 0.7, 1, 1.0]) {
      expect(hw(v)).toBe(v);
      expect(ol(v)).toBe(v);
      expect(prob(v)).toBe(v);
    }
  });

  it('S1 标记后的数在 JSON 序列化里与裸数字等价（不新增字段）', () => {
    const tagged = { confidence: hw(0.7), probability: prob(0.81) };
    const plain = { confidence: 0.7, probability: 0.81 };
    expect(JSON.stringify(tagged)).toBe(JSON.stringify(plain));
    expect(Object.keys(tagged)).toEqual(['confidence', 'probability']);
  });
});

describe('F6.2 S2/S4 登记表与代码双向闭合', () => {
  it('S2 每个登记文件都存在，且出现对应包装函数（登记了就必须标）', () => {
    const problems: string[] = [];
    for (const entry of SEMANTICS_REGISTRY) {
      const p = join(ROOT, entry.file);
      let text = '';
      try {
        text = readFileSync(p, 'utf-8');
      } catch {
        problems.push(`${entry.file}：文件不存在`);
        continue;
      }
      if (!WRAPPER[entry.semantics].test(text)) {
        problems.push(`${entry.file}：登记为 ${entry.semantics} 但代码里找不到对应包装函数`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('S4 反查：代码里用了包装函数的文件，必须都在登记表里', () => {
    const registered = new Set(SEMANTICS_REGISTRY.map((e) => e.file));
    const scanned = [
      'engine/audit/src/audit-root-cause.ts',
      'engine/daemon/src/dream-cycle/extract-facts.ts',
      'engine/orchestrator/src/loop-agent/error-localizer.ts',
      'engine/orchestrator/src/loop-agent/output-extractor.ts',
      'engine/orchestrator/src/router/intent-triage.ts',
      'engine/orchestrator/src/router/judge-heads/index.ts',
      'engine/train/src/rlcd/calibration.ts',
      'engine/audit/src/pr-store.ts',
      'engine/audit/src/decision-schema.ts',
      'engine/core/src/confidence-semantics.ts', // 标记函数本体，允许不入表
    ];
    const missing = scanned.filter((f) => {
      if (f.endsWith('confidence-semantics.ts')) return false;
      const text = readFileSync(join(ROOT, f), 'utf-8');
      const uses = Object.values(WRAPPER).some((re) => re.test(text));
      return uses && !registered.has(f);
    });
    expect(missing).toEqual([]);
  });
});

describe('F6.2 S3 门禁：非概率不得声称 calibrated', () => {
  const mk = (over: Partial<Parameters<CalibrationClaimRegistry['registerConfidenceClaim']>[0]>) => ({
    id: 'c1',
    path: 'engine/x.ts:1',
    statistic: 'max-prob',
    calibStatus: 'uncalibrated' as const,
    inDecisionPath: true,
    ...over,
  });

  it('S3 权重 + calibrated ⇒ 拒（权重没有「校准」这一说）', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(
      mk({
        semantics: 'heuristic-weight',
        calibStatus: 'calibrated',
        evidence: { calibrationSetVersion: 'v1', ece: 0.05, fittedAt: '2026-11-01T00:00:00Z' },
      }),
    );
    expect(() => reg.assertNoUncalibratedInDecisionPath()).toThrow(/语义与校准状态矛盾/);
  });

  it('S3 序数等级 + calibrated ⇒ 拒', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(
      mk({
        semantics: 'ordinal-level',
        calibStatus: 'calibrated',
        evidence: { calibrationSetVersion: 'v1', ece: 0.05, fittedAt: '2026-11-01T00:00:00Z' },
      }),
    );
    expect(() => reg.assertNoUncalibratedInDecisionPath()).toThrow(/ordinal-level/);
  });

  it('S3 未标记 + calibrated ⇒ 拒（缺失按不可信处理）', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(
      mk({
        calibStatus: 'calibrated',
        evidence: { calibrationSetVersion: 'v1', ece: 0.05, fittedAt: '2026-11-01T00:00:00Z' },
      }),
    );
    expect(() => reg.assertNoUncalibratedInDecisionPath()).toThrow(/未标记/);
  });

  it('S3 概率 + calibrated ⇒ 放行（唯一合法组合）', () => {
    const reg = new CalibrationClaimRegistry();
    reg.registerConfidenceClaim(
      mk({
        semantics: 'probability',
        calibStatus: 'calibrated',
        evidence: { calibrationSetVersion: 'v1', ece: 0.05, fittedAt: '2026-11-01T00:00:00Z' },
      }),
    );
    expect(() => reg.assertNoUncalibratedInDecisionPath()).not.toThrow();
  });
});
