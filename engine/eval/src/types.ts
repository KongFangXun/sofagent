// ============================================================
// eval/types.ts · eval harness 类型定义
// v1.5.8 从 sofagent/audit/src/eval/types.ts 迁出
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
 * 评分权重（F18 · v1.5.7 SSOT 收口）。
 *
 * 缺陷背景：同一组权重（0.5/0.2/0.3）曾散落三处——eval-scorer.ts:122 的内联
 * 乘式、mcp promote-ab.ts:146 的字面对象、ab-test types.ts 的旧
 * DEFAULT_SCORE_WEIGHTS。三处无对账，任一处调整即静默漂移（评分与晋升判定
 * 用不同权重还各自以为同口径）。
 *
 * 依赖方向（SSOT 落本包的依据）：ab-test → eval（ab-test package.json 依赖
 * @sofagent/eval；eval 不反向依赖任何评分消费方）⇒ 落 eval 后所有下游可
 * import，不产生环。
 */
export interface ScoreWeights {
  exactMatch: number;
  semanticSimilarity: number;
  ruleCompliance: number;
}

/**
 * 默认评分权重 SSOT（F18 · v1.5.7）：精确匹配 50% · 语义 20% · 规则合规 30%。
 * 全仓唯一份——eval-scorer / mcp promote-ab / ab-test 一律 import 本常量，
 * 机械守卫（engine 各包 src 下 0\.5.*0\.2.*0\.3 零命中，本文件除外）锁死第二份。
 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  exactMatch: 0.5,
  semanticSimilarity: 0.2,
  ruleCompliance: 0.3,
};

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
