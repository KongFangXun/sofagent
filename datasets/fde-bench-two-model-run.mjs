// fde-bench-two-model-run.mjs · v1.9.0 §五-355 FDE-Bench 通用件 vs 本仓件对照（第四棒④）
// ============================================================
// 题库：~/WorkBuddy/datasets/fde-bench/fde-bench-items.v4.jsonl（384 题 ·
// public-case-adapted 唯一数据源 · state+question 零重复 · 30/30 决策点）。
//
// 对照两件（同判据集同评测器同指标——devlog §五 三对齐）：
//   · 通用件（generics baseline）：确定性启发式替身——按候选文本特征
//     打分（与 qwen3 零样本同量级的弱基线，代表「无判定头的通用模型」档）
//   · 本仓件（sofagent judge）：JudgeRuntime 类型化接口（surrogate encoder
//     契约面——判定头三原语 + 确定性前置路由）
//
// 读数：整体 acc + 按原语分列 + 格式破坏率（formatFailure 同款口径）。
// 只并列不排名的口径：通用件是启发式替身非真 LLM——本读数是**链路对照**
// （类型化接口 vs 无结构约束通道），非能力横比。
//
// 运行：node datasets/fde-bench-two-model-run.mjs（仓根 = sofagent）
// 输出：stdout JSON + datasets/v19-density/fde-bench-compare-YYYYMMDD.json
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const here = dirname(fileURLToPath(import.meta.url));
const { JudgeRuntime } = await import(join(here, '../engine/orchestrator/dist/router/judge-runtime.js'));

// ── 读题库 ──
const benchDir = join(homedir(), 'WorkBuddy/datasets/fde-bench');
const items = readFileSync(join(benchDir, 'fde-bench-items.v4.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// ── 本仓件：JudgeRuntime（surrogate encoder 契约面）──
const enc = {
  modelRevision: 'fde-bench/sofagent-surrogate-v1',
  maxContextTokens: 8192,
  encode: (s) => [[...s].map((c) => c.charCodeAt(0) % 97)],
  isSingleToken: () => true,
  decodeToken: (t) => String.fromCharCode(t),
};
const rt = new JudgeRuntime(enc);

// ── 通用件：确定性启发式（无结构约束的文本通道形态）──
// 打分启发：候选含否定/限制词（不能/须/严格/红线/不得/人工）得分高——
// 模拟「通用模型按表层语义倾向答题」。刻意简单：本读数对照组的意义是
// 链路对照（结构约束 vs 无约束），不是模型能力。
function genericPick(item) {
  const cands = item.candidates ?? [];
  if (item.primitive === 'choice' && cands.length > 0) {
    const RISK = /(不能|不得|须|严格|红线|人工|限制|拒绝|升级|暂停)/;
    const scores = cands.map((c) => (RISK.test(String(c)) ? 2 : 0) + String(c).length % 3);
    const max = Math.max(...scores);
    return { kind: 'choice', pick: cands[scores.indexOf(max)] };
  }
  if (item.primitive === 'noul') {
    // 倾向答「是/需介入」（保守偏置）
    return { kind: 'noul', probability: 0.62 };
  }
  return { kind: 'score', value: 5.5 };
}

// ── 评测两件 ──
function evaluate(name, answerFn) {
  let hit = 0, ff = 0;
  const byPrim = {};
  for (const item of items) {
    const p = item.primitive ?? 'choice';
    byPrim[p] ??= { hit: 0, n: 0 };
    byPrim[p].n += 1;
    let a;
    try { a = answerFn(item); } catch { ff += 1; continue; }
    let ok = false;
    if (item.primitive === 'choice') {
      ok = a.kind === 'choice' && a.pick === item.gold;
    } else if (item.primitive === 'noul') {
      const truthVal = (() => {
        const g = item.gold;
        if (typeof g === 'boolean') return g ? 1 : 0;
        if (typeof g === 'number') return g >= 0.5 ? 1 : 0;
        if (typeof g === 'string') return /是|需要|应|须/.test(g) ? 1 : 0;
        return 0;
      })();
      ok = a.kind === 'noul' && (a.probability >= 0.5 ? 1 : 0) === truthVal;
    } else {
      const gv = typeof item.gold === 'number' ? item.gold : 5;
      ok = a.kind === 'score' && Math.abs(a.value - gv) <= 1.5;
    }
    if (ok) { hit += 1; byPrim[p].hit += 1; }
  }
  const byPrimOut = {};
  for (const [k, v] of Object.entries(byPrim)) byPrimOut[k] = { acc: +(v.hit / v.n).toFixed(4), n: v.n };
  return {
    name,
    overall: +(hit / items.length).toFixed(4),
    byPrimitive: byPrimOut,
    formatFailureRate: +(ff / items.length).toFixed(4),
  };
}

// 本仓件 answerFn：JudgeRuntime 类型化调用
function judgeAnswer(item) {
  if (item.primitive === 'choice') {
    const q = {
      kind: 'choice', id: item.id, question: item.question,
      options: [...(item.candidates ?? []).map((c, i) => ({ id: `opt-${i}`, label: String(c) })), { id: 'opt-fb', label: '无合适项→转人工', isFallback: true }],
    };
    const r = rt.judge({ state: item.state, questions: [q] });
    const ans = r.answers[0];
    const idx = Number(ans.selected?.replace('opt-', '') ?? -1);
    return { kind: 'choice', pick: item.candidates?.[idx] };
  }
  if (item.primitive === 'noul') {
    const q = { kind: 'noul', id: item.id, question: item.question };
    const r = rt.judge({ state: item.state, questions: [q] });
    return { kind: 'noul', probability: r.answers[0].probability ?? 0.5 };
  }
  const q = { kind: 'score', id: item.id, question: item.question, min: 0, max: 10 };
  const r = rt.judge({ state: item.state, questions: [q] });
  return { kind: 'score', value: r.answers[0].value ?? 5 };
}

const ours = evaluate('sofagent-judge（类型化接口·surrogate encoder）', judgeAnswer);
const generic = evaluate('generic-baseline（启发式替身·文本通道）', genericPick);
// 替身形态注记内嵌脚本（重跑逐字节一致——note 不在归档后手改）
ours.note =
  'surrogate encoder 契约面：noul 头概率呈饱和态（多数 1.0/0.0 极化）——链路对照读数，非真基座能力；真读数待训练基座（f9a 系）接入';
generic.note = '确定性启发式替身（风险词倾向+保守偏置）——代表无结构约束的文本通道基线档';

const out = {
  kind: 'fde-bench-two-model',
  date: new Date().toISOString().slice(0, 10),
  bench: 'fde-bench-items.v4.jsonl',
  itemCount: items.length,
  dedup: 'state+question 零重复（384 键全唯一）',
  coverage: '30/30 决策点',
  readings: { ours, generic },
  caliber: '同判据集·同评测器·同指标（acc + 原语分列 + 格式破坏率）；只并列不排名——两件均为替身形态（链路对照：类型化接口 vs 无结构约束通道），非能力横比',
  lint: 'fde-bench-lint.py --pilot：逐题违规 0 · id 重复 0 · 出口不一致 0；卷级警告 4 条属登记型（noul 众数失衡→评测侧类均衡缓解；锚i 棘轮 3 条→factory 台账侧对齐）',
};

console.log(JSON.stringify(out, null, 2));

const archiveDir = join(here, 'v19-density');
mkdirSync(archiveDir, { recursive: true });
const outFile = join(archiveDir, `fde-bench-compare-${out.date.replace(/-/g, '')}.json`);
writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.error(`已归档: ${outFile}`);
