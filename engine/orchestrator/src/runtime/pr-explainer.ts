// ============================================================
// pr-explainer.ts · auto-PR 决策解释块（v1.5.2 章二 · 理解债务应对）
// ============================================================
//
// 定位：AI 节点产出 PR（workflow 变更提案）时，随 PR 附「为什么这么做」
// 的决策解释块——引 decision-log 因果链（v1.5.2 字段 causedBy / causalType），
// 让 PR 自带可追溯的理由，而不只有「改了什么」（理解债务 S2 级故障面）。
//
// 复用（不重写——均为 @sofagent/audit 既有公开面，非自造第二套读日志逻辑）：
//   - loadDecisionLog(dataDir)：决策日志只读读面（坏行容忍）
//   - traceDecisionChain(entryId, dataDir)：因果链回溯 + 链式叙事
//
// 零写入：本模块只读 decision-log，不写任何文件。解释块文本由调用方挂到
// PR 上——当前唯一调用方是 MCP `pr_submit`（engine/mcp/src/tools/pr-tools.ts，
// AI 节点产出 PR 的既有链路），挂载点见 pr-tools.ts prSubmit 体内注释。
//
// 边界：本文件不产周报（周度摘要见 engine/daemon/src/inspectors/weekly-digest.ts）；
// 不新增审计规则、不动判定逻辑、不写 decision-log。
// ============================================================

import { loadDecisionLog, traceDecisionChain } from '@sofagent/audit';
import type { DecisionLogEntry } from '@sofagent/audit';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 解释块生成入参 */
export interface PrExplanationInput {
  /** 目标 workflow（PR 的变更对象——用它匹配相关决策） */
  workflowId: string;
  /** 提交者（PR submitter——其决策视为相关） */
  submitter: string;
  /** PR 标识（可选——出现在决策文本里也算相关） */
  prId?: string;
  /** 数据目录（缺省走 audit 的 getDataDir 解析链） */
  dataDir?: string;
  /** 决策窗口（天，缺省 7） */
  windowDays?: number;
  /** 最多引用几条因果链（缺省 3） */
  maxChains?: number;
  /** 相关决策取样上限（缺省 20——最近的优先） */
  maxRelevant?: number;
  /** 时间源注入（测试用） */
  now?: () => number;
}

/** 解释块生成结果 */
export interface PrExplanation {
  /** markdown 解释块（引因果链；可直接追加到 PR 变更描述） */
  block: string;
  /** 窗口内命中 PR 的相关决策条数 */
  citedDecisions: number;
  /** 实际引用的因果链条数 */
  causalChains: number;
  /** 窗口内决策日志总条数（读数取样口径） */
  scanned: number;
  /** 窗口起点（ISO 8601） */
  windowStart: string;
  /** 窗口终点（ISO 8601） */
  windowEnd: string;
}

// ────────────────────────────────────────────────────────────
// 内部工具
// ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** 单条链叙事截断（防止 PR 描述被超长理由撑爆） */
const NARRATIVE_MAX = 300;

/** why 文本抽取（schema 是 {text}，老日志/简化写入可能是裸 string——两种兼容） */
function whyTextOf(entry: DecisionLogEntry): string {
  const raw = entry.why as unknown;
  if (typeof raw === 'string') return raw;
  const text = (raw as { text?: string } | undefined)?.text;
  return typeof text === 'string' ? text : '';
}

/** 该决策是否与本 PR 相关（提交者本人 / 文本或产物引用提到 workflow 或 pr_id） */
function isRelevant(entry: DecisionLogEntry, workflowId: string, submitter: string, prId?: string): boolean {
  if (entry.agentId === submitter) return true;
  const haystack = `${entry.artifactRef ?? ''} ${entry.specRef ?? ''} ${whyTextOf(entry)}`;
  if (workflowId !== '' && haystack.includes(workflowId)) return true;
  if (prId !== undefined && prId !== '' && haystack.includes(prId)) return true;
  return false;
}

// ────────────────────────────────────────────────────────────
// 主入口
// ────────────────────────────────────────────────────────────

/**
 * 生成 auto-PR 决策解释块（同步、零写入——只读 decision-log）。
 *
 * 语义：窗口内挑「与本 PR 相关」的决策，取其中**带因果边**的最近 N 条，
 * 逐条经 traceDecisionChain 回溯成「根因 → 结果」链式叙事。窗口内没有
 * 可引用的因果链时**如实标注**（不编造依据）——解释块必须诚实，
 * 否则等于给理解债务加了一层伪装。
 */
export function buildPrDecisionExplanation(input: PrExplanationInput): PrExplanation {
  const now = input.now ?? Date.now;
  const windowDays = input.windowDays ?? 7;
  const maxChains = input.maxChains ?? 3;
  const maxRelevant = input.maxRelevant ?? 20;
  const endMs = now();
  const startMs = endMs - windowDays * DAY_MS;
  const windowStart = new Date(startMs).toISOString();
  const windowEnd = new Date(endMs).toISOString();

  // 决策日志只读（读面异常不阻断 PR 提交——降级为空窗口，但**不静默**：
  // 失败原因写进解释块，审计面能看到「这次解释块是降级产物」）
  let all: DecisionLogEntry[] = [];
  let readError = '';
  try {
    all = loadDecisionLog(input.dataDir);
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  const inWindow = all.filter((e) => {
    const ts = Date.parse(e.ts);
    return !Number.isNaN(ts) && ts >= startMs && ts <= endMs;
  });
  const relevant = inWindow.filter((e) => isRelevant(e, input.workflowId, input.submitter, input.prId));
  const sampled = relevant.slice(-maxRelevant);
  const chained = sampled.filter((e) => Array.isArray(e.causedBy) && e.causedBy.length > 0);
  // 最近在前——PR 审计面要看的是「最近一次为什么」
  const picked = chained.slice(-maxChains).reverse();

  const lines: string[] = [
    '## 决策解释（为什么这么做）',
    '',
    `> 依据 decision-log 因果链（causedBy / causalType）· 窗口 ${windowStart.slice(0, 10)} ~ ${windowEnd.slice(0, 10)}` +
      ` · 相关决策 ${relevant.length} 条（带因果边 ${chained.length} 条）`,
    '',
  ];

  if (readError !== '') {
    lines.push(`- ⚠ 决策日志读取失败（${readError}）——本次解释块为降级产物（窗口读不到决策，不静默放行）。`, '');
  }

  if (picked.length === 0) {
    lines.push(
      `- 窗口内未找到带因果边的相关决策（agent=${input.submitter} / workflow=${input.workflowId}）` +
        '——本 PR 无可引用因果链（如实标注，不编造依据）。',
    );
  } else {
    lines.push(`- 因果链 ${picked.length} 条（根因 → 结果）：`, '');
    for (const entry of picked) {
      const trace = traceDecisionChain(entry.ts, input.dataDir);
      const narrative =
        trace === undefined
          ? `${entry.ts.slice(11, 19)} ${entry.kind}：${whyTextOf(entry)}（因果链回溯不可用）`
          : trace.narrative.replace(/\n/g, ' ').trim();
      const clipped = narrative.length > NARRATIVE_MAX ? `${narrative.slice(0, NARRATIVE_MAX)}…` : narrative;
      const depth = trace?.chain.length ?? 1;
      lines.push(`  - \`${entry.ts}\`（链深 ${depth}）：${clipped}`);
    }
  }

  return {
    block: lines.join('\n'),
    citedDecisions: relevant.length,
    causalChains: picked.length,
    scanned: all.length,
    windowStart,
    windowEnd,
  };
}

/**
 * 把解释块挂到 PR 变更描述上（PR 无独立 body 字段——变更描述即 PR 的
 * 人读正文载体，解释块以分隔线追加，保证 PR 记录本身自带理由）。
 */
export function composePrBodyWithExplanation(title: string, explanation: PrExplanation): string {
  return `${title}\n\n---\n\n${explanation.block}`;
}
