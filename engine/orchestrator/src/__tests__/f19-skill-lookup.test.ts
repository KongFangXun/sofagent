// ============================================================
// f19-skill-lookup.test.ts · F19（v1.5.7）安装态 SKILL 查找链行为锁
// ============================================================
// 缺陷背景：install_skill_unified 把 SKILL/ 整树复制到 $SOFAGENT_HOME/skill/
// （agents/<name>/SKILL.md 结构原样），但 builtin-agents 的 loadAgentMd 与
// methodology 的 exportMethodology 都不查该级——安装态（cwd 非仓库根、未设
// SOFAGENT_REPO_ROOT）四 Agent 恒走 fallback 精简版、方法论恒空语料，
// K5 披露的「结构性不可达」由此闭合。
// 用例：
//   一、builtin-agents：$SOFAGENT_HOME/skill/agents 在场 → systemPrompt 非
//      fallback（含真实 SKILL.md 的 frontmatter 身份标签）
//   二、优先级：cwd/SKILL 在场时压过 $SOFAGENT_HOME/skill（仓库根优先）
//   三、methodology：$SOFAGENT_HOME/skill/FDE/GUIDE.md 在场且 cwd 无 FDE →
//      语料完整（complete=true，sections 三段）
//   四、methodology 优先级：cwd/FDE 在场时压过安装副本
// 环境纪律：SOFAGENT_HOME/SOFAGENT_REPO_ROOT 全部临时注入隔离，用毕还原。
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** systemPrompt 在模块加载时求值——每个用例动态 import 前重置模块图，使 env 注入生效 */
async function loadBuiltinAgents(): Promise<typeof import('../builtin-agents')> {
  vi.resetModules();
  return import('../builtin-agents');
}

describe('F19 · builtin-agents 安装态 SKILL 查找链', () => {
  let home: string;
  let cwdBackup: string;
  let homeBackup: string | undefined;
  let repoRootBackup: string | undefined;

  beforeEach(() => {
    home = tmpDir('sof-f19-home-');
    cwdBackup = process.cwd();
    homeBackup = process.env.SOFAGENT_HOME;
    repoRootBackup = process.env.SOFAGENT_REPO_ROOT;
    delete process.env.SOFAGENT_REPO_ROOT; // 路径 0 关闭——隔离出被测层
    process.env.SOFAGENT_HOME = home;
  });

  afterEach(() => {
    process.chdir(cwdBackup);
    if (homeBackup === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = homeBackup;
    if (repoRootBackup === undefined) delete process.env.SOFAGENT_REPO_ROOT;
    else process.env.SOFAGENT_REPO_ROOT = repoRootBackup;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('一、$SOFAGENT_HOME/skill/agents 在场 → systemPrompt 来自安装副本（非 fallback）', async () => {
    // 造安装态 skill 副本（install_skill_unified 落点形态）
    const agentDir = path.join(home, 'skill', 'agents', 'engineer');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'SKILL.md'),
      '---\nname: engineer\ndisplayName: 工程师\n---\n\nF19 安装态真身标记\n',
      'utf-8',
    );
    // cwd 指向无 SKILL/ 的目录（模拟安装态运行环境）
    const fakeCwd = tmpDir('sof-f19-cwd-');
    process.chdir(fakeCwd);
    const { BUILTIN_AGENTS } = await loadBuiltinAgents();
    const engineer = BUILTIN_AGENTS.find((a) => a.name === 'engineer')!;
    expect(engineer.systemPrompt).toContain('F19 安装态真身标记');
    expect(engineer.systemPrompt).toContain('[Agent: engineer');
    fs.rmSync(fakeCwd, { recursive: true, force: true });
  });

  it('二、优先级：cwd/SKILL 在场时压过 $SOFAGENT_HOME/skill（仓库根优先）', async () => {
    // 安装副本（低优先）
    const installedDir = path.join(home, 'skill', 'agents', 'engineer');
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(path.join(installedDir, 'SKILL.md'), '---\nname: engineer\n---\n安装副本内容\n', 'utf-8');
    // cwd 副本（高优先）
    const fakeCwd = tmpDir('sof-f19-cwd-');
    const cwdAgentDir = path.join(fakeCwd, 'SKILL', 'agents', 'engineer');
    fs.mkdirSync(cwdAgentDir, { recursive: true });
    fs.writeFileSync(path.join(cwdAgentDir, 'SKILL.md'), '---\nname: engineer\n---\ncwd 仓库真身内容\n', 'utf-8');
    process.chdir(fakeCwd);
    const { BUILTIN_AGENTS } = await loadBuiltinAgents();
    const engineer = BUILTIN_AGENTS.find((a) => a.name === 'engineer')!;
    expect(engineer.systemPrompt).toContain('cwd 仓库真身内容');
    expect(engineer.systemPrompt).not.toContain('安装副本内容');
    fs.rmSync(fakeCwd, { recursive: true, force: true });
  });
});

describe('F19 · methodology 安装态查找链', () => {
  let home: string;
  let cwdBackup: string;
  let homeBackup: string | undefined;
  let repoRootBackup: string | undefined;
  let allowBackup: string | undefined;

  beforeEach(() => {
    home = tmpDir('sof-f19-mhome-');
    cwdBackup = process.cwd();
    homeBackup = process.env.SOFAGENT_HOME;
    repoRootBackup = process.env.SOFAGENT_REPO_ROOT;
    allowBackup = process.env.SOFAGENT_HOME_ALLOWED_PREFIXES;
    delete process.env.SOFAGENT_REPO_ROOT;
    // core sanitizeSofagentHome 的越界防护：临时放行 tmp 根（用毕还原）
    process.env.SOFAGENT_HOME_ALLOWED_PREFIXES = `${allowBackup ?? ''}:${os.tmpdir()}`;
    process.env.SOFAGENT_HOME = home;
  });

  afterEach(() => {
    process.chdir(cwdBackup);
    if (homeBackup === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = homeBackup;
    if (repoRootBackup === undefined) delete process.env.SOFAGENT_REPO_ROOT;
    else process.env.SOFAGENT_REPO_ROOT = repoRootBackup;
    if (allowBackup === undefined) delete process.env.SOFAGENT_HOME_ALLOWED_PREFIXES;
    else process.env.SOFAGENT_HOME_ALLOWED_PREFIXES = allowBackup;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  /** 造一份三锚点齐全的最小 GUIDE.md */
  function minimalGuide(): string {
    return [
      '# FDE GUIDE',
      '<!-- METHODOLOGY: five-elements -->',
      '五要素内容（足够长以通过完整性判定的段落文本占位）。',
      '<!-- METHODOLOGY: three-questions -->',
      '三问判定内容（同样足够长度的占位文本）。',
      '<!-- METHODOLOGY: quantification -->',
      '量化公式内容（占位文本第三段）。',
    ].join('\n');
  }

  it('三、$SOFAGENT_HOME/skill/FDE/GUIDE.md 在场且 cwd 无 FDE → 语料完整', async () => {
    const fdeDir = path.join(home, 'skill', 'FDE');
    fs.mkdirSync(fdeDir, { recursive: true });
    fs.writeFileSync(path.join(fdeDir, 'GUIDE.md'), minimalGuide(), 'utf-8');
    const fakeCwd = tmpDir('sof-f19-mcwd-');
    process.chdir(fakeCwd);
    const { exportMethodology } = await import('@sofagent/core'); // core 侧函数非模块级求值，直接取
    const corpus = exportMethodology();
    expect(corpus.complete).toBe(true);
    expect(corpus.sections).toHaveLength(3);
    expect(corpus.guidePath).toBe(path.join(home, 'skill', 'FDE', 'GUIDE.md'));
    fs.rmSync(fakeCwd, { recursive: true, force: true });
  });

  it('四、优先级：cwd/FDE 在场时压过安装副本', async () => {
    const fdeDir = path.join(home, 'skill', 'FDE');
    fs.mkdirSync(fdeDir, { recursive: true });
    fs.writeFileSync(path.join(fdeDir, 'GUIDE.md'), minimalGuide(), 'utf-8');
    const fakeCwd = tmpDir('sof-f19-mcwd-');
    const cwdFde = path.join(fakeCwd, 'FDE');
    fs.mkdirSync(cwdFde, { recursive: true });
    fs.writeFileSync(path.join(cwdFde, 'GUIDE.md'), '# 空 GUIDE（无锚点）\n', 'utf-8');
    process.chdir(fakeCwd);
    const { exportMethodology } = await import('@sofagent/core'); // core 侧函数非模块级求值，直接取
    // cwd 副本在场但不完整 → 不用安装副本兜底？（语义：一级 complete 才返回——
    // 不完整时确实查二级。这里断言「cwd 完整优先」：换成完整 cwd 副本再测
    fs.writeFileSync(path.join(cwdFde, 'GUIDE.md'), minimalGuide().replace('五要素内容', 'cwd 五要素内容'), 'utf-8');
    const corpus = exportMethodology();
    expect(corpus.complete).toBe(true);
    // macOS /var → /private/var symlink：两侧 realpath 归一后比对
    expect(fs.realpathSync(corpus.guidePath)).toBe(fs.realpathSync(path.join(fakeCwd, 'FDE', 'GUIDE.md')));
    expect(corpus.sections.some((s) => s.raw.includes('cwd 五要素内容'))).toBe(true);
    fs.rmSync(fakeCwd, { recursive: true, force: true });
  });
});
