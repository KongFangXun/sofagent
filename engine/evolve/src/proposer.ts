// ============================================================
// proposer.ts · Skill Proposer 内化（v1.5.1 ⑩-2 · WikiSkill 四角色合拢）
// ============================================================
// DSH 执行提案 prompt：输入 = wiki 索引 + skill-impact 台账（含被拒提案
// 与失败教训）+ failure-ledger 聚类，输出 = 原子化技能更新提案（带
// solves: 溯源 + unified diff）——通用模型即可（论文实证 4B 也能有效提案）。
// 产出先过 skill-safety-check（包内已有）再进 gate——不直进 SKILL/。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { scanSkillSafety } from './skill-safety-check';
import type { SafetyResult } from '@sofagent/audit';

/** 提案输入三源 */
export interface ProposerInput {
  /** wiki 索引（knowledge/index.md 内容或结构化索引） */
  wikiIndex: string;
  /** skill-impact 台账（v1.4.5 七·四 skill-impact-ledger 产物路径） */
  skillImpactLedgerPath?: string;
  /** failure-ledger 聚类（本包 failure-ledger 产物） */
  failureLedgerPath?: string;
}

/** 原子化提案 */
export interface SkillProposal {
  /** 提案标题（一句话） */
  title: string;
  /** 溯源（solves: 台账/聚类条目 id 列表） */
  solves: string[];
  /** unified diff（对目标 SKILL 文件的增量） */
  diff: string;
  /** 目标技能文件 */
  targetSkillPath: string;
}

/** 安全扫描结果（先过 scan 再进 gate——不直进 SKILL/） */
export interface ProposalWithSafety {
  proposal: SkillProposal;
  safety: SafetyResult;
  /** 安全校验通过（通过才可进 gate） */
  safe: boolean;
}

/**
 * 读 skill-impact 台账（solves 溯源与被拒提案的输入源）。
 * 台账不存在 → 空串（提案仍可基于 failure 聚类产生）。
 */
export function loadImpactLedger(path?: string): string {
  if (!path || !existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

/**
 * 读 failure-ledger（聚类源——本包 failure-ledger 产物）。
 */
export function loadFailureLedger(path?: string): string {
  if (!path || !existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

/**
 * 生成 DSH 提案 prompt（调用方交给通用模型执行；本函数纯拼装——
 * 可单测可回放）。
 */
export function buildProposerPrompt(input: ProposerInput, workDir: string): string {
  const impact = loadImpactLedger(input.skillImpactLedgerPath ?? join(workDir, 'skill-impact.json'));
  const failures = loadFailureLedger(input.failureLedgerPath ?? join(workDir, 'failure-ledger.json'));
  return [
    '# 技能更新提案任务（Skill Proposer）',
    '',
    '你是进化模块的提案者。基于以下三源输入，产出**原子化**技能更新提案。',
    '',
    '## 输入一：wiki 索引（现有知识面——避免重复提案）',
    input.wikiIndex.slice(0, 4000),
    '',
    '## 输入二：skill-impact 台账（含被拒提案教训——勿重复已被拒绝的方向）',
    impact.slice(0, 4000) || '（无台账数据）',
    '',
    '## 输入三：failure-ledger 聚类（失败模式——提案须解决真实失败）',
    failures.slice(0, 4000) || '（无失败记录）',
    '',
    '## 输出格式（严格 JSON）',
    '```json',
    '{',
    '  "title": "一句话提案标题",',
    '  "solves": ["ledger 条目 id 或聚类 id（溯源必填）"],',
    '  "targetSkillPath": "目标技能文件相对路径",',
    '  "diff": "--- a/<file>\\n+++ b/<file>\\n@@ ... @@（unified diff）"',
    '}',
    '```',
    '',
    '约束：① 原子化——一个提案只解决一个失败模式；② solves 必须指向真实台账/聚类条目；'
    + '③ diff 必须是可直接应用的 unified diff；④ 不新增依赖、不改约束语义（红线级内容禁触）。',
  ].join('\n');
}

/**
 * 解析模型输出为提案 + 安全扫描前置。
 * 安全不通过 → safe=false（调用方不得送 gate，更不得进 SKILL/）。
 */
export function parseProposalWithSafety(modelOutput: string): ProposalWithSafety {
  // 提取 JSON 块（模型可能带 markdown 围栏）
  const m = modelOutput.match(/```json\s*([\s\S]*?)```/) ?? modelOutput.match(/(\{[\s\S]*\})/);
  if (!m || !m[1]) {
    return { proposal: null as unknown as SkillProposal, safety: { target: '(parse)', verdict: 'DANGEROUS', rules: [], hits: [{ line: 0, rule: 'proposer-parse', detail: '模型输出无可解析 JSON' }] } as unknown as SafetyResult, safe: false };
  }
  let parsed: Partial<SkillProposal>;
  try {
    parsed = JSON.parse(m[1]) as Partial<SkillProposal>;
  } catch {
    return { proposal: null as unknown as SkillProposal, safety: { target: '(parse)', verdict: 'DANGEROUS', rules: [], hits: [{ line: 0, rule: 'proposer-parse', detail: 'JSON 解析失败' }] } as unknown as SafetyResult, safe: false };
  }
  const proposal: SkillProposal = {
    title: parsed.title ?? '(untitled)',
    solves: Array.isArray(parsed.solves) ? parsed.solves : [],
    diff: parsed.diff ?? '',
    targetSkillPath: parsed.targetSkillPath ?? 'SKILL/SKILL.md',
  };
  // 安全扫描前置（产出不直进 SKILL/——先过包内 checkSkillSafety）
  // 安全扫描前置（scanSkillSafety 目录形态——diff 落临时目录后扫描由调用方编排；此处按 diff 文本轻扫红线词）
  const DANGER_WORDS = /rm -rf|curl[^|]*\|\s*(ba)?sh|sudo|chmod\s+777|--force-push/i;
  const issues: string[] = DANGER_WORDS.test(proposal.diff) ? ['diff 含危险模式（破坏性命令/提权/下载即执行）'] : [];
  const safety: SafetyResult = { target: proposal.targetSkillPath, verdict: issues.length ? 'DANGEROUS' : 'SAFE', rules: [], hits: [] } as unknown as SafetyResult;
  const safe = issues.length === 0 && proposal.solves.length > 0 && proposal.diff.length > 0;
  return { proposal, safety, safe };
}
