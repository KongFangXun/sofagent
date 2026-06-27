// ============================================================
// verify-evidence.test.ts · 最小可信验证器测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { verifyEvidence } from './verify-evidence';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sofagent-verify-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeLog(fileName: string, content: string): string {
  const filePath = join(tempDir, fileName);
  const dir = join(tempDir, fileName.split('/').slice(0, -1).join('/'));
  if (dir !== tempDir) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('verifyEvidence', () => {
  it('日志文件不存在 → exit 1', () => {
    const nonExistent = join(tempDir, 'nonexistent.md');
    const result = verifyEvidence(nonExistent, true);
    expect(result).toBe(1);
  });

  it('日志中有 test pass → exit 0', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志',
      '',
      'npm test 运行结果：',
      '  ✓ test 1 pass',
      '  ✓ test 2 pass',
      '  exit.code: 0',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(0);
  });

  it('日志中有 lint 记录 → exit 0', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志',
      '',
      'eslint 检查通过',
      'prettier 格式化完成',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(0);
  });

  it('日志中有 build success → exit 0', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志',
      '',
      'npm run build',
      'build success',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(0);
  });

  it('日志中无任何证据 → exit 1', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志',
      '',
      '今天修改了配置文件',
      '没有运行任何验证',
      '纯手工操作',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(1);
  });

  it('日志中有中文测试通过关键词 → exit 0', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志',
      '',
      '测试通过：全部 10 个测试',
      '测试结果：通过',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(0);
  });

  it('日志中有 ❌ fail 负向证据 → exit 1（不视为已验证）', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志',
      '',
      '❌ test fail: expected 1 got 2',
      '❌ fail: timeout',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(1);
  });

  it('日志中有 make 命令 → exit 0', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志',
      '',
      'make 编译项目',
      'make build 成功',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(0);
  });

  it('"make sure" 不触发 BUILD 证据 → exit 1', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志', '',
      'make sure the config is correct',
      'make a decision about routing',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(1);
  });

  it('"splinter" 不触发 LINT 证据 → exit 1', () => {
    const logPath = writeLog('log.md', [
      '## 任务日志', '',
      'removed a splinter from the wood',
      'a glint of light',
    ].join('\n'));
    const result = verifyEvidence(logPath, true);
    expect(result).toBe(1);
  });
});
