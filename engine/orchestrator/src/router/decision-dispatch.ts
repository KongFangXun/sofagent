// ============================================================
// decision-dispatch.ts · 决策下达协议（v1.5.4 · 第二章）
// ============================================================
//
// 定位：**引擎 → router** 的去向决策下达面（与 v1.4.9 承接面构成双向闭环）。
// v1.4.9 已交付 router 伴生 exporter（**数据承接面**：router → 引擎）；本文件补
// **决策下达面**（引擎 → router）：引擎判定出的去向决策（目标模型 / 降级路径 /
// 槽位归属）按标准 schema 下达 router 执行。
//
// 硬约束：
//   - **schema 校验 fail-closed**：坏格式拒绝下达，不静默放行
//   - **HMAC 挂链**：每次下达留痕（谁在何时下达了哪个去向），完整性可证
//   - schema 与 v1.4.9 承接面**同族**：方向相反、家族一致——双向一致性由
//     train 侧 `router-exporter.ts` 的 `assertSchemaFamilyAlignment` 校验
// ============================================================

import { createHmac } from 'crypto';
import { z } from 'zod';

/**
 * 去向决策 schema（引擎 → router）。
 * `.strict()`——未知字段拒绝（坏格式 fail-closed，不静默放行）。
 */
export const RouteDispositionSchema = z
  .object({
    /** 决策标识（幂等键 / 审计关联键） */
    decisionId: z.string().min(1),
    /** 目标模型（router 侧执行目标——注册名或服务模型名） */
    targetModel: z.string().min(1),
    /** 降级路径（如 ['cloud-strong','local-executor']——首位是主选） */
    fallbackChain: z.array(z.string().min(1)).optional(),
    /** 槽位归属（引擎层本地 GPU 槽位——执行档 / 管道档） */
    slotLane: z.enum(['executor', 'pipeline']).optional(),
    /** 排队优先级 */
    priority: z.enum(['high', 'normal', 'low']).optional(),
    /** 去向理由（routeReason 可解释） */
    reason: z.string().optional(),
  })
  .strict();

export type RouteDisposition = z.infer<typeof RouteDispositionSchema>;

/**
 * 下达 schema 家族描述（双向一致性校验的**比对基准**）。
 * train 侧 router-exporter.ts 的 `assertSchemaFamilyAlignment` 以此为准校验
 * 接收侧 schema 家族一致（字段集 / version / direction 反向）。
 */
export const DISPOSITION_SCHEMA_FAMILY = {
  version: 1,
  /** 下达方向（引擎 → router） */
  direction: 'engine→router' as const,
  /** 承接方向（router → 引擎，v1.4.9 承接面） */
  receiveDirection: 'router→engine' as const,
  /** 字段集（顺序即家族契约） */
  fields: ['decisionId', 'targetModel', 'fallbackChain', 'slotLane', 'priority', 'reason'] as const,
} as const;

/** 下达传输面（注入式——HTTP 接线归 router 侧部署方；缺省 console 面） */
export type DispatchTransport = (
  payload: RouteDisposition,
  signature: string,
) => Promise<{ ok: boolean; message: string }>;

/** 下达结果 */
export interface DispatchResult {
  ok: boolean;
  /** schema 是否合法（false → 已 fail-closed 拒绝） */
  schemaValid: boolean;
  /** 是否已实际下达 */
  dispatched: boolean;
  /** 结构化错误 */
  issues: string[];
  /** HMAC 签名（下达成功时） */
  signature?: string;
  message: string;
}

/** 下达器依赖（均可注入——测试零真实网络） */
export interface DecisionDispatcherDeps {
  /** HMAC 密钥（同承接面纪律——缺省无密钥则降级明文事件） */
  hmacKey?: string | null;
  /** 传输面（缺省 console 调试形态） */
  transport?: DispatchTransport;
  /** 审计挂链追加面（缺省无——生产接线写 decision-log HMAC 链） */
  auditAppend?: (line: string) => void;
  /** 时钟（ISO——测试确定性） */
  now?: () => string;
}

/**
 * 决策下达器。
 *
 * 组包顺序：入参 → RouteDispositionSchema 校验（fail-closed，坏格式拒绝下达）
 * → HMAC 签名 → 传输 → 审计挂链。
 */
export class DecisionDispatcher {
  private readonly hmacKey: string | null;
  private readonly transport: DispatchTransport;
  private readonly auditAppend?: (line: string) => void;
  private readonly now: () => string;

  constructor(deps: DecisionDispatcherDeps = {}) {
    this.hmacKey = deps.hmacKey ?? null;
    this.transport =
      deps.transport ??
      (async (p, sig) => {
        // 缺省 console 面——本地调试形态（生产必须注入真实传输）
        void p;
        void sig;
        return { ok: true, message: 'console 面向（调试缺省）——生产装配请注入 transport' };
      });
    if (deps.auditAppend) this.auditAppend = deps.auditAppend;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * 签名 payload（HMAC-SHA256——按顶层 key 字典序 canonical 序列化后签名，
   * 与承接面 exporter 同哲学：key 顺序无关）。
   */
  sign(payload: RouteDisposition): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return createHmac('sha256', this.hmacKey ?? '').update(canonical).digest('hex');
  }

  /** 验签（router 侧同源实现——双向对称，下达侧自测用） */
  verify(payload: RouteDisposition, signature: string): boolean {
    return this.sign(payload) === signature;
  }

  /**
   * 下达去向决策。
   *
   * @param disposition 去向决策（RouteDispositionSchema 形态）
   */
  async dispatch(disposition: unknown): Promise<DispatchResult> {
    // ── 1. schema 校验（fail-closed：坏格式拒绝下达，不静默放行）──
    const parsed = RouteDispositionSchema.safeParse(disposition);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
      return {
        ok: false,
        schemaValid: false,
        dispatched: false,
        issues,
        message: `去向决策 schema 校验失败（fail-closed——拒绝下达）：${issues.join('; ')}`,
      };
    }
    const payload = parsed.data;

    // ── 2. 签名 ──
    const signature = this.sign(payload);

    // ── 3. 传输 ──
    let ok = true;
    let message = '';
    try {
      const result = await this.transport(payload, signature);
      ok = result.ok;
      message = result.message;
    } catch (err) {
      ok = false;
      message = `传输异常：${err instanceof Error ? err.message : String(err)}`;
    }

    // ── 4. 审计挂链（HMAC 留痕——无论成败都记录下达动作）──
    const issues: string[] = [];
    if (this.auditAppend) {
      const event = {
        ts: this.now(),
        kind: 'disposition-dispatch',
        decisionId: payload.decisionId,
        targetModel: payload.targetModel,
        fallbackChain: payload.fallbackChain ?? [],
        slotLane: payload.slotLane ?? null,
        priority: payload.priority ?? null,
        reason: payload.reason ?? '',
        signature,
        dispatched: ok,
      };
      const line = this.hmacKey
        ? JSON.stringify({ ...event, hmacSig: createHmac('sha256', this.hmacKey).update(JSON.stringify(event)).digest('hex') })
        : JSON.stringify(event);
      try {
        this.auditAppend(line + '\n');
      } catch (err) {
        // 审计挂链失败不阻断下达（传输结果已定），但**降级可见**——把留痕失败写入
        // issues 供调用方告警（留痕缺失在返回值显式可见，不静默吞错）
        issues.push(`审计挂链失败（留痕缺失）：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      ok,
      schemaValid: true,
      dispatched: ok,
      issues,
      signature,
      message: ok ? `去向决策已下达（${payload.decisionId} → ${payload.targetModel}）` : `下达失败：${message}`,
    };
  }
}
