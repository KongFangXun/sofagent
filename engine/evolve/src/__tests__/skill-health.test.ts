// ============================================================
// skill-health.test.ts · 五维技能健康度测试（v1.5.7 章四）
// 覆盖：五维计算（各维正反例）/ 阈值判定 / 退役候选生成 /
// 归档可回滚（archive → restore 全流程）/ 技术债台账落盘
// 隔离纪律：SOFAGENT_DATA 指向临时目录（不触真实 ~/.sofagent/data）
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  recordSkillUsage,
  readSkillUsage,
  generateHealthReport,
  renderHealthReport,
  computeSkillHealth,
  archiveSkillWithScore,
  restoreSkill,
  resolveSkillDebtPath,
  resolveSkillUsagePath,
  resolveArchiveLedgerPath,
  USAGE_SATURATION,
  RETIREMENT_THRESHOLD,
  RETIREMENT_USAGE_FLOOR,
} from '../skill-health';

let dataDir: string;
let skillRoot: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'skill-health-data-'));
  skillRoot = mkdtempSync(join(tmpdir(), 'skill-health-skills-'));
  process.env.SOFAGENT_DATA = dataDir;
});

afterAll(() => {
  delete process.env.SOFAGENT_DATA;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(skillRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // 每测重置使用台账（skill-usage / skill-debt / archive）
  rmSync(join(dataDir, 'evolve'), { recursive: true, force: true });
});

/** 造一个技能文件（mtime 可指定） */
function makeSkill(name: string, daysAgo = 1): string {
  const p = join(skillRoot, name);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, `# ${name}\n技能内容\n`, 'utf-8');
  const t = new Date(Date.now() - daysAgo * 86_400_000);
  utimesSync(p, t, t);
  return name;
}

describe('五维计算 · computeSkillHealth', () => {
  it('① 使用频率：饱和次数 → 1.0；零使用 → 0', () => {
    makeSkill('a.md');
    const usage = Array.from({ length: USAGE_SATURATION }, (_, i) => ({
      ts: new Date().toISOString(),
      skillId: 'a',
      source: 'test',
    }));
    const d = computeSkillHealth(skillRoot, 'a.md', usage, 0);
    expect(d.usage).toBe(1);

    const d0 = computeSkillHealth(skillRoot, 'a.md', [], 0);
    expect(d0.usage).toBe(0);
  });

  it('② 最近使用：14 天内 → 1.0；无记录 → 0', () => {
    makeSkill('b.md');
    const recent = [{ ts: new Date(Date.now() - 86_400_000).toISOString(), skillId: 'b', source: 'test' }];
    const d = computeSkillHealth(skillRoot, 'b.md', recent, 0);
    expect(d.recency).toBe(1);

    const d0 = computeSkillHealth(skillRoot, 'b.md', [], 0);
    expect(d0.recency).toBe(0);
  });

  it('③ 测试覆盖：同名 .test.ts 存在 → 1', () => {
    makeSkill('c.md');
    writeFileSync(join(skillRoot, 'c.test.ts'), 'export {};', 'utf-8');
    const d = computeSkillHealth(skillRoot, 'c.md', [], 0);
    expect(d.testCoverage).toBe(1);
  });

  it('④ 依赖引用：注入引用计数 → 归一 0-1', () => {
    makeSkill('d.md');
    const d = computeSkillHealth(skillRoot, 'd.md', [], 5);
    expect(d.reference).toBe(1);
    const d2 = computeSkillHealth(skillRoot, 'd.md', [], 0);
    expect(d2.reference).toBe(0);
  });

  it('⑤ 内容新鲜度：mtime 1 天内 → 接近 1；极旧 → 0', () => {
    makeSkill('fresh.md', 1);
    makeSkill('stale.md', 365);
    const df = computeSkillHealth(skillRoot, 'fresh.md', [], 0);
    const ds = computeSkillHealth(skillRoot, 'stale.md', [], 0);
    expect(df.freshness).toBeGreaterThan(0.4);
    expect(ds.freshness).toBe(0);
  });
});

describe('阈值判定 + 退役候选', () => {
  it('低分低使用 → 退役候选（带理由）；健康技能不进候选', () => {
    makeSkill('zombie.md', 365); // 旧 + 无使用 + 无引用
    makeSkill('hot.md', 1);
    recordSkillUsage('hot', 'test');

    const report = generateHealthReport({ skillRoot });
    const zombie = report.skills.find((s) => s.skillId === 'zombie')!;
    expect(zombie.retirementCandidate).toBe(true);
    expect(zombie.reasons.length).toBeGreaterThanOrEqual(2);

    const hot = report.skills.find((s) => s.skillId === 'hot')!;
    expect(hot.retirementCandidate).toBe(false);
    expect(hot.reasons).toEqual([]);
  });

  it('退役候选须同时满足总分 < 阈值 且 usage < 地板（防误判）', () => {
    makeSkill('refs-only.md', 30);
    const report = generateHealthReport({ skillRoot });
    const s = report.skills.find((x) => x.skillId === 'refs-only')!;
    // 总分低但 usage=0 < 地板 → 仍候选（零使用是硬条件）
    if (s.score < RETIREMENT_THRESHOLD) {
      expect(s.retirementCandidate).toBe(s.dimensions.usage < RETIREMENT_USAGE_FLOOR);
    }
    expect(RETIREMENT_THRESHOLD).toBe(0.35);
    expect(RETIREMENT_USAGE_FLOOR).toBe(0.15);
  });

  it('report 按总分升序 + retirementCandidates 子清单', () => {
    makeSkill('s1.md', 100);
    makeSkill('s2.md', 1);
    recordSkillUsage('s2', 'test');
    const report = generateHealthReport({ skillRoot });
    const scores = report.skills.map((s) => s.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(report.retirementCandidates.every((c) => c.retirementCandidate)).toBe(true);
  });

  it('渲染输出含表头与候选提示', () => {
    makeSkill('r.md', 200);
    const text = renderHealthReport(generateHealthReport({ skillRoot }));
    expect(text).toContain('技能健康度报告');
    expect(text).toContain('总分');
    expect(text).toContain('退役候选');
    expect(text).toContain('人工确认制');
  });
});

describe('技术债台账落盘', () => {
  it('report 后 skill-debt.jsonl 落盘且含 四字段', () => {
    makeSkill('debt.md', 10);
    const report = generateHealthReport({ skillRoot });
    expect(existsSync(report.debtLedgerPath)).toBe(true);
    expect(report.debtLedgerPath).toBe(resolveSkillDebtPath());

    const line = JSON.parse(readFileSync(report.debtLedgerPath, 'utf-8').split('\n')[0]!);
    expect(line).toHaveProperty('skillId');
    expect(line).toHaveProperty('ts'); // 上次验证时间
    expect(line).toHaveProperty('score'); // 当前分数
    expect(line).toHaveProperty('bestScore'); // 历史最优
    expect(line).toHaveProperty('debts'); // 待还债清单
  });

  it('bestScore 跨批次单调不降（历史最优保留）', () => {
    makeSkill('best.md', 1);
    recordSkillUsage('best', 'test');
    generateHealthReport({ skillRoot }); // 第一批：高分
    const r1 = JSON.parse(
      readFileSync(resolveSkillDebtPath(), 'utf-8')
        .split('\n')
        .find((l: string) => l.includes('"best"'))!,
    );
    // 第二批（无使用——分数更低）：bestScore 不降
    rmSync(join(dataDir, 'evolve', 'skill-usage.jsonl'), { force: true });
    generateHealthReport({ skillRoot });
    const r2 = JSON.parse(
      readFileSync(resolveSkillDebtPath(), 'utf-8')
        .split('\n')
        .find((l: string) => l.includes('"best"'))!,
    );
    expect(r2.bestScore).toBeGreaterThanOrEqual(r1.score);
  });
});

describe('归档可回滚（archive → restore 全流程）', () => {
  it('archive 移入归档目录 + 台账登记；restore 恢复原路径且台账标记回滚', () => {
    makeSkill('retire-me.md', 300);
    const contentBefore = readFileSync(join(skillRoot, 'retire-me.md'), 'utf-8');

    // 归档
    const entry = archiveSkillWithScore('retire-me.md', 0.12, 'tester', { skillRoot });
    expect(entry.originalPath).toBe('retire-me.md');
    expect(entry.scoreAtArchive).toBe(0.12);
    expect(entry.confirmedBy).toBe('tester');
    expect(entry.restoredAt).toBeNull();
    expect(existsSync(join(skillRoot, 'retire-me.md'))).toBe(false); // 原位已移除
    expect(existsSync(resolveArchiveLedgerPath())).toBe(true);

    // 回滚
    const restored = restoreSkill('retire-me.md', { skillRoot });
    expect(restored.originalPath).toBe('retire-me.md');
    expect(restored.restoredAt).not.toBeNull();
    expect(existsSync(join(skillRoot, 'retire-me.md'))).toBe(true); // 原位恢复
    expect(readFileSync(join(skillRoot, 'retire-me.md'), 'utf-8')).toBe(contentBefore); // 内容逐字节一致
  });

  it('重复 restore 已回滚条目 → 报错（无未回滚行）', () => {
    makeSkill('once.md', 300);
    archiveSkillWithScore('once.md', 0.1, 'tester', { skillRoot });
    restoreSkill('once.md', { skillRoot });
    expect(() => restoreSkill('once.md', { skillRoot })).toThrow(/无未回滚的归档行/);
  });

  it('archive 不存在的技能 → 报错', () => {
    expect(() => archiveSkillWithScore('ghost.md', 0, 'tester', { skillRoot })).toThrow(/不存在/);
  });

  it('无归档台账时 restore → 报错', () => {
    expect(() => restoreSkill(undefined, { skillRoot })).toThrow(/台账不存在/);
  });
});

describe('使用台账 recordSkillUsage', () => {
  it('追加一行且可读回（skillId + ts + source 三字段）', () => {
    recordSkillUsage('rec', 'cli');
    const records = readSkillUsage();
    expect(records.length).toBe(1);
    expect(records[0]!.skillId).toBe('rec');
    expect(records[0]!.source).toBe('cli');
    expect(records[0]!.ts).toBeTruthy();
    expect(existsSync(resolveSkillUsagePath())).toBe(true);
  });
});
