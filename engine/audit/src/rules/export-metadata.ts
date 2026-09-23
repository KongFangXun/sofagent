// ============================================================
// export-metadata.ts · v1.5.2 章二 · 规则训练消费元数据
//
// 定位：24 条审计规则（defaultRules 17 + extendedRules 7）的**训练消费元数据**——
// 把「约束」从 TS 硬编码形态升级为训练管线可机器消费的结构（reward 信号 / SFT 语料）。
//
// 每条规则附四件套：
//   - rule_id      规则唯一编号（即 Rule.id——单源，不重推）
//   - intent       检测意图（一句话人类可读的「这条规则在防什么」）
//   - severity     严重级别（'FAIL' | 'WARN'——与 ruleset-loader 的 RulesetSeverity 对齐）
//   - sampleViolation  违规样例（可执行样例串，优先复用规则自带 examples.match）
//
// 严重级别推导口径（显式、有据可依）：
//   priority === 'critical' → 'FAIL'；其余（warning / crutch / extended / 未标注）→ 'WARN'。
//   依据：rules/types.ts 对 priority 的定义——critical = 「安全红线——fast-fail 后续层」，
//   违规即应硬拦截（对应 ruleset 的 FAIL = exit 2）；warning = 业务底线、crutch = 拐杖、
//   extended = 扩展，均非安全红线，对应 ruleset 的 WARN = exit 1。该口径与
//   ruleset-loader.runPatternRule 的 `severity === 'FAIL' ? '业务底线' : '工程规范'`
//   分级语义一致（FAIL ↔ 底线/红线）。
//
// 违规样例来源（降级说明）：
//   优先复用规则自带的 examples.match（v1.4.0「规则即测试」样本），来源标 'examples.match'；
//   若某规则未带可执行样例（examples 缺失或 match 为空），则由意图合成占位样例并标
//   'synthesized'——消费方据此区分「真实违规样例」与「占位补齐」，不做偷偷兜底。
//   🔴 当前 24 条规则全部自带 examples.match（index.ts 注册表），synthesized 分支为
//   防御性兜底，防未来新增规则漏带样例导致整表断裂。
//
// 意图表全覆盖：RULE_INTENTS 必须 24 条全覆盖——assertIntentCoverage 为构建期断言，
// 缺一条即抛错（`buildExportMetadata` 也调用它，任何消费点都不会拿到残缺表）。
// ============================================================

import type { Rule } from './types';

/** 规则严重级别（与 ruleset-loader.ts 的 RulesetSeverity 同值——可用于 ruleset 导出） */
export type RuleSeverity = 'FAIL' | 'WARN';

/** 违规样例来源——用于区分「规则自带真实样例」与「本章补齐的占位样例」 */
export type SampleViolationSource = 'examples.match' | 'synthesized';

/** 单条规则训练消费元数据 */
export interface RuleExportMetadata {
  /** 规则唯一编号（即 Rule.id，单源） */
  ruleId: string;
  /** 检测意图（一句话人类可读的「这条规则在防什么」） */
  intent: string;
  /** 严重级别（推导口径见文件头） */
  severity: RuleSeverity;
  /** 违规样例（可执行样例串） */
  sampleViolation: string;
  /** 违规样例来源 */
  sampleViolationSource: SampleViolationSource;
  /** 严重级别推导依据（逐条落盘，训练消费方可复核口径） */
  severityBasis: string;
}

/** 严重级别推导依据（单一常量——各记录共享同一条口径说明，禁多处重写） */
export const SEVERITY_BASIS =
  "priority==='critical' → 'FAIL'（安全红线 / fast-fail，违规即 exit 2）；" +
  "其余（warning/crutch/extended/未标注）→ 'WARN'（业务底线/拐杖/扩展，非安全红线，违规即 exit 1）";

/**
 * 24 条规则检测意图表（rule_id → 一句话「这条规则在防什么」）。
 *
 * 覆盖口径：A1-A11 + A14-A23 + E1/E2/E4 = 24 条（与 rules/index.ts 注册表逐条对应）。
 * 缺一条即视为缺陷——由 assertIntentCoverage 构建期兜住。
 */
export const RULE_INTENTS: Record<string, string> = {
  A1: '防止密钥/凭据/私钥文件被提交进版本控制——提交即扩大泄漏面',
  A2: '防止密钥/令牌硬编码进代码或配置——须走环境变量或密钥管理',
  A3: '防止修改超出任务声明的文件范围——疑似越权编辑',
  A4: '防止配置文件被删除——审计规则/权限配置可能被绕过',
  A5: '防止 commit message 为空或占位符——变更无说明，无法审计意图',
  A6: '防止构建配置异常改动却无验证记录——可能破坏构建',
  A7: '防止被修改文件缺少读取记录——疑似盲改',
  A8: '防止构建变更后缺少测试记录——可能逃过验证',
  A9: '防止变更内容含 prompt 注入模式——试图操纵下游读取者',
  A10: '防止依赖变更引入风险包（黑名单/仿冒/恶意 postinstall）',
  A11: '防止资源滥用（超大文件/大行数变更）——疑似异常操作',
  A14: '防止知识库访问超出工作流声明范围',
  A15: '防止 workflow 节点未声明可执行动作——无法审计',
  A16: '防止非授权文件被修改（敏感目录/文件类型的越权变更）',
  A17: '防止单次提交变更文件数超阈值——疑似批量异常操作',
  A18: '防止临时/垃圾文件被提交——污染仓库',
  A19: '防止 commit message 命中黑名单词或过短——无信息量',
  A20: '防止数据外传（HTTP 直连/WebSocket/DNS 隧道）——疑似数据泄漏面',
  A21: '防止持久化后门（自启/定时任务）——疑似植入后门',
  A22: '防止权限提升（全权限文件/提权配置/setuid）——疑似越权',
  A23: '防止路径穿越/symlink 逃逸——越出工作区边界',
  E1: '防止测试文件被提交到生产目录',
  E2: '防止新增 TODO 未在任务中声明——遗留未完成项',
  E4: '防止新增大量代码注释率过低——维护性差',
};

/**
 * 严重级别推导（单源实现）。
 * @param rule 规则（只需 priority 字段）
 * @returns 'FAIL'（critical）/ 'WARN'（其余）
 */
export function severityOf(rule: Pick<Rule, 'priority'>): RuleSeverity {
  return rule.priority === 'critical' ? 'FAIL' : 'WARN';
}

/**
 * 违规样例提取——优先复用规则自带 examples.match，缺失时合成占位样例。
 * @param rule 规则定义
 * @returns 样例串 + 来源标注
 */
export function sampleViolationOf(rule: Rule): { value: string; source: SampleViolationSource } {
  const samples = rule.examples?.match ?? [];
  const first = samples.find((s) => typeof s === 'string' && s.trim().length > 0);
  if (first) return { value: first, source: 'examples.match' };
  // 防御性兜底：规则未带可执行样例时由意图合成占位（显式标注来源，不做偷偷兜底）
  const intent = RULE_INTENTS[rule.id];
  return {
    value: `【样例缺失】${intent ?? rule.name}`,
    source: 'synthesized',
  };
}

/**
 * 意图表全覆盖断言（构建期）——缺一条或存在无对应规则的键即抛错。
 *
 * 双向校验：① 每条规则都有意图（漏一条 = 缺陷）；② 意图表无孤儿键
 * （有键无规则 = 规则已更名/删除后意图表未同步）。
 *
 * @param rules 规则列表
 * @throws Error 当意图表与规则列表不双向匹配时
 */
export function assertIntentCoverage(rules: Rule[]): void {
  const missing = rules.filter((r) => !RULE_INTENTS[r.id]).map((r) => r.id);
  if (missing.length > 0) {
    throw new Error(
      `RULE_INTENTS 缺 ${missing.length} 条规则意图（24 条须全覆盖）：${missing.join(', ')}`,
    );
  }
  const known = new Set(rules.map((r) => r.id));
  const orphan = Object.keys(RULE_INTENTS).filter((id) => !known.has(id));
  if (orphan.length > 0) {
    throw new Error(
      `RULE_INTENTS 存在无对应规则的孤儿键（规则已更名/删除后意图表未同步）：${orphan.join(', ')}`,
    );
  }
}

/**
 * 构建规则训练消费元数据表。
 *
 * 先跑意图表全覆盖断言（缺一条即抛错），再逐条映射。
 *
 * @param rules 规则列表（调用方传 [...defaultRules, ...extendedRules]）
 * @returns 每条规则一条元数据（顺序与入参一致）
 * @throws Error 当意图表未全覆盖时
 */
export function buildExportMetadata(rules: Rule[]): RuleExportMetadata[] {
  assertIntentCoverage(rules);
  return rules.map((rule) => {
    const intent = RULE_INTENTS[rule.id];
    if (intent === undefined) {
      // assertIntentCoverage 已保证存在——此处仅为类型收窄（noUncheckedIndexedAccess）
      throw new Error(`RULE_INTENTS 缺规则 ${rule.id} 的意图`);
    }
    const sample = sampleViolationOf(rule);
    return {
      ruleId: rule.id,
      intent,
      severity: severityOf(rule),
      sampleViolation: sample.value,
      sampleViolationSource: sample.source,
      severityBasis: SEVERITY_BASIS,
    };
  });
}
