// ============================================================
// workspace-scan.test.ts · 工作区垃圾残留扫描测试
// v1.3.6 新增 · 2026-08-16 根目录测试残留事件防再犯
// ============================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { scanWorkspace, formatWorkspaceScan } from './workspace-scan';

/** 建一个带 git 的临时仓库（模拟实验场/正常仓库两种场景） */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sofagent-ws-scan-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  return dir;
}

describe('工作区垃圾残留扫描', () => {
  it('垃圾文件在 untracked → 报残留（c.txt / b.ts / 实验目录）', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'c.txt'), 'test');
      writeFileSync(join(dir, 'b.ts'), '+debugger');
      const result = scanWorkspace(dir);
      expect(result.executed).toBe(true);
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContain('c.txt');
      expect(paths).toContain('b.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('垃圾文件已被 git 跟踪 → 报残留且 source=tracked', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'a.txt'), 'junk');
      execFileSync('git', ['add', 'a.txt'], { cwd: dir });
      const result = scanWorkspace(dir);
      const hit = result.issues.find((i) => i.path === 'a.txt');
      expect(hit).toBeDefined();
      expect(hit?.source).toBe('tracked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('嵌套独立 .git 目录 → 报「实验场信号」', () => {
    const dir = makeRepo();
    try {
      const nested = join(dir, 'npm-p4-test');
      mkdirSync(nested);
      execFileSync('git', ['init', '-q'], { cwd: nested });
      writeFileSync(join(nested, 'a.txt'), 'test');
      const result = scanWorkspace(dir);
      const hit = result.issues.find((i) => i.path === 'npm-p4-test');
      expect(hit).toBeDefined();
      expect(hit?.reason).toContain('嵌套独立 .git');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('.gitignore 排除的文件 → 不报（尊重 ignore）', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, '.gitignore'), 'c.txt\nnpm-p4-test/\n');
      writeFileSync(join(dir, 'c.txt'), 'test');
      const result = scanWorkspace(dir);
      expect(result.issues.find((i) => i.path === 'c.txt')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('干净仓库 → 零残留', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'README.md'), '# normal');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'index.ts'), 'export {}');
      const result = scanWorkspace(dir);
      expect(result.issues).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('非 git 目录 → executed=false 静默跳过', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-ws-plain-'));
    try {
      writeFileSync(join(dir, 'c.txt'), 'test');
      const result = scanWorkspace(dir);
      expect(result.executed).toBe(false);
      expect(result.issues).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('格式化输出含提示行', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'c.txt'), 'test');
      const result = scanWorkspace(dir);
      const lines = formatWorkspaceScan(result);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain('工作区垃圾残留扫描');
      expect(lines.join('\n')).toContain('/tmp');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
