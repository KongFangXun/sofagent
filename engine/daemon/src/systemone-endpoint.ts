// ============================================================
// systemone-endpoint.ts · `/v1/systemone` 兼容门面（v1.9.0 §五 协议面）
// ============================================================
//
// 定位：**适配层**，不是第二套契约。
//   - 对外：生态既有客户端（System One 线格式）可直接 POST /v1/systemone
//   - 对内：仍走 DecisionChannel 的 `judge(state, questions)` —— 门面不改签名、
//     不改三原语语义、不改弃权四态；只做「线格式 ↔ 内部对象」双向翻译
//
// 三条硬约束（v1.9.0 §五 验收原文）：
//   ① 默认环回绑定（`127.0.0.1`）：不显式配置就绝不对外监听
//   ② 请求内容不进日志：日志只记「类型 / 候选数 / 字符数 / 是否带 state」，
//      不记 state 原文与候选文本（判定输入是 state，原文落盘即等于复制客户数据）
//   ③ 自有契约不动：`judge(state, questions)` 签名与 DecisionResult 四字段不经门面改写
//
// 同族参照：`health-endpoint.ts` 的 loopback 默认绑定 + 纯函数注入形态。
// ============================================================

import http from 'http';
import type { DecisionQuestion, DecisionState, DecisionResult } from '@sofagent/orchestrator';

/** 线格式路径（生态事实标准苗头，见 v1.8.0 §五 协议面观察条） */
export const SYSTEMONE_PATH = '/v1/systemone';

/** 默认绑定地址——环回，外部不可达 */
export const DEFAULT_SYSTEMONE_HOST = '127.0.0.1';

/** 线格式请求（字段全部可选校验，非法即 400，不静默兜底） */
export interface SystemoneRequest {
  /** 原语：choice / noul / score */
  type: 'choice' | 'noul' | 'score';
  /** 指令（人读，进 state.text 的前缀说明位） */
  instructions?: string;
  /** 候选：choice 为字符串数组（≤5）；score 为 {min,max} 量程；noul 忽略 */
  criteria?: string[] | { min: number; max: number };
  /** 待判定输入 */
  state?: string;
  /** 问句标识（缺省 q1） */
  id?: string;
}

/** 门面响应（成功） */
export interface SystemoneResponse {
  type: 'choice' | 'noul' | 'score';
  /** choice：选中标签 */
  label?: string;
  /** choice：全候选分布 */
  probabilities?: Record<string, number>;
  /** noul / score：概率（score 为归一化锚点概率） */
  probability?: number;
  /** 弃权（四态语义原样透出，不在此翻译成 HTTP 错误） */
  abstained?: boolean;
  reason?: string;
  /**
   * 判定四态裁决（v1.9.0 §十 P-5 第 2 条——「返回体区分 allow / ask / veto / abstain
   * 四态，调用方可读；压扁成单一 error 即红」）：
   *   allow   判定通过（noul/score 概率 ≥ allow 阈；choice 选中项即建议）
   *   ask     不确定带（概率落在 ask 带内——须人工复核，非失败）
   *   veto    判定拒绝（概率 ≤ veto 阈——不建议执行）
   *   abstain 弃权（一等输出态——判不了，不是失败）
   * 与 abstained 布尔并存：布尔是 v1.8.0 兼容面，verdict 是 P-5 四态可读面。
   */
  verdict?: 'allow' | 'ask' | 'veto' | 'abstain';
}

/**
 * 四态裁决阈值（v1.9.0 P-5）——noul/score 概率的三段映射。
 * 口径与 decision-output.fourStateMapping 同族（分段阈值而非单点），但语义面不同：
 * 四态映射管「成立度分段」，本阈值管「处置建议档」——allow ≥ 0.75 /
 * ask 带 [0.45, 0.75) / veto ≤ 0.45（写死默认，调用方不可注入——阈值变更属
 * 判据治理面，不属协议门面）。
 */
export const SYSTEMONE_VERDICT_THRESHOLDS = { allowLower: 0.75, askLower: 0.45 } as const;

/** 概率 → 四态裁决（纯函数——确定性映射，同输入同输出） */
export function verdictOf(answered: boolean, probability: number | undefined): 'allow' | 'ask' | 'veto' | 'abstain' {
  if (!answered) return 'abstain';
  if (probability === undefined) return 'ask'; // 有答案无概率（choice 兼容面）→ 交人工
  if (probability >= SYSTEMONE_VERDICT_THRESHOLDS.allowLower) return 'allow';
  if (probability >= SYSTEMONE_VERDICT_THRESHOLDS.askLower) return 'ask';
  return 'veto';
}

/** 判定函数类型（门面只依赖这一个能力，便于注入测试） */
export type SystemoneJudge = (state: DecisionState, questions: DecisionQuestion[]) => Promise<DecisionResult>;

/** 门面依赖 */
export interface SystemoneDeps {
  judge: SystemoneJudge;
}

/** 绑定解析结果 */
export interface BindResolution {
  host: string;
  /** 是否对外暴露（非环回）——true 时调用方必须自行加鉴权与请求体上限 */
  publicExposed: boolean;
  /** 暴露告警（写入启动日志，不阻断——是否暴露是部署决策，但必须说出来） */
  warning?: string;
}

/**
 * 解析绑定地址。缺省环回；显式设为通配地址时返回告警（协议面默认安全姿态：
 * 不自带公网监听——见 v1.8.0 §五 参照「服务面默认安全姿态」）。
 */
export function resolveBindHost(env: NodeJS.ProcessEnv = process.env): BindResolution {
  const raw = (env.SOFAGENT_SYSTEMONE_HOST ?? '').trim();
  if (raw === '') return { host: DEFAULT_SYSTEMONE_HOST, publicExposed: false };
  const wildcard = raw === '0.0.0.0' || raw === '::' || raw === '*';
  if (wildcard) {
    return {
      host: raw,
      publicExposed: true,
      warning: `⚠️ /v1/systemone 绑定 ${raw}（对外暴露）——须自行加鉴权与请求体上限；缺省应为环回`,
    };
  }
  const loopback = raw === '127.0.0.1' || raw === '::1' || raw === 'localhost';
  return { host: raw, publicExposed: !loopback };
}

/** 日志脱敏结果——**零内容**：只留形态，不留原文 */
export interface RedactedRequestLog {
  type: string;
  criteriaCount: number;
  instructionsChars: number;
  stateChars: number;
  hasState: boolean;
}

/** 生成脱敏日志（不包含 state / instructions 的任何字符内容） */
export function redactRequestForLog(req: Partial<SystemoneRequest>): RedactedRequestLog {
  const criteria = req.criteria;
  const criteriaCount = Array.isArray(criteria) ? criteria.length : criteria ? 2 : 0; // {min,max} 记两界
  return {
    type: String(req.type ?? 'unknown'),
    criteriaCount,
    instructionsChars: typeof req.instructions === 'string' ? req.instructions.length : 0,
    stateChars: typeof req.state === 'string' ? req.state.length : 0,
    hasState: typeof req.state === 'string' && req.state.length > 0,
  };
}

/** 线格式 → 内部对象（翻译层唯一入口） */
export function toInternal(
  req: SystemoneRequest,
): { state: DecisionState; questions: DecisionQuestion[] } {
  const id = typeof req.id === 'string' && req.id.trim() !== '' ? req.id.trim() : 'q1';
  const state: DecisionState = {
    text: typeof req.state === 'string' ? req.state : '',
    evidenceReadiness: 'none',
  };
  const q: DecisionQuestion = { id, primitive: req.type };
  if (req.type === 'choice') {
    if (!Array.isArray(req.criteria) || req.criteria.length === 0) {
      throw new Error('choice 须给 criteria 字符串数组（候选集）');
    }
    q.options = req.criteria;
  } else if (req.type === 'score') {
    const c = req.criteria;
    if (!c || Array.isArray(c) || typeof c.min !== 'number' || typeof c.max !== 'number') {
      throw new Error('score 须给 criteria={min,max} 量程');
    }
    q.range = { min: c.min, max: c.max };
  }
  if (typeof req.instructions === 'string' && req.instructions.trim() !== '') {
    state.refs = [`instructions:${req.instructions.trim()}`];
  }
  return { state, questions: [q] };
}

/** 内部结果 → 线格式（弃权原样透出 + P-5 四态裁决并列） */
export function toWire(type: SystemoneRequest['type'], result: DecisionResult): SystemoneResponse {
  const answer = result.answers?.[0];
  if (!answer) return { type, abstained: true, reason: 'runner-no-answer', verdict: 'abstain' };
  const abstained = answer.status === 'abstained';
  if (abstained) return { type, abstained: true, reason: answer.abstainReason, verdict: 'abstain' };
  if (type === 'choice') {
    const dist = answer.distribution ?? {};
    const label = String(answer.value ?? Object.entries(dist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '');
    return { type, label, probabilities: dist, abstained: false, verdict: verdictOf(true, answer.probability) };
  }
  return { type, probability: answer.probability, abstained: false, verdict: verdictOf(true, answer.probability) };
}

/** 处理一次请求（纯函数形态——便于单测，不起 socket） */
export async function handleSystemoneRequest(
  rawBody: string,
  deps: SystemoneDeps,
): Promise<{ status: number; body: SystemoneResponse | { error: string }; log: RedactedRequestLog }> {
  let parsed: SystemoneRequest;
  try {
    parsed = JSON.parse(rawBody) as SystemoneRequest;
  } catch {
    return { status: 400, body: { error: 'body 不是合法 JSON' }, log: redactRequestForLog({}) };
  }
  if (parsed.type !== 'choice' && parsed.type !== 'noul' && parsed.type !== 'score') {
    return { status: 400, body: { error: `type 非法（${String(parsed.type)}）——取 choice/noul/score` }, log: redactRequestForLog(parsed) };
  }
  let internal: { state: DecisionState; questions: DecisionQuestion[] };
  try {
    internal = toInternal(parsed);
  } catch (err) {
    return {
      status: 400,
      body: { error: err instanceof Error ? err.message : String(err) },
      log: redactRequestForLog(parsed),
    };
  }
  try {
    const result = await deps.judge(internal.state, internal.questions);
    return { status: 200, body: toWire(parsed.type, result), log: redactRequestForLog(parsed) };
  } catch (err) {
    // 判定件不可用 = 502（上游故障），不假装 200 的空分布
    return {
      status: 502,
      body: { error: `判定通道失败：${err instanceof Error ? err.message : String(err)}` },
      log: redactRequestForLog(parsed),
    };
  }
}

/** 端点配置 */
export interface SystemoneEndpointOptions {
  /** 端口（缺省 8799） */
  port?: number;
  /** 绑定地址（缺省取 resolveBindHost） */
  host?: string;
  /** 判定能力（生产传 DecisionChannel.judge 绑定） */
  deps: SystemoneDeps;
  /** 日志出口（缺省 console.log；只收脱敏形态） */
  log?: (line: string) => void;
}

/** 端点句柄 */
export interface SystemoneEndpointHandle {
  host: string;
  port: number;
  close(): void;
}

/**
 * 启动 `/v1/systemone` 门面（loopback 默认绑定）。
 * 仅接受 POST；其余路径 404、其余方法 405（默认拒绝，不猜）。
 */
export function startSystemoneEndpoint(options: SystemoneEndpointOptions): SystemoneEndpointHandle {
  const bind = resolveBindHost();
  const host = options.host ?? bind.host;
  const port = options.port ?? 8799;
  const log = options.log ?? ((line: string) => console.log(line));
  if (bind.warning) log(bind.warning);

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.url !== SYSTEMONE_PATH && req.url !== `${SYSTEMONE_PATH}/`) {
      send(404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      send(405, { error: 'method not allowed' });
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void handleSystemoneRequest(Buffer.concat(chunks).toString('utf-8'), options.deps)
        .then((r) => {
          // 脱敏日志：形态进日志，内容不落盘
          log(`[systemone] ${r.status} type=${r.log.type} criteria=${r.log.criteriaCount} stateChars=${r.log.stateChars}`);
          send(r.status, r.body);
        })
        .catch((err: unknown) => {
          send(500, { error: err instanceof Error ? err.message : String(err) });
        });
    });
  });
  server.listen(port, host);
  return {
    host,
    port,
    close: () => {
      try { server.close(); } catch { /* 为何可静默：close 幂等，重复关闭无副作用且无降级信息可报 */ }
    },
  };
}
