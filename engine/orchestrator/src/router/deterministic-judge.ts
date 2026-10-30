// deterministic-judge.ts · 确定性判定原语（数值比较 + 分档评分 · fail-open 路由层）
// ============================================================
// 定位：v1.7.x 判定质量修补线——把「可由纯数值规则复算的机器合成题」从
// 模型判定面剥离到确定性层。判定主入口（JudgeRuntime.judge）前置调用
// deterministicJudge：命中 → 直接出确定性答案（source='deterministic'
// 留痕，对齐 decision-abstain.ts 三源留痕命名风格）；null → fail-open
// 落回 encoder 模型路径（识别不了的不硬判——零新增 npm 依赖，纯正则）。
//
// 覆盖两类机器合成形态（frozen/main01v5 eval.jsonl 全量实测归因）：
//   ① 数值比较（choice）：数值序列极值 / 各位数字之和极值 / 目标值最近邻
//      ——家族 proc-e-kcc05..16（k=5-9）、proc-e-minmax22（k=22）
//   ② 分档评分（score）：档界斜杠 / 档位标准表 / 二分档判级标准
//      ——家族 proc-e-bin2s、proc-e-kcs04-06
//   gradelong（长工单 0-2 级）按规格本轮不覆盖——档位标准嵌在叙述里，
//   解析复杂，继续落模型（fail-open 由「判别器不识别」天然保证）。
//
// 档位映射规则（以 eval.jsonl 实测 label 为准，非文档推断）：
//   - 档界/标准表多分档：band = #{cut | score > cut}（左开右闭 (c_prev, c]，
//     恰好=档界归下一档）。证据：eval.jsonl 全 231 行 kcs 系 label 与
//     ruleA(score>cut) 零失配；ruleB(score>=cut) 失配 21 行（全部是
//     score==cut 的边界行，如 L2344 score=20 cuts=[20,40,60,80] label=0）。
//   - 二分档 bin2s：score >= cut → 1 档，否则 0 档（阈值语义「N 分及以上」
     // 与 state 原文一致）。证据：231 行 bin2s 全量零失配；唯一边界行
//     L1368（score=60=cut，label=1）在 >= 规则下命中、> 规则下失配。
//     注意两种形态边界方向不同（多分档右闭 vs 二分档左闭）——这不是
//     不一致，而是两族生成器各自的合成规则，均以 label 实测为准。
// ============================================================

/** 确定性判定件错误（fail-closed 载体——内部状态不自洽即抛，不产静默假答案） */
export class DeterministicJudgeError extends Error {
  constructor(message: string) {
    super(`[deterministic-judge] ${message}`);
    this.name = 'DeterministicJudgeError';
  }
}

// ── 判别器（detect*）——单一事实源，评测器与路由层共用 ──────

/** 数值序列声明前缀（kcc 系 state 形态：「数值序列：5233、9982、…。」） */
const RE_NUMERIC_SEQUENCE = /数值序列[：:]\s*([^。，,]+)/;

/** 目标值声明前缀（kcc 系 nearest 形态：「目标值：4361。」） */
const RE_TARGET_VALUE = /目标值[：:]/;

/** 最近邻问法（kcc 系 nearest 形态 instructions 三种在野写法） */
const RE_NEAREST_INSTRUCTION = /(最接近|之差最小|偏离最小)/;

/** 评审得分声明（bin2s / kcs 系 state 形态：「评审得分：28 分（满分 100 分）。」） */
const RE_REVIEW_SCORE = /评审得分[：:]\s*\d+\s*分/;

/** 档界斜杠形态（kcs 系：「档界：20/40/60/80。」） */
const RE_BAND_SLASH = /档界[：:]\s*\d+(?:\s*\/\s*\d+)+/;

/**
 * 档位标准表形态（kcs 系：「档位标准表：0–20 分＝第 1 档；21–40 分＝第 2 档；…」）。
 * 连接符兼容 en-dash（–）/em-dash（—）/hyphen（-）；等号兼容全角（＝）/半角（=）；
 * 档名兼容「第 N 档」带空格。整表须由同构段重复构成（防只匹配半句误判）。
 */
const RE_BAND_TABLE = /档位标准表[：:]((?:\s*\d+\s*[–—-]\s*\d+\s*分\s*[＝=]\s*第\s*\d+\s*档\s*[；;]?)+)/;

/** 档位标准表单段（low–high 分＝第 N 档）——档界上界取 high */
const RE_BAND_TABLE_PAIR = /(\d+)\s*[–—-]\s*(\d+)\s*分\s*[＝=]\s*第\s*(\d+)\s*档/g;

/** 二分档判级标准形态（bin2s 系：「判级标准（二分档）：…；1 档＝达标（60 分及以上）。」） */
const RE_BINARY_BAND = /二分档/;

/** 二分档达标阈值（「N 分及以上」——N 即达标线，语义与 state 原文一致） */
const RE_BINARY_THRESHOLD = /(\d+)\s*分及以上/;

/** 纯数字选项（kcc 系 options_def 全为 /^\d+$/ 纯数字串） */
const RE_PURE_NUMBER = /^\d+$/;

/**
 * 判别「数值比较题」（choice）。
 *
 * 判据（eval.jsonl 837 行 kcc/minmax22 全量实测形态）：
 *   a) options 全为纯数字字符串（语义题的 options 是文本——boolq/csqa/snli
 *      零误识别的第一道闸）；且
 *   b) 「目标值：」前缀 + 最近邻问法（nearest 子形态），或
 *      「数值序列：」前缀 + 问句含最大/最小（极值/各位数字和子形态）。
 *
 * 状态含噪声前缀（kcc06+ 起序列前有干扰句）不影响——正则做的是
 * 「包含」而非「全文匹配」。
 */
export function detectNumericComparison(
  state: string,
  instructions: string,
  optionsDef: Record<string, string>,
): boolean {
  const values = Object.values(optionsDef ?? {});
  if (values.length === 0 || !values.every((v) => typeof v === 'string' && RE_PURE_NUMBER.test(v))) {
    return false;
  }
  if (RE_TARGET_VALUE.test(state) && RE_NEAREST_INSTRUCTION.test(instructions)) {
    return true;
  }
  if (!RE_NUMERIC_SEQUENCE.test(state)) {
    return false;
  }
  return /(最大|最小)/.test(instructions);
}

/**
 * 判别「分档评分题」（score）。
 *
 * 判据（eval.jsonl 462 行 bin2s/kcs 全量实测形态）：
 *   a) state 含「评审得分：N 分」声明；且
 *   b) 三种档界表述其一：档界斜杠 / 档位标准表 / 二分档判级标准（含阈值）。
 *
 * gradelong（「评分标准（按紧急程度分 0-2 级）」）不匹配任一子形态——
 * 本轮规格内继续落模型。
 */
export function detectBandScoring(state: string, _instructions: string): boolean {
  if (!RE_REVIEW_SCORE.test(state)) {
    return false;
  }
  if (RE_BAND_SLASH.test(state)) {
    return true;
  }
  if (RE_BAND_TABLE.test(state)) {
    return true;
  }
  return RE_BINARY_BAND.test(state) && RE_BINARY_THRESHOLD.test(state);
}

// ── 判定器（judge*）——识别后复算，复算不出则 fail-open ────

/**
 * 数值串拆分（[、，,\s] 分隔）。段内有非数字字符 → 返回 null（fail-open——
 * 序列形态被污染时不硬猜）。
 */
function splitNumericList(raw: string): string[] | null {
  const parts = raw.trim().split(/[、，,\s]+/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return null;
  }
  if (!parts.every((p) => RE_PURE_NUMBER.test(p))) {
    return null;
  }
  return parts;
}

/**
 * options_def 键的自然序（opt0 < opt1 < … < opt10 < opt11——非字典序）。
 * 评测/对照路径的 label.value 是自然序下标：字典序会把 opt10 排在 opt2 前，
 * k≥10 家族（kcc11-16/minmax22）全量错位。
 */
function naturalOptionOrder(optionsDef: Record<string, string>): string[] {
  const keys = Object.keys(optionsDef);
  return keys.sort((a, b) => {
    const na = /(\d+)$/.exec(a);
    const nb = /(\d+)$/.exec(b);
    if (na && nb) {
      return Number.parseInt(na[1]!, 10) - Number.parseInt(nb[1]!, 10);
    }
    return a.localeCompare(b);
  });
}

/** 数值比较题复算参数 */
export interface NumericComparisonInput {
  state: string;
  instructions: string;
  optionsDef: Record<string, string>;
}

/**
 * 数值比较题复算（choice）。按子形态分流：
 *   - nearest：目标值 vs 各选项的 |差| 最小者
 *   - digit-sum：「各位数字之和」极值（minmax22 digmax）
 *   - minmax：数值序列极值
 * 极值/最小差在选项中不唯一（tie）、序列解析失败 → null（fail-open——
 * 平手裁决规则未在生成器规格中登记，硬选即猜）。
 */
export function judgeNumericComparison(input: NumericComparisonInput): number | null {
  const { state, instructions, optionsDef } = input;
  const keys = naturalOptionOrder(optionsDef);
  const optionNums = keys.map((k) => {
    const raw = optionsDef[k]!;
    const n = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(n)) {
      throw new DeterministicJudgeError(`选项「${k}=${raw}」不是安全整数——判别器已保证纯数字，此处不自洽`);
    }
    return n;
  });

  // 子形态一：目标值最近邻（kcc nearest）
  if (RE_TARGET_VALUE.test(state) && RE_NEAREST_INSTRUCTION.test(instructions)) {
    const m = /目标值[：:]\s*(\d+)/.exec(state);
    if (!m) {
      return null;
    }
    const target = Number.parseInt(m[1]!, 10);
    const gaps = optionNums.map((n) => Math.abs(n - target));
    const best = Math.min(...gaps);
    if (gaps.filter((g) => g === best).length !== 1) {
      return null; // 平手 → fail-open
    }
    return gaps.indexOf(best);
  }

  // 子形态二/三共用：数值序列解析
  const seqMatch = RE_NUMERIC_SEQUENCE.exec(state);
  if (!seqMatch) {
    return null;
  }
  const seq = splitNumericList(seqMatch[1]!);
  if (seq === null || seq.length === 0) {
    return null;
  }
  const seqNums = seq.map((s) => Number.parseInt(s, 10));

  // 子形态二：各位数字之和极值（minmax22 digmax）
  if (instructions.includes('各位数字之和')) {
    const sums = optionNums.map((n) =>
      String(n)
        .split('')
        .reduce((acc, ch) => acc + Number.parseInt(ch, 10), 0),
    );
    const wantMax = instructions.includes('最大');
    const bestSum = wantMax ? Math.max(...sums) : Math.min(...sums);
    if (sums.filter((s) => s === bestSum).length !== 1) {
      return null; // 平手 → fail-open
    }
    return sums.indexOf(bestSum);
  }

  // 子形态三：数值序列极值（kcc extremum / minmax22 max|min）
  const wantMax = instructions.includes('最大');
  const extreme = wantMax ? Math.max(...seqNums) : Math.min(...seqNums);
  const hits = optionNums.map((n, i) => (n === extreme ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1) {
    return null; // 极值不在选项中 / 选项内重复 → fail-open（规格：极值不在 options 返回 null）
  }
  return hits[0] ?? null;
}

/** 分档评分题复算参数 */
export interface BandScoringInput {
  state: string;
}

/**
 * 分档评分题复算（score）。按子形态分流：
 *   - 档位标准表：取每段上界 cut=[high…] → band = #{cut | score > cut}（左开右闭）
 *   - 档界斜杠：  cut=斜杠数列同上
 *   - 二分档：    score >= 阈值 → 1，否则 0（「N 分及以上」语义）
 * 得分/档界缺失或不可解析 → null（fail-open）。
 */
export function judgeBandScoring(input: BandScoringInput): number | null {
  const { state } = input;
  const scoreMatch = /评审得分[：:]\s*(\d+)\s*分/.exec(state);
  if (!scoreMatch) {
    return null;
  }
  const score = Number.parseInt(scoreMatch[1]!, 10);

  // 子形态一：档位标准表——逐段取上界（每档区间的右端即档界）
  const tableMatch = RE_BAND_TABLE.exec(state);
  if (tableMatch) {
    const cuts: number[] = [];
    RE_BAND_TABLE_PAIR.lastIndex = 0;
    let pair: RegExpExecArray | null;
    while ((pair = RE_BAND_TABLE_PAIR.exec(tableMatch[1]!)) !== null) {
      cuts.push(Number.parseInt(pair[2]!, 10)); // 组 2 = 上界 high
    }
    if (cuts.length === 0) {
      return null;
    }
    return cuts.filter((c) => score > c).length;
  }

  // 子形态二：档界斜杠数列
  const slashMatch = /档界[：:]\s*([\d/]+)/.exec(state);
  if (slashMatch) {
    const cuts = slashMatch[1]!.split('/').map((x) => Number.parseInt(x, 10));
    if (cuts.some((c) => !Number.isFinite(c))) {
      return null;
    }
    return cuts.filter((c) => score > c).length;
  }

  // 子形态三：二分档（阈值语义「N 分及以上」）
  if (RE_BINARY_BAND.test(state)) {
    const thresholdMatch = RE_BINARY_THRESHOLD.exec(state);
    if (!thresholdMatch) {
      return null;
    }
    const threshold = Number.parseInt(thresholdMatch[1]!, 10);
    return score >= threshold ? 1 : 0;
  }

  return null;
}

// ── 入口（deterministicJudge）——路由前置 + fail-open ────

/** 确定性命中的子面（与判定原语对应——choice=数值比较 / score=分档评分） */
export type DeterministicFacet = 'numeric-comparison' | 'band-scoring';

/**
 * 确定性判定结果——与判定输出同构（selected 下标 / band 档位），另带
 * source 留痕字段（对齐 decision-abstain.ts 的 AbstainSource 命名风格：
 * 判定面读数可归因到「谁出的这个答案」——deterministic / 模型路径）。
 */
export interface DeterministicJudgeResult {
  /** 命中子面 */
  facet: DeterministicFacet;
  /** 数值比较：极值/最近邻在 options 中的自然序下标 */
  selectedIndex?: number;
  /** 分档评分：档位索引（0 基） */
  band?: number;
  /** 留痕：本答案出确定性层（null fail-open 时无此对象） */
  source: 'deterministic';
  /** 复算留痕（人类可读——审计面核对复算路径用） */
  trace: string;
}

/** 确定性判定请求（judge 主入口前置调用的最小输入面） */
export interface DeterministicJudgeRequest {
  state: string;
  instructions: string;
  optionsDef: Record<string, string>;
}

/**
 * 确定性判定入口：识别 → 复算 → 出结果；任一步不成立返回 null
 * （fail-open——调用方落回 encoder 模型路径，不硬判）。
 *
 * 两类形态互斥（数值比较要求纯数字 options，分档评分要求「评审得分」
 * 声明——数据集实测零交集），判定顺序无歧义。
 */
export function deterministicJudge(request: DeterministicJudgeRequest): DeterministicJudgeResult | null {
  const { state, instructions, optionsDef } = request;
  if (typeof state !== 'string' || typeof instructions !== 'string' || !optionsDef) {
    return null;
  }

  if (detectNumericComparison(state, instructions, optionsDef)) {
    const selectedIndex = judgeNumericComparison({ state, instructions, optionsDef });
    if (selectedIndex === null) {
      return null; // 识别了但复算不出（tie/污染）→ fail-open，不硬判
    }
    return {
      facet: 'numeric-comparison',
      selectedIndex,
      source: 'deterministic',
      trace: `数值比较复算：options 自然序第 ${selectedIndex} 项`,
    };
  }

  if (detectBandScoring(state, instructions)) {
    const band = judgeBandScoring({ state });
    if (band === null) {
      return null;
    }
    return {
      facet: 'band-scoring',
      band,
      source: 'deterministic',
      trace: `分档评分复算：第 ${band} 档（0 基）`,
    };
  }

  return null;
}
