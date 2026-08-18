// ============================================================
// permission/scenario-router.ts · 场景匹配引擎
// v1.3.7 交付② 新增
//
// 判定链第 2 环：身份（v1.3.1 身份码）→ 【场景匹配】 → 风险等级 → 放行/deny/人工批准
//
// 三类维度（changelog §二）：
//   - 任务类型：代码开发 / 数据处理 / 报表生成 / 测试 …
//   - 数据域：代码 / 配置 / 审计数据 / 用户数据 …
//   - 动作风险：读（低）/ 写（中）/ 删（高）/ 外传（极高）
//
// DSH 两旋钮正交分解（2026-08-15 决策）：
//   效果边界（能碰到什么——沙箱控制）× 决策通道（能不能做——本模块+审批控制）
//   fail-closed：匹配不到场景 → deny（不默认放行）
// ============================================================

/** 任务类型（场景三维度之一） */
export type TaskType = 'code-development' | 'data-processing' | 'report-generation' | 'testing' | 'ops' | 'knowledge-management';

/** 数据域（场景三维度之二） */
export type DataDomain = 'code' | 'config' | 'audit-data' | 'user-data' | 'knowledge' | 'public';

/** 动作类型（场景三维度之三——决定风险等级） */
export type ActionType = 'read' | 'write' | 'delete' | 'export';

/** 预设场景定义 */
export interface Scenario {
  /** 场景 ID */
  id: string;
  /** 任务类型 */
  taskType: TaskType;
  /** 允许触碰的数据域列表（效果边界——与沙箱联动） */
  allowedDomains: DataDomain[];
  /** 场景描述（decision-log 留痕用） */
  description: string;
}

/** 匹配请求 */
export interface ScenarioMatchRequest {
  taskType: TaskType;
  domain: DataDomain;
  action: ActionType;
}

/** 匹配结果 */
export interface ScenarioMatchResult {
  matched: boolean;
  scenario: Scenario | null;
  /** 未匹配原因（fail-closed 证据） */
  reason?: string;
}

/** 内置预设场景（≥3 任务类型 × 各自数据域示例——验收标准 2） */
export const BUILTIN_SCENARIOS: Scenario[] = [
  {
    id: 'code-dev-main',
    taskType: 'code-development',
    allowedDomains: ['code', 'config', 'public'],
    description: '代码开发：可写 .ts/.js 源码与工程配置',
  },
  {
    id: 'code-dev-test',
    taskType: 'testing',
    allowedDomains: ['code', 'public'],
    description: '测试执行：可读写测试代码，不碰用户数据',
  },
  {
    id: 'data-pipeline',
    taskType: 'data-processing',
    allowedDomains: ['user-data', 'public'],
    description: '数据处理：可处理用户数据（脱敏后），禁写审计数据',
  },
  {
    id: 'report-gen',
    taskType: 'report-generation',
    allowedDomains: ['user-data', 'audit-data', 'public'],
    description: '报表生成：可读用户数据与审计数据生成报表',
  },
  {
    id: 'ops-maintenance',
    taskType: 'ops',
    allowedDomains: ['config', 'public'],
    description: '运维：可改运行配置（经审批），不碰代码与用户数据',
  },
  {
    id: 'km-curation',
    taskType: 'knowledge-management',
    allowedDomains: ['knowledge', 'public'],
    description: '知识管理：可读写知识库条目',
  },
];

export interface ScenarioRouterOptions {
  /** 额外场景（叠加在内置之上——企业可扩展） */
  extraScenarios?: Scenario[];
}

export interface ScenarioRouter {
  /** 场景匹配（判定链第 2 环）——fail-closed：无匹配返回 matched=false */
  match(req: ScenarioMatchRequest): ScenarioMatchResult;
  /** 列出全部场景（含扩展） */
  listScenarios(): Scenario[];
}

/**
 * 创建场景匹配引擎。
 */
export function createScenarioRouter(options: ScenarioRouterOptions = {}): ScenarioRouter {
  const scenarios = [...BUILTIN_SCENARIOS, ...(options.extraScenarios || [])];

  return {
    match(req) {
      // fail-closed 第 1 道：任务类型+数据域完全无匹配场景 → deny
      const candidates = scenarios.filter(s => s.taskType === req.taskType);
      if (candidates.length === 0) {
        return {
          matched: false,
          scenario: null,
          reason: `fail-closed：任务类型 ${req.taskType} 无预设场景`,
        };
      }
      const hit = candidates.find(s => s.allowedDomains.includes(req.domain));
      if (!hit) {
        return {
          matched: false,
          scenario: null,
          reason: `fail-closed：场景 ${req.taskType} 不允许触碰数据域 ${req.domain}`,
        };
      }
      return { matched: true, scenario: hit };
    },
    listScenarios() {
      return [...scenarios];
    },
  };
}
