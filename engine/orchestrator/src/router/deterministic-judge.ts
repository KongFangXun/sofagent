// deterministic-judge.ts · 确定性判定原语（DeterministicJudge 类 · 数值合成面专用路由层）
// ============================================================
// 定位：v1.7.x 判定质量修补线（架构师设计对齐版）。数值合成题（proc-e 系
// 机器合成：数值比较 choice / 分档评分 score）改由纯正则 + 数值复算出答案，
// 从模型判定面剥离；JudgeRuntime 构造器第二参注入（缺省 new DeterministicJudge()
// 开启，传 null 关闭——A/B 对照口径）。
//
// 两层 fail 语义（架构师 §fail 语义，勿混）：
//   路由面 fail-open——识别不了（双闸门不过）落穿模型路径；
//   答案面 fail-closed——识别了但复算歧义返回 undefined 落穿：平局/等距/
//     选项非数字/序列重复/极值在选项非恰一项/档界非严格递增/表区间不连续/
//     bin2s 两数不一致/bandIdx 越值域。识别了≠判得出，歧义不硬判。
//
// 判别双闸门（架构师 §判别器——闸门 A/B 须同时过）：
//   闸门 A（state marker，包含匹配不加 ^ 锚——60% 行带中文干扰前缀）：
//     NUM_SEQ / TARGET / SCORE / BIN2S / EDGES / TABLE
//   闸门 B（instructions，按特异度从高到低——digit-sum 最特异先判）：
//     ①各位数字之和+最(大|小)→digit-sum
//     ②与目标值+(之差最小|最接近|偏离最小)→nearest
//     ③(数值|排列)+最(大|小)的→extremum
//     ④评审得分族（binary/edges/table）无 instructions 词要求
//     ⑤其余落穿
//
// 边界语义（架构师实测确证，勿再猜）：
//   ① 档界含下不含上——band = edges 里严格大于 score 的个数 #{e: score > e}
//      （恰好=档界归下一档；kcs 231 行 label 全量验证：>cut 零失配、>=cut
//       失配 21 行全是 score==cut 边界行，证据 L2344/L2355 等）
//   ② 满分制无需换算——档界与得分同域（51/80 配档界 20/40/60/80 直接映射）
//   ③ bin2s score==cut 归档 1（「N 分及以上」语义；231 行全量验证，唯一
//      边界行 L1368 score=60=cut label=1 命中 >= 规则）
//   多分档右闭 / 二分档左闭是两族生成器各自的合成规则，均以 label 实测为准。
//
// 识别面实测（eval.jsonl 3357 行全量，架构师地基 + 独立复算一致）：
//   routedByRule 直方图 extremum 422 / nearest 401 / digit-sum 14 /
//   binary 231 / edges 56 / table 175 = 1299 行，答案 1299/1299 全对；
//   语义族（boolq/csqa/snli/millet 1977 行）与 gradelong（81 行）零识别。
//
// 自然序注记：options_def 键 opt10+ 按字典序会排在 opt2 前——k≥10 家族
//（kcc11-16/minmax22）必须按数字后缀自然序，否则全量错位。
// ============================================================

/** 确定性判定件错误（fail-closed 载体——内部状态不自洽即抛，不产静默假答案） */
export class DeterministicJudgeError extends Error {
  constructor(message: string) {
    super(`[deterministic-judge] ${message}`);
    this.name = 'DeterministicJudgeError';
  }
}

// ── 闸门 A：state marker 正则（包含匹配——不加 ^ 锚）────────

/** 数值序列声明（kcc 系；捕获组=序列体，[0-9、，,\s] 字符类） */
const NUM_SEQ = /数值序列：([0-9、，,\s]+)/;

/** 目标值声明（kcc nearest 系） */
const TARGET = /目标值：\s*(\d+)/;

/**
 * 紧急度评分标准（gradelong 系 81 行；state 尾部稳定句式——
 * 「评分标准（按紧急程度分 0-2 级）：0 级＝不紧急，可在一周内安排处理；
 *   1 级＝一般，需在 3 个工作日内处理；2 级＝紧急，需在 24 小时内响应处理。」）
 * 闸门 A marker（分级档位表存在性）；判定走工单内容关键词分级（SEV2/SEV1/SEV0）
 */
const URGENCY_RUBRIC = /评分标准（按紧急程度分\s*(\d+)[-–](\d+)\s*级）/;

/** 工单内容行（判定依据——关键词分级的事实源） */
const TICKET_CONTENT = /工单内容：([^。]+。)/;

/**
 * 紧急度三级关键词表（gradelong 81 行 label 全量反推验证 81/81——
 * 三级词汇表互斥且完备于本集；未来新工单词面落穿，不硬判）：
 *   2 级（服务不可用类）：宕机/崩溃/丢失/瘫痪/事故/支付失败/服务不可用/无法登录/投诉激增
 *   1 级（体验降级类）：不稳定/延迟/卡顿/偶发
 *   0 级（咨询类）：询问/咨询/请问/如何/能否
 */
const SEV2_KEYWORDS = /宕机|崩溃|丢失|瘫痪|事故|支付失败|服务不可用|无法登录|投诉激增/;
const SEV1_KEYWORDS = /不稳定|延迟|卡顿|偶发/;
const SEV0_KEYWORDS = /询问|咨询|请问|如何|能否/;

/** 评审得分声明（bin2s/kcs 系；组 1=得分，组 2=满分可选——满分无需换算仅留痕） */
const SCORE = /评审得分：(\d+)\s*分(?:（满分\s*(\d+)\s*分）)?/;

/** 二分档判级标准（bin2s 系；组 1=未达标线（低于 N 分）、组 2=达标线（M 分及以上）） */
const BIN2S = /0 档＝未达标（低于\s*(\d+)\s*分）；1 档＝达标（(\d+)\s*分及以上）/;

/** 档界斜杠数列（kcs 系；分隔符兼容 / 与 、） */
const EDGES = /档界：(\d+(?:[\/、]\d+)*)/;

/**
 * 档位标准表（kcs 系 175 行；连接符 U+2013 EN DASH – / U+2014 EM DASH — /
 * ASCII - 三种在野；段尾 ；或 。收束；整表由同构段重复构成）。
 * 注意：表内用 EN DASH（–）非 ASCII hyphen（-）——字符类须两者都收。
 */
const TABLE = /档位标准表：((?:\d+\s*[–\-]\s*\d+\s*分＝第\s*\d+\s*档[；。])+)/;

/** 档位标准表单段（low–high 分＝第 N 档）——档界上界取 high */
const TABLE_PAIR = /(\d+)\s*[–\-]\s*(\d+)\s*分＝第\s*(\d+)\s*档/g;

/** 纯数字选项（数值比较族 options 全为 /^\d+$/） */
const RE_PURE_NUMBER = /^\d+$/;

// ── 路由规则名（routedByRule 直方图键——与架构师地基同名）────

/** 六条确定性规则（数值比较 3 变体 + 分档评分 3 格式） */
export type DeterministicRule = 'extremum' | 'nearest' | 'digit-sum' | 'binary' | 'edges' | 'table' | 'urgency';

/** 规则族——choice（数值比较）/ score（分档评分），与判定原语对应 */
export const RULE_FAMILY: Readonly<Record<DeterministicRule, 'choice' | 'score'>> = {
  extremum: 'choice',
  nearest: 'choice',
  'digit-sum': 'choice',
  binary: 'score',
  edges: 'score',
  table: 'score',
  urgency: 'score',
};

// ── 复算结果与请求 ────────────────────────────────────────

/** 复算留痕（decision-primitives deterministicTrace 同构——rule 类型用 string 防反向依赖） */
export interface DeterministicTrace {
  /** 命中规则名（DeterministicRule 之一） */
  rule: string;
  /** 人类可读复算依据（审计面对账用） */
  observed: string;
  /** 触发时刻（ISO 8601） */
  at: string;
}

/** 复算答案：choice 侧=选项自然序下标；score 侧=档位索引（0 基） */
export interface DeterministicAnswer {
  rule: DeterministicRule;
  /** choice：极值/最近邻/数字和极值在 options 里的自然序下标；score：档位索引 */
  value: number;
  trace: DeterministicTrace;
}

/**
 * 判定核心：构造一次（无状态——所有方法纯函数式，实例仅为注入点形态）。
 * JudgeRuntime 持有其实例，缺省开启；传 null 关闭（A/B 对照）。
 */
export class DeterministicJudge {
  /**
   * 路由（闸门 A+B）：判定问句是否命中六条确定性规则之一。
   * 返回规则名；不命中返回 null（路由面 fail-open 落穿模型路径）。
   *
   * @param state 判定状态（含干扰前缀的原始 state——正则做包含匹配）
   * @param instructions 问句文本
   * @param optionsDef 候选项定义 {opt0: label, …}（数值比较族必须全纯数字）
   */
  route(state: string, instructions: string, optionsDef: Record<string, string>): DeterministicRule | null {
    if (typeof state !== 'string' || typeof instructions !== 'string' || !optionsDef) {
      return null;
    }
    // 数值选项纯度（数值比较族前置闸——语义族 options 是文本，先拦）
    const values = Object.values(optionsDef);
    const pureNumericOptions =
      values.length > 0 && values.every((v) => typeof v === 'string' && RE_PURE_NUMBER.test(v));

    // 闸门 B 按特异度从高到低（digit-sum 最特异先判——防止被 extremum 的
    // 「最(大|小)」词面抢先误吞）
    if (pureNumericOptions && NUM_SEQ.test(state) && instructions.includes('各位数字之和') && /最(大|小)/.test(instructions)) {
      return 'digit-sum';
    }
    if (
      pureNumericOptions &&
      TARGET.test(state) &&
      // 「目标值」词面在即可（QA P3：句式可能是「与目标值之差最小」或
      // 「最接近目标值的数值」——前者含「与」后者不含，钉死「与目标值」会
      // 漏第二种句式；比较词组保持三词面不变，401 行全量验证两种放宽均覆盖）
      /目标值/.test(instructions) &&
      /(之差最小|最接近|偏离最小)/.test(instructions)
    ) {
      return 'nearest';
    }
    if (
      pureNumericOptions &&
      NUM_SEQ.test(state) &&
      /(数值|排列)/.test(instructions) &&
      /最(大|小)的/.test(instructions)
    ) {
      return 'extremum';
    }
    // 分档评分族（闸门 A 三格式；无 instructions 词要求）
    if (SCORE.test(state)) {
      if (BIN2S.test(state)) return 'binary';
      if (EDGES.test(state)) return 'edges';
      if (TABLE.test(state)) return 'table';
    }
    // 紧急度分级（gradelong 系：评分标准 marker + 工单内容行；三种在野问句
    // 词面：「紧急程度…哪一级」/「判断其紧急程度等级」/「哪一紧急等级」——
    // 统一收「紧急」+（程度|等级）双词面，81 行三变体全覆盖）
    if (URGENCY_RUBRIC.test(state) && TICKET_CONTENT.test(state) && /紧急/.test(instructions) && /程度|等级/.test(instructions)) {
      return 'urgency';
    }
    return null;
  }

  /**
   * 复算单问（答案面 fail-closed）：按规则复算出确定答案；
   * 识别了但歧义 → undefined（平局/等距/档界乱序等，见各分支注释）——
   * 调用方（JudgeRuntime）把 undefined 问句落穿模型路径。
   *
   * @param rule route() 的返回值（不重判——路由与复算分离，直方图统计各自留痕）
   */
  solve(input: {
    state: string;
    instructions: string;
    optionsDef: Record<string, string>;
    rule: DeterministicRule;
    /** 复算时刻（trace.at——缺省取当前时间） */
    at?: string;
  }): DeterministicAnswer | undefined {
    const { state, instructions, optionsDef, rule } = input;
    const at = input.at ?? new Date().toISOString();
    const keys = naturalOptionOrder(optionsDef);
    const optionLabels = keys.map((k) => optionsDef[k]!);

    switch (rule) {
      case 'extremum': {
        const seqMatch = NUM_SEQ.exec(state);
        if (!seqMatch) return undefined; // 路由后 state 变化（不该发生）——fail-closed
        const parts = seqMatch[1]!.split(/[、，,\s]+/).filter((p) => p.length > 0);
        if (parts.length === 0 || !parts.every((p) => RE_PURE_NUMBER.test(p))) {
          return undefined; // 序列段非数字（污染——NUM_SEQ 字符类遇非数字截断，
          // 截断片段可解析但序列已不完整：极值可能在被截断部分，硬算=猜）——fail-closed
        }
        // 序列完整性：声明处到句读（。）之间不得残留非字符类内容（防「5、x9」
        // 被 NUM_SEQ 截断成「5、」后静默丢掉 x9——污染必被发现，不产半截序列答案）
        const afterSeq = state.slice((seqMatch.index ?? 0) + seqMatch[0].length);
        const residue = afterSeq.match(/^\s*([^\s。；])/);
        if (residue) {
          return undefined; // 序列后紧跟非分隔/句读字符 = 截断发生——fail-closed
        }
        const seq = parts.map((p) => Number.parseInt(p, 10));
        if (new Set(seq).size !== seq.length) {
          return undefined; // 序列重复（极值归属歧义风险）——fail-closed
        }
        const wantMax = instructions.includes('最大');
        const extreme = wantMax ? Math.max(...seq) : Math.min(...seq);
        const hits = optionLabels
          .map((label, i) => (RE_PURE_NUMBER.test(label) && Number.parseInt(label, 10) === extreme ? i : -1))
          .filter((i) => i >= 0);
        if (hits.length !== 1) {
          return undefined; // 极值在选项非恰一项（不在/多处）——fail-closed
        }
        return {
          rule,
          value: hits[0]!,
          trace: { rule, observed: `${wantMax ? 'max' : 'min'}(${seq.join(',')})=${extreme} → opt${hits[0]}`, at },
        };
      }
      case 'digit-sum': {
        const sums = optionLabels.map((label) => {
          if (!RE_PURE_NUMBER.test(label)) return NaN;
          return [...label].reduce((acc, ch) => acc + Number.parseInt(ch, 10), 0);
        });
        if (sums.some((s) => Number.isNaN(s))) {
          return undefined; // 选项非数字——fail-closed（路由闸门已拦，双保险）
        }
        const wantMax = instructions.includes('最大');
        const best = wantMax ? Math.max(...sums) : Math.min(...sums);
        if (sums.filter((s) => s === best).length !== 1) {
          return undefined; // 数字和平局——fail-closed
        }
        const idx = sums.indexOf(best);
        return {
          rule,
          value: idx,
          trace: { rule, observed: `digitSum 最${wantMax ? '大' : '小'}=${best}（第 ${idx} 项）`, at },
        };
      }
      case 'nearest': {
        const targetMatch = TARGET.exec(state);
        if (!targetMatch) return undefined;
        const target = Number.parseInt(targetMatch[1]!, 10);
        const nums = optionLabels.map((label) => (RE_PURE_NUMBER.test(label) ? Number.parseInt(label, 10) : NaN));
        if (nums.some((n) => Number.isNaN(n))) return undefined; // 选项非数字——fail-closed
        const gaps = nums.map((n) => Math.abs(n - target));
        const minGap = Math.min(...gaps);
        if (gaps.filter((g) => g === minGap).length !== 1) {
          return undefined; // 等距平局——fail-closed
        }
        const idx = gaps.indexOf(minGap);
        return {
          rule,
          value: idx,
          trace: { rule, observed: `target=${target} minGap=${minGap} → opt${idx}`, at },
        };
      }
      case 'binary': {
        const scoreMatch = SCORE.exec(state);
        const binMatch = BIN2S.exec(state);
        if (!scoreMatch || !binMatch) return undefined;
        const lowCut = Number.parseInt(binMatch[1]!, 10); // 未达标线（低于 N 分）
        const passCut = Number.parseInt(binMatch[2]!, 10); // 达标线（M 分及以上）
        if (lowCut !== passCut) {
          return undefined; // 两数不一致（「低于 60」与「60 及以上」缝隙/重叠）——fail-closed
        }
        const score = Number.parseInt(scoreMatch[1]!, 10);
        return {
          rule,
          value: score >= passCut ? 1 : 0, // score==cut 归档 1（实测确证——L1368）
          trace: { rule, observed: `score=${score} cut=${passCut} → ${score >= passCut ? 1 : 0} 档`, at },
        };
      }
      case 'edges': {
        const scoreMatch = SCORE.exec(state);
        const edgesMatch = EDGES.exec(state);
        if (!scoreMatch || !edgesMatch) return undefined;
        const score = Number.parseInt(scoreMatch[1]!, 10);
        const edges = edgesMatch[1]!.split(/[\/、]/).map((x) => Number.parseInt(x, 10));
        if (edges.some((e) => !Number.isFinite(e))) return undefined;
        if (edges.some((e, i) => i > 0 && edges[i - 1]! >= e)) {
          return undefined; // 档界非严格递增（乱序/重复）——fail-closed
        }
        const band = edges.filter((e) => score > e).length; // 含下不含上：#{e: score > e}
        return {
          rule,
          value: band,
          trace: { rule, observed: `score=${score} edges=[${edges.join(',')}] → 第 ${band} 档（0 基）`, at },
        };
      }
      case 'table': {
        const scoreMatch = SCORE.exec(state);
        const tableMatch = TABLE.exec(state);
        if (!scoreMatch || !tableMatch) return undefined;
        const score = Number.parseInt(scoreMatch[1]!, 10);
        TABLE_PAIR.lastIndex = 0;
        const segs: Array<{ low: number; high: number; bandNo: number }> = [];
        let pair: RegExpExecArray | null;
        while ((pair = TABLE_PAIR.exec(tableMatch[1]!)) !== null) {
          segs.push({
            low: Number.parseInt(pair[1]!, 10),
            high: Number.parseInt(pair[2]!, 10),
            bandNo: Number.parseInt(pair[3]!, 10),
          });
        }
        if (segs.length === 0) return undefined;
        // 表完整性检查（架构师 §fail-closed 清单）：
        //  ① 档号须 1..n 连续（「第 1 档…第 n 档」无跳号）
        if (segs.some((s, i) => s.bandNo !== i + 1)) return undefined;
        //  ② 区间须连续（第 i+1 段 low = 第 i 段 high + 1——0–20/21–40 形态无缝隙）
        for (let i = 1; i < segs.length; i += 1) {
          if (segs[i]!.low !== segs[i - 1]!.high + 1) return undefined; // 表区间不连续——fail-closed
        }
        const edges = segs.map((s) => s.high);
        if (edges.some((e, i) => i > 0 && edges[i - 1]! >= e)) {
          return undefined; // 上界非严格递增（与区间连续检查双保险）——fail-closed
        }
        const band = edges.filter((e) => score > e).length; // 含下不含上（与 edges 同规则）
        if (band < 0 || band > segs.length - 1) {
          return undefined; // bandIdx 越值域（score 超出表覆盖范围）——fail-closed
        }
        return {
          rule,
          value: band,
          trace: { rule, observed: `score=${score} table=[${segs.map((s) => `${s.low}-${s.high}`).join('/')}] → 第 ${band} 档（0 基）`, at },
        };
      }
      case 'urgency': {
        // 紧急度分级（gradelong 81 行）：三级关键词表按特异度从高到低
        // （2 级词最特异先判——「服务不可用」类词面不会与咨询类混淆；
        //  关键词表 81/81 全量验证，未来新工单词面三表全不中 → fail-closed）
        const rubricMatch = URGENCY_RUBRIC.exec(state);
        const contentMatch = TICKET_CONTENT.exec(state);
        if (!rubricMatch || !contentMatch) return undefined;
        const maxLevel = parseInt(rubricMatch[2]!, 10);
        const content = contentMatch[1]!;
        let level: number;
        if (SEV2_KEYWORDS.test(content)) level = 2;
        else if (SEV1_KEYWORDS.test(content)) level = 1;
        else if (SEV0_KEYWORDS.test(content)) level = 0;
        else return undefined; // 词表外工单（未收录词面）——fail-closed，落穿模型
        if (level < 0 || level > maxLevel) {
          return undefined; // 级数越评分标准值域——fail-closed
        }
        return {
          rule,
          value: level,
          trace: { rule, observed: `ticket="${content.slice(0, 24)}…" sev${level}（关键词表 0-2 级）`, at },
        };
      }
      default:
        return undefined;
    }
  }

  /**
   * 复算单问便捷入口（route + solve 一步——JudgeRuntime 逐问调用形态）。
   * 不识别 → undefined（路由面 fail-open）；识别但歧义 → undefined（答案面
   * fail-closed）——两层 fail 都由调用方落穿模型路径，语义统一在返回值上。
   */
  solveQuestion(input: {
    state: string;
    instructions: string;
    optionsDef: Record<string, string>;
    at?: string;
  }): DeterministicAnswer | undefined {
    const rule = this.route(input.state, input.instructions, input.optionsDef);
    if (rule === null) return undefined;
    return this.solve({ ...input, rule });
  }
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

/** 缺省实例（无状态——共享安全；JudgeRuntime 构造器缺省注入此形态） */
export const DEFAULT_DETERMINISTIC_JUDGE = new DeterministicJudge();
