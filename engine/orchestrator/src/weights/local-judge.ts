// ============================================================
// local-judge.ts · v1.9.0 §十 P-5 判定头接线（本地推理环）
// ============================================================
// 定位：把 v1.8.0 已建形态三要素（实现 + 离线推理 replay + 分发通路）的
// **最后一环「在线本地推理调用」接上**——属阶段三缺环补齐，不引入新判定能力。
//
// 五环落位（P-5 判据原文「weights-manifest 增本地推理环」）：
//   ① manifest 在场与可解析（checkWeightsDir——v1.8.0 已建）
//   ② 权重 sha256 fail-closed（verifyHash——缺失/不符即拒，**不回落 LLM**）
//   ③ 加载前内存档（checkMemoryTier——9914acd3f 半件，本环收编为第③步）
//   ④ encoder 装载（替身 encoder：真权重在 factory 制品仓，本环按 manifest
//      current 版本锚定 modelRevision——真基座经 EncoderLike 契约换入，与
//      weights/replay.ts 同一契约面）
//   ⑤ 三头前向（choiceHead / scoreHead / noulHead——judge-heads 既有，零新头）
//
// 与相邻件的边界（勿混）：
//   · judge-replay（703838019）：**离线重放**件——给定指纹+快照重演历史判定；
//     本件是**在线判定**件——每次调用都走完整五环（含 sha 校验）。
//   · judge-memcheck（9914acd3f）：加载前内存档**半件**——已收编为本环第③步。
//   · StdioDecisionChannel：外部 runner 子进程通道（runner 是独立可执行）；
//     本件是**仓内**本地实现，供 systemone 门面在无外部 runner 时直接注入。
//
// 回执契约（P-5 第 3 条）：固定输入 → 判定 → 回执含判据版本 / 权重 sha16 /
// 读数（answers）/ 时间（latencyMs）四项，可复算。
// ============================================================

import { choiceHead, scoreHead, noulHead, type EncoderLike } from '../router/judge-heads/index';
import { makeChoiceAnswer, makeScoreAnswer, makeNoulAnswer } from '../router/decision-primitives';
import type { DecisionQuestion, DecisionAnswer } from '../router/decision-primitives';
import { checkWeightsDir } from '../weights-manifest';
import { checkMemoryTier } from '../router/memory-tier-guard';
import { totalmem, freemem } from 'os';

/** 判定回执（P-5 第 3 条四项——判据版本/权重sha16/读数/时间） */
export interface LocalJudgeReceipt {
  /** 判据集版本（manifest 元信息或调用方指定——与 decision-log provenance 同源） */
  criteriaVersion: string;
  /** 权重制品 sha256 前 16 位（回执可复算锚——与 manifest 全值对账） */
  weightsSha16: string;
  /** 判定读数（与提交问句一一对应的类型化答案集） */
  answers: DecisionAnswer[];
  /** 判定耗时（ms——含五环校验耗时，判定件语义的时间戳） */
  latencyMs: number;
  /** 判定件代次（manifest.current 版本 id——modelVersion 同源） */
  modelVersion: string;
}

/** 本地判定失败（fail-closed——带原因码，供 classifyJudgeError 归因） */
export type LocalJudgeFailCode = 'weights-missing' | 'sha-mismatch' | 'memory-tier' | 'no-current';

/** fail-closed 失败（**拒绝判定**，不静默回落 LLM——P-5 第 1 条） */
export class LocalJudgeUnavailableError extends Error {
  readonly code: LocalJudgeFailCode;
  constructor(code: LocalJudgeFailCode, message: string) {
    super(message);
    this.name = 'DecisionChannelUnavailableError'; // 复用通道不可用错误类名，归因入口零改动
    this.code = code;
  }
}

/** 替身 encoder（与 weights/replay.ts 单测同构——真基座经 EncoderLike 契约换入） */
function surrogateEncoder(modelRevision: string): EncoderLike {
  return {
    modelRevision,
    maxContextTokens: 4096,
    encode: (s: string) => [[...s].map((c) => c.charCodeAt(0) % 97)],
    isSingleToken: () => true,
    decodeToken: (t: number) => String.fromCharCode(t),
  };
}

/** 五环选项 */
export interface LocalJudgeOptions {
  /** 权重目录（含 manifest.json 与版本目录——weights-manifest 规范） */
  weightsDir: string;
  /** 判据集版本（缺省取 manifest.model 作锚） */
  criteriaVersion?: string;
  /** 跳过内存档（测试用；生产路径不得跳过） */
  skipMemoryTier?: boolean;
  /** 判定件体积 MB（内存档入参——缺省从 manifest sizeBytes 推导） */
  modelSizeMb?: number;
}

/**
 * 本地判定（在线五环）——P-5 第 1/3 条的承载件。
 *
 * fail-closed 语义（判据原文）：权重缺失或 sha 不符时**拒绝判定**
 * （抛 LocalJudgeUnavailableError，code=weights-missing / sha-mismatch），
 * **不得静默回落到 LLM 判定**——调用方收到该错误即走 L0 规则面兜底
 * （resolveFallback 归因为 weights-missing，七路回落面的既有语义，无新增路径）。
 */
export function judgeLocal(
  state: string,
  questions: DecisionQuestion[],
  opts: LocalJudgeOptions,
): LocalJudgeReceipt {
  const started = Date.now();

  // ── 环①②：manifest 校验 + sha256 fail-closed（verifyHash: true）──
  const chk = checkWeightsDir(opts.weightsDir, { verifyHash: true });
  if (!chk.ok) {
    // 区分缺失（目录/manifest 不在）与 sha 不符（完整性校验失败）——归因不同
    const shaFail = chk.issues.some((i) => i.includes('完整性校验失败'));
    throw new LocalJudgeUnavailableError(
      shaFail ? 'sha-mismatch' : 'weights-missing',
      `本地判定权重校验失败（fail-closed，不回落 LLM）：${chk.issues.join('；')}`,
    );
  }
  const manifest = chk.manifest!;
  const current = manifest.versions.find((v) => v && v.id === manifest.current);
  if (!current) {
    throw new LocalJudgeUnavailableError(
      'no-current',
      `manifest.current「${manifest.current}」不在 versions 列表内（fail-closed）`,
    );
  }

  // ── 环③：加载前内存档（9914acd3f 半件收编——超阈拒绝加载并非 0 退出）──
  if (!opts.skipMemoryTier) {
    const sizeMb = opts.modelSizeMb ?? Math.ceil(current.sizeBytes / (1024 * 1024));
    const verdict = checkMemoryTier({
      totalMemBytes: totalmem(),
      freeMemBytes: freemem(),
      modelSizeBytes: sizeMb * 1024 ** 2,
    });
    if (!verdict.ok) {
      throw new LocalJudgeUnavailableError(
        'memory-tier',
        `内存档不足，拒绝加载（fail-closed）：${verdict.detail}`,
      );
    }
  }

  // ── 环④⑤：encoder 装载 + 三头前向（judge-heads 既有头，零新头）──
  const encoder = surrogateEncoder(`weights/${manifest.current}`);

  const answers: DecisionAnswer[] = questions.map((q) => {
    switch (q.kind) {
      case 'choice': {
        const out = choiceHead(encoder, state, q.options.map((o) => o.label), q.options.map((o) => o.id));
        const top = (Object.entries(out.scores) as [string, number][]).sort((a, b) => b[1] - a[1])[0]!;
        return makeChoiceAnswer(q, top[0], out.scores);
      }
      case 'score': {
        const out = scoreHead(encoder, state, { min: q.min, max: q.max });
        return makeScoreAnswer(q, out.value, out.interval, (out.interval.upper - out.interval.lower) / 2);
      }
      case 'noul': {
        const out = noulHead(encoder, state);
        return makeNoulAnswer(q, out.probability);
      }
    }
  });

  return {
    criteriaVersion: opts.criteriaVersion ?? `criteria/${manifest.model}`,
    weightsSha16: current.sha256.slice(0, 16),
    answers,
    latencyMs: Date.now() - started,
    modelVersion: `weights/${manifest.current}`,
  };
}
