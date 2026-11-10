// ============================================================
// fde-criteria-wiring.ts · v1.9.0 §三 ② FDE 判据面接线（S1M 决策点建档）
// ============================================================
// 定位：FDE/S1M-DECISION-POINTS.md 清单（30 决策点 × 四分类归属）中
// S1M 归属的决策点，按三原语建档——至少覆盖三类首个落点（§三验收第 2 条）：
//   映射① 进场三问判定（S1M Choice 首个实装场景）
//   离场就绪度 Score
//   驻留期健康分合成
// 归属迁移过 evidenceReadiness 门且留痕（gated→ready 须带依据）。
//
// 边界（devlog §三）：清单是初判预标定非终判——本版只消费证据就绪的判据点。
// 建档产物 = FDE_S1M_CRITERIA（判据条目）+ MIGRATION_LOG（迁移留痕）。
// ============================================================

import type { AuditCriterion } from '@sofagent/audit/public-api';

/** FDE 决策点判据（S1M 归属·三类首个落点） */
export const FDE_S1M_CRITERIA: AuditCriterion[] = [
  // 映射①：进场三问判定（S1M Choice 首个实装场景——devlog §三 FDE 判据面）
  {
    id: 'F1-1',
    ruleId: 'F1-1',
    question: '进场三问判定：该业务环节是否适合引入 AI（三问：该不该上/上什么/谁拍板）',
    primitive: 'choice',
    options: ['适合引入（结构化+高频+可验证）', '暂不适合（需先梳理流程）', '转人工（无合适项）'],
    evidence: [{ source: 'PSF 检验记录 + 业务流程快照', locator: 'FDE/S1M-DECISION-POINTS.md 决策点 1-4', reproducible: true }],
    evidenceReadiness: 'ready',
    inputParams: [{ kind: 'argv-vector', spec: '业务环节描述 + 流程结构化快照' }],
    disposition: 'calibrated-probability',
    probabilitySource: 'distribution',
    defenseLine: 'action',
    thresholds: [{ primitive: 'choice', value: 0.75, boundDistribution: 'v1.6.0-zero-shot-baseline', recalibrationTriggers: ['换基座', 'FDE 案例分布漂移'] }],
    abstainTriggers: ['confidence-insufficient', 'out-of-domain'],
    examples: { match: ['高频重复的报表核对环节'], notMatch: ['一年一次的战略决策环节'] },
    justification: '映射①三问判定——S1M Choice 首个实装场景（30 决策点清单进场段）',
    deps: [],
  },
  // 离场就绪度 Score（决策点「离场就绪度」——Score 原语落点）
  {
    id: 'F2-1',
    ruleId: 'F2-1',
    question: '离场就绪度评分：该交付物是否达到可离场标准（0-10）',
    primitive: 'score',
    scale: Array.from({ length: 10 }, (_, i) => `${i + 1}`),
    evidence: [{ source: '交付物验收记录 + 审计链状态', locator: 'FDE/S1M-DECISION-POINTS.md 离场段', reproducible: true }],
    evidenceReadiness: 'ready',
    inputParams: [{ kind: 'argv-vector', spec: '交付物清单 + 验收判据命中向量' }],
    disposition: 'calibrated-probability',
    probabilitySource: 'distribution',
    defenseLine: 'action',
    thresholds: [{ primitive: 'score', value: 0.75, boundDistribution: 'v1.6.0-zero-shot-baseline', recalibrationTriggers: ['换基座', '离场判据修订'] }],
    abstainTriggers: ['confidence-insufficient'],
    examples: { match: ['验收判据全命中且审计链完整'], notMatch: ['判据命中不全或审计链断链'] },
    justification: '离场就绪度 Score——三类首个落点之二（30 决策点清单离场段）',
    deps: [],
  },
  // 驻留期健康分合成（决策点「健康分四信号合成」——Noul 原语落点）
  {
    id: 'F3-1',
    ruleId: 'F3-1',
    question: '驻留期健康判定：四信号（漂移/告警/推翻率/采纳率）合成后是否健康',
    primitive: 'noul',
    evidence: [{ source: 'judge-observability 四信号快照', locator: 'FDE/S1M-DECISION-POINTS.md 驻留段', reproducible: true }],
    evidenceReadiness: 'ready',
    inputParams: [{ kind: 'argv-vector', spec: '四信号时序窗口读数向量' }],
    disposition: 'calibrated-probability',
    probabilitySource: 'distribution',
    defenseLine: 'action',
    thresholds: [{ primitive: 'noul', value: 0.75, boundDistribution: 'v1.6.0-zero-shot-baseline', recalibrationTriggers: ['换基座', '信号定义修订'] }],
    abstainTriggers: ['confidence-insufficient', 'criteria-missing'],
    examples: { match: ['四信号均在健康带内'], notMatch: ['任一信号越健康带上界'] },
    justification: '健康分四信号合成——三类首个落点之三（30 决策点清单驻留段；消费 judge-observability 既有台账）',
    deps: [],
  },
];

/** 归属迁移留痕（§三验收第 2 条——过 evidenceReadiness 门且留痕） */
export interface MigrationLogEntry {
  criterionId: string;
  /** 迁移方向（gated:<v>→ready = 过门放行；ready→gated = 回收） */
  from: string;
  to: string;
  /** 过门依据（放行理由——可审计） */
  basis: string;
  at: string;
}

/** 本批迁移留痕（三条判据从清单预标定 → ready 建档） */
export const MIGRATION_LOG: MigrationLogEntry[] = [
  { criterionId: 'F1-1', from: 'gated:v1.9.0-pre', to: 'ready', basis: '进场三问判据点证据就绪（PSF 检验记录形态可复现）', at: '2026-11-11' },
  { criterionId: 'F2-1', from: 'gated:v1.9.0-pre', to: 'ready', basis: '离场就绪度判据点证据就绪（验收判据 + 审计链双源）', at: '2026-11-11' },
  { criterionId: 'F3-1', from: 'gated:v1.9.0-pre', to: 'ready', basis: '健康分判据点证据就绪（judge-observability 四信号台账在位）', at: '2026-11-11' },
];

/**
 * evidenceReadiness 门（归属迁移过门判据）：
 * ready 判据须有迁移留痕（gated→ready 带依据）；无留痕的 ready 即红（fail-closed）。
 */
export function checkMigrationGate(criteria: AuditCriterion[], log: MigrationLogEntry[]): string[] {
  const problems: string[] = [];
  const loggedIds = new Set(log.map((l) => l.criterionId));
  for (const c of criteria) {
    if (c.evidenceReadiness === 'ready' && !loggedIds.has(c.id)) {
      problems.push(`FDE 判据 ${c.id} 标 ready 但无迁移留痕（gated→ready 须过门带依据——§三验收第 2 条）`);
    }
  }
  return problems;
}
