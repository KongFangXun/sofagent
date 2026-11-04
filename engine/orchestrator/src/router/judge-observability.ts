// ============================================================
// router/judge-observability.ts · 判定层失效探测与使用度量（F6.4 · v1.9 §六）
// ============================================================
// 为什么需要这个文件：判定件「还在返回结果」不等于「判定还有效」。静默失败有五种形态，
// 前四种是**产出级**（看输出分布形状），第五种是**表征级**（输出分布完全正常，但编码器
// 已从「学场景」退化为「学动作」）。本模块把它们做成**纯函数探针**：
//   · 输入是观测序列（每次判定的分布/置信/弃权/输入长度/延迟），不是运行中的进程；
//   · 输出是 finding 列表（probe / severity / metric / value / threshold / detail）；
//   · **探针只报不拦**（告警不阻断判定，符合 v1.9 §六「探针超阈告警不阻断」）。
//
// 纪律（写死，防止退化成统计装饰）：
//   1. 每个探针必须能被一个构造输入打红——测试里逐条造；
//   2. 阈值全部集中在 PROBE_THRESHOLDS，**不许散落在调用点**（改阈值只改一处）；
//   3. 探针判据只吃观测值，不读模型内部状态——否则「模型加载失败」会被误判成「分布漂移」。
//
// 与既有件的关系：
//   · 表征级探针吃 `number[][]`（编码器输出的嵌入矩阵），不 import 任何模型加载器
//     ——这样它能在「输出分布正常」时独立报坍缩（v1.9 明确这是前四探针抓不到的形态）；
//   · 使用度量与 `judge-eval` 的失败分类互补：那边判「判对没有」，这边判「有没有人用、被没被推翻」。
// ============================================================

/** 一次判定的观测（采集面只填这些，探针不读别的） */
export interface JudgeObservation {
  /** ISO 时间戳 */
  ts: string;
  /** 判据 id（按判据分别探测；空串表示合并池） */
  criterionId: string;
  /** 归一化后的选项分布（和≈1） */
  distribution: number[];
  /** 是否弃权（abstained） */
  abstained: boolean;
  /** 输入 token 数 */
  inputTokens: number;
  /** 端到端延迟（毫秒） */
  latencyMs: number;
}

export type ProbeName =
  | 'distribution-drift'
  | 'probability-anomaly'
  | 'abstain-mutation'
  | 'length-latency-correlation'
  | 'characterization-collapse';

export type Severity = 'ok' | 'warn' | 'alert';

export interface ProbeFinding {
  probe: ProbeName;
  severity: Severity;
  /** 观测到的量（可复算） */
  metric: number | string;
  /** 触发阈值（同一条 finding 必须能自证「为什么红」） */
  threshold: number | string;
  /** 人读说明（含样本量——没有 n 的告警不可处置） */
  detail: string;
  /** 样本量 */
  n: number;
}

/** 阈值集中处（改阈值只改这里；测试用同一常量，避免测试与实现各写一份） */
export const PROBE_THRESHOLDS = {
  /** 与基线的 JS 散度（自然对数底） */
  driftJsWarn: 0.05,
  driftJsAlert: 0.12,
  /** 概率长期贴 0.5 的判定带 */
  nearHalfBand: 0.03,
  /** 概率长期贴 1.0 的下限 */
  nearOne: 0.98,
  /** 弃权率突变（绝对差） */
  abstainDeltaWarn: 0.10,
  abstainDeltaAlert: 0.20,
  /** 长度-延迟相关系数变化（|Δr|） */
  corrDeltaWarn: 0.35,
  corrDeltaAlert: 0.6,
  /** 表征级：有效秩占比下限（相对期望秩） */
  effRankRatioWarn: 0.6,
  effRankRatioAlert: 0.4,
  /** 探针最小样本量（低于此不判定，报 ok + insufficient） */
  minSamples: 20,
  /** 协同通道：时间窗（毫秒） */
  collabWindowMs: 5 * 60_000,
} as const;

/** 均值 */
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** 平均分布（逐选项取均值后归一） */
export function meanDistribution(obs: JudgeObservation[]): number[] {
  if (!obs.length) return [];
  const k = Math.max(...obs.map((o) => o.distribution.length));
  const acc = new Array(k).fill(0);
  for (const o of obs) o.distribution.forEach((p, i) => (acc[i] = (acc[i] ?? 0) + p));
  const s = acc.reduce((a, b) => a + b, 0) || 1;
  return acc.map((x) => x / s);
}

/** Jensen–Shannon 散度（自然对数；对称、有界 [0, ln2]） */
export function jsDivergence(p: number[], q: number[]): number {
  const k = Math.max(p.length, q.length);
  const pad = (v: number[]) => Array.from({ length: k }, (_, i) => v[i] ?? 0);
  const a = pad(p);
  const b = pad(q);
  const m = a.map((x, i) => (x + (b[i] ?? 0)) / 2);
  const kl = (u: number[], w: number[]) =>
    u.reduce((s, x, i) => (x > 0 && (w[i] ?? 0) > 0 ? s + x * Math.log(x / (w[i] ?? 1)) : s), 0);
  return (kl(a, m) + kl(b, m)) / 2;
}

/** 香农熵（nat），用于「单峰/均匀」形态判定 */
export function entropy(p: number[]): number {
  return -p.reduce((s, x) => (x > 0 ? s + x * Math.log(x) : s), 0);
}

/** ① 输出分布漂移：窗口均值分布 vs 基线均值分布的 JS 散度 */
export function probeDistributionDrift(
  window: JudgeObservation[],
  baseline: JudgeObservation[],
): ProbeFinding {
  const t = PROBE_THRESHOLDS;
  if (window.length < t.minSamples || baseline.length < t.minSamples) {
    return {
      probe: 'distribution-drift', severity: 'ok', metric: 'insufficient',
      threshold: t.minSamples, detail: `样本不足（window=${window.length}/baseline=${baseline.length}，需各 ≥${t.minSamples}）`,
      n: window.length,
    };
  }
  const js = jsDivergence(meanDistribution(window), meanDistribution(baseline));
  const sev: Severity = js >= t.driftJsAlert ? 'alert' : js >= t.driftJsWarn ? 'warn' : 'ok';
  return {
    probe: 'distribution-drift', severity: sev, metric: Number(js.toFixed(6)),
    threshold: `warn≥${t.driftJsWarn} alert≥${t.driftJsAlert}`,
    detail: `窗口均值分布与基线 JS=${js.toFixed(6)}（n=${window.length} vs ${baseline.length}）`,
    n: window.length,
  };
}

/** ② 概率分布异常：长期贴 0.5（未校准）或长期贴 1.0（模式坍塌） */
export function probeProbabilityAnomaly(window: JudgeObservation[]): ProbeFinding {
  const t = PROBE_THRESHOLDS;
  const conf = window.map((o) => (o.distribution.length ? Math.max(...o.distribution) : 0));
  if (conf.length < t.minSamples) {
    return {
      probe: 'probability-anomaly', severity: 'ok', metric: 'insufficient', threshold: t.minSamples,
      detail: `样本不足（n=${conf.length}，需 ≥${t.minSamples}）`, n: conf.length,
    };
  }
  const mu = mean(conf);
  const nearHalf = Math.abs(mu - 0.5) <= t.nearHalfBand;
  const nearOne = mu >= t.nearOne;
  const sev: Severity = nearOne ? 'alert' : nearHalf ? 'warn' : 'ok';
  return {
    probe: 'probability-anomaly', severity: sev, metric: Number(mu.toFixed(6)),
    threshold: `|μ-0.5|≤${t.nearHalfBand} 或 μ≥${t.nearOne}`,
    detail: `窗口平均置信 μ=${mu.toFixed(6)}（n=${conf.length}）⇒ ${nearOne ? '长期贴 1.0（坍塌特征）' : nearHalf ? '长期贴 0.5（未校准特征）' : '未见异常'}`,
    n: conf.length,
  };
}

/** ③ 弃权率突变：窗口弃权率 vs 基线弃权率 */
export function probeAbstainMutation(
  window: JudgeObservation[],
  baseline: JudgeObservation[],
): ProbeFinding {
  const t = PROBE_THRESHOLDS;
  if (window.length < t.minSamples || baseline.length < t.minSamples) {
    return {
      probe: 'abstain-mutation', severity: 'ok', metric: 'insufficient', threshold: t.minSamples,
      detail: `样本不足（window=${window.length}/baseline=${baseline.length}）`, n: window.length,
    };
  }
  const rw = window.filter((o) => o.abstained).length / window.length;
  const rb = baseline.filter((o) => o.abstained).length / baseline.length;
  const d = Math.abs(rw - rb);
  const sev: Severity = d >= t.abstainDeltaAlert ? 'alert' : d >= t.abstainDeltaWarn ? 'warn' : 'ok';
  return {
    probe: 'abstain-mutation', severity: sev, metric: Number(d.toFixed(6)),
    threshold: `warn≥${t.abstainDeltaWarn} alert≥${t.abstainDeltaAlert}`,
    detail: `弃权率 ${(rb * 100).toFixed(1)}% → ${(rw * 100).toFixed(1)}%（Δ=${(d * 100).toFixed(1)}pp，n=${window.length}/${baseline.length}）`,
    n: window.length,
  };
}

/** 皮尔逊相关系数 */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] ?? 0) - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/** ④ 输入长度-延迟相关：窗口 r 相对基线 r 的变化 */
export function probeLengthLatency(
  window: JudgeObservation[],
  baseline: JudgeObservation[],
): ProbeFinding {
  const t = PROBE_THRESHOLDS;
  if (window.length < t.minSamples || baseline.length < t.minSamples) {
    return {
      probe: 'length-latency-correlation', severity: 'ok', metric: 'insufficient', threshold: t.minSamples,
      detail: `样本不足（window=${window.length}/baseline=${baseline.length}）`, n: window.length,
    };
  }
  const rw = pearson(window.map((o) => o.inputTokens), window.map((o) => o.latencyMs));
  const rb = pearson(baseline.map((o) => o.inputTokens), baseline.map((o) => o.latencyMs));
  const d = Math.abs(rw - rb);
  const sev: Severity = d >= t.corrDeltaAlert ? 'alert' : d >= t.corrDeltaWarn ? 'warn' : 'ok';
  return {
    probe: 'length-latency-correlation', severity: sev, metric: Number(d.toFixed(6)),
    threshold: `warn≥${t.corrDeltaWarn} alert≥${t.corrDeltaAlert}`,
    detail: `r ${rb.toFixed(3)} → ${rw.toFixed(3)}（|Δ|=${d.toFixed(3)}，n=${window.length}/${baseline.length}）`,
    n: window.length,
  };
}

/**
 * ⑤ 表征级探针（慢特征坍缩）：只看嵌入矩阵的**有效秩**，不看输出分布。
 *
 * 为什么必须有它：前四探针全部读输出分布；当编码器「保留慢特征（场景身份）、丢弃快特征
 * （动作主体）」时，输出分布可以**完全正常**，四探针全绿，但判定已退化为「按场景猜」。
 * 有效秩（participation ratio）= (Σσ²)² / Σσ⁴，σ 为奇异值；坍缩时集中到少数方向 ⇒ 有效秩骤降。
 *
 * 判据：`effRank / expectedRank`（expectedRank = min(n, d)）低于阈值即报——
 * 且**不做输出分布的前置判断**（这正是「输出正常也能报」的实现方式）。
 */
export function probeCharacterizationCollapse(embeddings: number[][]): ProbeFinding {
  const t = PROBE_THRESHOLDS;
  const n = embeddings.length;
  const d = n ? (embeddings[0]?.length ?? 0) : 0;
  if (n < t.minSamples || d < 2) {
    return {
      probe: 'characterization-collapse', severity: 'ok', metric: 'insufficient', threshold: t.minSamples,
      detail: `样本不足或维度不足（n=${n}, d=${d}）`, n,
    };
  }
  // 协方差矩阵（d×d）——n 可能远大于 d，用协方差比直接对 n×d 做 SVD 稳定
  const mu = new Array(d).fill(0);
  for (const row of embeddings) for (let j = 0; j < d; j++) mu[j] = (mu[j] ?? 0) + (row[j] ?? 0) / n;
  const cov = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const row of embeddings) {
    for (let a = 0; a < d; a++) {
      for (let b = a; b < d; b++) {
        const add = ((row[a]! - mu[a]!) * (row[b]! - mu[b]!)) / Math.max(1, n - 1);
        cov[a]![b] = (cov[a]![b] ?? 0) + add;
        if (a !== b) cov[b]![a] = cov[a]![b]!;
      }
    }
  }
  // 幂迭代求前若干特征值（Jacobi 太慢；这里用「迹与平方迹」近似参与比：
  //   PR = (Σλ)² / Σλ² = (tr)² / tr(C²)，对协方差矩阵可直接算，无需逐个特征值）
  let tr = 0, tr2 = 0;
  for (let a = 0; a < d; a++) {
    tr += cov[a]![a]!;
    for (let b = 0; b < d; b++) tr2 += cov[a]![b]! * cov[b]![a]!;
  }
  const effRank = tr2 > 0 ? (tr * tr) / tr2 : 0;
  const expected = Math.min(n, d);
  const ratio = expected > 0 ? effRank / expected : 0;
  const sev: Severity = ratio <= t.effRankRatioAlert ? 'alert' : ratio <= t.effRankRatioWarn ? 'warn' : 'ok';
  return {
    probe: 'characterization-collapse', severity: sev, metric: Number(ratio.toFixed(6)),
    threshold: `warn≤${t.effRankRatioWarn} alert≤${t.effRankRatioAlert}`,
    detail: `有效秩 ${effRank.toFixed(2)} / 期望 ${expected} = ${(ratio * 100).toFixed(1)}%（n=${n}, d=${d}）⇒ ${sev === 'ok' ? '未见坍缩' : '慢特征坍缩（输出分布可正常）'}`,
    n,
  };
}


// ============================================================
// 面板 / 周报渲染（v1.9 §六「告警在面板与周报可见（非仅日志）」）
// ============================================================
/**
 * 把探针结果渲染成**可贴进面板/周报的 markdown 表**。
 *
 * 纪律：① alert 排在前（人会先看红）；② 每行带 n（无样本量的告警不可处置）；
 * ③ 渲染**不改变** finding（纯函数），也不触发任何阻断——探针只报不拦。
 */
export function renderProbePanel(findings: ProbeFinding[], usage?: UsageMetrics, title = '判定层失效探测'): string {
  const order: Record<Severity, number> = { alert: 0, warn: 1, ok: 2 };
  const rows = [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((f) => `| ${f.severity === 'alert' ? '🔴 alert' : f.severity === 'warn' ? '🟡 warn' : '🟢 ok'} | ${f.probe} | ${String(f.metric)} | ${String(f.threshold)} | ${f.n} |`);
  const counts = {
    alert: findings.filter((f) => f.severity === 'alert').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    ok: findings.filter((f) => f.severity === 'ok').length,
  };
  const head = `### ${title}（alert ${counts.alert} · warn ${counts.warn} · ok ${counts.ok}）`;
  const usageLine = usage
    ? `\n**判定使用**：n=${usage.n} · 采纳率 ${usage.adoptionRate ?? 'n/a'} · ASK ${usage.askRate} · DENY ${usage.denyRate} · 推翻率 ${usage.overrideRate ?? 'n/a'}`
      + ` · 红旗：${usage.unconsumed ? '无人消费 ' : ''}${usage.overridden ? '上线即被推翻' : ''}`.trimEnd()
    : '';
  return [head, '', '| 级别 | 探针 | 实测 | 阈值 | n |', '|---|---|---|---|---|', ...rows, usageLine]
    .filter((x) => x !== undefined)
    .join('\n');
}

/** 汇总跑四探针（产出级）+ 表征级（给了嵌入才算） */
export function runAllProbes(input: {
  window: JudgeObservation[];
  baseline: JudgeObservation[];
  embeddings?: number[][];
}): ProbeFinding[] {
  const out = [
    probeDistributionDrift(input.window, input.baseline),
    probeProbabilityAnomaly(input.window),
    probeAbstainMutation(input.window, input.baseline),
    probeLengthLatency(input.window, input.baseline),
  ];
  if (input.embeddings?.length) out.push(probeCharacterizationCollapse(input.embeddings));
  return out;
}

// ============================================================
// 判定使用度量（v1.9 §六「判定使用度量」）
// ============================================================
export type DownstreamVerdict = 'adopted' | 'overridden' | 'pending';

export interface UsageRecord {
  /** 判定给出的动作档：ALLOW / ASK / DENY / ABSTAIN */
  grade: 'ALLOW' | 'ASK' | 'DENY' | 'ABSTAIN';
  /** 下游最终做了什么 */
  verdict: DownstreamVerdict;
}

export interface UsageMetrics {
  n: number;
  /** 判定值采纳率（adopted / (adopted+overridden)） */
  adoptionRate: number | null;
  askRate: number;
  denyRate: number;
  /** 被人工推翻率（overridden / (adopted+overridden)） */
  overrideRate: number | null;
  /** 「已上线但无人消费」——pending 占比高且无 adopted/overridden */
  unconsumed: boolean;
  /** 「上线即被推翻」——overrideRate 高 */
  overridden: boolean;
}

/**
 * 四指标 + 两个可区分的红旗。
 *
 * 分开的理由（v1.9 原文）：前者是**集成问题**（没人接），后者是**质量问题**（接了但总被推翻）；
 * 混成一个数字则两者都无法处置。
 */
export function computeUsageMetrics(records: UsageRecord[]): UsageMetrics {
  const n = records.length;
  const decided = records.filter((r) => r.verdict !== 'pending');
  const adopted = records.filter((r) => r.verdict === 'adopted').length;
  const overridden = records.filter((r) => r.verdict === 'overridden').length;
  const denom = adopted + overridden;
  const adoptionRate = denom ? adopted / denom : null;
  const overrideRate = denom ? overridden / denom : null;
  const pendingRate = n ? (n - decided.length) / n : 0;
  return {
    n,
    adoptionRate: adoptionRate === null ? null : Number(adoptionRate.toFixed(4)),
    askRate: n ? Number((records.filter((r) => r.grade === 'ASK').length / n).toFixed(4)) : 0,
    denyRate: n ? Number((records.filter((r) => r.grade === 'DENY').length / n).toFixed(4)) : 0,
    overrideRate: overrideRate === null ? null : Number(overrideRate.toFixed(4)),
    unconsumed: denom === 0 && pendingRate >= 0.8,
    overridden: overrideRate !== null && overrideRate >= 0.3,
  };
}

// ============================================================
// 入口前置分流（v1.9 §六「入口前置分流」）
// ============================================================
export interface ChannelCandidate {
  name: string;
  /** 是否需要加载权重/连接（true = 昂贵路径） */
  requiresLoad: boolean;
  /** 健康度（0–1；未测给 null） */
  health: number | null;
  /** 优先级（小者优先） */
  priority: number;
}

export interface ChannelSelection {
  channel: ChannelCandidate | null;
  /** 决策理由（机器可读 + 人读同串，落审计） */
  reason: string;
  /** 恒为 true：本函数的契约就是「在任何 load 之前给出决定」 */
  decidedBeforeLoad: true;
  /** 被排除的候选及原因（「选错路径」可查） */
  excluded: Array<{ name: string; why: string }>;
}

/**
 * 在**任何模型加载之前**选出判定通道。
 *
 * 纪律：本函数不 import 任何加载器、不触发 IO——它只吃候选表与上下文。
 * 「选错路径」可查的实现：每个被排除的候选都带 why，选中项带 reason。
 */
export function selectChannelBeforeLoad(
  candidates: ChannelCandidate[],
  ctx: { allowLoad: boolean; requireCalibrated?: boolean },
): ChannelSelection {
  const excluded: Array<{ name: string; why: string }> = [];
  const usable: ChannelCandidate[] = [];
  for (const c of candidates) {
    if (c.requiresLoad && !ctx.allowLoad) {
      excluded.push({ name: c.name, why: 'requires-load-but-load-not-allowed' });
      continue;
    }
    if (c.health !== null && c.health <= 0) {
      excluded.push({ name: c.name, why: 'health<=0' });
      continue;
    }
    usable.push(c);
  }
  usable.sort((a, b) => a.priority - b.priority || (b.health ?? 0) - (a.health ?? 0));
  const picked = usable[0] ?? null;
  return {
    channel: picked,
    reason: picked
      ? `priority=${picked.priority} health=${picked.health ?? 'unmeasured'} allowLoad=${ctx.allowLoad}`
      : `no-usable-channel（excluded=${excluded.length}）`,
    decidedBeforeLoad: true,
    excluded,
  };
}

// ============================================================
// 越权与自发协同通道检测（v1.9 §六「协同通道形态检测」）
// ============================================================
export interface AgentEvent {
  ts: string;
  agentId: string;
  /** 动作类型（如 write / read / comment / exec） */
  action: string;
  /** 作用对象（文件路径 / 板 id / 临时文件） */
  target: string;
}

export interface CollabFinding {
  kind: 'shared-artifact' | 'isomorphic-actions';
  severity: Severity;
  agents: string[];
  target?: string;
  detail: string;
}

/**
 * 两用例：① **共享 artifact**（≥2 个本应隔离的 agent 在时间窗内写同一非常规对象）；
 * ② **时间窗同构动作**（≥2 个 agent 在窗内做出同一动作序列——布告栏式协同的行为指纹）。
 *
 * 「非常规」的判定留给调用方：`targetAllowlist` 内的对象不算（正常共享仓库不算越权）。
 */
export function detectCollaborationChannels(
  events: AgentEvent[],
  targetAllowlist: string[] = [],
): CollabFinding[] {
  const t = PROBE_THRESHOLDS;
  const out: CollabFinding[] = [];
  const allowed = new Set(targetAllowlist);
  const byTarget = new Map<string, AgentEvent[]>();
  for (const e of events) {
    if (allowed.has(e.target)) continue;
    const arr = byTarget.get(e.target) ?? [];
    arr.push(e);
    byTarget.set(e.target, arr);
  }
  for (const [target, evs] of byTarget) {
    const agents = [...new Set(evs.map((e) => e.agentId))];
    if (agents.length < 2) continue;
    const times = evs.map((e) => Date.parse(e.ts)).filter((x) => !Number.isNaN(x));
    const span = times.length ? Math.max(...times) - Math.min(...times) : Infinity;
    if (span > t.collabWindowMs) continue;
    out.push({
      kind: 'shared-artifact',
      severity: agents.length >= 3 ? 'alert' : 'warn',
      agents,
      target,
      detail: `${agents.length} 个 agent 在 ${Math.round(span / 1000)}s 内操作同一非常规对象「${target}」`,
    });
  }
  // 同构动作：按 (agent, 动作序列) 归并，窗口内 ≥2 agent 序列相同且长度 ≥2
  const byAgent = new Map<string, AgentEvent[]>();
  for (const e of events) {
    const arr = byAgent.get(e.agentId) ?? [];
    arr.push(e);
    byAgent.set(e.agentId, arr);
  }
  const sigs = new Map<string, string[]>();
  for (const [agent, evs] of byAgent) {
    const sorted = [...evs].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const sig = sorted.map((e) => `${e.action}:${e.target}`).join('>');
    if (sorted.length < 2) continue;
    const arr = sigs.get(sig) ?? [];
    arr.push(agent);
    sigs.set(sig, arr);
  }
  for (const [sig, agents] of sigs) {
    if (agents.length >= 2) {
      out.push({
        kind: 'isomorphic-actions',
        severity: 'alert',
        agents,
        detail: `${agents.length} 个 agent 的动作序列同构（${sig.slice(0, 80)}）`,
      });
    }
  }
  return out;
}

// ============================================================
// 压缩留痕完整性（v1.9 §六「压缩留痕完整性」）
// ============================================================
export interface CompressionTrace {
  refsBefore: string[];
  refsAfter: string[];
  missing: string[];
  ok: boolean;
}

/**
 * 压缩留痕校验：压缩前后各取「判据输入引用」（markdown 段标题 / 行首引用 id），
 * 返回丢失的引用。生产者契约：压缩时须把这些引用原样写进留痕（`event.preservedSections`
 * 或压缩块内的索引行），**不能只留摘要**。
 */
export function traceCompression(before: string, after: string): CompressionTrace {
  const refsOf = (s: string): string[] =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^#{1,6}\s+/.test(l) || /^(?:\[ref:|引用[:：])/.test(l))
      .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^(?:\[ref:|引用[:：])\s*/, '').trim());
  const b = refsOf(before);
  const a = new Set(refsOf(after));
  const missing = b.filter((r) => !a.has(r));
  return { refsBefore: b, refsAfter: [...a], missing, ok: missing.length === 0 };
}

// ============================================================
// 四层标准持续采集与趋势（v1.9 §六「持续采集面」）
// ============================================================
export interface TrendPoint {
  ts: string;
  /** 层名：L1 / L2 / L3 / E2E */
  layer: 'L1' | 'L2' | 'L3' | 'E2E';
  metric: string;
  value: number;
}

export interface TrendSeries {
  layer: TrendPoint['layer'];
  metric: string;
  points: Array<{ ts: string; value: number; delta: number | null }>;
  /** 退化方向（-1 表示越低越差，+1 表示越高越差） */
  worseWhen: -1 | 1;
  /** 相对首点的变化是否朝退化方向 */
  degrading: boolean;
}

/** 追加并渲染趋势（非一次性跑分：同一 metric 跨批次累积，delta 逐点可算） */
export function buildTrends(points: TrendPoint[], worseWhen: Record<string, -1 | 1> = {}): TrendSeries[] {
  const groups = new Map<string, TrendPoint[]>();
  for (const p of points) {
    const key = `${p.layer}::${p.metric}`;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const out: TrendSeries[] = [];
  for (const [key, arr] of groups) {
    const [layer, metric] = key.split('::') as [TrendPoint['layer'], string];
    const sorted = [...arr].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const ww = worseWhen[metric] ?? 1;
    let prev: number | null = null;
    const pts = sorted.map((p) => {
      const delta = prev === null ? null : Number((p.value - (prev ?? 0)).toFixed(6));
      prev = p.value;
      return { ts: p.ts, value: p.value, delta };
    });
    const first = sorted[0]!.value;
    const last = sorted[sorted.length - 1]!.value;
    const degrading = ww === 1 ? last > first : last < first;
    out.push({ layer, metric, points: pts, worseWhen: ww, degrading });
  }
  return out;
}

// ============================================================
// AI 参与度度量（v1.9 §六 · 口径 = commit trailer，E-10 裁定 2026-11-03）
// ------------------------------------------------------------
// 口径定义（S3 §三3.38 裁定 ①）：AI 参与比例 = 含 AI trailer 的 commit 数 /
// 统计窗口内总 commit 数。选 trailer 的理由是它**已被本仓工具链实际记录**
// （作者白名单需人工维护必漂移；行级来源标注要改造整条 diff 管线）。
//
// 三条局限注记随指标一起产出——缺注记的比例数会被当成「全量 AI 参与度」误读：
//   ① trailer 缺失即漏计（约定是自愿的，没有 trailer 的 AI 协作不可见）
//   ② 人工代提交不可分辨（人把 AI 产出提交上去，与纯人工提交同形）
//   ③ 窗口敏感（比例随统计窗口变化，跨窗口比较无意义）
// ============================================================

/** 提交元数据（trailer 从 commit message 尾部解析后传入） */
export interface CommitMeta {
  sha: string;
  /** 完整 commit message（含 trailer 段） */
  message: string;
  /** 轨①：author 邮箱（可选；缺省即不判轨①） */
  authorEmail?: string;
  /** 轨①：committer 邮箱（可选；缺省即不判轨①） */
  committerEmail?: string;
}

/**
 * AI 账号域清单（轨①判据）。
 * 真值与证据见 `docs/AI-ATTRIBUTION.md` §2.2——改这里必须同批改该文件，禁单改一处。
 */
export const AI_ACCOUNT_DOMAINS: readonly string[] = [
  'anthropic.com',
  'deepseek.com',
  'cursor.com',
  'tencent.com',
  'sofagent.dev',
];

/** 邮箱是否落在 AI 账号域（域级匹配；不做人名匹配——人名会漂移） */
export function isAiAccountEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return AI_ACCOUNT_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** AI 归属信号（轨②：trailer 键值——命中任一即计为 AI 参与） */
const AI_TRAILER_PATTERNS: readonly RegExp[] = [
  /^co-authored-by:.*\b(claude|gpt|deepseek|gemini|copilot|cursor|codex|qwen|glm)\b/im,
  /^co-authored-by:.*@(anthropic|deepseek|cursor|tencent|sofagent)\.(com|dev)\b/im,
  /^generated-by:\s*\S+/im,
  /^ai-assisted:\s*true\b/im,
];

/** AI 参与度读数（含三条局限注记——不得缺） */
export interface AiParticipation {
  /** 窗口内总提交数 */
  total: number;
  /** 轨②：含 AI trailer 的提交数 */
  withAiTrailer: number;
  /** 轨①：author/committer 命中 AI 账号域的提交数 */
  withAiAuthorDomain: number;
  /** 双轨并集（同一提交只计一次）——比例分子用这个 */
  withAiSignal: number;
  /** 比例（total=0 时为 null——零样本不报 0，报「无数据」） */
  ratio: number | null;
  /** 分轨明细（供报告区分「无人消费」与「被推翻」之外的归属来源） */
  byTrack: { authorDomain: number; trailer: number; union: number };
  /** 三条局限注记（固定文案，随读数同出） */
  limitations: string[];
}

/**
 * 计算 AI 参与度（纯函数——不做 git 调用，调用方取 message 传入）。
 * 只观测不评判：比例高不代表质量高，也不单独作能力声明（与判定使用度量同纪律）。
 */
export function computeAiParticipation(commits: CommitMeta[]): AiParticipation {
  const total = commits.length;
  const hasTrailer = (c: CommitMeta): boolean => AI_TRAILER_PATTERNS.some((re) => re.test(c.message));
  const hasAuthorDomain = (c: CommitMeta): boolean =>
    isAiAccountEmail(c.authorEmail) || isAiAccountEmail(c.committerEmail);
  const withAiTrailer = commits.filter(hasTrailer).length;
  const withAiAuthorDomain = commits.filter(hasAuthorDomain).length;
  const withAiSignal = commits.filter((c) => hasTrailer(c) || hasAuthorDomain(c)).length;
  return {
    total,
    withAiTrailer,
    withAiAuthorDomain,
    withAiSignal,
    byTrack: { authorDomain: withAiAuthorDomain, trailer: withAiTrailer, union: withAiSignal },
    ratio: total === 0 ? null : Number((withAiSignal / total).toFixed(4)),
    limitations: [
      'trailer 缺失即漏计——没有 AI trailer 的协作不可见，比例是下界不是全量',
      '人工代提交不可分辨——人提交 AI 产出与纯人工提交同形',
      '窗口敏感——比例随统计窗口变化，跨窗口比较无意义',
    ],
  };
}
