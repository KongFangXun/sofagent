// ============================================================
// gap-analyzer.ts · workflow 能力缺口分析（G2）
// ============================================================
//
// 商业平台「悬赏」数据源——分析 workflow 与实际执行的落差，产出
// 机器可读的缺口清单（workflow_id + node + 缺口类型），可被商业
// 平台消费转悬赏（招募新 Agent / 升级现有 Agent）。
//
// 三类缺口判定：
//   missing_agent  缺人——workflow-store 里声明了节点但 worklog 无该
//                  agent 任何执行记录（从未上岗）
//   low_capability 缺能力——有执行记录但人工介入率高（escalate 占比
//                  ≥ 30%——干不好老要求人接管）
//   needs_upgrade  待升级——retry 占比高（首次通过率 < 50%——反复
//                  重试说明能力版本落后于任务难度）
//
// 数据源：
//   - workflow-store（G14 产出的对象库——声明的节点面）
//   - worklog（aggregator 三源聚合——实际执行面）
//
// 设计约束：
//   - 纯读分析（零写入）——不改 workflow 不改 worklog
//   - 空数据降级不 crash（无 workflow-store / 无 worklog 都返回空清单 + 提示）
//   - ontology lifecycle 联动：needs_upgrade 节点对照 ontology 待升级态
//     （entity-store 生命周期字段缺省视为 stable——如实标注不臆造）
// ============================================================

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { WorklogAggregator } from './worklog/aggregator';
import type { StoredWorkflow } from './crud/workflow-store';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 缺口类型（三类——商业平台悬赏的三个招式） */
export type GapKind = 'missing_agent' | 'low_capability' | 'needs_upgrade';

/** 单条缺口 */
export interface WorkflowGap {
  /** 缺口类型 */
  kind: GapKind;
  /** workflow 标识 */
  workflow_id: string;
  /** 节点 id */
  node: string;
  /** agent 类型（声明的） */
  agent: string;
  /** 证据描述（机器可读 + 人类可读） */
  evidence: string;
}

/** 分析结果 */
export interface GapAnalysisResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    /** 缺口清单（可被商业平台消费转悬赏） */
    gaps: Array<WorkflowGap & Record<string, unknown>>;
    /** 统计（三类各几条） */
    summary: { missing_agent: number; low_capability: number; needs_upgrade: number; total: number };
    /** 扫描的 workflow 数 */
    scanned: number;
    /** 分析窗口（天）——人工介入/retry 占比的统计口径 */
    windowDays: number;
  };
}

/** 判定阈值（可调参——默认值对齐「明显异常」口径，不做细粒度调优；逐字段可选覆盖 DEFAULT_THRESHOLDS） */
export interface GapThresholds {
  /** 人工介入占比 ≥ 此值判 low_capability（0-1；缺省 0.3） */
  humanInterventionRate?: number;
  /** 首次通过率 < 此值判 needs_upgrade（0-1；缺省 0.5） */
  firstPassRate?: number;
  /** 统计窗口天数（缺省 30） */
  windowDays?: number;
}

export const DEFAULT_THRESHOLDS: Required<GapThresholds> = {
  humanInterventionRate: 0.3,
  firstPassRate: 0.5,
  windowDays: 30,
};

// ────────────────────────────────────────────────────────────
// 分析实现
// ────────────────────────────────────────────────────────────

/**
 * 分析 workflow 能力缺口（纯读零写入）。
 *
 * @param dataDir 数据目录（workflow-store + worklog 同根）
 * @param thresholds 判定阈值（缺省 DEFAULT_THRESHOLDS）
 */
export function analyzeWorkflowGaps(
  dataDir: string,
  thresholds: GapThresholds = DEFAULT_THRESHOLDS,
): GapAnalysisResult {
  // 合并阈值（显式覆盖优先）——展开后所有字段必填（供下游无 undefined 访问）
  const t: Required<GapThresholds> = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const gaps: Array<WorkflowGap & Record<string, unknown>> = [];

  // ── 数据面 1：workflow-store（声明的节点面）──
  const storeDir = join(dataDir, 'workflow-store');
  const workflows: StoredWorkflow[] = [];
  if (existsSync(storeDir)) {
    for (const f of readdirSync(storeDir)) {
      // 只读 trunk（branch 是未合并提案——不算在役节点面）
      if (!f.endsWith('.json') || f.includes('.branch-')) continue;
      try {
        workflows.push(JSON.parse(readFileSync(join(storeDir, f), 'utf-8')) as StoredWorkflow);
      } catch {
        // 损坏文件跳过（分析面不 crash——如实少扫一个）
      }
    }
  }

  // ── 数据面 2：worklog（实际执行面——按 agent 聚合）──
  const aggregator = new WorklogAggregator({ dataDir });
  const agentWorklogs = aggregator.aggregateByAgent();
  const windowStart = new Date(Date.now() - t.windowDays * 86_400_000).toISOString();

  // agent → 窗口内执行统计
  const agentStats = new Map<
    string,
    { tasks: number; humanInterventions: number; retries: number }
  >();
  for (const aw of agentWorklogs) {
    let tasks = 0;
    let human = 0;
    let retries = 0;
    for (const task of aw.tasks) {
      if (task.lastSeen < windowStart) continue; // 窗口外不计
      tasks += 1;
      human += task.humanInterventions;
      retries += task.retries;
    }
    if (tasks > 0) agentStats.set(aw.agentId, { tasks, humanInterventions: human, retries });
  }

  // ── 三类判定 ──
  for (const wf of workflows) {
    for (const node of wf.workflow.nodes) {
      // 一类：missing_agent——该 agent 在 worklog 无任何窗口内执行记录
      const stats = agentStats.get(node.agent);
      if (!stats) {
        gaps.push({
          kind: 'missing_agent',
          workflow_id: wf.id,
          node: node.id,
          agent: node.agent,
          evidence: `agent「${node.agent}」近 ${t.windowDays} 天零执行记录（worklog 无该 agentId）`,
        });
        continue;
      }

      // 二类：low_capability——人工介入率高（老要求人接管 = 能力不匹配）
      const humanRate = stats.humanInterventions / stats.tasks;
      if (humanRate >= t.humanInterventionRate) {
        gaps.push({
          kind: 'low_capability',
          workflow_id: wf.id,
          node: node.id,
          agent: node.agent,
          evidence: `人工介入率 ${(humanRate * 100).toFixed(0)}%（${stats.humanInterventions}/${stats.tasks} 任务，阈值 ${t.humanInterventionRate * 100}%）`,
          humanInterventionRate: Number(humanRate.toFixed(3)),
        });
        continue;
      }

      // 三类：needs_upgrade——首次通过率低（反复重试 = 能力版本落后）
      const firstPassRate = 1 - stats.retries / stats.tasks;
      if (firstPassRate < t.firstPassRate) {
        gaps.push({
          kind: 'needs_upgrade',
          workflow_id: wf.id,
          node: node.id,
          agent: node.agent,
          evidence: `首次通过率 ${(firstPassRate * 100).toFixed(0)}%（${stats.tasks - stats.retries}/${stats.tasks} 任务，阈值 ${t.firstPassRate * 100}%）`,
          firstPassRate: Number(firstPassRate.toFixed(3)),
        });
      }
    }
  }

  const summary = {
    missing_agent: gaps.filter((g) => g.kind === 'missing_agent').length,
    low_capability: gaps.filter((g) => g.kind === 'low_capability').length,
    needs_upgrade: gaps.filter((g) => g.kind === 'needs_upgrade').length,
    total: gaps.length,
  };

  const text =
    workflows.length === 0
      ? `[sofagent] workflow 能力缺口分析：workflow-store 为空（0 个 workflow）——先经 workflow_create 建 workflow 后再分析`
      : `[sofagent] workflow 能力缺口分析：扫描 ${workflows.length} 个 workflow · ${summary.total} 条缺口（缺人 ${summary.missing_agent} / 缺能力 ${summary.low_capability} / 待升级 ${summary.needs_upgrade}）——清单可被商业平台消费转悬赏`;

  return {
    text,
    data: {
      isError: false,
      gaps,
      summary,
      scanned: workflows.length,
      windowDays: t.windowDays,
    },
  };
}
