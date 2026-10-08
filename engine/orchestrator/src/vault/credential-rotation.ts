// ============================================================
// vault/credential-rotation.ts · v1.5.7 章三 · 凭证轮换与吊销（泄露响应）
// ============================================================
//
// 定位：Vault 的生命周期面——**定时 / 事件触发轮换** + **单凭证吊销（泄露响应）**。
//
// 与 credential-vault.ts 的分工：
//   - credential-vault.ts 持数据面事实（凭证记录 + 注入器）；
//   - 本模块是**调度判定**（谁该轮换 / 泄露时吊销谁）——判定只读数据面
//     （`isActive` / `rotatedAt` / `issuedAt`），**不读任何界面开关**（设计约束 1）。
//
// 轮换语义：新 secret 由宿主经 `newSecretOf` 回调产出（本模块**不生成 / 不接触**真实
//   凭证——凭证来源在宿主，对齐「接口在本仓、实现在外」）。轮换只改 secret + 打
//   rotatedAt 时间戳，其余数据面字段（身份 / 范围 / 时效）不变。
//
// 泄露响应：`reportLeak` 立即吊销（数据面 status→revoked，此后注入器不再注入），
//   并返回可举证的处理留痕（谁在何时吊销了哪条凭证）。
// ============================================================

import { CredentialVault, type CredentialView } from './credential-vault';

/** 轮换策略 */
export interface RotationPolicy {
  /** 凭证最大存活时长（ms）——`rotatedAt ?? issuedAt` 距 now 超过即到期 */
  maxAgeMs: number;
  /** 定时轮换间隔（ms）——宿主调度语义声明（本模块不启动定时器，只做判定） */
  intervalMs?: number;
}

/** 轮换器依赖 */
export interface CredentialRotatorDeps {
  /** 轮换策略 */
  policy: RotationPolicy;
  /** 时钟（测试确定性） */
  now?: () => Date;
}

/** 批量轮换结果 */
export interface RotationOutcome {
  /** 已轮换的凭证 id */
  rotated: string[];
  /** 因无法产出新 secret 而跳过的凭证 id */
  skipped: string[];
}

/** 泄露处置留痕（可举证——谁在何时吊销了哪条凭证） */
export interface LeakResponseRecord {
  /** 是否命中并吊销 */
  revoked: boolean;
  credentialId: string;
  mandateId?: string;
  /** 处置时刻（ISO 8601） */
  ts: string;
  /** 处置理由 */
  reason: string;
}

/**
 * 凭证轮换 / 吊销器（调度判定面）。
 */
export class CredentialRotator {
  private readonly vault: CredentialVault;
  private readonly policy: RotationPolicy;
  private readonly now: () => Date;

  constructor(vault: CredentialVault, deps: CredentialRotatorDeps) {
    if (!deps.policy || typeof deps.policy.maxAgeMs !== 'number' || deps.policy.maxAgeMs <= 0) {
      throw new Error('[credential-rotation] policy.maxAgeMs 必填且为正数');
    }
    this.vault = vault;
    this.policy = deps.policy;
    this.now = deps.now ?? (() => new Date());
  }

  /** 距上次轮换（未轮换则自签发）的存活时长（ms）；无有效时间戳返回 Infinity（保守判到期） */
  private ageMs(view: CredentialView, now: Date): number {
    const base = view.rotatedAt ?? view.issuedAt;
    const t = Date.parse(base);
    if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
    return now.getTime() - t;
  }

  /**
   * 列出当前到期的凭证（active 且存活时长 ≥ maxAgeMs）。
   *
   * 只读数据面事实（status / rotatedAt / issuedAt）——不读界面开关。
   */
  dueForRotation(at?: Date): CredentialView[] {
    const now = at ?? this.now();
    return this.vault
      .list()
      .filter((v) => v.status === 'active' && this.ageMs(v, now) >= this.policy.maxAgeMs);
  }

  /**
   * 轮换单条凭证（事件触发）。
   * @returns 轮换后的脱敏视图（未命中返回 undefined）
   */
  rotateOne(idOrVirtualKey: string, newSecret: string): CredentialView | undefined {
    return this.vault.rotate(idOrVirtualKey, newSecret);
  }

  /**
   * 轮换全部到期凭证（定时触发）。
   *
   * @param newSecretOf 由宿主产出新 secret 的回调；返回空/抛错 ⇒ 该条跳过（不静默轮换成空值）
   */
  rotateDue(newSecretOf: (view: CredentialView) => string, at?: Date): RotationOutcome {
    const due = this.dueForRotation(at);
    const rotated: string[] = [];
    const skipped: string[] = [];
    for (const view of due) {
      let next: string;
      try {
        next = newSecretOf(view);
      } catch {
        skipped.push(view.id);
        continue;
      }
      if (typeof next !== 'string' || next === '') {
        skipped.push(view.id);
        continue;
      }
      this.vault.rotate(view.id, next);
      rotated.push(view.id);
    }
    return { rotated, skipped };
  }

  /**
   * 泄露响应——立即吊销凭证并返回可举证的处置留痕。
   *
   * 命中即吊销（数据面 status→revoked）；未命中返回 revoked=false 的留痕（不抛，
   * 防泄露响应路径被异常打断）。
   */
  reportLeak(idOrVirtualKey: string, reason = '凭证泄露响应'): LeakResponseRecord {
    const view = this.vault.describe(idOrVirtualKey);
    const revoked = this.vault.revoke(idOrVirtualKey);
    const ts = this.now().toISOString();
    return {
      revoked,
      credentialId: view?.id ?? idOrVirtualKey,
      ...(view?.mandateId !== undefined ? { mandateId: view.mandateId } : {}),
      ts,
      reason: revoked ? reason : `${reason}（未命中凭证——无操作）`,
    };
  }

  /** 当前策略（只读） */
  policyOf(): RotationPolicy {
    return { ...this.policy };
  }
}

/** 便捷工厂 */
export function createCredentialRotator(
  vault: CredentialVault,
  deps: CredentialRotatorDeps,
): CredentialRotator {
  return new CredentialRotator(vault, deps);
}
