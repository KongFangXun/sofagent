// criteria-schema.ts · 审计判据 schema + 加载校验（fail-closed）
// ============================================================
// 定位：v1.6.0 判定底座阶段一——把 git-diff 审计规则重述为「判据（要判断
// 什么）+ 证据（据什么判断）」两段式数据。本模块是判据集的 schema 校验器：
// 任一判据不合规即拒绝整批加载（fail-closed），不降级为「跳过该条」。
//
// 判据模板字段（16 项，规范见 devlog 章二「判据模板与范例」）：
//   id / question / primitive / options|scale / evidence[] / evidenceReadiness /
//   inputParams[] / disposition / probabilitySource / defenseLine / thresholds /
//   abstainTriggers[] / examples / justification / deps[] / revision
// ============================================================

/** 判定原语（与 decision-primitives 同口径） */
export type CriterionPrimitive = 'noul' | 'choice' | 'score';

/** 防线归属（一条判据只属一道） */
export type DefenseLine = 'action' | 'egress' | 'sandbox';

/** 判定化范围（纯函数型留代码，语义型换校准概率） */
export type Disposition = 'stay-code' | 'calibrated-probability';

/** 概率来源（生成式自述数字不构成概率——拒载） */
export type ProbabilitySource = 'distribution' | 'head' | 'denoise';

/** 档位五态（ABSTAIN 与 ASK 可区分） */
export type DispositionLevel = 'ALLOW' | 'ASK' | 'ABSTAIN' | 'DENY' | 'SKIP';

/** 弃权三源归因 */
export type AbstainReason = 'confidence-insufficient' | 'out-of-domain' | 'criteria-missing';

/** 证据就绪度（非 ready 者不得启用） */
export type EvidenceReadiness = 'ready' | `gated:${string}` | 'unavailable';

/** 证据项（可复现定位——「人工判断」类自由文本充数即拒载） */
export interface CriterionEvidence {
  /** 采集通道（如 git-diff / decision-log / hitl-resolved） */
  source: string;
  /** 可复现定位（到行/到字段/到文件+范围） */
  locator: string;
  /** 是否可复现 */
  reproducible: boolean;
}

/** 调用级参数位（三样：参数向量/执行体路径/shell 拆分） */
export interface InputParam {
  kind: 'argv-vector' | 'resolved-executable-path' | 'shell-wrapping-split';
  /** 参数形态描述（argv 数组/绝对路径/拆分结果串） */
  spec: string;
}

/** 正负样例（与 v1.5.3 规则自测 schema 同构——一份样例两用） */
export interface CriterionExamples {
  match: string[];
  notMatch: string[];
}

/** 门槛（按原语分档 + 绑定分布 + 重标触发） */
export interface CriterionThreshold {
  primitive: CriterionPrimitive;
  /** 门槛值（Noul 概率 / Score 分界 / Choice 分布阈值） */
  value: number;
  /** 绑定的分布标识（换基座/漂移须重标） */
  boundDistribution: string;
  /** 重标触发条件 */
  recalibrationTriggers: string[];
}

/** 判据实体（一条规则可拆多条判据——id = 规则号-判据序号） */
export interface AuditCriterion {
  /** 判据标识（如 A19-2——规则号 + 判据序号） */
  id: string;
  /** 对应审计规则 id（如 A19） */
  ruleId: string;
  /** 问句（要判断什么——不带判据名） */
  question: string;
  /** 原语 */
  primitive: CriterionPrimitive;
  /** Choice 全候选（含兜底位）；Score 基准级别 2-10 个 */
  options?: string[];
  scale?: string[];
  /** 证据项 */
  evidence: CriterionEvidence[];
  /** 证据就绪度 */
  evidenceReadiness: EvidenceReadiness;
  /** 调用级参数位 */
  inputParams: InputParam[];
  /** 判定化范围 */
  disposition: Disposition;
  /** 系数来源（disposition=stay-code 必填——纯函数常数记来源） */
  constantSource?: string;
  /** 概率来源（disposition=calibrated-probability 必填） */
  probabilitySource?: ProbabilitySource;
  /** 防线归属 */
  defenseLine: DefenseLine;
  /** 门槛 */
  thresholds: CriterionThreshold[];
  /** 弃权归因（可空数组=该判据无弃权路径） */
  abstainTriggers: AbstainReason[];
  /** 正负样例 */
  examples: CriterionExamples;
  /** 拦截理由（含替代建议） */
  justification: string;
  /** 判据间依赖（前置判据 id——有依赖串行） */
  deps: string[];
  /**
   * 单边记录豁免（显式登记挂起）：判据建立在单边记录上（判决类只记告警
   * 不记放行）时，须显式登记挂起（'pending-record-completion'）才可载入
   * 但不得启用——与直接拒载二选一，不允许静默放行。
   */
  singleSidedRecordWaiver?: 'pending-record-completion';
}

/** 判据集（含修订标识） */
export interface CriterionSet {
  criteria: AuditCriterion[];
  /** 判据集修订标识（内容哈希——随判定落 decision-log） */
  revision: string;
}

// ── 校验错误 ────────────────────────────────────────────

export class CriteriaSchemaError extends Error {
  constructor(message: string) {
    super(`[criteria-schema] ${message}`);
    this.name = 'CriteriaSchemaError';
  }
}

// ── 校验器（fail-closed）────────────────────────────────

const PRIMITIVES: readonly CriterionPrimitive[] = ['noul', 'choice', 'score'];
const DEFENSE_LINES: readonly DefenseLine[] = ['action', 'egress', 'sandbox'];
const DISPOSITIONS: readonly Disposition[] = ['stay-code', 'calibrated-probability'];
const PROB_SOURCES: readonly ProbabilitySource[] = ['distribution', 'head', 'denoise'];
const READINESS_RE = /^(ready|gated:.+|unavailable)$/;
/** 以「人工判断」类自由文本充数的证据 source 黑名单 */
const NON_EVIDENCE_SOURCES = /(人工判断|人为判断|manual[- ]judg|自由文本)/i;

/** 单条判据校验（返回错误列表；空数组=合规） */
export function validateCriterion(c: AuditCriterion): string[] {
  const errs: string[] = [];
  const at = (msg: string) => errs.push(`${c.id}: ${msg}`);

  // id 形态：规则号-序号
  if (!/^[A-Z]\d+-\d+$/.test(c.id)) {
    at(`id「${c.id}」不符「规则号-判据序号」形态（如 A19-2）`);
  }
  if (!c.question || c.question.trim().length < 4) {
    at('question 缺失或过短（须问句形态）');
  }
  if (!PRIMITIVES.includes(c.primitive)) {
    at(`primitive「${c.primitive}」不在枚举 ${PRIMITIVES.join('/')}`);
  }
  // Choice 须给全候选且含「无合适项」位；Score 须给 2-10 基准级别
  if (c.primitive === 'choice') {
    if (!c.options || c.options.length < 2) {
      at('choice 须给全候选（≥2 普通 + 兜底位）');
    } else if (!c.options.some((o) => /(无合适项|以上都不|以上皆非|转人工|信息不足)/.test(o))) {
      at('choice 选项表缺「无合适项→转人工」位（与 ABSTAIN 分立、不可互替）');
    }
  }
  if (c.primitive === 'score') {
    if (!c.scale || c.scale.length < 2 || c.scale.length > 10) {
      at('score 须给 2–10 个具体基准级别');
    }
  }
  // 证据：非空 + 可复现 + source 不为人工判断自由文本
  if (!Array.isArray(c.evidence) || c.evidence.length === 0) {
    at('evidence 为空（判据须有证据项）');
  } else {
    for (const e of c.evidence) {
      if (NON_EVIDENCE_SOURCES.test(e.source)) {
        at(`证据 source「${e.source}」属人工判断类自由文本（可举证性 fail-closed——拒载）`);
      }
      if (!e.locator || e.locator.trim().length === 0) {
        at('证据 locator 缺失（须可复现定位）');
      }
      if (e.reproducible !== true) {
        at('证据 reproducible 须为 true（可举证性——不可复现证据拒载）');
      }
    }
  }
  // 证据就绪度
  if (!READINESS_RE.test(c.evidenceReadiness)) {
    at(`evidenceReadiness「${c.evidenceReadiness}」不合规（ready / gated:<版本> / unavailable）`);
  }
  // 参数位三样
  if (!Array.isArray(c.inputParams) || c.inputParams.length === 0) {
    at('inputParams 为空（判据输入须含调用级参数位）');
  }
  // 判定化范围与配套字段
  if (!DISPOSITIONS.includes(c.disposition)) {
    at(`disposition「${c.disposition}」不在枚举`);
  }
  if (c.disposition === 'stay-code' && !c.constantSource) {
    at('stay-code 须记 constantSource（纯函数常数的系数来源）');
  }
  if (c.disposition === 'calibrated-probability') {
    if (!c.probabilitySource) {
      at('calibrated-probability 须标 probabilitySource');
    } else if (!PROB_SOURCES.includes(c.probabilitySource)) {
      at(`probabilitySource「${c.probabilitySource}」不在枚举`);
    }
  }
  // 防线
  if (!DEFENSE_LINES.includes(c.defenseLine)) {
    at(`defenseLine「${c.defenseLine}」不在枚举（一条判据只属一道）`);
  }
  // 门槛：按原语分档一致
  for (const t of c.thresholds) {
    if (t.primitive !== c.primitive) {
      at(`threshold.primitive「${t.primitive}」与判据 primitive「${c.primitive}」不一致（门槛须按原语分档）`);
    }
    if (!t.boundDistribution || t.recalibrationTriggers.length === 0) {
      at('threshold 须标 boundDistribution + recalibrationTriggers（绑定当前分布+重标触发）');
    }
  }
  // 样例：match/notMatch 非空且不互相矛盾（可判别性由 lint 深查，这里管格式）
  if (!c.examples || c.examples.match.length === 0 || c.examples.notMatch.length === 0) {
    at('examples 须含正负样例（match[] + notMatch[]，与 v1.5.3 规则自测 schema 一致）');
  }
  const overlap = c.examples.match.filter((m) => c.examples.notMatch.includes(m));
  if (overlap.length > 0) {
    at(`正负样例矛盾：${JSON.stringify(overlap)} 同现于 match 与 notMatch（可判别性 fail-closed）`);
  }
  if (!c.justification || c.justification.trim().length < 4) {
    at('justification 缺失（拦截理由——FAIL 报文用，须附替代建议）');
  }
  return errs;
}

/**
 * 判据集加载校验（fail-closed 整批）：
 *   ① 每条判据过单条校验；② id 唯一；③ deps 指向存在的判据且无环；
 *   ④ 单边记录判据须显式登记挂起；⑤ 非 ready 者不落数（只登记待采）。
 * 任一不满足 → 抛错（拒绝整批），不降级跳过。
 */
export function loadCriterionSet(
  criteria: AuditCriterion[],
  opts?: { allowNonReady?: boolean },
): CriterionSet {
  const errs: string[] = [];
  // 单条
  for (const c of criteria) {
    errs.push(...validateCriterion(c));
  }
  // id 唯一
  const ids = new Set(criteria.map((c) => c.id));
  if (ids.size !== criteria.length) {
    const seen = new Set<string>();
    for (const c of criteria) {
      if (seen.has(c.id)) errs.push(`判据 id「${c.id}」重复`);
      seen.add(c.id);
    }
  }
  // deps 存在 + 无环（DFS）
  const byId = new Map(criteria.map((c) => [c.id, c] as const));
  for (const c of criteria) {
    for (const d of c.deps) {
      if (!byId.has(d)) {
        errs.push(`${c.id}: 依赖不存在的判据「${d}」（依赖须显式声明且指向在集）`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (id: string, path: string[]) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      errs.push(`判据依赖成环：${[...path, id].join(' → ')}`);
      return;
    }
    visiting.add(id);
    const node = byId.get(id);
    if (node) for (const d of node.deps) dfs(d, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const c of criteria) dfs(c.id, []);
  // 单边记录判据：须显式登记挂起（否则拒载）
  for (const c of criteria) {
    if (c.evidence.some((e) => /单边|single-sided|只记告警/.test(e.source)) && !c.singleSidedRecordWaiver) {
      errs.push(`${c.id}: 判据建立在单边记录上但未显式登记挂起（singleSidedRecordWaiver 缺失）`);
    }
  }
  // 非 ready 不落数（默认拒绝；显式 allowNonReady 仅用于登记清单输出）
  if (!opts?.allowNonReady) {
    for (const c of criteria) {
      if (c.evidenceReadiness !== 'ready') {
        errs.push(`${c.id}: evidenceReadiness=${c.evidenceReadiness} 非 ready——不得落数（只登记待采）`);
      }
    }
  }
  if (errs.length > 0) {
    throw new CriteriaSchemaError(`判据集加载被拒（${errs.length} 处不合规，fail-closed 整批）：\n  ${errs.join('\n  ')}`);
  }
  // 修订标识：内容哈希（判据集内容 → sha256 前 16 位）
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const canonical = JSON.stringify(
    criteria.map((c) => ({ ...c, revision: undefined })),
  );
  const revision = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return { criteria, revision };
}

/** 启用判定（非 ready 者不得启用——运行期闸门） */
export function isCriterionEnabled(c: AuditCriterion): boolean {
  return c.evidenceReadiness === 'ready' && c.singleSidedRecordWaiver === undefined;
}
