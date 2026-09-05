// ============================================================
// skill-evolution/skill-impact-ledger.ts · 技能进化提案台账
// v1.4.5 第七章四新增（WikiSkill 机制收编 · arXiv:2608.27454）
// ============================================================
//
// 「技能变更」这本账：每次提案的元数据/unified diff/验证分数/接受与否
// 程序化落账（JSONL append-only，非 LLM 手写）——与 LEDGER 记 run 互补。
// 被拒提案不丢教训（rejected 也落账带原因），Proposer 后续迭代查阅
// 避免重复踩坑。
//
// 三层架构对齐（WikiSkill）：Raw 不可变轨迹 = history.jsonl+HMAC /
// Wiki 永不回滚 = knowledge/entities 只增 / Skills 可回滚 = 台账记
// 每次可回滚的变更提案及其裁决。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

/** 台账目录（data/skill-evolution/） */
export function skillEvolutionDir(dataDir: string): string {
  return join(dataDir, 'skill-evolution');
}

/** 台账文件路径（skill-impact.jsonl——append-only） */
export function skillImpactLedgerPath(dataDir: string): string {
  return join(skillEvolutionDir(dataDir), 'skill-impact.jsonl');
}

/** 提案裁决 */
export type ProposalVerdict = 'accepted' | 'rejected' | 'pending';

/** 台账单条记录（一提案一条） */
export interface SkillImpactEntry {
  /** 提案 ID（proposal-<ts>-<seq>） */
  proposalId: string;
  /** ISO 8601 时间戳 */
  ts: string;
  /** 目标技能路径（SKILL/... 相对仓根） */
  skillPath: string;
  /** 技能 frontmatter slug（无 frontmatter 的知识文档可为空） */
  slug: string;
  /** 回链所解决的 pattern（frontmatter solves: 字段同源值） */
  solvesPattern: string;
  /** unified diff 全文（提案内容——程序化生成非 LLM 手写） */
  unifiedDiff: string;
  /** 验证分数（eval 验证集得分；null = 尚未跑 eval） */
  evalScore: number | null;
  /** 历史最优分（门控对照线——超它才收编） */
  historicalBest: number | null;
  /** 裁决（accepted/rejected/pending——人审收口） */
  verdict: ProposalVerdict;
  /** 拒绝原因（verdict=rejected 时非空——教训不丢） */
  rejectReason?: string;
  /** 操作者（proposal 生成方标识） */
  actor: string;
}

/** 追加一条台账记录（append-only，绝不覆写） */
export function appendSkillImpactEntry(dataDir: string, entry: SkillImpactEntry): void {
  const dir = skillEvolutionDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(skillImpactLedgerPath(dataDir), JSON.stringify(entry) + '\n', 'utf-8');
}

/** 读全部台账（坏行跳过宽松语义） */
export function readSkillImpactLedger(dataDir: string): SkillImpactEntry[] {
  const path = skillImpactLedgerPath(dataDir);
  if (!existsSync(path)) return [];
  const entries: SkillImpactEntry[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as SkillImpactEntry);
    } catch {
      // 坏行跳过
    }
  }
  return entries;
}

/** 查目标技能的历史最优验证分（门控对照线——无记录 null） */
export function historicalBestScore(dataDir: string, skillPath: string): number | null {
  const entries = readSkillImpactLedger(dataDir).filter(
    (e) => e.skillPath === skillPath && e.verdict === 'accepted' && typeof e.evalScore === 'number',
  );
  if (entries.length === 0) return null;
  return Math.max(...entries.map((e) => e.evalScore as number));
}

/** 被拒提案查询（Proposer 防重复踩坑的教训源） */
export function readRejectedProposals(dataDir: string, skillPath?: string): SkillImpactEntry[] {
  return readSkillImpactLedger(dataDir).filter(
    (e) => e.verdict === 'rejected' && (skillPath === undefined || e.skillPath === skillPath),
  );
}
