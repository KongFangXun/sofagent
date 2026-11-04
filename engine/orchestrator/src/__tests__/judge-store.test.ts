import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  produceProbeSnapshot,
  readProbeSnapshot,
  probeSnapshotPath,
  appendTrendPoints,
  readTrendPoints,
  buildTrendReport,
  defaultWorseWhen,
} from '../router/judge-store';
import type { JudgeObservation, TrendPoint } from '../router/judge-observability';

let dir: string;

function obs(n: number, drift: number, abstained: number, latency: number): JudgeObservation[] {
  return Array.from({ length: n }, (_, i) => {
    const raw = [0.7 - drift, 0.2 + drift * 0.5, 0.1 + drift * 0.5];
    const s = raw.reduce((a, b) => a + b, 0);
    return {
      ts: `2026-11-04T05:${String(i).padStart(2, '0')}:00Z`,
      criterionId: 'c1',
      distribution: raw.map((x) => x / s),
      abstained: i / n < abstained,
      inputTokens: 600 + i,
      latencyMs: latency + (i % 7) * 20,
    };
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'judge-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('F6.4 #4 · 探针 findings 生产者（落盘 → 读回）', () => {
  it('produceProbeSnapshot 写 <dataDir>/dashboard/judge-probes.json，且 readProbeSnapshot 可原样读回', () => {
    const { path, snapshot } = produceProbeSnapshot(dir, {
      window: obs(40, 0.25, 0.35, 1400),
      baseline: obs(40, 0, 0.05, 800),
    });
    expect(path).toBe(probeSnapshotPath(dir));
    expect(snapshot.findings.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.panel).toContain('判定层失效探测');

    const back = readProbeSnapshot(dir);
    expect(back).not.toBeNull();
    expect(back!.findings.length).toBe(snapshot.findings.length);
    expect(back!.ts).toBe(snapshot.ts);

    // 落盘是合法 JSON（dashboard 直接 fetch 它）
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect(raw.panel).toBe(snapshot.panel);
  });

  it('未采集时 readProbeSnapshot 返回 null（dashboard 走空态，不伪造空数组）', () => {
    expect(readProbeSnapshot(dir)).toBeNull();
  });

  it('usage 给了才写该段——不给不补零', () => {
    const a = produceProbeSnapshot(dir, { window: obs(10, 0, 0, 800), baseline: obs(10, 0, 0, 800) });
    expect(a.snapshot.usage).toBeUndefined();
    const b = produceProbeSnapshot(dir, {
      window: obs(10, 0, 0, 800),
      baseline: obs(10, 0, 0, 800),
      usage: { n: 10, adoptionRate: 0.5, askRate: 0.3, denyRate: 0.1, overrideRate: 0.1, unconsumed: false, overridden: false } as never,
    });
    expect(b.snapshot.usage).toBeDefined();
  });
});

describe('F6.4 #8 · 趋势落盘（跨批次累积，非一次性跑分）', () => {
  const p = (ts: string, metric: string, value: number): TrendPoint => ({ ts, layer: 'L1', metric, value });

  it('两次追加累积：2 → 3，返回 appended/total', () => {
    const f = join(dir, 'trends.jsonl');
    const r1 = appendTrendPoints(f, [p('2026-11-03T10:00:00Z', 'acc', 0.77), p('2026-11-04T10:00:00Z', 'acc', 0.76)]);
    expect(r1).toMatchObject({ appended: 2, total: 2 });
    const r2 = appendTrendPoints(f, [p('2026-11-05T10:00:00Z', 'acc', 0.75)]);
    expect(r2).toMatchObject({ appended: 1, total: 3 });
    expect(readTrendPoints(f).points).toHaveLength(3);
  });

  it('坏行丢弃并计数（不静默当 0，也不让一行坏掉整份）', () => {
    const f = join(dir, 'trends.jsonl');
    appendTrendPoints(f, [p('2026-11-03T10:00:00Z', 'acc', 0.77)]);
    writeFileSync(f, readFileSync(f, 'utf8') + '{"ts":"x","layer":"L9","metric":"bad","value":1}\nnot-json\n');
    const r = readTrendPoints(f);
    expect(r.points).toHaveLength(1);
    expect(r.badLines).toBe(2);
  });

  it('acc 下降判为退化（worseWhen=-1），ece 上升判为退化（worseWhen=+1）', () => {
    const f = join(dir, 'trends.jsonl');
    appendTrendPoints(f, [
      p('2026-11-03T10:00:00Z', 'acc', 0.77),
      p('2026-11-04T10:00:00Z', 'acc', 0.76),
      { ts: '2026-11-03T10:00:00Z', layer: 'L2', metric: 'ece15', value: 0.03 },
      { ts: '2026-11-04T10:00:00Z', layer: 'L2', metric: 'ece15', value: 0.05 },
    ]);
    const rep = buildTrendReport(f);
    const acc = rep.series.find((s) => s.metric === 'acc')!;
    const ece = rep.series.find((s) => s.metric === 'ece15')!;
    expect(acc.degrading).toBe(true);
    expect(ece.degrading).toBe(true);
    expect(defaultWorseWhen('acc')).toBe(-1);
    expect(defaultWorseWhen('ece15')).toBe(1);
  });
});
