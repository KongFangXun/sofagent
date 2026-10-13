// criteria-quality-lint.ts · 判据质量 lint（四硬 fail-closed + 三软提示 + 待修清单）
// ============================================================
// 定位：schema 校验管**格式**合规，lint 管**质量**可用。
//   硬①可判别性：正负样例互不矛盾（同一样例同现 match/notMatch——schema 已查
//      逐字矛盾，lint 深查**子串包含**形态的近矛盾）
//   硬②可举证性：证据字段须指向可复现的采集来源（schema 查过枚举，lint 查
//      locator 是否指向真实通道白名单）
//   硬③概率来源可追溯：生成式自述数字不构成概率——probabilitySource 缺失或
//      自述形态即拒载
//   硬④问句可分解性：一个问句混装多个独立判断（「是否有价值、紧急且会买」
//      形态——连接词枚举）即拒载，须拆原子问句
//   软⑤可校准性：判据能否给出概率目标（只能二值的进「硬标签清单」）
//   软⑥判据重复度：语义重复的判据提示合并（问句文本近重复）
//   软⑦选项互斥性：候选两两可同时成立即提示（常不可机械判定，交人工）
// 软项不阻断整批加载，产出待修清单。
// ============================================================
import type { AuditCriterion } from './criteria-schema';

/** lint 结果 */
export interface LintFinding {
  criterionId: string;
  kind: 'hard' | 'soft';
  rule: string;
  message: string;
}

export interface LintReport {
  /** 硬项命中（>0 即整批拒载） */
  hard: LintFinding[];
  /** 软项命中（提示 + 进待修清单） */
  soft: LintFinding[];
}

/** 证据采集通道白名单（可复现来源——新增通道须在此登记） */
const EVIDENCE_CHANNEL_WHITELIST = new Set([
  'git-diff',
  'decision-log',
  'audit-history',
  'hitl-resolved',
  'tool-gate-3state',
  'intent-stream',
  'credential-vault',
  'pr-review',
  'runtime-trace',
  'rule-selftest',
]);

/** 问句混装连接词（独立判断的分隔信号——命中即疑似多判断混装） */
const COMPOUND_QUESTION_MARKERS = [
  '且会',
  '并且',
  '而且也',
  '同时是否',
  '、是否',
  '，是否',
  '以及是否',
];

/** 生成式自述概率形态（「模型说 90%」类——不构成概率来源） */
const SELF_REPORTED_PROBABILITY = /(自述|self[- ]report|模型说|自称|生成的数字)/i;

export function lintCriteria(criteria: AuditCriterion[]): LintReport {
  const hard: LintFinding[] = [];
  const soft: LintFinding[] = [];
  const push = (arr: LintFinding[], c: AuditCriterion, rule: string, message: string) =>
    arr.push({ criterionId: c.id, kind: arr === hard ? 'hard' : 'soft', rule, message });

  for (const c of criteria) {
    // ── 硬① 可判别性（深查：子串包含的近矛盾——「AKIA123」同现 match 与
    //    notMatch 的「示例 AKIA123123」形态）
    for (const m of c.examples.match) {
      for (const nm of c.examples.notMatch) {
        if (m.includes(nm) || nm.includes(m)) {
          if (m !== nm) {
            push(hard, c, 'discriminability', `正负样例近矛盾（子串包含）：match「${m.slice(0, 40)}」↔ notMatch「${nm.slice(0, 40)}」`);
          }
        }
      }
    }
    // ── 硬② 可举证性（通道白名单）
    for (const e of c.evidence) {
      if (!EVIDENCE_CHANNEL_WHITELIST.has(e.source)) {
        push(hard, c, 'evidentiability', `证据 source「${e.source}」不在采集通道白名单（可复现来源——白名单外须先登记通道）`);
      }
    }
    // ── 硬③ 概率来源可追溯
    if (c.disposition === 'calibrated-probability') {
      if (!c.probabilitySource) {
        push(hard, c, 'probability-traceability', 'calibrated-probability 判据缺 probabilitySource（来源不可追溯即拒载）');
      } else if (SELF_REPORTED_PROBABILITY.test(String(c.probabilitySource))) {
        push(hard, c, 'probability-traceability', `probabilitySource 含生成式自述形态「${c.probabilitySource}」——自述数字不构成概率`);
      }
    }
    // ── 硬④ 问句可分解性（混装多独立判断）
    for (const marker of COMPOUND_QUESTION_MARKERS) {
      if (c.question.includes(marker)) {
        push(hard, c, 'decomposability', `问句疑似混装多个独立判断（命中连接词「${marker}」）——须拆原子问句、由代码按业务权重合成`);
        break; // 一条判据只报一次
      }
    }
    // ── 软⑤ 可校准性（硬标签清单种子）
    if (c.disposition === 'stay-code' && c.thresholds.length === 0) {
      push(soft, c, 'calibratability', '纯代码判据无门槛——属硬标签（无概率目标），进 v1.7.0 校准范围输入清单');
    }
    // ── 软⑥ 判据重复度（问句近重复——两两比对）
    // 在下方批处理后统一查（避免 O(n²) 内重复入列）
    // ── 软⑦ 选项互斥性（启发：选项互为前缀/包含形态时疑似非互斥）
    if (c.primitive === 'choice' && c.options) {
      for (let i = 0; i < c.options.length; i++) {
        for (let j = i + 1; j < c.options.length; j++) {
          const a = c.options[i]!;
          const b = c.options[j]!;
          if (a !== b && (a.includes(b) || b.includes(a))) {
            push(soft, c, 'option-exclusivity', `选项疑似非互斥（包含形态）：「${a.slice(0, 20)}」↔「${b.slice(0, 20)}」——交判据评审人工把关`);
          }
        }
      }
    }
  }

  // 软⑥ 批处理：问句近重复（编辑距离粗筛——共同 8-gram）
  const byGram = new Map<string, string[]>();
  const gramsOf = (q: string): Set<string> => {
    const grams = new Set<string>();
    for (let i = 0; i + 8 <= q.length; i++) grams.add(q.slice(i, i + 8));
    return grams;
  };
  const qGrams = new Map<string, Set<string>>();
  for (const c of criteria) qGrams.set(c.id, gramsOf(c.question));
  const idList = criteria.map((c) => c.id);
  for (let i = 0; i < idList.length; i++) {
    for (let j = i + 1; j < idList.length; j++) {
      const a = idList[i]!;
      const b = idList[j]!;
      const ga = qGrams.get(a)!;
      const gb = qGrams.get(b)!;
      let shared = 0;
      for (const g of ga) if (gb.has(g)) shared++;
      const overlap = shared / Math.min(ga.size, gb.size);
      if (overlap > 0.6) {
        soft.push({
          criterionId: `${a} ↔ ${b}`,
          kind: 'soft',
          rule: 'duplication',
          message: `问句近重复（8-gram 重叠 ${(overlap * 100).toFixed(0)}%）——语义重复的判据提示合并`,
        });
      }
    }
  }

  return { hard, soft };
}

/** 硬标签清单（无概率目标的判据——v1.7.0 校准范围输入） */
export function hardLabelList(criteria: AuditCriterion[]): string[] {
  return criteria.filter((c) => c.disposition === 'stay-code').map((c) => c.id);
}

/** 判据 lint 主入口：硬项 >0 抛错（拒载该批），软项产出待修清单 */
export function lintOrFail(criteria: AuditCriterion[]): {
  report: LintReport;
  pendingFixes: string[];
} {
  const report = lintCriteria(criteria);
  if (report.hard.length > 0) {
    const lines = report.hard.map((h) => `  [${h.rule}] ${h.criterionId}: ${h.message}`);
    throw new Error(`[criteria-quality-lint] 硬项 ${report.hard.length} 处命中（fail-closed 拒载）：\n${lines.join('\n')}`);
  }
  const pendingFixes = report.soft.map((s) => `[${s.rule}] ${s.criterionId}: ${s.message}`);
  return { report, pendingFixes };
}
