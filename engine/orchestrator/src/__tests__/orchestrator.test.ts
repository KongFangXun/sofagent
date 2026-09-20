// ============================================================
// orchestrator.test.ts · 编排器测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadDefinition, listAgents, BUILTIN_AGENTS } from '../index';

describe('loadDefinition', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-orch-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('文件不存在时返回 null', () => {
    const def = loadDefinition('/nonexistent/agent.yml');
    expect(def).toBeNull();
  });

  it('有效 YAML 返回 SubAgentDefinition', () => {
    const ymlPath = path.join(tmpDir, 'agent.yml');
    fs.writeFileSync(ymlPath, 'name: test-agent\ndescription: A test agent\n');
    const def = loadDefinition(ymlPath);
    expect(def).not.toBeNull();
    expect(def!.name).toBe('test-agent');
    expect(def!.description).toBe('A test agent');
  });
});

describe('listAgents', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-orch-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('返回包含内置 Agent 的数组', () => {
    const agents = listAgents(tmpDir);
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });
});

describe('BUILTIN_AGENTS', () => {
  it('包含 fde、audit、engineer 和 reviewer', () => {
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(names).toContain('fde');
    expect(names).toContain('audit');
    expect(names).toContain('engineer');
    expect(names).toContain('reviewer');
  });

  it('所有内置 Agent 有 name 和 description', () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(typeof agent.name).toBe('string');
      expect(agent.name.length).toBeGreaterThan(0);
      expect(typeof agent.description).toBe('string');
      expect(agent.description.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// v1.5.1 K2 · engineer / reviewer 的 systemPrompt 不再恒走 fallback
// ------------------------------------------------------------
// 改前缺陷：同文件有两个同职责加载器——
//   `loadAgentMd`（查 SKILL/agents/<name>/SKILL.md，带 warn）供 fde/audit；
//   `loadAgentMdFile`（查 FORGE/agents/<name>.md → agents/<name>.md，**无 warn**）
//   供 engineer/reviewer。而后两条路径在本仓**均不存在**，真定义却在
//   SKILL/agents/<name>/SKILL.md ⇒ 这 2 个 Agent 的 systemPrompt **恒为内置
//   fallback 且静默**（4 个内置 Agent 中 2 个降级）。
// 改后：统一到 loadAgentMd 一个实现，4 个 Agent 走同一查找链。
// 本用例锁「engineer/reviewer 的 systemPrompt 含 SKILL 文件特征串（= 真定义已加载）」。
// ============================================================
describe('K2 · 内置 Agent systemPrompt 加载（不再静默降级）', () => {
  it('engineer / reviewer 的 systemPrompt 不是内置 fallback（含 SKILL 文件特征串）', () => {
    for (const name of ['engineer', 'reviewer'] as const) {
      const agent = BUILTIN_AGENTS.find((a) => a.name === name);
      expect(agent, `内置 Agent ${name} 应存在`).toBeDefined();
      const prompt = agent!.systemPrompt;
      // SKILL/agents/<name>/SKILL.md 经 parseSkillMd 后带身份标签头（`[Agent: ... ]`）
      expect(prompt).toContain('[Agent:');
      expect(prompt).toContain(name);
      // 内置 fallback 的首句是关键区分点——出现即说明降级了
      expect(prompt).not.toContain('你是最小变更工程师，FORGE 自迭代循环中的代码执行者');
      expect(prompt).not.toContain('你是代码审查员，FORGE 自迭代循环中的审查者');
    }
  });

  it('fde / audit 行为不变（仍走同一加载器，systemPrompt 含身份标签头）', () => {
    for (const name of ['fde', 'audit'] as const) {
      const agent = BUILTIN_AGENTS.find((a) => a.name === name);
      expect(agent).toBeDefined();
      expect(agent!.systemPrompt).toContain('[Agent:');
    }
  });

  it('4 个内置 Agent 的业务定义与 fallback 文本未被改动（只改加载路径与留痕）', () => {
    const byName = Object.fromEntries(BUILTIN_AGENTS.map((a) => [a.name, a]));
    expect(byName['engineer']!.description).toBe('软件工程师——只修复被要求的内容，拒绝范围蔓延，逐行自证差异');
    expect(byName['reviewer']!.description).toBe('代码审查员——提供建设性、可操作的反馈，聚焦正确性、可维护性、安全性和性能');
    expect(byName['fde']!.type).toBe('development');
    expect(byName['audit']!.type).toBe('audit');
  });
});

// ============================================================
// v1.5.1 J4b-③ · orchestrator-compare 的三处「静默缩小分母」
// ------------------------------------------------------------
// 改前缺陷（逐处）：
//   ① `readAbState` 损坏文件 → 返回 consecutiveWins=0 的零初值 → 灰度对比历史被
//      **清零**，本该连续 2 胜才 promote，清零后下一次胜出即 promote
//      = 可直接触发错误晋升判定，且无任何告警。
//   ② `extractMetrics` 逐文件读失败静默跳过 → `firstPassRate = pass/(pass+fail)`
//      的**分母静默变小**，报告分不清「真的没有失败」与「这个文件没读到」。
// 改后：① 两态可区分（「无历史」ok / 「读失败」!ok）且**fail-closed 不写状态**；
//      ② `readFailures` / `scannedFiles` 进指标并出现在报告的分母口径行。
// ============================================================
describe('orchestrator-compare A/B 状态与日志读取（v1.5.1 J4b-③）', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-compare-'));
  });

  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* */ }
  });

  /** 造一个含单层子目录 + 一个 .md 日志的指标目录（scanLogFiles 只进一层子目录） */
  function makeLogDir(name: string, body: string): string {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'run-1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'run-1', 'session.md'), body, 'utf-8');
    return dir;
  }

  it('① 读不到的日志进 readFailures（分母口径显式化，不再静默缩小）', async () => {
    const dir = makeLogDir('cur', '状态：成功\n');
    const unreadable = path.join(dir, 'run-1', 'locked.md');
    fs.writeFileSync(unreadable, '状态：失败\n', 'utf-8');
    fs.chmodSync(unreadable, 0o000);
    // 以 root 运行时 chmod 000 仍可读——此时本用例的缺陷面无法复现，如实跳过
    let canStillRead = false;
    try { fs.readFileSync(unreadable, 'utf-8'); canStillRead = true; } catch { /* 预期 */ }
    if (canStillRead) return;

    const { extractMetrics } = await import('../orchestrator-compare');
    const m = extractMetrics(dir);
    expect(m.scannedFiles).toBe(2);
    expect(m.readFailures).toBe(1);
  });

  it('② 报告给出分母口径行，且 wins on X/M 只数可比较指标（M 不被信息行稀释）', async () => {
    const cur = makeLogDir('cur2', '状态：成功\n');
    const cand = makeLogDir('cand2', '🔴 状态：失败\n');
    const { extractMetrics, generateReport } = await import('../orchestrator-compare');
    const report = generateReport(extractMetrics(cur), extractMetrics(cand), '2026-01-01');
    // 分母口径行存在（读失败数可见）
    expect(report).toContain('| Unreadable logs |');
    // 可比较指标恒为 3 条（Audit violations / Avg steps / First-pass rate）
    const m = report.match(/wins on (\d+)\/(\d+) metrics/);
    if (m) expect(m[2]).toBe('3');
  });

  it('③ ab-state.json 损坏 → fail-closed：告警且**不改写**状态文件（不误晋升）', async () => {
    const dataDir = path.join(root, 'data');
    const orchDir = path.join(dataDir, 'orchestrator');
    fs.mkdirSync(orchDir, { recursive: true });
    const statePath = path.join(orchDir, 'ab-state.json');
    const CORRUPT = '{corrupt json';
    fs.writeFileSync(statePath, CORRUPT, 'utf-8');

    const cur = makeLogDir('cur3', '状态：成功\n');
    // candidate 首过率更高 → winner=candidate → 走「连续胜出计数 + 可能 promote」分支
    const cand = makeLogDir('cand3', '状态：成功\n');
    const outDir = path.join(root, 'out');
    fs.mkdirSync(outDir, { recursive: true });

    const savedArgv = process.argv;
    const savedData = process.env.SOFAGENT_DATA;
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(String(a[0])); });
    try {
      process.env.SOFAGENT_DATA = dataDir;
      // 触发模块底部的 `if (process.argv[1]?.includes('orchestrate-compare')) main();`
      process.argv = ['node', '/tmp/orchestrate-compare', '--current', cur, '--candidate', cand, '--output', outDir];
      vi.resetModules();
      await import('../orchestrator-compare');
    } finally {
      logSpy.mockRestore();
      process.argv = savedArgv;
      if (savedData === undefined) delete process.env.SOFAGENT_DATA;
      else process.env.SOFAGENT_DATA = savedData;
    }

    const out = logs.join('\n');
    expect(out).toContain('A/B 状态文件损坏');
    expect(out).toContain('已跳过本次计数与晋升判定');
    // fail-closed：状态文件原样保留（未被零初值覆写）
    expect(fs.readFileSync(statePath, 'utf-8')).toBe(CORRUPT);
  });
});
