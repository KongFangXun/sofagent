// ============================================================
// route-request.ts · 入口路由（v1.3.3 交付 T01）
//
// 把一个用户请求路由到 workflow 节点或 fallback 直答路径。
// 路由是编排的第一步——决定「交给 workflow 编排」还是「直接单 Agent 回答」。
//
// 路由规则（协议设计 §6）：
//   1. task 语义匹配——请求文本与 workflow 节点的 task 描述做关键词 / 语义匹配
//   2. type 校验——loop/auto 节点可路由进 workflow；manual 节点走 fallback
//
// 节点 emoji 约定（来自 compose 产出的 workflow YAML）：
//   ⚡（auto）→ 自动执行节点，可路由进 workflow
//   🔄（loop）→ 循环引擎节点，可路由进 workflow
//   👤（manual）→ 人工节点（HITL），走 fallback（人工确认不走自动编排）
// ============================================================

import type { WorkflowNode, ParsedWorkflow } from '../workflow-parser';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 路由请求入参 */
export interface RouteRequestInput {
  /** 用户请求文本（自然语言，如「帮我写一份财报分析」） */
  task: string;
  /** 已解析的 workflow（含全部节点）。为空 / 无节点时直接 fallback */
  workflow: ParsedWorkflow;
}

/** 可路由进 workflow 的结果 */
export interface RouteWorkflowResult {
  route: 'workflow';
  /** 命中的 workflow 节点 */
  node: WorkflowNode;
  /** 匹配得分（0-1，越高越匹配——用于调试 / 日志） */
  score: number;
}

/** 走 fallback 直答的结果 */
export interface RouteFallbackResult {
  route: 'fallback';
  /** fallback 原因（人类可读） */
  reason: string;
}

/** 路由结果（workflow 命中 或 fallback） */
export type RouteResult = RouteWorkflowResult | RouteFallbackResult;

// ────────────────────────────────────────────────────────────
// 关键词提取 + 语义匹配
// ────────────────────────────────────────────────────────────

/** 停用词（中英常见虚词——匹配时忽略，减少噪声） */
const STOP_WORDS = new Set<string>([
  // 中文虚词
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '把', '被',
  '帮', '给', '一下', '一个', '这个', '那个', '什么', '怎么', '为什么',
  '请', '麻烦', '可以', '能够', '需要', '想要', '要做',
  // 英文虚词
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
  'help', 'please', 'need', 'want', 'do', 'make', 'get',
]);

/**
 * 从文本中提取关键词（分词后去停用词、去短词、去标点）。
 *
 * 纯规则分词（非 LLM）——按空格 / 标点切分 + 中文按 2-4 字滑窗。
 * 这是 MVP 级匹配，满足路由判定即可（不需要 NLP 级精度）。
 *
 * @param text 输入文本
 * @returns 关键词集合（小写、去重）
 */
function extractKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  const keywords = new Set<string>();

  // 1. 空格 / 标点切分（处理英文 + 中文混排）
  const tokens = normalized.split(/[\s,，。.;；!！?？、:：/\\()（）\[\]【】"'`'']+|/).filter(Boolean);
  for (const token of tokens) {
    if (token.length < 2) continue; // 去单字
    if (STOP_WORDS.has(token)) continue;
    keywords.add(token);
  }

  // 2. 中文滑窗（2-4 字子串——弥补无词典分词）
  // 去标点后连续中文段做 2-gram 提取
  const cjkSegments = normalized.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjkSegments) {
    if (seg.length < 2) continue;
    // 2-gram + 3-gram
    for (let size = 2; size <= Math.min(3, seg.length); size++) {
      for (let i = 0; i <= seg.length - size; i++) {
        const gram = seg.slice(i, i + size);
        if (!STOP_WORDS.has(gram)) {
          keywords.add(gram);
        }
      }
    }
  }

  return [...keywords];
}

/**
 * 计算请求与节点 task 的语义匹配得分（0-1）。
 *
 * 打分逻辑（Jaccard 相似度变体）：
 *   score = |请求关键词 ∩ 节点关键词| / |请求关键词 ∪ 节点关键词|
 *
 * 额外加权：请求关键词是节点 task 子串时（包含匹配）加分，
 * 弥补分词粗糙导致的漏匹配。
 *
 * @param requestKeywords 请求关键词
 * @param nodeKeywords 节点 task 关键词
 * @param requestText 原始请求文本（用于子串匹配加权）
 * @param nodeTask 节点 task 原文
 * @returns 匹配得分 0-1
 */
function computeScore(
  requestKeywords: string[],
  nodeKeywords: string[],
  requestText: string,
  nodeTask: string,
): number {
  if (requestKeywords.length === 0 || nodeKeywords.length === 0) return 0;

  const reqSet = new Set(requestKeywords);
  const nodeSet = new Set(nodeKeywords);

  // Jaccard 交集
  let intersection = 0;
  for (const kw of reqSet) {
    if (nodeSet.has(kw)) intersection++;
  }
  const union = new Set([...reqSet, ...nodeSet]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // 子串包含加权：请求原文是否含节点 task 关键词（更宽松的匹配）
  let containBoost = 0;
  for (const kw of nodeKeywords) {
    if (requestText.includes(kw)) containBoost += 0.15;
  }
  containBoost = Math.min(containBoost, 0.3); // 上限 0.3，避免过度加权

  // 节点 task 是否含请求关键词（反向包含——请求精确命中节点描述）
  let reverseBoost = 0;
  for (const kw of requestKeywords) {
    if (nodeTask.includes(kw)) reverseBoost += 0.1;
  }
  reverseBoost = Math.min(reverseBoost, 0.2);

  return Math.min(1, jaccard + containBoost + reverseBoost);
}

// ────────────────────────────────────────────────────────────
// 路由阈值
// ────────────────────────────────────────────────────────────

/** 匹配得分阈值——≥此值才路由进 workflow，否则 fallback */
const MATCH_THRESHOLD = 0.2;

// ────────────────────────────────────────────────────────────
// 主函数
// ────────────────────────────────────────────────────────────

/**
 * 入口路由——把请求路由到 workflow 节点或 fallback 直答。
 *
 * 路由逻辑：
 *   1. workflow 为空 / 无节点 → fallback（reason: 无可用 workflow）
 *   2. 遍历节点，计算每个节点的 task 匹配得分
 *   3. 过滤掉 manual 节点（type='manual' / hitl=true → 走 fallback，人工不走自动编排）
 *   4. 取得分最高且 ≥ MATCH_THRESHOLD 的节点 → route='workflow'
 *   5. 无命中 → fallback（reason: 未匹配任何 workflow 节点）
 *
 * @param input 路由请求（task + workflow）
 * @returns RouteResult
 */
export function routeRequest(input: RouteRequestInput): RouteResult {
  const { task, workflow } = input;

  // ── 1. workflow 为空 → fallback ──
  if (!workflow || !workflow.nodes || workflow.nodes.length === 0) {
    return {
      route: 'fallback',
      reason: '无可用 workflow 节点（workflow 为空或未解析）',
    };
  }

  // ── 2. 请求文本为空 → fallback ──
  if (!task || task.trim() === '') {
    return {
      route: 'fallback',
      reason: '请求文本为空',
    };
  }

  const requestKeywords = extractKeywords(task);
  const requestText = task.toLowerCase();

  // ── 3. 遍历节点计算得分，过滤 manual 节点 ──
  let bestNode: WorkflowNode | undefined;
  let bestScore = 0;

  for (const node of workflow.nodes) {
    // manual 节点（👤）不走自动路由——人工确认交给 HITL 流程，不进 workflow 编排
    if (node.type === 'manual' || node.hitl === true) {
      continue;
    }

    const nodeKeywords = extractKeywords(node.task);
    const score = computeScore(requestKeywords, nodeKeywords, requestText, node.task.toLowerCase());

    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  // ── 4. 最高分 ≥ 阈值 → 命中 workflow ──
  if (bestNode && bestScore >= MATCH_THRESHOLD) {
    return {
      route: 'workflow',
      node: bestNode,
      score: Number(bestScore.toFixed(4)),
    };
  }

  // ── 5. 未命中 → fallback ──
  return {
    route: 'fallback',
    reason: `请求未匹配任何 workflow 节点（最高得分 ${bestScore.toFixed(4)} < 阈值 ${MATCH_THRESHOLD}）`,
  };
}
