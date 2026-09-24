// ============================================================
// detector-registry.ts · v1.5.2 T8 · 通用检测器接口 + 注册表 + 调度管线
// ============================================================
//
// 插槽架构（引擎层纪律：只做管线不做模型推理——推理属模型层/企业侧）：
//   - 通用 Detector 接口：detect(text) → spans[]（实体区间+类型+置信度）
//   - 检测器注册表：L0 正则（内置零依赖）/ L1 词典（企业专名）/ L2 外挂 NER
//   - 管线调度：按注册顺序逐层检测 → span 聚合去重（重叠区间归并）
//   - 置信度三层：高替换 / 中替换+记审计 / 低只标记交人审
//   - 「哪个检测器命中了什么」入审计链（消费方写 decision-log）
//
// 可嵌入性：插槽设计为可独立消费组件（不绑死引擎进程）——企业自建
// 模型网关可直接集成同一份检测器与规则定义（网关侧与引擎侧共用一份，
// 不各写一套，防判定口径分裂）。
//
// fail-closed：L2 不可达时降级 L0+L1 继续检测（不静默放行）——
// 降级事实记入 degraded 数组（消费方可入审计）。
// ============================================================

import { toPresidioType, type PresidioEntityType, type PresidioAnalysisResult } from './detector-presidio-schema';

// ══════════════════════════════════════════════════════════
// 通用接口
// ══════════════════════════════════════════════════════════

/** 检测器层级（L0 内置正则 / L1 词典 / L2 外挂推理） */
export type DetectorLayer = 'L0' | 'L1' | 'L2';

/** 单个敏感 span（实体区间——Presidio AnalyzerResult 同构） */
export interface SensitiveSpan {
  /** 起始偏移（含） */
  start: number;
  /** 结束偏移（不含） */
  end: number;
  /** 命中原文（低置信标记档需要展示给人审——redact 消费方可决定是否外带） */
  text: string;
  /** 敏感类型标签（检测器自定义——如 'sk-generic' / '手机号' / 词典实体名） */
  label: string;
  /** Presidio 实体类型（经 toPresidioType 归一） */
  entityType: PresidioEntityType;
  /** 置信度 0-1 */
  score: number;
  /** 来源检测器名 */
  detector: string;
  /** 来源层 */
  layer: DetectorLayer;
}

/** 通用检测器接口（插槽——L0/L1/L2 同一形态） */
export interface Detector {
  /** 检测器名（注册表键——审计留痕用） */
  name: string;
  /** 层级 */
  layer: DetectorLayer;
  /**
   * 检测文本 → 敏感 span 列表。
   * 纯检测不替换——替换策略由消费方按置信度三层决定。
   */
  detect(text: string): SensitiveSpan[];
}

/** 置信度三层判定（可注入阈值——外部化对齐 dataset-validator 模式） */
export interface ConfidenceThresholds {
  /** 高置信下界（≥ 此值直接替换；缺省 0.9） */
  high: number;
  /** 中置信下界（≥ 此值替换+记审计；缺省 0.6） */
  medium: number;
  /** 低于 medium 的只标记交人审 */
  low: number;
}

/** 缺省置信度阈值 */
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  high: 0.9,
  medium: 0.6,
  low: 0,
};

/** 置信度分档 */
export type ConfidenceTier = 'high' | 'medium' | 'low';

/** 分档结果 */
export function tierOf(score: number, thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS): ConfidenceTier {
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

// ══════════════════════════════════════════════════════════
// 注册表 + 调度管线
// ══════════════════════════════════════════════════════════

/** 检测器注册表（有序——按注册顺序调度；L1 词典最高优先级零模型可先注册） */
export class DetectorRegistry {
  private detectors: Detector[] = [];

  /** 注册检测器（同名重复注册拒绝——fail-closed 防静默覆盖） */
  register(detector: Detector): { ok: boolean; message: string } {
    if (this.detectors.some((d) => d.name === detector.name)) {
      return { ok: false, message: `检测器 ${detector.name} 已注册（重名拒绝——防静默覆盖既有判定面）` };
    }
    this.detectors.push(detector);
    return { ok: true, message: `检测器 ${detector.name}（${detector.layer}）已注册` };
  }

  /** 注销检测器（按名——移除后管线即时生效） */
  unregister(name: string): boolean {
    const before = this.detectors.length;
    this.detectors = this.detectors.filter((d) => d.name !== name);
    return this.detectors.length < before;
  }

  /** 已注册检测器清单（审计/诊断用） */
  list(): Array<{ name: string; layer: DetectorLayer }> {
    return this.detectors.map((d) => ({ name: d.name, layer: d.layer }));
  }

  /**
   * 调度管线：全检测器逐个检测 → span 聚合去重。
   *
   * 聚合规则（span 聚合去重——防同一区间被多层重复替换）：
   *   - 完全相同区间（start/end 相同）→ 合并为一条，保留 score 最高者的
   *     detector/layer，其余来源记入 corroboredBy（佐证链——多检测器一致
   *     即「高置信」语义的判定输入）
   *   - 重叠但不相同区间 → 保留覆盖更长者（长区间吞短区间——先外后内，
   *     与 redactor「先抹结构性秘密再抹语义性名词」同向）
   *   - 不重叠区间各自保留
   */
  runPipeline(
    text: string,
    opts: { thresholds?: ConfidenceThresholds } = {},
  ): PipelineResult {
    const thresholds = opts.thresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS;
    const raw: SensitiveSpan[] = [];
    const degraded: Array<{ detector: string; reason: string }> = [];

    for (const det of this.detectors) {
      try {
        raw.push(...det.detect(text));
      } catch (err) {
        // fail-closed：单检测器异常不阻断管线——降级继续（事实登记，不静默）
        degraded.push({
          detector: det.name,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const merged = aggregateSpans(raw);
    const spans = merged.map((s) => {
      const tier = tierOf(s.score, thresholds);
      return { ...s, tier };
    });

    return {
      spans,
      degraded,
      detectorCount: this.detectors.length,
      thresholds,
    };
  }
}

/** 管线结果 */
export interface PipelineResult {
  /** 聚合去重后的 span（含 tier 分档） */
  spans: Array<SensitiveSpan & { tier: ConfidenceTier }>;
  /** 降级登记（检测器异常/不可达——fail-closed 事实，不静默） */
  degraded: Array<{ detector: string; reason: string }>;
  /** 参与调度的检测器数 */
  detectorCount: number;
  /** 生效阈值（审计留痕） */
  thresholds: ConfidenceThresholds;
}

// ══════════════════════════════════════════════════════════
// span 聚合去重（纯函数——可独立单测）
// ══════════════════════════════════════════════════════════

/** 聚合后 span（附加佐证链——多检测器命中同一区间的来源清单） */
export interface AggregatedSpan extends SensitiveSpan {
  /** 佐证检测器（同区间其余命中的来源——「高置信=名单+模型一致」的判定输入） */
  corroboredBy: string[];
}

/**
 * span 聚合去重（纯函数）。
 *
 * 1. 完全相同区间合并：保留 score 最高者为主体，其余入 corroboredBy；
 *    多检测器一致命中时 score 提升为 min(1, max + 0.1 × 其他来源数)
 *    （佐证加成——「名单+模型一致 → 高置信」的量化形态）。
 * 2. 重叠不同区间：保留更长区间（长吞短）。
 * 3. 输出按 start 升序（消费方从后往前替换不破坏偏移）。
 */
export function aggregateSpans(spans: SensitiveSpan[]): AggregatedSpan[] {
  // 一、同区间合并（Map 键 start:end）
  const byKey = new Map<string, AggregatedSpan>();
  for (const s of spans) {
    const key = `${s.start}:${s.end}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...s, corroboredBy: [] });
      continue;
    }
    // 同区间第二来源：score 低者入佐证链
    if (s.score > existing.score) {
      byKey.set(key, {
        ...s,
        score: Math.min(1, s.score + 0.1),
        corroboredBy: [...existing.corroboredBy, existing.detector],
      });
    } else {
      byKey.set(key, {
        ...existing,
        score: Math.min(1, existing.score + 0.1),
        corroboredBy: [...existing.corroboredBy, s.detector],
      });
    }
  }

  // 二、重叠区间长吞短（先按长度降序，逐个吞并被包含/部分重叠的更短区间）
  const sortedByLen = [...byKey.values()].sort((a, b) => b.end - b.start - (a.end - a.start));
  const kept: AggregatedSpan[] = [];
  for (const s of sortedByLen) {
    const overlapped = kept.find((k) => s.start < k.end && k.start < s.end);
    if (!overlapped) kept.push(s);
    // 被更长区间覆盖的短 span 丢弃（其信息已被长区间承载——同 label 族才吞，
    // 跨族（如密钥占位符里含实体名）保留短 span 交由消费方按顺序处理）
    else if (overlapped.entityType === s.entityType) continue;
    else kept.push(s);
  }

  // 三、start 升序输出
  return kept.sort((a, b) => a.start - b.start);
}

// ══════════════════════════════════════════════════════════
// 两段式 API 形态（Presidio analyze / anonymize 桥接）
// ══════════════════════════════════════════════════════════

/** analyze 段：spans → Presidio AnalysisResult 形态（生态配置可迁移） */
export function toPresidioResults(spans: readonly SensitiveSpan[]): PresidioAnalysisResult[] {
  return spans.map((s) => ({
    entity_type: s.entityType,
    start: s.start,
    end: s.end,
    score: s.score,
  }));
}

/** label → Presidio 类型（再导出——消费方单入口） */
export { toPresidioType };

/**
 * anonymize 段：按 span 区间从后往前替换占位符。
 *
 * 置信度三层在调用方决定哪些 span 进 replacements：
 *   - high/medium → 传入替换（medium 档调用方另记审计）
 *   - low → 不传入（只标记，交人审——本函数不做标记面，标记面在 PipelineResult.tier）
 *
 * 从后往前替换保证偏移不失效（经典区间替换纪律）。
 */
export function applySpans(
  text: string,
  replacements: ReadonlyArray<{ span: SensitiveSpan; placeholder: string }>,
): { text: string; replaced: number } {
  let out = text;
  const sorted = [...replacements].sort((a, b) => b.span.start - a.span.start);
  for (const { span, placeholder } of sorted) {
    out = out.slice(0, span.start) + placeholder + out.slice(span.end);
  }
  return { text: out, replaced: sorted.length };
}
