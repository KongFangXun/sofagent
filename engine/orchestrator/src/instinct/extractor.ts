// ============================================================
// instinct/extractor.ts · instinct 提取器（v1.3.5 交付 3）
// ============================================================
//
// 从三个数据源提取「反复出现的判断模式」（instinct）：
//   1. think.md（Ledger 反思层）——审计后自动生成的教训条目
//   2. decision-log.jsonl（意图层审计）——ORCHESTRATION/EVOLUTION 决策
//   3. 审计 PASS/FAIL 模式（history.jsonl 摘要 + think.md #审计结果 行）
//
// 提取策略（确定性文本挖掘，零 LLM 依赖——与 Dream Cycle 的
// cluster-patterns.ts 同一设计哲学：daemon 可在无模型环境跑）：
//   - think.md：按 `## <时间> 任务:` 分节，抽取 `#教训:` 行 → lesson 模式
//   - decision-log：kind + why.text 归一化为 decision 模式
//   - PASS/FAIL：同一教训文本在 PASS/FAIL 两种审计结局下都出现 → 计 passCount/failCount
//
// 错题本（failure-log.ts）的负样本在提取时由调用方传入并单独加权
// （extractInstincts 的 options.negativeSamples）。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getThinkPath } from '@sofagent/core';
import { aggregateFailurePatterns } from './failure-log';

/** 单条 instinct（未评分的原始提取结果） */
export interface InstinctItem {
  /** 模式归一化 ID（文本指纹，同一模式多次出现共用 ID） */
  id: string;
  /** 模式文本（教训/决策依据的归一化摘要） */
  pattern: string;
  /** 来源类型 */
  source: 'think' | 'decision' | 'audit';
  /** 出现次数（同 ID 在数据源中的出现条数） */
  occurrences: number;
  /** 关联该模式时审计 PASS 的次数 */
  passCount: number;
  /** 关联该模式时审计 FAIL 的次数 */
  failCount: number;
  /** 最近一次出现时间（ISO） */
  lastSeen: string;
}

/** 提取选项 */
export interface ExtractOptions {
  /** 数据目录（缺省走 loadEnvConfig 不适用——这里是显式 dataDir，测试隔离用） */
  dataDir: string;
  /** 错题本负样本聚合结果（缺省自动从 {dataDir}/instinct/failure-log.jsonl 读取聚合） */
  negativeSamples?: Array<{
    id: string;
    pattern: string;
    occurrences: number;
    lastSeen: string;
    contexts?: string[];
  }>;
}

// ────────────────────────────────────────────────────────────
// 归一化与指纹
// ────────────────────────────────────────────────────────────

/**
 * 归一化模式文本——去空白差异、去时间戳前缀，让「同一教训」的
 * 不同措辞强度（标点/空格差异）归到同一指纹。
 * 不做分词/同义归并（那是 Dream Cycle cluster-patterns 的 LLM 职责）。
 */
export function normalizePattern(text: string): string {
  return text
    .trim()
    // 去行内多余空白
    .replace(/\s+/g, ' ')
    // 去句尾标点差异（中英文句号/分号，含尾随空白再补标点的组合）
    .replace(/[。；;.\s]+$/u, '')
    .replace(/[。；;.]+$/u, '')
    .slice(0, 200); // 防异常长文本撑爆指纹
}

/** 模式指纹——归一化文本的 FNV-1a 32 位哈希（hex） */
export function patternId(normalized: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    // 32 位 FNV 素数乘法（用 >>> 保证无符号语义）
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `inst-${hash.toString(16).padStart(8, '0')}`;
}

// ────────────────────────────────────────────────────────────
// 数据源解析
// ────────────────────────────────────────────────────────────

/** think.md 单节解析结果 */
interface ThinkSection {
  timestamp: string;
  task: string;
  auditVerdict: string;
  lessons: string[];
}

/**
 * 解析 think.md 为节列表。
 * 节格式（think-generator.ts formatThinkEntry 的既有契约）：
 *   ## <YYYY-MM-DD HH:mm> 任务: <task>
 *   - #审计结果(...): PASS|WARN|FAIL — N 条规则触发
 *   - #改动范围: ...
 *   - #教训: <lesson 1>；<lesson 2>
 */
export function parseThinkSections(thinkContent: string): ThinkSection[] {
  const sections: ThinkSection[] = [];
  // 按 `## ` 分节（首段可能是空/前言，跳过非任务节）
  const rawSections = thinkContent.split(/\n(?=## )/);
  for (const raw of rawSections) {
    const headerMatch = raw.match(/^## (.+?) 任务: (.*)$/m);
    if (!headerMatch) continue;
    const timestamp = headerMatch[1]!.trim();
    const task = (headerMatch[2] ?? '').trim();

    const auditMatch = raw.match(/- #审计结果\([^)]*\):\s*(PASS|WARN|FAIL)/);
    const auditVerdict = auditMatch ? auditMatch[1]! : 'UNKNOWN';

    const lessons: string[] = [];
    const lessonMatch = raw.match(/- #教训:\s*(.+)$/m);
    if (lessonMatch) {
      // 多教训以中文分号分隔（generateLessons 用 `；` join）
      for (const piece of lessonMatch[1]!.split(/；|;/)) {
        const normalized = normalizePattern(piece);
        if (normalized.length > 0) lessons.push(normalized);
      }
    }

    sections.push({ timestamp, task, auditVerdict, lessons });
  }
  return sections;
}

/** decision-log.jsonl 单条（只消费提取所需的字段子集） */
interface DecisionEntry {
  kind?: string;
  moment?: string;
  ts?: string;
  why?: { text?: string } | string;
}

/** 解析 decision-log.jsonl（容错：坏行跳过） */
function parseDecisionLog(content: string): DecisionEntry[] {
  const entries: DecisionEntry[] = [];
  for (const line of content.trim().split('\n')) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line) as DecisionEntry);
    } catch {
      // 坏行跳过（与 ab-history readAll 同策略）
    }
  }
  return entries;
}

// ────────────────────────────────────────────────────────────
// 主提取器
// ────────────────────────────────────────────────────────────

/**
 * 从 think.md + decision-log + 审计 PASS/FAIL 提取 instinct 模式。
 *
 * @param options 提取选项（dataDir 必填）
 * @returns 去重聚合后的 instinct 列表（未评分——评分是 scorer.ts 职责）
 */
export function extractInstincts(options: ExtractOptions): InstinctItem[] {
  const { dataDir } = options;
  const byId = new Map<string, InstinctItem>();

  const bump = (
    normalized: string,
    source: InstinctItem['source'],
    delta: { occurrences?: number; pass?: number; fail?: number },
    seenAt: string,
  ): void => {
    if (normalized.length === 0) return;
    const id = patternId(normalized);
    const existing = byId.get(id);
    if (existing) {
      existing.occurrences += delta.occurrences ?? 1;
      existing.passCount += delta.pass ?? 0;
      existing.failCount += delta.fail ?? 0;
      if (seenAt > existing.lastSeen) existing.lastSeen = seenAt;
      // source 保留首次来源（去重键是 pattern 而非 source）
    } else {
      byId.set(id, {
        id,
        pattern: normalized,
        source,
        occurrences: delta.occurrences ?? 1,
        passCount: delta.pass ?? 0,
        failCount: delta.fail ?? 0,
        lastSeen: seenAt,
      });
    }
  };

  // ── 数据源 1+3：think.md（教训 + 同节审计结局）──
  const thinkPath = getThinkPath(dataDir);
  if (existsSync(thinkPath)) {
    let thinkContent = '';
    try {
      thinkContent = readFileSync(thinkPath, 'utf-8');
    } catch {
      thinkContent = '';
    }
    for (const section of parseThinkSections(thinkContent)) {
      for (const lesson of section.lessons) {
        const isPass = section.auditVerdict === 'PASS';
        const isFail = section.auditVerdict === 'FAIL';
        bump(lesson, 'think', {
          occurrences: 1,
          pass: isPass ? 1 : 0,
          fail: isFail ? 1 : 0,
        }, section.timestamp);
      }
    }
  }

  // ── 数据源 2：decision-log.jsonl ──
  const decisionLogPath = join(dataDir, 'audit', 'decision-log.jsonl');
  if (existsSync(decisionLogPath)) {
    let logContent = '';
    try {
      logContent = readFileSync(decisionLogPath, 'utf-8');
    } catch {
      logContent = '';
    }
    for (const entry of parseDecisionLog(logContent)) {
      const whyText =
        typeof entry.why === 'string' ? entry.why : entry.why?.text ?? '';
      const normalized = normalizePattern(whyText);
      if (normalized.length === 0) continue;
      // 决策本身无 PASS/FAIL 结局——只计 occurrences
      bump(normalized, 'decision', { occurrences: 1 }, entry.ts ?? '');
    }
  }

  // ── 负样本：错题本（failCount 单独加权 ×2——负样本是强信号）──
  const negatives = options.negativeSamples ?? aggregateFailurePatterns(dataDir);
  for (const sample of negatives) {
    const normalized = normalizePattern(sample.pattern);
    if (normalized.length === 0) continue;
    // 错题本 pattern 可能未在正向数据源出现——也作为 instinct 记录
    // （fail-only 模式评分会低于阈值，但保留在提取结果中供 /evolve 审视）
    bump(normalized, 'audit', { occurrences: 1, fail: 2 }, sample.lastSeen);
  }

  return Array.from(byId.values());
}
