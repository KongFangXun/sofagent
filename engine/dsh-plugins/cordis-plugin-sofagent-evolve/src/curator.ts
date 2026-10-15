// ============================================================
// curator.ts · 策展快照与软删除（技能树 curator · v1.6.0 章七）
// ============================================================
//
// ── 这一件解决什么 —— 技能销毁永远不是硬删 ──
// 进化面会有 curator（合并近重复 / 归档停用项）这类「做减法」的动作。做减法最容易
// 出的错是**不可逆**：一次误判把技能删了，连「当时它长什么样」都答不出。本节给
// curator 定两条铁律：
//
//   ① **运行前先打快照** —— 每次 curator 运行前，对整棵技能树复制一份内容寻址
//      快照（name + sha256），落 `<stateDir>/skill-snapshots/<snapshotId>/`；
//      快照 id 进留痕，事后可回答「归档前的技能树是什么样」。
//   ② **归档而非物理删** —— 停用 / 近重复项 `rename` 进 `<skillRoot>/.archive/<id>/`，
//      源目录里消失但**文件本体不丢**；技能销毁永远不是硬删（与 v1.5.7 退役纪律
//      「归档优先于物理删」同族，补的是进化面自己的实例）。
//
// ── 留痕 ──
// 每次 curator 运行落一条 `<archiveDir>/curator-trace.jsonl`（追加）：快照 id +
// 每条归档动作（原落点 → 归档落点 + 原因 + sha256）。快照与归档动作都可审计。
//
// ── 判定口径 ──
//   · 停用项：Markdown frontmatter 里 `status: disabled|retired|deprecated|停用`
//     或 `disabled: true`（大小写不敏感）。
//   · 近重复：内容归一化（折叠空白 / 去 BOM）后 sha256 相同 —— 归一化后的相等
//     即「近重复」的可判定代理；同一组保留字典序最前的那个，其余归档。
// 两处判定都是**纯路径+内容**判据，不联网、不调模型、不依赖引擎包。
// ============================================================

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';

/** 参与策展的技能文件扩展（技能树规范资产全是 Markdown） */
const SKILL_EXT = '.md';
/** 归档目录名（相对 skillRoot；隐藏目录，不参与自身扫描） */
export const ARCHIVE_DIR_NAME = '.archive';
/** 快照清单文件名 */
const SNAPSHOT_MANIFEST = 'snapshot-manifest.json';
/** 留痕文件名 */
const TRACE_FILE = 'curator-trace.jsonl';

/** 快照中的单文件条目 */
export interface SkillSnapshotEntry {
  /** 相对 skillRoot 的路径（POSIX 分隔） */
  rel: string;
  /** 归一化内容 sha256（前 16 位——内容寻址锚点） */
  sha256: string;
  /** 原始文件字节数 */
  size: number;
}

/** 技能树快照 */
export interface SkillTreeSnapshot {
  id: string;
  takenAt: string;
  skillRoot: string;
  snapshotDir: string;
  files: SkillSnapshotEntry[];
}

/** 单条归档动作 */
export interface CuratorArchiveAction {
  /** 归档原因：'disabled'（停用项） / 'near-duplicate'（近重复，保留者见 keptRel） */
  reason: 'disabled' | 'near-duplicate';
  /** 原落点（相对 skillRoot） */
  rel: string;
  /** 归档落点（绝对路径） */
  archivedTo: string;
  /** 近重复时被保留的兄弟落点 */
  keptRel?: string;
  /** 内容 sha256（前 16 位） */
  sha256: string;
}

/** 一次 curator 运行结果 */
export interface CuratorRunResult {
  snapshot: SkillTreeSnapshot;
  archived: CuratorArchiveAction[];
  /** 留痕文件绝对路径 */
  tracePath: string;
  /** 扫描到的技能文件数 */
  scanned: number;
}

/** runCurator / snapshotSkillTree 选项 */
export interface CuratorOptions {
  /** 快照根目录（缺省 `<stateDir>/skill-snapshots`；stateDir 缺省 = skillRoot 的同级 `.curator-state`） */
  stateDir?: string;
  /** 归档根目录（缺省 `<skillRoot>/.archive`） */
  archiveDir?: string;
  /** 快照 id 注入（测试用；缺省按时间戳生成） */
  snapshotId?: string;
  /** 当前时间注入（测试用；缺省 new Date().toISOString()） */
  nowIso?: string;
}

/** 归一化内容（去 BOM、CRLF→LF、折叠空白）——「近重复」判据的内容面 */
function normalizeContent(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

/** 归一化内容 sha256（前 16 位） */
function hashOf(raw: string): string {
  return createHash('sha256').update(normalizeContent(raw)).digest('hex').slice(0, 16);
}

/** 递归收集技能树下的 .md 文件（相对路径字典序；跳过隐藏目录 / node_modules——
 *  快照与归档落在隐藏目录下，天然与技能树扫描面隔离，幂等不重复自扫） */
export function collectSkillMarkdown(skillRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith(SKILL_EXT)) {
        out.push(relative(skillRoot, full).split('\\').join('/'));
      }
    }
  };
  if (!existsSync(skillRoot)) return out;
  walk(skillRoot);
  return out.sort();
}

/** 是否停用项（frontmatter `status: disabled…` 或 `disabled: true`） */
export function isDisabledSkill(raw: string): boolean {
  const head = raw.slice(0, 2000);
  const fm = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = fm ? fm[1] : head;
  if (/^\s*disabled\s*:\s*true\s*$/im.test(body)) return true;
  return /^\s*status\s*:\s*(disabled|retired|deprecated|停用|已停用)\s*$/im.test(body);
}

/**
 * 对技能树打快照（curator 运行前调用）。
 *
 * 内容寻址：逐文件复制到 `<stateDir>/skill-snapshots/<id>/`（保相对路径），
 * 并把清单（rel + sha256 + size）落 `snapshot-manifest.json`。快照**不参与**自身扫描
 * （写在自己的 stateDir 下，与 skillRoot 分离时天然隔离；同根时 `.archive` 被跳过）。
 */
export function snapshotSkillTree(skillRoot: string, opts: CuratorOptions = {}): SkillTreeSnapshot {
  const takenAt = opts.nowIso ?? new Date().toISOString();
  const id = opts.snapshotId ?? `snap-${takenAt.replace(/[:.]/g, '-')}`;
  const stateDir = opts.stateDir ?? join(dirname(skillRoot.replace(/\/+$/, '')), '.curator-state');
  const snapshotDir = join(stateDir, 'skill-snapshots', id);
  mkdirSync(snapshotDir, { recursive: true });

  const files: SkillSnapshotEntry[] = [];
  for (const rel of collectSkillMarkdown(skillRoot)) {
    const raw = readFileSync(join(skillRoot, rel), 'utf8');
    const dest = join(snapshotDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, raw, 'utf8');
    files.push({ rel, sha256: hashOf(raw), size: Buffer.byteLength(raw, 'utf8') });
  }

  writeFileSync(
    join(snapshotDir, SNAPSHOT_MANIFEST),
    `${JSON.stringify({ id, takenAt, skillRoot, files }, null, 2)}\n`,
    'utf8',
  );

  return { id, takenAt, skillRoot, snapshotDir, files };
}

/**
 * 归档单个技能项——`rename` 进 `<archiveDir>/<snapshotId>/<rel>`（**移入，不物理删**）。
 *
 * @returns 归档落点的绝对路径；源文件不存在时返回 null（幂等，不抛）
 */
export function archiveSkillItem(
  skillRoot: string,
  rel: string,
  snapshotId: string,
  opts: CuratorOptions = {},
): string | null {
  const src = join(skillRoot, rel);
  if (!existsSync(src)) return null;
  const archiveDir = opts.archiveDir ?? join(skillRoot, ARCHIVE_DIR_NAME);
  const dest = join(archiveDir, snapshotId, rel);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);
  return dest;
}

/** 追加一条留痕（JSONL） */
function appendTrace(tracePath: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(tracePath), { recursive: true });
  writeFileSync(tracePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
}

/**
 * 运行一次 curator：**先打快照，再做减法**（停用项 + 近重复项归档进 `.archive/`）。
 *
 * 顺序不可交换：快照必须发生在任何归档**之前**——否则「归档前的技能树」答不出。
 *
 * @returns 运行结果（快照 + 归档动作清单 + 留痕路径 + 扫描数）
 */
export function runCurator(skillRoot: string, opts: CuratorOptions = {}): CuratorRunResult {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const archiveDir = opts.archiveDir ?? join(skillRoot, ARCHIVE_DIR_NAME);

  // ① 先打快照（任何归档动作之前）
  const snapshot = snapshotSkillTree(skillRoot, { ...opts, nowIso });
  const tracePath = join(archiveDir, TRACE_FILE);

  const archived: CuratorArchiveAction[] = [];
  const rels = collectSkillMarkdown(skillRoot);

  // ② 判停用项 + 近重复（扫描期只读，不改树——避免边扫边动导致漏扫）
  const seenHash = new Map<string, string>(); // sha256 → 首次出现的 rel
  const toArchive: Array<Omit<CuratorArchiveAction, 'archivedTo'>> = [];
  for (const rel of rels) {
    const raw = readFileSync(join(skillRoot, rel), 'utf8');
    const sha = hashOf(raw);
    if (isDisabledSkill(raw)) {
      toArchive.push({ reason: 'disabled', rel, sha256: sha });
      continue;
    }
    const kept = seenHash.get(sha);
    if (kept !== undefined) {
      toArchive.push({ reason: 'near-duplicate', rel, keptRel: kept, sha256: sha });
    } else {
      seenHash.set(sha, rel);
    }
  }

  // ③ 归档（移入 .archive/，非物理删）
  for (const action of toArchive) {
    const archivedTo = archiveSkillItem(skillRoot, action.rel, snapshot.id, { archiveDir });
    if (archivedTo === null) continue; // 扫描后被外部移除——幂等跳过
    const full: CuratorArchiveAction = { ...action, archivedTo };
    archived.push(full);
    appendTrace(tracePath, {
      ts: nowIso,
      action: 'archive',
      snapshotId: snapshot.id,
      reason: full.reason,
      rel: full.rel,
      archivedTo,
      ...(full.keptRel !== undefined ? { keptRel: full.keptRel } : {}),
      sha256: full.sha256,
    });
  }

  // ④ 运行总结留痕（快照 + 归档计数——「跑了没、跑了什么」可审计）
  appendTrace(tracePath, {
    ts: nowIso,
    action: 'curator-run',
    snapshotId: snapshot.id,
    snapshotDir: snapshot.snapshotDir,
    scanned: rels.length,
    archived: archived.length,
    archiveDir,
  });

  return { snapshot, archived, tracePath, scanned: rels.length };
}

/**
 * 读留痕（审计面——快照与归档动作的历史）。
 * 坏行跳过并计数（不抛），返回 { records, badLines }。
 */
export function loadCuratorTrace(
  skillRoot: string,
  opts: CuratorOptions = {},
): { records: Array<Record<string, unknown>>; badLines: number } {
  const archiveDir = opts.archiveDir ?? join(skillRoot, ARCHIVE_DIR_NAME);
  const tracePath = join(archiveDir, TRACE_FILE);
  const records: Array<Record<string, unknown>> = [];
  let badLines = 0;
  if (!existsSync(tracePath)) return { records, badLines };
  for (const line of readFileSync(tracePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    try {
      records.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      badLines++;
    }
  }
  return { records, badLines };
}

/** 快照文件是否仍与原文件一致（软删除不变量：归档后原文件应从源目录消失，但快照与归档各留一份） */
export function snapshotContains(snapshot: SkillTreeSnapshot, rel: string): boolean {
  return snapshot.files.some((f) => f.rel === rel);
}

/** 路径是否存在且为文件（测试与验收断言用） */
export function isFile(p: string): boolean {
  return existsSync(p) && statSync(p).isFile();
}
