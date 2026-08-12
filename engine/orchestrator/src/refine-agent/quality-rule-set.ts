// ============================================================
// refine-agent/quality-rule-set.ts · 质量规则集加载 + 匹配（v1.3.3 交付 T04）
// ============================================================
//
// Refine Agent 的「定性判据」——输出规不规范。
// 与 Onboard Agent 的 Ontology 判据（对错）互补：
//   - Onboard（L2 ontology-comparator）：字段有没有 / 值对不对（语义对错）
//   - Refine（L2 quality-judge）：工具描述带没带 example / 输出超不超 500 字 / few-shot 够不够（质量好坏）
//
// 三来源（协议设计 §7.3）：
//   1. 内置模板（硬编码）
//   2. 客户 FDE 回写（delivery-report.md → 规则化解析）
//   3. 团队反馈（team-state.feedback[] 中 type=quality_rule 的条目——经 §4 反馈放大链路写入）
//
// 零新依赖——纯规则驱动（不调 LLM）。
// ============================================================

/** 质量规则检查类型 */
export type QualityCheckType =
  | 'has_example'        // 工具描述必须带 example
  | 'max_length'         // 输出不超 N 字
  | 'min_few_shot'       // few-shot 至少 N 条
  | 'required_keyword'   // 必须包含关键词
  | 'forbidden_pattern'  // 禁止出现正则模式
  | 'json_valid'         // 输出必须是合法 JSON
  | 'custom';            // 自定义规则（团队反馈 / 客户回写）

/** 质量规则严重程度 */
export type QualitySeverity = 'error' | 'warn';

/** 单条质量规则 */
export interface QualityRule {
  /** 规则 ID */
  id: string;
  /** 规则来源 */
  source: 'builtin' | 'fde_delivery' | 'team_feedback';
  /** 检查类型 */
  check: QualityCheckType;
  /** 规则描述（人类可读） */
  description: string;
  /** 目标字段名（检查哪个字段的输出，如 'output' / 'skill_description'） */
  targetField: string;
  /** 检查参数（随 check 类型变化） */
  params: QualityRuleParams;
  /** 严重程度（默认 error） */
  severity: QualitySeverity;
}

/** 检查参数（随 check 类型变化） */
export interface QualityRuleParams {
  /** max_length：最大字符数 */
  maxLength?: number;
  /** min_few_shot：最少 few-shot 条数 */
  minCount?: number;
  /** required_keyword：必须包含的关键词列表 */
  keywords?: string[];
  /** forbidden_pattern：禁止的正则 */
  pattern?: string;
  /** has_example：example 标识关键词（如 'example' / '示例'） */
  exampleKeywords?: string[];
}

/** 单条质量检查结果 */
export interface QualityCheckResult {
  /** 关联的规则 ID */
  ruleId: string;
  /** 是否通过 */
  passed: boolean;
  /** 检查类型 */
  check: QualityCheckType;
  /** 目标字段 */
  targetField: string;
  /** 详情（通过时 = 'ok'，失败时 = 具体问题描述） */
  detail: string;
  /** 严重程度 */
  severity: QualitySeverity;
}

/** 质量规则集 */
export interface QualityRuleSet {
  /** 规则列表 */
  rules: QualityRule[];
  /** 来源统计 */
  sourceCounts: {
    builtin: number;
    fde_delivery: number;
    team_feedback: number;
  };
}

// ────────────────────────────────────────────────────────────
// 内置模板（来源 1：硬编码）
// ────────────────────────────────────────────────────────────

/**
 * 内置质量规则模板（协议设计 §7.3 第 1 来源）。
 *
 * 三条硬编码规则（dev prompt L199）：
 *   1. 工具描述必须带 example
 *   2. 输出不超 500 字
 *   3. few-shot 至少 2 条
 */
export function builtinQualityRules(): QualityRule[] {
  return [
    {
      id: 'builtin-has-example',
      source: 'builtin',
      check: 'has_example',
      description: '工具描述必须带 example / 示例',
      targetField: 'skill_description',
      params: {
        exampleKeywords: ['example', '示例', '例子', 'e.g.', '例如'],
      },
      severity: 'warn',
    },
    {
      id: 'builtin-max-length-500',
      source: 'builtin',
      check: 'max_length',
      description: '输出不超 500 字',
      targetField: 'output',
      params: {
        maxLength: 500,
      },
      severity: 'warn',
    },
    {
      id: 'builtin-min-few-shot-2',
      source: 'builtin',
      check: 'min_few_shot',
      description: 'few-shot 至少 2 条',
      targetField: 'skill_few_shot',
      params: {
        minCount: 2,
      },
      severity: 'warn',
    },
  ];
}

// ────────────────────────────────────────────────────────────
// 客户 FDE 回写解析（来源 2）
// ────────────────────────────────────────────────────────────

/** FDE delivery-report.md 中的单条质量反馈 */
export interface FdeQualityFeedback {
  /** 规则描述 */
  description: string;
  /** 目标字段 */
  targetField: string;
  /** 检查类型 */
  check: QualityCheckType;
  /** 检查参数 */
  params: QualityRuleParams;
  /** 严重程度 */
  severity: QualitySeverity;
}

/**
 * 解析 FDE delivery-report.md 为质量规则（来源 2）。
 *
 * delivery-report.md 格式约定（每行一条质量反馈）：
 *   - 以 `## Quality Rule:` 或 `- Quality:` 开头的行视为规则声明
 *   - 格式：`check:targetField:param=value:description`
 *
 * 解析失败的行静默跳过（不阻断——降级处理）。
 *
 * @param reportText delivery-report.md 文本
 * @returns 解析出的质量反馈列表
 */
export function parseFdeDeliveryReport(reportText: string): FdeQualityFeedback[] {
  const results: FdeQualityFeedback[] = [];
  if (!reportText || reportText.trim().length === 0) return results;

  const lines = reportText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // 匹配 `## Quality Rule:` 或 `- Quality:` 开头
    const match = trimmed.match(/^(?:##\s*)?(?:-\s*)?Quality\s*(?:Rule)?:\s*(.+)$/i);
    if (!match || !match[1]) continue;

    const body = match[1].trim();
    const parsed = parseFdeRuleLine(body);
    if (parsed) results.push(parsed);
  }
  return results;
}

/** 解析单条 FDE 规则行（check:targetField:param=value:description） */
function parseFdeRuleLine(body: string): FdeQualityFeedback | null {
  // 按 | 分隔各段
  const parts = body.split('|').map((p) => p.trim());
  if (parts.length < 2) return null;

  const checkStr = parts[0] ?? '';
  const targetField = parts[1] ?? '';
  const description = parts[parts.length - 1] ?? '';

  const validChecks: QualityCheckType[] = [
    'has_example', 'max_length', 'min_few_shot',
    'required_keyword', 'forbidden_pattern', 'json_valid', 'custom',
  ];
  if (!validChecks.includes(checkStr as QualityCheckType)) return null;

  const check = checkStr as QualityCheckType;
  const params: QualityRuleParams = {};
  let severity: QualitySeverity = 'warn';

  // 中间的 param=value 段
  for (let i = 2; i < parts.length - 1; i++) {
    const seg = parts[i] ?? '';
    const eqIdx = seg.indexOf('=');
    if (eqIdx === -1) continue;
    const key = seg.slice(0, eqIdx).trim();
    const val = seg.slice(eqIdx + 1).trim();

    switch (key) {
      case 'maxLength':
        params.maxLength = parseInt(val, 10);
        break;
      case 'minCount':
        params.minCount = parseInt(val, 10);
        break;
      case 'keywords':
        params.keywords = val.split(',').map((s) => s.trim());
        break;
      case 'pattern':
        params.pattern = val;
        break;
      case 'severity':
        severity = val === 'error' ? 'error' : 'warn';
        break;
    }
  }

  return { description, targetField, check, params, severity };
}

/**
 * 把 FDE 质量反馈转为 QualityRule 列表。
 *
 * @param feedbacks FDE 解析出的反馈列表
 * @returns QualityRule 列表（source = fde_delivery）
 */
export function fdeFeedbacksToRules(feedbacks: FdeQualityFeedback[]): QualityRule[] {
  return feedbacks.map((fb, i) => ({
    id: `fde-${i + 1}-${fb.check}`,
    source: 'fde_delivery' as const,
    check: fb.check,
    description: fb.description,
    targetField: fb.targetField,
    params: fb.params,
    severity: fb.severity,
  }));
}

// ────────────────────────────────────────────────────────────
// 团队反馈来源（来源 3）
// ────────────────────────────────────────────────────────────

/** 团队反馈条目（与 team-state.ts FeedbackEntry 对齐——只取需要的字段） */
export interface TeamFeedbackEntry {
  /** 反馈内容 */
  content: string;
  /** 反馈类型 */
  type: string;
}

/**
 * 把团队反馈（type=quality_rule）转为质量规则（来源 3）。
 *
 * 团队反馈格式约定（协议设计 §4.3）：
 *   content 格式同 FDE：`check:targetField:param=value:description`
 *
 * 解析失败的条目静默跳过（不阻断——降级处理）。
 *
 * @param feedbacks 团队反馈条目列表
 * @returns QualityRule 列表（source = team_feedback）
 */
export function teamFeedbacksToRules(feedbacks: TeamFeedbackEntry[]): QualityRule[] {
  const rules: QualityRule[] = [];
  let idx = 0;
  for (const fb of feedbacks) {
    if (fb.type !== 'quality_rule') continue;
    const parsed = parseFdeRuleLine(fb.content);
    if (!parsed) continue;
    idx++;
    rules.push({
      id: `team-${idx}-${parsed.check}`,
      source: 'team_feedback' as const,
      check: parsed.check,
      description: parsed.description,
      targetField: parsed.targetField,
      params: parsed.params,
      severity: parsed.severity,
    });
  }
  return rules;
}

// ────────────────────────────────────────────────────────────
// 规则集加载（三来源合并）
// ────────────────────────────────────────────────────────────

/** 规则集加载选项 */
export interface LoadRuleSetOptions {
  /** FDE delivery-report.md 文本（来源 2；缺省跳过） */
  fdeDeliveryReport?: string;
  /** 团队反馈条目（来源 3；缺省跳过） */
  teamFeedbacks?: TeamFeedbackEntry[];
}

/**
 * 加载质量规则集——三来源合并（协议设计 §7.3）。
 *
 * 加载顺序（后者覆盖前者同名规则——内置优先级最低）：
 *   1. 内置模板（硬编码）
 *   2. 客户 FDE 回写（delivery-report.md → 规则化解析）
 *   3. 团队反馈（feedback[] 中 type=quality_rule 的条目）
 *
 * @param options 加载选项
 * @returns QualityRuleSet
 */
export function loadQualityRuleSet(options: LoadRuleSetOptions = {}): QualityRuleSet {
  const rules: QualityRule[] = [];

  // 来源 1：内置模板
  const builtin = builtinQualityRules();
  rules.push(...builtin);

  // 来源 2：客户 FDE 回写
  let fdeCount = 0;
  if (options.fdeDeliveryReport) {
    const feedbacks = parseFdeDeliveryReport(options.fdeDeliveryReport);
    const fdeRules = fdeFeedbacksToRules(feedbacks);
    rules.push(...fdeRules);
    fdeCount = fdeRules.length;
  }

  // 来源 3：团队反馈
  let teamCount = 0;
  if (options.teamFeedbacks && options.teamFeedbacks.length > 0) {
    const teamRules = teamFeedbacksToRules(options.teamFeedbacks);
    rules.push(...teamRules);
    teamCount = teamRules.length;
  }

  return {
    rules,
    sourceCounts: {
      builtin: builtin.length,
      fde_delivery: fdeCount,
      team_feedback: teamCount,
    },
  };
}

// ────────────────────────────────────────────────────────────
// 规则匹配（对节点输出跑规则集）
// ────────────────────────────────────────────────────────────

/** 节点输出字段提取结果（字段名 → 值文本） */
export type NodeOutputFields = Record<string, string>;

/**
 * 对节点输出字段跑质量规则集——返回每条规则的检查结果。
 *
 * @param fields 节点输出字段（targetField → 值文本）
 * @param ruleSet 质量规则集
 * @returns 每条规则的检查结果列表
 */
export function matchQualityRules(
  fields: NodeOutputFields,
  ruleSet: QualityRuleSet,
): QualityCheckResult[] {
  const results: QualityCheckResult[] = [];

  for (const rule of ruleSet.rules) {
    const fieldValue = fields[rule.targetField] ?? '';
    const result = evaluateRule(rule, fieldValue);
    results.push(result);
  }

  return results;
}

/**
 * 评估单条规则——字段值 → 通过/失败 + 详情。
 *
 * @param rule 质量规则
 * @param fieldValue 字段值文本
 * @returns QualityCheckResult
 */
export function evaluateRule(rule: QualityRule, fieldValue: string): QualityCheckResult {
  const base: Omit<QualityCheckResult, 'passed' | 'detail'> = {
    ruleId: rule.id,
    check: rule.check,
    targetField: rule.targetField,
    severity: rule.severity,
  };

  switch (rule.check) {
    case 'has_example': {
      const keywords = rule.params.exampleKeywords ?? ['example', '示例'];
      const found = keywords.some((kw) => fieldValue.toLowerCase().includes(kw.toLowerCase()));
      if (found) {
        return { ...base, passed: true, detail: 'ok' };
      }
      return {
        ...base,
        passed: false,
        detail: `字段「${rule.targetField}」未包含示例关键词（${keywords.join('/')}）`,
      };
    }

    case 'max_length': {
      const max = rule.params.maxLength ?? 500;
      if (fieldValue.length <= max) {
        return { ...base, passed: true, detail: 'ok' };
      }
      return {
        ...base,
        passed: false,
        detail: `字段「${rule.targetField}」长度 ${fieldValue.length} 超过上限 ${max}`,
      };
    }

    case 'min_few_shot': {
      const min = rule.params.minCount ?? 2;
      // 统计 few-shot 条数（以 --- 或 编号 或 ``` 分隔的块计数）
      const fewShotCount = countFewShots(fieldValue);
      if (fewShotCount >= min) {
        return { ...base, passed: true, detail: 'ok' };
      }
      return {
        ...base,
        passed: false,
        detail: `字段「${rule.targetField}」few-shot 仅 ${fewShotCount} 条，不足 ${min} 条`,
      };
    }

    case 'required_keyword': {
      const keywords = rule.params.keywords ?? [];
      const missing = keywords.filter(
        (kw) => !fieldValue.toLowerCase().includes(kw.toLowerCase()),
      );
      if (missing.length === 0) {
        return { ...base, passed: true, detail: 'ok' };
      }
      return {
        ...base,
        passed: false,
        detail: `字段「${rule.targetField}」缺少关键词：${missing.join(', ')}`,
      };
    }

    case 'forbidden_pattern': {
      const patternStr = rule.params.pattern ?? '';
      if (!patternStr) {
        return { ...base, passed: true, detail: 'ok' };
      }
      try {
        const regex = new RegExp(patternStr);
        if (!regex.test(fieldValue)) {
          return { ...base, passed: true, detail: 'ok' };
        }
        return {
          ...base,
          passed: false,
          detail: `字段「${rule.targetField}」命中禁止模式 /${patternStr}/`,
        };
      } catch {
        // 正则无效 → 跳过（不阻断）
        return { ...base, passed: true, detail: '正则无效，跳过检查' };
      }
    }

    case 'json_valid': {
      const trimmed = fieldValue.trim();
      try {
        JSON.parse(trimmed);
        return { ...base, passed: true, detail: 'ok' };
      } catch {
        return {
          ...base,
          passed: false,
          detail: `字段「${rule.targetField}」不是合法 JSON`,
        };
      }
    }

    case 'custom': {
      // 自定义规则默认通过（具体逻辑由调用方在 params 中约定）
      return { ...base, passed: true, detail: 'custom 规则默认通过' };
    }

    default:
      return { ...base, passed: true, detail: '未知检查类型，默认通过' };
  }
}

/**
 * 统计 few-shot 条数。
 * 识别模式：以 --- 分隔的块 / 以数字编号开头（1. 2.）/ 以 ``` 代码块分隔。
 */
function countFewShots(text: string): number {
  if (!text || text.trim().length === 0) return 0;

  // 模式 1：--- 分隔
  const dashParts = text.split(/\n\s*---\s*\n/).filter((p) => p.trim().length > 0);
  if (dashParts.length > 1) return dashParts.length;

  // 模式 2：数字编号开头（1. / 2. / 1) 等）
  const numberedMatches = text.match(/^\s*\d+[.)]\s/gm);
  if (numberedMatches && numberedMatches.length > 0) return numberedMatches.length;

  // 模式 3：代码块分隔
  const codeBlocks = text.match(/```/g);
  if (codeBlocks && codeBlocks.length >= 2) {
    // 每两个 ``` 为一个代码块
    return Math.floor(codeBlocks.length / 2);
  }

  // 无明显分隔 → 计为 1 条（整个文本视为一个 example）
  return 1;
}

/**
 * 统计质量检查结果摘要。
 * @param results 检查结果列表
 * @returns 摘要字符串（如「3 条规则：2 通过 / 1 失败」）
 */
export function summarizeQualityResults(results: QualityCheckResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  return `${total} 条规则：${passed} 通过 / ${failed} 失败`;
}
