// density-replay-run.mjs · v1.9.0 §五-348 判定调用密度回放（第四棒①）
// ============================================================
// 用途：给 decision-dispatch 出口的 CallDensityCounter 生产埋点（judge-runtime
// judge() 尾部 noteJudgeCall）回放一条**真实任务链**，产出
// { serialCalls, batchRequests, questionsInBatches, totalQuestions } 读数。
//
// 真实任务链选型：datasets/sofagent-typed-decisions-minimal/questions.jsonl
// （370 题 · 36 判据 × zh/en——已冻结的内部校准对照底盘）。回放按
// **判据 × 语言**分组构造任务：同组题共享判据语境（state 快照），
// 模拟生产两种真实调用形态：
//   · 打包形态：同任务（state）一次 judge 多问——recordBatch
//   · 串行形态：跨任务逐题单问 judge——recordSerial
// 计数器由 attachDensityCounter 挂上（judge-mode 同款模块级单例），
// JudgeRuntime.judge 出口自动喂点——本脚本只装配、不手工计数。
//
// 运行：npm run build --workspace @sofagent/orchestrator && node datasets/density-replay-run.mjs
// 输出：stdout JSON（读数）+ datasets/v19-density/density-replay-YYYYMMDD.json 归档
// ============================================================
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const { JudgeRuntime } = await import(join(here, '../engine/orchestrator/dist/router/judge-runtime.js'));
const { CallDensityCounter, attachDensityCounter, setDensityTaskId, productionDensityReport } = await import(
  join(here, '../engine/orchestrator/dist/router/call-density.js')
);

// 替身 encoder（与 judge-replay CLI / local-judge 同款确定性替身——契约面）
const enc = {
  modelRevision: 'density-replay/surrogate-v1',
  maxContextTokens: 4096,
  encode: (s) => [[...s].map((c) => c.charCodeAt(0) % 97)],
  isSingleToken: () => true,
  decodeToken: (t) => String.fromCharCode(t),
};

// ① 读真实任务链数据（370 题）
const lines = readFileSync(join(here, 'sofagent-typed-decisions-minimal/questions.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim());
const samples = lines.map((l) => JSON.parse(l));
console.error(`读入 ${samples.length} 题（sofagent-typed-decisions-minimal@1.0.0 · 冻结集）`);

// ② 按（判据 × 语言）分组——每组 = 一个真实任务的问句集
const groups = new Map();
for (const s of samples) {
  const key = `${s.criterionId}:${s.language}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(s);
}
console.error(`分组 ${groups.size} 个任务（判据 × 语言）`);

// ③ 装配：挂密度计数器 + JudgeRuntime（喂点在 judge() 出口自动发生）
const counter = new CallDensityCounter();
attachDensityCounter(counter, 'density-replay');
const rt = new JudgeRuntime(enc);

// ④ 回放两形态（模拟生产：批内打包一次 judge / 跨任务串行逐题 judge）
//    形态 A（打包）：每任务一次 judge 调用携带全组问句
for (const [key, qs] of groups) {
  setDensityTaskId(`task/${key}/batched`);
  const state = `任务上下文（${key}）：包含 ${qs.length} 个待判定问句的变更集`;
  const questions = qs.map((q) => {
    if (q.primitiveType === 'choice') {
      return {
        kind: 'choice',
        id: q.id,
        question: q.question,
        options: [
          { id: 'opt-0', label: '是' },
          { id: 'opt-1', label: '否' },
          { id: 'fb', label: '⚠️兜底：转人工', isFallback: true },
        ],
      };
    }
    if (q.primitiveType === 'score') {
      return { kind: 'score', id: q.id, question: q.question, min: 0, max: 10 };
    }
    return { kind: 'noul', id: q.id, question: q.question };
  });
  rt.judge({ state, questions });
}

//    形态 B（串行）：同数据逐题单问（对照组——只报串行会把打包成效记成假象）
for (const [key, qs] of groups) {
  for (const q of qs) {
    setDensityTaskId(`task/${key}/serial`);
    const state = `任务上下文（${key}·串行）：单问判定`;
    const question =
      q.primitiveType === 'choice'
        ? {
            kind: 'choice',
            id: q.id,
            question: q.question,
            options: [
              { id: 'opt-0', label: '是' },
              { id: 'opt-1', label: '否' },
              { id: 'fb', label: '⚠️兜底：转人工', isFallback: true },
            ],
          }
        : q.primitiveType === 'score'
          ? { kind: 'score', id: q.id, question: q.question, min: 0, max: 10 }
          : { kind: 'noul', id: q.id, question: q.question };
    rt.judge({ state, questions: [question] });
  }
}

// ⑤ 读数
const report = productionDensityReport();
const byTask = {};
for (const [taskId, e] of report.byTask) byTask[taskId] = e;

const batchedTasks = Object.fromEntries(
  Object.entries(byTask).filter(([k]) => k.endsWith('/batched')),
);
const serialTasks = Object.fromEntries(
  Object.entries(byTask).filter(([k]) => k.endsWith('/serial')),
);
const batchedQ = Object.values(batchedTasks).reduce((a, e) => a + e.questionsInBatches, 0);
const serialCallsB = Object.values(batchedTasks).reduce((a, e) => a + e.batchRequests, 0);
const serialQ = Object.values(serialTasks).reduce((a, e) => a + e.serialCalls, 0);

const out = {
  kind: 'density-replay',
  date: new Date().toISOString().slice(0, 10),
  dataset: 'sofagent-typed-decisions-minimal@1.0.0',
  sampleCount: samples.length,
  taskCount: groups.size,
  reading: {
    batched: {
      batchRequests: serialCallsB,
      questionsInBatches: batchedQ,
      note: '同任务多问一次前向（打包形态——生产推荐）',
    },
    serial: {
      serialCalls: serialQ,
      note: '同数据逐题单问（对照形态——只报此列会把打包成效记成假象）',
    },
    totalQuestions: report.totalQuestions,
  },
  harness: {
    counter: 'CallDensityCounter（judge-runtime judge() 出口喂点）',
    encoder: 'surrogate（契约面——与 judge-replay CLI 同款确定性替身）',
  },
};

console.log(JSON.stringify(out, null, 2));

// ⑥ 归档
const archiveDir = join(here, 'v19-density');
mkdirSync(archiveDir, { recursive: true });
const outFile = join(archiveDir, `density-replay-${out.date.replace(/-/g, '')}.json`);
writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.error(`已归档: ${outFile}`);
