// ============================================================
// decision-tree.ts · 对话分支回溯（v1.4.0 交付七 · P2）
// ============================================================
//
// 读 decisions.jsonl（v1.3.5 完整版）按 sessionId + moment 构建对话分支树——
// 浏览历史决策点 + 查看「选了什么 / 放弃了什么」。
// 复用 worklog-view 的纯文本 + emoji 惯例（零外部依赖）。
// 用法：node -e "console.log(renderDecisionTree('data/audit/decision-log.jsonl'))"
// ============================================================

import { readFileSync, existsSync } from 'fs';

/** decisions.jsonl 条目形状（v1.3.5 完整版的契约面） */
interface DecisionEntryShape {
  ts?: string;
  sessionId?: string;
  moment?: string;
  kind?: string;
  summary?: string;
  agentId?: string;
  /** 结构化详情（v1.3.0 交付 6 的 T01 决策详情） */
  details?: unknown;
}

/** 分支树节点 */
export interface DecisionTreeNode {
  /** 决策时间（ISO 8601 或原样） */
  ts: string;
  /** 决策类型（SPEC_CHANGE / TOOL_GATE / ...） */
  kind: string;
  /** 一句话摘要 */
  summary: string;
  /** 子分支（同一会话内按时间序的后续决策点） */
  children: DecisionTreeNode[];
}

/** 按 sessionId 分组的决策分支树 */
export interface DecisionTree {
  /** 会话 ID → 决策点序列 */
  sessions: Array<{
    sessionId: string;
    /** 该会话的决策树根（首决策点起） */
    root: DecisionTreeNode | null;
    /** 决策点总数 */
    count: number;
  }>;
}

function parseJsonl(filePath: string): DecisionEntryShape[] {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as DecisionEntryShape; } catch { return null; }
      })
      .filter((e): e is DecisionEntryShape => e !== null);
  } catch {
    return [];
  }
}

/**
 * 构建对话分支树：按 sessionId 分组，组内按 ts 排序，链式挂 children。
 * 「选了什么」= 每个决策点的 summary + kind；「放弃了什么」= 兄弟分支（同 moment 的并列决策点）。
 */
export function buildDecisionTree(entries: DecisionEntryShape[]): DecisionTree {
  const bySession = new Map<string, DecisionEntryShape[]>();
  for (const e of entries) {
    if (!e.sessionId) continue;
    const list = bySession.get(e.sessionId) ?? [];
    list.push(e);
    bySession.set(e.sessionId, list);
  }

  const sessions: DecisionTree['sessions'] = [];
  for (const [sessionId, list] of bySession) {
    // 组内按 ts 升序（决策演进顺序）
    const sorted = [...list].sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
    let root: DecisionTreeNode | null = null;
    let cursor: DecisionTreeNode | null = null;
    for (const e of sorted) {
      const node: DecisionTreeNode = {
        ts: e.ts ?? '',
        kind: e.kind ?? 'DECISION',
        summary: e.summary ?? '',
        children: [],
      };
      if (!root) root = node;
      if (cursor) cursor.children.push(node);
      cursor = node;
    }
    sessions.push({ sessionId, root, count: sorted.length });
  }

  // 按会话决策数降序（最活跃的会话在前）
  sessions.sort((a, b) => b.count - a.count);
  return { sessions };
}

/** 渲染分支树为终端 ASCII（缩进 + emoji + 决策类型标签） */
export function renderDecisionTree(filePath: string): string {
  const entries = parseJsonl(filePath);
  if (entries.length === 0) return '[sofagent] 无决策记录（运行编排/审计后产生 decision-log.jsonl）';
  const tree = buildDecisionTree(entries);
  const lines: string[] = [];
  lines.push('[sofagent] 对话分支回溯（decisions.jsonl）');
  if (tree.sessions.length === 0) {
    lines.push('（暂无会话决策——运行编排任务后产生）');
    return lines.join('\n');
  }
  for (const s of tree.sessions.slice(0, 10)) { // 最多展示 10 个会话
    lines.push(`\n📂 ${s.sessionId}（${s.count} 个决策点）`);
    const walk = (node: DecisionTreeNode, depth: number): void => {
      const indent = '  '.repeat(depth);
      const icon = node.kind === 'SPEC_CHANGE' ? '📝' : node.kind === 'TOOL_GATE' ? '🛡️' : node.kind === 'ESCALATE_REPORT' ? '🚨' : node.kind === 'EVOLUTION' ? '🧬' : '➡️';
      lines.push(`${indent}${icon} [${node.kind}] ${node.summary || '(无摘要)'} @ ${node.ts.slice(0, 19).replace('T', ' ')}`);
      for (const c of node.children) walk(c, depth + 1);
    };
    if (s.root) walk(s.root, 0);
  }
  return lines.join('\n');
}

/** 程序化查询：按 sessionId 取分支树（供 TUI/CLI 消费） */
export function querySessionTree(filePath: string, sessionId?: string): DecisionTree | DecisionTreeNode | null {
  const entries = parseJsonl(filePath);
  const tree = buildDecisionTree(entries);
  if (!sessionId) return tree;
  const s = tree.sessions.find((x) => x.sessionId === sessionId);
  return s?.root ?? null;
}
