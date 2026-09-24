// session-ingest.ts · v1.5.2 T7 第七章 · router 过站 session → IngestRecord（多轮展开）
//
// 定位：router 伴生 exporter 推送的标准 schema session，引擎侧校验 +
// 展开为 IngestRecord 中间格式（多轮 messages 一行一 turn 对——衔接
// dataset-builder 多轮样本模型）。承接数据本地落盘（数据主权铁律——
// 记录不出企业边界），全程 HMAC 挂链（落盘走 audit 面由 MCP tool 层执行，
// 本文件纯转换零 I/O）。
//
// schema 与 data-push.ts DataPushSchema 同源的扩展形态（zod .strict()）：
//   session：sessionId + messages[]（role/content 多轮）+ usage（token/模型/单价）
//          + 路由决策（目标模型/降级路径）+ key 维度（谁发的请求）
//   多轮展开：切窗（长 session 滚动窗口切分）+ 角色映射（user/assistant/
//          system → 样本角色）——每窗一行 IngestRecord，fields 含
//          instruction/input/output/messages（JSON 序列化——dataset-builder
//          messages 列消费）+ 会话续接五元组。

import { z } from 'zod';

// ══════════════════════════════════════
// exporter 标准 schema（T7 · session 承接面）
// ══════════════════════════════════════

/** 单轮消息（Qwen chat / sharegpt 兼容角色） */
export const MessageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
  })
  .strict();

/** token 用量（exporter 推送——cost 台账入账依据） */
export const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    /** 请求模型（路由目标） */
    model: z.string().min(1),
    /** 单价（USD / 1K token——缺省 0 由 cost 侧按模型表兜底） */
    pricePerKUsd: z.number().nonnegative().optional(),
  })
  .strict();

/** 路由决策（router 挡在基座模型前的过站决策） */
export const RouteDecisionSchema = z
  .object({
    /** 实际路由目标模型 */
    targetModel: z.string().min(1),
    /** 降级路径（如 ['deepseek-v3', 'qwen2.5-7b']——首位是主选） */
    fallbackChain: z.array(z.string()).optional(),
    /** 路由依据（轻量可读——审计留痕） */
    reason: z.string().optional(),
  })
  .strict();

/** 会话续接五元组（作用域归属——T7 扩展验收） */
export const SessionScopeSchema = z
  .object({
    /** 执行器（executor 标识） */
    executor: z.string().min(1),
    /** 数字员工身份（agentId） */
    workerId: z.string().min(1),
    /** 模型（当前会话使用的模型名） */
    model: z.string().min(1),
    /** 工作目录（cwd 绝对路径） */
    workDir: z.string().min(1),
    /** 运行时（runtime 标识——node 版本/沙箱形态等） */
    runtime: z.string().min(1),
  })
  .strict();

/** exporter 推送 payload（标准 schema——.strict() 拒绝未知字段） */
export const RouterSessionSchema = z
  .object({
    /** 会话标识（幂等键——同 id 重复推送拒绝） */
    sessionId: z.string().min(1),
    /** 企业标识（租户隔离键） */
    enterpriseId: z.string().min(1),
    /** 来源 router 实例（审计可追溯） */
    source: z.string().min(1),
    /** 多轮消息（至少 1 轮） */
    messages: z.array(MessageSchema).min(1),
    /** token 用量 */
    usage: UsageSchema,
    /** 路由决策 */
    route: RouteDecisionSchema,
    /** key 维度（router 侧 key 标识——计量/审计/异常检测锚） */
    apiKeyId: z.string().min(1).optional(),
    /** 会话续接五元组（缺省无——非续接会话） */
    scope: SessionScopeSchema.optional(),
    /** 推送时间（ISO——缺省接收时刻由 tool 层补） */
    pushedAt: z.string().optional(),
  })
  .strict();

export type RouterSessionPayload = z.infer<typeof RouterSessionSchema>;
export type SessionMessage = z.infer<typeof MessageSchema>;
export type SessionUsage = z.infer<typeof UsageSchema>;
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;
export type SessionScope = z.infer<typeof SessionScopeSchema>;

/** schema 校验结果 */
export interface SessionValidation {
  valid: boolean;
  payload?: RouterSessionPayload;
  issues?: string[];
}

/** 校验 exporter 推送 payload（zod strict——格式不合法拒绝入库） */
export function validateRouterSession(raw: unknown): SessionValidation {
  const result = RouterSessionSchema.safeParse(raw);
  if (!result.success) {
    return {
      valid: false,
      issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { valid: true, payload: result.data };
}

// ══════════════════════════════════════
// 多轮展开（切窗 + 角色映射）
// ══════════════════════════════════════

/** 展开选项 */
export interface ExpandOptions {
  /** 滚动窗口轮数（缺省 8——每窗 ≤ N 轮 user/assistant 对话；过窗滚动切分） */
  windowTurns?: number;
  /** 窗口步进（缺省 = windowTurns——不重叠；设小于窗口即滚动重叠窗） */
  stride?: number;
}

/** 缺省窗口：8 轮一窗、不重叠 */
export const DEFAULT_EXPAND_OPTIONS: Required<ExpandOptions> = {
  windowTurns: 8,
  stride: 8,
};

/**
 * 多轮消息切窗（滚动窗口切分——长 session 切多窗，每窗独立训练样本）。
 *
 * 窗口单位是 user/assistant 对（system/tool 消息附到最近的后续窗头——
 * 角色映射见 mapRoles；纯函数可独立单测）。
 */
export function windowMessages(
  messages: readonly SessionMessage[],
  opts: ExpandOptions = {},
): SessionMessage[][] {
  const windowTurns = opts.windowTurns ?? DEFAULT_EXPAND_OPTIONS.windowTurns;
  const stride = opts.stride ?? opts.windowTurns ?? DEFAULT_EXPAND_OPTIONS.stride;

  // 分离前置 system 块（会话头的 system 指令——每窗复带）
  const systemHead: SessionMessage[] = [];
  let i = 0;
  while (i < messages.length && messages[i]!.role === 'system') {
    systemHead.push(messages[i]!);
    i += 1;
  }
  const body = messages.slice(i);

  // 对齐边界：以 user 消息为窗起点（user 起 assistant 止的完整对）
  const windows: SessionMessage[][] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const window: SessionMessage[] = [...systemHead];
    let turns = 0;
    let j = cursor;
    while (j < body.length && turns < windowTurns) {
      window.push(body[j]!);
      if (body[j]!.role === 'assistant') turns += 1; // 一次 assistant 应答 = 一轮
      j += 1;
    }
    // 尾窗无 assistant 应答（悬空 user）——仍保留（弱样本交 validator 闸门判）
    if (window.length > systemHead.length) windows.push(window);
    cursor += stride;
    // 步进后落在 assistant 中段 → 前移到最近 user（保证窗起点语义完整）
    while (cursor < body.length && body[cursor]!.role === 'assistant') cursor += 1;
  }
  return windows;
}

/** 角色映射（user/assistant/system/tool → 样本角色——tool 映射为 system 附注） */
export function mapRoles(messages: readonly SessionMessage[]): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  return messages.map((m) => {
    if (m.role === 'tool') {
      // tool 消息映射为 system 附注（保留信息——训练侧不冒充对话轮）
      return { role: 'system' as const, content: `[tool-result] ${m.content}` };
    }
    return { role: m.role as 'user' | 'assistant' | 'system', content: m.content };
  });
}

// ══════════════════════════════════════
// 会话续接五元组（纯函数判定——T7 扩展验收）
// ══════════════════════════════════════

/** 续接判定结果 */
export interface ContinuationDecision {
  /** 可否续接（五元组完全匹配才 true） */
  canContinue: boolean;
  /** 不匹配的维度（canContinue=false 时非空——审计留痕） */
  mismatched: Array<keyof SessionScope>;
  /** 交接形态：continue 原文续接 / handoff 摘要交接 */
  mode: 'continue' | 'handoff';
}

/**
 * 续接五元组判定（纯函数——可单测可回放）。
 *
 * 五元组（执行器/员工身份/模型/工作目录/运行时）**全匹配**才可续接；
 * 任一不匹配走摘要交接（宁可不续——错配续接比重新开始危险）。
 */
export function decideContinuation(
  previous: SessionScope,
  current: SessionScope,
): ContinuationDecision {
  const keys: Array<keyof SessionScope> = ['executor', 'workerId', 'model', 'workDir', 'runtime'];
  const mismatched = keys.filter((k) => previous[k] !== current[k]);
  if (mismatched.length === 0) {
    return { canContinue: true, mismatched: [], mode: 'continue' };
  }
  return { canContinue: false, mismatched, mode: 'handoff' };
}

/** 摘要交接三要素（较早摘要 + 最近消息 + 最新结论） */
export interface HandoffSummary {
  /** 较早摘要（前段对话的压缩摘要） */
  earlierSummary: string;
  /** 最近消息（尾部原文——缺省 3 轮） */
  recentMessages: SessionMessage[];
  /** 最新结论（最后一条 assistant 消息） */
  latestConclusion: string;
}

/**
 * 构造摘要交接（三要素）——不匹配降级时的新会话起点。
 *
 * @param messages 原会话消息
 * @param opts.recentRounds 尾部保留轮数（缺省 3）
 * @param opts.summarizer 摘要函数（缺省截断拼接——生产装配注入 LLM 摘要）
 */
export function buildHandoffSummary(
  messages: readonly SessionMessage[],
  opts: { recentRounds?: number; summarizer?: (msgs: readonly SessionMessage[]) => string } = {},
): HandoffSummary {
  const recentRounds = opts.recentRounds ?? 3;
  // 尾部 recentRounds 轮（assistant 计轮）
  const tail: SessionMessage[] = [];
  let rounds = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    tail.unshift(messages[i]!);
    if (messages[i]!.role === 'assistant') rounds += 1;
    if (rounds >= recentRounds) break;
  }
  const head = messages.slice(0, Math.max(0, messages.length - tail.length));
  const summarize = opts.summarizer ?? ((msgs: readonly SessionMessage[]) => {
    if (msgs.length === 0) return '（无前段对话）';
    return msgs.map((m) => `${m.role}: ${m.content.slice(0, 120)}`).join('\n').slice(0, 2000);
  });
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  return {
    earlierSummary: summarize(head),
    recentMessages: tail,
    latestConclusion: lastAssistant?.content ?? '（无 assistant 结论消息）',
  };
}

// ══════════════════════════════════════
// session → IngestRecord（核心转换）
// ══════════════════════════════════════

/** IngestRecord 形态（与 data-ingest 同构——局部声明避免跨包 import 环） */
export interface SessionIngestRecord {
  id: string;
  source: string;
  fields: Record<string, string | number | boolean | null>;
}

/** 展开结果 */
export interface SessionExpandResult {
  /** 展开出的记录（每窗一条） */
  records: SessionIngestRecord[];
  /** 切窗数 */
  windows: number;
  /** 生效切窗参数（审计留痕） */
  options: Required<ExpandOptions>;
  /** 会话续接判定（payload 带 scope 时——五元组比对结果入审计） */
  continuation: ContinuationDecision | null;
}

/**
 * session → IngestRecord 多轮展开。
 *
 * 每窗一条记录，fields：
 *   - sessionId / windowIndex：溯源（同 session 的多窗可回溯）
 *   - instruction：窗尾 assistant 应答（单轮 SFT 兼容——缺省列推断消费）
 *   - input：窗内除尾轮外的对话拼接（user 问句摘要形态）
 *   - output：窗尾 assistant 应答
 *   - messages：多轮 JSON（dataset-builder 多轮样本消费——sharegpt 兼容）
 *   - model / inputTokens / outputTokens / pricePerKUsd：usage 透传（cost 台账）
 *   - routeTarget / routeReason：路由决策（审计留痕）
 */
export function expandSessionToRecords(
  payload: RouterSessionPayload,
  opts: ExpandOptions = {},
): SessionExpandResult {
  const options: Required<ExpandOptions> = {
    windowTurns: opts.windowTurns ?? DEFAULT_EXPAND_OPTIONS.windowTurns,
    stride: opts.stride ?? opts.windowTurns ?? DEFAULT_EXPAND_OPTIONS.stride,
  };
  const windows = windowMessages(payload.messages, options);
  const records: SessionIngestRecord[] = windows.map((win, idx) => {
    const mapped = mapRoles(win);
    const lastAssistant = [...mapped].reverse().find((m) => m.role === 'assistant');
    const dialogueBefore = mapped
      .slice(0, mapped.length - ([...mapped].reverse().findIndex((m) => m.role === 'assistant') !== -1 ? [...mapped].reverse().findIndex((m) => m.role === 'assistant') : 0))
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');
    return {
      id: `${payload.sessionId}#w${idx + 1}`,
      source: `router-session:${payload.source}`,
      fields: {
        sessionId: payload.sessionId,
        windowIndex: idx + 1,
        instruction: mapped.find((m) => m.role === 'user')?.content ?? '',
        input: dialogueBefore,
        output: lastAssistant?.content ?? '',
        messages: JSON.stringify(mapped),
        model: payload.usage.model,
        inputTokens: payload.usage.inputTokens,
        outputTokens: payload.usage.outputTokens,
        pricePerKUsd: payload.usage.pricePerKUsd ?? 0,
        routeTarget: payload.route.targetModel,
        routeReason: payload.route.reason ?? '',
        ...(payload.apiKeyId ? { apiKeyId: payload.apiKeyId } : {}),
      },
    };
  });

  // 会话续接判定（payload 带 scope 时）——scope 与自身无前序可比，
  // 此处透传 mode: continue 语义（scope 在场即可续接起点登记；
  // 跨会话比对由调用方持有前序 scope 后调 decideContinuation）
  const continuation: ContinuationDecision | null = payload.scope
    ? { canContinue: true, mismatched: [], mode: 'continue' }
    : null;

  return { records, windows: windows.length, options, continuation };
}

// ══════════════════════════════════════
// usage 入 cost 台账（T7 第五章：router 过站流量成本核算）
// ══════════════════════════════════════

/** cost 台账条目（usage → 台账——按模型/时段聚合的入账单行） */
export interface CostLedgerEntry {
  /** 入账时间（ISO——推送时刻） */
  ts: string;
  /** 计费模型 */
  model: string;
  /** key 维度（有则按 key 聚合——缺省 router 匿名桶） */
  apiKeyId: string;
  inputTokens: number;
  outputTokens: number;
  /** 成本 USD（(in+out)/1000 × 单价——单价 0 时为 0，cost 侧按模型表兜底重估） */
  costUsd: number;
}

/** usage → cost 台账条目（纯函数——落盘由 tool 层 / daemon 侧执行） */
export function usageToCostEntry(
  payload: RouterSessionPayload,
  now: () => string = () => new Date().toISOString(),
): CostLedgerEntry {
  const price = payload.usage.pricePerKUsd ?? 0;
  const costUsd = ((payload.usage.inputTokens + payload.usage.outputTokens) / 1000) * price;
  return {
    ts: payload.pushedAt ?? now(),
    model: payload.usage.model,
    apiKeyId: payload.apiKeyId ?? 'router-anonymous',
    inputTokens: payload.usage.inputTokens,
    outputTokens: payload.usage.outputTokens,
    costUsd,
  };
}

// ══════════════════════════════════════
// key 维度 harness 四件（T7 · 2026-09-08 升格拍板）
// ══════════════════════════════════════

/** key 异常检测阈值（外部化——对齐 dataset-validator 模式） */
export interface KeyAnomalyThresholds {
  /** 单 key 日 token 上限（超即突增异常） */
  maxDailyTokens: number;
  /** 单 key 日调用次数上限 */
  maxDailyCalls: number;
  /** 突增倍率（今日/昨日 > 此值即异常） */
  spikeRatio: number;
}

/** 缺省阈值（保守起步——企业按量外部化覆盖） */
export const DEFAULT_KEY_ANOMALY_THRESHOLDS: KeyAnomalyThresholds = {
  maxDailyTokens: 10_000_000,
  maxDailyCalls: 50_000,
  spikeRatio: 5,
};

/** key 维度聚合（计量件——按 key 聚合 token/费用/次数） */
export interface KeyUsageAggregate {
  apiKeyId: string;
  totalTokens: number;
  totalCalls: number;
  totalCostUsd: number;
  byModel: Record<string, number>;
}

/** 计量件：按 key 聚合（cost 台账条目 → key 维度聚合——纯函数） */
export function aggregateByKeyUsage(entries: readonly CostLedgerEntry[]): Map<string, KeyUsageAggregate> {
  const out = new Map<string, KeyUsageAggregate>();
  for (const e of entries) {
    const agg = out.get(e.apiKeyId) ?? {
      apiKeyId: e.apiKeyId,
      totalTokens: 0,
      totalCalls: 0,
      totalCostUsd: 0,
      byModel: {},
    };
    agg.totalTokens += e.inputTokens + e.outputTokens;
    agg.totalCalls += 1;
    agg.totalCostUsd += e.costUsd;
    agg.byModel[e.model] = (agg.byModel[e.model] ?? 0) + e.inputTokens + e.outputTokens;
    out.set(e.apiKeyId, agg);
  }
  return out;
}

/** 异常检测结果（异常检测件——阈值外部化） */
export interface KeyAnomalyFinding {
  apiKeyId: string;
  kind: 'token-spike' | 'call-spike' | 'daily-limit-tokens' | 'daily-limit-calls';
  detail: string;
  /** 处置建议（处置件——执行动作回 router 侧，引擎只建议不执行） */
  recommendation: 'suspend' | 'throttle' | 'review';
}

/** 异常检测件：单 key 用量突增/模式异常判定（纯函数——today/yesterday 注入） */
export function detectKeyAnomalies(
  today: ReadonlyMap<string, KeyUsageAggregate>,
  yesterday: ReadonlyMap<string, KeyUsageAggregate>,
  thresholds: KeyAnomalyThresholds = DEFAULT_KEY_ANOMALY_THRESHOLDS,
): KeyAnomalyFinding[] {
  const findings: KeyAnomalyFinding[] = [];
  for (const [keyId, agg] of today) {
    if (agg.totalTokens > thresholds.maxDailyTokens) {
      findings.push({
        apiKeyId: keyId,
        kind: 'daily-limit-tokens',
        detail: `单 key 日 token ${agg.totalTokens} 超上限 ${thresholds.maxDailyTokens}`,
        recommendation: 'throttle',
      });
    }
    if (agg.totalCalls > thresholds.maxDailyCalls) {
      findings.push({
        apiKeyId: keyId,
        kind: 'daily-limit-calls',
        detail: `单 key 日调用 ${agg.totalCalls} 次超上限 ${thresholds.maxDailyCalls}`,
        recommendation: 'throttle',
      });
    }
    const y = yesterday.get(keyId);
    if (y && y.totalTokens > 0) {
      const ratio = agg.totalTokens / y.totalTokens;
      if (ratio > thresholds.spikeRatio) {
        findings.push({
          apiKeyId: keyId,
          kind: 'token-spike',
          detail: `token 用量突增：今日 ${agg.totalTokens} / 昨日 ${y.totalTokens} = ${ratio.toFixed(1)}× > 阈值 ${thresholds.spikeRatio}×`,
          recommendation: ratio > thresholds.spikeRatio * 2 ? 'suspend' : 'review',
        });
      }
    }
  }
  return findings;
}

/** 处置建议推送（处置件——生成推送文本；执行动作回 router 侧，引擎不碰 key 生命周期） */
export function formatKeyDisposition(finding: KeyAnomalyFinding): string {
  const action = finding.recommendation === 'suspend'
    ? '建议暂停该 key（suspend）——异常幅度大，先止血再排查'
    : finding.recommendation === 'throttle'
      ? '建议降配额（throttle）——超用量上限，限流继续观察'
      : '建议人工复核（review）——模式异常但幅度可控';
  return `[router-key-harness] key ${finding.apiKeyId} ${finding.kind}：${finding.detail}——${action}（处置执行回 router 侧，引擎只建议不执行）`;
}
