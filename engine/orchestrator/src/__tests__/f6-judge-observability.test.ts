// ============================================================
// __tests__/f6-judge-observability.test.ts · F6.4 失效探测验收（v1.9 §六 10 条）
// ============================================================
// 每个用例对应一条验收：探针必须能被**构造输入**打红（不是「应该能」）。
// 核心红测（O1）刻意点名「分布漂移」以外的形态：用**表征级坍缩 + 输出分布完全正常**
// 证明最深形态能被抓住——四探针在这组输入上全绿，只有表征级报红（这是设计意图）。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  PROBE_THRESHOLDS,
  buildTrends,
  computeUsageMetrics,
  detectCollaborationChannels,
  probeAbstainMutation,
  probeCharacterizationCollapse,
  probeDistributionDrift,
  probeLengthLatency,
  probeProbabilityAnomaly,
  renderProbePanel,
  runAllProbes,
  selectChannelBeforeLoad,
  traceCompression,
  type AgentEvent,
  type JudgeObservation,
  type UsageRecord,
} from '../router/judge-observability';
import { resolveChannelBeforeLoad } from '../router/decision-dispatch';

/** 造 n 条观测：dist 固定、可调置信/弃权/长度/延迟 */
function obs(n: number, dist: number[], extra: Partial<JudgeObservation> = {}): JudgeObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(Date.UTC(2026, 10, 3, 0, 0, i)).toISOString(),
    criterionId: 'q',
    distribution: dist,
    abstained: false,
    inputTokens: 100 + i,
    latencyMs: 1000 + i,
    ...extra,
  }));
}

describe('F6.4 · 静默失败四探针（产出级）', () => {
  it('O1 核心红测：单峰突变 ⇒ 分布漂移探针报 alert（点名声明的探针 + 期望输出）', () => {
    const baseline = obs(40, [0.25, 0.25, 0.25, 0.25]);
    const window = obs(40, [0.97, 0.01, 0.01, 0.01]);
    const f = probeDistributionDrift(window, baseline);
    expect(f.probe).toBe('distribution-drift');
    expect(f.severity).toBe('alert');
    expect(Number(f.metric)).toBeGreaterThanOrEqual(PROBE_THRESHOLDS.driftJsAlert);
    expect(f.detail).toContain('n=40');
  });

  it('O2 概率异常：长期贴 0.5 ⇒ warn；长期贴 1.0 ⇒ alert（两种形态分开）', () => {
    const half = probeProbabilityAnomaly(obs(30, [0.51, 0.49]));
    expect(half.severity).toBe('warn');
    const one = probeProbabilityAnomaly(obs(30, [0.995, 0.005]));
    expect(one.severity).toBe('alert');
    expect(one.detail).toContain('坍塌');
  });

  it('O3 弃权率突变：0% → 40% ⇒ alert，且给出 pp 与两侧 n', () => {
    const baseline = obs(30, [0.7, 0.3], { abstained: false });
    const window = [
      ...obs(18, [0.7, 0.3], { abstained: false }),
      ...obs(12, [0.5, 0.5], { abstained: true }),
    ];
    const f = probeAbstainMutation(window, baseline);
    expect(f.severity).toBe('alert');
    expect(f.detail).toContain('pp');
    expect(f.n).toBe(30);
  });

  it('O4 长度-延迟相关：基线无关 → 窗口强相关 ⇒ alert（|Δr| 可复算）', () => {
    const baseline = obs(30, [0.7, 0.3]).map((o, i) => ({ ...o, latencyMs: i % 2 ? 800 : 1600 }));
    const window = obs(30, [0.7, 0.3]).map((o) => ({ ...o, latencyMs: o.inputTokens * 10 }));
    const f = probeLengthLatency(window, baseline);
    expect(f.severity).toBe('alert');
    expect(f.detail).toContain('|Δ|');
  });

  it('O5 样本不足 ⇒ 一律 ok + insufficient（不假装判定）', () => {
    const f = probeDistributionDrift(obs(5, [0.5, 0.5]), obs(5, [0.5, 0.5]));
    expect(f.severity).toBe('ok');
    expect(f.metric).toBe('insufficient');
  });
});

describe('F6.4 · 表征级探针（前四探针抓不到的形态）', () => {
  it('O6 输出分布完全正常，但嵌入秩坍缩 ⇒ 表征级报 alert（四探针全绿）', () => {
    // 输出分布：每条都健康（0.7/0.3），四探针不会报红
    const window = obs(40, [0.7, 0.3]);
    const baseline = obs(40, [0.7, 0.3]);
    const findings = runAllProbes({ window, baseline });
    expect(findings.filter((f) => f.severity === 'alert')).toHaveLength(0);

    // 嵌入：40×8 全部近似同一方向（秩 1）⇒ 有效秩占比极低
    const collapsed = Array.from({ length: 40 }, (_, i) => {
      const base = [1, 0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93];
      return base.map((v) => v + (i % 3) * 1e-4);
    });
    const f = probeCharacterizationCollapse(collapsed);
    expect(f.probe).toBe('characterization-collapse');
    expect(f.severity).toBe('alert');
    expect(f.detail).toContain('慢特征坍缩');
  });

  it('O7 嵌入各向同性 ⇒ 不报（负例，防止「总是红」）', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    const full = Array.from({ length: 60 }, () => Array.from({ length: 8 }, () => rnd()));
    const f = probeCharacterizationCollapse(full);
    expect(f.severity).toBe('ok');
  });
});

describe('F6.4 · 入口前置分流（模型加载之前）', () => {
  const candidates = [
    { name: 'local-judge', requiresLoad: true, health: 0.9, priority: 1 },
    { name: 'rule-l0', requiresLoad: false, health: null, priority: 2 },
    { name: 'cloud', requiresLoad: true, health: 0.8, priority: 3 },
  ];

  it('O8 禁止加载 ⇒ 只选无需加载的通道，且理由与排除项可查', () => {
    const s = selectChannelBeforeLoad(candidates, { allowLoad: false });
    expect(s.channel?.name).toBe('rule-l0');
    expect(s.decidedBeforeLoad).toBe(true);
    expect(s.excluded.map((e) => e.why)).toContain('requires-load-but-load-not-allowed');
    expect(s.excluded).toHaveLength(2);
  });

  it('O9 「选错路径」可查：健康度为 0 的通道被排除并给出原因（不静默走默认）', () => {
    const bad = [{ name: 'broken', requiresLoad: false, health: 0, priority: 0 }, ...candidates];
    const s = selectChannelBeforeLoad(bad, { allowLoad: true });
    expect(s.channel?.name).toBe('local-judge');
    expect(s.excluded).toContainEqual({ name: 'broken', why: 'health<=0' });
  });
});

describe('F6.4 · 判定使用度量（无人消费 vs 被推翻可区分）', () => {
  it('O10 全部 pending ⇒ unconsumed=true、overridden=false', () => {
    const recs: UsageRecord[] = Array.from({ length: 10 }, () => ({ grade: 'ALLOW', verdict: 'pending' as const }));
    const m = computeUsageMetrics(recs);
    expect(m.unconsumed).toBe(true);
    expect(m.overridden).toBe(false);
    expect(m.adoptionRate).toBeNull();
  });

  it('O11 落地即被推翻 60% ⇒ overridden=true、unconsumed=false，四指标齐', () => {
    const recs: UsageRecord[] = [
      ...Array.from({ length: 6 }, () => ({ grade: 'ASK' as const, verdict: 'overridden' as const })),
      ...Array.from({ length: 4 }, () => ({ grade: 'ALLOW' as const, verdict: 'adopted' as const })),
    ];
    const m = computeUsageMetrics(recs);
    expect(m.overridden).toBe(true);
    expect(m.unconsumed).toBe(false);
    expect(m.overrideRate).toBe(0.6);
    expect(m.adoptionRate).toBe(0.4);
    expect(m.askRate).toBe(0.6);
    expect(m.n).toBe(10);
  });
});

describe('F6.4 · 协同通道形态检测（两用例）', () => {
  it('O12 共享非常规对象：两 agent 窗内写同一临时板 ⇒ shared-artifact', () => {
    const evs: AgentEvent[] = [
      { ts: '2026-11-03T10:00:00Z', agentId: 'a1', action: 'write', target: '/tmp/.board' },
      { ts: '2026-11-03T10:01:00Z', agentId: 'a2', action: 'write', target: '/tmp/.board' },
    ];
    const f = detectCollaborationChannels(evs);
    expect(f.some((x) => x.kind === 'shared-artifact')).toBe(true);
  });

  it('O13 同构动作序列：两 agent 动作序列相同 ⇒ isomorphic-actions', () => {
    const seq = (agent: string, base: number): AgentEvent[] => [
      { ts: `2026-11-03T10:0${base}:00Z`, agentId: agent, action: 'read', target: '/tmp/a' },
      { ts: `2026-11-03T10:0${base + 1}:00Z`, agentId: agent, action: 'write', target: '/tmp/b' },
    ];
    const f = detectCollaborationChannels([...seq('a1', 0), ...seq('a2', 2)]);
    expect(f.some((x) => x.kind === 'isomorphic-actions')).toBe(true);
  });

  it('O14 白名单对象（正常共享仓库）不报', () => {
    const evs: AgentEvent[] = [
      { ts: '2026-11-03T10:00:00Z', agentId: 'a1', action: 'write', target: 'src/index.ts' },
      { ts: '2026-11-03T10:00:30Z', agentId: 'a2', action: 'write', target: 'src/index.ts' },
    ];
    expect(detectCollaborationChannels(evs, ['src/index.ts'])).toHaveLength(0);
  });
});

describe('F6.4 · 压缩留痕完整性 + 四层趋势', () => {
  it('O15 压缩后引用不丢 ⇒ ok；丢引用 ⇒ missing 指名', () => {
    const before = '## 判据A\n内容\n## 判据B\n内容';
    const kept = '## 判据A\n内容\n## 判据B\n内容';
    expect(traceCompression(before, kept).ok).toBe(true);
    const lost = '## 判据A\n（压缩摘要）';
    const t = traceCompression(before, lost);
    expect(t.ok).toBe(false);
    expect(t.missing).toEqual(['判据B']);
  });

  it('O16 趋势：跨批次累积 + delta + 退化方向判定（非一次性跑分）', () => {
    const pts = [
      { ts: '2026-11-01T00:00:00Z', layer: 'L2' as const, metric: 'ece15', value: 0.03 },
      { ts: '2026-11-02T00:00:00Z', layer: 'L2' as const, metric: 'ece15', value: 0.05 },
      { ts: '2026-11-03T00:00:00Z', layer: 'L2' as const, metric: 'ece15', value: 0.09 },
    ];
    const [t] = buildTrends(pts, { ece15: 1 });
    expect(t.points).toHaveLength(3);
    expect(t.points[1].delta).toBeCloseTo(0.02, 6);
    expect(t.degrading).toBe(true);
  });
});

describe('F6.4 · 接线面：前置分流写进审计（decision-dispatch）', () => {
  it('O17 选择决定与理由可查：禁加载时选免加载通道，审计行含 event/channel/reason/excluded', () => {
    const lines: string[] = [];
    const sel = resolveChannelBeforeLoad(
      [
        { name: 'local-judge', requiresLoad: true, health: 0.9, priority: 1 },
        { name: 'rule-l0', requiresLoad: false, health: null, priority: 2 },
      ],
      { allowLoad: false },
      (l) => lines.push(l),
    );
    expect(sel.channel?.name).toBe('rule-l0');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.event).toBe('channel-selection');
    expect(rec.channel).toBe('rule-l0');
    expect(rec.decidedBeforeLoad).toBe(true);
    expect(rec.excluded).toContainEqual({ name: 'local-judge', why: 'requires-load-but-load-not-allowed' });
  });

  it('O18 无可用通道时不静默：channel=null 且理由为 no-usable-channel', () => {
    const sel = resolveChannelBeforeLoad([{ name: 'x', requiresLoad: true, health: 0.5, priority: 1 }], { allowLoad: false });
    expect(sel.channel).toBeNull();
    expect(sel.reason).toContain('no-usable-channel');
  });
});

describe('F6.4 · 面板/周报可见（A② 接线）', () => {
  it('O19 渲染成 markdown：alert 排前、每行带 n、含使用度量与红旗', () => {
    const findings = [
      { probe: 'probability-anomaly' as const, severity: 'ok' as const, metric: 0.7, threshold: 'x', detail: '', n: 30 },
      { probe: 'distribution-drift' as const, severity: 'alert' as const, metric: 0.2, threshold: 'y', detail: '', n: 40 },
    ];
    const md = renderProbePanel(
      findings,
      { n: 10, adoptionRate: 0.4, askRate: 0.6, denyRate: 0, overrideRate: 0.6, unconsumed: false, overridden: true },
    );
    expect(md).toContain('alert 1 · warn 0 · ok 1');
    expect(md.indexOf('distribution-drift')).toBeLessThan(md.indexOf('probability-anomaly'));
    expect(md).toContain('| 40 |');
    expect(md).toContain('上线即被推翻');
  });
});
