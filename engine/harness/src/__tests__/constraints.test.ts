// ============================================================
// constraints.test.ts · buildConstrainedSystemPrompt 四层加载链测试
// v1.4.4 第九章 #73：占位重写——原「无配置返回空」单断言
// 同义反复（typeof 永真），改为行为级验证。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildConstrainedSystemPrompt } from '../index';

describe('buildConstrainedSystemPrompt', () => {
  let tmpDir: string;
  let tmpHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-harness-test-'));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-home-'));
    // v1.4.9 P1-4：读侧新增「用户级 custom 层回退」（{SOFAGENT_HOME}/skill/custom）。
    // 不隔离 SOFAGENT_HOME 时，开发机真实的 ~/.sofagent/skill/custom/*-overrides.md
    // 会被注入，「目录不存在 → 空串」类断言将随本机状态时红时绿。
    prevHome = process.env.SOFAGENT_HOME;
    process.env.SOFAGENT_HOME = tmpHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = prevHome;
    for (const d of [tmpDir, tmpHome]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
    }
  });

  const writeSkill = (name: string, content: string) => {
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.sofagent', name), content, 'utf-8');
  };

  it('目录不存在时返回空字符串（无约束可加载）', () => {
    const result = buildConstrainedSystemPrompt(path.join(tmpDir, 'nonexistent'));
    expect(result).toBe('');
  });

  it('宪法层：SKILL.md 被加载并带层标签', () => {
    writeSkill('SKILL.md', '# 底线\n- 不越权');
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toContain('# 宪法约束');
    expect(result).toContain('- 不越权');
  });

  it('三层拼接顺序：宪法 → 企业规则 → 历史经验', () => {
    writeSkill('SKILL.md', 'constitution-marker');
    writeSkill('fde.md', 'enterprise-marker');
    writeSkill('think.md', 'reflection-marker');
    const result = buildConstrainedSystemPrompt(tmpDir);
    const iConst = result.indexOf('# 宪法约束');
    const iFde = result.indexOf('# 企业规则');
    const iThink = result.indexOf('# 历史经验');
    // 三层都加载且顺序正确（加载链顺序是产品行为）
    expect(iConst).toBeGreaterThanOrEqual(0);
    expect(iFde).toBeGreaterThan(iConst);
    expect(iThink).toBeGreaterThan(iFde);
    expect(result).toContain('constitution-marker');
    expect(result).toContain('enterprise-marker');
    expect(result).toContain('reflection-marker');
  });

  it('skillDir 参数可覆盖子目录名（测试隔离用）', () => {
    fs.mkdirSync(path.join(tmpDir, 'custom-skill'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'custom-skill', 'SKILL.md'), 'custom-dir-marker', 'utf-8');
    const result = buildConstrainedSystemPrompt(tmpDir, { skillDir: 'custom-skill' });
    expect(result).toContain('custom-dir-marker');
  });
});

// ============================================================
// v1.4.9 P1-4 · 写入根 vs 读取根不一致——用户级 custom 层回退
// ============================================================
// 写侧（orchestrator/instinct/evolver.ts:76）落 {SOFAGENT_HOME}/skill/custom/，
// 读侧此前只扫 <projectRoot>/<skillDir>/custom/ ⇒ evolve 产物落盘后永远读不到。
// 现口径：项目级优先、用户级补足（同一目录不重复注入）。
describe('P1-4 · 用户级 custom 层回退（evolve 产物可读性）', () => {
  let projectRoot: string;
  let engineHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-p14-proj-'));
    engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-p14-home-'));
    prevHome = process.env.SOFAGENT_HOME;
    process.env.SOFAGENT_HOME = engineHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = prevHome;
    for (const d of [projectRoot, engineHome]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
    }
  });

  /** 模拟 evolver 落点：{SOFAGENT_HOME}/skill/custom/<name>-overrides.md */
  function evolveWriteOverrides(name: string, marker: string): string {
    const dir = path.join(engineHome, 'skill', 'custom');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}-overrides.md`);
    fs.writeFileSync(file, marker, 'utf-8');
    return file;
  }

  /** 项目级 custom 覆盖（旧读侧唯一路径） */
  function projectWriteOverrides(name: string, marker: string): string {
    const dir = path.join(projectRoot, '.sofagent', 'custom');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}-overrides.md`);
    fs.writeFileSync(file, marker, 'utf-8');
    return file;
  }

  it('① 项目级无 custom/ 目录时仍能读到用户级 overrides（旧实现此处为空）', () => {
    evolveWriteOverrides('evolved-01-x', 'USER-LEVEL-OVERRIDE-MARKER');
    expect(fs.existsSync(path.join(projectRoot, '.sofagent', 'custom'))).toBe(false);
    const prompt = buildConstrainedSystemPrompt(projectRoot);
    expect(prompt).toContain('# 用户自定义规则（custom/）');
    expect(prompt).toContain('USER-LEVEL-OVERRIDE-MARKER');
  });

  it('② 项目级优先：两级都有时项目级段在前（后加载 = 优先级更高）', () => {
    projectWriteOverrides('proj-a', 'PROJECT-LEVEL-MARKER');
    evolveWriteOverrides('user-a', 'USER-LEVEL-MARKER');
    const prompt = buildConstrainedSystemPrompt(projectRoot);
    const iProject = prompt.indexOf('PROJECT-LEVEL-MARKER');
    const iUser = prompt.indexOf('USER-LEVEL-MARKER');
    expect(iProject).toBeGreaterThanOrEqual(0);
    expect(iUser).toBeGreaterThanOrEqual(0);
    expect(iProject).toBeLessThan(iUser);
  });

  it('② 项目级占满 maxFiles(4) 时用户级不再注入（余量为 0）', () => {
    for (let i = 1; i <= 4; i++) projectWriteOverrides(`proj-${i}`, `PROJ-${i}-MARKER`);
    evolveWriteOverrides('user-z', 'SHOULD-NOT-APPEAR');
    const prompt = buildConstrainedSystemPrompt(projectRoot);
    expect(prompt).toContain('PROJ-4-MARKER');
    expect(prompt).not.toContain('SHOULD-NOT-APPEAR');
  });

  it('② 两级解析到同一目录时不重复注入', () => {
    evolveWriteOverrides('dup-a', 'DUP-MARKER');
    // projectRoot = {SOFAGENT_HOME} 且 skillDir = 'skill' ⇒ 项目级目录 == 用户级目录
    const prompt = buildConstrainedSystemPrompt(engineHome, { skillDir: 'skill' });
    expect(prompt).toContain('DUP-MARKER');
    expect(prompt.split('DUP-MARKER').length - 1).toBe(1);
  });
});
