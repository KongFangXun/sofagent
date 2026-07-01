// ============================================================
// orchestrate-compare.test.ts · 编排方案 A/B 对比测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanLogFiles, extractMetrics, generateReport, promoteWorkflow } from '../src/orchestrate-compare';
import type { Metric } from '../src/orchestrate-compare';

describe('orchestrate-compare', () => {
  let tmp: string;

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'oc-')); });
  afterEach(() => { if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true }); });

  /** Create a mock log directory with YYYY-MM/subdir/file.md structure. */
  function makeLogs(files: Record<string, string>): string {
    const dir = join(tmp, 'logs');
    mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content, 'utf-8');
    }
    return dir;
  }

  describe('scanLogFiles', () => {
    it('returns empty for nonexistent dir', () => {
      expect(scanLogFiles(join(tmp, 'noexist'))).toEqual([]);
    });

    it('returns empty for dir with no .md files', () => {
      const d = join(tmp, 'empty');
      mkdirSync(d);
      writeFileSync(join(d, 'notes.txt'), 'hello');
      expect(scanLogFiles(d)).toEqual([]);
    });

    it('collects .md files from YYYY-MM subdirectories', () => {
      const d = makeLogs({
        '2026-07/a.md': '# A\nStep 1 ✅',
        '2026-07/b.md': '# B\nStep 2 🔴',
        '2026-08/c.md': '# C\nFAIL',
      });
      const files = scanLogFiles(d);
      expect(files).toHaveLength(3);
      expect(files.every((f) => f.endsWith('.md'))).toBe(true);
    });

    it('skips non-YMD files at root level', () => {
      const d = join(tmp, 'flat');
      mkdirSync(d);
      // Direct .md file at root (should be skipped—only subdirs are scanned)
      writeFileSync(join(d, 'root.md'), 'root');
      // Non-directory entries are ignored
      expect(scanLogFiles(d)).toEqual([]);
    });
  });

  describe('extractMetrics', () => {
    it('all zeros for empty directory', () => {
      const d = join(tmp, 'empty');
      mkdirSync(d);
      const m = extractMetrics(d);
      expect(m.runCount).toBe(0);
      expect(m.auditViolations).toBe(0);
      expect(m.avgSteps).toBe(0);
      expect(m.firstPassRate).toBe(0);
    });

    it('counts FAIL, Step N, ✅, 🔴 correctly', () => {
      const d = makeLogs({
        '2026-07/a.md': 'Step 1 ✅ Step 2 ✅ Step 3 ✅',
        '2026-07/b.md': 'Step 1 ✅ Step 2 🔴 FAIL',
      });
      const m = extractMetrics(d);
      expect(m.runCount).toBe(2);
      expect(m.auditViolations).toBe(1);
      expect(m.avgSteps).toBe(2.5);
      expect(m.firstPassRate).toBe(80); // 4✅ vs 1🔴 = 80%
    });

    it('100% first-pass when no 🔴', () => {
      const d = makeLogs({ '2026-07/ok.md': 'Step 1 ✅ Step 2 ✅' });
      const m = extractMetrics(d);
      expect(m.firstPassRate).toBe(100);
    });

    it('0% first-pass when no emoji', () => {
      const d = makeLogs({ '2026-07/neutral.md': 'Step 1 Step 2 no checkmarks' });
      const m = extractMetrics(d);
      expect(m.firstPassRate).toBe(0);
    });

    it('skips directory entries (graceful error handling)', () => {
      const d = makeLogs({ '2026-07/valid.md': 'Step 1 ✅ FAIL' });
      // Create a directory that collides with a filename — scan picks .md files,
      // statSync on a dir won't produce isDirectory=false, so it's safely skipped.
      // Actually readFileSync on a directory throws — we test that it's caught.
      mkdirSync(join(d, '2026-07', 'bad.md'));
      const m = extractMetrics(d);
      expect(m.runCount).toBe(1);
    });
  });

  describe('generateReport', () => {
    const curr: Metric = { runCount: 12, auditViolations: 3, avgSteps: 5.2, firstPassRate: 75 };
    const cand: Metric = { runCount: 8, auditViolations: 1, avgSteps: 4.1, firstPassRate: 88 };

    it('generates full report with candidate winning all', () => {
      const r = generateReport(curr, cand, '2026-07-01');
      expect(r).toContain('# Orchestration A/B Comparison — 2026-07-01');
      expect(r).toContain('| Runs | 12 | 8 | — |');
      expect(r).toContain('| Audit violations | 3 | 1 | Candidate |');
      expect(r).toContain('| Avg steps | 5.2 | 4.1 | Candidate |');
      expect(r).toContain('| First-pass rate | 75% | 88% | Candidate |');
      expect(r).toContain('wins on 3/3 metrics');
      expect(r).toContain('`sofagent-orchestrate-compare promote`');
      expect(r).toContain('**Confidence**: low');
    });

    it('handles perfect tie', () => {
      const m: Metric = { runCount: 10, auditViolations: 2, avgSteps: 5, firstPassRate: 80 };
      const r = generateReport(m, m, '2026-07-01');
      expect(r).toContain('Result**: Tie');
      expect(r).toContain('manual review needed');
    });

    it('current wins → keep current scheme', () => {
      const c: Metric = { runCount: 10, auditViolations: 0, avgSteps: 3, firstPassRate: 90 };
      const bad: Metric = { runCount: 10, auditViolations: 5, avgSteps: 7, firstPassRate: 50 };
      const r = generateReport(c, bad, '2026-07-01');
      expect(r).toContain('Result**: Current');
      expect(r).toContain('keep current scheme');
    });

    it('medium confidence at 15 runs', () => {
      const m: Metric = { runCount: 15, auditViolations: 0, avgSteps: 3, firstPassRate: 90 };
      expect(generateReport(m, m, 'x')).toContain('**Confidence**: medium');
    });

    it('high confidence at 30 runs', () => {
      const m: Metric = { runCount: 30, auditViolations: 0, avgSteps: 3, firstPassRate: 90 };
      expect(generateReport(m, m, 'x')).toContain('**Confidence**: high');
    });

    it('notes when run counts differ', () => {
      const a: Metric = { runCount: 20, auditViolations: 1, avgSteps: 3, firstPassRate: 90 };
      const b: Metric = { runCount: 10, auditViolations: 1, avgSteps: 3, firstPassRate: 90 };
      const r = generateReport(a, b, 'x');
      expect(r).toContain('candidate has fewer runs: 10 vs 20');
    });
  });

  describe('promoteWorkflow', () => {
    it('promotes candidate workflow.yaml to current/', () => {
      const orch = join(tmp, 'orchestrator');
      const candidateDir = join(orch, 'candidate');
      mkdirSync(candidateDir, { recursive: true });
      writeFileSync(join(candidateDir, 'workflow.yaml'), 'version: 2', 'utf-8');
      promoteWorkflow(candidateDir);
      const currentYaml = join(orch, 'current', 'workflow.yaml');
      expect(existsSync(currentYaml)).toBe(true);
      expect(readFileSync(currentYaml, 'utf-8')).toBe('version: 2');
    });

    it('archives old current to history/ on promote', () => {
      const orch = join(tmp, 'orchestrator');
      const currentDir = join(orch, 'current');
      mkdirSync(currentDir, { recursive: true });
      writeFileSync(join(currentDir, 'workflow.yaml'), 'version: 1', 'utf-8');
      const candidateDir = join(orch, 'candidate');
      mkdirSync(candidateDir, { recursive: true });
      writeFileSync(join(candidateDir, 'workflow.yaml'), 'version: 2', 'utf-8');
      promoteWorkflow(candidateDir);
      const historyDir = join(orch, 'history');
      expect(existsSync(historyDir)).toBe(true);
      const historyFiles = readdirSync(historyDir);
      expect(historyFiles).toHaveLength(1);
      expect(historyFiles[0]).toMatch(/^v1-\d{4}-\d{2}-\d{2}\.yaml$/);
      expect(readFileSync(join(historyDir, historyFiles[0]!), 'utf-8')).toBe('version: 1');
    });

    it('throws when candidate dir is missing', () => {
      expect(() => promoteWorkflow(join(tmp, 'noexist'))).toThrow(/candidate 目录不存在/);
    });

    it('throws when workflow.yaml is missing in candidate', () => {
      const orch = join(tmp, 'orchestrator');
      mkdirSync(join(orch, 'candidate'), { recursive: true });
      expect(() => promoteWorkflow(join(orch, 'candidate'))).toThrow(/无 workflow\.yaml/);
    });
  });
});
