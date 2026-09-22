// ============================================================
// dream-cycle/quality-gate.ts · 知识质量门槛（v1.5.1 第七章五）
// ============================================================
//
// 防「正确的废话」污染知识库的工程化防御——真 LLM 接入后，
// 模型可能产出格式正确但零信息量的泛泛之谈（LIMITATIONS
// 「Dream Cycle 知识质量依赖 LLM」节担忧的落点）。本模块对
// extract/synthesize 产出做「非占位符」三轴校验：
//
//   一、长度轴：产出不得过短（少于阈值 = 无实质内容）
//   二、信息量轴：产出须保留输入中的具体信息（数字/命令/路径/
//                引号块等硬信息标记），泛化复述不达标
//   三、差异度轴：与 MockLLM 同输入输出不得雷同——真脑若退化到
//                与按行切分等价，说明模型没有产生认知增量
//
// 不达标 → ok=false + reasons。两道消费防线：
//   - RealLLM.extract/synthesize：不达标即抛错，state-machine 落
//     failed:<stage> 游标——绝不静默放行。
//   - synthesizeConcepts 落盘边界（任何 provider 产出统一拦截）：
//     不达标跳过落盘 + stderr warn——防线在落盘处兜底，mock 降级
//     输出等绕过 RealLLM 的路径同样进不了 knowledge/。
// ============================================================

import { MockLLM } from './llm-mock';

/** 长度轴阈值：合并产出最少字符数（过短 = 无实质内容） */
const MIN_OUTPUT_CHARS = 24;

/** 信息量轴：硬信息标记正则（数字/路径/命令/引号块/代码块） */
const HARD_INFO_PATTERNS: RegExp[] = [
  /[0-9]+/, // 数字（阈值/次数/版本号）
  /\/[a-z0-9_.-]+/, // Unix 路径片段
  /\.[a-z]{2,4}\b/, // 文件扩展名
  /`[^`]+`/, // 行内代码
  /```/, // 代码块
  /["「『][^"」』]{2,}["」』]/, // 引号块
];

/** 信息量轴：至少命中的硬信息标记数 */
const MIN_HARD_INFO_HITS = 1;

/** 质量门槛判定结果 */
export interface QualityGateResult {
  /** 是否通过（true = 可进知识库） */
  ok: boolean;
  /** 未通过的原因列表（ok=false 时非空——报告/审计消费） */
  reasons: string[];
}

/**
 * 非占位符三轴校验——extract/synthesize 产出的统一质量门槛。
 *
 * @param output 真脑产出（extract 合并文本 / synthesize 标题+正文）
 * @param input  该次认知步骤的原始输入（信息量轴的对照源）
 * @param mockOutput MockLLM 同输入输出（差异度轴的对照源）
 */
export function validateKnowledgeQuality(
  output: string,
  input: string,
  mockOutput: string,
): QualityGateResult {
  const reasons: string[] = [];

  // 一、长度轴
  const trimmed = output.trim();
  if (trimmed.length < MIN_OUTPUT_CHARS) {
    reasons.push(`长度轴：产出仅 ${trimmed.length} 字符（< ${MIN_OUTPUT_CHARS}），疑占位符级输出`);
  }

  // 二、信息量轴：产出须含硬信息标记，且这些标记须在输入中有源
  //（防模型无中生有，也防纯泛化复述）
  const outputHits = HARD_INFO_PATTERNS.filter((re) => re.test(trimmed));
  if (outputHits.length < MIN_HARD_INFO_HITS) {
    reasons.push(`信息量轴：产出无任何硬信息标记（数字/路径/代码/引号块），疑「正确的废话」`);
  } else if (input.trim().length > 0) {
    // 有硬标记 → 至少一个标记可溯源到输入（防幻觉）。溯源判定取产出与
    // 输入的共有片段——标记样例（如首个数字）可能恰是模型新增信息，单点
    // 判定会误伤「重组原文 + 合法增量」的产出形态，故以「产出中任一片段
    // 与输入重合」为可溯源标准。片段集取两类：≥3 字符的 ASCII token +
    // ≥4 字符的 CJK 连续段（中文知识场景 token 化天然缺位，CJK 段补位）。
    const tokens = [
      ...(trimmed.match(/[0-9a-zA-Z_./-]{3,}/g) ?? []),
      ...(trimmed.match(/[\u4e00-\u9fa5]{4,}/g) ?? []),
    ];
    const traceable = tokens.some((tok) => input.includes(tok));
    if (!traceable) {
      reasons.push('信息量轴：产出硬信息标记在输入中无源（模型幻觉或过度演绎）');
    }
  }

  // 三、差异度轴：与 MockLLM 输出完全一致 = 无认知增量。
  // 用规范化文本等值判断（非字符集重合率——后者在「真脑忠实保留原文
  // 具体 token、只增加重组与增量」的合法形态下会误伤：中文原文与 mock
  // 切分的字符集天然高重合，而真脑的增量体现在结构与新信息上）。
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const isIdenticalToMock =
    normalize(trimmed).length > 0 && normalize(trimmed) === normalize(mockOutput);
  if (isIdenticalToMock) {
    reasons.push('差异度轴：产出与 MockLLM 占位输出规范化后完全一致，真脑未产生认知增量');
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * MockLLM.extract 的差异度对照输出——直接实例化 MockLLM 取同输入
 * 真实输出（单一真源，消灭双实现漂移面）。
 */
export function mockExtractForDiff(input: string): string {
  return new MockLLM().extractSync(input).join('\n');
}

/**
 * MockLLM.synthesize 的差异度对照输出（与 llm-mock.ts 同语义：
 * 首条前 20 字符 + hash 后缀做标题、编号拼接做正文）。
 * 直接实例化 MockLLM 取同输入真实输出——差异度轴的对照源必须是
 * mock 本体的真实形态（曾因双实现漂移：对照源漏 hash 后缀，导致
 * 差异度轴对 mock 真实输出永不命中，防线失效）。
 */
export function mockSynthesizeForDiff(inputs: string[]): { title: string; body: string } {
  return new MockLLM().synthesizeSync(inputs);
}
