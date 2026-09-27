// ============================================================
// mandate-credential-reconcile.ts · v1.5.4 章七 · 授权面与凭证面对账
// ============================================================
//
// 背景：授权记录（mandate 台账）只说「批了什么」、凭证记录（Vault 范围声明）只说
// 「发了什么」——**单看任一侧都自洽**。风险恰恰在两侧之间的**缝**：批了一件小事却
// 发下大范围凭证，两张表分开看都「合法」。本模块把这条缝变成一条**可判定命题**：
// 台账级交叉核验 + 三类错位判定 + 结论挂 HMAC 链留痕。
//
// 🔴 存量承接（本版增量边界）：
//   「凭证范围 ⊄ 授权范围」这一类判定**已在位**——`mandate-store.ts` 的
//   `reconcileCredentialScope(mandate, declaration)`（逐维度子集 + 归属一致性 +
//   缺失/无产出方拒收）。本模块**复用**该纯函数做单条范围判定，**不重写、不改其
//   既有三条断言语义**。本版真实增量 = 三类错位中的两类**台账级**判定：
//     ① 无对应授权记录（跨记录查无此条——台账级，既有纯函数吃单条 mandate 无此语义）
//     ② 凭证时效 > 授权时效（既有纯函数无时效维度，声明接口已同批补可选 validity）
//   + 结论落 decision-log 挂链（kind=CREDENTIAL_RECONCILE）+ 对账面开关（默认关 L1）。
//
// 🔴 两侧记录**只读取用**：对账**不改** mandate 与 Vault 的落盘 schema（读授权台账
//   `loadMandateGrants` + 收下调用方传入的凭证声明），错位不回头改任一侧台账。
//
// 留痕形态照章五 egress-audit / v1.5.3 mandate-gate：走 emitDecision（同一
//   decision-log HMAC 链），**不另立日志文件**。kind=CREDENTIAL_RECONCILE（v1.5.4
//   章七新增的唯一 DecisionKind 成员）。
//
// 可拔契约（L1）：对账面**默认关**——`enabled=false` 时本模块**零判定、零记录**
//   直接返回空报告（两侧行为与今日一致，不留半开状态）。开关由宿主经既有 options
//   面传入（对齐 mandate-gate 的 `enabled` 契约），**不新增独立开关入口**。
//
// ⚠️ emitDecision 会写真实数据目录——测试必须传临时 dataDir。
// ============================================================

import { emitDecision } from './decision-log';
import {
  loadMandateGrants,
  reconcileCredentialScope,
  type CredentialScopeDeclaration,
  type MandateGrant,
  type MandateValidity,
} from './mandate-store';

// ============================================================
// 类型
// ============================================================

/** 对账错位三类（每类均判为越权风险） */
export type ReconcileMismatchKind =
  /** 凭证声明归属的授权在台账中查无此条（台账级跨记录缺失） */
  | 'no-mandate-record'
  /** 凭证时效 > 授权时效（凭证存活窗口超出授权窗口） */
  | 'validity-outlives'
  /** 凭证范围 ⊄ 授权范围（逐维度子集越界——复用既有纯函数判定） */
  | 'scope-exceeds';

/** 对账结论两态 */
export type ReconcileVerdict = 'aligned' | 'mismatch';

/** 一条凭证声明的对账结论 */
export interface ReconcileFinding {
  /** 凭证声明归属授权 id（跨记录关联键） */
  mandateId: string;
  /** 凭证产出方 */
  issuedBy: string;
  /** 结论态 */
  verdict: ReconcileVerdict;
  /** 错位分类（verdict='mismatch' 时） */
  mismatch?: ReconcileMismatchKind;
  /** 人类可读理由 */
  reason: string;
}

/** 对账入参 */
export interface ReconcileOptions {
  /**
   * 对账面开关（可拔契约 · L1）。**默认 false**——关档时零判定、零记录，
   * 直接返回 `{ enabled: false, findings: [], mismatches: 0 }`（不留半开状态）。
   * 由宿主经既有配置面传入，不新增独立开关入口。
   */
  enabled?: boolean;
  /** 数据目录（读授权台账 + 写 decision-log；缺省走全局解析链） */
  dataDir?: string;
  /** 留痕归属 Agent（缺省 'sofagent-audit'） */
  agentId?: string;
  /** 留痕会话标识（缺省 'credential-reconcile'） */
  sessionId?: string;
}

/** 一次台账级对账的报告 */
export interface ReconcileReport {
  /** 是否启用（关闭时为 false 且 findings 空） */
  enabled: boolean;
  /** 逐条结论（与入参声明一一对应、同序） */
  findings: ReconcileFinding[];
  /** 错位条数（越权风险计数） */
  mismatches: number;
}

// ============================================================
// 时效维度（台账级——既有纯函数无此项）
// ============================================================

/**
 * 凭证时效是否超出授权时效（纯函数）。
 *
 * 判据：凭证生效时刻早于授权生效时刻（validFrom 更早）**或**凭证失效时刻晚于授权
 * 失效时刻（validTo 更晚；`undefined` = 永久）⇒ 超期。
 *
 * 缺任一侧时效（声明可选字段缺省 / 授权无有效时间戳）⇒ 不判（返回 null，向后兼容
 * ——缺时效维度即不产生时效类错位）。
 *
 * 🔴 v1.5.4 P2 口径修正——**非法日期不得与「无值」同判**：
 *   「无值」（`declared` / `mandated` 整体缺失，或 `validTo` 为 `undefined` = 永久）
 *   与「有值但不可解析」（如 `validFrom: 'n/a'`）是**两回事**。原实现把二者的
 *   `Date.parse` 结果一并当 `NaN` 后 `return null`，等于把「非法日期」静默按
 *   「不判时效」放行——凭证可携一条坏日期绕过时效维度对账。现口径：
 *   只要该侧**有值却不可解析** ⇒ 返回 mismatch 理由（判 `validity-outlives`），
 *   不再静默放行。若调用方要「可见告警」，理由串即告警文本（结论进 decision-log）。
 *
 * @returns 超期/非法日期的 mismatch 理由；无时效维度或不超期返回 null
 */
function validityOutlives(
  declared: MandateValidity | undefined,
  mandated: MandateValidity | undefined,
): string | null {
  // 无值 = 缺时效维度（不判，向后兼容）；有值却不可解析 = 非法日期（判 mismatch）
  if (!declared || !mandated) return null;
  const credFrom = Date.parse(declared.validFrom);
  const mandFrom = Date.parse(mandated.validFrom);
  if (Number.isNaN(credFrom) || Number.isNaN(mandFrom)) {
    return `时效字段含不可解析日期（凭证 validFrom=${String(declared.validFrom)} / 授权 validFrom=${String(mandated.validFrom)}）——非法日期不视为「无时效」，按错位判定`;
  }
  if (credFrom < mandFrom) {
    return `凭证生效时刻（${declared.validFrom}）早于授权生效时刻（${mandated.validFrom}）`;
  }
  const credTo = declared.validTo !== undefined ? Date.parse(declared.validTo) : Number.POSITIVE_INFINITY;
  const mandTo = mandated.validTo !== undefined ? Date.parse(mandated.validTo) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(credTo) || Number.isNaN(mandTo)) {
    return `时效字段含不可解析日期（凭证 validTo=${String(declared.validTo)} / 授权 validTo=${String(mandated.validTo)}）——非法日期不视为「永久」，按错位判定`;
  }
  if (credTo > mandTo) {
    return `凭证失效时刻（${declared.validTo ?? '永久'}）晚于授权失效时刻（${mandated.validTo ?? '永久'}）`;
  }
  return null;
}

// ============================================================
// 单条对账（纯判定，不落盘）
// ============================================================

/**
 * 单条凭证声明的台账级对账判定（纯函数——不读盘、不落盘）。
 *
 * 判定次序：① 无对应授权记录 → ② 凭证时效 > 授权时效 → ③ 凭证范围 ⊄ 授权范围
 * （③ 复用 `reconcileCredentialScope` 纯函数，不重写）。
 *
 * @param declaration 凭证范围声明（Vault 产出）
 * @param mandates 授权台账投影（只读）
 * @returns ReconcileFinding（三类错位之一或 aligned）
 */
export function evaluateCredentialReconcile(
  declaration: CredentialScopeDeclaration,
  mandates: readonly MandateGrant[],
): ReconcileFinding {
  const mandateId = typeof declaration?.mandateId === 'string' ? declaration.mandateId : '';
  const issuedBy = typeof declaration?.issuedBy === 'string' ? declaration.issuedBy : '';

  // ── ① 无对应授权记录（台账级跨记录查找——既有纯函数吃单条 mandate 无此语义）──
  const mandate = mandates.find((m) => m.id === mandateId);
  if (!mandate) {
    return {
      mandateId,
      issuedBy,
      verdict: 'mismatch',
      mismatch: 'no-mandate-record',
      reason: `凭证声明归属授权「${mandateId}」在授权台账中查无此条（无对应授权记录）`,
    };
  }

  // ── ② 凭证时效 > 授权时效（台账级——既有纯函数无时效维度）──
  const outlives = validityOutlives(declaration.validity, mandate.validity);
  if (outlives) {
    return {
      mandateId,
      issuedBy,
      verdict: 'mismatch',
      mismatch: 'validity-outlives',
      reason: `凭证时效超出授权时效：${outlives}`,
    };
  }

  // ── ③ 凭证范围 ⊄ 授权范围（复用既有纯函数——不重写、不改其断言语义）──
  const alignment = reconcileCredentialScope(mandate, declaration);
  if (!alignment.aligned) {
    return {
      mandateId,
      issuedBy,
      verdict: 'mismatch',
      mismatch: 'scope-exceeds',
      reason: `凭证范围与授权范围错位：${alignment.reason}`,
    };
  }

  return {
    mandateId,
    issuedBy,
    verdict: 'aligned',
    reason: '凭证范围与授权范围一致（对账通过）',
  };
}

// ============================================================
// 台账级对账（读授权台账 → 逐条判定 → 结论进 decision-log）
// ============================================================

/**
 * 台账级对账（授权记录台账 × 凭证签发记录交叉判定）。
 *
 * 关档（enabled=false，默认）：**不读台账、零判定、零记录**，返回空报告。
 * 开档：读授权台账（**只读取用**）→ 逐条声明跑 {@link evaluateCredentialReconcile}
 * → 每条结论经 emitDecision 落 decision-log 挂 HMAC 链（kind=CREDENTIAL_RECONCILE，
 * 一致与错位两态均留痕——「对账结论另立记录并挂链」）。
 *
 * @param declarations 凭证范围声明集合（Vault 产出——**只读收下，不改其源**）
 * @param options 对账开关 / 数据目录 / 留痕归属
 */
export function reconcileCredentialLedger(
  declarations: readonly CredentialScopeDeclaration[],
  options: ReconcileOptions = {},
): ReconcileReport {
  // ── 可拔契约（L1）：关档直通——零判定、零记录、行为与今日一致 ──
  if (options.enabled !== true) {
    return { enabled: false, findings: [], mismatches: 0 };
  }

  // 两侧记录只读取用：读授权台账（不改），收下传入的凭证声明（不改）
  const mandates = loadMandateGrants(options.dataDir);
  const findings: ReconcileFinding[] = [];
  let mismatches = 0;

  for (const declaration of declarations) {
    const finding = evaluateCredentialReconcile(declaration, mandates);
    findings.push(finding);
    if (finding.verdict === 'mismatch') mismatches += 1;
    recordReconcile(finding, options);
  }

  return { enabled: true, findings, mismatches };
}

/**
 * 对账结论挂链（decision-log HMAC 链——不另立日志文件）。
 *
 * 一致与错位两态均留痕：错位为越权风险（可举证「谁在何时用哪个授权发了哪个范围
 * 凭证」），一致为对账通过（对账覆盖率可观测）。
 *
 * 留痕失败**不阻断**对账主流程（返回报告中的结论已得出）——但降级必须可见
 * （emitDecision 失败即抛，故此处是唯一可观测点，降级走一行 warn 不静默吞）。
 */
function recordReconcile(finding: ReconcileFinding, options: ReconcileOptions): void {
  const mismatch = finding.verdict === 'mismatch';
  try {
    const evidence: string[] = [
      `mandateId=${finding.mandateId}`,
      `issuedBy=${finding.issuedBy}`,
      `verdict=${finding.verdict}`,
    ];
    if (finding.mismatch !== undefined) evidence.push(`mismatch=${finding.mismatch}`);
    emitDecision(
      {
        agentId: options.agentId ?? 'sofagent-audit',
        sessionId: options.sessionId ?? 'credential-reconcile',
        kind: 'CREDENTIAL_RECONCILE',
        moment: 'ATTRIBUTION',
        why: {
          text: mismatch
            ? `凭证对账错位（${finding.mismatch}）：授权「${finding.mandateId}」——${finding.reason}`
            : `凭证对账通过：授权「${finding.mandateId}」——${finding.reason}`,
          tags: ['credential-reconcile', finding.verdict, ...(finding.mismatch ? [finding.mismatch] : [])],
          confidence: 'high',
        },
        artifactRef: `mandate/${finding.mandateId}`,
        evidence,
      },
      options.dataDir,
    );
  } catch (err) {
    console.warn(
      `  ⚠️ 凭证对账结论留痕失败（结论已得出，但该结论未进审计链）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
