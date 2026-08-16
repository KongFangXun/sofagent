// workspace-scan 单测（v1.3.5 收编时补）
// 验收：干净目录零输出 / 残留目录命中清单 / 非 git 目录静默跳过
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { scanWorkspace, formatWorkspaceScan } from '../workspace-scan';

// 在 tmp 里造一个最小 git 仓库（隔离：不碰真实 HOME/仓库）
function makeTmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scan-test-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t.t']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
  return dir;
}

describe('workspace-scan 工作区垃圾残留扫描', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeTmpRepo();
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('干净目录零 issues（executed=true）', () => {
    const r = scanWorkspace(repo);
    expect(r.executed).toBe(true);
    expect(r.issues).toEqual([]);
    // 干净时 format 输出为空数组
    expect(formatWorkspaceScan(r)).toEqual([]);
  });

  it('untracked 垃圾文件命中清单（垃圾命名模式）', () => {
    // 造典型残留：单字母文件 + 测试 env（.gitignore 未覆盖时）
    fs.writeFileSync(path.join(repo, 'b.ts'), 'export {};');
    fs.writeFileSync(path.join(repo, 't'), 'x');
    const r = scanWorkspace(repo);
    expect(r.executed).toBe(true);
    const paths = r.issues.map((i) => i.path);
    expect(paths).toContain('b.ts');
    expect(paths).toContain('t');
    // 全部应为 untracked 来源
    for (const i of r.issues) expect(i.source).toBe('untracked');
    // format 输出非空且含路径
    const lines = formatWorkspaceScan(r);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('b.ts');
  });

  it('嵌套 git 仓库目录命中（实验场信号）', () => {
    const nested = path.join(repo, 'exp-repo');
    fs.mkdirSync(nested);
    execFileSync('git', ['init', '-q', nested]);
    const r = scanWorkspace(repo);
    expect(r.issues.some((i) => i.path === 'exp-repo')).toBe(true);
  });

  it('非 git 目录静默跳过（executed=false 不抛错）', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-scan-plain-'));
    try {
      const r = scanWorkspace(plain);
      expect(r.executed).toBe(false);
      expect(r.issues).toEqual([]);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
