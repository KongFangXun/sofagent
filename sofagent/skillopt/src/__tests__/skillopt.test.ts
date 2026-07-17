// ============================================================
// skillopt.test.ts · SkillOpt 集成测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanSkillSafety } from '../skill-safety-check';
import { findFiles } from '@sofagent/audit';
import { isSkillOptAvailable } from '../skillopt-integration';

describe('scanSkillSafety', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-skillopt-'));
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-skillopt-'));
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

describe('isSkillOptAvailable', () => {
  it('返回 boolean', () => {
    const result = isSkillOptAvailable();
    expect(typeof result).toBe('boolean');
  });
});
