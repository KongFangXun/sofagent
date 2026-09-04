// ============================================================
// dream-cycle/state-machine.ts · Dream Cycle 6 阶段编排状态机
// v1.3.7 新增
//
// 职责：
//   - 按序串 6 个 stage（extract_facts → … → embed）
//   - state.md 持久化断点游标（completedStages / failed / cycleComplete）
//   - fromStage 断点续跑（失败重试 / nightly 增量）
//   - 失败标记 failed:<stage>，本轮中断但游标落盘
//   - cycle_complete 时向 knowledge/log.md 追加周报：
//     「本周学 N 个 concept / M 个 atom，来自 K 条 audit history」（LUI A）
//
// 记忆契约（与 memory-contract.ts 一致）：
//   派生方向严格单向——只从 think.md（Ledger）读、向 knowledge/（Views）写。
//   think.md 只读，绝不回写。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { getThinkPath, resolveKnowledgeDir, resolveDataDir, atomicWriteWithMergeSync } from '@sofagent/core';

import type {
  AuditEntry,
  DreamCycleResult,
  DreamCycleState,
  Ledger,
  LLMProvider,
  Stage,
} from './types';
import { DREAM_CYCLE_STAGES } from './types';
import { pushKnowledgeSummary } from '../notify';
import { pushToTarget } from '../push-target';
import { MockLLM } from './llm-mock';
import { extractFacts } from './extract-facts';
import { extractAtoms } from './extract-atoms';
import { clusterPatterns } from './cluster-patterns';
import { synthesizeConcepts } from './synthesize-concepts';
import { skilloptBackfill } from './skillopt-backfill';
import { embedConcepts } from './embed';

/** state.md 文件名（断点游标持久化） */
const STATE_FILENAME = 'state.md';

/**
 * 读取 Ledger（think.md + audit history.jsonl）。
 * 任一源缺失优雅降级为空，不抛异常。
 * v1.2.1：数据根从 .sofagent/ 迁移到 data/
 */
export function loadLedger(projectDir: string): Ledger {
  // projectDir 保留用于 .sofagent/dream-cycle/state.md（loadState/saveState），
  // 但 resolveDataDir 不传参——fallback 到 SOFAGENT_HOME（~/.sofagent/data/）
  const dataDir = resolveDataDir();

  // think.md（Ledger 原始反思）
  let thinkContent = '';
  const thinkPath = getThinkPath(dataDir);
  try {
    if (existsSync(thinkPath)) {
      thinkContent = readFileSync(thinkPath, 'utf-8');
    }
  } catch (err) {
    process.stderr.write(`[dream-cycle] warn: think.md 读取失败: ${(err as Error).message}\n`);
    thinkContent = '';
  }

  // audit history.jsonl（宽松逐行解析，坏行跳过）
  const auditEntries: AuditEntry[] = [];
  const historyPath = join(dataDir, 'audit', 'history.jsonl');
  try {
    if (existsSync(historyPath)) {
      const lines = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          auditEntries.push(JSON.parse(line) as AuditEntry);
        } catch (err) {
          // 坏行跳过（宽松）
          process.stderr.write(`[dream-cycle] warn: history 坏行跳过: ${(err as Error).message}\n`);
        }
      }
    }
  } catch (err) {
    // history 不可读 → 空
    process.stderr.write(`[dream-cycle] warn: history 文件不可读: ${(err as Error).message}\n`);
  }

  return { thinkContent, auditEntries };
}

/**
 * 读 state.md 断点游标。
 * state.md 用极简 markdown 键值对格式（不引 yaml）：
 *   ```
 *   # dream-cycle state
 *   completed: extract_facts,extract_atoms
 *   failed: cluster_patterns
 *   cycle_complete: false
 *   last_run_at: 2026-07-20T00:00:00.000Z
 *   ```
 */
export function loadState(projectDir: string): DreamCycleState {
  const statePath = join(projectDir, '.sofagent', 'dream-cycle', STATE_FILENAME);
  const initial: DreamCycleState = {
    completedStages: [],
    failed: null,
    cycleComplete: false,
    lastRunAt: null,
  };
  if (!existsSync(statePath)) return initial;
  try {
    const content = readFileSync(statePath, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      const m = line.match(/^([a-z_]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const value = (m[2] ?? '').trim();
      if (key === 'completed' && value) {
        initial.completedStages = value
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is Stage => (DREAM_CYCLE_STAGES as readonly string[]).includes(s));
      } else if (key === 'failed' && value) {
        initial.failed = value;
      } else if (key === 'cycle_complete') {
        initial.cycleComplete = value === 'true';
      } else if (key === 'last_run_at' && value) {
        initial.lastRunAt = value;
      }
    }
  } catch (err) {
    process.stderr.write(`[dream-cycle] warn: 状态文件解析失败: ${(err as Error).message}\n`);
    return initial;
  }
  return initial;
}

/** 写 state.md 断点游标（dream-cycle 自己的状态文件，允许写） */
function saveState(projectDir: string, state: DreamCycleState): void {
  const dir = join(projectDir, '.sofagent', 'dream-cycle');
  mkdirSync(dir, { recursive: true });
  const content =
    `# dream-cycle state\n` +
    `completed: ${state.completedStages.join(',')}\n` +
    `failed: ${state.failed ?? ''}\n` +
    `cycle_complete: ${state.cycleComplete}\n` +
    `last_run_at: ${state.lastRunAt ?? ''}\n`;
  // v1.3.0 (交付 11)：状态文件接入原子写 + 写前 mtime 检测（多进程状态竞争防护）
  atomicWriteWithMergeSync(join(dir, STATE_FILENAME), content);
}

/**
 * 向 knowledge/log.md 追加 Dream Cycle 周报（LUI A 可感知产物）。
 * log.md 用 appendFileSync（只追加，符合 Ledger-Views 只追加语义）。
 * v1.2.1：knowledge/ 从 .sofagent/ 迁移到 data/
 */
function appendWeeklyLog(
  projectDir: string,
  counts: DreamCycleResult['counts'],
  auditEntryCount: number,
): void {
  // resolveKnowledgeDir 不传 projectDir——fallback 到 SOFAGENT_HOME（~/.sofagent/data/knowledge/）
  const knowledgeDir = resolveKnowledgeDir();
  mkdirSync(knowledgeDir, { recursive: true });
  const logPath = join(knowledgeDir, 'log.md');
  const now = new Date().toISOString().slice(0, 10);
  const entry =
    `\n## ${now} Dream Cycle 周报\n\n` +
    `本周学 ${counts.concepts} 个 concept / ${counts.atoms} 个 atom，来自 ${auditEntryCount} 条 audit history。\n`;
  appendFileSync(logPath, entry, 'utf-8');
}

/**
 * Dream Cycle 主入口——按序跑 6 个 stage，支持断点续跑。
 *
 * @param projectDir 项目根目录
 * @param opts.fromStage 从指定 stage 续跑（跳过之前的 stage，用于失败重试）
 * @param opts.llm LLMProvider（默认 MockLLM；RealLLM 接入时间未定——见 roadmap）
 * @param opts.ledger 可选 Ledger 注入（测试用；缺省从磁盘读）
 * @param opts.backfillHook 可选 skillopt backfill 钩子注入（测试 mock 验证用）
 */
export async function runDreamCycle(
  projectDir: string,
  opts?: {
    fromStage?: Stage;
    ledger?: Ledger;
    llm?: LLMProvider;
    backfillHook?: (concepts: unknown[]) => Promise<void> | void;
  },
): Promise<DreamCycleResult> {
  const llm = opts?.llm ?? new MockLLM();
  const ledger = opts?.ledger ?? loadLedger(projectDir);

  // 断点游标：fromStage 指定时从它开始，否则读 state.md 续跑
  const priorState = loadState(projectDir);
  const startStage: Stage = opts?.fromStage
    ?? (priorState.failed
      ? (priorState.failed.replace(/^failed:/, '') as Stage)
      : DREAM_CYCLE_STAGES[0]);
  const startIdx = DREAM_CYCLE_STAGES.indexOf(startStage);

  const result: DreamCycleResult = {
    cycleComplete: false,
    completedStages: [...priorState.completedStages],
    failedAt: null,
    counts: { facts: 0, atoms: 0, patterns: 0, concepts: 0, embeddings: 0 },
    auditEntryCount: ledger.auditEntries.length,
  };

  // 中间态在各 stage 间传递（pipeline 数据流）
  let facts = [] as Awaited<ReturnType<typeof extractFacts>>;
  let atoms = [] as Awaited<ReturnType<typeof extractAtoms>>;
  let patterns = [] as Awaited<ReturnType<typeof clusterPatterns>>;
  let concepts = [] as Awaited<ReturnType<typeof synthesizeConcepts>>;
  let embeddings = [] as Awaited<ReturnType<typeof embedConcepts>>;

  try {
    for (let i = startIdx; i < DREAM_CYCLE_STAGES.length; i++) {
      const stage = DREAM_CYCLE_STAGES[i]!;
      switch (stage) {
        case 'extract_facts':
          facts = await extractFacts(ledger, llm);
          result.counts.facts = facts.length;
          break;
        case 'extract_atoms':
          atoms = await extractAtoms(facts, llm);
          result.counts.atoms = atoms.length;
          break;
        case 'cluster_patterns':
          patterns = await clusterPatterns(atoms, llm);
          result.counts.patterns = patterns.length;
          break;
        case 'synthesize_concepts':
          concepts = await synthesizeConcepts(patterns, atoms, llm, projectDir);
          result.counts.concepts = concepts.length;
          break;
        case 'skillopt_backfill':
          await skilloptBackfill(concepts, llm, opts?.backfillHook);
          break;
        case 'embed':
          embeddings = await embedConcepts(concepts, llm);
          result.counts.embeddings = embeddings.length;
          break;
      }
      if (!result.completedStages.includes(stage)) {
        result.completedStages.push(stage);
      }
    }
    result.cycleComplete = true;
  } catch (err) {
    const failedStage = DREAM_CYCLE_STAGES.find((s) => !result.completedStages.includes(s));
    result.failedAt = failedStage ?? null;
    result.error = err instanceof Error ? err.message : String(err);
    saveState(projectDir, {
      completedStages: result.completedStages,
      failed: result.failedAt ? `failed:${result.failedAt}` : null,
      cycleComplete: false,
      lastRunAt: new Date().toISOString(),
    });
    return result;
  }

  // cycle_complete → 落游标 + 追加周报
  saveState(projectDir, {
    completedStages: result.completedStages,
    failed: null,
    cycleComplete: true,
    lastRunAt: new Date().toISOString(),
  });
  appendWeeklyLog(projectDir, result.counts, result.auditEntryCount);
  // v1.1.8 新增：cycle_complete 触发知识摘要主动通知（best-effort，失败静默）
  void pushKnowledgeSummary(projectDir, pushToTarget);
  return result;
}
