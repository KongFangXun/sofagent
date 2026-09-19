// ============================================================
// sensitivity-classifier.ts · v1.5.0 T8 · 敏感度实时分类器（三档 + routeReason）
// ============================================================
//
// 文本 → 档位（公开 public / 内部 internal / 敏感 sensitive）——
// session 承接（T7）与上云分拣（v1.4.6 sorting-gate）的共用输入前置件：
// **先分类、再路由**，分类结果随 routeReason 入审计留痕。
//
// 分类策略两态：
//   - 内置规则档（默认——关键词 + 检测器插槽，零模型）：消费
//     DetectorRegistry（L0 敏感模式 + L1 词典——与脱敏共用同一套插槽，
//     一次建架构两个消费面）
//   - 外挂模型档（L2 置信度透传——对接 GB/T 35273 分级叙事，
//     由调用方注入 modelTier 覆盖规则档判定）
//
// 纯函数判定（零 I/O）——routeReason 结构化返回，调用方写审计链。
// ============================================================

import {
  DetectorRegistry,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type ConfidenceThresholds,
} from './detector-registry';

/** 敏感度三档（GB/T 分级叙事对齐：公开 / 内部 / 敏感） */
export type SensitivityLevel = 'public' | 'internal' | 'sensitive';

/** 内部档关键词（弱信号——无敏感命中但含内部叙事词时升内部档） */
const INTERNAL_KEYWORDS: readonly string[] = [
  '内部', '内部资料', '仅限', '保密', 'confidential', 'internal',
  '未公开', '草案', '评审中', 'pre-release', 'draft',
];

/** 分类决策（routeReason 入审计链） */
export interface SensitivityDecision {
  /** 档位 */
  level: SensitivityLevel;
  /** 路由依据（为什么判此档——人读可追溯，随审计链落盘） */
  routeReason: string;
  /** 命中的检测器 span 标签（去重——不含命中的原文，防二次泄漏） */
  matchedLabels: string[];
  /** 命中 span 数（含低置信标记档——数量入审计，原文不入） */
  hitCount: number;
  /** 判定来源（rule = 内置规则档 / model = 外挂模型档透传） */
  decidedBy: 'rule' | 'model';
}

/**
 * 敏感度分类器构造（内置规则档——检测器插槽驱动）。
 *
 * @param registry 检测器注册表（建议注册 l0-sensitive + l1-glossary——
 *                 与脱敏管线共用同一 registry 或独立实例均可）
 * @param thresholds 置信度阈值（缺省 DEFAULT_CONFIDENCE_THRESHOLDS）
 */
export function classifySensitivity(
  text: string,
  registry: DetectorRegistry,
  opts: {
    thresholds?: ConfidenceThresholds;
    /** 外挂模型档判定（注入即覆盖规则档——GB/T 分级叙事对接面） */
    modelLevel?: SensitivityLevel;
  } = {},
): SensitivityDecision {
  const thresholds = opts.thresholds ?? DEFAULT_CONFIDENCE_THRESHOLDS;

  // 外挂模型档：注入即透传（置信度语义在模型侧——引擎不二次判定，
  // 但 routeReason 标注 decidedBy=model 供审计区分口径）
  if (opts.modelLevel) {
    return {
      level: opts.modelLevel,
      routeReason: `外挂模型档判定（GB/T 35273 分级叙事对接——置信度由模型侧给出，引擎透传不覆写）`,
      matchedLabels: [],
      hitCount: 0,
      decidedBy: 'model',
    };
  }

  // 内置规则档：检测器插槽全量检测
  const result = registry.runPipeline(text, { thresholds });
  const matchedLabels = [...new Set(result.spans.map((s) => s.label))];

  // 敏感档判定：存在中置信以上命中（tier high 或 medium——
  // 低置信只标记不升级档位，交人审；与插槽三层语义对齐）
  const strongHits = result.spans.filter((s) => s.tier !== 'low');
  if (strongHits.length > 0) {
    return {
      level: 'sensitive',
      routeReason: `命中敏感特征 ${strongHits.length} 处（${matchedLabels.join('、')}）——来自检测器插槽（L0 规则/L1 词典），档位 sensitive`,
      matchedLabels,
      hitCount: result.spans.length,
      decidedBy: 'rule',
    };
  }

  // 内部档判定：无敏感命中但含内部叙事关键词
  const lower = text.toLowerCase();
  const hitKeyword = INTERNAL_KEYWORDS.find((k) => lower.includes(k.toLowerCase()));
  if (hitKeyword) {
    return {
      level: 'internal',
      routeReason: `无敏感特征命中，但含内部叙事关键词「${hitKeyword}」——档位 internal`,
      matchedLabels: [],
      hitCount: result.spans.length,
      decidedBy: 'rule',
    };
  }

  // 公开档：零命中零关键词
  return {
    level: 'public',
    routeReason: '无敏感特征命中、无内部叙事关键词——档位 public（放行上云/正常承接）',
    matchedLabels: [],
    hitCount: result.spans.length,
    decidedBy: 'rule',
  };
}
