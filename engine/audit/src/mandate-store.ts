// ============================================================
// mandate-store.ts · v1.5.2 章七 · 事前授权补环（mandate）授权台账
// ============================================================
//
// 现有审计是**事后**环（变更 → git diff → 规则 → 留痕可举证）。本文件补**事前**
// 环的第一步：Agent 动手前先领一张**有限且可归属**的授权——**范围**（能碰什么）+
// **时效**（何时失效）+ **审批人**（谁批的）。三元素**缺一即不受理**。
//
// 本文件只做「授权签发 / 查询 / 过期 / 越界判定」——**不含任何拦截/执行**：
// 拦截（越界动作执行前拒绝）在 engine/orchestrator/src/middleware/mandate-gate-mw.ts
// 通道，判定逻辑表达为 v1.5.2 第三章 should-run 骨架的「人审 gate」一问扩展（不另立通道）。
//
// 落盘形态（为何另存文件、不污染 decision-log 主链）：
//   - 授权台账落 <dataDir>/audit/mandate-log.jsonl，**复用 chain-kernel.appendChained**
//     （同一 HMAC-SHA256 + 环境指纹 + 原子追加）——「挂链留痕、可举证」。
//   - 为何不落 decision-log.jsonl：decision-log 记「Agent 决策理由链」（事后问责），
//     授权台账是**事前凭证**（谁在何时批了多大范围的权限）——语义不同。
//     把凭证混进决策链会污染按 kind 聚合的 KPI（对齐章五 egress-audit 不用
//     appendHistory 的同款理由：通道/语义不对，硬塞即污染统计）。
//   - 拒绝裁决的留痕**不在此文件**——走 emitDecision（decision-log 链），与
//     章五出口治理面的裁决留痕形态一致（见 mandate-gate-mw.recordAudit）。
//
// ⚠️ appendChained 会写真实数据目录——测试必须传临时 dataDir。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { getDecisionLogPath, getEnvFingerprint, getHmacKey } from '@sofagent/core';
import { appendChained } from './chain-kernel';

// ════════════════════════════════════════
// 常量 / 路径
// ════════════════════════════════════════

/** 授权台账文件名（与 decision-log.jsonl 同目录的兄弟文件） */
export const MANDATE_LOG_FILENAME = 'mandate-log.jsonl';

/** 台账条目的 kind 取值（chain-kernel 的 kind 门白名单——本文件自持） */
export const MANDATE_GRANT_KIND = 'MANDATE_GRANT';

/**
 * 解析授权台账文件路径。
 *
 * 解析链与 getDecisionLogPath 完全一致（显式 dataDir > SOFAGENT_DATA >
 * 默认 data 目录），落在同目录下——授权台账与决策日志同级兄弟文件。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function resolveMandateLogPath(dataDir?: string): string {
  const dir = dataDir ?? process.env.SOFAGENT_DATA;
  if (dir) return join(dir, 'audit', MANDATE_LOG_FILENAME);
  return join(dirname(getDecisionLogPath()), MANDATE_LOG_FILENAME);
}

// ════════════════════════════════════════
// 错误
// ════════════════════════════════════════

/** 授权记录非法（三元素缺失 / 字段格式错）——签发前拒绝，不落盘 */
export class MandateSchemaError extends Error {
  constructor(message: string) {
    super(`[mandate-store] schema 校验失败: ${message}`);
    this.name = 'MandateSchemaError';
  }
}

/** 授权台账写入失败（atomicAppendSync 抛错）——向上传播，绝不静默丢弃 */
export class MandateWriteError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`[mandate-store] 写入失败: ${message}${cause instanceof Error ? `（${cause.message}）` : ''}`);
    this.name = 'MandateWriteError';
  }
}

// ════════════════════════════════════════
// 类型：授权三元素
// ════════════════════════════════════════

/**
 * 授权**范围**——「能碰什么」（三元素之一）。
 *
 * 可判定形式：工具名（动作）· 路径前缀 · host。每个维度**存在即限制**、
 * 缺省即不限制该维度；三档维度**至少一档非空**方为「有范围」（空范围 = 缺元素）。
 */
export interface MandateScope {
  /** 允许的工具/动作（精确名或 `前缀*` 通配） */
  tools?: string[];
  /** 允许触碰的路径前缀（如 `src/`——前缀匹配语义） */
  pathPrefixes?: string[];
  /** 允许外联的 host（精确或子域——与出站白名单同款语义） */
  hosts?: string[];
}

/** 授权**时效**——「何时生效 / 何时失效」（三元素之二） */
export interface MandateValidity {
  /** 生效时刻（ISO 8601，必填） */
  validFrom: string;
  /** 失效时刻（ISO 8601，可选——缺省 = 不设失效，须以审批人背书） */
  validTo?: string;
}

/**
 * 凭证范围声明（三元素之外的**凭证面联动**接口）。
 *
 * 由 v1.5.4 第三章凭证隔离 Vault 产出，供与授权范围**对账**（凭证不得超出授权）。
 * ⚠️ 本版只留对账接口（无真实消费方——如实说明，不假接线）：生产消费在
 * v1.5.4 凭证 Vault 就位后接入 reconcileCredentialScope。
 */
export interface CredentialScopeDeclaration {
  /** 声明归属的授权 id（对账主键） */
  mandateId: string;
  /** 声明可用的凭证范围（与授权范围同构判定维度） */
  scope: MandateScope;
  /** 声明产出方（Vault 标识） */
  issuedBy: string;
  /** 声明产出时刻（ISO 8601） */
  issuedAt: string;
}

/** 授权签发入参 */
export interface MandateGrantInput {
  /** 授权 id（唯一键） */
  id: string;
  /** 授权主体（agentId / 节点 / workflow 标识） */
  subject: string;
  /** 范围（三元素之一）——三档维度至少一档非空 */
  scope: MandateScope;
  /** 时效（三元素之二）——validFrom 必填 */
  validity: MandateValidity;
  /** 审批人（三元素之三）——谁批的 */
  approver: string;
  /** 签发时刻（ISO 8601；缺省当前时间） */
  issuedAt?: string;
  /** 凭证范围声明（凭证面联动；由 v1.5.4 Vault 产出，本版只留接口） */
  credentialScope?: CredentialScopeDeclaration;
}

/** 一条授权记录（落盘形态去掉链字段后的业务投影） */
export interface MandateGrant {
  id: string;
  subject: string;
  scope: MandateScope;
  validity: MandateValidity;
  approver: string;
  issuedAt: string;
  credentialScope?: CredentialScopeDeclaration;
}

// ════════════════════════════════════════
// 类型：动作请求 / 越界判定
// ════════════════════════════════════════

/** 待判定的动作请求（与所持授权比对的对象） */
export interface MandateActionRequest {
  /** 动作主体（须与授权 subject 一致） */
  subject: string;
  /** 动作名（工具名 / 命令标签） */
  action: string;
  /** 动作触碰的目标（路径 / host——范围判定用） */
  target?: { path?: string; host?: string };
}

/** 越界判定结论码 */
export type MandateVerdict = 'covered' | 'no-mandate' | 'out-of-scope' | 'expired' | 'invalid-grant';

/** 一次越界判定结果 */
export interface MandateEvaluation {
  /** 结论码 */
  verdict: MandateVerdict;
  /** 是否被覆盖（覆盖才放行） */
  covered: boolean;
  /** 人类可读理由 */
  reason: string;
  /** 命中的授权 id（covered 时） */
  grantId?: string;
  /** 命中授权的审批人（covered 时——可追溯「谁批的」） */
  approver?: string;
}

/** 凭证范围对账结论 */
export interface CredentialAlignment {
  aligned: boolean;
  reason: string;
}

// ════════════════════════════════════════
// 三元素完整性（缺一即不受理）
// ════════════════════════════════════════

/** 范围是否非空（三档维度至少一档有非空项） */
function hasScope(scope: MandateScope | undefined | null): boolean {
  if (!scope || typeof scope !== 'object') return false;
  const dims = [scope.tools, scope.pathPrefixes, scope.hosts];
  return dims.some((d) => Array.isArray(d) && d.length > 0);
}

/** 时效是否有效（validFrom 非空字符串） */
function hasValidity(validity: MandateValidity | undefined | null): boolean {
  return (
    !!validity &&
    typeof validity === 'object' &&
    typeof validity.validFrom === 'string' &&
    validity.validFrom.trim() !== ''
  );
}

/** 审批人是否非空 */
function hasApprover(approver: string | undefined | null): boolean {
  return typeof approver === 'string' && approver.trim() !== '';
}

/** ISO 8601 可解析判定 */
function isIsoTimestamp(value: string): boolean {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

/**
 * 三元素是否齐全（范围 + 时效 + 审批人，缺一即不受理）。
 *
 * 签发时用于**拒绝受理**；读取/判定时用于把残缺记录判为 invalid-grant。
 */
export function hasAllThreeElements(grant: MandateGrant): boolean {
  return hasScope(grant.scope) && hasValidity(grant.validity) && hasApprover(grant.approver);
}

// ════════════════════════════════════════
// 签发（写授权台账）
// ════════════════════════════════════════

/** 归一化范围：去空白、剔空项、去重；全空的维度不保留 */
function normalizeScope(scope: MandateScope): MandateScope {
  const clean = (arr?: string[]): string[] | undefined => {
    if (!Array.isArray(arr)) return undefined;
    const out: string[] = [];
    for (const item of arr) {
      if (typeof item !== 'string') continue;
      const t = item.trim();
      if (t !== '' && !out.includes(t)) out.push(t);
    }
    return out.length > 0 ? out : undefined;
  };
  const out: MandateScope = {};
  const tools = clean(scope.tools);
  if (tools) out.tools = tools;
  const pathPrefixes = clean(scope.pathPrefixes);
  if (pathPrefixes) out.pathPrefixes = pathPrefixes;
  const hosts = clean(scope.hosts);
  if (hosts) out.hosts = hosts;
  return out;
}

/**
 * 签发一张授权——三元素**缺一即拒绝受理**（抛 MandateSchemaError，不落盘）。
 *
 * 落盘走 chain-kernel.appendChained（HMAC 链，可举证）。kind 恒为 MANDATE_GRANT。
 *
 * @param input 授权签发入参
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 落盘后的授权记录（业务投影）
 * @throws MandateSchemaError 三元素缺失 / 字段非法（不落盘）
 * @throws MandateWriteError 写盘失败（向上传播）
 */
export function issueMandate(input: MandateGrantInput, dataDir?: string): MandateGrant {
  // ── 三元素缺一不受理（签发前，先于任何落盘）──
  if (!hasScope(input.scope)) {
    throw new MandateSchemaError('授权范围缺失：scope 必须至少声明 tools/pathPrefixes/hosts 之一且非空');
  }
  if (!hasValidity(input.validity)) {
    throw new MandateSchemaError('授权时效缺失：validity.validFrom 必填且为 ISO 8601');
  }
  if (!hasApprover(input.approver)) {
    throw new MandateSchemaError('审批人缺失：approver 必填且非空（三元素缺一不受理）');
  }
  // ── 其余字段格式校验 ──
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new MandateSchemaError('id 必填且非空');
  }
  if (typeof input.subject !== 'string' || input.subject.trim() === '') {
    throw new MandateSchemaError('subject 必填且非空');
  }
  if (!isIsoTimestamp(input.validity.validFrom)) {
    throw new MandateSchemaError(`validity.validFrom 非法（非 ISO 8601）: ${String(input.validity.validFrom)}`);
  }
  if (input.validity.validTo !== undefined) {
    if (!isIsoTimestamp(input.validity.validTo)) {
      throw new MandateSchemaError(`validity.validTo 非法（非 ISO 8601）: ${String(input.validity.validTo)}`);
    }
    if (Date.parse(input.validity.validTo) < Date.parse(input.validity.validFrom)) {
      throw new MandateSchemaError('validity.validTo 必须不早于 validFrom');
    }
  }

  const grant: MandateGrant = {
    id: input.id.trim(),
    subject: input.subject.trim(),
    scope: normalizeScope(input.scope),
    validity: {
      validFrom: input.validity.validFrom,
      ...(input.validity.validTo !== undefined ? { validTo: input.validity.validTo } : {}),
    },
    approver: input.approver.trim(),
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
  if (input.credentialScope) grant.credentialScope = input.credentialScope;

  // ── 落盘（HMAC 链：appendChained）──
  const filePath = resolveMandateLogPath(dataDir);
  appendChained(
    { kind: MANDATE_GRANT_KIND, ...grant },
    {
      filePath,
      validKinds: [MANDATE_GRANT_KIND],
      key: getHmacKey(),
      fingerprint: getEnvFingerprint(dataDir),
      onWriteError: (message, cause) => new MandateWriteError(message, cause),
      logLabel: '[mandate-store]',
    },
  );
  return grant;
}

// ════════════════════════════════════════
// 查询（读授权台账）
// ════════════════════════════════════════

/** 从落盘记录投影回 MandateGrant（字段不全则丢弃——坏行容错） */
function toGrant(record: Record<string, unknown>): MandateGrant | undefined {
  if (
    typeof record.id !== 'string' ||
    typeof record.subject !== 'string' ||
    typeof record.approver !== 'string' ||
    typeof record.issuedAt !== 'string'
  ) {
    return undefined;
  }
  const scope = record.scope && typeof record.scope === 'object' ? (record.scope as MandateScope) : {};
  const validity =
    record.validity && typeof record.validity === 'object'
      ? (record.validity as MandateValidity)
      : ({ validFrom: '' } as MandateValidity);
  const grant: MandateGrant = {
    id: record.id,
    subject: record.subject,
    scope,
    validity,
    approver: record.approver,
    issuedAt: record.issuedAt,
  };
  if (record.credentialScope && typeof record.credentialScope === 'object') {
    grant.credentialScope = record.credentialScope as CredentialScopeDeclaration;
  }
  return grant;
}

/**
 * 读取全部授权记录（按落盘顺序）。
 *
 * 坏行 / 非 MANDATE_GRANT 行跳过（读取容错——台账链完整性由 chain-kernel.verifyChain 校验）。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function loadMandateGrants(dataDir?: string): MandateGrant[] {
  const filePath = resolveMandateLogPath(dataDir);
  if (!existsSync(filePath)) return [];
  const out: MandateGrant[] = [];
  const lines = readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // 坏行跳过
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const record = parsed as Record<string, unknown>;
    if (record.kind !== MANDATE_GRANT_KIND) continue;
    const grant = toGrant(record);
    if (grant) out.push(grant);
  }
  return out;
}

/** 按 id 查授权（首个命中；无则 undefined） */
export function getMandateById(id: string, dataDir?: string): MandateGrant | undefined {
  return loadMandateGrants(dataDir).find((g) => g.id === id);
}

/** 按主体查授权（全部命中，落盘序） */
export function getMandatesBySubject(subject: string, dataDir?: string): MandateGrant[] {
  return loadMandateGrants(dataDir).filter((g) => g.subject === subject);
}

// ════════════════════════════════════════
// 过期判定 / 越界判定（纯函数）
// ════════════════════════════════════════

/**
 * 过期判定（纯函数）——now 早于 validFrom（未生效）或晚于 validTo（已失效）即过期；
 * 时效元素缺失 / 非法 o 一律按过期处理（缺时效 = 不受理）。
 */
export function isMandateExpired(grant: MandateGrant, now: Date): boolean {
  if (!hasValidity(grant.validity)) return true;
  const from = Date.parse(grant.validity.validFrom);
  if (Number.isNaN(from)) return true;
  const t = now.getTime();
  if (t < from) return true; // 尚未生效
  if (grant.validity.validTo !== undefined) {
    const to = Date.parse(grant.validity.validTo);
    if (Number.isNaN(to)) return true;
    if (t > to) return true; // 已失效
  }
  return false;
}

/** 工具名匹配（精确或 `前缀*` 通配） */
function toolMatches(pattern: string, action: string): boolean {
  if (pattern.endsWith('*')) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}

/** 路径是否落在前缀内（`src` 与 `src/` 均可作前缀） */
function pathWithin(prefix: string, actual: string): boolean {
  if (actual === prefix) return true;
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return actual.startsWith(normalized);
}

/** host 匹配（精确或子域） */
function hostMatches(allowed: string, host: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * 范围覆盖判定（纯函数）——请求动作须落在授权范围内。
 *
 * 维度语义：**存在即限制**。某维度在 scope 内声明时，请求必须命中该维度；
 * 请求缺该维度信息（如限定路径但请求无路径）即**判不覆盖**（conservative，不放松）。
 */
export function scopeCovers(scope: MandateScope, request: MandateActionRequest): boolean {
  if (Array.isArray(scope.tools) && scope.tools.length > 0) {
    if (!scope.tools.some((p) => toolMatches(p, request.action))) return false;
  }
  if (Array.isArray(scope.pathPrefixes) && scope.pathPrefixes.length > 0) {
    const path = request.target?.path;
    if (typeof path !== 'string' || !scope.pathPrefixes.some((p) => pathWithin(p, path))) return false;
  }
  if (Array.isArray(scope.hosts) && scope.hosts.length > 0) {
    const host = request.target?.host;
    if (typeof host !== 'string' || !scope.hosts.some((h) => hostMatches(h, host))) return false;
  }
  return true;
}

/**
 * 越界判定（纯函数）——动作请求与所持授权集合比对。
 *
 * 判定次序（fail-fast）：无授权 → 三元素不全 → 逐条「未过期且范围覆盖」。
 * 一条都不覆盖时，若存在**过期**授权优先报 expired（时效为硬门），否则报 out-of-scope。
 *
 * @param grants 主体所持授权集合
 * @param request 动作请求
 * @param now 判定时刻
 * @returns MandateEvaluation
 */
export function evaluateCoverage(
  grants: readonly MandateGrant[],
  request: MandateActionRequest,
  now: Date,
): MandateEvaluation {
  const subjectGrants = grants.filter((g) => g.subject === request.subject);
  if (subjectGrants.length === 0) {
    return { verdict: 'no-mandate', covered: false, reason: `主体「${request.subject}」无任何授权` };
  }
  const wellFormed = subjectGrants.filter(hasAllThreeElements);
  if (wellFormed.length === 0) {
    return {
      verdict: 'invalid-grant',
      covered: false,
      reason: `主体「${request.subject}」的授权三元素不全（范围/时效/审批人缺一不受理）`,
      grantId: subjectGrants[0]?.id,
    };
  }
  let sawExpired = false;
  let sawOutOfScope = false;
  for (const grant of wellFormed) {
    if (isMandateExpired(grant, now)) {
      sawExpired = true;
      continue;
    }
    if (!scopeCovers(grant.scope, request)) {
      sawOutOfScope = true;
      continue;
    }
    return {
      verdict: 'covered',
      covered: true,
      reason: `授权「${grant.id}」覆盖该动作（审批人：${grant.approver}）`,
      grantId: grant.id,
      approver: grant.approver,
    };
  }
  if (sawExpired) {
    return {
      verdict: 'expired',
      covered: false,
      reason: `主体「${request.subject}」的授权已超时效（now=${now.toISOString()}）`,
    };
  }
  if (sawOutOfScope) {
    return {
      verdict: 'out-of-scope',
      covered: false,
      reason: `动作不在授权范围内：${request.subject} → ${request.action}`,
    };
  }
  return {
    verdict: 'no-mandate',
    covered: false,
    reason: `主体「${request.subject}」无可用授权`,
  };
}

/** 越界判定（读台账版）——loadMandateGrants → evaluateCoverage */
export function evaluateMandateRequest(
  request: MandateActionRequest,
  now: Date,
  dataDir?: string,
): MandateEvaluation {
  return evaluateCoverage(loadMandateGrants(dataDir), request, now);
}

// ════════════════════════════════════════
// 凭证面联动（留出对账接口——v1.5.4 Vault 就位后接入）
// ════════════════════════════════════════

/** 声明范围是否超出授权范围（逐维度子集判定）；不越权返回 null，越权返回原因 */
function scopeExceeds(declared: MandateScope, mandated: MandateScope): string | null {
  const dims: ReadonlyArray<'tools' | 'pathPrefixes' | 'hosts'> = ['tools', 'pathPrefixes', 'hosts'];
  for (const dim of dims) {
    const decl = declared[dim];
    if (!Array.isArray(decl) || decl.length === 0) continue;
    const mand = mandated[dim] ?? [];
    const extra = decl.filter((item) => !mand.includes(item));
    if (extra.length > 0) {
      return `维度 ${dim} 声明了授权未覆盖的项 [${extra.join(', ')}]`;
    }
  }
  return null;
}

/**
 * 凭证范围对账（纯函数）——授权下的凭证须与授权范围匹配。
 *
 * **本版只留对账接口**（无真实消费方——v1.5.4 第三章凭证隔离 Vault 就位后接入）：
 * 声明归属须为该授权、声明范围不得超出授权范围（逐维度子集）。
 *
 * @param mandate 授权记录
 * @param declaration 凭证范围声明（Vault 产出）
 */
export function reconcileCredentialScope(
  mandate: MandateGrant,
  declaration: CredentialScopeDeclaration,
): CredentialAlignment {
  if (!declaration || typeof declaration !== 'object') {
    return { aligned: false, reason: '凭证范围声明缺失' };
  }
  if (!hasApprover(declaration.issuedBy)) {
    return { aligned: false, reason: '凭证范围声明缺 issuedBy（产出方）' };
  }
  if (declaration.mandateId !== mandate.id) {
    return {
      aligned: false,
      reason: `凭证声明归属授权「${declaration.mandateId}」与授权「${mandate.id}」不符`,
    };
  }
  const over = scopeExceeds(declaration.scope ?? {}, mandate.scope ?? {});
  if (over) return { aligned: false, reason: `凭证范围超出授权范围：${over}` };
  return { aligned: true, reason: '凭证范围与授权范围一致（对账通过）' };
}
