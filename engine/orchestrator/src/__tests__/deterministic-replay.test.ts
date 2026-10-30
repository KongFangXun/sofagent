// ============================================================
// deterministic-replay.test.ts · 全量对账 replay（frozen eval.jsonl 3357 行）
// ============================================================
// 架构师设计 §测试第二件：确定性路由对 frozen 数据集的**全量回放对账**。
// 数据文件 fs.existsSync 守卫——缺则 skip（CI 无数据盘时不断言假读数）。
//
// 硬断言（架构师实测地基——已独立复算一致的断言目标值）：
//   - 识别率：numeric-choice（extremum+nearest+digit-sum）=== 837；
//     banded-score（binary+edges+table）=== 462；合计 1299
//   - routedByRule 直方图：extremum 422 / nearest 401 / digit-sum 14 /
//     binary 231 / edges 56 / table 175
//   - 语义面（boolq/csqa/snli/millet 1977 行）routed === 0
//   - gradelong（81 行）routed === 0（裁决③：本版刻意不覆盖）
//   - 1299 行确定性答案 vs label.value 全对（100%）
//   - 前后对照（predictions-ensemble + 路由替换，主理人裁决①双口径）：
//     origin 口径（可复算——主口径）：zh(proc-*) 0.3297→0.9316、en(boolq) 不变
//     单元口径（官方 VALIDATION CJK>30%——并列留档，不可复算侧）
// ============================================================

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_DETERMINISTIC_JUDGE, RULE_FAMILY } from '../router/deterministic-judge';

/** frozen 数据集路径（3357 行——sanity check 锚定） */
const EVAL_JSONL = '/Users/kongfangxun/Workbuddy/datasets/f2-backup-20261024/frozen/main01v5/eval.jsonl';
/** 归因分析逐行模型预测（三 seed ensemble 概率平均——前后对照的「前」） */
const PREDICTIONS_JSONL = '/tmp/v17-attribution/predictions-ensemble.jsonl';
/** 数据集行数锚（数据被换时测试先红） */
const EXPECTED_ROWS = 3357;

/** frozen eval.jsonl 原始行（evidence/criteria/label/meta 四段） */
interface FrozenRow {
  evidence: { state: string; question: string; options?: string[] };
  criteria: { qtype: string; task: string; k: number; instructions: string; options_def: Record<string, string> };
  label: { value: number; source: string };
  meta: { origin: string; boundary: string; benchmark: boolean; schema_version: string };
}

/** 归因预测行 */
interface PredictionRow {
  idx: number;
  qtype: string;
  origin: string;
  hit: boolean;
}

function loadEvalRows(): FrozenRow[] {
  return readFileSync(EVAL_JSONL, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as FrozenRow);
}

function loadPredictions(): PredictionRow[] {
  return readFileSync(PREDICTIONS_JSONL, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PredictionRow);
}

const familyOf = (r: FrozenRow): string => r.meta.origin.split('#')[0];

// 数据盘守卫：缺则 skip 全部（CI 无数据盘不断言假读数）
const dataAvailable = existsSync(EVAL_JSONL);

// 预加载（describe 顶层一次——3357 行 JSON 解析 ~1s，避免逐 it 重读）
const rows: FrozenRow[] = dataAvailable ? loadEvalRows() : [];
const preds: PredictionRow[] = dataAvailable && existsSync(PREDICTIONS_JSONL) ? loadPredictions() : [];

describe.skipIf(!dataAvailable)('deterministic-replay · frozen eval.jsonl 全量对账（3357 行）', () => {
  it('sanity：数据集行数 3357 + 预测逐行对齐（idx 0 起）', () => {
    expect(rows.length).toBe(EXPECTED_ROWS);
    expect(preds.length).toBe(EXPECTED_ROWS);
    expect(preds[0]!.idx).toBe(0);
    expect(preds[3356]!.idx).toBe(3356);
  });

  it('识别率硬断言：numeric-choice === 837 / banded-score === 462 / 合计 1299', () => {
    let numericChoice = 0;
    let bandedScore = 0;
    for (const r of rows) {
      const rule = DEFAULT_DETERMINISTIC_JUDGE.route(
        r.evidence.state,
        r.criteria.instructions,
        r.criteria.options_def,
      );
      if (rule === null) continue;
      if (RULE_FAMILY[rule] === 'choice') numericChoice += 1;
      else bandedScore += 1;
    }
    expect(numericChoice).toBe(837); // extremum 422 + nearest 401 + digit-sum 14
    expect(bandedScore).toBe(462); // binary 231 + edges 56 + table 175
    expect(numericChoice + bandedScore).toBe(1299);
  });

  it('routedByRule 直方图：extremum 422 / nearest 401 / digit-sum 14 / binary 231 / edges 56 / table 175', () => {
    const hist = new Map<string, number>();
    for (const r of rows) {
      const rule = DEFAULT_DETERMINISTIC_JUDGE.route(
        r.evidence.state,
        r.criteria.instructions,
        r.criteria.options_def,
      );
      if (rule) hist.set(rule, (hist.get(rule) ?? 0) + 1);
    }
    expect(hist.get('extremum')).toBe(422);
    expect(hist.get('nearest')).toBe(401);
    expect(hist.get('digit-sum')).toBe(14);
    expect(hist.get('binary')).toBe(231);
    expect(hist.get('edges')).toBe(56);
    expect(hist.get('table')).toBe(175);
  });

  it('语义面（boolq/csqa/snli/millet 1977 行）routed === 0——fail-open 零侵蚀', () => {
    const semanticFamilies = new Set(['boolq', 'csqa', 'snli', 'proc-a-millet']);
    const semantic = rows.filter((r) => semanticFamilies.has(familyOf(r)));
    expect(semantic.length).toBe(1977);
    const routed = semantic.filter(
      (r) =>
        DEFAULT_DETERMINISTIC_JUDGE.route(r.evidence.state, r.criteria.instructions, r.criteria.options_def) !== null,
    );
    expect(routed.map((r) => r.meta.origin)).toEqual([]);
  });

  it('gradelong（81 行）routed === 0（裁决③：本版刻意不覆盖——继续落模型）', () => {
    const gradelong = rows.filter((r) => familyOf(r) === 'proc-e-gradelong');
    expect(gradelong.length).toBe(81);
    const routed = gradelong.filter(
      (r) =>
        DEFAULT_DETERMINISTIC_JUDGE.route(r.evidence.state, r.criteria.instructions, r.criteria.options_def) !== null,
    );
    expect(routed.map((r) => r.meta.origin)).toEqual([]);
  });

  it('1299 行确定性答案 vs label.value 全对（100%——答案面零 fail-closed）', () => {
    const misses: Array<{ origin: string; expected: number; got: number | undefined }> = [];
    let answered = 0;
    for (const r of rows) {
      const det = DEFAULT_DETERMINISTIC_JUDGE.solveQuestion({
        state: r.evidence.state,
        instructions: r.criteria.instructions,
        optionsDef: r.criteria.options_def,
        at: '2026-10-30T00:00:00Z',
      });
      if (det === undefined) continue;
      answered += 1;
      if (det.value !== r.label.value) {
        misses.push({ origin: r.meta.origin, expected: r.label.value, got: det.value });
      }
    }
    expect(answered).toBe(1299);
    expect(misses).toEqual([]); // 100% 命中
  });

  it('k≥10 家族（kcc11-16/minmax22）自然序回归——选项下标与 label 对齐', () => {
    // 字典序陷阱家族单独扫：opt10+ 若按字典序排会全量错位
    const bigK = rows.filter((r) => {
      const fam = familyOf(r);
      return /^proc-e-kcc(1[1-6])$/.test(fam) || fam === 'proc-e-minmax22';
    });
    expect(bigK.length).toBeGreaterThan(300);
    for (const r of bigK) {
      const det = DEFAULT_DETERMINISTIC_JUDGE.solveQuestion({
        state: r.evidence.state,
        instructions: r.criteria.instructions,
        optionsDef: r.criteria.options_def,
      });
      expect(det, `${r.meta.origin} 应被确定性复算`).toBeDefined();
      expect(det!.value).toBe(r.label.value);
    }
  });

  // ── 前后对照（主理人裁决①：双口径并列——origin 口径为主可复算）────

  it('前后对照 · origin 口径（主口径·可复算）：zh(proc-*) 0.3297→0.9316 / en(boolq) 不变', () => {
    let zhBefore = 0;
    let zhAfter = 0;
    let zhN = 0;
    let enBefore = 0;
    let enAfter = 0;
    let enN = 0;
    rows.forEach((r, i) => {
      const p = preds[i]!;
      let hit = p.hit;
      const det = DEFAULT_DETERMINISTIC_JUDGE.solveQuestion({
        state: r.evidence.state,
        instructions: r.criteria.instructions,
        optionsDef: r.criteria.options_def,
      });
      if (det !== undefined) {
        hit = det.value === r.label.value; // 确定性路由替换
      }
      const fam = familyOf(r);
      if (fam.startsWith('proc-')) {
        // origin 口径 zh = proc-* 合成族（n=1565——架构师地基同口径）
        zhN += 1;
        zhBefore += p.hit ? 1 : 0;
        zhAfter += hit ? 1 : 0;
      } else if (fam === 'boolq') {
        // origin 口径 en = boolq（n=742；csqa/snli 是中文问句族——归 zh 侧
        // 语义面，不在本对照口径内，见单元口径用例）
        enN += 1;
        enBefore += p.hit ? 1 : 0;
        enAfter += hit ? 1 : 0;
      }
    });
    expect(zhN).toBe(1565);
    expect(enN).toBe(742);
    // 前（模型读数）：0.3297（架构师地基——独立复算一致）
    expect(zhBefore / zhN).toBeCloseTo(0.3297, 3);
    // 后（确定性路由替换数值面）：0.9316
    expect(zhAfter / zhN).toBeCloseTo(0.9316, 3);
    // en（boolq）不含数值面——读数不变
    expect(enAfter / enN).toBeCloseTo(enBefore / enN, 10);
    expect(enAfter / enN).toBeCloseTo(0.8154, 3);
    // 不回退保险
    expect(zhAfter / zhN).toBeGreaterThan(zhBefore / zhN);
  });

  it('前后对照 · 单元口径（并列留档·VALIDATION CJK>30%）：数值面单列 1.0 / zh en 均不回退', () => {
    // 官方单元口径（VALIDATION.md §阶段二收口）：state CJK 占比 >30% 判 zh
    // ——不可从本仓数据复算的官方口径，并列留档不进主口径
    const cjkRatio = (s: string): number => {
      if (s.length === 0) return 0;
      let cjk = 0;
      for (const ch of s) {
        if (ch >= '\u4e00' && ch <= '\u9fff') cjk += 1;
      }
      return cjk / s.length;
    };
    let zhB = 0;
    let zhA = 0;
    let zhN = 0;
    let enB = 0;
    let enA = 0;
    let enN = 0;
    let numHit = 0;
    let numN = 0;
    rows.forEach((r, i) => {
      const p = preds[i]!;
      let hit = p.hit;
      const det = DEFAULT_DETERMINISTIC_JUDGE.solveQuestion({
        state: r.evidence.state,
        instructions: r.criteria.instructions,
        optionsDef: r.criteria.options_def,
      });
      if (det !== undefined) {
        hit = det.value === r.label.value;
        numN += 1;
        if (hit) numHit += 1;
      }
      if (cjkRatio(r.evidence.state) > 0.3) {
        zhN += 1;
        zhB += p.hit ? 1 : 0;
        zhA += hit ? 1 : 0;
      } else {
        enN += 1;
        enB += p.hit ? 1 : 0;
        enA += hit ? 1 : 0;
      }
    });
    // 数值面单列：1299/1299 全对
    expect(numN).toBe(1299);
    expect(numHit / numN).toBe(1);
    // zh/en 均不回退（单元口径下 kcc 部分行归 en——路由替换只升不降）
    expect(zhA / zhN).toBeGreaterThanOrEqual(zhB / zhN);
    expect(enA / enN).toBeGreaterThanOrEqual(enB / enN);
  });
});
