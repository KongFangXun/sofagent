// ============================================================
// evolve.test.ts · Evolve 集成测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanSkillSafety } from '../skill-safety-check';
import { findFiles } from '@sofagent/audit';
import { isEvolveAvailable, runEvolve } from '../evolve-integration';

describe('scanSkillSafety', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-evolve-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('不存在目标时返回 SUSPICIOUS', () => {
    const result = scanSkillSafety('/nonexistent/path', { mode: 'quiet' });
    expect(result.verdict).toBe('SUSPICIOUS');
    expect(result.filesScanned).toBe(0);
  });

  it('安全 Skill 返回 SAFE', () => {
    const safePath = path.join(tmpDir, 'safe-skill.md');
    fs.writeFileSync(safePath, '# Safe Skill\n\nThis is a completely harmless skill file.');
    const result = scanSkillSafety(safePath, { mode: 'quiet' });
    expect(result.filesScanned).toBeGreaterThanOrEqual(1);
  });

  it('含 rm -rf 的 Skill 返回 DANGEROUS', () => {
    const dangerPath = path.join(tmpDir, 'danger-skill.md');
    fs.writeFileSync(dangerPath, '# Danger Skill\n\n```bash\nrm -rf /\n```');
    const result = scanSkillSafety(dangerPath, { mode: 'quiet' });
    expect(result.verdict).toBe('DANGEROUS');
  });

  it('含密钥的 Skill 返回 DANGEROUS', () => {
    const secretPath = path.join(tmpDir, 'secret-skill.md');
    fs.writeFileSync(secretPath, '# Secret\n\n```\nsk-1234567890abcdef123456\n```');
    const result = scanSkillSafety(secretPath, { mode: 'quiet' });
    expect(result.verdict).toBe('DANGEROUS');
  });

  it('目录扫描多个文件', () => {
    const dir = path.join(tmpDir, 'skills');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.md'), '# Skill A');
    fs.writeFileSync(path.join(dir, 'b.md'), '# Skill B');
    const result = scanSkillSafety(dir, { mode: 'quiet' });
    expect(result.filesScanned).toBeGreaterThanOrEqual(2);
  });
});

describe('findFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-evolve-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('按扩展名过滤', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'c.txt'), '');
    const files = findFiles(tmpDir);
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('.ts'))).toBe(true);
  });
});

describe('isEvolveAvailable', () => {
  // ── v1.4.9 G-11 回归锁 ──
  // 旧实现无论模式一律探 `evolve-gate（v1.4.8 自研）`（一个全仓不存在、从未发布的二进制，
  // 名字里还带着一次过宽全局替换留下的 CJK 全角括号）⇒ 恒 false。
  // 旧断言只有 `typeof === 'boolean'` ⇒ **恒 false 也能过**（「守卫空转」形态）：
  // 三个调用方（cli.ts / optimize-skill.ts / auto-trigger.ts）因此全部静默降级/跳过，
  // 把「原生路径没接线」伪装成「外部 CLI 未安装」。
  let dir: string;
  let prevPath: string | undefined;
  let prevGate: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-evolve-avail-'));
    prevPath = process.env.PATH;
    prevGate = process.env.SOFAGENT_EVOLVE_GATE;
  });

  afterEach(() => {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    if (prevGate === undefined) delete process.env.SOFAGENT_EVOLVE_GATE;
    else process.env.SOFAGENT_EVOLVE_GATE = prevGate;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('返回 boolean', () => {
    const result = isEvolveAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('native（缺省）模式恒 true——内置实现零外部依赖，不得因「外部 CLI 不在场」而自降级', () => {
    delete process.env.SOFAGENT_EVOLVE_GATE;
    expect(isEvolveAvailable()).toBe(true);
  });

  it('cli 模式探活真的执行外部二进制（stub exit 0 ⇒ true；stub exit 2 ⇒ false）', () => {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const stub = path.join(binDir, 'skillopt-sleep');
    process.env.SOFAGENT_EVOLVE_GATE = 'cli';
    process.env.PATH = `${binDir}${path.delimiter}${prevPath ?? ''}`;

    // 已安装且 status 成功 ⇒ true
    fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(stub, 0o755);
    expect(isEvolveAvailable()).toBe(true);

    // 探活探测的是**退出码**而不是「文件在不在」：非 0 ⇒ false
    fs.writeFileSync(stub, '#!/bin/sh\nexit 2\n');
    fs.chmodSync(stub, 0o755);
    expect(isEvolveAvailable()).toBe(false);
  });
});

describe('runEvolve · 数据丢失回归锁（v1.4.9 G-17）', () => {
  // ── 被锁住的实案 ──
  // v1.4.8 实态：runEvolve 的 native 分支把**同一个路径**同时传成 candidateDir 与 targetDir，
  // 而 runNativeGate 的 adopt 分支是「删 targetDir → 拷 candidateDir → targetDir」⇒ **自指删除**：
  // 先删掉 live 文件（它同时就是 candidate），再拿已删的源拷贝 ⇒ ENOENT。
  // 该 copyFileSync 在 gate 的 try/catch 之外，异常直穿；runEvolve 当时只 return、不还原 ⇒
  // 调用后目录里只剩 `SKILL.md.gate-bak`，**live 文件永久丢失**。
  const ORIGINAL = '# 技能 v1\n原有内容\n';
  let dir: string;
  let skillPath: string;
  let prevGate: string | undefined;

  beforeEach(() => {
    prevGate = process.env.SOFAGENT_EVOLVE_GATE;
    delete process.env.SOFAGENT_EVOLVE_GATE; // 缺省 = native（G-17 的数据丢失路径就在 native 分支）
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-evolve-dataloss-'));
    skillPath = path.join(dir, 'SKILL.md');
    fs.writeFileSync(skillPath, ORIGINAL, 'utf-8');
  });

  afterEach(() => {
    if (prevGate === undefined) delete process.env.SOFAGENT_EVOLVE_GATE;
    else process.env.SOFAGENT_EVOLVE_GATE = prevGate;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('live 文件不得消失；内容 ∈ {候选, 原文}；回滚面（.gate-bak）仍在', () => {
    const result = runEvolve(skillPath);

    // G-17 的实害就是在这一行失败（旧实现：SKILL.md 已消失）
    expect(fs.existsSync(skillPath)).toBe(true);

    const after = fs.readFileSync(skillPath, 'utf-8');
    expect(after.length).toBeGreaterThan(0);
    // 候选 = live 的 staging 副本 ⇒ 终态应等于原文（此路径不产生新内容，但**不得被换丢**）
    expect(after).toBe(ORIGINAL);

    // 回滚面 + 历史面（native gate 的两项落盘产物）
    expect(fs.existsSync(`${skillPath}.gate-bak`)).toBe(true);
    expect(fs.readFileSync(`${skillPath}.gate-bak`, 'utf-8')).toBe(ORIGINAL);
    expect(fs.existsSync(path.join(dir, '.gate-history.json'))).toBe(true);

    expect(result.success).toBe(true);
    expect(result.candidatePath).toBe(skillPath);
  });

  it('候选落 staging 临时副本 —— 技能目录只多出 .gate-bak / .gate-history.json', () => {
    runEvolve(skillPath);
    expect(fs.readdirSync(dir).sort()).toEqual([
      '.gate-history.json',
      'SKILL.md',
      'SKILL.md.gate-bak',
    ]);
  });

  it('live 文件丢失时从备份恢复并 fail-loud（锁的补救面）', () => {
    // 先造出「备份在、live 不在」的现场：等价于 gate 内部把 live 删了又抛异常
    const backup = `${skillPath}.gate-bak`;
    fs.copyFileSync(skillPath, backup);
    fs.rmSync(skillPath);
    // 直接用公开 API 观察：输入不存在 ⇒ 失败（不得谎报成功）
    const r = runEvolve(skillPath);
    expect(r.success).toBe(false);
    expect(r.error).toContain('不存在');
    // 恢复现场后同一路径可正常跑（证明失败是输入侧判定，不是环境损伤）
    fs.copyFileSync(backup, skillPath);
    expect(runEvolve(skillPath).success).toBe(true);
    expect(fs.readFileSync(skillPath, 'utf-8')).toBe(ORIGINAL);
  });

  it('输入文件不存在 ⇒ 失败（不伪造成功）', () => {
    const r = runEvolve(path.join(dir, 'nope.md'));
    expect(r.success).toBe(false);
    expect(r.error).toContain('不存在');
  });
});
