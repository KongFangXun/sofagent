// ============================================================
// egress-interceptor-api.ts · v1.5.2 章五 · 出站裁决拦截器接口（通道形态）
// ============================================================
//
// 数据主权「管出」翼的**通道面**：把出站裁决接口开放给外部拦截器
// （egress proxy / OS 沙箱 / netfilter 适配器……）。
//
// ⚠️ 马鞍边界（changelog 章五「接口+事件契约+审计留约束层，实现在外」）：
//   本文件**只定义接口 + 事件契约 + 注册点 + 审计留痕约束层**——
//   **不含任何具体拦截实现**：不自建 proxy、不打 monkey-patch、不发真实网络请求。
//   拦截器实现是执行面，由外部生态提供（对齐 TrainChannel「约束层不自研，实现在外」）。
//
// 三层职责切分（谁持有什么）：
//   1. 策略契约  engine/rules/src/egress-policy.ts       —— 声明面 + 裁决纯函数（默认空全拒）
//   2. 留痕契约  engine/audit/src/egress-audit.ts        —— 裁决事件落 HMAC 审计链
//   3. 通道契约  **本文件**                              —— 外部拦截器接入点 + 裁决必经审计的约束层
//
// 通道语义（约束层不绑实现）：
//   - 外部实现 `EgressInterceptor.decide(request, policy)` 返回 `EgressDecision`；
//   - 通道只保证「裁决必经 `EgressAuditSink` 留痕」——sink 是注入的契约，
//     生产环境注入 audit 的 `recordEgressDecision` 适配，测试可注入假 sink；
//   - 无拦截器注册时通道 **fail-closed**（Deny · reason='no-interceptor'）——
//     与策略面「默认空 = 全拒」同款 opt-in 语义；
//   - sink 抛错不阻断裁决返回（audited=false 显式标注——留痕失败不吞裁决）。
//
// 类型来源：策略域类型（EgressRequest/EgressPolicy/EgressDecision）从
//   `@sofagent/rules` **type-only** 引入（编译期契约，运行期零依赖）。
// ============================================================

import type { EgressDecision, EgressPolicy, EgressRequest } from '@sofagent/rules';

/** 通道错误（注册冲突等契约层异常） */
export class EgressChannelError extends Error {
  constructor(message: string) {
    super(`[egress-channel] ${message}`);
    this.name = 'EgressChannelError';
  }
}

/** 裁决上下文（主体标识——审计留痕归属） */
export interface EgressInterceptContext {
  /** 裁决主体（workflow / 节点 / agent 标识） */
  subject: string;
  /** 会话标识（可选，透传审计） */
  sessionId?: string;
  /** 归属 Agent（可选，透传审计；缺省由 sink 决定） */
  agentId?: string;
}

/**
 * 审计留痕钩子契约（**约束层**：通道保证裁决必经此钩子）。
 *
 * 生产环境注入 `recordEgressDecision` 的适配函数
 * （engine/audit/src/egress-audit.ts——写 decision-log.jsonl HMAC 链）；
 * 测试 / 自定义部署可注入任意实现（如推送外部 SIEM）。
 * 本通道不 import 任何具体 sink 实现（马鞍边界：实现在外）。
 */
export interface EgressAuditSink {
  (request: EgressRequest, decision: EgressDecision, context: EgressInterceptContext): void;
}

/**
 * 出站拦截器接口——外部实现（egress proxy / OS 沙箱 / netfilter 适配器）。
 *
 * 实现者只负责**裁决**：读策略 + 读请求，返回 Allow/Deny + 可追溯理由。
 * 拦截副作用（真正阻断连接 / 挂 DNS hook）属实现方内部，不在本契约面。
 */
export interface EgressInterceptor {
  /** 拦截器名（注册唯一键 + 审计留痕标注） */
  readonly name: string;
  /**
   * 裁决一次出站请求。
   * @param request 出站请求（host + 可选 port/protocol）
   * @param policy 出站策略（可为 null——外部实现应按 fail-closed 处理）
   */
  decide(request: EgressRequest, policy: EgressPolicy | null): EgressDecision;
}

/** 一次通道裁决结果 */
export interface EgressHandleResult {
  /** 裁决结果（外部拦截器产出，或通道 fail-closed 产出） */
  decision: EgressDecision;
  /** 产出裁决的拦截器名（'none' = 无拦截器注册，通道 fail-closed） */
  interceptor: string;
  /** 是否已留痕（sink 缺失 / 抛错 → false；不阻断裁决返回） */
  audited: boolean;
}

/** 通道构造选项 */
export interface EgressChannelOptions {
  /** 预注册拦截器（按序——首个为当前裁决器） */
  interceptors?: EgressInterceptor[];
  /** 预置审计留痕钩子 */
  sink?: EgressAuditSink;
}

/**
 * 出站裁决通道——外部拦截器的注册点 + 「裁决必经审计」约束层。
 *
 * 用法（外部拦截器接入）：
 *   const channel = new EgressChannel({ sink: (req, dec, ctx) => recordEgressDecision({...}) });
 *   channel.register(myEgressProxyInterceptor);
 *   const { decision, interceptor, audited } = channel.handle(req, policy, { subject: 'wf-42' });
 *
 * ⚠️ 本类不含任何拦截实现——`handle` 只做「选拦截器 → 取裁决 → 送 sink」的编排。
 * 首个注册的拦截器为当前裁决器（单裁决器通道语义；换用先 unregister）。
 */
export class EgressChannel {
  private readonly interceptors: EgressInterceptor[] = [];
  private sink?: EgressAuditSink;

  constructor(options: EgressChannelOptions = {}) {
    if (options.sink) this.sink = options.sink;
    for (const interceptor of options.interceptors ?? []) this.register(interceptor);
  }

  /** 注册外部拦截器（重名 → EgressChannelError，防静默覆盖） */
  register(interceptor: EgressInterceptor): this {
    if (!interceptor || typeof interceptor.name !== 'string' || interceptor.name === '') {
      throw new EgressChannelError('拦截器非法：name 必填');
    }
    if (typeof interceptor.decide !== 'function') {
      throw new EgressChannelError(`拦截器「${interceptor.name}」非法：decide 必为函数`);
    }
    if (this.interceptors.some((i) => i.name === interceptor.name)) {
      throw new EgressChannelError(`拦截器重名：${interceptor.name}`);
    }
    this.interceptors.push(interceptor);
    return this;
  }

  /** 注销拦截器（按名）；返回是否命中 */
  unregister(name: string): boolean {
    const idx = this.interceptors.findIndex((i) => i.name === name);
    if (idx < 0) return false;
    this.interceptors.splice(idx, 1);
    return true;
  }

  /** 已注册拦截器名（注册序） */
  list(): string[] {
    return this.interceptors.map((i) => i.name);
  }

  /** 设置 / 清除审计留痕钩子 */
  setAuditSink(sink?: EgressAuditSink): void {
    this.sink = sink;
  }

  /** 当前裁决器名（无拦截器 → 'none'） */
  primary(): string {
    return this.interceptors[0]?.name ?? 'none';
  }

  /**
   * 裁决一次出站请求并留痕（通道全链路：选拦截器 → 取裁决 → 送 sink）。
   *
   * 无拦截器注册 → 通道 fail-closed Deny（reason='no-interceptor'）——
   * 与策略面「默认空 = 全拒」同款 opt-in 语义；该裁决同样必经 sink 留痕。
   * sink 缺失或抛错 → audited=false（显式标注），裁决照常返回（留痕失败不吞裁决）。
   */
  handle(
    request: EgressRequest,
    policy: EgressPolicy | null,
    context: EgressInterceptContext,
  ): EgressHandleResult {
    const primary = this.interceptors[0];
    const decision: EgressDecision = primary
      ? primary.decide(request, policy)
      : {
          verdict: 'Deny',
          reason: 'no-interceptor',
          host: typeof request?.host === 'string' ? request.host : '',
          message: '未注册任何出站拦截器——通道 fail-closed 拒绝（opt-in：注册后方可裁决）',
        };
    return {
      decision,
      interceptor: primary?.name ?? 'none',
      audited: this.emitAudit(request, decision, context),
    };
  }

  /** 送审计留痕钩子——失败不抛（留痕失败不阻断裁决，audited 标记呈递） */
  private emitAudit(
    request: EgressRequest,
    decision: EgressDecision,
    context: EgressInterceptContext,
  ): boolean {
    if (!this.sink) return false;
    try {
      this.sink(request, decision, context);
      return true;
    } catch {
      return false;
    }
  }
}
