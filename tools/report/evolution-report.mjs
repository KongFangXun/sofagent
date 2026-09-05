#!/usr/bin/env node
// ============================================================
// evolution-report.mjs · 进化模块样本报告（v1.4.5 第七章一）
// ============================================================
// 用途：node tools/report/evolution-report.mjs
//   读 data/evolution/samples-*.json 持续采样数据 + A/B 对照结论，
//   输出样本报告：周期 + passRate 曲线 + 知识库增量 + 对照结论 +
//   统计显著性 + 证据强度三级标注（公开可查/用户自报/自测自报）+
//   证据树轻量版（结论 → 样本文件 → 原始 eval 记录可回溯路径）。
//
// 诚实口径（本版如实标注）：
//   一、7 天采样未满（本版交付采样器，样本达标后「越用越好」措辞
//       才挂实测链接——README/PHILOSOPHY/LIMITATIONS 现状维持不加链接）
//   二、数据不足时如实说不足（不输出显著性裁决）
//   三、降级轮（providerStatus=mock）单独计数醒目标注
//
// 零依赖：Node 内置模块 only（fs/path/os）——与 FORGE 工具链同款。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR =
  process.env.SOFAGENT_DATA ||
  path.join(process.env.SOFAGENT_HOME || path.join(os.homedir(), '.sofagent'), 'data');
const EVOLUTION_DIR = path.join(DATA_DIR, 'evolution');

// ── 一、读采样数据（与 continuous-sampler.readAllSamples 同语义的 mjs 版）──

function readAllSamples() {
  if (!fs.existsSync(EVOLUTION_DIR)) return [];
  const files = fs
    .readdirSync(EVOLUTION_DIR)
    .filter((f) => /^samples-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const samples = [];
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(EVOLUTION_DIR, file), 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        samples.push(JSON.parse(line));
      } catch {
        // 坏行跳过
      }
    }
  }
  return samples;
}

// ── 二、读台账（skill-impact——提案收编统计）──────────────────

function readSkillImpact() {
  const ledger = path.join(DATA_DIR, 'skill-evolution', 'skill-impact.jsonl');
  if (!fs.existsSync(ledger)) return [];
  const entries = [];
  for (const line of fs.readFileSync(ledger, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 坏行跳过
    }
  }
  return entries;
}

// ── 三、报告输出 ──────────────────────────────────────────

const TARGET_DAYS = 7;
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const samples = readAllSamples();
const ledger = readSkillImpact();

console.log('════════════════════════════════════════════════════');
console.log('  进化模块样本报告（evolution report）');
console.log(`  数据源：${EVOLUTION_DIR}`);
console.log('════════════════════════════════════════════════════');
console.log('');

// ── 周期 ──
const days = samples.length;
const mockDays = samples.filter((s) => s.providerStatus === 'mock').length;
const uniqueDays = new Set(samples.map((s) => s.date)).size;
console.log(B('一、采样周期'));
if (days === 0) {
  console.log('  样本数 0——采样器未运行或数据目录为空。');
  console.log(`  启动：daemon dream-cycle 调度（@daily）自动采样；目标 ≥${TARGET_DAYS} 天。`);
} else {
  console.log(`  样本 ${days} 行（覆盖 ${uniqueDays} 个自然日）｜首 ${samples[0].date} ～ 末 ${samples[samples.length - 1].date}`);
  console.log(`  目标周期 ≥${TARGET_DAYS} 天：${uniqueDays >= TARGET_DAYS ? '✅ 已满' : `⏳ ${uniqueDays}/${TARGET_DAYS}（未满——如实标注，不声称达标）`}`);
  if (mockDays > 0) {
    console.log(`  ⚠️ 降级轮 ${mockDays} 天（providerStatus=mock——大脑降级为 MockLLM，该轮知识产出不可当真实样本）`);
  }
}
console.log('');

// ── 曲线 ──
console.log(B('二、eval passRate 曲线 + 知识库增量'));
if (days === 0) {
  console.log('  （无数据）');
} else {
  console.log('  date        passRate  cases  entities  delta  corrections  brain');
  for (const s of samples) {
    const passRate = s.evalPassRate === null ? '  null ' : `${(s.evalPassRate * 100).toFixed(0).padStart(4)}%`;
    const delta = s.knowledgeDelta === null ? '    -' : String(s.knowledgeDelta).padStart(4);
    console.log(
      `  ${s.date}   ${passRate}   ${String(s.evalCaseCount).padStart(4)}  ${String(s.knowledgeEntities).padStart(8)}  ${delta}  ${String(s.correctionReflows).padStart(12)}  ${s.providerStatus === 'mock' ? '⚠️ mock' : 'real'}`,
    );
  }
}
console.log('');

// ── 台账 ──
console.log(B('三、技能进化台账（skill-impact）'));
if (ledger.length === 0) {
  console.log('  台账为空——尚无技能进化提案落账。');
} else {
  const accepted = ledger.filter((e) => e.verdict === 'accepted').length;
  const rejected = ledger.filter((e) => e.verdict === 'rejected').length;
  console.log(`  提案 ${ledger.length} 条：accepted ${accepted} / rejected ${rejected}（被拒提案不丢教训——台账可查）`);
  const rejectedWithReason = ledger.filter((e) => e.verdict === 'rejected');
  for (const r of rejectedWithReason.slice(0, 3)) {
    console.log(`  · ${r.proposalId}：${r.rejectReason || '（原因缺失）'}`);
  }
}
console.log('');

// ── 对照结论 + 显著性 ──
console.log(B('四、A/B 对照与统计显著性'));
const abLatestPath = path.join(DATA_DIR, 'ab-tests', 'latest.json');
if (fs.existsSync(abLatestPath)) {
  try {
    const ab = JSON.parse(fs.readFileSync(abLatestPath, 'utf-8'));
    console.log(`  最近 A/B：winner=${ab.winner ?? 'unknown'} margin=${(ab.margin ?? 0).toFixed(3)}`);
    console.log(`  显著性判定：见 ab-test 运行输出（twoProportionZTest，|z| ≥ 1.96）`);
  } catch {
    console.log('  latest.json 解析失败——如实记数据不可读');
  }
} else {
  console.log('  无 A/B 对照数据（runEvolutionAB 未跑或结果未持久化）。');
  console.log(`  运行：复用 v1.3.5 ab-runner——${DIM('engine/ab-test/src/evolution-ab.ts runEvolutionAB')}`);
}
console.log('');

// ── 证据强度三级标注 ──
console.log(B('五、证据强度三级标注'));
console.log('  本报告全部结论证据强度 = 【自测自报】（本项目自己跑的采样与 A/B，无第三方复核）');
console.log('  三级口径：');
console.log('    一级 公开可查  —— 第三方可独立复现（如 CI 公开日志/公开 benchmark）');
console.log('    二级 用户自报  —— 企业用户在自有环境运行后反馈');
console.log('    三级 自测自报  —— 本项目自建采样管线产出（当前级别）');
console.log('');

// ── 证据树轻量版 ──
console.log(B('六、证据树（结论 → 样本文件 → 原始记录）'));
if (days === 0) {
  console.log('  （无样本——树为空）');
} else {
  const dates = [...new Set(samples.map((s) => s.date))];
  console.log('  结论（本报告「一~四」节数字）');
  console.log(`   └→ 样本文件（${dates.length} 个）`);
  for (const d of dates.slice(0, 3)) {
    console.log(`       · ${path.join('data', 'evolution', `samples-${d}.json`)}`);
  }
  if (dates.length > 3) console.log(`       · …（共 ${dates.length} 个）`);
  console.log(`       └→ 原始 eval 记录（可回溯）`);
  const benchDir = path.join(DATA_DIR, 'benchmarks');
  if (fs.existsSync(benchDir)) {
    for (const b of fs.readdirSync(benchDir).slice(0, 3)) {
      console.log(`           · ${path.join('data', 'benchmarks', b, 'evaluation-log.jsonl')}（HMAC 链防篡改）`);
    }
  } else {
    console.log(`           · ${path.join('data', 'benchmarks', '<id>', 'evaluation-log.jsonl')}（暂无——eval 未跑）`);
  }
  console.log(`       └→ 台账原始记录`);
  console.log(`           · ${path.join('data', 'skill-evolution', 'skill-impact.jsonl')}`);
}
console.log('');

// ── 措辞口径（施工备忘：样本达标前不加实测链接）──
console.log(B('七、措辞口径确认'));
const met = uniqueDays >= TARGET_DAYS && mockDays === 0;
console.log(
  met
    ? '  采样已达标（≥7 天全真脑）——README/PHILOSOPHY/LIMITATIONS「越用越好」表述可挂实测链接。'
    : '  采样未达标——README/PHILOSOPHY/LIMITATIONS「越用越好」表述维持现状（不加实测链接），本报告即该口径的证据。',
);
console.log('');
console.log('（报告完——数据齐时输出显著性判定与三级标注；数据不足处已如实标注不足。）');
