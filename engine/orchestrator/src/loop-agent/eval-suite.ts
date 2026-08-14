// ============================================================
// loop-agent/eval-suite.ts · 企业专属 eval 套件（v1.3.4 交付 6）
// ============================================================
//
// 企业行业 eval 模板加载 + 运行 + 基线冻结。
// FDE 交付时带一套可跑的企业行业 eval，Onboard L5 回归时跑企业 eval。
//
// 复用 v1.3.1 Benchmark 评测体系：
//   - freezeBenchmark(def) → 首次交付冻结基线
//   - appendEvaluationRecord(input) → eval 运行记录写入 evaluation-log（HMAC 链）
//   - getEvaluationLogPath(benchmarkId) → 日志路径解析
// ============================================================

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { BenchmarkDefinition, BenchmarkCase } from '../benchmark/benchmark-designer';

/** 行业类型 */
export type Industry = 'finance' | 'manufacturing' | 'supplychain' | 'customerservice' | 'generic';

/** 企业 eval 套件配置 */
export interface EnterpriseEvalSuite {
  /** 企业 ID */
  enterpriseId: string;
  /** 行业 */
  industry: Industry;
  /** Benchmark ID（freezeBenchmark 用） */
  benchmarkId: string;
  /** eval 模板实例化后的 cases */
  cases: EvalCase[];
  /** 是否已冻结基线 */
  frozen: boolean;
  /** 冻结 revision */
  revision: number;
}

/** 单个 eval case */
export interface EvalCase {
  /** Case ID */
  id: string;
  /** 测试语句 */
  statement: string;
  /** 评分标准 */
  rubric: string;
  /** 预期输出（L2 对比用） */
  expectedOutput?: Record<string, unknown>;
}

/** eval 套件运行结果 */
export interface EvalSuiteRunResult {
  /** Benchmark ID */
  benchmarkId: string;
  /** 运行的 case 数 */
  totalCases: number;
  /** 通过的 case 数（score >= 60） */
  passedCases: number;
  /** 平均分 */
  averageScore: number;
  /** 各 case 详情 */
  caseResults: Array<{
    caseId: string;
    score: number;
    failureCode: string | null;
    durationMs: number;
  }>;
}

/** 默认行业 eval 模板目录 */
export const DEFAULT_EVAL_TEMPLATE_DIR = join(process.cwd(), 'FDE', 'templates', 'eval-suite');

/**
 * 加载行业 eval 模板。
 *
 * @param industry 行业类型
 * @param templateDir 模板目录（默认 FDE/templates/eval-suite/）
 * @returns EvalCase[]（模板实例化的 cases）
 */
export function loadIndustryTemplate(
  industry: Industry,
  templateDir?: string,
): EvalCase[] {
  const dir = templateDir ?? DEFAULT_EVAL_TEMPLATE_DIR;
  const templatePath = join(dir, `${industry}.json`);

  if (!existsSync(templatePath)) {
    // 模板不存在 → 返回通用模板
    return getGenericTemplate();
  }

  try {
    const content = readFileSync(templatePath, 'utf-8');
    const parsed = JSON.parse(content) as { cases?: EvalCase[] };
    if (!Array.isArray(parsed.cases)) return getGenericTemplate();
    return parsed.cases;
  } catch {
    return getGenericTemplate();
  }
}

/** 通用 eval 模板（兜底——无行业匹配时） */
function getGenericTemplate(): EvalCase[] {
  return [
    {
      id: 'GENERIC-001',
      statement: '请完成一个基础任务并返回结构化结果',
      rubric: '输出格式正确 + 内容完整 + 无语法错误',
    },
    {
      id: 'GENERIC-002',
      statement: '请处理一个异常情况并给出处理方案',
      rubric: '识别异常 + 给出可行方案 + 标注风险',
    },
    {
      id: 'GENERIC-003',
      statement: '请根据输入数据生成一份摘要报告',
      rubric: '关键信息覆盖 + 结构清晰 + 无遗漏',
    },
  ];
}

/**
 * 实例化企业 eval 套件（从行业模板 + 企业自定义 case 生成）。
 *
 * @param enterpriseId 企业 ID
 * @param industry 行业类型
 * @param customCases 企业自定义 case（追加到模板 case 之后）
 * @param templateDir 模板目录
 * @returns EnterpriseEvalSuite
 */
export function instantiateEvalSuite(
  enterpriseId: string,
  industry: Industry,
  customCases: EvalCase[] = [],
  templateDir?: string,
): EnterpriseEvalSuite {
  const templateCases = loadIndustryTemplate(industry, templateDir);
  const allCases = [...templateCases, ...customCases];

  return {
    enterpriseId,
    industry,
    benchmarkId: `enterprise-${enterpriseId}-${industry}`,
    cases: allCases,
    frozen: false,
    revision: 0,
  };
}

/**
 * 冻结 eval 基线（复用 v1.3.1 freezeBenchmark）。
 *
 * 首次交付时跑一轮冻结基线——调用 benchmark-designer 的 freezeBenchmark。
 *
 * @param suite 企业 eval 套件
 * @returns 冻结后的 BenchmarkDefinition
 */
export async function freezeEvalBaseline(suite: EnterpriseEvalSuite): Promise<BenchmarkDefinition> {
  const { freezeBenchmark } = await import('../benchmark/benchmark-designer');

  // 构造 BenchmarkDefinition（复用 v1.3.1 schema）
  const benchmarkCases: BenchmarkCase[] = suite.cases.map((c) => ({
    id: c.id,
    name: c.id,
    statement: c.statement,
    rubric: c.rubric,
  }));

  const def: BenchmarkDefinition = {
    id: suite.benchmarkId,
    title: `企业 eval 套件 · ${suite.enterpriseId} · ${suite.industry}`,
    description: `行业=${suite.industry} 的企业专属 eval（v1.3.2 交付 6）`,
    runs: 1,
    revision: suite.revision,
    frozen: suite.frozen,
    cases: benchmarkCases,
    calibrations: [],
  };

  // 调用 freezeBenchmark（冻结后 frozen=true + revision 递增，返回新 revision）
  const newRevision = freezeBenchmark(def);
  suite.frozen = true;
  suite.revision = newRevision;
  return def;
}

/**
 * 运行 eval 套件（每个 case 跑一次，写 evaluation-log）。
 *
 * eval 运行记录写入 evaluation-log（调用 appendEvaluationRecord）。
 *
 * @param suite 企业 eval 套件
 * @param agentFn 被测 Agent 函数（输入 statement，返回输出文本）
 * @param scoreFn 评分函数（输入 statement + 输出，返回 0-100 分）
 * @returns EvalSuiteRunResult
 */
export async function runEvalSuite(
  suite: EnterpriseEvalSuite,
  agentFn: (statement: string) => Promise<string>,
  scoreFn: (statement: string, output: string, rubric: string) => number,
): Promise<EvalSuiteRunResult> {
  const { appendEvaluationRecord } = await import('../benchmark/evaluation-log');

  const caseResults: EvalSuiteRunResult['caseResults'] = [];
  let totalScore = 0;

  for (const evalCase of suite.cases) {
    const startedAt = Date.now();
    let output = '';
    let failureCode: string | null = null;

    try {
      output = await agentFn(evalCase.statement);
    } catch (err) {
      failureCode = 'agent_error';
      output = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - startedAt;
    const score = failureCode ? 0 : scoreFn(evalCase.statement, output, evalCase.rubric);
    totalScore += score;

    // 写 evaluation-log（调用 appendEvaluationRecord，HMAC 链防篡改）
    try {
      appendEvaluationRecord({
        benchmarkId: suite.benchmarkId,
        caseId: evalCase.id,
        revision: suite.revision,
        score,
        failureCode,
        durationMs,
      });
    } catch {
      // 日志写入失败静默（eval 运行优先）
    }

    caseResults.push({
      caseId: evalCase.id,
      score,
      failureCode,
      durationMs,
    });
  }

  const totalCases = suite.cases.length;
  const passedCases = caseResults.filter((r) => r.score >= 60).length;
  const averageScore = totalCases > 0 ? Math.round(totalScore / totalCases) : 0;

  return {
    benchmarkId: suite.benchmarkId,
    totalCases,
    passedCases,
    averageScore,
    caseResults,
  };
}
