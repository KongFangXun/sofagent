// ============================================================
// 判定观测落盘（v1.9 §六「持续采集面」生产端）
// ------------------------------------------------------------
// 两个缺口在此闭合：
//   ① findings 生产者——探针跑完把结果写 `<dataDir>/dashboard/judge-probes.json`，
//      供 dashboard 消费（此前 `renderProbePanel` 只有渲染、无人产出数据）；
//   ② 趋势落盘——`buildTrends` 只吃内存数组，本模块把 TrendPoint 追加到 JSONL，
//      下一次读取即得「跨批次趋势」（非一次性跑分）。
// 纪律：写入一律原子（tmp + rename），坏行读取时丢弃并计数，不静默当 0。
// ============================================================

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import {
  buildTrends,
  runAllProbes,
  renderProbePanel,
  type JudgeObservation,
  type ProbeFinding,
  type TrendPoint,
  type TrendSeries,
  type UsageMetrics,
} from './judge-observability';

// ------------------------------------------------------------
// ① 探针 findings 生产者
// ------------------------------------------------------------

export interface ProbeSnapshot {
  /** 采集时点（ISO） */
  ts: string;
  findings: ProbeFinding[];
  /** 面板 Markdown（渲染结果一并落盘，dashboard 与 CLI 共用同一份） */
  panel: string;
  /** 本次判定的使用度量（缺失即不写该段——不补零） */
  usage?: UsageMetrics;
}

/** `<dataDir>/dashboard/judge-probes.json` 的规范落点 */
export function probeSnapshotPath(dataDir: string): string {
  return join(dataDir, 'dashboard', 'judge-probes.json');
}

/** 跑四探针（+ 表征级，若给了嵌入）并落盘；返回落盘路径与快照 */
export function produceProbeSnapshot(
  dataDir: string,
  input: { window: JudgeObservation[]; baseline: JudgeObservation[]; embeddings?: number[][]; usage?: UsageMetrics },
  now: Date = new Date()
): { path: string; snapshot: ProbeSnapshot } {
  const findings = runAllProbes(input);
  const snapshot: ProbeSnapshot = {
    ts: now.toISOString(),
    findings,
    panel: renderProbePanel(findings, input.usage),
    ...(input.usage ? { usage: input.usage } : {}),
  };
  const path = probeSnapshotPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
  return { path, snapshot };
}

/** 读取最近一次快照；不存在返回 null（dashboard 用它决定空态） */
export function readProbeSnapshot(dataDir: string): ProbeSnapshot | null {
  const path = probeSnapshotPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProbeSnapshot;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// ② 趋势落盘（跨批次累积）
// ------------------------------------------------------------

export interface TrendStoreSummary {
  appended: number;
  total: number;
  path: string;
}

/** 追加 TrendPoint（JSONL，一行一点；同一 metric 跨批次累积） */
export function appendTrendPoints(file: string, points: TrendPoint[], now: Date = new Date()): TrendStoreSummary {
  if (!points.length) return { appended: 0, total: readTrendPoints(file).points.length, path: file };
  mkdirSync(dirname(file), { recursive: true });
  const lines = points.map((p) =>
    JSON.stringify({
      ts: p.ts || now.toISOString(),
      layer: p.layer,
      metric: p.metric,
      value: p.value,
    })
  );
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const prefix = prev && !prev.endsWith('\n') ? prev + '\n' : prev;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, prefix + lines.join('\n') + '\n', 'utf8');
  renameSync(tmp, file);
  const after = readTrendPoints(file);
  return { appended: lines.length, total: after.points.length, path: file };
}

/** 读趋势点；坏行丢弃并计数（不静默当 0，也不让一行坏掉整份） */
export function readTrendPoints(file: string): { points: TrendPoint[]; badLines: number } {
  if (!existsSync(file)) return { points: [], badLines: 0 };
  const raw = readFileSync(file, 'utf8');
  const points: TrendPoint[] = [];
  let badLines = 0;
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Partial<TrendPoint>;
      if (
        typeof o.ts === 'string' &&
        (o.layer === 'L1' || o.layer === 'L2' || o.layer === 'L3' || o.layer === 'E2E') &&
        typeof o.metric === 'string' &&
        typeof o.value === 'number' &&
        Number.isFinite(o.value)
      ) {
        points.push({ ts: o.ts, layer: o.layer, metric: o.metric, value: o.value });
      } else {
        badLines += 1;
      }
    } catch {
      badLines += 1;
    }
  }
  return { points, badLines };
}

/** 读盘 → 建趋势 → 渲染（dashboard / CLI 共用；退化方向默认「越高越差」，可覆写） */
/** 指标退化方向默认值：准确率/覆盖率越高越好（-1 表示越低越差），误差/延迟越高越差 */
export function defaultWorseWhen(metric: string): -1 | 1 {
  const m = metric.toLowerCase();
  if (/(^|_)(acc|accuracy|coverage|cov|recall|precision|f1)(_|$)/.test(m)) return -1;
  return 1;
}

export function buildTrendReport(
  file: string,
  worseWhen: Record<string, -1 | 1> = {}
): { series: TrendSeries[]; badLines: number; text: string } {
  const { points, badLines } = readTrendPoints(file);
  const merged: Record<string, -1 | 1> = {};
  for (const p of points) merged[p.metric] = worseWhen[p.metric] ?? defaultWorseWhen(p.metric);
  const series = buildTrends(points, merged);
  const lines: string[] = ['## 四层趋势（持续采集）', ''];
  if (!series.length) {
    lines.push('无趋势数据（该文件尚无采集点）。');
  } else {
    lines.push('| 层 | 指标 | 点数 | 首值 | 末值 | 退化 |');
    lines.push('|---|---|---|---|---|---|');
    for (const s of series) {
      const first = s.points[0]!.value;
      const last = s.points[s.points.length - 1]!.value;
      lines.push(`| ${s.layer} | ${s.metric} | ${s.points.length} | ${first} | ${last} | ${s.degrading ? '⚠️ 是' : '否'} |`);
    }
  }
  if (badLines > 0) lines.push('', `> ⚠️ 丢弃坏行 ${badLines} 行（格式不符，未计入趋势）`);
  return { series, badLines, text: lines.join('\n') };
}
