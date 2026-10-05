// ============================================================
// f14-proposer-cli.test.ts · F14（v1.5.7）evolve propose 子命令接线测试
// ============================================================
// 缺陷背景：buildProposerPrompt / parseProposalWithSafety 此前只在 barrel
// 再导出零生产调用（「诞生即死」）。本批接进 CLI（sofagent evolve propose）。
// 用例：
//   一、正例：--wiki 拼 prompt（含三源输入与输出格式约束）
//   二、正例：--output 解析良性模型产物 → SAFE（可进 gate）
//   三、安全闸负例：模型产物 diff 含危险模式（rm -rf）→ 拒绝 exit 1
//   四、安全闸负例：无 JSON 模型产物 → parse 层拒绝 exit 1
// 执行形态：spawn CLI dist（cli.js）——接线级验证（非纯函数单测，
// proposer.ts 纯函数行为已有其单测覆盖面）。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLI_BIN = path.join(__dirname, '..', '..', 'dist', 'cli.js');

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sof-f14-'));
}

interface RunResult { status: number | undefined; output: string }

function runCli(args: string[], cwd: string): RunResult {
  try {
    const output = execFileSync(process.execPath, [CLI_BIN, ...args], {
      encoding: 'utf-8',
      cwd,
      env: { ...process.env, SOFAGENT_SINGLE_ENTRY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: String(output) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('F14 · evolve propose 子命令（proposer 链路接线）', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('一、--wiki 拼装提案 prompt（含三源标题与严格 JSON 输出约束）', () => {
    fs.writeFileSync(path.join(dir, 'wiki-index.md'), '# wiki 索引\n现有技能面……', 'utf-8');
    const r = runCli(['propose', '--wiki', path.join(dir, 'wiki-index.md')], dir);
    expect(r.status).toBe(0);
    expect(r.output).toContain('技能更新提案任务（Skill Proposer）');
    expect(r.output).toContain('输入一：wiki 索引');
    expect(r.output).toContain('严格 JSON');
    expect(r.output).toContain('现有技能面');
  });

  it('二、--output 解析良性模型产物 → SAFE 裁决 exit 0', () => {
    fs.writeFileSync(path.join(dir, 'wiki-index.md'), 'wiki', 'utf-8');
    const modelOutput = '```json\n{"title":"修复 A 规则误报","solves":["fail-001"],"targetSkillPath":"SKILL/rules/core-rules.md","diff":"--- a/SKILL.md\\n+++ b/SKILL.md\\n@@ -1 +1 @@\\n+fixed line"}\n```';
    const outPath = path.join(dir, 'model-output.md');
    fs.writeFileSync(outPath, modelOutput, 'utf-8');
    const r = runCli(['propose', '--wiki', path.join(dir, 'wiki-index.md'), '--output', outPath], dir);
    expect(r.status).toBe(0);
    expect(r.output).toContain('SAFE（可进 gate）');
    expect(r.output).toContain('修复 A 规则误报');
  });

  it('三、安全闸负例：diff 含 rm -rf 危险模式 → 拒绝 exit 1', () => {
    fs.writeFileSync(path.join(dir, 'wiki-index.md'), 'wiki', 'utf-8');
    const modelOutput = '{"title":"恶意提案","solves":["fail-001"],"targetSkillPath":"SKILL.md","diff":"rm -rf / 重要数据"}';
    const outPath = path.join(dir, 'evil-output.json');
    fs.writeFileSync(outPath, modelOutput, 'utf-8');
    const r = runCli(['propose', '--wiki', path.join(dir, 'wiki-index.md'), '--output', outPath], dir);
    expect(r.status).toBe(1);
    expect(r.output).toContain('DANGEROUS');
    expect(r.output).toContain('拒绝进 gate');
  });

  it('四、安全闸负例：无 JSON 模型产物 → parse 层拒绝 exit 1', () => {
    fs.writeFileSync(path.join(dir, 'wiki-index.md'), 'wiki', 'utf-8');
    const outPath = path.join(dir, 'garbage.txt');
    fs.writeFileSync(outPath, '这不是 JSON，模型跑偏了', 'utf-8');
    const r = runCli(['propose', '--wiki', path.join(dir, 'wiki-index.md'), '--output', outPath], dir);
    expect(r.status).toBe(1);
    expect(r.output).toContain('拒绝进 gate');
  });
});
