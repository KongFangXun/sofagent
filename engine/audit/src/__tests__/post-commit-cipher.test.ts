// ============================================================
// post-commit-cipher.test.ts · post-commit 加密态对账回归测试（v1.5.0 TASK-9）
//
// 验收覆盖（任务书验收：三 fixture 各跑一次 + 损坏行 exit 1）：
//   一、全明文：正常对账（命中 → 「审计通过」/ exit 0）
//   二、全密文（SOFAGENT-AGE-V1 前缀行）：降级提示 + exit 0（对账不可用≠失败，必须发声）
//   三、混合态：明文对账命中 + 「跳过 N 条密文行」计数 / exit 0
//   四、真实损坏（非密文前缀的坏 JSON 行）：解析异常提示 + exit 1（损坏必须红）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

const HOOK = resolve(__dirname, '../../hooks/post-commit');

function makeFixtureRepo(): { repo: string; data: string; parentSha: string; treeSha: string; commitSha: string } {
  const base = mkdtempSync(join(tmpdir(), `t9-cipher-${Date.now()}`));
  const repo = join(base, 'repo');
  const data = join(base, 'data');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(data, 'audit'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.email', 'test@sofagent.dev');
  git('config', 'user.name', 'sofagent-test');
  writeFileSync(join(repo, 'f.txt'), 'a\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(repo, 'f.txt'), 'a\nb\n');
  git('add', '.');
  execFileSync('git', ['commit', '-q', '-m', 'fixture commit'], { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_EDITOR: 'true' } });
  return {
    repo,
    data,
    parentSha: execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: repo }).toString().trim(),
    treeSha: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo }).toString().trim(),
    commitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(),
  };
}

/** 跑一次 post-commit hook（返回 stdout+exitCode；exit≠0 时从 error.stdout 取输出） */
function runHook(repo: string, data: string): { out: string; code: number } {
  try {
    // SOFAGENT_AUDIT_ENTRY 显式注入本仓 dist（v1.4.8 通道）：hook 在 tmp repo 里跑，
    // 无注入时按全局解析链走——CI runner 无全局包会 fail-loud（正确行为但非本测试对象）
    const out = execFileSync('bash', [HOOK], {
      cwd: repo,
      env: { ...process.env, SOFAGENT_DATA: data, SOFAGENT_AUDIT_ENTRY: resolve(__dirname, '../../dist/index.js') },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return { out, code: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string };
    return { out: (e.stdout ?? '').toString(), code: e.status ?? 1 };
  }
}

describe('post-commit 加密态对账（v1.5.0 TASK-9）', () => {
  let fx: ReturnType<typeof makeFixtureRepo>;

  beforeEach(() => {
    fx = makeFixtureRepo();
  });

  afterEach(() => {
    try { rmSync(join(fx.repo, '..'), { recursive: true, force: true }); } catch { /* */ }
  });

  it('全明文：对账命中 → 审计通过 / exit 0', () => {
    writeFileSync(
      join(fx.data, 'audit', 'history.jsonl'),
      JSON.stringify({ commitSha: '', commitPhase: 'pre-commit', parentSha: fx.parentSha, task: 'fixture commit', treeSha: fx.treeSha, exitCode: 0 }) + '\n',
    );
    const r = runHook(fx.repo, fx.data);
    expect(r.out).toContain('审计通过');
    expect(r.code).toBe(0);
  });

  it('全密文：降级提示（加密态明文对账不可用 + CI 兜底指引）/ exit 0', () => {
    writeFileSync(
      join(fx.data, 'audit', 'history.jsonl'),
      'SOFAGENT-AGE-V1:AGE[1.10.20].eyJ.line1\nSOFAGENT-AGE-V1:AGE[1.10.20].eyJ.line2\n',
    );
    const r = runHook(fx.repo, fx.data);
    expect(r.out).toContain('加密态');
    expect(r.out).toContain('明文对账不可用');
    expect(r.out).toContain('CI 侧 sofagent-audit --diff 兜底');
    expect(r.code).toBe(0);
  });

  it('混合态：明文对账命中 + 跳过 N 条密文行计数 / exit 0', () => {
    const plain = JSON.stringify({ commitSha: '', commitPhase: 'pre-commit', parentSha: fx.parentSha, task: 'fixture commit', treeSha: fx.treeSha, exitCode: 0 });
    writeFileSync(
      join(fx.data, 'audit', 'history.jsonl'),
      plain + '\n' + 'SOFAGENT-AGE-V1:AGE[1.10.20].eyJ.line1\n' + 'SOFAGENT-AGE-V1:AGE[1.10.20].eyJ.line2\n',
    );
    const r = runHook(fx.repo, fx.data);
    expect(r.out).toContain('审计通过');
    expect(r.out).toContain('跳过 2 条密文行');
    expect(r.code).toBe(0);
  });

  it('真实损坏：非密文前缀坏行 → 解析异常提示 + exit 1（不吞错）', () => {
    writeFileSync(
      join(fx.data, 'audit', 'history.jsonl'),
      'this is not json at all\n{"ok":true}\n',
    );
    const r = runHook(fx.repo, fx.data);
    expect(r.out).toContain('审计历史解析异常');
    expect(r.code).toBe(1);
  });

  it('全明文未命中：原 INFO/WARN 行为不回归（仍 exit 0）', () => {
    writeFileSync(
      join(fx.data, 'audit', 'history.jsonl'),
      JSON.stringify({ commitSha: '', commitPhase: 'pre-commit', parentSha: 'other-sha', task: 'x', exitCode: 0 }) + '\n',
    );
    const r = runHook(fx.repo, fx.data);
    expect(r.out).toContain('未确认审计记录');
    expect(r.code).toBe(0);
  });
});
