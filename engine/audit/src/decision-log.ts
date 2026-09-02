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

import { existsSync, mkdirSync, readFileSync, chmodSync } from 'fs';
import { dirname } from 'path';
import { createHash, createHmac } from 'crypto';
import { getDecisionLogPath, getEnvFingerprint, getHmacKey, stableStringify } from '@sofagent/core';
import { atomicAppendSync } from '@sofagent/core';
import { sanitizeWhy, type DecisionKind, type DecisionCategory, type CausalType, type DecisionLogEntry, type DecisionWhy, type LoopPhase } from './decision-schema';

// Re-export schema 类型——public-api 从 decision-log 统一导出（与 appendHistory 模式一致）
export type { DecisionLogEntry, DecisionWhy, RouteReason, CausalType } from './decision-schema';

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
  specRef?: string;
  artifactRef?: string;
  /** 决策引擎标识（缺省 'sofagent-audit'） */
  engine?: string;
  /** 触发证据链（字符串数组，可空）—— v1.3.3 新增
   *
   * kind=EVOLUTION 时必附（运行时不强制 schema 校验，但建议调用方传入）。
   * 格式：字符串数组，每项为一条证据描述。非数组值将被拒绝。
   */
  evidence?: string[];
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

/** 合法 DecisionKind 集合 */
const VALID_KINDS: readonly string[] = [
  'SPEC_CHANGE', 'ARTIFACT_EDIT', 'TOOL_GATE', 'RULE_TOGGLE',
  'ESCALATE_REPORT', 'FALLBACK_DEGRADE', 'CONFIG_CHANGE',
  'KNOWLEDGE_DISTILL', 'ORCHESTRATION',
  'EVOLUTION', 'TEAM', 'COMMONS',
];

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

/**
 * 归一化 why 为 DecisionWhy——纯 string → { text }
 */
function normalizeWhy(why: DecisionWhy | string): DecisionWhy {
  if (typeof why === 'string') return { text: why };
  return why;
}

/**
 * 追加一条决策记录到 decision-log.jsonl（受控写唯一入口）。
 *
 * 签名顺序（逐字对齐 appendHistory）：
 *   1. prevHash：读末行 → sha256(JSON.stringify(lastRecordForHash) + '|' + fingerprint).slice(0,16)
 *   2. baseSanitized = { ...entry, prevHash, hashVersion:2, envFingerprint, hmacAlgo, why: sanitizeWhy(why) }
 *   3. 铁律：先脱敏再签名
 *   4. recordForSig = { ...baseSanitized, prevHash/hashVersion/hmacSig/hmacAlgo: undefined }
 *   5. hmacSig = createHmac('sha256', key).update(stableStringify(recordForSig) + '|' + fingerprint).digest('hex').slice(0,32)
 *   6. atomicAppendSync + 每次写入后 chmodSync 0o600
 *
 * @param input 决策输入
 * @param dataDir 可选的数据目录覆盖（用于测试）
 * @returns 落盘的完整条目（含链字段）
 * @throws DecisionSchemaError 校验失败（不写文件）
 * @throws DecisionWriteError 写入失败（向上传播）
 */
export function emitDecision(input: EmitDecisionInput, dataDir?: string): DecisionLogEntry {
  // ── 校验（写前）──
  if (!VALID_KINDS.includes(input.kind)) {
    throw new DecisionSchemaError(`非法 kind "${String(input.kind)}"——必须在 DecisionKind 枚举内`);
  }
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

  const filePath = getDecisionLogPath(dataDir);
  const dir = dirname(filePath);

  try {
    if (!existsSync(dir)) {
      // 权限收紧为 0o700（与 history.jsonl 一致）
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch (err) {
    throw new DecisionWriteError(`创建目录失败 ${dir}`, err);
  }

  const fingerprint = getEnvFingerprint(dataDir);

  // ── 1. prevHash（读末行）──
  let prevHash = 'genesis';
  if (existsSync(filePath)) {
    try {
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1]!;
        const lastEntry = JSON.parse(lastLine) as DecisionLogEntry;
        const lastRecordForHash = { ...lastEntry, prevHash: undefined, hashVersion: undefined };
        prevHash = createHash('sha256')
          .update(JSON.stringify(lastRecordForHash) + '|' + fingerprint)
          .digest('hex').slice(0, 16);
      }
    } catch (err) {
      // 末行解析失败——无法建立链，保守置 'unknown'（与 appendHistory 同语义）
      prevHash = 'unknown';
    }
  }

  // ── 2-3. 先脱敏再签名（铁律）──
  const hmacKey = getHmacKey();
  const baseSanitized: DecisionLogEntry = {
    ts: new Date().toISOString(),
    agentId: input.agentId,
    sessionId: input.sessionId,
    kind: input.kind,
    // v1.3.6 交付⑮：category 可选——传了才落盘（老语义不传 = 无此字段）
    ...(input.category !== undefined ? { category: input.category } : {}),
    // 因果边可选——传了才落盘并纳入 HMAC 签名（stableStringify 全字段）
    ...(input.causedBy !== undefined ? { causedBy: input.causedBy } : {}),
    ...(input.causalType !== undefined ? { causalType: input.causalType } : {}),
    moment: input.moment,
    why: sanitizeWhy(normalizeWhy(input.why)),
    ...(input.specRef ? { specRef: input.specRef } : {}),
    ...(input.artifactRef ? { artifactRef: input.artifactRef } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    prevHash,
    hashVersion: 2,
    envFingerprint: fingerprint,
    hmacAlgo: hmacKey ? 'stable' : undefined,
    engine: input.engine ?? 'sofagent-audit',
  };

  // ── 4-5. 签名输入排除链字段 + HMAC ──
  const recordForSig = { ...baseSanitized, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey).update(stableStringify(recordForSig) + '|' + fingerprint).digest('hex').slice(0, 32)
    : undefined;

  const finalEntry: DecisionLogEntry = { ...baseSanitized, hmacSig: hmacSig ?? undefined };

  // ── 6. 原子追加 + 每次写入后收紧权限 ──
  try {
    atomicAppendSync(filePath, JSON.stringify(finalEntry));
  } catch (err) {
    throw new DecisionWriteError(`atomicAppendSync 失败 ${filePath}`, err);
  }
  try {
    chmodSync(filePath, 0o600);
  } catch (err) {
    // 权限设置失败不阻断写入（与 appendHistory 同语义，仅告警）
    console.error(`[decision-log] 决策日志文件权限设置失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  return finalEntry;
}
