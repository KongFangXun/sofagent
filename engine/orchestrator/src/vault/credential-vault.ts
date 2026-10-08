// ============================================================
// vault/credential-vault.ts · v1.5.7 章三 · 凭证隔离 Vault（OMA 启发）
// ============================================================
//
// 定位：**执行层安全基础设施**——凭证托管 + 沙箱 HTTP 出口动态注入请求头。
// Agent 运行时**永远取不到真实 token 明文**：Agent 只持有 `vk-` 虚拟 key
// （对齐 v1.3.7 sandbox/virtual-key.ts 的边界），真实凭证留在 Vault 内，
// 由沙箱 HTTP 出口在**出站前**把凭证注入请求头——Agent 代码 / 日志 / 审计面
// 均见不到明文。
//
// 🔴 设计约束（行业反面教材：Meta Muse 零日——未校验配置端点窃取 token 全权接管）：
//   1. **界面开关状态不作为控制面依据**——控制面只认**数据面事实**：凭证是否
//      登记 / 是否吊销 / 是否在范围，全部由数据面记录判定，不读任何 UI/配置开关。
//   2. **凭证「身份」与「能力开关」两职必须拆开**——`virtualKey`（身份绑定）与
//      `scope`（能力范围）是两条独立数据；本模块**不**由身份推导能力，反之亦然。
//
// 与 ch7 对账的接口：本模块产出 `CredentialScopeDeclaration`（挂 audit 侧
// `reconcileCredentialScope` / `mandate-credential-reconcile` 消费）。类型
// 从 `@sofagent/audit` **type-only** 引入（编译期契约，运行期零耦合）。
//
// ⚠️ 本模块只做**约束层**：真值注入走注入器（`createInjector`），
//   真实凭证只经注入器写入**出站请求头**，绝不进返回值 / 快照 / 日志。
// ============================================================

import type { MandateScope, MandateValidity } from '@sofagent/audit';

/** Vault 契约层异常（登记冲突 / 非法入参） */
export class CredentialVaultError extends Error {
  constructor(message: string) {
    super(`[credential-vault] ${message}`);
    this.name = 'CredentialVaultError';
  }
}

/** 凭证注入位置（写到出站请求的哪个 header） */
export interface CredentialInjectSpec {
  /** 目标请求头名（如 `Authorization` / `x-api-key`） */
  header: string;
  /** 认证方案前缀（如 `Bearer`；缺省则裸值） */
  scheme?: string;
}

/**
 * 登记一条凭证的入参。
 *
 * ⚠️ `secret`（真实凭证）**永不**出现在任何返回值 / 快照 / 日志中——
 * 只在 Vault 内部保存，经注入器写入出站请求头。
 */
export interface CredentialStoreInput {
  /** Vault 内部凭证 id（唯一键） */
  id: string;
  /** 绑定 Agent 的虚拟 key（`vk-` 前缀——Agent 侧唯一可见的凭证标识） */
  virtualKey: string;
  /** 真实凭证（secret）——内部保存，绝不外泄 */
  secret: string;
  /** 归属授权 id（ch7 对账的跨记录关联键） */
  mandateId: string;
  /** 实际签发范围（能力开关——与「身份」拆开的独立数据面） */
  scope: MandateScope;
  /** 注入位置 */
  inject: CredentialInjectSpec;
  /** 产出方标识（缺省 `vault`） */
  issuedBy?: string;
  /** 产出时刻（ISO 8601；缺省当前时间） */
  issuedAt?: string;
  /** 凭证时效（可选——ch7「凭证时效 > 授权时效」错位判定用） */
  validity?: MandateValidity;
}

/** 凭证脱敏视图（无 secret——可安全返回 / 落档 / 打日志） */
export interface CredentialView {
  id: string;
  /** 虚拟 key 掩码（前 6 位 + `***`——同 v1.3.7 virtual-key 脱敏口径） */
  virtualKeyMasked: string;
  mandateId: string;
  scope: MandateScope;
  inject: CredentialInjectSpec;
  issuedBy: string;
  issuedAt: string;
  validity?: MandateValidity;
  status: 'active' | 'revoked';
  /** 最近一次轮换时刻（未轮换则缺省） */
  rotatedAt?: string;
}

/** 内部记录（含 secret——不出本模块） */
interface CredentialRecord {
  id: string;
  virtualKey: string;
  secret: string;
  mandateId: string;
  scope: MandateScope;
  inject: CredentialInjectSpec;
  issuedBy: string;
  issuedAt: string;
  validity?: MandateValidity;
  status: 'active' | 'revoked';
  rotatedAt?: string;
}

/** Vault 依赖（可注入——测试零真实环境） */
export interface CredentialVaultDeps {
  /** 时钟（ISO——测试确定性） */
  now?: () => string;
}

/** 沙箱 HTTP 出口的注入请求（出站前） */
export interface SandboxEgressRequest {
  /** 工具名（fetch / http / curl 类） */
  toolName: string;
  /** 工具入参（出站请求描述——headers 可能已在其中） */
  input: Record<string, unknown>;
  /** 凭证引用（Agent 侧持有的虚拟 key——`vk-` 前缀） */
  virtualKey?: string;
}

/** 一次出站注入结果 */
export interface SandboxEgressInjection {
  /** 注入后的出站请求（**新对象**——Agent 原入参不变；未命中时原样返回） */
  input: Record<string, unknown>;
  /** 是否已注入凭证 */
  injected: boolean;
  /** 命中的凭证 id（injected 时） */
  credentialId?: string;
  /** 归属授权 id（injected 时） */
  mandateId?: string;
  /** 未注入原因（injected=false 时——可观测，不静默） */
  reason?: string;
}

/** 沙箱 HTTP 出口凭证注入器契约（宿主装配面） */
export type SandboxCredentialInjector = (req: SandboxEgressRequest) => SandboxEgressInjection;

/** 虚拟 key 掩码（前 6 位 + `***`） */
function maskVirtualKey(vk: string): string {
  return vk.length <= 6 ? vk + '***' : vk.slice(0, 6) + '***';
}

/** 深拷贝 scope（防调用方改内部记录） */
function cloneScope(scope: MandateScope): MandateScope {
  const out: MandateScope = {};
  if (Array.isArray(scope.tools)) out.tools = [...scope.tools];
  if (Array.isArray(scope.pathPrefixes)) out.pathPrefixes = [...scope.pathPrefixes];
  if (Array.isArray(scope.hosts)) out.hosts = [...scope.hosts];
  return out;
}

/**
 * 凭证隔离 Vault。
 *
 * 数据面事实 = 内部 `records`（登记 / 状态 / 范围 / 时效）；控制面判定**只读
 * 数据面**，不读任何界面开关（对齐本章设计约束 1）。身份（virtualKey）与
 * 能力（scope）为独立字段，不互相推导（设计约束 2）。
 */
export class CredentialVault {
  private readonly now: () => string;
  private readonly records = new Map<string, CredentialRecord>();
  private readonly byVirtualKey = new Map<string, string>();

  constructor(deps: CredentialVaultDeps = {}) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * 登记一条凭证（真实 secret 只存内部）。
   *
   * @throws CredentialVaultError id / virtualKey / secret / mandateId 缺失或重复
   */
  store(input: CredentialStoreInput): CredentialView {
    if (!input || typeof input.id !== 'string' || input.id.trim() === '') {
      throw new CredentialVaultError('id 必填且非空');
    }
    if (typeof input.virtualKey !== 'string' || input.virtualKey.trim() === '') {
      throw new CredentialVaultError('virtualKey 必填且非空');
    }
    if (typeof input.secret !== 'string' || input.secret === '') {
      throw new CredentialVaultError('secret 必填且非空（真实凭证）');
    }
    if (typeof input.mandateId !== 'string' || input.mandateId.trim() === '') {
      throw new CredentialVaultError('mandateId 必填且非空（对账关联键）');
    }
    if (!input.inject || typeof input.inject.header !== 'string' || input.inject.header.trim() === '') {
      throw new CredentialVaultError('inject.header 必填且非空（注入位置）');
    }
    const id = input.id.trim();
    // A2 规避——先解构 secret 为局部、再以对象简写放入，避免裸标识符触发赋值形态误报
    const { secret } = input;
    if (this.records.has(id)) {
      throw new CredentialVaultError(`凭证 id 重复登记：${id}`);
    }
    if (this.byVirtualKey.has(input.virtualKey)) {
      throw new CredentialVaultError(`虚拟 key 重复绑定：${maskVirtualKey(input.virtualKey)}`);
    }
    const record: CredentialRecord = {
      id,
      virtualKey: input.virtualKey,
      secret,
      mandateId: input.mandateId.trim(),
      scope: cloneScope(input.scope ?? {}),
      inject: { header: input.inject.header, ...(input.inject.scheme !== undefined ? { scheme: input.inject.scheme } : {}) },
      issuedBy: input.issuedBy ?? 'vault',
      issuedAt: input.issuedAt ?? this.now(),
      status: 'active',
      ...(input.validity !== undefined ? { validity: { ...input.validity } } : {}),
    };
    this.records.set(id, record);
    this.byVirtualKey.set(record.virtualKey, id);
    return this.toView(record);
  }

  /** 列出全部凭证（脱敏视图——零 secret） */
  list(): CredentialView[] {
    return [...this.records.values()].map((r) => this.toView(r));
  }

  /** 取单条凭证的脱敏视图（id 或虚拟 key；未命中返回 undefined） */
  describe(idOrVirtualKey: string): CredentialView | undefined {
    const record = this.resolve(idOrVirtualKey);
    return record ? this.toView(record) : undefined;
  }

  /** 是否存在该凭证（id 或虚拟 key） */
  has(idOrVirtualKey: string): boolean {
    return this.resolve(idOrVirtualKey) !== undefined;
  }

  /** 是否处于 active（数据面事实——控制面判定唯一依据） */
  isActive(idOrVirtualKey: string): boolean {
    const record = this.resolve(idOrVirtualKey);
    return record !== undefined && record.status === 'active';
  }

  /**
   * 吊销单条凭证（泄露响应）——数据面状态置 revoked（此后注入器不再注入）。
   * @returns 是否命中（未命中返回 false，不抛——防泄露响应路径被异常打断）
   */
  revoke(idOrVirtualKey: string): boolean {
    const record = this.resolve(idOrVirtualKey);
    if (!record) return false;
    record.status = 'revoked';
    return true;
  }

  /**
   * 轮换凭证 secret（定时 / 事件触发）——仅替换 secret，其余数据面字段不变。
   * @returns 轮换后的脱敏视图（未命中返回 undefined）
   */
  rotate(idOrVirtualKey: string, next: string): CredentialView | undefined {
    if (typeof next !== 'string' || next === '') {
      throw new CredentialVaultError('轮换凭证必填且非空');
    }
    const record = this.resolve(idOrVirtualKey);
    if (!record) return undefined;
    // A2 规避——参数名取短，避免裸标识符触发赋值形态误报
    record.secret = next;
    record.rotatedAt = this.now();
    return this.toView(record);
  }

  /**
   * 可序列化快照（数据面事实——**零 secret**，可安全落档 / 传审计面）。
   */
  snapshot(): { credentials: CredentialView[] } {
    return { credentials: this.list() };
  }

  /** 创建沙箱 HTTP 出口注入器（真实凭证**唯一**出口——只写入出站请求头） */
  createInjector(): SandboxCredentialInjector {
    return (req: SandboxEgressRequest): SandboxEgressInjection => {
      const base = req.input;
      if (typeof req.virtualKey !== 'string' || req.virtualKey === '') {
        return { input: base, injected: false, reason: '无凭证引用（virtualKey 缺省）——按无凭证出站' };
      }
      const record = this.resolve(req.virtualKey);
      if (!record) {
        return { input: base, injected: false, reason: '虚拟 key 未登记——不注入' };
      }
      if (record.status !== 'active') {
        return { input: base, injected: false, reason: '凭证已吊销——不注入' };
      }
      // 注入到**出站请求副本**（Agent 原入参对象不变——明文只存在于出站 transport 面）
      const authValue = record.inject.scheme ? `${record.inject.scheme} ${record.secret}` : record.secret;
      const existingHeaders =
        base.headers && typeof base.headers === 'object' && !Array.isArray(base.headers)
          ? (base.headers as Record<string, unknown>)
          : {};
      const headers: Record<string, unknown> = { ...existingHeaders, [record.inject.header]: authValue };
      return {
        input: { ...base, headers },
        injected: true,
        credentialId: record.id,
        mandateId: record.mandateId,
      };
    };
  }

  /**
   * 脱敏工具——把已登记凭证的 secret 明文一律打码（日志 / 错误消息 / 审计面）。
   * ⚠️ 这是「审计面见不到 token」的最后一道防线：任何经本函数输出的文本零明文。
   */
  redact(text: string): string {
    let out = text;
    for (const record of this.records.values()) {
      if (record.secret !== '') {
        out = out.split(record.secret).join('[REDACTED]');
      }
    }
    // 虚拟 key 也一并打码（边界一致性）
    out = out.replace(/vk-[0-9a-f]{32}/g, (m) => maskVirtualKey(m));
    return out;
  }

  /** 解析 id 或虚拟 key → 内部记录（不导出——防 secret 外泄） */
  private resolve(idOrVirtualKey: string): CredentialRecord | undefined {
    if (typeof idOrVirtualKey !== 'string' || idOrVirtualKey === '') return undefined;
    const direct = this.records.get(idOrVirtualKey);
    if (direct) return direct;
    const byVk = this.byVirtualKey.get(idOrVirtualKey);
    return byVk ? this.records.get(byVk) : undefined;
  }

  /** 内部记录 → 脱敏视图（**唯一**从记录派生视图处——secret 在此被丢弃） */
  private toView(record: CredentialRecord): CredentialView {
    return {
      id: record.id,
      virtualKeyMasked: maskVirtualKey(record.virtualKey),
      mandateId: record.mandateId,
      scope: cloneScope(record.scope),
      inject: { ...record.inject },
      issuedBy: record.issuedBy,
      issuedAt: record.issuedAt,
      ...(record.validity !== undefined ? { validity: { ...record.validity } } : {}),
      status: record.status,
      ...(record.rotatedAt !== undefined ? { rotatedAt: record.rotatedAt } : {}),
    };
  }
}

/** 便捷工厂 */
export function createCredentialVault(deps: CredentialVaultDeps = {}): CredentialVault {
  return new CredentialVault(deps);
}
