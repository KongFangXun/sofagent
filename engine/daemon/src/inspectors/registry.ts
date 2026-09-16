// ============================================================
// inspectors/registry.ts · 巡检器注册表——唯一事实源（v1.4.9 深模块条目 2）
// ============================================================
// 背景：同一「哪些巡检器、何时跑」概念曾存在三处（分层表 / 扁平表 /
// DEFAULT_INSPECTOR_CONFIG）且已漂移——audit-trail（v1.3.2 交付）只挂
// 在死路径上，生产从未执行。本文件收敛为单一事实源：分层表由本注册表
// 派生，一切「巡检器名 → 函数 → 层级」从这里读。
//
// 保留：InspectorFn 签名（深形状）；L1/L2/L3 分层架构与 LAYER_SCHEDULE
// 调度节奏（cron.ts 消费面不变）。
// ============================================================

import type { InspectorResult } from './types';
// 🔴 直接 import 各实现文件（不经 ./index barrel——barrel 反向 import 本注册表会造成
// 循环依赖使 INSPECTORS 在初始化时为 undefined，v1.4.8 条目 2 实测）。
// workspaceSummaryInspector 是 index.ts 内的适配函数——此处内联同形适配避免引 barrel。
import { analyzeAuditHistory } from './audit-history-analyzer';
import { checkConflict } from './conflict-check';
import { checkDoctorHealth } from './doctor-checker';
import { checkKnowledgeFreshness } from './knowledge-freshness';
import { checkKnowledgeHealth } from './knowledge-health';
import { checkSkillStaleness } from './skill-staleness';
import { accumulateWarnings } from './warn-accumulator';
import { generateDataSovereigntyDaily } from './data-sovereignty-daily';
import { generateDataSovereigntyWeekly } from './data-sovereignty-weekly';
import { generateDataSovereigntyMonthly } from './data-sovereignty-monthly';
import { runAuditTrailInspector } from './audit-trail';
import { runCommonsCatalogDaily } from './commons-catalog-daily';
import { runCommonsHealth } from './commons-health';
import { runWorkspaceSummary } from '../workspace-summary';
import type { InspectorResult as _IR } from './types';

/** workspace-summary 适配（与 index.ts 内 workspaceSummaryInspector 同形——不引 barrel 防循环） */
function workspaceSummaryInspector(projectDir: string): _IR {
  try {
    const record = runWorkspaceSummary({ projectDir });
    if (!record) {
      return { name: 'workspace-summary', triggered: false, message: '无新 checkpoint，跳过 workspace 变更记录', severity: 'info' };
    }
    return {
      name: 'workspace-summary',
      triggered: true,
      message: `runId=${record.runId} · created=${record.created.length} modified=${record.modified.length} deleted=${record.deleted.length}`,
      severity: 'info',
    };
  } catch (err) {
    return { name: 'workspace-summary', triggered: false, message: `workspace 摘要失败：${err instanceof Error ? err.message : String(err)}`, severity: 'warning' };
  }
}
import { runFederationDistillation } from './federation-distillation';
import { runFailurePattern } from './failure-pattern';
import { runOntologyCoverage } from './ontology-coverage';
import { runEvalFailuresCheck } from './eval-failures';
import { runEvolveTrigger } from './evolve-trigger';
import { runDailySnapshot } from './daily-snapshot';
import { runTrendAggregator } from './trend-aggregator';
import { runTaskStats } from './task-stats';
import { runFdeCompanionDaily } from './fde-companion-daily';
import { runFdeRegistryDaily } from './fde-registry-daily';
import { runTrainOrphanScan } from './train-orphan-scan';

/** 巡检层级 */
export type InspectorLayer = 'L1' | 'L2' | 'L3';

/** 单个巡检器执行函数签名（深形状——保留不动） */
export type InspectorFn = (projectDir: string) => InspectorResult;

/** 注册表条目 */
export interface InspectorEntry {
  readonly fn: InspectorFn;
  readonly layer: InspectorLayer;
  readonly enabled: boolean;
}

/**
 * 唯一巡检器清单。
 * 增删巡检器只改这里——分层表/名称列表/金名单测试全部派生。
 * v1.4.8 条目 2 修复：audit-trail（v1.3.2 交付）正式入 L1（此前只挂在
 * 已死扁平表上，生产从未执行——漂移修复）。
 */
export const INSPECTORS: Readonly<Record<string, InspectorEntry>> = {
  // ── L1 快速健康（@daily）──
  'audit-history': { fn: analyzeAuditHistory, layer: 'L1', enabled: true },
  'doctor-health': { fn: checkDoctorHealth, layer: 'L1', enabled: true },
  'warn-accumulator': { fn: accumulateWarnings, layer: 'L1', enabled: true },
  'data-sovereignty-daily': { fn: generateDataSovereigntyDaily, layer: 'L1', enabled: true },
  'workspace-summary': { fn: workspaceSummaryInspector, layer: 'L1', enabled: true },
  'eval-failures': { fn: runEvalFailuresCheck, layer: 'L1', enabled: true },
  'daily-snapshot': { fn: runDailySnapshot, layer: 'L1', enabled: true },
  'task-stats': { fn: runTaskStats, layer: 'L1', enabled: true },
  'commons-catalog-daily': { fn: runCommonsCatalogDaily, layer: 'L1', enabled: true },
  'fde-companion-daily': { fn: runFdeCompanionDaily, layer: 'L1', enabled: true },
  'fde-registry-daily': { fn: runFdeRegistryDaily, layer: 'L1', enabled: true },
  'train-orphan-scan': { fn: runTrainOrphanScan, layer: 'L1', enabled: true },
  // v1.4.8 条目 2：audit-trail 入 L1（漂移修复——v1.3.2 交付后从未在活路径执行）
  'audit-trail': { fn: runAuditTrailInspector, layer: 'L1', enabled: true },
  // ── L2 深度巡检（@weekly）──
  'conflict-check': { fn: checkConflict, layer: 'L2', enabled: true },
  'knowledge-freshness': { fn: checkKnowledgeFreshness, layer: 'L2', enabled: true },
  'knowledge-health': { fn: checkKnowledgeHealth, layer: 'L2', enabled: true },
  'skill-staleness': { fn: checkSkillStaleness, layer: 'L2', enabled: false },
  'data-sovereignty-weekly': { fn: generateDataSovereigntyWeekly, layer: 'L2', enabled: true },
  'evolve-trigger': { fn: runEvolveTrigger, layer: 'L2', enabled: true },
  'trend-aggregator': { fn: runTrendAggregator, layer: 'L2', enabled: true },
  'commons-health': { fn: runCommonsHealth, layer: 'L2', enabled: true },
  // ── L3 联邦分析（@monthly）──
  'federation-distillation': { fn: runFederationDistillation, layer: 'L3', enabled: true },
  'failure-pattern': { fn: runFailurePattern, layer: 'L3', enabled: true },
  'ontology-coverage': { fn: runOntologyCoverage, layer: 'L3', enabled: true },
  'data-sovereignty-monthly': { fn: generateDataSovereigntyMonthly, layer: 'L3', enabled: true },
};

/** 执行指定层（enabled 条目按注册序） */
export function runLayer(projectDir: string, layer: InspectorLayer): InspectorResult[] {
  const results: InspectorResult[] = [];
  for (const [name, entry] of Object.entries(INSPECTORS)) {
    if (entry.layer !== layer || !entry.enabled) continue;
    try {
      results.push(entry.fn(projectDir));
    } catch (err) {
      results.push({
        name,
        triggered: false,
        message: `inspector 异常：${err instanceof Error ? err.message : String(err)}`,
        severity: 'warning',
      });
    }
  }
  return results;
}

/** 执行全部层 */
export function runAll(projectDir: string): InspectorResult[] {
  return ['L1', 'L2', 'L3'].flatMap((l) => runLayer(projectDir, l as InspectorLayer));
}

/** 列出巡检器名（可按层过滤） */
export function listInspectors(layer?: InspectorLayer): string[] {
  return Object.entries(INSPECTORS)
    .filter(([, e]) => (layer ? e.layer === layer : true))
    .map(([name]) => name);
}
