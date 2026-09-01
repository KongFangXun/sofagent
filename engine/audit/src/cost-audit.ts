// ============================================================
// cost-audit.ts · 成本审计维度（v1.4.0 交付三 · WARN only）
// ============================================================
//
// 职责：读 worklog 聚合数据 + 预算配置 → 判定超支 → 产出 WARN 级发现。
// 约束（铁律 12）：
//   - WARN only，不拦截任务执行（除非 --warn-as-error 由调用方升级）
//   - 不进 A1-A23 规则体系（不进 rules/index.ts，TOTAL_RULES_COUNT=24 不变）——正交新维度
//   - opt-in：不配 budget 不审计成本
// 数据源：data/dashboard/worklog.json（v1.4.3 worklog 聚合落盘）
// 预算源：workflow.yml 可选 `budget: { maxTokensPerRun, maxCostPerDay }`
//   （本模块接收解析后的 budget 对象；workflow.yml 的 YAML 解析由调用方注入）
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/** 预算配置（workflow.yml 的 budget 段） */
export interface CostBudget {
  /** 单 run token 上限（input+output）——按 Agent 聚合判定 */
  maxTokensPerRun?: number;
  /** 每日成本上限（USD）——按 Agent 成本估算聚合判定 */
  maxCostPerDay?: number;
}

/** 成本超支发现（WARN 级） */
export interface CostFinding {
  /** 固定规则名（独立于 A1-A23 编号体系） */
  rule: 'COST-OVERRUN';
  /** 恒为 WARN（--warn-as-error 由调用方升级） */
  severity: 'WARN';
  /** 超支对象（agentId 或 workflowId） */
  target: string;
  /** 超支维度 */
  dimension: 'tokens' | 'cost';
  /** 预算上限 */
  limit: number;
  /** 实际值 */
  actual: number;
  /** 人类可读原因 */
  message: string;
}

/** worklog.json 的结构化切片（只取判定需要的字段，避免与 orchestrator 强耦合） */
export interface WorklogSlice {
  agents?: Array<{
    agentId: string;
    totals: {
      tokens?: { input?: number; output?: number };
      costUsd?: number | null;
      tasks?: number;
      llmCalls?: number;
    };
  }>;
  workflows?: Array<{ workflowId: string }>;
}

/**
 * 成本审计纯函数：worklog + budget → 超支发现。
 * 无 budget → 空数组（opt-in）。
 */
export function runCostAudit(input: { worklog?: WorklogSlice | null; budget?: CostBudget | null }): CostFinding[] {
  const b = input.budget;
  if (!b) return [];
  const wl = input.worklog;
  if (!wl) return [];
  const findings: CostFinding[] = [];

  // 维度一：maxTokensPerRun——单 Agent token 聚合超限
  if (typeof b.maxTokensPerRun === 'number' && b.maxTokensPerRun > 0) {
    for (const a of wl.agents || []) {
      const t = a.totals?.tokens;
      const total = (t?.input || 0) + (t?.output || 0);
      if (total > b.maxTokensPerRun) {
        findings.push({
          rule: 'COST-OVERRUN',
          severity: 'WARN',
          target: a.agentId,
          dimension: 'tokens',
          limit: b.maxTokensPerRun,
          actual: total,
          message: `Agent ${a.agentId} token 用量 ${total} 超预算 ${b.maxTokensPerRun}（input ${t?.input ?? 0} + output ${t?.output ?? 0}）`,
        });
      }
    }
  }

  // 维度二：maxCostPerDay——单 Agent 成本估算超限（worklog 成本为聚合估算，按日粒度近似）
  if (typeof b.maxCostPerDay === 'number' && b.maxCostPerDay > 0) {
    for (const a of wl.agents || []) {
      const c = a.totals?.costUsd;
      if (c !== null && c !== undefined && c > b.maxCostPerDay) {
        findings.push({
          rule: 'COST-OVERRUN',
          severity: 'WARN',
          target: a.agentId,
          dimension: 'cost',
          limit: b.maxCostPerDay,
          actual: c,
          message: `Agent ${a.agentId} 成本 ~$${c.toFixed(4)} 超预算 $${b.maxCostPerDay}`,
        });
      }
    }
  }

  return findings;
}

/** 读 data/dashboard/worklog.json → WorklogSlice（文件缺失返回 null） */
export function loadWorklogSlice(dataDir: string): WorklogSlice | null {
  const p = join(dataDir, 'dashboard', 'worklog.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    if (!raw) return null;
    return {
      agents: Array.isArray(raw.agents) ? raw.agents : undefined,
      workflows: Array.isArray(raw.workflows) ? raw.workflows : undefined,
    };
  } catch {
    // worklog.json 损坏按无数据处理——成本审计是附带维度，不阻断主审计
    return null;
  }
}
