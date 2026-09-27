// ============================================================
// multi-instance-vote.ts · v1.5.4 第四章 · 多实例自验证（并发小模型交叉表决）
// ============================================================
//
// 目标：同一任务并发跑 N 个小模型实例 → 结果交叉比对 → 多数表决产出；
// 实例分歧超阈值 → 路由人工介入队列（HITL 复用）或升级大模型重跑。
//
// 复用（**不改**既有语义）：模型调用基元走 @sofagent/core 的 `callModelAPI`
// （与 @sofagent/ab-test 的 ab-runner 同一原语）；多实例编排能力与
// `engine/mcp/src/tools/run-ab-test.ts` 同源——本模块只做「同任务 N 实例 +
// 交叉比对 + 表决 + 分歧路由」，不改造 AB 的 current/candidate 对比语义。
//
// 设计纪律：
//   - **fail-closed**：实例数 < 2 直接抛错（拒绝「单实例表决」这种伪表决）；
//     法定人数（quorum = ⌊N/2⌋+1）不足 → 判分歧并升级，绝不静默接受；
//   - **平票不可接受**：前二名票数相同即判分歧（tie 永不判共识）；
//   - 实例运行器可注入（测试注入确定性 runner；生产缺省走模型调用实现）。
// ============================================================

import { callModelAPI } from '@sofagent/core';
import type { ModelMessage } from '@sofagent/core';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 待表决任务 */
export interface VoteInstanceTask {
  /** 任务描述（user message） */
  task: string;
  /** 可选 system prompt（如 skill 文件内容 / 四层约束链） */
  systemPrompt?: string;
}

/** 单实例产出 */
export interface VoteInstanceOutput {
  /** 实例标识（缺省 vote-<slot+1>） */
  instanceId: string;
  /** 规范化后的答案键（交叉比对用——由 normalizeVoteValue 派生） */
  value: string;
  /** 原始输出（可选，诊断/审计用） */
  raw?: unknown;
}

/** 单实例运行期上下文（供 runner 制造实例间多样性） */
export interface InstanceContext {
  /** 实例标识 */
  instanceId: string;
  /** 实例序号（0-based） */
  slot: number;
  /** 该实例建议温度（缺省按 base + slot × step 展开） */
  temperature: number;
}

/** 实例运行器（可注入；缺省 = 模型调用实现） */
export type InstanceRunner = (
  task: VoteInstanceTask,
  ctx: InstanceContext,
) => Promise<VoteInstanceOutput>;

/** 表决配置 */
export interface MultiInstanceVoteConfig {
  /** 并发实例数 N（须 ≥ 2——否则 fail-closed 抛错） */
  instances: number;
  /** 任务描述 */
  task: string;
  /** 可选 system prompt */
  systemPrompt?: string;
  /** 分歧阈值（0..1）：winner 占比低于 (1 − 阈值) 即判分歧 */
  divergenceThreshold: number;
  /** 注入的实例运行器（缺省 = createModelInstanceRunner） */
  runner?: InstanceRunner;
  /** 分歧时的路由（缺省 hitl）；'escalate' = 升级大模型重跑 */
  onDivergence?: 'hitl' | 'escalate';
  /** 每实例超时（ms，缺省 120000） */
  instanceTimeoutMs?: number;
  /** 缺省温度基（缺省 0.2） */
  baseTemperature?: number;
  /** 温度步进（缺省 0.2——用于制造实例间多样性） */
  temperatureStep?: number;
}

/** 单值票数 */
export interface VoteTally {
  /** 该票值的规范化键 */
  value: string;
  /** 得票数 */
  count: number;
  /** 投该票的实例标识 */
  instanceIds: string[];
}

/** 表决结论 */
export type VoteDecision = 'consensus' | 'divergence';

/** 分歧路由 */
export type VoteRoute = 'accept' | 'hitl' | 'escalate';

/** 表决结果 */
export interface VoteOutcome {
  /** 结论：共识 / 分歧 */
  decision: VoteDecision;
  /** 相对多数票值（无有效票时为 null；即使分歧也报告，供 HITL 参考） */
  winner: string | null;
  /** 票数分布（降序；同票按键字典序稳定排序） */
  tally: VoteTally[];
  /** 成功实例数 */
  succeeded: number;
  /** 失败实例数 */
  failed: number;
  /** 法定人数（⌊N/2⌋+1） */
  quorum: number;
  /** 多数票占比（winner.count / succeeded；无有效票为 0） */
  agreement: number;
  /** 分歧度 = 1 − agreement */
  divergence: number;
  /** 是否平票（前二名票数相同） */
  tied: boolean;
  /** 路由结论：共识=accept；分歧=onDivergence；法定人数不足=escalate */
  route: VoteRoute;
  /** 失败实例详情 */
  errors: { instanceId: string; error: string }[];
  /** 成功实例的原始产出 */
  outputs: VoteInstanceOutput[];
}

// ────────────────────────────────────────────────────────────
// 错误类型
// ────────────────────────────────────────────────────────────

/** 表决配置/编排错误（fail-closed 用） */
export class MultiInstanceVoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultiInstanceVoteError';
  }
}

// ────────────────────────────────────────────────────────────
// 缺省配置
// ────────────────────────────────────────────────────────────

/** 缺省表决配置（N=3 / 分歧阈值 0.34 / 分歧路由 hitl） */
export const DEFAULT_VOTE_CONFIG: MultiInstanceVoteConfig = {
  instances: 3,
  task: '',
  divergenceThreshold: 0.34,
  onDivergence: 'hitl',
  instanceTimeoutMs: 120_000,
  baseTemperature: 0.2,
  temperatureStep: 0.2,
};

// ────────────────────────────────────────────────────────────
// 规范化 / 缺省运行器
// ────────────────────────────────────────────────────────────

/**
 * 把实例原始输出规范化为可比较的答案键（交叉比对用）。
 *
 * 优先级：字符串本位 → 常见答案字段（value/answer/decision/choice/result/label/verdict）
 * → 排序后 JSON（保证对象浅层键序稳定）。空输入 → 空串。
 */
export function normalizeVoteValue(output: unknown): string {
  if (output === null || output === undefined) return '';
  if (typeof output === 'string') return output.trim();
  if (typeof output !== 'object') return String(output);
  const obj = output as Record<string, unknown>;
  for (const key of ['value', 'answer', 'decision', 'choice', 'result', 'label', 'verdict']) {
    const v = obj[key];
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  try {
    const keys = Object.keys(obj).sort();
    const sorted: Record<string, unknown> = {};
    for (const k of keys) sorted[k] = obj[k];
    return JSON.stringify(sorted);
  } catch {
    return String(output);
  }
}

/**
 * 缺省实例运行器——走 @sofagent/core 的模型调用基元（与 ab-runner 同源）。
 *
 * 每个实例按 ctx.temperature 调用，制造实例间多样性；system prompt 缺省则不注入
 * （与 `SOFAGENT_LLM` 环境变量驱动的模型解析一致）。
 */
export function createModelInstanceRunner(): InstanceRunner {
  return async (task: VoteInstanceTask, ctx: InstanceContext): Promise<VoteInstanceOutput> => {
    const messages: ModelMessage[] = [];
    if (task.systemPrompt) messages.push({ role: 'system', content: task.systemPrompt });
    messages.push({ role: 'user', content: task.task });
    const raw = await callModelAPI(messages, { temperature: ctx.temperature });
    return { instanceId: ctx.instanceId, value: normalizeVoteValue(raw), raw };
  };
}

// ────────────────────────────────────────────────────────────
// 纯表决核心（无副作用——单独可测）
// ────────────────────────────────────────────────────────────

/**
 * 交叉比对 + 多数表决（纯函数）。
 *
 * fail-closed 规则（任一成立即判分歧）：
 *   ① 成功实例数 < 法定人数（quorum）——数据不足，路由 escalate；
 *   ② 平票（前二名票数相同）——tie 永不判共识；
 *   ③ 分歧度 > 阈值。
 *
 * @param params 成功产出 / 失败详情 / 实例总数 / 阈值 / 分歧路由
 * @returns 结构化表决结果
 */
export function summarizeVote(params: {
  outputs: VoteInstanceOutput[];
  errors: { instanceId: string; error: string }[];
  totalInstances: number;
  divergenceThreshold: number;
  onDivergence: 'hitl' | 'escalate';
}): VoteOutcome {
  const { outputs, errors, totalInstances, divergenceThreshold, onDivergence } = params;
  const succeeded = outputs.length;
  const failed = errors.length;
  const quorum = Math.floor(totalInstances / 2) + 1;

  // 计票（按规范化后的 value 聚合）
  const byValue = new Map<string, string[]>();
  for (const o of outputs) {
    const arr = byValue.get(o.value) ?? [];
    arr.push(o.instanceId);
    byValue.set(o.value, arr);
  }
  const tally: VoteTally[] = [...byValue.entries()]
    .map(([value, instanceIds]) => ({ value, count: instanceIds.length, instanceIds }))
    .sort((a, b) => (b.count - a.count) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));

  const top = tally[0];
  const winner = top ? top.value : null;
  const topCount = top ? top.count : 0;
  const secondCount = tally[1] ? tally[1].count : 0;
  const tied = tally.length > 1 && secondCount === topCount;

  const agreement = succeeded > 0 ? topCount / succeeded : 0;
  const divergence = 1 - agreement;

  const hasQuorum = succeeded >= quorum;
  const decision: VoteDecision =
    !hasQuorum || tied || divergence > divergenceThreshold ? 'divergence' : 'consensus';

  let route: VoteRoute;
  if (decision === 'consensus') route = 'accept';
  else if (!hasQuorum) route = 'escalate'; // 实例不足（含全失败）→ 升级大模型重跑
  else route = onDivergence;

  return {
    decision,
    winner,
    tally,
    succeeded,
    failed,
    quorum,
    agreement,
    divergence,
    tied,
    route,
    errors,
    outputs,
  };
}

// ────────────────────────────────────────────────────────────
// 编排：并发 N 实例 + 超时兜底
// ────────────────────────────────────────────────────────────

type Settled =
  | { ok: true; value: VoteInstanceOutput }
  | { ok: false; instanceId: string; error: string };

/** 带超时的实例调用——**不 reject**，统一归并为 Settled（供 Promise.all 聚合）。 */
function runInstanceWithTimeout(
  fn: () => Promise<VoteInstanceOutput>,
  ms: number,
  instanceId: string,
): Promise<Settled> {
  return new Promise<Settled>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, instanceId, error: `实例超时（${ms}ms）` });
    }, ms);
    fn().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, instanceId, error: err instanceof Error ? err.message : String(err) });
      },
    );
  });
}

/**
 * 多实例交叉表决（编排入口）。
 *
 * 同任务并发 N 实例 → 逐实例规范化 → 交叉比对 → 多数表决；分歧超阈值 / 法定人数
 * 不足 → 按 route 路由（HITL 人工队列 / 升级大模型重跑）。
 *
 * @param config 表决配置（缺省字段合并 DEFAULT_VOTE_CONFIG）
 * @returns 结构化表决结果
 * @throws MultiInstanceVoteError 实例数 < 2 或阈值越界（fail-closed）
 */
export async function runMultiInstanceVote(
  config: MultiInstanceVoteConfig,
): Promise<VoteOutcome> {
  const merged: MultiInstanceVoteConfig = { ...DEFAULT_VOTE_CONFIG, ...config };
  const n = merged.instances;

  if (!Number.isInteger(n) || n < 2) {
    throw new MultiInstanceVoteError(
      `多实例表决需要 ≥2 个实例（当前 instances=${n}）——fail-closed，拒绝单实例「表决」`,
    );
  }
  const threshold = merged.divergenceThreshold;
  if (!(typeof threshold === 'number') || !(threshold >= 0 && threshold <= 1)) {
    throw new MultiInstanceVoteError(
      `divergenceThreshold 须落在 [0,1]（当前 ${threshold}）`,
    );
  }

  const onDivergence: 'hitl' | 'escalate' = merged.onDivergence ?? 'hitl';
  const runner: InstanceRunner = merged.runner ?? createModelInstanceRunner();
  const timeoutMs = merged.instanceTimeoutMs ?? 120_000;
  const baseTemp = merged.baseTemperature ?? 0.2;
  const step = merged.temperatureStep ?? 0.2;

  const task: VoteInstanceTask = { task: merged.task };
  if (merged.systemPrompt !== undefined) task.systemPrompt = merged.systemPrompt;

  // 并发发起 N 实例（Promise.all 聚合——单实例失败不拖垮整批）
  const settled = await Promise.all(
    Array.from({ length: n }, (_, slot) =>
      runInstanceWithTimeout(
        () =>
          runner(task, {
            instanceId: `vote-${slot + 1}`,
            slot,
            temperature: baseTemp + slot * step,
          }),
        timeoutMs,
        `vote-${slot + 1}`,
      ),
    ),
  );

  const outputs: VoteInstanceOutput[] = [];
  const errors: { instanceId: string; error: string }[] = [];
  for (const r of settled) {
    if (r.ok) outputs.push(r.value);
    else errors.push({ instanceId: r.instanceId, error: r.error });
  }

  return summarizeVote({
    outputs,
    errors,
    totalInstances: n,
    divergenceThreshold: threshold,
    onDivergence,
  });
}
