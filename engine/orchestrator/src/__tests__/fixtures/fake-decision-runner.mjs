#!/usr/bin/env node
// ============================================================
// fake-decision-runner.mjs · 判定件 runner 的**测试替身**（v1.8.0 §一 S2）
// ------------------------------------------------------------
// 用途：在不装 torch / 不带真权重的条件下，验证 stdio 通道的分帧、超时、
//       崩溃、协议污染与契约校验行为。**不是**产品代码，不进构建产物。
// 协议：与 stdio-decision-channel.ts 头注释一致（NDJSON；stdout 只放帧，日志走 stderr）。
// 行为开关（env FAKE_MODE）：
//   ok（默认）· garbage（stdout 混入日志）· bad-dist（分布和≠1）· error（自报 weights-missing）
//   · slow（不应答，用于超时）· crash（启动即退出码 2）
// ============================================================

import { createInterface } from 'node:readline';

const MODE = process.env.FAKE_MODE ?? 'ok';

if (MODE === 'crash') {
  process.stderr.write('fake-runner: 模拟启动失败\n');
  process.exit(2);
}

const answersFor = (q) => {
  if (q.primitive === 'choice') {
    const opts = q.options ?? ['yes', 'no'];
    const dist = {};
    opts.forEach((o, i) => (dist[o] = i === 0 ? 0.8 : 0.2 / Math.max(1, opts.length - 1)));
    return { id: q.id, value: opts[0], probability: 0.8, distribution: dist, status: 'answered' };
  }
  if (q.primitive === 'score') {
    const min = q.range?.min ?? 0;
    const max = q.range?.max ?? 1;
    const v = (min + max) / 2;
    return { id: q.id, value: v, probability: 0.6, interval: { min, max }, status: 'answered' };
  }
  return { id: q.id, value: true, probability: 0.9, status: 'answered' };
};

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let req;
  try {
    req = JSON.parse(t);
  } catch {
    process.stderr.write('fake-runner: 请求不是合法 JSON\n');
    return;
  }
  process.stderr.write(`fake-runner: 收到 ${req.id}（${req.questions?.length ?? 0} 问）\n`);

  if (MODE === 'slow') return;                    // 故意不应答 ⇒ 触发通道超时
  if (MODE === 'garbage') {
    process.stdout.write('日志：正在加载权重…\n');   // 污染 stdout ⇒ 应被判 type-mismatch
    return;
  }
  if (MODE === 'error') {
    process.stdout.write(JSON.stringify({ id: req.id, error: { code: 'weights-missing', message: '判定件权重缺失' } }) + '\n');
    return;
  }

  const answers = (req.questions ?? []).map(answersFor);
  if (MODE === 'bad-dist') {
    answers[0] = { ...answers[0], distribution: { only: 0.5 } };   // 和≠1 ⇒ 契约校验应拦
  }
  process.stdout.write(
    JSON.stringify({ id: req.id, answers, modelVersion: 'fake-runner-v0', tempBucket: 'choice-n' }) + '\n',
  );
});
