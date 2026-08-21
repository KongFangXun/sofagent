// ============================================================
// loop/plan-node.ts · Planner 节点（v1.3.9 · P4）
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
import type { AuditVerdict, LoopGraphState, Subtask } from './state';
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
// v1.2.3：三字段升级为完整控制图（nodes/edges/wave/degradationLevel），
//         旧三字段（activeNode/workGraphTasks/updatedAt）保留——
//         Dashboard bash v1.2.2 读侧（jq // 兜底）不崩溃
// ============================================================

/** 节点执行状态 */
export type GraphNodeStatus = 'pending' | 'running' | 'completed' | 'failed';

/** graph-state.json 子任务（engineer 节点进度明细） */
export interface GraphStateSubtask {
  id: string;
  desc: string;
  status: 'pending' | 'done' | 'skipped';
}

/** graph-state.json 节点 */
export interface GraphStateNode {
  /** 节点实例 id（plan / engineer-1 / audit-1 / reviewer-1 / human-1） */
  id: string;
  /** 节点类型 */
  type: 'planner' | 'engineer' | 'audit' | 'reviewer' | 'human';
  /** 展示名 */
  label: string;
  status: GraphNodeStatus;
  /** engineer 节点的子任务进度（其余节点无此字段） */
  subtasks?: GraphStateSubtask[];
}

/** graph-state.json 边 */
export interface GraphStateEdge {
  from: string;
  to: string;
  type: 'data-flow';
}

/**
 * graph-state.json schema（Dashboard Graph Engine 区块数据源）。
 * v1.2.3 完整控制图结构 + 旧三字段保留（向后兼容）。
 */
export interface GraphStateFile {
  /** 控制图节点列表（按图拓扑顺序） */
  nodes: GraphStateNode[];
  /** 控制图边列表（data-flow） */
  edges: GraphStateEdge[];
  /** 波次 = retryCount + 1（架构师裁决 Q2） */
  wave: number;
  /** 降级等级：0=正常 / 1=范围降级 / 2=低可信 */
  degradationLevel: number;
  /** 当前活跃节点名（旧字段，保留） */
  activeNode: string;
  /** Work Graph 任务数（旧字段，保留） */
  workGraphTasks: number;
  /** ISO 8601 更新时间（旧字段，保留；每次状态变更刷新） */
  updatedAt: string;
}

/** writeGraphState 输入——各节点调用点按当前状态传入 */
export interface GraphStateInput {
  /** 当前活跃节点名（plan / engineer / audit / reviewer / human_confirm） */
  activeNode: string;
  /** 重试次数（wave = retryCount + 1，缺省 0） */
  retryCount?: number;
  /** 降级等级（缺省 0） */
  degradationLevel?: number;
  /** 子任务列表（engineer 节点进度 + workGraphTasks 数据源） */
  subtasks?: Subtask[];
  /** audit 判定（audit 节点完成后回写：PASS/WARN → completed，FAIL → failed） */
  auditResult?: AuditVerdict | null;
  /** 终态（completed → 全部节点 completed；blocked → 活跃节点 failed） */
  finalStatus?: string;
}

/**
 * 控制图节点定义——顺序与 graph.ts 拓扑一致：
 * plan → engineer → audit → reviewer → human_confirm
 */
const GRAPH_NODE_DEFS = [
  { name: 'plan', id: 'plan', type: 'planner', label: 'Planner' },
  { name: 'engineer', id: 'engineer-1', type: 'engineer', label: 'Engineer' },
  { name: 'audit', id: 'audit-1', type: 'audit', label: 'Audit' },
  { name: 'reviewer', id: 'reviewer-1', type: 'reviewer', label: 'Reviewer' },
  { name: 'human_confirm', id: 'human-1', type: 'human', label: 'Human Confirm' },
] as const;

/**
 * 由当前 LOOP 状态推导完整控制图文件内容（纯函数，可单测）。
 *
 * 节点状态推导：
 * - 活跃节点之前的节点 → completed；活跃节点 → running；之后 → pending
 * - finalStatus='completed' → 全部 completed
 * - finalStatus='blocked' → 活跃节点 failed
 * - audit 节点携带 auditResult 时覆盖：PASS/WARN → completed，FAIL → failed
 */
export function buildGraphStateFile(input: GraphStateInput): GraphStateFile {
  const activeIdx = GRAPH_NODE_DEFS.findIndex((d) => d.name === input.activeNode);

  const nodes: GraphStateNode[] = GRAPH_NODE_DEFS.map((def, i) => {
    let status: GraphNodeStatus;
    if (input.finalStatus === 'completed') {
      status = 'completed';
    } else if (activeIdx === -1) {
      // 未知活跃节点——兜底全 pending，不崩溃
      status = 'pending';
    } else if (i < activeIdx) {
      status = 'completed';
    } else if (i === activeIdx) {
      status = input.finalStatus === 'blocked' ? 'failed' : 'running';
    } else {
      status = 'pending';
    }
    // audit 节点完成后回写判定结果
    if (def.name === 'audit' && input.auditResult) {
      status = input.auditResult === 'FAIL' ? 'failed' : 'completed';
    }
    const node: GraphStateNode = { id: def.id, type: def.type, label: def.label, status };
    if (def.name === 'engineer' && input.subtasks) {
      node.subtasks = input.subtasks.map((s) => ({ id: s.id, desc: s.description, status: s.status }));
    }
    return node;
  });

  const edges: GraphStateEdge[] = [];
  for (let i = 0; i < GRAPH_NODE_DEFS.length - 1; i++) {
    edges.push({ from: GRAPH_NODE_DEFS[i]!.id, to: GRAPH_NODE_DEFS[i + 1]!.id, type: 'data-flow' });
  }

  return {
    nodes,
    edges,
    // wave 语义 = retryCount + 1（架构师裁决 Q2）
    wave: (input.retryCount ?? 0) + 1,
    degradationLevel: input.degradationLevel ?? 0,
    // 旧三字段保留（Dashboard bash v1.2.2 读侧 jq // 兜底兼容）
    activeNode: input.activeNode,
    workGraphTasks: input.subtasks?.length ?? 0,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 写 graph-state.json（覆盖写——Dashboard 读侧 jq 解析失败时有兜底，
 * 不阻断主流程）。写失败静默：落盘是观测辅助通道，绝不 throw。
 *
 * @param dashboardDir Dashboard 数据根目录（v1.2.3 AD-2 路径修复：
 *   $SOFAGENT_HOME/data，其下 dashboard/ 子目录；由 LoopGraphDeps.dashboardDir
 *   注入，不再使用 loadEnvConfig 的仓库内 fallback 路径）
 * @param input 当前 LOOP 状态快照
 */
export function writeGraphState(dashboardDir: string, input: GraphStateInput): void {
  try {
    const dir = join(dashboardDir, 'dashboard');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'graph-state.json'), JSON.stringify(buildGraphStateFile(input), null, 2), 'utf-8');
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
  /** 数据目录（旧注点，dashboardDir 未设置时兜底）；不设置则跳过落盘 */
  dataDir?: string;
  /**
   * Dashboard 数据目录（v1.2.3 AD-2 路径修复注点：$SOFAGENT_HOME/data）。
   * 优先级高于 dataDir——graph-state.json 写到 Dashboard bash 实际读取的位置。
   */
  dashboardDir?: string;
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
    // v1.2.3：dashboardDir 优先（AD-2 路径修复），dataDir 兜底（向后兼容）；
    // plan 完成 → 写入 plan completed + engineer running（活跃节点前移）
    const dashDir = deps.dashboardDir ?? deps.dataDir;
    if (dashDir) {
      writeGraphState(dashDir, {
        activeNode: 'engineer',
        retryCount: state.retryCount,
        degradationLevel: state.degradationLevel,
        subtasks: finalSubtasks,
      });
    }

    return {
      currentNode: 'plan',
      artifacts: { subtasks: finalSubtasks },
    };
  };
}
