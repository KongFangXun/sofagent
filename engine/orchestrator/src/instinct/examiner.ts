// instinct/examiner.ts · 出题考核器（v1.5.8 章四）
//
// Meta-RSI Data-RSI 的「归因→出题→考核」三步：instinct 链有提取与被动统计
// （passRate），缺主动验证。本文件：
//   出题——达阈值条目反向生成考核题（复现场景 + 期望结果），落考核队列
//   考核执行——按域档位分流执行（deterministic 跑实际校验；model-judge 跑
//             评分器；human-only 出题给人）；评分器不得复用被考核的执行模型
//   双成功——答案校验 + 复现成功各占一票，任一失败降级并记失败原因
//   沉淀裁决三态——SAVE / FOLD_INTO / NOTHING_TO_SAVE（无货是一等产出，显式落账）
//   不捕获清单——四类教训永不沉淀（硬门：命中即拒，拒收可审计）
//   佐证门——单一「复杂」信号是弱证据，须「挽回过/重复出现」佐证才送审；
//             未佐证样本登记在册，非静默丢弃
//
// 评估角色独立性（硬门判据）：评分器的 modelId ≠ 被考核执行模型的 modelId
// （配置面机械断言——assessExamination 前置校验，同 modelId 即拒）。

import { DEFAULT_CONFIDENCE_THRESHOLD } from './scorer';
import type { ScoredInstinct } from './scorer';
import type { StoredInstinct } from './store';

/** 考核题（出题器产物——落考核队列） */
export interface ExamQuestion {
  /** 题目 ID（exq-<instinctId>-<seq>） */
  id: string;
  /** 来源 instinct ID */
  instinctId: string;
  /** 复现场景描述（按 pattern 构造） */
  scenario: string;
  /** 期望结果（答案校验的对照面——不进执行环境） */
  expected: string;
  /** 域档位（执行方式分流） */
  domainTier: 'deterministic' | 'model-judge' | 'human-only';
  /** 出题时间（ISO） */
  createdAt: string;
}

/** 单票判定 */
export interface ExamVote {
  /** 票名（answer-check / reproduction） */
  vote: 'answer-check' | 'reproduction';
  /** 是否通过 */
  pass: boolean;
  /** 判定依据 */
  basis: string;
}

/** 考核结果（双成功判定） */
export interface ExamResult {
  instinctId: string;
  questionId: string;
  votes: [ExamVote, ExamVote];
  /** 双成功才 verified；任一失败 failed（降级） */
  outcome: 'verified' | 'failed';
  /** 失败原因（failed 时必填） */
  failureReason?: string;
  /** 沉淀裁决三态 */
  sedimentVerdict: 'SAVE' | 'FOLD_INTO' | 'NOTHING_TO_SAVE';
  /** FOLD_INTO 的目标条目（裁决为并入时给出） */
  foldIntoId?: string;
}

/** 不捕获清单四类 */
export type DoNotCaptureKind =
  | 'environment-dependent' // 环境依赖性失败（缺二进制/未配凭证——换台机器就失效）
  | 'tool-negative-claim' // 对工具的否定断言（"X 坏了"会冻结成长期拒用）
  | 'transient-retryable' // 重试即愈的瞬时错误（教训是重试模式不是原错误）
  | 'one-off-narrative'; // 一次性任务叙事与未解决失败

/** 不捕获清单命中记录（可审计——命中即拒的拒收台账） */
export interface DoNotCaptureRecord {
  instinctId: string;
  kind: DoNotCaptureKind;
  /** 命中依据（哪条判据） */
  basis: string;
  rejectedAt: string;
}

/** 佐证门登记（未佐证样本在册——非静默丢弃） */
export interface CorroborationPendingRecord {
  instinctId: string;
  /** 已有何种信号（如 'complex-only'） */
  signal: string;
  /** 还差什么佐证（'recovered' 挽回过 / 'recurring' 重复出现） */
  awaiting: Array<'recovered' | 'recurring'>;
  registeredAt: string;
}

/** 不捕获清单判定模式（硬门——四类命中即拒） */
const DO_NOT_CAPTURE_PATTERNS: ReadonlyArray<{ kind: DoNotCaptureKind; pattern: RegExp; basis: string }> = [
  { kind: 'environment-dependent', pattern: /(缺少|未安装|未配置|not found|command not found|ENOENT).*(二进制|依赖|凭证|binary|dependency|credential)/i, basis: '环境依赖性失败——换台机器就失效的教训是毒数据' },
  { kind: 'tool-negative-claim', pattern: /^(不要用|别用|永不使用|never use|avoid)\s*\S*(工具|tool)?/i, basis: '对工具的否定断言会冻结成长期拒用' },
  { kind: 'transient-retryable', pattern: /(超时后重试成功|重试即愈|timeout.*retry.*ok|ECONNRESET|ETIMEDOUT)/i, basis: '重试即愈的瞬时错误——教训是重试模式不是原错误' },
  { kind: 'one-off-narrative', pattern: /(仅此一次|一次性任务|本次特例|one-off)/i, basis: '一次性任务叙事与未解决失败' },
];

/**
 * 不捕获清单判定（硬门）：命中即拒。
 * 返回命中记录；未命中返回 null（可进考核）。
 */
export function checkDoNotCapture(
  instinct: { id: string; pattern: string },
  now?: string,
): DoNotCaptureRecord | null {
  for (const p of DO_NOT_CAPTURE_PATTERNS) {
    if (p.pattern.test(instinct.pattern)) {
      return { instinctId: instinct.id, kind: p.kind, basis: p.basis, rejectedAt: now ?? new Date().toISOString() };
    }
  }
  return null;
}

/**
 * 佐证门：须有「挽回过」（recovered）或「重复出现」（recurring）佐证才送审。
 * 单一「复杂」信号（complex-only）是弱证据——登记在册待补，非静默丢弃。
 */
export function checkCorroborationGate(
  instinct: { id: string; occurrences: number },
  signals: { recovered?: boolean; complexOnly?: boolean },
  now?: string,
): { sendToExam: boolean; pending?: CorroborationPendingRecord } {
  const awaiting: Array<'recovered' | 'recurring'> = [];
  if (!signals.recovered) awaiting.push('recovered');
  if (instinct.occurrences < 2) awaiting.push('recurring');
  if (awaiting.length === 0) return { sendToExam: true };
  return {
    sendToExam: false,
    pending: {
      instinctId: instinct.id,
      signal: signals.complexOnly ? 'complex-only' : 'partial',
      awaiting,
      registeredAt: now ?? new Date().toISOString(),
    },
  };
}

/**
 * 出题器：达阈值 instinct 反向生成考核题。
 * 阈值与第三章同源（scorer.ts DEFAULT_CONFIDENCE_THRESHOLD = 0.7——落数表 #11）。
 */
export function generateExamQuestion(
  scored: ScoredInstinct,
  domainTier: ExamQuestion['domainTier'],
  seq = 1,
  now?: string,
): ExamQuestion | null {
  if (scored.confidence < DEFAULT_CONFIDENCE_THRESHOLD) return null; // 未达阈值不出题
  return {
    id: `exq-${scored.id}-${seq}`,
    instinctId: scored.id,
    scenario: `复现场景：在同类任务中应用模式「${scored.pattern}」，验证其是否仍然成立`,
    expected: `模式「${scored.pattern}」的应用产出与历史通过记录一致（occurrences=${scored.occurrences}）`,
    domainTier,
    createdAt: now ?? new Date().toISOString(),
  };
}

/** 考核执行器入参（IO 全注入——零真实命令/零真实模型调用） */
export interface ExecuteExamInput {
  question: ExamQuestion;
  /** 答案校验器（第一票：期望结果是否成立） */
  answerCheck: (q: ExamQuestion) => { pass: boolean; basis: string };
  /** 复现执行器（第二票：只看题复现是否成功） */
  reproduction: (q: ExamQuestion) => { pass: boolean; basis: string };
  /** 评分器 modelId（model-judge 域必填——独立性硬门） */
  judgeModelId?: string;
  /** 被考核执行模型 modelId（与 judgeModelId 对照） */
  examineeModelId?: string;
}

/**
 * 考核执行 + 双成功判定（纯函数——两票注入）。
 * 评估角色独立性硬门：model-judge 域下 judgeModelId == examineeModelId 即拒
 * （自评与环境信号相关性弱到不可用作改进依据——S³Gym r=-0.23）。
 */
export function assessExamination(input: ExecuteExamInput, now?: string): ExamResult {
  const { question } = input;
  const votes: [ExamVote, ExamVote] = [
    { vote: 'answer-check', ...input.answerCheck(question) },
    { vote: 'reproduction', ...input.reproduction(question) },
  ];

  if (question.domainTier === 'model-judge') {
    if (!input.judgeModelId || !input.examineeModelId) {
      return {
        instinctId: question.instinctId,
        questionId: question.id,
        votes,
        outcome: 'failed',
        failureReason: 'model-judge 域须同时提供评分器与被考核模型的 modelId（独立性断言面）',
        sedimentVerdict: 'NOTHING_TO_SAVE',
      };
    }
    if (input.judgeModelId === input.examineeModelId) {
      return {
        instinctId: question.instinctId,
        questionId: question.id,
        votes,
        outcome: 'failed',
        failureReason: `评分器独立性硬门：judge=${input.judgeModelId} == examinee=${input.examineeModelId}——评分器不得复用被考核的执行模型`,
        sedimentVerdict: 'NOTHING_TO_SAVE',
      };
    }
  }

  const bothPass = votes.every((v) => v.pass);
  if (!bothPass) {
    const failed = votes.filter((v) => !v.pass).map((v) => `${v.vote}: ${v.basis}`).join('；');
    return {
      instinctId: question.instinctId,
      questionId: question.id,
      votes,
      outcome: 'failed',
      failureReason: `双成功未达成——${failed}`,
      sedimentVerdict: 'NOTHING_TO_SAVE',
    };
  }
  return {
    instinctId: question.instinctId,
    questionId: question.id,
    votes,
    outcome: 'verified',
    sedimentVerdict: 'SAVE',
  };
}

/**
 * 沉淀裁决（考核通过后的三态细化）：拿既有条目清单给裁决者看——
 * 近似项存在 → FOLD_INTO（并入目标条目）；无近似且考核通过 → SAVE；
 * 考核无货（未通过/无可沉淀）→ NOTHING_TO_SAVE（显式落账，区分「审过无货」与「未审」）。
 */
export function decideSedimentation(
  result: ExamResult,
  existingItems: ReadonlyArray<{ id: string; pattern: string }>,
  isSimilar: (candidate: { pattern: string }, existing: { pattern: string }) => boolean,
): ExamResult {
  if (result.outcome !== 'verified') {
    return { ...result, sedimentVerdict: 'NOTHING_TO_SAVE' }; // 未通过 = 审过无货（一等产出，显式落账）
  }
  const similar = existingItems.find((e) => e.id !== result.instinctId && isSimilar({ pattern: '' }, e));
  if (similar) {
    return { ...result, sedimentVerdict: 'FOLD_INTO', foldIntoId: similar.id };
  }
  return { ...result, sedimentVerdict: 'SAVE' };
}

/** 考核队列动作（人审门消费面——全显式，不自动执行） */
export type ExamQueueAction =
  | { type: 'enqueue-question'; question: ExamQuestion }
  | { type: 'record-result'; result: ExamResult }
  | { type: 'record-rejection'; rejection: DoNotCaptureRecord }
  | { type: 'record-pending'; pending: CorroborationPendingRecord };

/**
 * 考核态写回池条目（verified / failed——第四章与第三章的闭环点）。
 * 纯函数：返回更新后的条目（落盘由 store.append / 调用方管）。
 */
export function applyExamResultToPoolItem(
  item: StoredInstinct,
  result: ExamResult,
): StoredInstinct {
  return { ...item, verified: result.outcome === 'verified' ? 'verified' : 'failed' };
}
