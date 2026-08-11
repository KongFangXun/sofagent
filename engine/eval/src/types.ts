// ============================================================
// eval/types.ts · eval harness 类型定义
// v1.3.2 从 sofagent/audit/src/eval/types.ts 迁出
// ============================================================

/**
 * golden set 中的单条测试用例
 */
export interface TestCase {
  /** 唯一标识 */
  id: string;
  /** 用例描述 */
  description: string;
  /** 测试输入 */
  input: Record<string, unknown>;
  /** 期望输出 */
  expected: Record<string, unknown>;
  /** 标签（分类用） */
  tags?: string[];
  /** v1.0.7: 允许的工具列表（方案 C createReactAgent 才生效） */
  allowedTools?: string[];
}

/**
 * 单条用例的运行结果
 */
export interface TestCaseResult {
  /** 对应 TestCase.id */
  testId: string;
  /** 是否通过 */
  passed: boolean;
  /** 实际输出 */
  actual: Record<string, unknown>;
  /** 期望输出 */
  expected: Record<string, unknown>;
  /** 评分详情 */
  score: EvalBreakdown;
  /** 错误信息（如果失败） */
  error?: string;
  /** 执行耗时（ms） */
  duration: number;
}

/**
 * 评分维度分解
 */
export interface EvalBreakdown {
  /** 精确匹配得分（0-1） */
  exactMatch: number;
  /** 语义相似度得分（0-1） */
  semanticSimilarity: number;
  /** 规则合规得分（0-1） */
  ruleCompliance: number;
  /** 综合得分（0-1） */
  overall: number;
}

/**
 * 完整 eval 运行结果
 */
export interface EvalResult {
  /** 总用例数 */
  total: number;
  /** 通过数 */
  passed: number;
  /** 失败数 */
  failed: number;
  /** 通过率（0-1） */
  passRate: number;
  /** 各用例结果 */
  results: TestCaseResult[];
  /** 总耗时（ms） */
  duration: number;
}

/**
 * eval 运行配置
 */
export interface EvalConfig {
  /** golden set 文件路径 */
  goldenSetPath: string;
  /** 是否详细输出 */
  verbose?: boolean;
}
