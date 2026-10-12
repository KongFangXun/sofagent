// ============================================================
// curator.test.ts · 策展快照与软删除单测（v1.5.9 章七）
// ============================================================
// 断言面：
//   ① curator 运行前先打快照（快照含归档前全部文件 + 清单落盘）
//   ② 停用项 → 归档进 `.archive/<snapshotId>/`，源目录消失
//   ③ 近重复 → 归档；保留者（字典序最前）仍在源目录
//   ④ 永远不硬删：归档件内容与快照副本逐字节保留（技能销毁非硬删）
//   ⑤ 快照与归档动作留痕（curator-trace.jsonl：archive 条 + curator-run 条）
//   ⑥ 幂等：对已归档项重跑不再产生归档动作
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  runCurator,
  snapshotSkillTree,
  collectSkillMarkdown,
  isDisabledSkill,
  loadCuratorTrace,
  ARCHIVE_DIR_NAME,
} from './curator';

let root: string;
const write = (rel: string, content: string): void => {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'curator-test-'));
  write('skills/active-a.md', '# A\n\n正常技能内容\n');
  write('skills/active-b.md', '# B\n\n另一个正常技能内容\n');
  write('skills/dup-1.md', '# Dup\n\n内容完全一致\n');
  write('skills/dup-2.md', '# Dup\n\n内容完全一致\n');
  write('skills/retired.md', '---\nname: retired\nstatus: retired\n---\n# 已停用\n');
  write('sub/disabled-flag.md', '---\ndisabled: true\n---\n# 停用二\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('curator · 快照先于归档', () => {
  it('运行前对技能树打快照，快照含归档前全部 md 文件', () => {
    const before = collectSkillMarkdown(root);
    const snap = snapshotSkillTree(root, { stateDir: join(root, '.state'), snapshotId: 'snap-fixed' });
    expect(snap.files.map((f) => f.rel).sort()).toEqual(before.sort());
    expect(existsSync(join(snap.snapshotDir, 'snapshot-manifest.json'))).toBe(true);
    // 快照目录里每个文件都在
    for (const f of snap.files) {
      expect(existsSync(join(snap.snapshotDir, f.rel))).toBe(true);
    }
  });

  it('runCurator 的快照包含两条将被归档的项（快照发生在归档之前）', () => {
    const res = runCurator(root, { stateDir: join(root, '.state'), snapshotId: 'snap-run' });
    const snapRels = res.snapshot.files.map((f) => f.rel);
    expect(snapRels).toContain('skills/dup-2.md');
    expect(snapRels).toContain('skills/retired.md');
    expect(snapRels).toContain('sub/disabled-flag.md');
  });
});

describe('curator · 软删除（归档非物理删）', () => {
  it('停用项归档进 .archive/，源目录消失但归档件与快照各留一份', () => {
    const res = runCurator(root, { stateDir: join(root, '.state'), snapshotId: 'snap-1' });
    // 停用项已从源目录消失
    expect(existsSync(join(root, 'skills/retired.md'))).toBe(false);
    expect(existsSync(join(root, 'sub/disabled-flag.md'))).toBe(false);
    // 归档落点存在（内容逐字节保留——非硬删）
    const archived = res.archived.filter((a) => a.reason === 'disabled');
    expect(archived.map((a) => a.rel).sort()).toEqual(['skills/retired.md', 'sub/disabled-flag.md']);
    for (const a of archived) {
      expect(a.archivedTo).toContain(ARCHIVE_DIR_NAME);
      expect(a.archivedTo).toContain('snap-1');
      expect(existsSync(a.archivedTo)).toBe(true);
      expect(readFileSync(a.archivedTo, 'utf8').length).toBeGreaterThan(0);
    }
    // 快照副本仍在（第三份保全）
    expect(existsSync(join(res.snapshot.snapshotDir, 'skills/retired.md'))).toBe(true);
  });

  it('近重复归档，保留者留在源目录', () => {
    const res = runCurator(root, { stateDir: join(root, '.state'), snapshotId: 'snap-2' });
    const dup = res.archived.find((a) => a.rel === 'skills/dup-2.md');
    expect(dup?.reason).toBe('near-duplicate');
    expect(dup?.keptRel).toBe('skills/dup-1.md');
    expect(existsSync(join(root, 'skills/dup-1.md'))).toBe(true); // 保留者仍在
    expect(existsSync(join(root, 'skills/dup-2.md'))).toBe(false); // 重复项移走
    expect(existsSync(join(root, 'skills/active-a.md'))).toBe(true);
    expect(existsSync(join(root, 'skills/active-b.md'))).toBe(true);
  });

  it('不变量：任何被归档项，其内容在归档件中逐字节保留', () => {
    const originals = new Map<string, string>();
    for (const rel of collectSkillMarkdown(root)) {
      originals.set(rel, readFileSync(join(root, rel), 'utf8'));
    }
    const res = runCurator(root, { stateDir: join(root, '.state'), snapshotId: 'snap-3' });
    for (const a of res.archived) {
      expect(readFileSync(a.archivedTo, 'utf8')).toBe(originals.get(a.rel));
    }
  });
});

describe('curator · 留痕与幂等', () => {
  it('快照与归档动作留痕（archive 条 + curator-run 条）', () => {
    const res = runCurator(root, { stateDir: join(root, '.state'), snapshotId: 'snap-trace' });
    const { records, badLines } = loadCuratorTrace(root);
    expect(badLines).toBe(0);
    const archiveRecs = records.filter((r) => r.action === 'archive');
    const runRecs = records.filter((r) => r.action === 'curator-run');
    expect(archiveRecs.length).toBe(res.archived.length);
    for (const r of archiveRecs) {
      expect(r.snapshotId).toBe('snap-trace');
      expect(typeof r.archivedTo).toBe('string');
    }
    expect(runRecs.length).toBe(1);
    expect(runRecs[0].snapshotId).toBe('snap-trace');
    expect(runRecs[0].scanned).toBe(res.scanned);
  });

  it('幂等：对已策展过的树重跑不再产生归档动作', () => {
    runCurator(root, { stateDir: join(root, '.state'), snapshotId: 'snap-a' });
    const second = runCurator(root, { stateDir: join(root, '.state'), snapshotId: 'snap-b' });
    expect(second.archived.length).toBe(0);
  });

  it('isDisabledSkill 只认 frontmatter 停用标记（普通技能不误判）', () => {
    expect(isDisabledSkill('---\nstatus: disabled\n---\n# x')).toBe(true);
    expect(isDisabledSkill('---\ndisabled: true\n---\n# x')).toBe(true);
    expect(isDisabledSkill('# 正常技能\nstatus: active 之说在正文不算')).toBe(false);
  });
});
