// ============================================================
// dream-sandbox.test.ts · Dream Sandbox 沙盒审计测试（P2 · v1.3.9 十一）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DreamSandbox } from '../worklog/dream-sandbox';

describe('DreamSandbox · 事前模拟 + 人工放行', () => {
  let repoRoot: string;
  let dataDir: string;
  let sandbox: DreamSandbox;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-dream-repo-'));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-dream-data-'));
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'const version = 1;\n');
    sandbox = new DreamSandbox({ repoRoot, dataDir });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('stage 写入 sandbox 分支——真实文件不动', () => {
    const state = sandbox.stage('task-001', [
      { path: 'src/app.ts', content: 'const version = 2;\n' },
      { path: 'src/new-file.ts', content: 'export const x = 1;\n' },
    ]);
    expect(state.stagedCount).toBe(2);
    expect(state.merged).toBe(false);
    // 真实文件未变
    expect(fs.readFileSync(path.join(repoRoot, 'src', 'app.ts'), 'utf-8')).toBe('const version = 1;\n');
    expect(fs.existsSync(path.join(repoRoot, 'src', 'new-file.ts'))).toBe(false);
    // 沙盒里有
    expect(fs.existsSync(path.join(dataDir, 'dream-sandbox', 'task-001', 'src', 'app.ts'))).toBe(true);
  });

  it('diff 预览可用：新旧内容差异 + 新文件标记', () => {
    sandbox.stage('task-002', [
      { path: 'src/app.ts', content: 'const version = 99;\n' },
      { path: 'src/added.ts', content: 'new\n' },
    ]);
    const diff = sandbox.previewDiff('task-002');
    expect(diff).toHaveLength(2);
    const appDiff = diff.find((d) => d.path === 'src/app.ts')!;
    expect(appDiff.existed).toBe(true);
    expect(appDiff.preview).toContain('- const version = 1;');
    expect(appDiff.preview).toContain('+ const version = 99;');
    const added = diff.find((d) => d.path === 'src/added.ts')!;
    expect(added.existed).toBe(false);
  });

  it('未审不合并：dream_merge 无 approver 拒绝（强制人审，复用 always-ask 语义）', () => {
    sandbox.stage('task-003', [{ path: 'src/app.ts', content: 'evil\n' }]);
    const r = sandbox.merge('task-003', {});
    expect(r.merged).toBe(false);
    expect(r.reason).toContain('approver 必填');
    // 真实文件仍未动
    expect(fs.readFileSync(path.join(repoRoot, 'src', 'app.ts'), 'utf-8')).toBe('const version = 1;\n');
  });

  it('审批后合并生效 + 沙盒只读（二次 merge 拒绝）', () => {
    sandbox.stage('task-004', [{ path: 'src/app.ts', content: 'const version = 2;\n' }]);
    const r = sandbox.merge('task-004', { approver: 'kongfangxun' });
    expect(r.merged).toBe(true);
    expect(r.appliedFiles).toBe(1);
    expect(fs.readFileSync(path.join(repoRoot, 'src', 'app.ts'), 'utf-8')).toBe('const version = 2;\n');

    // 已合并的沙盒只读：stage 抛错，merge 拒绝
    expect(() => sandbox.stage('task-004', [{ path: 'x', content: 'y' }])).toThrow('已合并');
    const again = sandbox.merge('task-004', { approver: 'someone' });
    expect(again.merged).toBe(false);
  });

  it('24h 自动清理：过期沙盒删除，未过期保留', () => {
    sandbox.stage('fresh-task', [{ path: 'a.txt', content: '1' }]);
    sandbox.stage('old-task', [{ path: 'b.txt', content: '2' }]);
    // 把 old-task 的目录 mtime 拨回 25 小时前
    const oldDir = path.join(dataDir, 'dream-sandbox', 'old-task');
    const past = new Date(Date.now() - 25 * 3600_000);
    fs.utimesSync(oldDir, past, past);

    const removed = sandbox.cleanup(24);
    expect(removed).toBe(1);
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'dream-sandbox', 'fresh-task'))).toBe(true);
  });

  it('路径穿越消毒：../ 注入不逃逸沙盒', () => {
    sandbox.stage('evil-task', [{ path: '../../../etc/passwd-steal', content: 'x' }]);
    // 文件落在沙盒内的字面路径（../ 被替换为 __），不逃逸
    expect(fs.existsSync(path.join(dataDir, 'dream-sandbox', 'evil-task', '__etc', 'passwd-steal'))
      || fs.existsSync(path.join(dataDir, 'dream-sandbox', 'evil-task', '..__..__..__etc', 'passwd-steal'))
      || fs.existsSync(path.join(dataDir, 'dream-sandbox', 'evil-task', '_________.._etc', 'passwd-steal'))).toBe(false);
    expect(fs.existsSync('/etc/passwd-steal')).toBe(false);
    // 沙盒根之外的 data 上层没有泄漏文件
    expect(fs.readdirSync(dataDir).filter((d) => d !== 'dream-sandbox')).toHaveLength(0);
  });

  it('state 查询：未暂存返回 null', () => {
    expect(sandbox.state('nope')).toBeNull();
  });
});
