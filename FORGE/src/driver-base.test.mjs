// driver-base.test.mjs · FORGE driver 公共编排层测试
// v1.2.7 新建 · 功能 ⑤

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createForgeDriverBase } from './driver-base.mjs';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

describe('createForgeDriverBase', () => {
  const base = createForgeDriverBase({
    driverName: 'test-driver',
    loopDir: '/tmp/loop',
    repoRoot: process.cwd(),
    modelConfigs: {
      A: { model: 'test-model-a', baseURL: 'http://localhost:1', maxTokens: 1000 },
      V: { model: 'test-model-v', baseURL: 'http://localhost:2', maxTokens: 2000 },
    },
    modelPricing: {
      'test-model-a': { input: 1, output: 2, billing: 'usage' },
    },
  });

  describe('parseDriverArgs', () => {
    it('解析 --target 参数', () => {
      const args = base.parseDriverArgs(['--target', 'v1.2.7']);
      expect(args.target).toBe('v1.2.7');
    });

    it('解析 --dry-run flag', () => {
      const args = base.parseDriverArgs(['--dry-run']);
      expect(args.dryRun).toBe(true);
    });

    it('解析 --worker flag', () => {
      const args = base.parseDriverArgs(['--worker', '--step', 'a-check']);
      expect(args.worker).toBe(true);
      expect(args.step).toBe('a-check');
    });

    it('解析 --max-rounds 参数', () => {
      const args = base.parseDriverArgs(['--max-rounds', '5']);
      expect(args.maxRounds).toBe(5);
    });

    it('未识别参数存入 extra', () => {
      const args = base.parseDriverArgs(['--custom-flag', 'value']);
      expect(args.extra['custom-flag']).toBe('value');
    });
  });

  describe('resolvePaths', () => {
    it('返回路径常量', () => {
      const paths = base.resolvePaths();
      expect(paths.repoRoot).toBe(process.cwd());
      expect(paths.loopDir).toBe('/tmp/loop');
      expect(paths.promptsDir).toBe(join('/tmp/loop', 'prompts'));
    });
  });

  describe('createModelFromConfig', () => {
    it('角色不存在返回 null', () => {
      const model = base.createModelFromConfig('X');
      expect(model).toBeNull();
    });

    it('无 API key 返回 null', () => {
      const savedKey = process.env.SOFAGENT_LLM_A_API_KEY;
      delete process.env.SOFAGENT_LLM_A_API_KEY;
      delete process.env.SOFAGENT_LLM_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const model = base.createModelFromConfig('A');
      expect(model).toBeNull();
      if (savedKey) process.env.SOFAGENT_LLM_A_API_KEY = savedKey;
    });
  });

  describe('createCircuitBreaker', () => {
    it('使用默认阈值', () => {
      const cb = base.createCircuitBreaker();
      expect(cb.softLimit).toBe(50);
      expect(cb.hardLimit).toBe(60);
    });

    it('shouldSoftBreak 正确判定', () => {
      const cb = base.createCircuitBreaker({ softLimit: 10 });
      expect(cb.shouldSoftBreak(5)).toBe(false);
      expect(cb.shouldSoftBreak(10)).toBe(true);
    });

    it('shouldHardBreak 正确判定', () => {
      const cb = base.createCircuitBreaker({ hardLimit: 20 });
      expect(cb.shouldHardBreak(15)).toBe(false);
      expect(cb.shouldHardBreak(20)).toBe(true);
    });

    it('buildSoftBreakMessage 返回 HumanMessage', () => {
      const cb = base.createCircuitBreaker();
      const msg = cb.buildSoftBreakMessage();
      expect(msg.type).toBe('human');
      expect(msg.content).toContain('写报告');
    });
  });

  describe('truncateToolOutput', () => {
    it('短文本不截断', () => {
      const text = 'line1\nline2\nline3';
      const result = base.truncateToolOutput(text);
      expect(result).toBe(text);
    });

    it('长文本截断', () => {
      const lines = Array.from({ length: 300 }, (_, i) => `line${i}`);
      const text = lines.join('\n');
      const result = base.truncateToolOutput(text, 100);
      expect(result).toContain('truncated');
      // 100 行预算 = head 50 + tail 50 + 截断消息行（消息含前后 \n 展开为 3 行）= ≤103
      expect(result.split('\n').length).toBeLessThanOrEqual(103);
    });

    it('空文本返回空字符串', () => {
      expect(base.truncateToolOutput('')).toBe('');
      expect(base.truncateToolOutput(null)).toBe('');
    });
  });

  describe('resolveVisibleFiles', () => {
    it('合并 inputs 和 outputs', () => {
      const files = base.resolveVisibleFiles('test-step', {
        inputs: ['a.md', 'b.md'],
        outputs: ['result.md'],
      });
      expect(files).toHaveLength(3);
      expect(files).toContain('a.md');
      expect(files).toContain('b.md');
      expect(files).toContain('result.md');
    });

    it('空配置返回空数组', () => {
      const files = base.resolveVisibleFiles('test-step', {});
      expect(files).toEqual([]);
    });
  });

  describe('extractAgentText', () => {
    it('string 直接返回', () => {
      expect(base.extractAgentText('hello')).toBe('hello');
    });

    it('从 content 字段提取', () => {
      expect(base.extractAgentText({ content: 'text' })).toBe('text');
    });

    it('从 messages 数组提取最后一条 assistant', () => {
      const result = {
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'a1' },
          { role: 'assistant', content: 'a2' },
        ],
      };
      expect(base.extractAgentText(result)).toBe('a2');
    });
  });

  describe('appendLedger', () => {
    let tmpDir;
    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'driver-base-'));
    });
    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('追加行到 LEDGER.md', () => {
      // 创建临时 base 指向 tmpDir
      const tmpBase = createForgeDriverBase({
        driverName: 'test',
        loopDir: tmpDir,
        repoRoot: tmpDir,
      });
      tmpBase.appendLedger('2026-01-01', 'run-01', { rounds: 3, p0: 0, p1: 1, p2: 2 }, 'clean', join(tmpDir, 'run-01'));
      const ledger = readFileSync(join(tmpDir, 'FORGE', 'LEDGER.md'), 'utf-8');
      expect(ledger).toContain('run-01');
      expect(ledger).toContain('test');
      expect(ledger).toContain('clean');
    });
  });

  describe('updateLatestPointer', () => {
    let tmpDir;
    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'driver-base-ptr-'));
    });
    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('写入 latest.json', () => {
      const tmpBase = createForgeDriverBase({
        driverName: 'test',
        loopDir: tmpDir,
        repoRoot: tmpDir,
      });
      const runDir = join(tmpDir, 'runs', '2026-01-01', 'run-01');
      tmpBase.updateLatestPointer(runDir, { stopReason: 'clean', totalRounds: 3, counts: { p0: 0 } });
      const pointerPath = join(tmpDir, 'runs', '2026-01-01', 'latest.json');
      expect(existsSync(pointerPath)).toBe(true);
      const pointer = JSON.parse(readFileSync(pointerPath, 'utf-8'));
      expect(pointer.driver).toBe('test');
      expect(pointer.stopReason).toBe('clean');
    });
  });

  // ─── v1.2.8 功能⑦：断点续跑（saveResumePoint / loadResumePoint）───
  describe('resume point（断点续跑）', () => {
    let tmpDir;
    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'driver-base-resume-'));
    });
    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    // 最小参数集——resume 函数不依赖模型配置
    const resumeBase = createForgeDriverBase({
      driverName: 'resume-test',
      loopDir: '/tmp/loop',
      repoRoot: process.cwd(),
    });

    it('saveResumePoint 写入 resume-point.json（round/completedWorkers/counts/timestamp）', () => {
      // v1.2.9 功能②：worker 级断点——state 从 completed: boolean 升级为 completedWorkers: string[]
      const state = {
        round: 3,
        completedWorkers: ['a-check-p1', 'a-check-p2', 'b-check-p1'],
        workers: {
          'a-check-p1': { status: 'done', output: 'check-a-p1.md' },
          'a-check-p2': { status: 'done', output: 'check-a-p2.md' },
          'b-check-p1': { status: 'done', output: 'check-b-p1.md' },
        },
        counts: { p0: 0, p1: 2, p2: 5 },
        cleanStreak: 1,
        consecutiveDegraded: 0,
        severityHistory: [4, 2],
        target: 'v1.2.9',
        maxRounds: 10,
      };
      resumeBase.saveResumePoint(tmpDir, state);

      const resumePath = join(tmpDir, 'resume-point.json');
      expect(existsSync(resumePath)).toBe(true);

      const saved = JSON.parse(readFileSync(resumePath, 'utf-8'));
      expect(saved.round).toBe(3);
      // v1.2.9 功能②：completedWorkers 是数组
      expect(saved.completedWorkers).toEqual(['a-check-p1', 'a-check-p2', 'b-check-p1']);
      expect(saved.workers).toBeDefined();
      expect(saved.workers['a-check-p1']).toEqual({ status: 'done', output: 'check-a-p1.md' });
      expect(saved.counts).toEqual({ p0: 0, p1: 2, p2: 5 });
      expect(saved.cleanStreak).toBe(1);
      expect(saved.severityHistory).toEqual([4, 2]);
      expect(saved.target).toBe('v1.2.9');
      expect(saved.maxRounds).toBe(10);
      // timestamp 由 saveResumePoint 自动注入（ISO 格式）
      expect(typeof saved.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(saved.timestamp))).toBe(false);
    });

    it('saveResumePoint 原子写：不留 .tmp 残留', () => {
      resumeBase.saveResumePoint(tmpDir, { round: 1, completedWorkers: [] });
      expect(existsSync(join(tmpDir, 'resume-point.json.tmp'))).toBe(false);
      expect(existsSync(join(tmpDir, 'resume-point.json'))).toBe(true);
    });

    it('loadResumePoint 读取有效断点（v1.2.9 worker 级格式）', () => {
      const state = {
        round: 2,
        completedWorkers: ['a-check-p1', 'b-check-p3'],
        counts: { p0: 1, p1: 1, p2: 0 },
      };
      resumeBase.saveResumePoint(tmpDir, state);

      const loaded = resumeBase.loadResumePoint(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded.round).toBe(2);
      expect(loaded.completedWorkers).toEqual(['a-check-p1', 'b-check-p3']);
      expect(loaded.counts).toEqual({ p0: 1, p1: 1, p2: 0 });
    });

    it('loadResumePoint 文件不存在返回 null', () => {
      expect(resumeBase.loadResumePoint(tmpDir)).toBeNull();
    });

    it('loadResumePoint 文件损坏返回 null 不 throw', () => {
      writeFileSync(join(tmpDir, 'resume-point.json'), '{ "round": 3, "completedWorkers": ["a-check-p1"', 'utf-8');
      // 不 throw，返回 null
      expect(resumeBase.loadResumePoint(tmpDir)).toBeNull();
    });

    it('loadResumePoint 字段缺失（只有 round 没有 completedWorkers/completed）返回 null', () => {
      writeFileSync(join(tmpDir, 'resume-point.json'), JSON.stringify({ round: 3 }) + '\n', 'utf-8');
      expect(resumeBase.loadResumePoint(tmpDir)).toBeNull();
    });

    it('loadResumePoint 字段类型错误（round 非 number）返回 null', () => {
      writeFileSync(
        join(tmpDir, 'resume-point.json'),
        JSON.stringify({ round: 'three', completedWorkers: ['a-check-p1'] }) + '\n',
        'utf-8'
      );
      expect(resumeBase.loadResumePoint(tmpDir)).toBeNull();
    });

    // v1.2.9 功能②：向后兼容——旧格式（completed: boolean）仍然可读
    it('loadResumePoint 向后兼容旧格式（completed: boolean 无 completedWorkers）', () => {
      writeFileSync(
        join(tmpDir, 'resume-point.json'),
        JSON.stringify({ round: 3, completed: true, counts: { p0: 0 } }) + '\n',
        'utf-8'
      );
      const loaded = resumeBase.loadResumePoint(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded.round).toBe(3);
      expect(loaded.completed).toBe(true);
    });

    it('parseDriverArgs 解析 --resume flag', () => {
      const args = resumeBase.parseDriverArgs(['--target', 'v1.2.8', '--resume']);
      expect(args.resume).toBe(true);
    });

    it('parseDriverArgs 默认 resume=false', () => {
      const args = resumeBase.parseDriverArgs(['--target', 'v1.2.8']);
      expect(args.resume).toBe(false);
    });
  });
});

// ─── v1.3.6 交付⑩：setupWorktree / teardownWorktree ───
// run-07 事故根因修复——审查 worker 与主仓共享工作目录。
// 测试在临时 git repo 上跑（不碰 sofagent 主仓），验证完整生命周期：
// 建副本 → 幂等复用 → 副本 commit 不进主仓历史 → teardown 删目录保分支 → 主仓干净。
describe('worktree 隔离（v1.3.6 交付⑩）', () => {
  let gitRepoDir;  // 临时 git repo（模拟主仓）
  let runsDir;     // run 目录所在区（模拟 ~/.sofagent/data/forge-runs——repo 之外）
  let wtBase;      // driver-base 实例（repoRoot 指向临时 repo）

  // 辅助：在指定目录跑 git 命令
  const git = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf-8', timeout: 30_000 }).toString().trim();

  beforeEach(() => {
    // 建临时 git repo + 初始 commit（worktree 需要至少一个 commit 才能 add）
    gitRepoDir = mkdtempSync(join(tmpdir(), 'forge-wt-test-'));
    git('git init -q', gitRepoDir);
    git('git config user.email test@example.com', gitRepoDir);
    git('git config user.name test', gitRepoDir);
    writeFileSync(join(gitRepoDir, 'hello.txt'), 'v1\n', 'utf-8');
    git('git add hello.txt', gitRepoDir);
    git('git commit -q -m init', gitRepoDir);

    // run 目录在 repo 外（与生产一致：runDir 在 ~/.sofagent/data/forge-runs，
    // 不污染主仓 git status）
    runsDir = mkdtempSync(join(tmpdir(), 'forge-wt-runs-'));

    wtBase = createForgeDriverBase({
      driverName: 'wt-test',
      loopDir: '/tmp/loop',
      repoRoot: gitRepoDir,
      modelConfigs: {},
      modelPricing: {},
    });
  });

  afterEach(() => {
    // 清理：先移 worktree 注册再删目录（teardown 已测过，这里兜底防泄漏）
    try { git('git worktree prune', gitRepoDir); } catch { /* ignore */ }
    rmSync(gitRepoDir, { recursive: true, force: true });
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('setupWorktree 创建副本目录 + forge 分支', () => {
    const runDir = join(runsDir, 'run-01');
    const r = wtBase.setupWorktree(runDir, { runId: 'r1' });
    expect(existsSync(r.worktreeDir)).toBe(true);
    expect(r.branch).toBe('forge/wt-test/r1');
    expect(r.reused).toBe(false);
    // 分支可在主仓解析（worktree 注册成功）
    expect(git('git branch --list forge/wt-test/r1', gitRepoDir)).toContain('forge/wt-test/r1');
    // 元数据落盘
    const meta = JSON.parse(readFileSync(join(runDir, 'worktree-meta.json'), 'utf-8'));
    expect(meta.branch).toBe('forge/wt-test/r1');
    expect(meta.baseSha).toHaveLength(40);
  });

  it('setupWorktree 幂等复用——同 runDir 二次调用不重建', () => {
    const runDir = join(runsDir, 'run-01');
    const first = wtBase.setupWorktree(runDir, { runId: 'r1' });
    const second = wtBase.setupWorktree(runDir, { runId: 'r1' });
    expect(second.reused).toBe(true);
    expect(second.worktreeDir).toBe(first.worktreeDir);
    expect(second.branch).toBe(first.branch);
  });

  it('副本 commit 不进主仓历史——主仓 HEAD 与 git status 全程干净', () => {
    const runDir = join(runsDir, 'run-01');
    const headBefore = git('git rev-parse HEAD', gitRepoDir);
    const r = wtBase.setupWorktree(runDir, { runId: 'r1' });

    // 红队模拟：在副本里写文件 + commit（run-07 事故场景）
    writeFileSync(join(r.worktreeDir, 'evil.txt'), 'pwned\n', 'utf-8');
    git('git add evil.txt', r.worktreeDir);
    git('git commit -q -m "红队模拟恶意 commit"', r.worktreeDir);

    // 主仓 HEAD 不动、工作区干净、历史无 evil commit
    expect(git('git rev-parse HEAD', gitRepoDir)).toBe(headBefore);
    expect(git('git status --porcelain', gitRepoDir)).toBe('');
    expect(git('git log --oneline', gitRepoDir)).not.toContain('红队模拟');
    // commit 落在副本分支上（teardown 后仍可 cherry-pick 审计）
    expect(git('git log --oneline forge/wt-test/r1', gitRepoDir)).toContain('红队模拟');
  });

  it('teardownWorktree 删目录但保留分支（供人工 cherry-pick 回流）', () => {
    const runDir = join(runsDir, 'run-01');
    const r = wtBase.setupWorktree(runDir, { runId: 'r1' });
    writeFileSync(join(r.worktreeDir, 'fix.txt'), 'fix\n', 'utf-8');
    git('git add fix.txt', r.worktreeDir);
    git('git commit -q -m "b-fix 修复"', r.worktreeDir);

    const t = wtBase.teardownWorktree(runDir);
    expect(t.removed).toBe(true);
    expect(t.branch).toBe('forge/wt-test/r1');
    // 目录已删、分支仍在（零信任回流闸门：commit 留分支等人审）
    expect(existsSync(r.worktreeDir)).toBe(false);
    expect(git('git branch --list forge/wt-test/r1', gitRepoDir)).toContain('forge/wt-test/r1');
    expect(git('git log --oneline forge/wt-test/r1', gitRepoDir)).toContain('b-fix 修复');
    // 元数据保留（回流审计取证）
    expect(existsSync(join(runDir, 'worktree-meta.json'))).toBe(true);
    // 主仓干净
    expect(git('git status --porcelain', gitRepoDir)).toBe('');
  });

  it('teardownWorktree 幂等——未创建时调用不抛错', () => {
    const runDir = join(runsDir, 'run-empty');
    const t = wtBase.teardownWorktree(runDir);
    expect(t.removed).toBe(false);
  });

  it('并发冲突回归——审查运行期间主仓做普通 commit 互不影响', () => {
    const runDir = join(runsDir, 'run-01');
    const r = wtBase.setupWorktree(runDir, { runId: 'r1' });

    // 主仓：其他会话正常开发 commit（run-07 事故场景）
    writeFileSync(join(gitRepoDir, 'main-dev.txt'), 'main work\n', 'utf-8');
    git('git add main-dev.txt', gitRepoDir);
    git('git commit -q -m "主仓并行开发 commit"', gitRepoDir);

    // 副本：审查 worker 同时 commit——两者基线独立，互不干扰
    writeFileSync(join(r.worktreeDir, 'audit-work.txt'), 'audit\n', 'utf-8');
    git('git add audit-work.txt', r.worktreeDir);
    git('git commit -q -m "审查 commit"', r.worktreeDir);

    expect(git('git log --oneline', gitRepoDir)).toContain('主仓并行开发');
    expect(git('git log --oneline', gitRepoDir)).not.toContain('审查 commit');
    expect(git('git log --oneline forge/wt-test/r1', gitRepoDir)).toContain('审查 commit');
    expect(git('git status --porcelain', gitRepoDir)).toBe('');
  });

  // ─── v1.3.6 worktree 留存根治：registerSignalCleanup / cleanupStaleWorktrees ───
  // run-03 事故（2026-08-17）：人工 pkill（SIGTERM）终止 driver 时 teardown 不执行，
  // worktree 永久留存。两个新函数补齐：信号路径清理 + 启动时陈旧兜底扫描。

  it('registerSignalCleanup——SIGTERM 触发 cleanup 且幂等（只执行一次）', async () => {
    let calls = 0;
    const cleanup = () => { calls++; };
    wtBase.registerSignalCleanup({ cleanup, stopReason: 'aborted-signal', exitFn: () => {} });

    process.kill(process.pid, 'SIGTERM');
    // SIGTERM 异步派发：等 handler 执行（真 driver 场景 pkill→退出有天然时间差）
    await new Promise(r => setTimeout(r, 120));
    expect(calls).toBe(1);

    // 幂等锁：二次信号不重复执行（SIGTERM 后可能再收 SIGINT）
    process.kill(process.pid, 'SIGINT');
    await new Promise(r => setTimeout(r, 120));
    expect(calls).toBe(1);
  });

  it('registerSignalCleanup——disarm 后信号不再触发 cleanup', async () => {
    let calls = 0;
    const disarm = wtBase.registerSignalCleanup({ cleanup: () => { calls++; }, stopReason: 'aborted-signal', exitFn: () => {} });
    disarm();
    process.kill(process.pid, 'SIGTERM');
    await new Promise(r => setTimeout(r, 120));
    expect(calls).toBe(0);
  });

  it('cleanupStaleWorktrees——超龄 worktree 被收走、分支保留、新 run 不动', () => {
    // run-01：创建后把元数据 createdAt 篡改为 8 天前（模拟陈旧）
    const staleRunDir = join(runsDir, 'run-stale');
    wtBase.setupWorktree(staleRunDir, { runId: 'stale1' });
    const metaPath = join(staleRunDir, 'worktree-meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    // run-02：新 worktree（不过期）
    const freshRunDir = join(runsDir, 'run-fresh');
    wtBase.setupWorktree(freshRunDir, { runId: 'fresh1' });

    // runsDir 伪装成日期目录结构：forge-runs-root/YYYY-MM-DD/run-XX
    const dateRoot = mkdtempSync(join(tmpdir(), 'forge-wt-dates-'));
    const dayDir = join(dateRoot, '2026-08-17');
    // 直接在日期结构下重建：把 runsDir 整体挪进日期目录
    mkdirSync(dayDir, { recursive: true });
    renameSync(staleRunDir, join(dayDir, 'run-stale'));
    renameSync(freshRunDir, join(dayDir, 'run-fresh'));

    const r = wtBase.cleanupStaleWorktrees({ runsRoot: dateRoot, excludeRunDir: join(dayDir, 'run-none') });
    expect(r.scanned).toBe(2);
    expect(r.cleaned).toBe(1);
    // 陈旧目录已移除、分支保留
    expect(existsSync(join(dayDir, 'run-stale', 'worktree'))).toBe(false);
    expect(git('git branch --list forge/wt-test/stale1', gitRepoDir)).toContain('stale1');
    // 新 worktree 原样保留
    expect(existsSync(join(dayDir, 'run-fresh', 'worktree'))).toBe(true);
    rmSync(dateRoot, { recursive: true, force: true });
  });

  it('cleanupStaleWorktrees——excludeRunDir 跳过本次 run（防误删自己）', () => {
    const dateRoot = mkdtempSync(join(tmpdir(), 'forge-wt-dates-'));
    const dayDir = join(dateRoot, '2026-08-17');
    mkdirSync(dayDir, { recursive: true });

    const oldRunDir = join(runsDir, 'run-old');
    wtBase.setupWorktree(oldRunDir, { runId: 'old1' });
    const metaPath = join(oldRunDir, 'worktree-meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    renameSync(oldRunDir, join(dayDir, 'run-old'));

    // excludeRunDir 指向 run-old 自身 → 即便超龄也跳过
    const r = wtBase.cleanupStaleWorktrees({ runsRoot: dateRoot, excludeRunDir: join(dayDir, 'run-old') });
    expect(r.scanned).toBe(1);
    expect(r.cleaned).toBe(0);
    expect(existsSync(join(dayDir, 'run-old', 'worktree'))).toBe(true);
    rmSync(dateRoot, { recursive: true, force: true });
  });
});
