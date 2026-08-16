// ============================================================
// commons-rule-fixtures.ts · 评估体系三步单测 fixture（v1.3.6 对齐）  // v1.3.6
//
// Mock 数据——单测读 fixture 不读真实 data/。
// 构造：
//   - 3 条低分差评（含 comment 文本，可被 parseFdeDeliveryReport 解析）
//   - 2 条 Refine 反复触发 case（failCount ≥ 阈值）
//   - golden set 样本（用于 jury 的 Benchmark 对比）
// ============================================================
/** 3 条低分差评（comment 含 FDE delivery-report 格式规则声明） */
export const FIXTURE_LOW_SCORE_RATINGS = [
  {
    capabilityId: 'cap-finance-report',
    raterId: 'rater-001',
    score: 0.2,
    comment: '## Quality Rule: max_length|output|maxLength=300|财报输出超 300 字，需精简',
  },
  {
    capabilityId: 'cap-data-clean',
    raterId: 'rater-002',
    score: 0.15,
    comment: '- Quality: required_keyword|output|keywords=审计,留痕|输出缺少审计留痕关键词',
  },
  {
    capabilityId: 'cap-data-clean',
    raterId: 'rater-003',
    score: 0.1,
    comment: '## Quality Rule: forbidden_pattern|output|pattern=(rm -rf)|含危险命令模式',
  },
];

/** 2 条 Refine 反复触发 case（failCount ≥ REPEAT_FAIL_THRESHOLD=3） */
export const FIXTURE_REPEAT_FAIL_CASES = [
  {
    capabilityId: 'cap-timeout-skill',
    failCount: 5,
    lastReason: '执行 timeout 超时',
  },
  {
    capabilityId: 'cap-crash-skill',
    failCount: 4,
    lastReason: 'agent crash 崩溃',
  },
];

/** golden set 样本（用于 jury 的 Benchmark 对比） */
export const FIXTURE_GOLDEN_SET = [
  // 超长输出样本（会触发 max_length 规则）
  {
    output: 'A'.repeat(600), // 600 字 > maxLength 300
    skill_description: '测试 Skill 带 example 示例',
    skill_few_shot: '1. 示例一\n2. 示例二',
  },
  // 缺关键词样本
  {
    output: '这是一个不含关键词的输出',
    skill_description: '测试 Skill 带 example 示例',
    skill_few_shot: '1. 示例一\n2. 示例二',
  },
  // 危险命令样本
  {
    output: '执行 rm -rf / 清理',
    skill_description: '测试 Skill 带 example 示例',
    skill_few_shot: '1. 示例一\n2. 示例二',
  },
  // 正常样本
  {
    output: '正常的审计留痕输出',
    skill_description: '测试 Skill 带 example 示例',
    skill_few_shot: '1. 示例一\n2. 示例二',
  },
];

/** FDE delivery-report 格式案例文本 */
export const FIXTURE_CASE_TEXTS = [
  '## Quality Rule: json_valid|output||输出必须是合法 JSON',
];
