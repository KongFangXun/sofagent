// ============================================================
// skillopt-pipeline.test.ts · SkillOpt 管道单元测试
// P0-7 新增：验证 SkillOpt 自进化管道 4 个断点已接通
// ============================================================

import { describe, it, expect } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  runSkillOpt,
  validateCandidate,
  isSkillOptAvailable,
} from '../skillopt-integration';

describe('SkillOpt 管道 - runSkillOpt', () => {
  it('skillopt-sleep 不可用时返回 { success: false, error: ... }', () => {
    // skillopt-sleep 是 Python 包，CI 环境通常未安装——应返回 success: false
    // 但不能 crash
    const tmpFile = join(tmpdir(), 'skillopt-test-input.md');
    writeFileSync(tmpFile, '# Test SKILL\n', 'utf-8');
    const result = runSkillOpt(tmpFile, join(tmpdir(), 'skillopt-test-output.md'));
    // skillopt-sleep 不可用时 success 应为 false
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('输入文件不存在时返回 error', () => {
    const result = runSkillOpt('/tmp/nonexistent-skill-12345.md', '/tmp/output.md');
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
  });
});

describe('SkillOpt 管道 - validateCandidate', () => {
  it('用相同文件内容对比时返回 { canReplace: false }（内容无变化）', () => {
    const tmpDir = join(tmpdir(), 'skillopt-validation-test');
    mkdirSync(tmpDir, { recursive: true });

    const skillContent = '# My SKILL\n\n## Description\n\nThis is a skill file.\n\n## Rules\n\n1. Rule one\n2. Rule two\n3. Rule three\n';
    const candidatePath = join(tmpDir, 'candidate.md');
    const currentPath = join(tmpDir, 'current.md');

    writeFileSync(candidatePath, skillContent, 'utf-8');
    writeFileSync(currentPath, skillContent, 'utf-8');

    // 内容完全相同时 validateCandidate 应拒绝替换
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

describe('SkillOpt 管道 - CLI skillopt-run', () => {
  it('缺 --input 参数时 exit 1', () => {
    // 调用编译后的 index.js，缺 --input 时应 exit 1
    const distPath = join(__dirname, '..', '..', 'dist', 'index.js');
    if (!existsSync(distPath)) {
      // dist 未编译时跳过（CI 先 build 再 test）
      console.warn('⚠️ dist/index.js 未编译，跳过 CLI 集成测试。先运行 npm run build。');
      return;
    }
    try {
      execFileSync('node', [distPath, 'skillopt-run'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
      // 如果没抛异常，说明 exit 0——测试失败
      expect(false).toBe(true); // 不应该到达这里
    } catch (err: unknown) {
      const execErr = err as { status?: number; stderr?: string; stdout?: string };
      // 应该 exit 1
      expect(execErr.status).toBe(1);
      // 输出应包含用法提示
      const output = (execErr.stdout || '') + (execErr.stderr || '');
      expect(output).toContain('用法');
    }
  });

  it('skillopt-run --input 指向不存在文件时 exit 1', () => {
    const distPath = join(__dirname, '..', '..', 'dist', 'index.js');
    if (!existsSync(distPath)) {
      console.warn('⚠️ dist/index.js 未编译，跳过 CLI 集成测试。先运行 npm run build。');
      return;
    }
    try {
      execFileSync('node', [distPath, 'skillopt-run', '--input', '/tmp/nonexistent-skill-for-cli-test.md'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
      expect(false).toBe(true);
    } catch (err: unknown) {
      const execErr = err as { status?: number; stderr?: string; stdout?: string };
      expect(execErr.status).toBe(1);
    }
  });
});

describe('SkillOpt 管道 - scoring 参数传递', () => {
  it('runSkillOpt 接受第三个参数 scoringFilePath（可选），传不存在文件不 crash', () => {
    const tmpFile = join(tmpdir(), 'skillopt-scoring-test-input.md');
    writeFileSync(tmpFile, '# Test SKILL\n', 'utf-8');
    const result = runSkillOpt(tmpFile, join(tmpdir(), 'skillopt-scoring-test-output.md'), '/tmp/nonexistent-scoring.md');
    // skillopt-sleep 不可用时 success 应为 false，但不 crash
    expect(result.success).toBe(false);
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
    // 100 行，只改 1 行 ≈ 1% 变化
    const currentLines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    const candidateLines = currentLines.replace('Line 50', 'Line 50 modified');
    writeFileSync(join(tmpDir, 'candidate.md'), candidateLines, 'utf-8');
    writeFileSync(join(tmpDir, 'current.md'), currentLines, 'utf-8');
    const result = validateCandidate(join(tmpDir, 'candidate.md'), join(tmpDir, 'current.md'));
    expect(result.canReplace).toBe(false);
    expect(result.reason).toContain('5%');
  });
});
