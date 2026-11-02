// ============================================================
// loop/engineer-decide.ts · engineer decide 层（v1.7.0 · P4）
// ============================================================
//
// 职责：LLM 输出结构化决策 JSON——「改什么文件 / 改什么 / 为什么」。
//       不做任何文件 I/O，纯决策层。
//
// 路由规则（经 ModelRouter）：
//   public / internal       → 云端 LLM（cloud-fast / cloud-strong）
//   restricted/confidential → 本地 Ollama（local-executor）
//
// decide JSON schema（主理人确认的最小 schema）：
//   { changes: [{ file, action: 'edit'|'create', description, diffHint }],
//     rationale: string }
//
// schema 校验失败 → 返回 null，由调用方（engineer 节点）走现有降级链。
// ============================================================

import { z } from 'zod';
import type { DecisionChannel, DecisionQuestion } from '../router/decision-channel';
import { applyWithShadowGate, buildJudgeState, type JudgeMode, type ShadowLedger } from '../router/judge-state';
import { ModelRouter, type ModelRoute } from '../model-router';

// ============================================================
// 路径安全校验（防 LLM 输出逃逸项目根）
// ============================================================
//
// 实现在顶层 path-guard.ts——loop/ 与 loop-agent/ 两个循环子系统共用同一份
// 守卫，避免各自演化出判据不一致的副本。此处 import 后 re-export，保持
// engineer-execute 与本包既有测试的引用路径不变。

import { isSafeRelativePath } from '../path-guard';

export { isSafeRelativePath };

// ============================================================
// decide JSON schema（zod 校验）
// ============================================================

/** 单条变更决策 */
export const EngineerChangeSchema = z.object({
  /** 目标文件路径（相对项目根，须过 isSafeRelativePath 校验） */
  file: z
    .string()
    .min(1)
    .refine(isSafeRelativePath, {
      message:
        'file 必须是仓库内相对路径（禁 ../ 逃逸、绝对路径、控制字符、$ 与反引号）',
    }),
  /** 变更动作 */
  action: z.enum(['edit', 'create']),
  /** 变更描述（人可读） */
  description: z.string().min(1),
  /** 关键代码片段或修改提示 */
  diffHint: z.string().default(''),
});

/** decide 层完整输出 schema */
export const EngineerDecideSchema = z.object({
  changes: z.array(EngineerChangeSchema).min(1),
  rationale: z.string().default(''),
});

export type EngineerChange = z.infer<typeof EngineerChangeSchema>;
export type EngineerDecide = z.infer<typeof EngineerDecideSchema>;

// ============================================================
// decide 层依赖注入
// ============================================================

/** decide 层运行时上下文 */
export interface EngineerDecideContext {
  /** 原始任务描述 */
  task: string;
  /** 当前子任务（engineer 逐条执行时传入；首轮可为空） */
  subtask?: string;
  /** 上一轮反馈（audit/review 未通过原因，重试轮传入） */
  feedback?: string;
  /** 降级等级（0=正常 / 1=已降级范围 / 2=低可信），拼入提示词 */
  degradationLevel?: number;
}

/**
 * decide 层依赖（测试可整体替换）
 */
export interface EngineerDecideDeps {
  /** LLM 调用：输入完整 prompt，输出 raw 文本 */
  callLLM: (prompt: string, route: ModelRoute) => Promise<string>;
  /** ModelRouter 实例（测试可注入 mock） */
  router?: ModelRouter;
  /** 日志输出 */
  log?: (msg: string) => void;
}

// ============================================================
// Prompt 构建（纯函数，可单测）
// ============================================================

/**
 * 构建 decide 层 prompt。
 * 降级等级 > 0 时在头部注入 [降级 L{n}] 提示。
 */
export function buildDecidePrompt(ctx: EngineerDecideContext): string {
  const lines: string[] = [];

  // 降级提示注入（v1.2.2 P4 降级路由链）
  if (ctx.degradationLevel === 1) {
    lines.push('[降级 L1] 先做最小可行版本——只实现核心路径，砍掉边缘情况与优化项。');
  } else if (ctx.degradationLevel === 2) {
    lines.push('[降级 L2] 低可信模式——给出最小改动，标注不确定处，交由人工兜底。');
  }

  lines.push(
    '# 变更决策',
    '分析以下任务，输出严格 JSON（不要多余文字）：',
    '{"changes":[{"file":"相对路径","action":"edit|create","description":"改什么","diffHint":"关键代码片段"}],"rationale":"为什么这样改"}',
    '',
    '# 任务',
    ctx.task.slice(0, 2000),
  );

  if (ctx.subtask) {
    lines.push('', '# 当前子任务', ctx.subtask.slice(0, 500));
  }
  if (ctx.feedback) {
    lines.push('', '# 上一轮反馈（只修复标记的问题）', ctx.feedback.slice(0, 2000));
  }

  return lines.join('\n');
}

// ============================================================
// decide JSON 解析（纯函数，可单测）
// ============================================================

/**
 * 从 LLM 输出中提取 JSON 块（兼容 ```json 围栏与裸 JSON）。
 */
export function extractDecideJson(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

/**
 * 解析 decide LLM 输出 → EngineerDecide。
 * zod 校验失败返回 null（调用方走降级链）。
 */
export function parseEngineerDecide(raw: string): EngineerDecide | null {
  try {
    const jsonText = extractDecideJson(raw);
    const parsed: unknown = JSON.parse(jsonText);
    const result = EngineerDecideSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

// ============================================================
// decide 主入口
// ============================================================

/** decide 结果：成功返回决策 + 路由信息；失败返回 null */
export interface EngineerDecideResult {
  decide: EngineerDecide;
  route: ModelRoute;
}

/**
 * engineer decide 层主入口：
 *   1. ModelRouter.route() 判定敏感度 + 路由目标
 *   2. 构建 prompt（含降级提示注入）
 *   3. 调 LLM（云端或本地，由 route.target 决定）
 *   4. zod 校验 decide JSON
 *   5. 校验失败 → 返回 null（走降级链）
 */
export async function engineerDecide(
  ctx: EngineerDecideContext,
  deps: EngineerDecideDeps,
): Promise<EngineerDecideResult | null> {
  const log = deps.log ?? (() => {});
  const router = deps.router ?? new ModelRouter();

  // 路由判定（decide 层专属：agentRole='engineer-decide'）
  const route = router.route(ctx.task, {
    agentRole: 'engineer-decide',
    userIntent: ctx.task.slice(0, 200),
  });
  log(`[decide] route target=${route.target} sensitivity=${route.sensitivity}`);

  // block 目标（confidential 超复杂等）→ 直接返回 null 走降级链
  if (route.target === 'block') {
    log(`[decide] 路由阻断：${route.blockReason ?? '未知原因'}`);
    return null;
  }

  const prompt = buildDecidePrompt(ctx);
  const raw = await deps.callLLM(prompt, route);
  if (!raw) {
    log('[decide] LLM 无输出，走降级链');
    return null;
  }

  const decide = parseEngineerDecide(raw);
  if (!decide) {
    log('[decide] decide JSON schema 校验失败，走降级链');
    return null;
  }

  return { decide, route };
}

// ============================================================
// 默认 LLM 调用（云端 / 本地，按 route.target 分发）
// ============================================================

/**
 * 默认 decide LLM 调用——按 route.target 分发云端/本地。
 * 云端：OpenAI 兼容接口（SOFAGENT_LLM_API_KEY）
 * 本地：Ollama /api/generate
 */

// ── decision-model 档接线（F5 R2-3）────────────────────────────
let decisionChannel: DecisionChannel | null = null;
let decisionQuestions: DecisionQuestion[] = [];

export function setDecisionChannel(ch: DecisionChannel | null, questions: DecisionQuestion[] = []): void {
  decisionChannel = ch;
  decisionQuestions = questions;
}

/** 影子门运行档（J3:144）：默认 shadow——判定照跑只落痕；live 须过对账（reconciled>0） */
let judgeMode: JudgeMode = 'shadow';
/** 影子期对账台账：由运维/部署侧回填（对账一次 +1）；reconciled=0 时 live 启用被拒 */
const shadowLedger: ShadowLedger = { reconciled: 0 };

/** 切换判定运行档（live 需先过影子期对账，ShadowGateError 拒绝） */
export function setJudgeMode(mode: JudgeMode, ledger?: ShadowLedger): void {
  judgeMode = mode;
  if (ledger) shadowLedger.reconciled = ledger.reconciled;
}

export async function runDecisionModel(prompt: string): Promise<string> {
  if (!decisionChannel) {
    throw new Error('decision-model 档未注入 DecisionChannel —— fail-closed，绝不回落生成模型');
  }
  const built = buildJudgeState(
    { text: prompt, evidenceReadiness: 'none' },
    { prefixFields: [], maxChars: 8000, consumer: 'loop/engineer-decide' },
  );
  if (!built.ok) {
    throw new Error(`判定 state ${built.reason}（${built.chars}/${built.maxChars}）——按处置序弃权，不截断`);
  }
  const r = await decisionChannel.judge(built.state, decisionQuestions);
  // 影子门（J3:144）：shadow 档判定照跑但 effective 恒为基线（不改变行为）；
  // live 档未过对账（reconciled=0）⇒ ShadowGateError 拒绝启用。判定结果落痕由
  // decision-log 侧承担（同源 payload_sha256），此处只管「是否生效」。
  const gated = applyWithShadowGate(
    judgeMode,
    shadowLedger,
    { grade: String((r as { answers?: unknown[] }).answers?.length ?? 0), target: 'decision-model' },
    { grade: '0', target: 'decision-model' },
  );
  if (gated.shadow) {
    // shadow：结果照常返回给审计链落痕，但标记未生效——调用方拿到的仍是判定答案，
    // 「不改变行为」由外层消费者按 applied=false 处置（与 J3:144「只落痕不影响行为」一致）。
    return JSON.stringify({ ...r, shadowApplied: false });
  }
  return JSON.stringify(r);
}

export async function defaultDecideCallLLM(prompt: string, route: ModelRoute): Promise<string> {
  try {
    if (route.target === 'local-executor' || route.target === 'local-pipeline') {
      return await callOllamaForDecide(prompt);
    }
    if (route.target === 'decision-model') {
      // 判定档不走生成模型：交 DecisionChannel 出类型化答案（F5 R2-3 接通）
      return await runDecisionModel(prompt);
    }
    // block 档是敏感数据的 fail-closed 出口：**绝不回落到云端**。
    // （此前的写法会让 block 落入下面的云端分支——confidential 数据被阻断后
    //   又被送到云端，违背数据主权铁律）
    if (route.target === 'block') return '';
    return await callCloudForDecide(prompt);
  } catch (err) {
    // 判定档失败必须外显（fail-closed），不得吞成空串——空串会让调用方把
    // 判定任务当「模型无输出」静默落回生成/空实现（S2 第 3 轮预阻塞③）。
    if (route.target === 'decision-model') throw err;
    return '';
  }
}

/** 云端 LLM 调用（OpenAI 兼容） */
async function callCloudForDecide(prompt: string): Promise<string> {
  const apiKey = process.env.SOFAGENT_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return '';
  const llmEnv = process.env.SOFAGENT_LLM ?? 'glm:glm-4-flash';
  const [provider, modelName] = llmEnv.split(':');
  const baseURLs: Record<string, string> = {
    glm: 'https://open.bigmodel.cn/api/paas/v4/',
    kimi: 'https://api.moonshot.cn/v1/',
    deepseek: 'https://api.deepseek.com/v1/',
  };
  const baseURL = provider === 'custom'
    ? (process.env.SOFAGENT_LLM_BASE_URL ?? '')
    : (baseURLs[provider ?? ''] ?? baseURLs['glm']!);
  if (!baseURL) return '';

  const res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelName || 'glm-4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return '';
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

/** 本地调用（Ollama /api/generate） */
async function callOllamaForDecide(prompt: string): Promise<string> {
  const endpoint = (process.env.SOFAGENT_OLLAMA_ENDPOINT ?? 'http://localhost:11434').replace(/\/$/, '');
  // 模型名不预设默认值：未配置即不调用——绝不请求一个猜出来的模型名
  // （那只会发出一次注定失败的请求，然后静默降级成空字符串）
  const model = process.env.SOFAGENT_OLLAMA_MODEL ?? '';
  if (!model) return '';
  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return '';
  const data = (await res.json()) as { response?: string };
  return data.response ?? '';
}
