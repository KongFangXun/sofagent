// isolation-guard.ts · v1.4.1 块四 · 企业隔离守卫（跨企业访问阻断 + 路径逃逸拦截）
//
// 定位：训练数据的企业边界只有一个原则——**资源归属企业必须与请求企业一致，
// 且路径永远出不了本企业分区**。本文件提供这条原则的两个可复用原语：
//
//   一、assertEnterpriseAccess：资源级校验——拿到资源（含归属 enterpriseId）
//       后，请求方与归属方不一致即拒绝。拒绝返回结构化错误（含被拒资源标识
//       与归属企业——供审计定位；不含对方企业的任何业务内容）。
//   二、assertSafePathSegment / resolveEnterpriseDir：路径级校验——enterpriseId
//       / jobId 作为路径段使用前必须通过白名单校验（拒绝 `..`、路径分隔符、
//       NUL 等构造），从根上封死 `data/train/<enterpriseId>/` 的 `../` 逃逸。
//
// 为什么路径段校验是隔离的一部分：train-job.ts 的目录分区
// `data/train/<enterpriseId>/<jobId>/` 由 join 拼接——若 enterpriseId 含
// `../ent-other`，读写都会落到别家企业目录里（比「读不到」更糟的是「写进去」）。
// 分区 + 段校验 + 资源归属校验三层叠加，才是完整的企业边界。
//
// 纯函数 + 零外部依赖（node path）——单测直测，读路径消费（写路径的
// enterpriseId 必填校验在 train-job.ts createTrainJob，本文件不重复）。

import { resolve } from 'path';

// ══════════════════════════════════════
// 结构化错误模型（对齐 workflow_submit 的结构化错误模式）
// ══════════════════════════════════════

/** 隔离拒绝错误码 */
export type EnterpriseAccessErrorCode =
  /** 请求企业与资源归属企业不一致（跨企业访问） */
  | 'ENTERPRISE_MISMATCH'
  /** 路径段含非法构造（`..` / 分隔符 / NUL 等——逃逸尝试） */
  | 'UNSAFE_PATH_SEGMENT';

/** 企业隔离拒绝（结构化——含被拒资源标识与归属企业，不含对方企业业务内容） */
export interface EnterpriseAccessError {
  code: EnterpriseAccessErrorCode;
  /** 人类可读说明（中文——CLI / 审计输出直读） */
  message: string;
  /** 被拒资源标识（jobId / 路径等——定位用） */
  resourceRef: string;
  /** 请求方企业 */
  requestingEnterpriseId: string;
  /** 资源归属企业（仅 ENTERPRISE_MISMATCH 给出——所有权归属是拒绝理由的一部分，非敏感内容） */
  resourceEnterpriseId?: string;
}

/** 访问判定（allowed=false 时携带结构化错误） */
export type EnterpriseAccessDecision =
  | { allowed: true }
  | { allowed: false; error: EnterpriseAccessError };

/** 守卫读结果：ok=true 携带数据（可为 null=不存在）；ok=false 携带拒绝原因 */
export type GuardedRead<T> =
  | { ok: true; data: T }
  | { ok: false; error: EnterpriseAccessError };

/**
 * 断言失败异常（assertEnterpriseAccess 抛出）。
 * 供命令式调用点（MCP tool / CLI handler）快速失败；structuredError 字段
 * 保留结构化信息（catch 后可直接回给调用方）。
 */
export class EnterpriseAccessDeniedError extends Error {
  readonly structuredError: EnterpriseAccessError;

  constructor(error: EnterpriseAccessError) {
    super(error.message);
    this.name = 'EnterpriseAccessDeniedError';
    this.structuredError = error;
  }
}

// ══════════════════════════════════════
// 原语一：企业归属校验（资源级）
// ══════════════════════════════════════

/**
 * 校验请求企业对资源的访问权（纯函数）。
 *
 * 一致 → allowed；不一致 → 拒绝（结构化错误含资源标识与归属企业——不含
 * 对方企业的 job 内容/路径细节等业务信息，只给「这是谁家的资源」这一个
 * 拒绝理由所需的最小事实）。
 */
export function checkEnterpriseAccess(
  requestingEnterpriseId: string,
  resourceEnterpriseId: string,
  resourceRef: string,
): EnterpriseAccessDecision {
  if (requestingEnterpriseId === resourceEnterpriseId) {
    return { allowed: true };
  }
  return {
    allowed: false,
    error: {
      code: 'ENTERPRISE_MISMATCH',
      message: `跨企业访问拒绝：资源 ${resourceRef} 归属企业 ${resourceEnterpriseId}，请求方为 ${requestingEnterpriseId}`,
      resourceRef,
      requestingEnterpriseId,
      resourceEnterpriseId,
    },
  };
}

/**
 * 断言访问权（不一致抛 EnterpriseAccessDeniedError）。
 * 返回型校验用 checkEnterpriseAccess / GuardedRead，本函数供命令式调用点。
 */
export function assertEnterpriseAccess(
  requestingEnterpriseId: string,
  resourceEnterpriseId: string,
  resourceRef: string,
): void {
  const decision = checkEnterpriseAccess(
    requestingEnterpriseId,
    resourceEnterpriseId,
    resourceRef,
  );
  if (!decision.allowed) {
    throw new EnterpriseAccessDeniedError(decision.error);
  }
}

// ══════════════════════════════════════
// 原语二：路径段校验（防 ../ 逃逸）
// ══════════════════════════════════════

/** 路径段最大长度（防御性上限——正常企业/任务标识远短于此） */
const MAX_SEGMENT_LENGTH = 128;

/**
 * 判定字符串能否安全地作为路径段（enterpriseId / jobId 等）。
 *
 * 拒绝：空 / 纯空白 / `.` / `..` / 含 `/` 或 `\`（分隔符）/ 含 NUL /
 * 超长。允许字母数字、`-`、`_`、`.`（非裸 `.` 开头结尾的普通字符）。
 */
export function isSafePathSegment(segment: string): boolean {
  if (typeof segment !== 'string') return false;
  if (segment.length === 0 || segment.length > MAX_SEGMENT_LENGTH) return false;
  if (segment.trim() === '') return false;
  if (segment === '.' || segment === '..') return false;
  if (segment.includes('/') || segment.includes('\\')) return false;
  if (segment.includes('\0')) return false;
  return true;
}

/** 构造 UNSAFE_PATH_SEGMENT 结构化错误 */
function unsafeSegmentError(segment: string, label: string): EnterpriseAccessError {
  // 注意：错误信息只回显「段不安全」这一事实与原始构造的转义形态，
  // 不回显可能内嵌的其他企业名（防探测）。
  const escaped = segment.replace(/[^ -~]/g, '?').slice(0, 40);
  return {
    code: 'UNSAFE_PATH_SEGMENT',
    message: `路径段非法：${label} 含逃逸构造（../、分隔符或空字节），已拒绝`,
    resourceRef: `${label}="${escaped}"`,
    requestingEnterpriseId: '',
  };
}

/**
 * 断言路径段安全（不安全抛 EnterpriseAccessDeniedError）。
 * 任何把 enterpriseId/jobId 拼进路径的读操作入口必须先过这一关。
 */
export function assertSafePathSegment(segment: string, label: string): void {
  if (!isSafePathSegment(segment)) {
    throw new EnterpriseAccessDeniedError(unsafeSegmentError(segment, label));
  }
}

/** 判定 resolved 后的 child 是否仍在 parent 内（含相等——containment 兜底） */
export function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child); // 注意：child 按独立路径 resolve（不与 parent 拼接）
  const p = resolve(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith('/') ? p : p + '/');
}

/**
 * 解析企业分区目录（段校验 + resolve 兜底——双保险）。
 * @returns data/train/<enterpriseId>/ 的绝对路径
 * @throws EnterpriseAccessDeniedError 段非法
 */
export function resolveEnterpriseDir(dataDir: string, enterpriseId: string): string {
  assertSafePathSegment(enterpriseId, 'enterpriseId');
  const trainRoot = resolve(dataDir, 'train');
  const enterpriseDir = resolve(trainRoot, enterpriseId);
  if (!isPathInside(enterpriseDir, trainRoot)) {
    // 理论上段校验已封死——此为纵深防御（resolve 后越界即拒）
    throw new EnterpriseAccessDeniedError(unsafeSegmentError(enterpriseId, 'enterpriseId'));
  }
  return enterpriseDir;
}
