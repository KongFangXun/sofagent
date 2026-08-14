// ============================================================
// refine-agent/optimization-loop.ts · 进化闭环（v1.3.4 交付 T05）
// ============================================================
//
// Benchmark 驱动 Dream Cycle——「定量判据」（Benchmark 分数提升没有）。
// 与 Refine 的「定性判据」（输出规不规范）互补。
//
// 核心循环：
//   evidence（Benchmark 分数 + Trace）
//     → hypothesis（哪个能力缺口导致失分）
//       → Candidate（修改经验层）
//         → evaluation（重跑 Benchmark）
//           → strictly improves ? accept : rollback
//
// 铁律——优化范围收窄（协议设计 §8.1）：
//   | 层                    | 允许改 | 禁止改 |
//   |-----------------------|:------:|:------:|
//   | L1 硬约束（SKILL.md） | ❌     | 永远不可碰 |
//   | L2 决策约束（think.md）| ✅     |       |
//   | L4 经验层（knowledge/）| ✅     |       |
//   | 审计规则（A1-A24）    | ❌     | 永远不可碰 |
//   | 回溯机制（git snapshot）| ❌   | 永远不可碰 |
//
// Benchmark 接入（dev prompt L229 已实测核实）：
//   freezeBenchmark(def) → 冻结基线（Reference）
//   evaluateCase() → Candidate 应用后重跑评分
//   appendEvaluationRecord(input) → HMAC 链落盘
//   严格 > Reference 才 accept
//
// 每次进化动作 emitDecision 带 evidence（复用 T01 扩展的 DecisionLogEntry.evidence 字段）。
// ============================================================

import { join } from 'path';
import { atomicAppendSync, atomicWriteSync } from '@sofagent/core';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import type { BenchmarkDefinition } from '../benchmark/benchmark-designer';
import type { EvaluateCaseInput, CaseEvaluation } from '../benchmark/case-evaluator';
import { evaluateCase } from '../benchmark/case-evaluator';
import { appendEvaluationRecord } from '../benchmark/evaluation-log';
import {
  takeSnapshot,
  rollbackToSnapshot,
  advanceVersion,
  readAgentVersion,
  EXPERIENCE_LAYER_PATTERNS,
} from './snapshot-manager';
import { checkContamination, type ContaminationCheckInput } from './contamination-guard';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 优化循环选项 */
export interface OptimizationLoopOptions {
  /** Agent ID */
  agentId: string;
  /** Agent 目录路径（经验层所在目录） */
  agentDir: string;
  /** Benchmark 定义（已冻结的基线） */
  benchmark: BenchmarkDefinition;
  /** 被测 Agent 执行函数（传入 evaluateCase 的 agentFn） */
  agentFn?: EvaluateCaseInput['agentFn'];
  /** 评分函数（传入 evaluateCase 的 scoringFn） */
  scoringFn?: EvaluateCaseInput['scoringFn'];
  /** emitDecision 函数（审计留痕——可注入 mock） */
  emitDecision?: (input: {
    agentId: string;
    sessionId: string;
    kind: 'EVOLUTION';
    moment: 'EVOLVE';
    why: string;
    evidence: string[];
    artifactRef?: string;
  }) => void;
  /** 最大优化迭代次数（默认 5） */
  maxIterations?: number;
  /** 最小可接受提升分数（accept 的严格阈值——默认 >0 即 accept） */
  minImprovement?: number;
  /** 日志输出 */
  log?: (msg: string) => void;
  /** 数据目录覆盖（测试隔离用） */
  overrideDataDir?: string;
  /** snapshot 注入（测试 mock 用——默认 git snapshot） */
  snapshotFn?: (agentDir: string, files: string[]) => string | null;
  /** rollback 注入（测试 mock 用） */
  rollbackFn?: (agentDir: string, files: string[], sha: string | null) => void;
}

/** 优化迭代结果（单轮） */
export interface OptimizationIteration {
  /** 迭代序号（1-based） */
  iteration: number;
  /** 假设描述（哪个能力缺口导致失分） */
  hypothesis: string;
  /** Candidate 修改内容（写入 think.md / knowledge 的文本） */
  candidateContent: string;
  /** Candidate 修改目标文件 */
  candidateTarget: string;
  /** Reference 分数（优化前 Benchmark 平均分） */
  referenceScore: number;
  /** Candidate 评分（优化后 Benchmark 平均分） */
  candidateScore: number;
  /** 分数变化 */
  scoreDelta: number;
  /** 是否 accept（candidateScore 严格 > referenceScore） */
  accepted: boolean;
  /** 污染检测结果 */
  contamination: { contaminated: boolean; details: string[] };
  /** 可证伪假设预测（优化前预测的行为变化） */
  prediction?: string;
  /** 快照 SHA（accept 前的还原点） */
  snapshotSha?: string | null;
  /** 版本号（accept 后的新版本号） */
  newVersion?: number;
  /** 证据链 */
  evidence: string[];
}

/** 优化循环最终结果 */
export interface OptimizationLoopResult {
  /** Agent ID */
  agentId: string;
  /** 初始 Reference 分数 */
  initialScore: number;
  /** 最终分数 */
  finalScore: number;
  /** 总提升分数 */
  totalImprovement: number;
  /** 各迭代记录 */
  iterations: OptimizationIteration[];
  /** 最终版本号 */
  finalVersion: number;
  /** 是否因污染检测停止 */
  stoppedByContamination: boolean;
  /** 总耗时 ms */
  totalDurationMs: number;
}

// ────────────────────────────────────────────────────────────
// 核心循环
// ────────────────────────────────────────────────────────────

/**
 * 运行进化闭环——Benchmark 驱动的经验层优化。
 *
 * 流程（每轮迭代）：
 *   1. evidence：跑 Benchmark 拿 Reference 分数 + 失分 trace
 *   2. hypothesis：根据失分推理能力缺口
 *   3. Candidate：生成经验层修改方案（只动 think.md / knowledge/）
 *   4. 污染检测：rubric/Gold 不得进入优化器上下文
 *   5. takeSnapshot：对经验层创建 git snapshot（还原点）
 *   6. applyCandidate：写入 think.md / knowledge（经 atomicWriteSync）
 *   7. evaluation：重跑 Benchmark 拿 Candidate 分数
 *   8. accept/rollback：严格 > Reference 才 accept，否则 git rollback
 *   9. emitDecision：每次进化动作带 evidence 留痕
 *
 * @param options 优化选项
 * @returns OptimizationLoopResult
 */
export async function runOptimizationLoop(
  options: OptimizationLoopOptions,
): Promise<OptimizationLoopResult> {
  const log = options.log ?? (() => {});
  const maxIterations = options.maxIterations ?? 5;
  const minImprovement = options.minImprovement ?? 0;

  const startedAt = Date.now();
  const iterations: OptimizationIteration[] = [];
  let stoppedByContamination = false;

  // 1. 跑初始 Benchmark 拿 Reference 分数
  log('📊 进化闭环启动：跑初始 Benchmark 拿 Reference 分数');
  const referenceScore = await runBenchmark(options, 'reference');
  let currentScore = referenceScore;
  log(`📊 Reference 分数：${referenceScore.toFixed(1)}/100`);

  // emitDecision：记录进化循环启动
  safeEmitDecision(options, {
    agentId: options.agentId,
    sessionId: `optimization-${options.agentId}`,
    kind: 'EVOLUTION' as const,
    moment: 'EVOLVE' as const,
    why: `进化闭环启动：Reference 分数 ${referenceScore.toFixed(1)}/100，开始 ${maxIterations} 轮优化`,
    evidence: [
      `Benchmark ${options.benchmark.id} revision=${options.benchmark.revision}`,
      `Reference 平均分 ${referenceScore.toFixed(1)}/100`,
      ...options.benchmark.cases.map((c) => `Case ${c.id}: gold=${c.goldScore ?? 'N/A'}`),
    ],
  });

  for (let iter = 1; iter <= maxIterations; iter++) {
    log(`🔁 优化迭代 ${iter}/${maxIterations}`);

    // 2. hypothesis：根据失分推理能力缺口
    const hypothesis = generateHypothesis(currentScore, iter);
    log(`💡 假设：${hypothesis}`);

    // 3. Candidate：生成经验层修改方案
    const candidate = generateCandidate(hypothesis, options.agentDir);
    log(`🔧 Candidate：修改 ${candidate.target}`);

    // 4. 污染检测
    const contaminationInput: ContaminationCheckInput = {
      optimizerContext: hypothesis + ' ' + candidate.content,
      candidateContent: candidate.content,
      ...(options.benchmark.cases[0]?.rubric ? { rubricText: options.benchmark.cases[0].rubric } : {}),
    };
    const contamination = checkContamination(contaminationInput);

    if (contamination.contaminated) {
      log(`🚫 污染检测命中：${contamination.details.join('; ')}——立即停止`);
      stoppedByContamination = true;
      // emitDecision：污染检测拦截
      safeEmitDecision(options, {
        agentId: options.agentId,
        sessionId: `optimization-${options.agentId}`,
        kind: 'EVOLUTION',
        moment: 'EVOLVE',
        why: `污染检测拦截：${contamination.details.join('; ')}——停止优化循环`,
        evidence: contamination.details,
      });
      break;
    }

    // 5. takeSnapshot：创建还原点
    const snapshotFiles = [join(options.agentDir, 'think.md')];
    const snapshotFn = options.snapshotFn ?? takeSnapshot;
    const snapshotSha = snapshotFn(options.agentDir, snapshotFiles);

    // 6. applyCandidate：写入经验层（经 atomicAppendSync）
    const thinkMdPath = join(options.agentDir, 'think.md');
    applyCandidateToExperience(candidate.target, candidate.content, options.agentDir);

    // 7. evaluation：重跑 Benchmark
    const candidateScore = await runBenchmark(options, `candidate-${iter}`);
    const scoreDelta = candidateScore - currentScore;
    log(`📈 Candidate 分数：${candidateScore.toFixed(1)}/100（Δ=${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(1)}）`);

    const accepted = scoreDelta > minImprovement;

    // 8. accept / rollback
    if (accepted) {
      log(`✅ Accept：分数提升 ${scoreDelta.toFixed(1)}，推进版本号`);
      const newVersion = advanceVersion(
        options.agentDir,
        options.agentId,
        candidate.description,
        scoreDelta,
        snapshotSha ?? undefined,
      );
      currentScore = candidateScore;

      // emitDecision：accept 记录
      safeEmitDecision(options, {
        agentId: options.agentId,
        sessionId: `optimization-${options.agentId}`,
        kind: 'EVOLUTION',
        moment: 'EVOLVE',
        why: `Candidate accept（迭代 ${iter}）：分数 ${candidateScore.toFixed(1)} > Reference ${currentScore.toFixed(1)}，版本号 → ${newVersion}`,
        evidence: [
          `Candidate 修改：${candidate.target}`,
          `分数变化：+${scoreDelta.toFixed(1)}`,
          `新版本号：v${newVersion}`,
          ...(snapshotSha ? [`git snapshot SHA: ${snapshotSha.slice(0, 8)}`] : []),
        ],
        artifactRef: candidate.target,
      });

      iterations.push({
        iteration: iter,
        hypothesis,
        candidateContent: candidate.content,
        candidateTarget: candidate.target,
        referenceScore: currentScore - scoreDelta,
        candidateScore,
        scoreDelta,
        accepted: true,
        contamination: { contaminated: false, details: [] },
        prediction: candidate.prediction,
        snapshotSha,
        newVersion,
        evidence: [
          `迭代 ${iter} accept`,
          `分数 ${candidateScore.toFixed(1)} 严格 > Reference`,
          `Δ=+${scoreDelta.toFixed(1)}`,
        ],
      });
    } else {
      log(`❌ Reject：分数未提升（Δ=${scoreDelta.toFixed(1)}），回滚`);
      // rollback
      const rollbackFn = options.rollbackFn ?? rollbackToSnapshot;
      rollbackFn(options.agentDir, snapshotFiles, snapshotSha);

      // emitDecision：reject + 回滚记录
      safeEmitDecision(options, {
        agentId: options.agentId,
        sessionId: `optimization-${options.agentId}`,
        kind: 'EVOLUTION',
        moment: 'EVOLVE',
        why: `Candidate reject（迭代 ${iter}）：分数 ${candidateScore.toFixed(1)} 未严格提升（Δ=${scoreDelta.toFixed(1)}），git snapshot 回滚`,
        evidence: [
          `Candidate 修改：${candidate.target}`,
          `分数变化：${scoreDelta >= 0 ? '+' : ''}${scoreDelta.toFixed(1)}（未通过严格提升阈值）`,
          `已回滚到 snapshot`,
          ...(snapshotSha ? [`git snapshot SHA: ${snapshotSha.slice(0, 8)}`] : []),
        ],
        artifactRef: candidate.target,
      });

      iterations.push({
        iteration: iter,
        hypothesis,
        candidateContent: candidate.content,
        candidateTarget: candidate.target,
        referenceScore: currentScore,
        candidateScore,
        scoreDelta,
        accepted: false,
        contamination: { contaminated: false, details: [] },
        prediction: candidate.prediction,
        snapshotSha,
        evidence: [
          `迭代 ${iter} reject`,
          `分数 ${candidateScore.toFixed(1)} 未严格提升`,
          `已回滚`,
        ],
      });
    }
  }

  // 最终版本号
  const finalVersion = readAgentVersion(options.agentDir, options.agentId).version;
  const totalImprovement = currentScore - referenceScore;

  // emitDecision：进化闭环结束
  safeEmitDecision(options, {
    agentId: options.agentId,
    sessionId: `optimization-${options.agentId}`,
    kind: 'EVOLUTION',
    moment: 'EVOLVE',
    why: `进化闭环结束：Reference ${referenceScore.toFixed(1)} → 最终 ${currentScore.toFixed(1)}（总提升 ${totalImprovement >= 0 ? '+' : ''}${totalImprovement.toFixed(1)}），版本 v${finalVersion}，${iterations.filter((i) => i.accepted).length}/${iterations.length} 轮 accept`,
    evidence: [
      `初始分数：${referenceScore.toFixed(1)}`,
      `最终分数：${currentScore.toFixed(1)}`,
      `总提升：${totalImprovement >= 0 ? '+' : ''}${totalImprovement.toFixed(1)}`,
      `最终版本：v${finalVersion}`,
      `accept 统计：${iterations.filter((i) => i.accepted).length}/${iterations.length}`,
    ],
  });

  log(`🏁 进化闭环结束：${referenceScore.toFixed(1)} → ${currentScore.toFixed(1)}（总提升 ${totalImprovement >= 0 ? '+' : ''}${totalImprovement.toFixed(1)}），版本 v${finalVersion}`);

  return {
    agentId: options.agentId,
    initialScore: referenceScore,
    finalScore: currentScore,
    totalImprovement,
    iterations,
    finalVersion,
    stoppedByContamination,
    totalDurationMs: Date.now() - startedAt,
  };
}

// ────────────────────────────────────────────────────────────
// Benchmark 评测辅助
// ────────────────────────────────────────────────────────────

/**
 * 跑 Benchmark 全部 cases，返回平均分。
 * 每条评测经 appendEvaluationRecord 落盘（HMAC 链）。
 *
 * @param options 优化选项
 * @param phase 评测阶段标识（reference / candidate-N）
 * @returns 平均分（0-100）
 */
async function runBenchmark(
  options: OptimizationLoopOptions,
  phase: string,
): Promise<number> {
  let totalScore = 0;
  let evaluatedCount = 0;

  for (const caseDef of options.benchmark.cases) {
    const evalInput: EvaluateCaseInput = {
      benchmarkId: options.benchmark.id,
      caseId: caseDef.id,
      statement: caseDef.statement,
      rubric: caseDef.rubric,
      expectedRevision: options.benchmark.revision,
      actualRevision: options.benchmark.revision,
      ...(options.agentFn ? { agentFn: options.agentFn } : {}),
      ...(options.scoringFn ? { scoringFn: options.scoringFn } : {}),
      log: options.log,
    };

    const result: CaseEvaluation = await evaluateCase(evalInput);

    // 落盘评测记录（HMAC 链）
    appendEvaluationRecord(
      {
        benchmarkId: options.benchmark.id,
        caseId: caseDef.id,
        revision: result.revision,
        score: result.score,
        ...(result.failureCode != null ? { failureCode: result.failureCode } : {}),
        ...(options.agentId ? { agentId: options.agentId } : {}),
        durationMs: result.durationMs,
      },
      options.overrideDataDir,
    );

    totalScore += result.score;
    evaluatedCount++;
  }

  return evaluatedCount > 0 ? totalScore / evaluatedCount : 0;
}

// ────────────────────────────────────────────────────────────
// Hypothesis + Candidate 生成（规则驱动——不调 LLM）
// ────────────────────────────────────────────────────────────

/**
 * 根据当前分数和迭代轮数生成假设（哪个能力缺口导致失分）。
 *
 * 这是规则驱动的启发式生成——根据分数区间映射到能力缺口假设。
 * 生产环境可替换为 LLM 驱动（传入 callLlm）。
 *
 * @param currentScore 当前 Benchmark 分数
 * @param iteration 迭代轮数
 * @returns 假设描述
 */
function generateHypothesis(currentScore: number, iteration: number): string {
  if (currentScore < 30) {
    return `假设 ${iteration}：Agent 基础能力不足（分数 ${currentScore.toFixed(0)} < 30）——可能 think.md 缺少关键决策约束，导致 Agent 行为偏离预期`;
  }
  if (currentScore < 60) {
    return `假设 ${iteration}：Agent 中等能力缺口（分数 ${currentScore.toFixed(0)}）——可能 knowledge/ 缺少领域知识，导致 Agent 无法正确推理`;
  }
  if (currentScore < 80) {
    return `假设 ${iteration}：Agent 接近达标但有细节缺陷（分数 ${currentScore.toFixed(0)}）——可能 think.md 的 few-shot 不够，边界 case 处理不完善`;
  }
  return `假设 ${iteration}：Agent 已较好但有优化空间（分数 ${currentScore.toFixed(0)}）——可能 think.md 的决策约束可以进一步精化`;
}

/** Candidate 修改方案 */
interface CandidateModification {
  /** 修改描述 */
  description: string;
  /** 目标文件（think.md 或 knowledge/ 下文件） */
  target: string;
  /** 修改内容（追加到目标文件） */
  content: string;
  /** 可证伪假设的预测（优化前预测的行为变化） */
  prediction: string;
}

/**
 * 根据假设生成经验层修改方案（Candidate）。
 *
 * ⚠️ 铁律：只生成对 think.md / knowledge/ 的修改。
 * SKILL.md / 审计规则 / 回溯机制不可碰。
 *
 * @param hypothesis 假设
 * @param agentDir Agent 目录
 * @returns Candidate 修改方案
 */
function generateCandidate(hypothesis: string, agentDir: string): CandidateModification {
  const ts = new Date().toISOString();

  // 根据假设内容映射到修改目标
  if (hypothesis.includes('think.md')) {
    return {
      description: `追加 think.md 决策约束（${hypothesis.slice(0, 40)}...）`,
      target: join(agentDir, 'think.md'),
      content: `\n## [${ts}] 进化闭环优化：决策约束补充\n${hypothesis}\n\n补充约束：Agent 在处理任务时应优先验证输出完整性，确保每个产出字段都有值。\n`,
      prediction: '预测：补充决策约束后，Agent 输出完整度提升，Benchmark 分数上升',
    };
  }

  if (hypothesis.includes('knowledge/')) {
    const targetPath = join(agentDir, 'knowledge', 'optimization-notes.md');
    return {
      description: `追加 knowledge/ 领域知识（${hypothesis.slice(0, 40)}...）`,
      target: targetPath,
      content: `\n## [${ts}] 进化闭环优化：领域知识补充\n${hypothesis}\n\n补充知识：处理边界 case 时应检查输入有效性，对异常输入给出明确提示。\n`,
      prediction: '预测：补充领域知识后，Agent 边界 case 处理改善，Benchmark 分数上升',
    };
  }

  // 默认：修改 think.md
  return {
    description: `精化 think.md 决策约束（${hypothesis.slice(0, 40)}...）`,
    target: join(agentDir, 'think.md'),
    content: `\n## [${ts}] 进化闭环优化：约束精化\n${hypothesis}\n\n精化约束：Agent 应在输出前自检质量，确保输出满足格式和内容要求。\n`,
    prediction: '预测：精化约束后，Agent 自检能力增强，Benchmark 分数上升',
  };
}

/**
 * 把 Candidate 写入经验层文件（经 atomicAppendSync / atomicWriteSync）。
 *
 * ⚠️ 铁律：写经验层必走 atomic-write（禁止裸 writeFileSync）。
 * think.md 是 append-only ledger（atomicAppendSync）。
 * knowledge/ 是 Views（atomicWriteSync——覆盖写）。
 *
 * @param target 目标文件路径
 * @param content 修改内容
 * @param agentDir Agent 目录
 */
function applyCandidateToExperience(target: string, content: string, agentDir: string): void {
  // 确保目录存在
  const dir = target.includes('knowledge') ? join(agentDir, 'knowledge') : agentDir;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // think.md → append-only（atomicAppendSync）
  if (target.endsWith('think.md')) {
    // 确保 think.md 存在
    if (!existsSync(target)) {
      atomicWriteSync(target, '');
    }
    atomicAppendSync(target, content.trim());
    return;
  }

  // knowledge/ 下文件 → 追加（atomicAppendSync 保持 append 语义）
  if (!existsSync(target)) {
    atomicWriteSync(target, '');
  }
  atomicAppendSync(target, content.trim());
}

// ────────────────────────────────────────────────────────────
// 安全审计写入
// ────────────────────────────────────────────────────────────

/**
 * 安全写入 audit decision——emitDecision 抛错时仅告警，不阻断优化。
 */
function safeEmitDecision(
  options: OptimizationLoopOptions,
  input: {
    agentId: string;
    sessionId: string;
    kind: 'EVOLUTION';
    moment: 'EVOLVE';
    why: string;
    evidence: string[];
    artifactRef?: string;
  },
): void {
  if (!options.emitDecision) return;
  try {
    options.emitDecision(input);
  } catch {
    // 审计写入失败不阻断优化循环
  }
}
