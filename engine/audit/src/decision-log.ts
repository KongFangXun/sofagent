// ============================================================
// decision-log.ts · 决策审计受控写入（v1.3.7 交付 6 T02）
//
// 意图层审计的「受控写」唯一入口——Agent 只能经 emitDecision()
// 落盘决策日志，禁止任何原始 fs 写。签名链与 history.jsonl 共用
// 同一套 HMAC 原语（getEnvFingerprint / getHmacKey / stableStringify /
// atomicAppendSync），同密钥、同签名算法、同环境指纹。
//
// ⚠️ 铁律：
//   1. 先脱敏再签名（sanitizeWhy）——HMAC 基于已脱敏的 why 计算
//   2. 校验失败 → 抛 DecisionSchemaError，不写文件
//   3. atomicAppendSync 抛错 → 抛 DecisionWriteError，绝不静默丢弃
// ============================================================

import { getDecisionLogPath, getEnvFingerprint, getHmacKey, assertTestEnvNotWritingRealData } from '@sofagent/core';
import { ALL_DECISION_KINDS } from '@sofagent/core';
import { appendChained, type ChainFields } from './chain-kernel';
import { sanitizeWhy, type DecisionKind, type DecisionCategory, type CausalType, type DecisionLogEntry, type DecisionWhy, type InvalidationReason, type LoopPhase } from './decision-schema';
import { validateRulerChange, type RulerChangeEvent } from './ruler-change-schema';

// Re-export schema 类型——public-api 从 decision-log 统一导出（与 appendHistory 模式一致）
export type { DecisionLogEntry, DecisionWhy, RouteReason, CausalType, InvalidationReason } from './decision-schema';

/**
 * 决策写入入参——schema 未含的运行时输入定义在此并导出。
 * why 接受纯 string（写入时归一化为 {text}）。
 */
export interface EmitDecisionInput {
  agentId: string;
  sessionId: string;
  kind: DecisionKind;
  moment: LoopPhase;
  why: DecisionWhy | string;
  /**
   * 判断时刻分类（v1.3.6 交付⑮ · 可选）。
   * route/select/skip/retry/escalate——与 kind 正交的「选择动作」维度。
   * 不传则老语义（只记关键决策类型，无判断时刻分类）。
   */
  category?: DecisionCategory;
  /**
   * 因果边（可选）——引用前序决策的 ts 数组 + 因果类型。
   * 拦截决策引用触发它的路由决策（'caused'）、HITL 引用待审上游（'influenced'）。
   * 值为目标条目 ts；写入后纳入 HMAC 签名（stableStringify 全字段）。
   */
  causedBy?: string[];
  causalType?: CausalType;
  /**
   * 审计结论失效原因（v1.5.2 章四 · 可选）。
   * 仅 kind=INVALIDATION 的标记条目应传——宣告 causedBy 指向的结论失效。
   * 传了则必须在 InvalidationReason 枚举内（不传不校验，向后兼容）。
   */
  invalidationReason?: InvalidationReason;
  specRef?: string;
  artifactRef?: string;
  /** 双时态快照：决策引用本体实体时记录当时 validFrom/validTo（v1.5.0 第二章） */
  entityValidity?: Record<string, { validFrom?: string; validTo?: string }>;
  /** 决策记录来源标识（缺省 'sofagent audit'） */
  engine?: string;
  /** 触发证据链（字符串数组，可空）—— v1.3.3 新增
   *
   * kind=EVOLUTION 时必附（运行时不强制 schema 校验，但建议调用方传入）。
   * 格式：字符串数组，每项为一条证据描述。非数组值将被拒绝。
   */
  evidence?: string[];
  /**
   * 判定回执子对象（v1.8.0 §一 接线纪律① · 可选——仅判定类条目传）。
   * 字段集**恰为五件**（多一件少一件判 schema 违规）：
   *   ① stateDigest——state 摘要（sha256，不落原文）
   *   ② evidenceRefs——证据引用（条目引用串数组，不携带原文）
   *   ③ modelIdentity——判定件身份（模型名 + 代次号/revision）
   *   ④ probabilities——完整概率（逐问概率数组，含弃权问）
   *   ⑤ deterministicBaseline——不变的确定性基线（L0 规则面对同一问句的结论，
   *      判定前后不变——「建议非执法」的可审计锚）
   * 三项禁入内容（原始任务文本 / 工具输出 / provider 错误文本）在回执与
   * 快照序列化结果中必须零命中（emitDecision 写前校验，命中即拒绝写入）。
   */
  judgeReceipt?: {
    stateDigest: string;
    evidenceRefs: string[];
    modelIdentity: string;
    probabilities: number[];
    deterministicBaseline: string;
    /** §二 同源对账四件（可选——传入时四件必须齐，缺一即拒） */
    provenance?: {
      payload_sha256: string;
      stateConstructorVersion: string;
      redactionVersion: string;
      criteriaVersion: string;
    };
    /**
     * v1.8.0 §二 门槛参数随判定落痕（可选——「本次判定用的门槛是多少」可回放）：
     * escalation 必为有限非负数字；abstain 在位时三原语键（noul/choice/score）必须齐
     * 且各为有限非负数字（分档不完整 = 变相全局化，拒收）。结构非法即拒。
     */
    thresholds?: {
      escalation: number;
      abstain?: {
        noul: number;
        choice: number;
        score: number;
      };
    };
    /**
     * v1.8.0 §二 校准参数随判定落痕（可选——「这次判定有没有校准依据」可回放）：
     * calibrated 必带 evidence（三件齐：校准集版本 / 拟合 ECE / 拟合时间），缺即拒；
     * uncalibrated 带 evidence 即拒（声明未校准却附校准依据 = 矛盾态）。
     */
    calibration?: {
      calibStatus: 'calibrated' | 'uncalibrated';
      evidence?: {
        calibrationSetVersion: string;
        ece: number;
        fittedAt: string;
      };
    };
  };
  /**
   * 内容语义位（v1.8.0 §二 · 可选）：true=条目携带原文内容；false=只记指纹与
   * 引用（判定类条目的默认纪律）。回执子对象在位时本位必须为 false。
   */
  content?: boolean;
}

/** schema 校验失败（kind/moment 非法、必填缺失）——不写文件 */
export class DecisionSchemaError extends Error {
  constructor(message: string) {
    super(`[decision-log] schema 校验失败: ${message}`);
    this.name = 'DecisionSchemaError';
  }
}

/** 写入失败（atomicAppendSync 抛错）——向上传播，绝不静默丢弃 */
export class DecisionWriteError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`[decision-log] 写入失败: ${message}${cause instanceof Error ? `（${cause.message}）` : ''}`);
    this.name = 'DecisionWriteError';
  }
}

/**
 * 合法 DecisionKind 集合（v1.8.0 fresh-eyes F13/F14 单源化）。
 * 值集 SSOT = core/decision-kinds.ts 的 ALL_DECISION_KINDS（现行 19 值）——
 * 本处不再手抄清单；各 kind 的语义与版本出处注释住 decision-schema.ts 的
 * DecisionKind union（值与语义分离，避免四处双写漂移——RULER_CHANGE 曾因
 * 手抄漏登 doctor 侧 18 值 vs 19 值）。
 */
const VALID_KINDS: readonly string[] = ALL_DECISION_KINDS;

/** 合法 LoopPhase 集合 */
const VALID_MOMENTS: readonly string[] = [
  'OBSERVE', 'ELICIT', 'INDUC', 'ACT', 'EVOLVE', 'DEPLOY', 'ATTRIBUTION',
];

/** 合法 DecisionCategory 集合（v1.3.6 交付⑮ · 判断时刻五分类） */
const VALID_CATEGORIES: readonly string[] = [
  'route', 'select', 'skip', 'retry', 'escalate',
];

/** 合法 CausalType 集合（决策因果边三分类） */
const VALID_CAUSAL_TYPES: readonly string[] = ['caused', 'influenced', 'precedent_for'];

/** 合法 InvalidationReason 集合（v1.5.2 章四 · 失效原因五分类） */
const VALID_INVALIDATION_REASONS: readonly string[] = [
  'authorization-changed', 'incompatible-compaction', 'elevated-risk', 'stale-score', 'fresh-required',
];

/**
 * 归一化 why 为 DecisionWhy——纯 string → { text }
 */
function normalizeWhy(why: DecisionWhy | string): DecisionWhy {
  if (typeof why === 'string') return { text: why };
  return why;
}

/**
 * 业务字段（不含链字段）——写入侧构造，链字段由 chain-kernel 生成。
 * Business fields only; chain fields are produced by chain-kernel.
 */
type DecisionBusinessEntry = Omit<DecisionLogEntry, keyof ChainFields>;

/**
 * 追加一条决策记录到 decision-log.jsonl（受控写唯一入口）。
 *
 * 链协议已收口至 chain-kernel.appendChained（单一事实源）：
 *   1. prevHash：读末行 → sha256(JSON.stringify(lastRecordForHash) + '|' + fingerprint).slice(0,16)
 *   2. 铁律：先脱敏再签名（why → sanitizeWhy，在本函数内先于签名完成）
 *   3. recordForSig 排除链字段（prevHash/hashVersion/hmacSig/hmacAlgo）
 *   4. hmacSig = HMAC-SHA256(key, stableStringify(recordForSig) + '|' + fingerprint).slice(0,32)
 *   5. atomicAppendSync + 每次写入后 chmodSync 0o600
 * kind 白名单（VALID_KINDS）经 validKinds 传入内核——决策侧自持扩展性不变。
 *
 * @param input 决策输入
 * @param dataDir 可选的数据目录覆盖（用于测试）
 * @returns 落盘的完整条目（含链字段）
 * @throws DecisionSchemaError 校验失败（不写文件；含 kind 非法——由内核 kind 门抛出）
 * @throws DecisionWriteError 写入失败（向上传播）
 */
export function emitDecision(input: EmitDecisionInput, dataDir?: string): DecisionLogEntry {
  // ── 校验（写前）──
  // 注：kind 合法性由链内核的 kind 门判定（validKinds=VALID_KINDS）——本函数不再重复。
  if (!VALID_MOMENTS.includes(input.moment)) {
    throw new DecisionSchemaError(`非法 moment "${String(input.moment)}"——必须在 LoopPhase 枚举内`);
  }
  // v1.3.6 交付⑮：category 可选——传了则必须在五分类内（不传不校验，向后兼容）
  if (input.category !== undefined && !VALID_CATEGORIES.includes(input.category)) {
    throw new DecisionSchemaError(`非法 category "${String(input.category)}"——必须在 DecisionCategory 枚举内（route/select/skip/retry/escalate）`);
  }
  if (typeof input.agentId !== 'string' || input.agentId.trim() === '') {
    throw new DecisionSchemaError('agentId 必填且不能为空');
  }
  if (typeof input.sessionId !== 'string' || input.sessionId.trim() === '') {
    throw new DecisionSchemaError('sessionId 必填且不能为空');
  }
  // evidence 格式校验（v1.3.3 新增）：字符串数组，可空。非数组 / 含非字符串项 → 拒绝
  if (input.evidence !== undefined) {
    if (!Array.isArray(input.evidence)) {
      throw new DecisionSchemaError('evidence 必须是字符串数组');
    }
    for (let i = 0; i < input.evidence.length; i++) {
      if (typeof input.evidence[i] !== 'string') {
        throw new DecisionSchemaError(`evidence[${i}] 必须是字符串`);
      }
    }
  }

  // 因果边校验：causedBy 字符串数组 + causalType 三分类枚举
  if (input.causedBy !== undefined) {
    if (!Array.isArray(input.causedBy)) {
      throw new DecisionSchemaError('causedBy 必须是字符串数组（目标条目 ts）');
    }
    for (let i = 0; i < input.causedBy.length; i++) {
      if (typeof input.causedBy[i] !== 'string' || input.causedBy[i]!.trim() === '') {
        throw new DecisionSchemaError(`causedBy[${i}] 必须是非空字符串（目标条目 ts）`);
      }
    }
  }
  if (input.causalType !== undefined && !VALID_CAUSAL_TYPES.includes(input.causalType)) {
    throw new DecisionSchemaError(`非法 causalType "${String(input.causalType)}"——必须在 CausalType 枚举内（caused/influenced/precedent_for）`);
  }
  // v1.5.2 章四：invalidationReason 可选——传了则必须在五分类内（不传不校验，向后兼容）
  if (input.invalidationReason !== undefined && !VALID_INVALIDATION_REASONS.includes(input.invalidationReason)) {
    throw new DecisionSchemaError(`非法 invalidationReason "${String(input.invalidationReason)}"——必须在 InvalidationReason 枚举内（authorization-changed/incompatible-compaction/elevated-risk/stale-score/fresh-required）`);
  }

  // v1.8.0 §一 接线纪律①：判定回执子对象校验——字段集恰为五件 + 三项禁入内容零命中
  if (input.judgeReceipt !== undefined) {
    const r = input.judgeReceipt;
    const REQUIRED = ['stateDigest', 'evidenceRefs', 'modelIdentity', 'probabilities', 'deterministicBaseline'] as const;
    const keys = Object.keys(r);
    const missing = REQUIRED.filter((k) => !(k in r));
    if (missing.length > 0) {
      throw new DecisionSchemaError(
        `judgeReceipt 五件必选缺失：${missing.join('/')}（实际 ${keys.join('/') || '(空)'}）`,
      );
    }
    // P1-2（review r1）：原型污染键显式拒收（Object.keys 不列 __proto__ 但 JSON.parse 的键会进对象——
    // 任何以 __ 开头的键与 constructor/prototype 一律拒，防校验面被键名怪异形态绕过）
    const protoKeys = keys.filter((k) => k.startsWith('__') || k === 'constructor' || k === 'prototype');
    if (protoKeys.length > 0) throw new DecisionSchemaError(`judgeReceipt 含原型污染键：${protoKeys.join('/')}`);
    const unknown = keys.filter((k) => k !== 'provenance' && k !== 'thresholds' && k !== 'calibration' && !(REQUIRED as readonly string[]).includes(k));
    if (unknown.length > 0) {
      throw new DecisionSchemaError(
        `judgeReceipt 字段集越界：${unknown.join('/')}（五件 + 可选 provenance/thresholds/calibration 之外不得有其他键）`,
      );
    }
    // §二 同源对账四件：provenance 在位时必须四件齐
    if (r.provenance !== undefined) {
      const p = r.provenance;
      const PV = ['payload_sha256', 'stateConstructorVersion', 'redactionVersion', 'criteriaVersion'] as const;
      const pMiss = PV.filter((k) => !(k in p) || typeof (p as Record<string, unknown>)[k] !== 'string');
      if (pMiss.length > 0) throw new DecisionSchemaError(`judgeReceipt.provenance 四件缺失或非串：${pMiss.join('/')}`);
    }
    // v1.8.0 §二 门槛参数随判定落痕：结构非法即拒收（escalation 有限非负数字；
    // abstain 在位时三原语键齐且各为有限非负数字——分档不完整即变相全局化）
    if (r.thresholds !== undefined) {
      const t = r.thresholds as Record<string, unknown>;
      const esc = t['escalation'];
      if (typeof esc !== 'number' || !Number.isFinite(esc) || esc < 0) {
        throw new DecisionSchemaError('judgeReceipt.thresholds.escalation 必须是有限非负数字（本次判定实际使用的升级门槛）');
      }
      if (t['abstain'] !== undefined) {
        const a = t['abstain'] as Record<string, unknown>;
        if (typeof a !== 'object' || a === null) {
          throw new DecisionSchemaError('judgeReceipt.thresholds.abstain 必须是对象（{noul,choice,score} 三原语分档）');
        }
        const aMiss = (['noul', 'choice', 'score'] as const).filter((k) => {
          const v = a[k];
          return typeof v !== 'number' || !Number.isFinite(v) || v < 0;
        });
        if (aMiss.length > 0) {
          throw new DecisionSchemaError(`judgeReceipt.thresholds.abstain 缺原语键或非有限非负数字：${aMiss.join('/')}（三键全必填——分档不完整即变相全局化）`);
        }
      }
    }
    // v1.8.0 §二 校准参数随判定落痕：两态互斥校验
    //（calibrated 必带 evidence 三件；uncalibrated 带 evidence 即矛盾态——拒）
    if (r.calibration !== undefined) {
      const c = r.calibration as Record<string, unknown>;
      const status = c['calibStatus'];
      if (status !== 'calibrated' && status !== 'uncalibrated') {
        throw new DecisionSchemaError(`judgeReceipt.calibration.calibStatus 必须是 'calibrated' | 'uncalibrated'（实际 ${String(status)}）`);
      }
      const ev = c['evidence'];
      if (status === 'calibrated') {
        if (ev === undefined) {
          throw new DecisionSchemaError('judgeReceipt.calibration 声明 calibrated 必须带 evidence（校准集版本 / ECE / 拟合时间——缺依据不得称已校准）');
        }
        const e = ev as Record<string, unknown>;
        if (typeof e['calibrationSetVersion'] !== 'string' || e['calibrationSetVersion'].trim() === '') {
          throw new DecisionSchemaError('judgeReceipt.calibration.evidence.calibrationSetVersion 必须是非空字符串（校准集版本）');
        }
        if (typeof e['ece'] !== 'number' || !Number.isFinite(e['ece']) || e['ece'] < 0) {
          throw new DecisionSchemaError('judgeReceipt.calibration.evidence.ece 必须是有限非负数字（拟合时 ECE 读数）');
        }
        if (typeof e['fittedAt'] !== 'string' || e['fittedAt'].trim() === '') {
          throw new DecisionSchemaError('judgeReceipt.calibration.evidence.fittedAt 必须是非空字符串（ISO 8601 拟合时间）');
        }
      } else if (ev !== undefined) {
        throw new DecisionSchemaError('judgeReceipt.calibration 声明 uncalibrated 不得附 evidence（未校准却带校准依据 = 矛盾态）');
      }
    }
    if (typeof r.stateDigest !== 'string' || r.stateDigest.trim() === '') throw new DecisionSchemaError('judgeReceipt.stateDigest 必须是非空字符串（sha256 摘要）');
    if (!Array.isArray(r.evidenceRefs) || r.evidenceRefs.some((e) => typeof e !== 'string')) throw new DecisionSchemaError('judgeReceipt.evidenceRefs 必须是字符串数组');
    if (typeof r.modelIdentity !== 'string' || r.modelIdentity.trim() === '') throw new DecisionSchemaError('judgeReceipt.modelIdentity 必须是非空字符串');
    if (!Array.isArray(r.probabilities) || r.probabilities.some((p) => typeof p !== 'number' || !Number.isFinite(p))) throw new DecisionSchemaError('judgeReceipt.probabilities 必须是有限数字数组');
    if (typeof r.deterministicBaseline !== 'string') throw new DecisionSchemaError('judgeReceipt.deterministicBaseline 必须是字符串（L0 基线结论，可为空串表示无基线）');
    // 三项禁入内容：原始任务文本/工具输出/provider 错误文本不得混入回执
    // （回执五件全部是摘要/引用/数字/身份——任何长自由文本都视为疑似原文，拒收）
    const suspicious = [r.stateDigest, r.modelIdentity, r.deterministicBaseline, ...r.evidenceRefs].join('\n');
    if (suspicious.length > 2048) {
      throw new DecisionSchemaError('judgeReceipt 疑似携带原文（回执五件总长 >2048 字符）——原始任务文本/工具输出/provider 错误文本不入回执');
    }
    // content 语义位联动：回执在位 ⇒ content 必须为 false（指纹纪律）
    if (input.content === true) {
      throw new DecisionSchemaError('judgeReceipt 在位时 content 必须为 false（回执只记指纹与引用，不携带内容）');
    }
  }

  const filePath = getDecisionLogPath(dataDir);
  // 写侧护栏：测试环境解析到真实数据根 → fail-loud 拒绝写入（先于任何 fs 写）
  assertTestEnvNotWritingRealData(filePath, 'emitDecision');
  const fingerprint = getEnvFingerprint(dataDir);
  const hmacKey = getHmacKey();

  // ── 2-3. 先脱敏再签名（铁律）——业务字段（不含链字段）──
  const baseSanitized: DecisionBusinessEntry = {
    ts: new Date().toISOString(),
    agentId: input.agentId,
    sessionId: input.sessionId,
    kind: input.kind,
    // v1.3.6 交付⑮：category 可选——传了才落盘（老语义不传 = 无此字段）
    ...(input.category !== undefined ? { category: input.category } : {}),
    // 因果边可选——传了才落盘并纳入 HMAC 签名（stableStringify 全字段）
    ...(input.causedBy !== undefined ? { causedBy: input.causedBy } : {}),
    ...(input.causalType !== undefined ? { causalType: input.causalType } : {}),
    // v1.5.2 章四：失效原因——传了才落盘（老语义不传 = 无此字段 = 结论有效）
    ...(input.invalidationReason !== undefined ? { invalidationReason: input.invalidationReason } : {}),
    moment: input.moment,
    why: sanitizeWhy(normalizeWhy(input.why)),
    ...(input.specRef ? { specRef: input.specRef } : {}),
    ...(input.artifactRef ? { artifactRef: input.artifactRef } : {}),
    ...(input.entityValidity !== undefined ? { entityValidity: input.entityValidity } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    // v1.8.0 §一/§二：判定回执（五件）与 content 语义位——传了才落盘并纳入 HMAC
    ...(input.judgeReceipt !== undefined ? { judgeReceipt: input.judgeReceipt } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    engine: input.engine ?? 'sofagent audit',
  };

  // ── 1/4/5. 链字段生成 + HMAC 签名 + 原子追加 + 收紧权限（全部由 chain-kernel 承载）──
  return appendChained(baseSanitized, {
    filePath,
    validKinds: VALID_KINDS,
    key: hmacKey,
    fingerprint,
    onInvalidKind: (kind) =>
      new DecisionSchemaError(`非法 kind "${String(kind)}"——必须在 DecisionKind 枚举内`),
    onWriteError: (message, cause) => new DecisionWriteError(message, cause),
    logLabel: '[decision-log]',
  });
}

// ════════════════════════════════════════
// v1.7.0 §七 · 尺子变更事件写入（第二类事件——同链、同 HMAC 纪律）
// ════════════════════════════════════════

/** 尺子变更事件写入入参（业务字段——经 ruler-change-schema 校验；ts 缺省由本函数生成） */
export type EmitRulerChangeInput = Omit<RulerChangeEvent, 'ts'> & { ts?: string };

/**
 * 追加一条尺子变更事件到 decision-log.jsonl（kind=RULER_CHANGE 受控写入口）。
 *
 * 与 emitDecision 同链同协议（appendChained 五步：prevHash 相接 + 先校验
 * 后签名 + HMAC + 原子追加 + 0o600）——尺子变更与机器决策共用一条 HMAC 链，
 * 「谁在什么时候换了尺子、为什么换、换前换后长什么样」可举证可验签。
 *
 * 事件体经 validateRulerChange fail-closed 校验（六 aspect / delta 缺
 * before-after 拒载 / trigger=override ⇒ refs 必填——非法即抛
 * RulerChangeSchemaError，不写文件）。effect 回填由 effect-backfill 侧
 * 计算后传入（构造期可缺）。
 *
 * @throws RulerChangeSchemaError 事件体 schema 校验失败（含缺失项清单）
 * @throws DecisionWriteError 写入失败（向上传播，绝不静默丢弃）
 */
export function appendRulerChange(input: EmitRulerChangeInput, dataDir?: string): DecisionLogEntry & { rulerChange: RulerChangeEvent } {
  // fail-closed 业务校验（ruler-change-schema 侧——ts 缺省补写时刻）
  const event = validateRulerChange({ ts: input.ts ?? new Date().toISOString(), ...stripUndefinedTs(input) });

  const filePath = getDecisionLogPath(dataDir);
  assertTestEnvNotWritingRealData(filePath, 'appendRulerChange');
  const fingerprint = getEnvFingerprint(dataDir);
  const hmacKey = getHmacKey();

  // 业务字段（不含链字段）：kind=RULER_CHANGE + 结构化事件体挂 rulerChange 字段
  // （why.text 为人读摘要——从结构化字段派生，机器消费面读 rulerChange 本体）。
  const baseSanitized = {
    ts: event.ts,
    agentId: event.agentId,
    sessionId: event.sessionId,
    kind: 'RULER_CHANGE' as const,
    moment: 'ATTRIBUTION' as const, // 尺子变更属归因面（换尺子是对既有判定的治理动作）
    why: sanitizeWhy({
      text: `尺子变更[${event.aspect}] ${event.targetId} ${event.delta.op}（trigger=${event.rationale.trigger}，actor=${event.actor.id}/${event.actor.role}）`,
    }),
    rulerChange: event,
    engine: 'sofagent audit',
  };

  return appendChained(baseSanitized, {
    filePath,
    validKinds: VALID_KINDS,
    key: hmacKey,
    fingerprint,
    onInvalidKind: (kind) =>
      new DecisionSchemaError(`非法 kind "${String(kind)}"——必须在 DecisionKind 枚举内`),
    onWriteError: (message, cause) => new DecisionWriteError(message, cause),
    logLabel: '[decision-log]',
  });
}

/** ts 缺省时剔除 undefined 键（zod .strict() 拒绝显式 undefined 覆盖可选字段缺省语义） */
function stripUndefinedTs(input: EmitRulerChangeInput): EmitRulerChangeInput {
  if (input.ts === undefined) {
    const { ts: _ts, ...rest } = input;
    return rest as EmitRulerChangeInput;
  }
  return input;
}
