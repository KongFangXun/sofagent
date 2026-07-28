// ============================================================
// loop/plan-node.ts · Planner 节点（v1.2.2 · P4）
// ============================================================
//
// 职责：把复杂任务拆成子任务列表，存入 LoopGraphState.artifacts.subtasks，
//       engineer 节点逐条消费（pending → done/skipped）。
//
// 图拓扑：START → plan → engineer → audit → reviewer → human_confirm → END
// （plan 是新增的第 5 个节点，不改其余 4+1 拓扑）
//
// 分层设计：
//   decide 层：LLM 输出结构化 JSON 子任务列表（经 ModelRouter 路由——
//              public/internal → 云端；restricted/confidential → 本地）
//   parse  层：纯确定性 JSON 解析 + zod 校验（本文件）
//
// Graph 状态落盘：plan 执行后写 {dataDir}/dashboard/graph-state.json
// （活跃节点名 + Work Graph 任务数），供 Dashboard Graph Engine 区块渲染。
// ============================================================

import { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { LoopGraphState, Subtask } from './state';
import { ModelRouter } from '../model-router';

// ============================================================
// decide JSON schema（zod 校验）
// ============================================================

/** Planner LLM 输出的单个子任务 */
export const PlanSubtaskSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
});

/** Planner LLM 输出的完整 decide JSON */
export const PlanDecideSchema = z.object({
  subtasks: z.array(PlanSubtaskSchema).min(1),
  rationale: z.string().default(''),
});

export type PlanDecide = z.infer<typeof PlanDecideSchema>;

// ============================================================
// Graph 状态落盘（data/dashboard/graph-state.json）
// ============================================================

/** graph-state.json schema（Dashboard Graph Engine 区块数据源） */
export interface GraphStateFile {
  /** 当前活跃节点名（plan / engineer / audit / reviewer / human_confirm） */
  activeNode: string;
  /** Work Graph 任务数（当前 subtasks 总数） */
  workGraphTasks: number;
  /** ISO 8601 更新时间 */
  updatedAt: string;
}

/**
 * 写 graph-state.json（原子写：tmp + rename 风格简化为直接覆盖写——
 * Dashboard 读侧 jq 解析失败时有兜底，不阻断主流程）。
 * 写失败静默：落盘是观测辅助通道，绝不 throw。
 *
 * @param dataDir 数据根目录（{SOFAGENT_DATA}，其下 dashboard/ 子目录）
 * @param activeNode 当前活跃节点名
 * @param workGraphTasks Work Graph 任务数
 */
export function writeGraphState(dataDir: string, activeNode: string, workGraphTasks: number): void {
  try {
    const dir = join(dataDir, 'dashboard');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload: GraphStateFile = {
      activeNode,
      workGraphTasks,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, 'graph-state.json'), JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // 观测落盘失败静默——不阻塞 LOOP 主流程
  }
}

// ============================================================
// Planner decide 层依赖注入
// ============================================================

/**
 * Planner 节点依赖（测试可整体替换）
 */
export interface PlanNodeDeps {
  /**
   * LLM decide 调用：输入任务描述，输出 raw JSON 字符串。
   * 默认实现走 ModelRouter 路由（见 defaultRunPlannerDecide）。
   */
  runPlannerDecide: (task: string) => Promise<string>;
  /** 日志输出 */
  log: (msg: string) => void;
  /** 数据目录（graph-state.json 落盘根路径）；不设置则跳过落盘 */
  dataDir?: string;
}

/**
 * 从 LLM 输出中提取 JSON 块（兼容 ```json ... ``` 围栏与裸 JSON）。
 * 纯函数，可单测。
 */
export function extractJsonBlock(raw: string): string {
  const fence = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fence) return fence[1]!.trim();
  // 裸 JSON：取第一个 { 到最后一个 }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

/**
 * 解析 Planner LLM 输出 → Subtask[]。
 * zod 校验失败返回 null（调用方走降级链）。
 * 纯函数，可单测。
 */
export function parsePlanDecide(raw: string): Subtask[] | null {
  try {
    const jsonText = extractJsonBlock(raw);
    const parsed: unknown = JSON.parse(jsonText);
    const result = PlanDecideSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data.subtasks.map((s) => ({
      id: s.id,
      description: s.description,
      status: 'pending' as const,
    }));
  } catch {
    return null;
  }
}

/**
 * 默认 Planner decide 实现——经 ModelRouter 路由：
 *   public/internal → 云端 LLM（cloud-strong / cloud-fast）
 *   restricted/confidential → 本地 Ollama（local-executor）
 * LLM 解析失败（SOFAGENT_LLM 未设置等）→ 返回空字符串，由调用方走降级链。
 */
export async function defaultRunPlannerDecide(task: string): Promise<string> {
  try {
    const router = new ModelRouter();
    const route = router.route(task, { agentRole: 'plan', userIntent: task.slice(0, 200) });

    const prompt = [
      '# 任务分解',
      '把以下复杂任务拆成 2-6 个可独立执行的子任务。',
      '输出严格 JSON（不要多余文字）：',
      '{"subtasks":[{"id":"subtask-1","description":"..."}],"rationale":"..."}',
      '',
      '# 原始任务',
      task.slice(0, 2000),
    ].join('\n');

    if (route.target === 'local-executor' || route.target === 'local-pipeline') {
      // 本地路径：Ollama /api/generate
      return await callOllamaForPlan(prompt);
    }
    // 云端路径：复用 SOFAGENT_LLM OpenAI 兼容接口
    return await callCloudForPlan(prompt);
  } catch {
    return '';
  }
}

/** 云端 LLM 调用（OpenAI 兼容，SOFAGENT_LLM_API_KEY） */
async function callCloudForPlan(prompt: string): Promise<string> {
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
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return '';
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

/** 本地 Ollama 调用（/api/generate） */
async function callOllamaForPlan(prompt: string): Promise<string> {
  const endpoint = (process.env.SOFAGENT_OLLAMA_ENDPOINT ?? 'http://localhost:11434').replace(/\/$/, '');
  const model = process.env.SOFAGENT_OLLAMA_MODEL ?? 'qwen2.5:7b';
  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return '';
  const data = (await res.json()) as { response?: string };
  return data.response ?? '';
}

// ============================================================
// LangGraph 节点工厂
// ============================================================

/**
 * 构造 plan 节点（LangGraph node function）。
 *
 * 行为：
 *   1. 调 deps.runPlannerDecide(task) 获取 LLM 输出
 *   2. parsePlanDecide 解析 + zod 校验
 *   3. 成功 → artifacts.subtasks 写入；失败 → 单条兜底子任务（不阻断流程）
 *   4. 写 graph-state.json（dataDir 提供时）
 */
export function makePlanNode(deps: PlanNodeDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log('📋 plan 任务分解中...');
    const raw = await deps.runPlannerDecide(state.artifacts.task);
    const subtasks = raw ? parsePlanDecide(raw) : null;

    // 解析失败 → 兜底：整任务作为单条子任务（不烧穿重试，不阻断 LOOP）
    const finalSubtasks: Subtask[] = subtasks ?? [
      { id: 'subtask-1', description: state.artifacts.task, status: 'pending' },
    ];
    if (!subtasks) {
      deps.log('⚠️ plan LLM 输出解析失败，降级为单条子任务（原始任务直通）');
    } else {
      deps.log(`📋 plan 分解完成：${finalSubtasks.length} 个子任务`);
    }

    // Graph 状态落盘（供 Dashboard Graph Engine 区块渲染）
    if (deps.dataDir) {
      writeGraphState(deps.dataDir, 'plan', finalSubtasks.length);
    }

    return {
      currentNode: 'plan',
      artifacts: { subtasks: finalSubtasks },
    };
  };
}
