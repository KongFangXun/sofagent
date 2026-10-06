// ============================================================
// skill-health.ts · 五维技能健康度 + 退役候选生成（v1.5.7 章四）
//
// 研究收编（Google《Towards a Systems Foundation for Agentic Skills》
// arXiv:2608.29596 SkillOps 五维治理）：SKILL 库只进不出是技能熵单调递增——
// 本模块给每个技能文件算五维健康度、产出退役候选（进 FDE 人工确认，
// 不自动删——对齐「只提示不阻断」）。
//
// ── 五维定义与数据源（以仓内可得性实测为准）──
//   ① 使用频率 usage      —— {data}/evolve/skill-usage.jsonl 的调用计数
//                           （写入面：recordSkillUsage；无记录 = 0 次）
//   ② 最近使用 recency    —— skill-usage.jsonl 最近一条的时间距今天数
//                           （无记录 = ∞，按 STALE_DAYS 上限计）
//   ③ 测试覆盖 testCov    —— 同名 .test.ts 文件存在性（SKILL/ 下无测试
//                           目录结构惯例，取「同名测试文件存在」二元判据）
//   ④ 依赖引用 reference  —— 全仓文本扫描该技能文件名的引用数
//                           （SKILL.md / harness / evolve 面引用）
//   ⑤ 内容陈旧度 staleness—— 文件 mtime 距今天数（>180 天 = 陈旧）
//
// 健康度总分 = 五维各 0-1 分等权平均；退役候选 = 总分 < 阈值（默认 0.35）
// 且使用频率与最近使用双低（防「引用多但没人用」与「刚出生没数据」误判）。
//
// 退役动作：归档不物理删——技能文件移入 {data}/evolve/skill-archive/
// 并登记台账行（restoreSkill 按台账行回滚到原路径）。
//
// 技能技术债台账：{data}/evolve/skill-debt.jsonl——每技能记
// 「上次验证时间 / 当前分数 vs 历史最优 / 待还债清单」。
// ============================================================

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, statSync, readdirSync } from 'fs';
import { join, dirname, basename, relative } from 'path';
import { loadEnvConfig } from '@sofagent/core';

/** 技能使用记录（skill-usage.jsonl 一行；写入面 recordSkillUsage） */
export interface SkillUsageRecord {
  /** ISO 时间戳 */
  ts: string;
  /** 技能标识（文件名去扩展名，如 '01-entry'） */
  skillId: string;
  /** 调用来源标识（如 SKILL.md 阶段调度） */
  source: string;
}

/** 五维健康度分项 */
export interface SkillHealthDimensions {
  /** ① 使用频率（0-1：usageCount / USAGE_SATURATION 饱和归一） */
  usage: number;
  /** ② 最近使用（0-1：越近越高；无记录 = 0） */
  recency: number;
  /** ③ 测试覆盖（0/1：同名 .test.ts 存在） */
  testCoverage: number;
  /** ④ 依赖引用（0-1：引用数 / REFERENCE_SATURATION 归一） */
  reference: number;
  /** ⑤ 内容新鲜度（0-1：mtime 越新越高；>STALE_DAYS = 0） */
  freshness: number;
}

/** 单技能健康度报告 */
export interface SkillHealthReport {
  /** 技能文件相对路径（相对技能根目录） */
  skillPath: string;
  /** 技能标识 */
  skillId: string;
  /** 五维分项（0-1） */
  dimensions: SkillHealthDimensions;
  /** 总分（五维等权平均，0-1） */
  score: number;
  /** 是否退役候选 */
  retirementCandidate: boolean;
  /** 退役候选判定理由（非候选为空） */
  reasons: string[];
  /** 技术债字段：上次验证时间（无 = null） */
  lastVerifiedAt: string | null;
  /** 技术债字段：当前分数 */
  currentScore: number;
  /** 技术债字段：历史最优分数（与当前同批首见时相等） */
  bestScore: number;
  /** 技术债字段：待还债清单（低分维度名） */
  debts: string[];
}

/** 退役归档台账行（skill-archive-ledger.jsonl 一行） */
export interface ArchiveLedgerEntry {
  /** 归档时间（ISO） */
  archivedAt: string;
  /** 原路径（相对技能根，restore 目标） */
  originalPath: string;
  /** 归档存储文件名（archive 目录内） */
  archivedAs: string;
  /** 归档时健康分 */
  scoreAtArchive: number;
  /** 操作者（人工确认制——操作人标识） */
  confirmedBy: string;
  /** 回滚时间（未回滚 = null） */
  restoredAt: string | null;
}

// ── 阈值常量（单源——测试与文档消费）──
/** 使用次数饱和值（≥ 此值该维满分） */
export const USAGE_SATURATION = 20;
/** 引用数饱和值 */
export const REFERENCE_SATURATION = 5;
/** 陈旧天数上限（mtime 距今超过此值该维 0 分） */
export const STALE_DAYS = 180;
/** 退役候选总分阈值（低于即候选） */
export const RETIREMENT_THRESHOLD = 0.35;
/** 退役候选使用频率硬条件：usage 维 < 0.15 */
export const RETIREMENT_USAGE_FLOOR = 0.15;

/** 技能根目录解析（默认仓内 SKILL/skills，env 可覆盖） */
export function resolveSkillRoot(overrideRoot?: string): string {
  if (overrideRoot) return overrideRoot;
  const env = loadEnvConfig();
  return join(dirname(env.dataDir), 'skill', 'skills');
}

/** 技能使用台账路径：{data}/evolve/skill-usage.jsonl */
export function resolveSkillUsagePath(): string {
  return join(loadEnvConfig().dataDir, 'evolve', 'skill-usage.jsonl');
}

/** 技术债台账路径：{data}/evolve/skill-debt.jsonl */
export function resolveSkillDebtPath(): string {
  return join(loadEnvConfig().dataDir, 'evolve', 'skill-debt.jsonl');
}

/** 归档目录：{data}/evolve/skill-archive/ */
export function resolveSkillArchiveDir(): string {
  return join(loadEnvConfig().dataDir, 'evolve', 'skill-archive');
}

/** 归档台账路径：{data}/evolve/skill-archive/ledger.jsonl */
export function resolveArchiveLedgerPath(): string {
  return join(resolveSkillArchiveDir(), 'ledger.jsonl');
}

/** 记一次技能使用（skill-usage.jsonl 追加一行） */
export function recordSkillUsage(skillId: string, source = 'unknown'): void {
  const p = resolveSkillUsagePath();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), skillId, source }) + '\n', 'utf-8');
}

/** 读全部使用记录（文件不存在 = 空数组） */
export function readSkillUsage(): SkillUsageRecord[] {
  const p = resolveSkillUsagePath();
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      try {
        return JSON.parse(l) as SkillUsageRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is SkillUsageRecord => r !== null);
}

/** 列技能根下的 .md 技能文件（递归） */
function listSkillFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.md')) out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

/** 读技术债台账（skillId → 最近一条） */
function readDebtLedger(): Map<string, { lastVerifiedAt: string; bestScore: number }> {
  const p = resolveSkillDebtPath();
  const map = new Map<string, { lastVerifiedAt: string; bestScore: number }>();
  if (!existsSync(p)) return map;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { skillId: string; ts: string; score: number; bestScore: number };
      map.set(e.skillId, { lastVerifiedAt: e.ts, bestScore: e.bestScore });
    } catch {
      /* 为何可静默：坏行跳过——台账读不炸主流程（skill-debt.jsonl 损坏行不阻断健康度计算，后续写入自然覆盖） */
    }
  }
  return map;
}

/** 引用扫描文件数硬截断——防技能根落在巨型目录树时扫描失控（实测 tmpdir 父树会卡死测试） */
const MAX_SCAN_FILES = 400;

/**
 * 引用计数：文本扫描技能 stem 在**技能根树内**的出现处。
 * 扫描根 = skillRoot 本身（SKILL/ 树内的 SKILL.md 主控、harness、rules 互相引用面），
 * 文件数超 MAX_SCAN_FILES 即停（返回当前计数）——树内规模天然小，截断只防失控。
 */
function countReferences(skillRoot: string, skillFile: string): number {
  const stem = basename(skillFile).replace(/\.md$/, '');
  const stemRe = new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  let count = 0;
  let scanned = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || scanned > MAX_SCAN_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (scanned > MAX_SCAN_FILES) return;
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.sofagent') continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.(md|ts|yml|json)$/.test(name)) {
        scanned++;
        try {
          const text = readFileSync(full, 'utf-8');
          const matches = text.match(stemRe);
          count += matches ? matches.length : 0;
        } catch {
          /* 为何可静默：不可读文件跳过——引用计数是低分阈值信号非精确值，单文件读失败不改变退役判定（MAX_SCAN_FILES 截断同族降级） */
        }
      }
    }
  };
  walk(skillRoot, 0);
  return count;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const daysSince = (isoOrMs: string | number): number => (Date.now() - new Date(isoOrMs).getTime()) / 86_400_000;

/** 计算单个技能的五维健康度 */
export function computeSkillHealth(
  skillRoot: string,
  skillFile: string,
  usage: SkillUsageRecord[],
  referenceCount?: number,
): SkillHealthDimensions {
  const stem = basename(skillFile).replace(/\.md$/, '');
  const full = join(skillRoot, skillFile);

  // ① 使用频率
  const myUsage = usage.filter((u) => u.skillId === stem);
  const usageScore = clamp01(myUsage.length / USAGE_SATURATION);

  // ② 最近使用（14 天内满分，线性衰减到 90 天 0 分）
  let recencyScore = 0;
  if (myUsage.length > 0) {
    const last = myUsage.map((u) => u.ts).sort().at(-1)!;
    const days = daysSince(last);
    recencyScore = clamp01(days <= 14 ? 1 : (90 - days) / 76);
  }

  // ③ 测试覆盖（宽判据：技能根树或技能根的仓内父树存在 `<stem>.test.ts`）
  let testScore = 0;
  const testProbe = full.replace(/\.md$/, '.test.ts');
  if (existsSync(testProbe)) {
    testScore = 1;
  } else {
    // 技能根树内扫描同名测试文件（测试与源同树是仓内惯例；MAX_SCAN_FILES 截断防失控）
    const stem2 = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scanRoot = skillRoot;
    const find = (dir: string, depth: number): boolean => {
      if (depth > 2) return false;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return false;
      }
      for (const name of entries) {
        if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
        const f = join(dir, name);
        let st;
        try {
          st = statSync(f);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (find(f, depth + 1)) return true;
        } else if (new RegExp(`^${stem2}\\.test\\.ts$`).test(name)) {
          return true;
        }
      }
      return false;
    };
    testScore = find(scanRoot, 0) ? 1 : 0;
  }

  // ④ 依赖引用
  const refs = referenceCount ?? countReferences(skillRoot, skillFile);
  const refScore = clamp01(refs / REFERENCE_SATURATION);

  // ⑤ 内容新鲜度（mtime 距今；≤7 天满分，> STALE_DAYS 0 分）
  let freshnessScore = 0;
  try {
    const days = daysSince(statSync(full).mtime.toISOString());
    freshnessScore = days <= 7 ? 1 : clamp01((STALE_DAYS - days) / (STALE_DAYS - 7));
  } catch {
    freshnessScore = 0;
  }

  return { usage: usageScore, recency: recencyScore, testCoverage: testScore, reference: refScore, freshness: freshnessScore };
}

/** 生成全量技能健康度报告（含退役候选判定 + 技术债台账落盘） */
export function generateHealthReport(opts?: {
  skillRoot?: string;
  skipDebtWrite?: boolean;
}): { skills: SkillHealthReport[]; retirementCandidates: SkillHealthReport[]; debtLedgerPath: string } {
  const skillRoot = resolveSkillRoot(opts?.skillRoot);
  const usage = readSkillUsage();
  const debt = readDebtLedger();
  const skills: SkillHealthReport[] = [];

  for (const file of listSkillFiles(skillRoot)) {
    const stem = basename(file).replace(/\.md$/, '');
    const dims = computeSkillHealth(skillRoot, file, usage);
    const score = (dims.usage + dims.recency + dims.testCoverage + dims.reference + dims.freshness) / 5;

    const reasons: string[] = [];
    const isCandidate =
      score < RETIREMENT_THRESHOLD && dims.usage < RETIREMENT_USAGE_FLOOR;
    if (isCandidate) {
      reasons.push(`总分 ${score.toFixed(2)} < 阈值 ${RETIREMENT_THRESHOLD}`);
      reasons.push(`使用频率 ${dims.usage.toFixed(2)} < ${RETIREMENT_USAGE_FLOOR}（低使用实锤）`);
    }

    // 技术债字段
    const prev = debt.get(stem);
    const debts = (Object.entries(dims) as Array<[keyof SkillHealthDimensions, number]>)
      .filter(([, v]) => v < 0.3)
      .map(([k]) => k);

    skills.push({
      skillPath: file,
      skillId: stem,
      dimensions: dims,
      score,
      retirementCandidate: isCandidate,
      reasons,
      lastVerifiedAt: prev?.lastVerifiedAt ?? null,
      currentScore: score,
      bestScore: Math.max(score, prev?.bestScore ?? 0),
      debts,
    });
  }

  // 技术债台账落盘（每次 report 重写全量——台账行数 = 技能数，规模可控）
  const debtPath = resolveSkillDebtPath();
  if (!opts?.skipDebtWrite) {
    mkdirSync(dirname(debtPath), { recursive: true });
    const lines = skills.map((s) =>
      JSON.stringify({
        skillId: s.skillId,
        ts: new Date().toISOString(),
        score: Number(s.score.toFixed(4)),
        bestScore: Number(s.bestScore.toFixed(4)),
        debts: s.debts,
      }),
    );
    writeFileSync(debtPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf-8');
  }

  return {
    skills: skills.sort((a, b) => a.score - b.score),
    retirementCandidates: skills.filter((s) => s.retirementCandidate),
    debtLedgerPath: debtPath,
  };
}

/** 退役归档：技能文件移入归档目录 + 台账登记（不物理删——可回滚） */
export function archiveSkill(skillFile: string, confirmedBy: string, opts?: { skillRoot?: string }): ArchiveLedgerEntry {
  const skillRoot = resolveSkillRoot(opts?.skillRoot);
  const originalPath = skillFile;
  const full = join(skillRoot, originalPath);
  if (!existsSync(full)) {
    throw new Error(`技能文件不存在：${originalPath}`);
  }

  const archiveDir = resolveSkillArchiveDir();
  mkdirSync(archiveDir, { recursive: true });
  const archivedAs = `${originalPath.replace(/[/\\]/g, '__')}`;
  const target = join(archiveDir, archivedAs);

  // 移动（读 + 写 + 删源——rename 跨设备时 fallback）
  const content = readFileSync(full, 'utf-8');
  writeFileSync(target, content, 'utf-8');
  const { rmSync } = require('fs') as typeof import('fs');
  rmSync(full);

  const entry: ArchiveLedgerEntry = {
    archivedAt: new Date().toISOString(),
    originalPath,
    archivedAs,
    scoreAtArchive: -1, // 调用方可事后回填（archiveSkillWithScore）
    confirmedBy,
    restoredAt: null,
  };
  appendFileSync(resolveArchiveLedgerPath(), JSON.stringify(entry) + '\n', 'utf-8');
  return entry;
}

/** 归档并记录归档时健康分（archiveSkill 的带分封装） */
export function archiveSkillWithScore(skillFile: string, score: number, confirmedBy: string, opts?: { skillRoot?: string }): ArchiveLedgerEntry {
  const entry = archiveSkill(skillFile, confirmedBy, opts);
  entry.scoreAtArchive = score;
  // 重写台账最后一行（append 后修正——台账行数小，全量重写安全）
  const ledgerPath = resolveArchiveLedgerPath();
  const lines = readFileSync(ledgerPath, 'utf-8').split('\n').filter((l) => l.trim());
  lines[lines.length - 1] = JSON.stringify(entry);
  writeFileSync(ledgerPath, lines.join('\n') + '\n', 'utf-8');
  return entry;
}

/** 回滚归档：按台账最近一条未回滚行恢复技能文件到原路径 */
export function restoreSkill(skillFile?: string, opts?: { skillRoot?: string }): ArchiveLedgerEntry {
  const ledgerPath = resolveArchiveLedgerPath();
  if (!existsSync(ledgerPath)) {
    throw new Error('归档台账不存在——无可回滚对象');
  }
  const lines = readFileSync(ledgerPath, 'utf-8').split('\n').filter((l) => l.trim());
  const entries = lines.map((l) => JSON.parse(l) as ArchiveLedgerEntry);

  // 目标行：指定了 skillFile 取该技能最近未回滚行；否则取全局最近未回滚行
  const candidates = entries.filter((e) => e.restoredAt === null && (skillFile === undefined || e.originalPath === skillFile));
  const target = candidates.at(-1);
  if (!target) {
    throw new Error(skillFile ? `技能 ${skillFile} 无未回滚的归档行` : '台账中无未回滚的归档行');
  }

  const skillRoot = resolveSkillRoot(opts?.skillRoot);
  const archiveDir = resolveSkillArchiveDir();
  const archivedFull = join(archiveDir, target.archivedAs);
  if (!existsSync(archivedFull)) {
    throw new Error(`归档文件缺失：${archivedFull}`);
  }
  const dest = join(skillRoot, target.originalPath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(archivedFull, 'utf-8'), 'utf-8');
  const { rmSync } = require('fs') as typeof import('fs');
  rmSync(archivedFull);

  // 台账标回滚
  target.restoredAt = new Date().toISOString();
  const idx = entries.findIndex((e) => e === target);
  lines[idx] = JSON.stringify(target);
  writeFileSync(ledgerPath, lines.join('\n') + '\n', 'utf-8');
  return target;
}

/** report 渲染为终端文本（CLI 消费） */
export function renderHealthReport(report: ReturnType<typeof generateHealthReport>): string {
  const lines: string[] = [];
  lines.push(`技能健康度报告（${report.skills.length} 个技能 · 退役候选 ${report.retirementCandidates.length} 个）`);
  lines.push('');
  lines.push('技能'.padEnd(28) + '总分    使用   最近   测试   引用   新鲜   候选');
  for (const s of report.skills) {
    const d = s.dimensions;
    lines.push(
      s.skillPath.padEnd(30) +
        s.score.toFixed(2).padEnd(6) +
        '  ' +
        d.usage.toFixed(2).padEnd(5) +
        '  ' +
        d.recency.toFixed(2).padEnd(5) +
        '  ' +
        d.testCoverage.toFixed(2).padEnd(5) +
        '  ' +
        d.reference.toFixed(2).padEnd(5) +
        '  ' +
        d.freshness.toFixed(2).padEnd(5) +
        '  ' +
        (s.retirementCandidate ? '⚠️ 退役候选' : ''),
    );
  }
  if (report.retirementCandidates.length > 0) {
    lines.push('');
    lines.push('退役候选（人工确认制——不自动删；确认后 evolve skill-health archive <path>）:');
    for (const c of report.retirementCandidates) {
      lines.push(`  ⚠️ ${c.skillPath}（${c.reasons.join('；')}）`);
    }
  }
  lines.push('');
  lines.push(`技术债台账: ${report.debtLedgerPath}（上次验证/当前分/历史最优/待还债维度）`);
  return lines.join('\n');
}
