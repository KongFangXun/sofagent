// ============================================================
// diff-parser-oversized.test.ts · >5MB diff 缝隙修复测试
// v1.3.9（十二）：验收——maxBuffer 溢出不再跳过内容扫描，
// spill 落盘后分块读回；A2 密钥检测不因 5MB 跳过
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { parseDiff, parseStagedDiff } from '../diff-parser';

describe('超大 diff spill 落盘读回（v1.3.9 十二）', () => {
  let tmpRepo: string;
  let spillDataDir: string;
  let prevDataEnv: string | undefined;

  beforeEach(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-oversized-'));
    spillDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-spill-data-'));
    prevDataEnv = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = spillDataDir;
    execSync('git init -q', { cwd: tmpRepo });
    execSync('git config user.email t@t.local', { cwd: tmpRepo });
    execSync('git config user.name t', { cwd: tmpRepo });
  });

  afterEach(() => {
    if (prevDataEnv === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = prevDataEnv;
    fs.rmSync(tmpRepo, { recursive: true, force: true });
    fs.rmSync(spillDataDir, { recursive: true, force: true });
  });

  /** 生成 >5MB 的修改内容（每行 ~64B × N 行），末尾埋一个密钥 */
  function makeBigContent(lines: number, secretAtEnd: boolean): string {
    const rows: string[] = [];
    for (let i = 0; i < lines; i++) {
      rows.push(`// padding line ${i} ${'x'.repeat(48)}`);
    }
    if (secretAtEnd) rows.push('const apiKey = "sk-overflow-secret-1234567890abcd";');
    return rows.join('\n');
  }

  it('>5MB diff：内容不再跳过——spill 读回全量行，密钥行可被扫到，不置 oversized', () => {
    // 首次提交基线
    fs.writeFileSync(path.join(tmpRepo, 'big.ts'), 'base\n');
    execSync('git add -A && git commit -qm base', { cwd: tmpRepo });
    // 修改为 ~6MB（9.5 万行 × 64B）
    fs.writeFileSync(path.join(tmpRepo, 'big.ts'), makeBigContent(95_000, true));
    execSync('git add -A && git commit -qm big', { cwd: tmpRepo });

    const files = parseDiff('HEAD~1..HEAD', tmpRepo);
    const big = files.find((f) => f.path === 'big.ts');
    expect(big).toBeDefined();

    // 核心验收：内容没有因 5MB maxBuffer 跳过
    expect(big!.lines.length).toBeGreaterThan(90_000);
    // 密钥行在读回内容里——A2 类规则可命中
    const secretLine = big!.lines.find((l) => l.includes('sk-overflow-secret-1234567890abcd'));
    expect(secretLine).toBeDefined();
    // 6MB < 64MB 读回上限：全量扫描完成，无截断
    expect(big!.oversized).toBeUndefined();
    // spill 落盘 locator 存在且文件真实可读（按需取回路径可用）
    expect(big!.spillFile).toBeDefined();
    expect(fs.existsSync(big!.spillFile!)).toBe(true);
    expect(fs.statSync(big!.spillFile!).size).toBeGreaterThan(5 * 1024 * 1024);
  });

  it('staged 模式同样走 spill 读回（parseStagedDiff）', () => {
    fs.writeFileSync(path.join(tmpRepo, 'init.txt'), 'init\n');
    execSync('git add -A && git commit -qm init', { cwd: tmpRepo });
    fs.writeFileSync(path.join(tmpRepo, 'staged-big.ts'), makeBigContent(95_000, true));
    execSync('git add staged-big.ts', { cwd: tmpRepo });

    // parseStagedDiff 不收 cwd——切到临时仓库再切回（process.chdir）
    const prevCwd = process.cwd();
    process.chdir(tmpRepo);
    try {
      const files = parseStagedDiff();
      const big = files.find((f) => f.path === 'staged-big.ts');
      expect(big).toBeDefined();
      expect(big!.lines.length).toBeGreaterThan(90_000);
      expect(big!.lines.some((l) => l.includes('sk-overflow-secret-1234567890abcd'))).toBe(true);
      expect(big!.oversized).toBeUndefined();
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('>64MB diff：截断 + oversized 置位 + spillFile locator 保留', () => {
    fs.writeFileSync(path.join(tmpRepo, 'huge.ts'), 'base\n');
    execSync('git add -A && git commit -qm base', { cwd: tmpRepo });
    // ~70MB（110 万行 × 64B）——超过 64MB 读回上限
    fs.writeFileSync(path.join(tmpRepo, 'huge.ts'), makeBigContent(1_100_000, false));
    execSync('git add -A && git commit -qm huge', { cwd: tmpRepo });

    const files = parseDiff('HEAD~1..HEAD', tmpRepo);
    const huge = files.find((f) => f.path === 'huge.ts');
    expect(huge).toBeDefined();
    // 截断：行数远小于全量，但仍有大段内容可扫
    expect(huge!.lines.length).toBeGreaterThan(100_000);
    expect(huge!.lines.length).toBeLessThan(1_100_000);
    // oversized 置位（WARN 注入语义），spill 全量内容落盘可取回
    expect(huge!.oversized).toBe(true);
    expect(fs.existsSync(huge!.spillFile!)).toBe(true);
    expect(fs.statSync(huge!.spillFile!).size).toBeGreaterThan(64 * 1024 * 1024);
  }, 120_000);

  it('小 diff 不走 spill（快路径无回归）', () => {
    fs.writeFileSync(path.join(tmpRepo, 'small.ts'), 'const a = 1;\n');
    execSync('git add -A && git commit -qm s1', { cwd: tmpRepo });
    fs.writeFileSync(path.join(tmpRepo, 'small.ts'), 'const a = 2;\nconst b = 3;\n');
    execSync('git add -A && git commit -qm s2', { cwd: tmpRepo });

    const files = parseDiff('HEAD~1..HEAD', tmpRepo);
    const small = files.find((f) => f.path === 'small.ts');
    expect(small).toBeDefined();
    expect(small!.lines.some((l) => l.includes('const b = 3;'))).toBe(true);
    expect(small!.oversized).toBeUndefined();
    expect(small!.spillFile).toBeUndefined();
  });

  // v1.4.3 P2-e：跨仓密钥泄漏面行为锁——SOFAGENT_DATA 未设时 spill 必须落
  // 引擎 home 数据目录（被审仓库外），不得落被审仓库 CWD/data（旧 ?? 'data' 兜底
  // 的缺陷：对方仓库无本仓 .gitignore /data/ 规则，spill 文件会被对方 commit 卷入）
  it('P2-e：SOFAGENT_DATA 未设时 spill 落引擎 home 数据目录（被审仓库外），不落 CWD/data', () => {
    const prevHome = process.env.SOFAGENT_HOME;
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-p2e-home-'));
    process.env.SOFAGENT_HOME = fakeHome;
    // 显式清掉 SOFAGENT_DATA——测试旧兜底路径的关键前置
    const prevData = process.env.SOFAGENT_DATA;
    delete process.env.SOFAGENT_DATA;
    // 被审仓库在 fakeHome 之外（模拟跨仓审计——被审仓库 ≠ 引擎 home）
    const auditedRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-p2e-audited-'));
    try {
      execSync('git init -q', { cwd: auditedRepo });
      execSync('git config user.email t@t.local', { cwd: auditedRepo });
      execSync('git config user.name t', { cwd: auditedRepo });
      fs.writeFileSync(path.join(auditedRepo, 'big.ts'), 'base\n');
      execSync('git add -A && git commit -qm base', { cwd: auditedRepo });
      fs.writeFileSync(path.join(auditedRepo, 'big.ts'), makeBigContent(95_000, true));
      execSync('git add -A && git commit -qm big', { cwd: auditedRepo });

      const files = parseDiff('HEAD~1..HEAD', auditedRepo);
      const big = files.find((f) => f.path === 'big.ts');
      expect(big).toBeDefined();
      expect(big!.spillFile).toBeDefined();
      // 核心：spill 文件落在引擎 home 数据目录（被审仓库外）
      const expectedSpillRoot = path.join(fakeHome, 'data', 'spill');
      expect(path.dirname(big!.spillFile!)).toBe(expectedSpillRoot);
      expect(fs.existsSync(big!.spillFile!)).toBe(true);
      // 反向断言：被审仓库内不出现 data/spill（跨仓泄漏面消除）
      expect(fs.existsSync(path.join(auditedRepo, 'data', 'spill'))).toBe(false);
    } finally {
      if (prevHome === undefined) delete process.env.SOFAGENT_HOME;
      else process.env.SOFAGENT_HOME = prevHome;
      if (prevData !== undefined) process.env.SOFAGENT_DATA = prevData;
      fs.rmSync(fakeHome, { recursive: true, force: true });
      fs.rmSync(auditedRepo, { recursive: true, force: true });
    }
  });
});
