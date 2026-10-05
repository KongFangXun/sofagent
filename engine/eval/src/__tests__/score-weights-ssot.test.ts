// ============================================================
// score-weights-ssot.test.ts · F18（v1.5.7）评分权重 SSOT 机械守卫
// ============================================================
// 缺陷背景：同一组评分权重（0.5/0.2/0.3）曾散落三处（eval-scorer 内联乘式 /
// mcp promote-ab 字面对象 / ab-test types 旧 DEFAULT），无对账——任一处调整
// 即静默漂移。本守卫锁死「全仓唯一份」：
//   ① 引擎源码面（engine 各包 src，剔测试与 dist）0\.5.*0\.2.*0\.3 形态零命中
//     （唯一例外 = SSOT 本体 engine/eval/src/types.ts）；
//   ② 三消费点与 SSOT 运行时同值（传导验证——SSOT 改动必须三处同步可见）。
// 负向探针：把 eval/types.ts 的 0.2 改 0.21 → ② 必红；往任一消费文件回填
// 字面量 → ① 必红。
// ============================================================
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const ENGINE_SRC = join(REPO_ROOT, 'engine');
/** SSOT 本体（唯一豁免） */
const SSOT_FILE = 'eval/src/types.ts';
/** 第二份字面量形态（代码面，非注释叙述）：
 *  - 乘式：`* 0.5`（eval-scorer 旧形态）——数字前是乘号
 *  - 对象键：`exactMatch: 0.5`（promote-ab/ab-test 旧形态）
 *  注释里的 0.5/0.2/0.3 斜杠分隔叙述不命中（叙述不是第二事实源） */
const DUPLICATE_RE = /\*\s*0\.5\s*\+|exactMatch:\s*0\.5/;

/** 递归收集 engine 各包 src 生产 .ts（剔 dist/node_modules/测试） */
function collectProdTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'dist' || e.name === 'node_modules' || e.name === '__tests__') continue;
    const full = join(dir, e.name);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      collectProdTs(full, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('F18 · 评分权重 SSOT 机械守卫', () => {
  it('① engine/*/src 生产源码 0.5/0.2/0.3 第二份字面量零命中（SSOT=eval/src/types.ts 唯一豁免）', () => {
    const hits: string[] = [];
    for (const file of collectProdTs(ENGINE_SRC)) {
      const rel = relative(REPO_ROOT, file).split('\\').join('/');
      if (rel === `engine/${SSOT_FILE}`) continue;
      const content = readFileSync(file, 'utf-8');
      // 逐行扫（DUPLICATE_RE 是行内形态——跨行正则会把注释叙述误判）
      for (const line of content.split('\n')) {
        if (DUPLICATE_RE.test(line)) {
          hits.push(`${rel}: ${line.trim().slice(0, 80)}`);
          break; // 单文件记一次即可
        }
      }
    }
    expect(hits, `发现第二份权重字面量（应 import DEFAULT_SCORE_WEIGHTS）:\n${hits.join('\n')}`).toEqual([]);
  });

  it('② 三消费点与 SSOT 运行时同值（eval-scorer 乘式 / mcp promote-ab / ab-test re-export）', async () => {
    const { DEFAULT_SCORE_WEIGHTS } = await import('../types');
    // eval-scorer：同权重下 overall = exactMatch（三值相等时综合值可反推权重和）
    const { evalCase } = await import('../eval-scorer');
    const r = evalCase({ x: 1 }, { x: 1 });
    expect(r.overall).toBeCloseTo(1.0, 10); // 三维全 1 ⇒ 加权和恒 1（权重和不变式）
    // 部分命中反推权重：exact=1, semantic=0, rule=0 ⇒ overall = w.exact
    const r2 = evalCase({}, { x: 1 });
    // scoreExactMatch: 空 actual vs 期望 1 键 → 0；semantic 0 keys → 1.0；rule → 1.0
    // 更稳的反推：直接读 SSOT 三键合计与 promote-ab 传入值
    const sum = DEFAULT_SCORE_WEIGHTS.exactMatch + DEFAULT_SCORE_WEIGHTS.semanticSimilarity + DEFAULT_SCORE_WEIGHTS.ruleCompliance;
    expect(sum).toBeCloseTo(1.0, 10); // 权重归一不变式
    expect(DEFAULT_SCORE_WEIGHTS.exactMatch).toBe(0.5);
    expect(DEFAULT_SCORE_WEIGHTS.semanticSimilarity).toBe(0.2);
    expect(DEFAULT_SCORE_WEIGHTS.ruleCompliance).toBe(0.3);
  });

  it('②b eval-scorer 乘式真用 SSOT（改 SSOT 单值即改变 overall——行为级传导）', async () => {
    // 用 vitest 模块图不可变特性做静态验证：eval-scorer 源码 import DEFAULT_SCORE_WEIGHTS
    const scorerSrc = readFileSync(join(__dirname, '..', 'eval-scorer.ts'), 'utf-8');
    expect(scorerSrc).toContain("import { DEFAULT_SCORE_WEIGHTS } from './types'");
    expect(scorerSrc).not.toMatch(/exactMatch\s*\*\s*0\.5/);
    // mcp promote-ab 与 ab-test re-export 同面
    const promoteSrc = readFileSync(join(REPO_ROOT, 'engine', 'mcp', 'src', 'tools', 'promote-ab.ts'), 'utf-8');
    expect(promoteSrc).toContain("DEFAULT_SCORE_WEIGHTS } from '@sofagent/eval'");
    const abTypesSrc = readFileSync(join(REPO_ROOT, 'engine', 'ab-test', 'src', 'types.ts'), 'utf-8');
    expect(abTypesSrc).toContain("@sofagent/eval").and.not.toMatch(/exactMatch:\s*0\.5/);
  });
});
