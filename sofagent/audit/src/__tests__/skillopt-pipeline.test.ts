// ============================================================
// skillopt-pipeline.test.ts · SkillOpt 管道单元测试
// P0-7 新增：验证 SkillOpt 自进化管道 4 个断点已接通
// v1.0.6 bugfix：对齐真实 CLI 契约（status 探活 / run 子命令 / --auto-adopt / 就地演化）
//   用 fake skillopt-sleep 二进制做确定性断言，不再依赖真实 CLI 是否安装。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  chmodSync,
  rmSync,
  readdirSync,
} from 'fs';
import { join, basename, dirname } from 'path';
import { tmpdir } from 'os';
import {
  runSkillOpt,
  validateCandidate,
  isSkillOptAvailable,
} from '../skillopt-integration';

// ---- fake skillopt-sleep harness ----
let fakeDir = '';
let argvLog = '';
let savedPath = '';

function buildFakeScript(): void {
  const lines = [
    '#!/bin/bash',
    'LOG="${SKILLOPT_FAKE_LOG}"',
    'echo "$@" >> "$LOG"',
    'MODE="${SKILLOPT_FAKE_MODE:-evolve}"',
    'tp=""',
    'prev=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "--target-skill-path" ]; then tp="$a"; fi',
    '  prev="$a"',
    'done',
    'if [ "$1" = "run" ] && [ -n "$tp" ]; then',
    '  if [ "$MODE" = "evolve" ]; then',
    "    printf '\\n## Evolved Rule A\\n' >> \"$tp\"",
    '  elif [ "$MODE" = "reject" ]; then',
    "    printf '# Shrunk too much\\nx\\n' > \"$tp\"",
    '  fi',
    'fi',
    'exit 0',
  ];
  writeFileSync(join(fakeDir, 'skillopt-sleep'), lines.join('\n') + '\n', 'utf-8');
  chmodSync(join(fakeDir, 'skillopt-sleep'), 0o755);
}

function readArgvLog(): string[] {
  if (!existsSync(argvLog)) return [];
  return readFileSync(argvLog, 'utf-8').split('\n').filter((l) => l.length > 0);
}

function clearArgvLog(): void {
  if (existsSync(argvLog)) rmSync(argvLog);
}

function findBackup(inputPath: string): string | undefined {
  const dir = dirname(inputPath);
  const prefix = basename(inputPath) + '.bak.';
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix));
  return files.length > 0 ? join(dir, files[0]) : undefined;
}

beforeAll(() => {
  fakeDir = join(tmpdir(), 'skillopt-fake-pipe-' + Date.now());
  mkdirSync(fakeDir, { recursive: true });
  argvLog = join(fakeDir, 'argv.log');
  buildFakeScript();
  savedPath = process.env.PATH || '';
  process.env.SKILLOPT_FAKE_LOG = argvLog;
  process.env.PATH = fakeDir + ':' + savedPath;
});

afterAll(() => {
  process.env.PATH = savedPath;
  delete process.env.SKILLOPT_FAKE_LOG;
  if (fakeDir) rmSync(fakeDir, { recursive: true, force: true });
});

describe('SkillOpt 管道 - runSkillOpt（新 CLI 契约）', () => {
  it('调用 run 子命令 + --auto-adopt + --target-skill-path，并就地演化', () => {
    clearArgvLog();
    process.env.SKILLOPT_FAKE_MODE = 'evolve';
    const tmpFile = join(tmpdir(), 'skillopt-pipe-input.md');
    const inputContent = '# Test SKILL\n\n' + Array.from({ length: 10 }, (_, i) => 'line' + (i + 1)).join('\n') + '\n';
    writeFileSync(tmpFile, inputContent, 'utf-8');

    const result = runSkillOpt(tmpFile, '/tmp/skillopt-pipe-out.md');
    expect(result.success).toBe(true);
    expect(result.candidatePath).toBe(tmpFile); // 就地演化：candidate 即 input

    const runLine = readArgvLog().find((l) => l.trim().split(/\s+/)[0] === 'run');
    expect(runLine).toBeTruthy();
    expect(runLine).toContain('--target-skill-path');
    expect(runLine).toContain(tmpFile);
    expect(runLine).toContain('--auto-adopt');
    expect(runLine).not.toContain('--output'); // 旧 flat 契约已废弃

    expect(readFileSync(tmpFile, 'utf-8')).toContain('Evolved Rule A');
  });

  it('输入文件不存在时返回 error', () => {
    const result = runSkillOpt('/tmp/nonexistent-skill-12345.md', '/tmp/output.md');
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
  });

  it('scoringFilePath 可选参数通过 SKILLOPT_SCORING_FILE 传递，不崩溃', () => {
    clearArgvLog();
    process.env.SKILLOPT_FAKE_MODE = 'evolve';
    const tmpFile = join(tmpdir(), 'skillopt-pipe-eval.md');
    writeFileSync(tmpFile, '# Test SKILL\n', 'utf-8');
    // 传一个不存在的 scoring 文件：runSkillOpt 应忽略它（不设置 env），CLI 仍跑通
    const result = runSkillOpt(tmpFile, '/tmp/out.md', '/tmp/nonexistent-eval.md');
    expect(result.success).toBe(true);
  });
});

describe('SkillOpt 管道 - validateCandidate', () => {
  it('用相同文件内容对比时返回 { canReplace: false }（内容无变化）', () => {
    const tmpDir = join(tmpdir(), 'skillopt-validation-test');
    mkdirSync(tmpDir, { recursive: true });
    const skillContent =
      '# My SKILL\n\n## Description\n\nThis is a skill file.\n\n## Rules\n\n1. Rule one\n2. Rule two\n3. Rule three\n';
    const candidatePath = join(tmpDir, 'candidate.md');
    const currentPath = join(tmpDir, 'current.md');
    writeFileSync(candidatePath, skillContent, 'utf-8');
    writeFileSync(currentPath, skillContent, 'utf-8');
    const result = validateCandidate(candidatePath, currentPath);
    expect(result.canReplace).toBe(false);
    expect(result.reason).toContain('相同');
  });

  it('候选比现任短 30% 以上时返回 canReplace: false', () => {
    const tmpDir = join(tmpdir(), 'skillopt-too-short-test');
    mkdirSync(tmpDir, { recursive: true });
    const currentLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    const candidateLines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`).join('\n');
    const candidatePath = join(tmpDir, 'candidate-too-short.md');
    const currentPath = join(tmpDir, 'current-too-short.md');
    writeFileSync(candidatePath, candidateLines, 'utf-8');
    writeFileSync(currentPath, currentLines, 'utf-8');
    const result = validateCandidate(candidatePath, currentPath);
    expect(result.canReplace).toBe(false);
    expect(result.reason).toContain('短');
  });

  it('候选文件不存在时返回 canReplace: false', () => {
    const result = validateCandidate('/tmp/nonexistent-candidate.md', '/tmp/nonexistent-current.md');
    expect(result.canReplace).toBe(false);
    expect(result.reason).toContain('读取失败');
  });
});

describe('SkillOpt 管道 - validateCandidate 内容对比', () => {
  it('内容完全相同时返回 canReplace: false', () => {
    const tmpDir = join(tmpdir(), 'skillopt-identical-test');
    mkdirSync(tmpDir, { recursive: true });
    const content = '# SKILL\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\n';
    const filePath = join(tmpDir, 'skill.md');
    writeFileSync(filePath, content, 'utf-8');
    const result = validateCandidate(filePath, filePath);
    expect(result.canReplace).toBe(false);
    expect(result.reason).toContain('相同');
  });

  it('变化低于 5% 时返回 canReplace: false', () => {
    const tmpDir = join(tmpdir(), 'skillopt-lowchange-test');
    mkdirSync(tmpDir, { recursive: true });
    const currentLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    const candidateLines = currentLines.replace('Line 50', 'Line 50 modified');
    writeFileSync(join(tmpDir, 'candidate.md'), candidateLines, 'utf-8');
    writeFileSync(join(tmpDir, 'current.md'), currentLines, 'utf-8');
    const result = validateCandidate(join(tmpDir, 'candidate.md'), join(tmpDir, 'current.md'));
    expect(result.canReplace).toBe(false);
    expect(result.reason).toContain('5%');
  });
});

describe('SkillOpt 管道 - CLI skillopt-run（就地演化 + 备份 + 回滚）', () => {
  const distPath = join(__dirname, '..', '..', 'dist', 'index.js');

  it('缺 --input 参数时 exit 1', () => {
    if (!existsSync(distPath)) {
      console.warn('⚠️ dist/index.js 未编译，跳过 CLI 集成测试。先运行 npm run build。');
      return;
    }
    try {
      execFileSync('node', [distPath, 'skillopt-run'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
      expect(false).toBe(true); // 不应该到达这里
    } catch (err: unknown) {
      const execErr = err as { status?: number; stderr?: string; stdout?: string };
      expect(execErr.status).toBe(1);
      const output = (execErr.stdout || '') + (execErr.stderr || '');
      expect(output).toContain('用法');
    }
  });

  it('skillopt-run --input 指向不存在文件时 exit 1', () => {
    if (!existsSync(distPath)) {
      console.warn('⚠️ dist/index.js 未编译，跳过 CLI 集成测试。先运行 npm run build。');
      return;
    }
    try {
      execFileSync('node', [distPath, 'skillopt-run', '--input', '/tmp/nonexistent-skill-for-cli-test.md'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
      expect(false).toBe(true);
    } catch (err: unknown) {
      const execErr = err as { status?: number; stderr?: string; stdout?: string };
      expect(execErr.status).toBe(1);
    }
  });

  it('就地演化 + 备份 + 验证通过：输入文件被演化，原始版本留作备份', () => {
    if (!existsSync(distPath)) {
      console.warn('⚠️ dist/index.js 未编译，跳过 CLI 集成测试。先运行 npm run build。');
      return;
    }
    clearArgvLog();
    process.env.SKILLOPT_FAKE_MODE = 'evolve';
    const workDir = join(tmpdir(), 'skillopt-cli-evolve-' + Date.now());
    mkdirSync(workDir, { recursive: true });
    const inputPath = join(workDir, 'SKILL.md');
    const original = '# Test SKILL\n\n' + Array.from({ length: 10 }, (_, i) => 'line' + (i + 1)).join('\n') + '\n';
    writeFileSync(inputPath, original, 'utf-8');

    let stdout = '';
    try {
      stdout = execFileSync('node', [distPath, 'skillopt-run', '--input', inputPath], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
    } catch (err: unknown) {
      const execErr = err as { status?: number; stdout?: string; stderr?: string };
      throw new Error('skillopt-run 应 exit 0，实际: ' + JSON.stringify(execErr));
    }
    expect(stdout).toContain('自动优化完成');

    // 就地演化：输入文件已变化
    const evolved = readFileSync(inputPath, 'utf-8');
    expect(evolved).toContain('Evolved Rule A');
    expect(evolved).not.toBe(original);

    // 备份文件应存在，且内容为原始版本
    const backup = findBackup(inputPath);
    expect(backup).toBeTruthy();
    if (backup) {
      const backupContent = readFileSync(backup, 'utf-8');
      expect(backupContent).toBe(original);
      expect(backupContent).not.toContain('Evolved Rule A');
    }

    // argv 契约：run --target-skill-path --auto-adopt
    const runLine = readArgvLog().find((l) => l.trim().split(/\s+/)[0] === 'run');
    expect(runLine).toContain('--target-skill-path');
    expect(runLine).toContain('--auto-adopt');
  });

  it('gate 拒绝（MODE=reject，候选过短）→ 回滚至原始版本，exit 0', () => {
    if (!existsSync(distPath)) {
      console.warn('⚠️ dist/index.js 未编译，跳过 CLI 集成测试。先运行 npm run build。');
      return;
    }
    process.env.SKILLOPT_FAKE_MODE = 'reject';
    const workDir = join(tmpdir(), 'skillopt-cli-rollback-' + Date.now());
    mkdirSync(workDir, { recursive: true });
    const inputPath = join(workDir, 'SKILL.md');
    const original = '# Test SKILL\n\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n';
    writeFileSync(inputPath, original, 'utf-8');

    let stdout = '';
    try {
      stdout = execFileSync('node', [distPath, 'skillopt-run', '--input', inputPath], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
    } catch (err: unknown) {
      const execErr = err as { status?: number; stdout?: string; stderr?: string };
      throw new Error('skillopt-run 应 exit 0，实际: ' + JSON.stringify(execErr));
    }
    // 回滚分支：打印回滚提示
    expect(stdout).toContain('回滚');

    // 输入文件应被回滚为原始版本
    const after = readFileSync(inputPath, 'utf-8');
    expect(after).toBe(original);
    expect(after).not.toContain('Shrunk too much');
  });
});
