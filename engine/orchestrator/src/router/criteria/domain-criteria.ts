// ============================================================
// domain-criteria.ts · v1.9.0 §三 判据面扩展——三类判定域判据集
// ============================================================
// 定位：判据面从审计规则（audit 域 36 条，@sofagent/audit）扩到
// workflow / 本体数据 / 路由判定三类域。各域判据集复用 v1.6.0 判据 schema
// （AuditCriterion——经 @sofagent/audit/public-api 引类型与校验器），
// 「同 schema 加载校验」即「加载校验通过」的判据形态。
//
// 三域语义来源（devlog §三交付表）：
//   workflow 域——v1.5.1 事件驱动 + v1.5.4 判定分层既有语义
//     （该不该触发 / 该走哪条支路 / 该不该升级）
//   本体数据域——v1.5.0 双时态 + Validation Engine 既有语义
//     （该不该建 / 该不该合 / 该不该失效）；召回链路三问
//     （Choice 认类 / Score 贴合度 / Noul 准入——重排+门控三原语特化）
//   路由判定域——v1.5.4 路由层 + v1.8.0 第四章判定档既有语义（该走哪档）
//
// 校准状态显式声明（§三验收第 3 条）：三域当前**均为「仅接口」**
// （calibrationStatus: 'interface-only'——判据集在位但未经校准）；
// 未校准域的输出不进决策路径（guardUn-calibratedDomain 断言——§三验收第 4 条）。
//
// 未验证域声明（第 5 条）与判定不适用面（第 6 条）见 DOMAIN_DECLARATIONS。
// ============================================================

import type { AuditCriterion } from '@sofagent/audit/public-api';
import { validateCriterion } from '@sofagent/audit/public-api';

/** 判定域枚举（三类 + 既有审计域对照位） */
export type JudgeDomain = 'workflow' | 'ontology' | 'routing';

/** 域级校准状态（§三验收第 3 条——显式声明，不假装） */
export interface DomainCalibrationStatus {
  domain: JudgeDomain;
  /** calibrated=已校准（可进决策路径）/ interface-only=仅接口（判据集在位未校准） */
  calibrationStatus: 'calibrated' | 'interface-only';
  /** 声明依据（何时实测的——interface-only 时写登记时点） */
  declaredAt: string;
}

/** 未验证域显式声明（§三验收第 5 条——开放式/主观/长链推理不宣称能力） */
export const UNVERIFIED_DOMAINS: readonly string[] = [
  '开放式写作（生成本体，判定不写字——判定不适用面①）',
  '主观偏好（无验证器可对金标——验证比生成贵即无自动化前提）',
  '长链推理（判定只做单跳判断，多轮推理归 Agent——判定不适用面②）',
];

/** 判定不适用面（§三验收第 6 条——建档时显式声明四类） */
export const JUDGE_INAPPLICABLE_FACES: readonly { face: string; fallback: '代码' | '生成模型' | '小分类器'; reason: string }[] = [
  { face: '生成类（要产出散文/文本）', fallback: '生成模型', reason: '判定不写字——判断与生成分离' },
  { face: '多轮推理类（需工具调用链）', fallback: '生成模型', reason: '判定只做单跳判断' },
  { face: '可用纯函数写出类（结构化输入的确定性决策）', fallback: '代码', reason: '代码清楚的场景交给判定 = 白增一层不可审计间接' },
  { face: '十毫秒级延迟类（热路径超高频）', fallback: '小分类器', reason: '判定件在数百毫秒档——延迟预算差两个量级' },
];

/** 三域校准状态登记（当前全部 interface-only——如实，不虚标） */
export const DOMAIN_CALIBRATION: Record<JudgeDomain, DomainCalibrationStatus> = {
  workflow: { domain: 'workflow', calibrationStatus: 'interface-only', declaredAt: '2026-11-11' },
  ontology: { domain: 'ontology', calibrationStatus: 'interface-only', declaredAt: '2026-11-11' },
  routing: { domain: 'routing', calibrationStatus: 'interface-only', declaredAt: '2026-11-11' },
};

// ── 便捷构造（结构对齐 audit 域 noulCriterion——三域以 Noul/Choice 为主）────

function noul(id: string, question: string, evidence: string, extra?: Partial<AuditCriterion>): AuditCriterion {
  return {
    id,
    ruleId: id,
    question,
    primitive: 'noul',
    evidence: [{ source: evidence, locator: 'domain event / entity snapshot', reproducible: true }],
    evidenceReadiness: 'ready',
    inputParams: [{ kind: 'argv-vector', spec: '结构化参数向量（事件/实体/请求字段）' }],
    disposition: 'calibrated-probability',
    probabilitySource: 'distribution',
    defenseLine: 'action',
    thresholds: [{ primitive: 'noul', value: 0.75, boundDistribution: 'v1.6.0-zero-shot-baseline', recalibrationTriggers: ['换基座', '数据漂移'] }],
    abstainTriggers: ['confidence-insufficient'],
    examples: { match: [], notMatch: [] },
    justification: 'workflow 域语义判据（v1.9.0 §三）',
    deps: [],
    ...extra,
  } as AuditCriterion;
}

function choice(
  id: string,
  question: string,
  labels: string[],
  evidence: string,
  extra?: Partial<AuditCriterion>,
): AuditCriterion {
  return {
    id,
    ruleId: id,
    question,
    primitive: 'choice',
    options: labels,
    evidence: [{ source: evidence, locator: 'domain event / entity snapshot', reproducible: true }],
    evidenceReadiness: 'ready',
    inputParams: [{ kind: 'argv-vector', spec: '结构化参数向量（事件/实体/请求字段）' }],
    disposition: 'calibrated-probability',
    probabilitySource: 'distribution',
    defenseLine: 'action',
    thresholds: [{ primitive: 'choice', value: 0.75, boundDistribution: 'v1.6.0-zero-shot-baseline', recalibrationTriggers: ['换基座', '数据漂移'] }],
    abstainTriggers: ['confidence-insufficient', 'out-of-domain'],
    examples: { match: [], notMatch: [] },
    justification: '三域语义判据（v1.9.0 §三）',
    deps: [],
    ...extra,
  } as AuditCriterion;
}

// ── workflow 域判据集（事件驱动：该不该触发/走哪条支路/该不该升级）────────

export const WORKFLOW_CRITERIA: AuditCriterion[] = [
  noul('W1-1', '该事件是否应触发自动化处理支路（vs 仅记录）', 'workflow event stream', {
    examples: { match: ['文件变更事件（含明确规则命中）'], notMatch: ['周期性心跳事件（无语义内容）'] },
    justification: '事件驱动入口判定——v1.5.1 语义；误触发成本=空转编排',
  }),
  choice('W2-1', '该任务应走哪条执行支路', ['编排自动执行', '人工确认后执行', '转人工（无合适项）'], 'task description + graph state', {
    examples: { match: ['任务描述明确、单一领域'], notMatch: ['任务含跨域歧义或冲突需求'] },
    justification: '支路分派——v1.5.4 判定分层；选错支路=返工成本',
  }),
  noul('W3-1', '编排执行失败后是否应升级人工介入（vs 自动重试）', 'node failure record + retry count', {
    examples: { match: ['节点连续失败且重试已耗尽'], notMatch: ['首次失败且重试预算未用'] },
    justification: '升级判定——重试穷尽前的最后一道自动闸；升级过早扰人、过晚挂死',
  }),
];

// ── 本体数据域判据集（实体操作：该不该建/合/失效 + 召回三问）──────────────

export const ONTOLOGY_CRITERIA: AuditCriterion[] = [
  noul('O1-1', '该候选实体是否应建立新节点（vs 并入既有实体）', 'entity extraction snapshot', {
    examples: { match: ['新实体属性集与既有实体无重叠'], notMatch: ['属性高度重叠的疑似重复实体'] },
    justification: '建节点判定——误建产生孤立节点污染图谱；v1.5.0 双时态语义',
  }),
  noul('O2-1', '两个疑似重复实体是否应合并', 'entity pair attribute overlap', {
    examples: { match: ['两实体属性大面积一致（含唯一键）'], notMatch: ['仅名称相似但属性正交'] },
    justification: '合并判定——误合并不可逆丢失实体；双时态生效期校验',
  }),
  // 召回链路三问（重排+门控三原语特化——devlog §三交付表 2026-09-25 登记）
  choice('O3-1', '该证据属于哪个召回链路（认类）', ['销售域客户', '风控域客户', '转人工（无合适项）'], 'evidence text + domain ontology', {
    examples: { match: ['证据含明确销售域行为（下单/报价）'], notMatch: ['证据含风控域行为（逾期/欺诈信号）'] },
    justification: '召回三问①——Choice 认类：客户在销售域与风控域是不同对象，字面相似不等于同类',
  }),
  noul('O4-1', '该证据是否进入上下文（准入）', 'evidence + gate policy', {
    examples: { match: ['证据与当前问题高相关且过闸门'], notMatch: ['低相关或未过闸门的证据'] },
    justification: '召回三问③——Noul 准入：证据进上下文必须过程序闸门（判定只出判断不写库）',
  }),
];

// ── 路由判定域判据集（该走哪档——v1.5.4 路由层 + v1.8.0 判定档）────────────

export const ROUTING_CRITERIA: AuditCriterion[] = [
  choice('R1-1', '该请求应路由到哪个模型档', ['本地小模型', '云端大模型', '转人工（无合适项）'], 'request complexity + sensitivity signals', {
    examples: { match: ['请求含深度推理需求信号'], notMatch: ['简单格式转换请求'] },
    justification: '档位路由——v1.5.4 路由层；判定档永不进自动路由矩阵（v1.8.0 §四契约，本判据只管模型档不含判定档）',
  }),
  noul('R2-1', '该请求是否属敏感类（须走本地档不出内网）', 'request content sensitivity scan', {
    examples: { match: ['请求含客户身份/财务数据'], notMatch: ['公开知识问答'] },
    justification: '敏感度判定——数据主权红线路由面；宁严勿松（fail-closed 到本地）',
  }),
];

// ── 判据集加载校验（§三验收第 1 条：三域各 ≥1 套、加载校验通过）────────────

export interface DomainCriterionSetResult {
  domain: JudgeDomain;
  criteria: AuditCriterion[];
  /** 校验问题集（空=通过） */
  problems: string[];
}

/** 单域加载校验（validateCriterion 逐条——与 audit 域同一校验器，同 schema 即同判据） */
export function validateDomainSet(domain: JudgeDomain, criteria: AuditCriterion[]): DomainCriterionSetResult {
  const problems = criteria.flatMap((c) => validateCriterion(c));
  // 域内 id 唯一性（跨条目对账）
  const ids = new Set<string>();
  for (const c of criteria) {
    if (ids.has(c.id)) problems.push(`[${domain}] 判据 id 重复：${c.id}`);
    ids.add(c.id);
  }
  return { domain, criteria, problems };
}

/** 三域判据集总装（加载校验通过的判据形态） */
export function loadDomainCriteriaSets(): Record<JudgeDomain, DomainCriterionSetResult> {
  return {
    workflow: validateDomainSet('workflow', WORKFLOW_CRITERIA),
    ontology: validateDomainSet('ontology', ONTOLOGY_CRITERIA),
    routing: validateDomainSet('routing', ROUTING_CRITERIA),
  };
}

// ── 未校准域拒绝入决策路径（§三验收第 4 条——门禁断言）───────────────────

/** 未校准域消费守卫错误（fail-closed 载体） */
export class UncalibratedDomainError extends Error {
  constructor(domain: JudgeDomain) {
    super(`[domain-criteria] 域「${domain}」校准状态为 interface-only——其判据输出不得进决策路径（§三验收第 4 条门禁；校准后改 DOMAIN_CALIBRATION 登记方可解锁）`);
    this.name = 'UncalibratedDomainError';
  }
}

/**
 * 门禁断言：未校准域的判据不得被决策路径消费。
 * 调用形态：决策路由消费某域判据前必经本断言——interface-only 即抛
 * （fail-closed，不静默放行）；calibrated 才放行。
 */
export function assertDomainCalibratedForDecision(domain: JudgeDomain): void {
  if (DOMAIN_CALIBRATION[domain].calibrationStatus !== 'calibrated') {
    throw new UncalibratedDomainError(domain);
  }
}
