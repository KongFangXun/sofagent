// ============================================================
// skillopt-integration.test.ts · SkillOpt 集成单元测试
// v1.0.6 bugfix：对齐真实 skillopt-sleep CLI 契约测试
//   用 fake `skillopt-sleep` 二进制断言 argv 契约（status 探活 / run 子命令 /
//   --auto-adopt / 就地演化），避免依赖真实 CLI 是否安装或是否触发真实 LLM。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  runSkillOpt,
  validateCandidate,
  isSkillOptAvailable,
} from '../skillopt-integration';

// ---- fake skillopt-sleep harness ----
// 用一个 bash 假二进制验证真实 CLI 契约：
//   - isSkillOptAvailable 必须调用 `status`
//   - runSkillOpt 必须调用 `run --target-skill-path <input> --auto-adopt`
//   - 就地演化：run 时把候选写回 --target-skill-path 指向的文件
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

beforeAll(() => {
  fakeDir = join(tmpdir(), 'skillopt-fake-' + Date.now());
  mkdirSync(fakeDir, { recursive: true });
  argvLog = join(fakeDir, 'argv.log');
  buildFakeScript();
  savedPath = process.env.PATH || '';
  process.env.SKILLOPT_FAKE_LOG = argvLog;
  // 让 fake 优先于真实 skillopt-sleep（若 PATH 中已有）
  process.env.PATH = fakeDir + ':' + savedPath;
});

afterAll(() => {
  process.env.PATH = savedPath;
  delete process.env.SKILLOPT_FAKE_LOG;
  if (fakeDir) rmSync(fakeDir, { recursive: true, force: true });
});

describe('isSkillOptAvailable', () => {
  it('探测使用的是 `status` 子命令且返回 boolean', () => {
    clearArgvLog();
    const result = isSkillOptAvailable();
    expect(typeof result).toBe('boolean');
    // fake `status` 退出 0 → 应可用
    expect(result).toBe(true);
    const log = readArgvLog();
    const probedStatus = log.some((l) => l.trim().split(/\s+/)[0] === 'status');
    expect(probedStatus).toBe(true);
  });

  it('CLI 不可用时（PATH 中无 skillopt-sleep）返回 false', () => {
    const bareDir = join(tmpdir(), 'skillopt-bare-' + Date.now());
    mkdirSync(bareDir, { recursive: true });
    const prevPath = process.env.PATH;
    process.env.PATH = bareDir; // 该目录里没有任何 skillopt-sleep
    try {
      expect(isSkillOptAvailable()).toBe(false);
    } finally {
      process.env.PATH = prevPath;
      rmSync(bareDir, { recursive: true, force: true });
    }
  });
});

describe('runSkillOpt', () => {
  it('输入文件不存在时返回 error（不调用 CLI）', () => {
    clearArgvLog();
    const result = runSkillOpt('/tmp/nonexistent-skill-12345.md', '/tmp/output.md');
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
    // 不应触达 CLI
    expect(readArgvLog().length).toBe(0);
  });

  it('调用真实子命令 `run --target-skill-path <input> --auto-adopt` 并就地演化 input', () => {
    clearArgvLog();
    process.env.SKILLOPT_FAKE_MODE = 'evolve';
    const tmpFile = join(tmpdir(), 'skillopt-evolve-input.md');
    const inputContent = '# Test SKILL\n\n' + Array.from({ length: 10 }, (_, i) => 'line' + (i + 1)).join('\n') + '\n';
    writeFileSync(tmpFile, inputContent, 'utf-8');

    const result = runSkillOpt(tmpFile, '/tmp/skillopt-output-deprecated.md');

    expect(result.success).toBe(true);
    // 就地演化：candidate 即 input 本身
    expect(result.candidatePath).toBe(tmpFile);

    // argv 契约：status 之外必须出现 `run --target-skill-path <tmpFile> --auto-adopt`
    const log = readArgvLog();
    const runLine = log.find((l) => l.trim().split(/\s+/)[0] === 'run');
    expect(runLine).toBeTruthy();
    expect(runLine).toContain('--target-skill-path');
    expect(runLine).toContain(tmpFile);
    expect(runLine).toContain('--auto-adopt');
    expect(runLine).not.toContain('--output'); // 旧 flat 契约已废弃

    // 就地演化：input 文件被修改（fake 追加了演化内容）
    const evolved = readFileSync(tmpFile, 'utf-8');
    expect(evolved).toContain('Evolved Rule A');
  });

  it('gate 未接受（MODE=none）时 input 保持不变，仍 success:true', () => {
    clearArgvLog();
    process.env.SKILLOPT_FAKE_MODE = 'none';
    const tmpFile = join(tmpdir(), 'skillopt-nochange-input.md');
    const original = '# Test SKILL\n\nline1\nline2\n';
    writeFileSync(tmpFile, original, 'utf-8');

    const result = runSkillOpt(tmpFile);
    expect(result.success).toBe(true);

    const after = readFileSync(tmpFile, 'utf-8');
    expect(after).toBe(original); // 未演化
  });
});

describe('validateCandidate', () => {
  it('候选文件不存在时返回 false', () => {
    const result = validateCandidate('/tmp/nonexistent-candidate.md', '/tmp/nonexistent-current.md');
    expect(result.canReplace).toBe(false);
    expect(result.reason).toContain('读取失败');
  });

  it('内容完全相同时返回 canReplace: false（就地演化后无变化）', () => {
    const tmpDir = join(tmpdir(), 'skillopt-identical-test');
    mkdirSync(tmpDir, { recursive: true });
    const content = '# SKILL\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\n';
    const filePath = join(tmpDir, 'skill.md');
    writeFileSync(filePath, content, 'utf-8');
    const result = validateCandidate(filePath, filePath);
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
});
