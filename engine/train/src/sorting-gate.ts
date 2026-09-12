// sorting-gate.ts · v1.4.7 章二 · 分拣闸门（数据上云前置——敏感档拦截留本地）
//
// 定位：数据上云前过分拣闸——敏感档（客户名单/具体价格/财务数字）拦截留本地
// （挪知识库走 RAG），仅脱敏档/公开档可上云。分拣依据（为什么拦/为什么放）
// 由调用方写入 train_job 审计 HMAC 链可追溯。
//
// 与 v1.4.7 合规扫描闸分层不合并（红线）：
//   - 合规闸（train-compliance）管「能不能训」——提交入口，违规拦截整个训练
//   - 分拣闸（本文件）管「在哪训」——上云前置，敏感档只拦「上云」这条路径，
//     留本地训练/知识库 RAG 不受影响
//
// 保密证书编号：敏感档拦截时生成编号挂链——技术证据（审计 HMAC）+ 法律证据
// （保密证书）双证据，证明「这批数据经分拣判定为敏感、已拦下未出域」。
//
// 纯函数判定（零 I/O，全量可注入测试）——「入审计链」由调用方（train-cloud /
// data-push）在判定后执行，保持判定与落链分离（单一职责）。

// ════════════════════════════════════════
// 三档判定
// ════════════════════════════════════════

/** 分拣三档（敏感 / 脱敏 / 公开） */
export type SortingClass = 'sensitive' | 'desensitized' | 'public';

/** 分拣决策（判定结果 + 依据——依据入审计链可追溯） */
export interface SortingDecision {
  /** 分拣档位 */
  classification: SortingClass;
  /** 是否允许上云（仅脱敏档/公开档放行） */
  allowCloud: boolean;
  /** 分拣依据（为什么拦/为什么放——人读可追溯） */
  reason: string;
  /** 命中的敏感模式标签（脱敏后——不含命中的原文，防二次泄漏） */
  matchedPatterns: string[];
  /** 保密证书编号（敏感档拦截时挂链——技术+法律双证据） */
  confidentialityRef?: string;
}

// ════════════════════════════════════════
// 敏感模式（客户名单 / 具体价格 / 财务数字）
// ════════════════════════════════════════

/** 敏感模式（正则 + 标签——命中即敏感档） */
export interface SensitivePattern {
  label: string;
  pattern: RegExp;
}

/** 敏感模式表（单一事实源——classify 与报告共享） */
export const SENSITIVE_PATTERNS: readonly SensitivePattern[] = [
  { label: '手机号', pattern: /1[3-9]\d{9}/ },
  { label: '身份证号', pattern: /\b\d{17}[\dXx]\b/ },
  { label: '银行卡号', pattern: /\b\d{16,19}\b/ },
  { label: '金额', pattern: /(?:¥|￥)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|万元|亿)/ },
  { label: '邮箱', pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
];

/** 脱敏特征（占位符/掩码——命中即脱敏档，允许上云） */
const DESENSITIZED_PATTERNS: readonly RegExp[] = [
  /\[REDACTED\]/i,
  /\[\*\*\*\]/,
  /\*{3,}/,
  /[Xx]{2,}/,
  /(?:先生|女士|客户)\s*[A-Z]?/,
  /脱敏|掩码|打码|去标识/,
];

// ════════════════════════════════════════
// 判定逻辑
// ════════════════════════════════════════

/** 保密证书编号生成（敏感档拦截时调用——时间戳 + 随机段，审计链挂链用） */
export function generateConfidentialityRef(now: () => number = Date.now): string {
  const ts = new Date(now()).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CONF-${ts}-${rand}`;
}

/**
 * 对一段数据做分拣三档判定。
 *
 * 规则（顺序即优先级）：
 *   - 命中敏感模式 → sensitive（拦截上云），记命中的模式标签
 *   - 含脱敏特征且未命中敏感模式 → desensitized（放行上云）
 *   - 其余 → public（放行上云）
 *
 * 注：先判敏感、后判脱敏——已脱敏但仍含真实敏感值（如「张先生 138****1234 仍留了
 * 身份证号」）优先判敏感（宁拦勿漏，安全优先于便利）。
 */
export function classifyDataForCloud(
  sample: string,
  opts: { now?: () => number } = {},
): SortingDecision {
  const text = sample ?? '';
  const matched: string[] = [];
  for (const { label, pattern } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) matched.push(label);
  }

  if (matched.length > 0) {
    return {
      classification: 'sensitive',
      allowCloud: false,
      reason: `命中敏感模式（${matched.join('、')}）——数据含客户名单/具体价格/财务数字，拦截上云，留本地（挪知识库走 RAG）`,
      matchedPatterns: matched,
      confidentialityRef: generateConfidentialityRef(opts.now),
    };
  }

  const isDesensitized = DESENSITIZED_PATTERNS.some((p) => p.test(text));
  if (isDesensitized) {
    return {
      classification: 'desensitized',
      allowCloud: true,
      reason: '已脱敏（含占位符/掩码特征）——放行上云',
      matchedPatterns: [],
    };
  }

  return {
    classification: 'public',
    allowCloud: true,
    reason: '无敏感特征（公开档）——放行上云',
    matchedPatterns: [],
  };
}

/**
 * 对多段数据批量分拣——返回「是否全部放行」+ 逐段决策（data-push 双闸入库用）。
 * 任一段敏感 → 整体拦截（宁拦勿漏——批量上传不可部分放行）。
 */
export function classifyBatchForCloud(
  samples: string[],
  opts: { now?: () => number } = {},
): { allAllowed: boolean; decisions: SortingDecision[] } {
  const decisions = samples.map((s) => classifyDataForCloud(s, opts));
  return { allAllowed: decisions.every((d) => d.allowCloud), decisions };
}
