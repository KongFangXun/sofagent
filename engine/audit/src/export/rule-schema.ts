// ============================================================
// rule-schema.ts · v1.4.5 第一章 · 规则导出格式定义
//
// 定位：24+3 条审计规则的机器可读序列化格式（训练语料第一件）。
// 口径（changelog 表下注 A，2026-09-01 核对 rules/index.ts 后定）：
//   - 24 条已实现规则（defaultRules 17 + extendedRules 7）
//   - 3 条永久跳号编号位（A12/A13/E3）——已并入 A11，导出时以
//     status: 'merged-into-A11' 占位登记，共 27 个编号位，
//     「零遗漏」对编号空间对数而非仅对数组对数。
//
// reward_hint 段（2026-08-26 补）：每条规则附带 reward 骨架——
// 判定函数签名 + 严重度权重 + 可判定性标注（机器可判/需人审/启发式）。
// 与 reward-mapping.ts 的分工：本文件定义格式，那里做三桶分桶与清单生成。
// ============================================================

import type { Rule } from '../rules/types';

/** 导出 schema 版本（格式变更时升版——消费侧按此判定兼容性） */
export const RULE_EXPORT_SCHEMA_VERSION = 'v1';

/** 跳号编号位登记口径——A12/A13/E3 已并入 A11（源码注释显式写明） */
export const MERGED_INTO_A11 = 'merged-into-A11' as const;

/** 可判定性三态（reward 接线方式的分桶依据） */
export type Verifiability =
  /** 机器可判——判定逻辑纯函数可执行（regex/结构检查），可直接当 reward 函数接线 */
  | 'machine-judgeable'
  /** 需人审——判定依赖业务语义/任务上下文，只能当训练后验收 */
  | 'human-review'
  /** 启发式——有可执行检测但误报率不可忽略，可当弱 reward 或采样人审 */
  | 'heuristic';

/** reward 骨架段（2026-08-26 补——规则 → reward 映射的格式层） */
export interface RewardHint {
  /** 判定函数签名（输入 → 输出，人类可读描述——不导出可执行代码） */
  signature: string;
  /** 严重度权重（critical=1.0 / warning=0.6 / crutch=0.3 / extended=0.4——与 priority 对齐） */
  severityWeight: number;
  /** 可判定性标注 */
  verifiability: Verifiability;
}

/** 单条规则导出形态（已实现规则） */
export interface RuleExportEntry {
  /** 规则编号（A 系列原生 number；E 系列 200+ 序号） */
  code: string;
  /** 规则名（含中文短名） */
  name: string;
  /** 数字编号位（编号空间对数依据） */
  number: number;
  /** 证据模式 */
  evidenceMode: string;
  /** 规则分级 */
  ruleClass?: string;
  /** 优先级 */
  priority?: string;
  /** 描述 */
  description?: string;
  /** 命中/放行示例（规则即测试样本——进训练语料的价值面） */
  examples?: { match: string[]; notMatch: string[] };
  /** 拦截理由 */
  justification?: string;
  /** reward 骨架段 */
  reward_hint: RewardHint;
  /** 实现状态：implemented = 已实现 / merged-into-A11 = 跳号占位 */
  status: 'implemented' | typeof MERGED_INTO_A11;
  /** 并入目标（仅跳号占位条目有） */
  mergedInto?: string;
}

/** 规则语料导出主体（body——HMAC 签名输入，不含签名自身） */
export interface RuleCorpusBody {
  schemaVersion: typeof RULE_EXPORT_SCHEMA_VERSION;
  /** 导出时的引擎版本（package.json version） */
  engineVersion: string;
  /** 生成时间（ISO 8601） */
  exportedAt: string;
  /** 导出范围（default / extended / all） */
  scope: 'default' | 'extended' | 'all';
  /** 规则条目（27 编号位——含 3 条跳号占位） */
  rules: RuleExportEntry[];
  /** 编号空间统计（零遗漏对数依据） */
  counts: {
    implemented: number;
    mergedPlaceholders: number;
    totalSlots: number;
  };
}

/** 完整导出（body + HMAC 签名——无密钥时 hmac 缺席） */
export interface RuleCorpusExport {
  body: RuleCorpusBody;
  /** body 的 HMAC 签名（stableStringify 归一后 sha256-HMAC，截 32 字符；密钥缺失时无此字段） */
  hmac?: string;
}

/** priority → 严重度权重映射（reward 数值化） */
export function severityWeightOf(priority: Rule['priority']): number {
  switch (priority) {
    case 'critical': return 1.0;
    case 'warning': return 0.6;
    case 'extended': return 0.4;
    case 'crutch': return 0.3;
    default: return 0.5; // 未标注 priority 的历史规则——中性权重
  }
}

/**
 * 可判定性推断——依据 evidenceMode + ruleClass 的启发式分桶：
 * - git-diff 纯模式（A1/A2/A9/A10/A20-A23 等）→ machine-judgeable：
 *   判定输入 = diff 文本 + 文件路径，纯 regex/结构检查可执行
 * - hybrid（A7/A8/A14/A15）→ human-review：依赖 Agent 日志与任务声明的
 *   语义对照，机器检测有不可忽略误报
 * - filesystem（A17）与其余能力拐杖类 → heuristic：可执行但阈值敏感
 *
 * 这是「骨架标注」而非最终裁定——verifiers.json 生成时可被人工覆写。
 */
export function inferVerifiability(rule: Pick<Rule, 'evidenceMode' | 'ruleClass'>): Verifiability {
  if (rule.evidenceMode === 'git-diff') return 'machine-judgeable';
  if (rule.evidenceMode === 'hybrid') return 'human-review';
  return 'heuristic';
}

/** 判定函数签名描述（人类可读——按证据模式给输入输出形态） */
export function signatureOf(rule: Pick<Rule, 'evidenceMode' | 'name'>): string {
  switch (rule.evidenceMode) {
    case 'git-diff':
      return `(diff: DiffFile[]) => PASS | FAIL——纯 diff 判定，无外部依赖`;
    case 'hybrid':
      return `(diff: DiffFile[], logs?: LogEntry[]) => PASS | FAIL | UNKNOWN——有日志走精确检查，无日志走启发式回退`;
    case 'filesystem':
      return `(fsSnapshot: FilesystemSnapshot) => PASS | FAIL——文件系统状态判定`;
    default:
      return `(ctx: AuditContext) => RuleCheck——综合上下文判定`;
  }
}

/** 已实现规则 → 导出条目（reward_hint 段三件套齐全） */
export function toRuleExportEntry(rule: Rule): RuleExportEntry {
  const m = rule.name.match(/^[A-E]\d+/);
  return {
    code: m ? m[0] : rule.name,
    name: rule.name,
    number: rule.number,
    evidenceMode: rule.evidenceMode,
    ...(rule.ruleClass ? { ruleClass: rule.ruleClass } : {}),
    ...(rule.priority ? { priority: rule.priority } : {}),
    ...(rule.description ? { description: rule.description } : {}),
    ...(rule.examples ? { examples: rule.examples } : {}),
    ...(rule.justification ? { justification: rule.justification } : {}),
    reward_hint: {
      signature: signatureOf(rule),
      severityWeight: severityWeightOf(rule.priority),
      verifiability: inferVerifiability(rule),
    },
    status: 'implemented',
  };
}

/** 三条跳号编号位 → 占位条目（merged-into-A11 登记） */
export function mergedPlaceholder(code: string, number: number, note: string): RuleExportEntry {
  return {
    code,
    name: `${code}（已并入 A11）`,
    number,
    evidenceMode: 'git-diff',
    reward_hint: {
      signature: `(diff: DiffFile[]) => PASS | FAIL——判定已并入 A11 不滥资源（${note}）`,
      severityWeight: 0.6,
      verifiability: 'machine-judgeable',
    },
    status: MERGED_INTO_A11,
    mergedInto: 'A11',
  };
}

/** 27 编号位全集：24 实现 + 3 占位（A12/A13/E3） */
export function allRuleSlots(implemented: Rule[]): RuleExportEntry[] {
  return [
    ...implemented.map(toRuleExportEntry),
    mergedPlaceholder('A12', 12, '供应链安全——v0.99.4 并入'),
    mergedPlaceholder('A13', 13, '文件权限——v0.99.4 并入'),
    mergedPlaceholder('E3', 203, '行数维度——v1.2.5 并入'),
  ];
}
