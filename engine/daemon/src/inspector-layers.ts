// ============================================================
// inspector-layers.ts · L1/L2/L3 分层巡检调度器（v1.3.7 · P0）
// ============================================================
//
// 将扁平的 inspector 执行改为三级分层调度：
//   L1 快速健康 (@daily)：审计历史 / daemon 状态 / WARN 累积 / 数据主权日报 / workspace 摘要 / daily 快照
//   L2 深度巡检 (@weekly)：知识矛盾 / 孤儿 / 死链 / 新鲜度 / Skill 陈旧度 / 数据主权周报 / 趋势聚合 / skillopt 触发
//   L3 联邦分析 (@monthly)：跨设备蒸馏 / 失败模式聚类 / Ontology 覆盖度 / 数据主权月报
//
// 各层独立调度，由 cron 节拍或手动触发指定层级。
// 巡检结果写入 Views 层（派生视图），不污染 Ledger 层（原始记录）。
// ============================================================

import type { InspectorResult } from './inspectors/types';
import {
  analyzeAuditHistory,
  checkConflict,
  checkDoctorHealth,
  checkKnowledgeFreshness,
  checkKnowledgeHealth,
  checkSkillStaleness,
  accumulateWarnings,
  generateDataSovereigntyDaily,
  generateDataSovereigntyWeekly,
  generateDataSovereigntyMonthly,
  workspaceSummaryInspector,
} from './inspectors';
import { runFederationDistillation } from './inspectors/federation-distillation';
import { runFailurePattern } from './inspectors/failure-pattern';
import { runOntologyCoverage } from './inspectors/ontology-coverage';
import { runEvalFailuresCheck } from './inspectors/eval-failures';
import { runSkilloptTrigger } from './inspectors/skillopt-trigger';
import { runDailySnapshot } from './inspectors/daily-snapshot';
import { runTrendAggregator } from './inspectors/trend-aggregator';
import { runTaskStats } from './inspectors/task-stats';
// v1.3.4 交付 1：能力目录日更生成（@daily）
import { runCommonsCatalogDaily } from './inspectors/commons-catalog-daily';
// v1.3.4 交付 3：公地健康周检（@weekly）
import { runCommonsHealth } from './inspectors/commons-health';
// v1.3.5 交付 5：FDE 陪跑期日巡检（@daily——部署后前 2 周每日 Refine）
import { runFdeCompanionDaily } from './inspectors/fde-companion-daily';
// v1.3.5 交付 5：FDE 节点注册表巡检（@daily——fde-registry.yaml cadence 调度）
import { runFdeRegistryDaily } from './inspectors/fde-registry-daily';

/** 巡检层级 */
export type InspectorLayer = 'L1' | 'L2' | 'L3';

/** 层级对应的 cron 频率 */
export const LAYER_SCHEDULE: Record<InspectorLayer, '@daily' | '@weekly' | '@monthly'> = {
  L1: '@daily',
  L2: '@weekly',
  L3: '@monthly',
};

/** 单个 inspector 执行函数签名 */
type InspectorFn = (projectDir: string) => InspectorResult;

/** 各层 inspector 执行列表 */
const LAYER_INSPECTORS: Record<InspectorLayer, { name: string; fn: InspectorFn }[]> = {
  L1: [
    { name: 'audit-history', fn: analyzeAuditHistory },
    { name: 'doctor-health', fn: checkDoctorHealth },
    { name: 'warn-accumulator', fn: accumulateWarnings },
    { name: 'data-sovereignty-daily', fn: generateDataSovereigntyDaily },
    { name: 'workspace-summary', fn: workspaceSummaryInspector },
    // v1.2.4 P0b：eval 失败检测 → think-generator（进化引擎核心闭环）
    { name: 'eval-failures', fn: runEvalFailuresCheck },
    // v1.2.4 P1b-pre：daily 结构化快照（trend-aggregator 的数据源）
    { name: 'daily-snapshot', fn: runDailySnapshot },
    // v1.2.4 P1b：任务成功率统计
    { name: 'task-stats', fn: runTaskStats },
    // v1.3.4 交付 1：能力目录日更生成（@daily）
    { name: 'commons-catalog-daily', fn: runCommonsCatalogDaily },
    // v1.3.5 交付 5：FDE 陪跑期日巡检（@daily——部署后前 2 周每日 Refine 巡检）
    { name: 'fde-companion-daily', fn: runFdeCompanionDaily },
    // v1.3.5 交付 5：FDE 节点注册表巡检（@daily——fde-registry.yaml cadence 调度）
    { name: 'fde-registry-daily', fn: runFdeRegistryDaily },
  ],
  L2: [
    { name: 'conflict-check', fn: checkConflict },
    { name: 'knowledge-freshness', fn: checkKnowledgeFreshness },
    { name: 'knowledge-health', fn: checkKnowledgeHealth },
    { name: 'skill-staleness', fn: checkSkillStaleness },
    { name: 'data-sovereignty-weekly', fn: generateDataSovereigntyWeekly },
    // v1.2.4 P1：失败模式 → skillopt 自动触发
    { name: 'skillopt-trigger', fn: runSkilloptTrigger },
    // v1.2.4 P1b：历史趋势聚合
    { name: 'trend-aggregator', fn: runTrendAggregator },
    // v1.3.4 交付 3：公地健康周检（@weekly——退役候选/评分异常/目录完整性）
    { name: 'commons-health', fn: runCommonsHealth },
  ],
  L3: [
    { name: 'federation-distillation', fn: runFederationDistillation },
    { name: 'failure-pattern', fn: runFailurePattern },
    { name: 'ontology-coverage', fn: runOntologyCoverage },
    { name: 'data-sovereignty-monthly', fn: generateDataSovereigntyMonthly },
  ],
};

/** 分层巡检结果 */
export interface LayeredInspectionResult {
  /** 执行的层级 */
  layer: InspectorLayer;
  /** 该层各 inspector 的结果 */
  results: InspectorResult[];
  /** 执行时间 ISO */
  executedAt: string;
}

/**
 * 按指定层级执行巡检
 *
 * @param projectDir 项目根目录
 * @param layer 要执行的层级（L1/L2/L3）
 * @returns 该层所有 inspector 的结果
 */
export function runLayeredInspection(
  projectDir: string,
  layer: InspectorLayer,
): LayeredInspectionResult {
  const inspectors = LAYER_INSPECTORS[layer];
  const results: InspectorResult[] = [];

  for (const { name, fn } of inspectors) {
    try {
      const result = fn(projectDir);
      results.push(result);
    } catch (err) {
      results.push({
        name,
        triggered: false,
        message: `inspector 异常：${err instanceof Error ? err.message : String(err)}`,
        severity: 'warning',
      });
    }
  }

  return {
    layer,
    results,
    executedAt: new Date().toISOString(),
  };
}

/**
 * 执行所有层级的巡检（全量执行——用于兼容旧调用方）
 *
 * 等效于依次执行 L1→L2→L3 的全部 inspector。
 */
export function runAllLayers(projectDir: string): InspectorResult[] {
  const all: InspectorResult[] = [];
  for (const layer of ['L1', 'L2', 'L3'] as InspectorLayer[]) {
    const { results } = runLayeredInspection(projectDir, layer);
    all.push(...results);
  }
  return all;
}

/**
 * 获取指定层级的 inspector 名称列表（调试/测试用）
 */
export function getLayerInspectorNames(layer: InspectorLayer): string[] {
  return LAYER_INSPECTORS[layer].map((i) => i.name);
}
