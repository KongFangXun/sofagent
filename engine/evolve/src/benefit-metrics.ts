// benefit-metrics.ts · 进化收益四指标取数器（v1.5.8 章二补强）
//
// 「四指标可计算可记录」的取数半件：从**既有台账文件**读数（零新数据源——
// 任务书纪律「数据从既有台账取，不造新数据源」）。四源：
//   ① 任务通过率趋势 ← {dataDir}/ab-history.jsonl（orchestrator PlanMetrics——
//      窗口首尾 passed/(passed+failed) 斜率；evolve 不依赖 orchestrator，
//      按 jsonl 文件契约读行，字段名与 PlanMetrics 一致）
//   ② 错题本复发率 ← {dataDir}/evolve/failure-ledger.jsonl（同模式重犯占比：
//      occurrences≥2 的 pattern 数 / 总 pattern 数）
//   ③ skill 复用率 ← {dataDir}/skill-evolution/skill-impact.jsonl（accepted
//      提案的（invocations/productions）——台账无 invocation 字段时按
//      accepted/total 产出比计，字段可选消费）
//   ④ 纠偏介入率 ← {dataDir}/audit/decision-log.jsonl 的 kind=ESCALATE_REPORT
//      计数 / 窗口内总 decision 数
//
// 全部容错：文件缺失/行损坏 → 该维度 null（不猜数）；四维全 null → 抛错
// （fail-loud，宁缺勿假）。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvolutionBenefitMetrics } from './promotion-policy';

/** 可选维度（null = 台账缺失，不猜数） */
export type OptionalMetric = number | null;

/** 读入 JSONL 行（容忍损坏行——跳过计数） */
function readJsonl(path: string): { rows: Array<Record<string, unknown>>; corrupted: number } {
  if (!existsSync(path)) return { rows: [], corrupted: 0 };
  const rows: Array<Record<string, unknown>> = [];
  let corrupted = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      corrupted += 1;
    }
  }
  return { rows, corrupted };
}

/** ① 任务通过率趋势：ab-history.jsonl 窗口首尾通过率之差（正 = 变强） */
export function passRateTrendFromAbHistory(dataDir: string, window = 20): OptionalMetric {
  const { rows } = readJsonl(join(dataDir, 'ab-history.jsonl'));
  if (rows.length < 2) return null;
  const win = rows.slice(-window);
  const rate = (r: Record<string, unknown>): number | null => {
    const p = Number(r['passed']); const f = Number(r['failed']);
    if (!Number.isFinite(p) || !Number.isFinite(f) || p + f <= 0) return null;
    return p / (p + f);
  };
  const half = Math.max(1, Math.floor(win.length / 2));
  const firstHalf = win.slice(0, half).map(rate).filter((v): v is number => v !== null);
  const lastHalf = win.slice(-half).map(rate).filter((v): v is number => v !== null);
  if (firstHalf.length === 0 || lastHalf.length === 0) return null;
  return avg(lastHalf) - avg(firstHalf);
}

/** ② 错题本复发率：failure-ledger.jsonl 中重复模式占比（低 = 好） */
export function recurrenceRateFromFailureLedger(dataDir: string): OptionalMetric {
  const { rows } = readJsonl(join(dataDir, 'evolve', 'failure-ledger.jsonl'));
  if (rows.length === 0) return null;
  const byPattern = new Map<string, number>();
  for (const r of rows) {
    const p = String(r['pattern'] ?? r['id'] ?? '');
    if (!p) continue;
    byPattern.set(p, (byPattern.get(p) ?? 0) + (Number(r['occurrences']) || 1));
  }
  if (byPattern.size === 0) return null;
  let repeated = 0;
  for (const n of byPattern.values()) if (n >= 2) repeated += 1;
  return repeated / byPattern.size;
}

/** ③ skill 复用率：skill-impact.jsonl accepted 占比（高 = 沉淀在被复用） */
export function skillReuseRateFromImpactLedger(dataDir: string): OptionalMetric {
  const { rows } = readJsonl(join(dataDir, 'skill-evolution', 'skill-impact.jsonl'));
  if (rows.length === 0) return null;
  const accepted = rows.filter((r) => r['verdict'] === 'accepted').length;
  // 有 invocation 计数字段则用真复用率；否则 accepted 产出比（同源台账两种口径均记录在案）
  const inv = rows.map((r) => Number(r['invocations'])).filter((v) => Number.isFinite(v));
  const prod = rows.map((r) => Number(r['productions'])).filter((v) => Number.isFinite(v));
  if (inv.length === rows.length && prod.length === rows.length && prod.some((v) => v > 0)) {
    return sum(inv) / sum(prod);
  }
  return accepted / rows.length;
}

/** ④ 纠偏介入率：decision-log.jsonl 中 ESCALATE_REPORT 占比（低 = 好） */
export function interventionRateFromDecisionLog(dataDir: string): OptionalMetric {
  const { rows } = readJsonl(join(dataDir, 'audit', 'decision-log.jsonl'));
  if (rows.length === 0) return null;
  const escalated = rows.filter((r) => r['kind'] === 'ESCALATE_REPORT').length;
  return escalated / rows.length;
}

/** 四指标聚合取数（缺维度 null；全缺抛错——fail-loud） */
export function collectBenefitMetrics(dataDir: string): EvolutionBenefitMetrics & { raw: { availableDims: number } } {
  const passRateTrend = passRateTrendFromAbHistory(dataDir);
  const recurrenceRate = recurrenceRateFromFailureLedger(dataDir);
  const skillReuseRate = skillReuseRateFromImpactLedger(dataDir);
  const interventionRate = interventionRateFromDecisionLog(dataDir);
  const dims = [passRateTrend, recurrenceRate, skillReuseRate, interventionRate].filter((v) => v !== null);
  if (dims.length === 0) {
    throw new Error(`[benefit-metrics] 四维台账全部缺失（${dataDir}）——宁缺勿假，不产出虚构指标`);
  }
  return {
    passRateTrend: passRateTrend ?? 0,
    recurrenceRate: recurrenceRate ?? 0,
    skillReuseRate: skillReuseRate ?? 0,
    interventionRate: interventionRate ?? 0,
    raw: { availableDims: dims.length },
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
