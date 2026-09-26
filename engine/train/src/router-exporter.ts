// router-exporter.ts · v1.5.3 T7 第七章 · 伴生 exporter 参考实现（router 侧部署）
//
// 定位：router 基于开源项目自建（非第三方托管），引擎不自研 router 本体——
// 本文件是引擎交付的**伴生 exporter 组件**（开源进仓，router 侧部署）：
// 过站流量按标准 schema（RouterSessionSchema）推送，引擎侧校验落盘。
//
// 职责边界：
//   - exporter 只采集与推送（session 内容 + usage + 路由决策）
//   - 数据本地落盘（数据主权铁律——记录不出企业边界）
//   - 全程 HMAC 挂链（推送侧签名 + 引擎侧验签——完整性可证）
//
// 本文件是**参考实现 + 协议文档载体**（对外输出格式与字段约定的可执行
// 规格）——router 侧可用任意语言实现同 schema；推送目标经注入 transport
// 抽象（生产接线 HTTP 回调到引擎 MCP tool / 测试注入 stub）。

import { createHmac } from 'crypto';
import { RouterSessionSchema, type RouterSessionPayload } from './session-ingest';

/** 推送传输面（注入式——HTTP 接线归 router 侧部署方） */
export type ExporterTransport = (payload: RouterSessionPayload, signature: string) => Promise<{ ok: boolean; message: string }>;

/** exporter 配置 */
export interface RouterExporterConfig {
  /** router 实例标识（source 字段——审计可追溯） */
  source: string;
  /** 企业标识（租户隔离键） */
  enterpriseId: string;
  /** HMAC 签名密钥（router 侧持有——引擎侧验签用同源密钥，经安全通道分发） */
  hmacKey: string;
  /** 推送传输面（缺省 console 面向——本地调试形态） */
  transport?: ExporterTransport;
}

/** 伴生 exporter（参考实现） */
export class RouterExporter {
  private readonly config: RouterExporterConfig;

  constructor(config: RouterExporterConfig) {
    this.config = config;
  }

  /**
   * 签名 payload（HMAC-SHA256——stable 序列化后签名，与 audit 链
   * stableStringify 同哲学：key 顺序无关）。
   */
  signPayload(payload: RouterSessionPayload): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return createHmac('sha256', this.config.hmacKey).update(canonical).digest('hex');
  }

  /** 验签（引擎侧同源实现——双向对称，exporter 侧自测用） */
  verifyPayload(payload: RouterSessionPayload, signature: string): boolean {
    return this.signPayload(payload) === signature;
  }

  /**
   * 采集一次过站会话并推送。
   *
   * 组包顺序：入参 → RouterSessionSchema 构造校验（schema 不合拒绝推送——
   * fail-closed：不把坏数据推给引擎侧再拒，两端同门）→ 签名 → 传输。
   */
  async exportSession(input: {
    sessionId: string;
    messages: RouterSessionPayload['messages'];
    usage: RouterSessionPayload['usage'];
    route: RouterSessionPayload['route'];
    apiKeyId?: string;
    scope?: RouterSessionPayload['scope'];
    pushedAt?: string;
  }): Promise<{ ok: boolean; message: string; signature?: string }> {
    const payload: RouterSessionPayload = {
      sessionId: input.sessionId,
      enterpriseId: this.config.enterpriseId,
      source: this.config.source,
      messages: input.messages,
      usage: input.usage,
      route: input.route,
      ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.pushedAt ? { pushedAt: input.pushedAt } : {}),
    };
    const parsed = RouterSessionSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        message: `schema 校验失败（exporter 侧前置拒绝——fail-closed）：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      };
    }
    const signature = this.signPayload(parsed.data);
    const transport = this.config.transport ?? (async (p, sig) => {
      // 缺省 console 面——本地调试形态（生产必须注入真实传输）
      void p; void sig;
      return { ok: true, message: 'console 面向（调试缺省）——生产装配请注入 transport' };
    });
    const result = await transport(parsed.data, signature);
    return { ok: result.ok, message: result.message, signature };
  }
}

/**
 * exporter 协议规格文本（对外输出格式与字段约定——router 侧任意语言
// 实现的消费文档；亦作为 router-exporter.md 的生成源）。
 */
export function exporterProtocolSpec(): string {
  return [
    '# Router 伴生 exporter 协议（v1.4.9 T7）',
    '',
    '推送目标：引擎侧 router_session_push MCP tool（schema 校验 + 本地落盘 + HMAC 挂链）。',
    '',
    'payload 字段（zod .strict()——未知字段拒绝）：',
    '- sessionId: string（会话标识——幂等键，重复推送拒绝）',
    '- enterpriseId: string（企业租户隔离键）',
    '- source: string（router 实例标识——审计追溯）',
    '- messages: Array<{role: user|assistant|system|tool, content: string}>（多轮消息，至少 1 轮）',
    '- usage: {inputTokens: int≥0, outputTokens: int≥0, model: string, pricePerKUsd?: number}',
    '- route: {targetModel: string, fallbackChain?: string[], reason?: string}',
    '- apiKeyId?: string（key 维度计量锚）',
    '- scope?: {executor, workerId, model, workDir, runtime}（会话续接五元组）',
    '- pushedAt?: string（ISO 时间）',
    '',
    '签名：HMAC-SHA256(payload 的 canonical JSON, 双端同源密钥)——canonical 为按顶层 key 字典序序列化。',
    '传输：POST JSON（注入式 transport——HTTP 接线归 router 侧部署方）。',
    'fail-closed：schema 不合两端同拒（exporter 侧前置 + 引擎侧兜底）。',
  ].join('\n');
}
