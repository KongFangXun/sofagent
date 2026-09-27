// ============================================================
// vault/scope-declaration.ts · v1.5.4 章三 · 凭证范围声明产出
// ============================================================
//
// 定位：本模块是 Vault 的**证据面**——把「这条凭证是什么、属于谁、本任务申请了
// 什么范围」产出为一条**凭证范围声明**，挂既有审计链（decision-log / HMAC 链），
// **不另起日志文件**。
//
// 三件产出（对齐章三交付表）：
//   ① 本任务**申请范围**（requested）——任务/Agent 请求的能力边界；
//   ② **实际签发范围**（issued）——Vault 实际赋权的范围（= 凭证记录 scope）；
//   ③ **比对结果**（comparison）——申请 ⊇ 签发？签发超出申请即「非最小授权」。
//
// 与 ch7 对账的接线（生产 → 消费）：
//   本模块产出的 `CredentialScopeDeclaration`（mandateId + 实际签发范围 + 产出方 +
//   产出时刻 + 可选时效）**正是**章七台账级对账（`mandate-credential-reconcile.ts`
//   的 `reconcileCredentialLedger`）的消费输入。`declareAndReconcile` 完成
//   「产出声明 → 交章七对账 → 结论入 decision-log 挂链」的端到端动作——故本模块
//   即章七对账在**生产路径上的实际调用点**（非仅导出）。
//
// 🔴 落盘零改动：本模块**只读取用** CredentialVault 的数据面事实（describe），
//   不写 Vault 落盘结构；对账亦只读授权台账（章七模块内保证）。
//
// 🔴 界面开关不参与：是否对账由调用方经既有 options 面传入（对账面默认关 L1），
//   本模块不读任何 UI / 配置开关推导判定。
// ============================================================

import {
  reconcileCredentialLedger,
  type CredentialScopeDeclaration,
  type MandateScope,
  type ReconcileOptions,
  type ReconcileReport,
} from '@sofagent/audit';
import { CredentialVault } from './credential-vault';

/** 范围比对维度 */
export type ScopeDim = 'tools' | 'pathPrefixes' | 'hosts';

/** 申请范围 vs 实际签发范围的比对结果 */
export interface ScopeComparison {
  /** 是否一致（实际签发范围 ⊆ 申请范围 = 最小授权；签发超出申请即不一致） */
  consistent: boolean;
  /** 不一致时的超发明细（签发有、申请无的项——逐维度） */
  overIssued: { dim: ScopeDim; items: string[] }[];
  /** 人类可读理由 */
  reason: string;
}

/** 产出范围声明的入参 */
export interface ScopeDeclarationInput {
  /** 本任务申请范围（任务请求的能力边界） */
  requested: MandateScope;
  /** 声明产出方覆盖（缺省取凭证记录的 issuedBy） */
  issuedBy?: string;
  /** 声明产出时刻覆盖（ISO 8601；缺省取凭证记录的 issuedAt） */
  issuedAt?: string;
}

/** 一次范围声明的产出结果 */
export interface ScopeDeclarationResult {
  /** 供 ch7 对账的凭证范围声明（挂 audit 侧 reconcileCredentialScope） */
  declaration: CredentialScopeDeclaration;
  /** 本任务申请范围 */
  requested: MandateScope;
  /** 实际签发范围（= 凭证记录 scope） */
  issued: MandateScope;
  /** 比对结果（申请 vs 签发——是否最小授权） */
  comparison: ScopeComparison;
}

/** 深拷贝 scope（防调用方改内部记录） */
function cloneScope(scope: MandateScope | undefined): MandateScope {
  const out: MandateScope = {};
  if (scope && Array.isArray(scope.tools)) out.tools = [...scope.tools];
  if (scope && Array.isArray(scope.pathPrefixes)) out.pathPrefixes = [...scope.pathPrefixes];
  if (scope && Array.isArray(scope.hosts)) out.hosts = [...scope.hosts];
  return out;
}

/**
 * 比对申请范围与实际签发范围（纯函数）。
 *
 * 判据：**实际签发范围 ⊆ 申请范围** = 最小授权（consistent）。
 * 某维度「签发有、申请无」的项即超发——非最小授权（consistent=false）。
 * 签发范围比申请更窄（收窄）**不算**不一致（保守方向，不构成越权）。
 */
export function compareRequestedIssued(
  requested: MandateScope | undefined,
  issued: MandateScope | undefined,
): ScopeComparison {
  const req = requested ?? {};
  const iss = issued ?? {};
  const dims: readonly ScopeDim[] = ['tools', 'pathPrefixes', 'hosts'];
  const overIssued: { dim: ScopeDim; items: string[] }[] = [];
  for (const dim of dims) {
    const issuedItems = iss[dim];
    if (!Array.isArray(issuedItems) || issuedItems.length === 0) continue;
    const requestedItems = req[dim] ?? [];
    const extra = issuedItems.filter((item) => !requestedItems.includes(item));
    if (extra.length > 0) overIssued.push({ dim, items: extra });
  }
  if (overIssued.length > 0) {
    const detail = overIssued.map((o) => `${o.dim}:[${o.items.join(', ')}]`).join('；');
    return {
      consistent: false,
      overIssued,
      reason: `实际签发范围超出申请范围（非最小授权）：${detail}`,
    };
  }
  return {
    consistent: true,
    overIssued: [],
    reason: '实际签发范围未超出申请范围（最小授权）',
  };
}

/**
 * 从 Vault 中已登记的凭证产出**凭证范围声明**（证据面产出）。
 *
 * @param vault 凭证 Vault
 * @param idOrVirtualKey 凭证 id 或虚拟 key
 * @param input 申请范围 + 产出方/时刻覆盖
 * @returns 声明结果（含 declaration / requested / issued / comparison）；凭证未登记返回 undefined
 */
export function produceScopeDeclaration(
  vault: CredentialVault,
  idOrVirtualKey: string,
  input: ScopeDeclarationInput,
): ScopeDeclarationResult | undefined {
  const view = vault.describe(idOrVirtualKey);
  if (!view) return undefined;
  const issued = cloneScope(view.scope);
  const requested = cloneScope(input.requested);
  const comparison = compareRequestedIssued(requested, issued);
  const declaration: CredentialScopeDeclaration = {
    mandateId: view.mandateId,
    scope: issued,
    issuedBy: input.issuedBy ?? view.issuedBy,
    issuedAt: input.issuedAt ?? view.issuedAt,
    ...(view.validity !== undefined ? { validity: { ...view.validity } } : {}),
  };
  return { declaration, requested, issued, comparison };
}

/** 一次「产出声明 + 交章七对账」的端到端结果 */
export interface DeclareAndReconcileResult {
  /** 范围声明产出结果 */
  result: ScopeDeclarationResult;
  /** 章七台账级对账报告（对账面关档时 enabled=false 且零记录） */
  report: ReconcileReport;
}

/**
 * 产出凭证范围声明并交章七台账级对账（**生产路径的实际调用点**）。
 *
 * 这是章三「凭证范围声明挂既有审计链」的落地面：声明产出后即交章七
 * `reconcileCredentialLedger`（经 `@sofagent/audit`）——对账结论写 decision-log
 * 挂 HMAC 链（kind=CREDENTIAL_RECONCILE）。对账面默认关（L1）：关档时零判定、
 * 零记录，声明仍产出（数据面事实），行为与今日一致、不留半开状态。
 *
 * @param vault 凭证 Vault
 * @param idOrVirtualKey 凭证 id 或虚拟 key
 * @param input 申请范围 + 产出方/时刻覆盖
 * @param reconcile 对账开关 / 数据目录 / 留痕归属（enabled 由宿主经既有配置面传入）
 * @returns 声明产出结果 + 对账报告；凭证未登记返回 undefined
 */
export function declareAndReconcile(
  vault: CredentialVault,
  idOrVirtualKey: string,
  input: ScopeDeclarationInput,
  reconcile: ReconcileOptions = {},
): DeclareAndReconcileResult | undefined {
  const result = produceScopeDeclaration(vault, idOrVirtualKey, input);
  if (!result) return undefined;
  // ch7 对账在**生产路径**上的实际调用（跨包接缝：orchestrator → @sofagent/audit）
  const report = reconcileCredentialLedger([result.declaration], reconcile);
  return { result, report };
}
