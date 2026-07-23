// ============================================================
// harness.test.ts · 四层约束加载链测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildConstrainedSystemPrompt } from '../index';

describe('buildConstrainedSystemPrompt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  function writeSkill(content: string, name = 'SKILL.md'): void {
    const dir = path.join(tmpDir, '.sofagent');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }

  it('无约束目录时返回空字符串', () => {
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toBe('');
  });

  it('只有 SKILL.md 时注入宪法层', () => {
    writeSkill('# Test Skill');
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toContain('# 宪法约束');
    expect(result).toContain('# Test Skill');
  });

  it('SKILL.md + fde.md 时注入宪法和规范层', () => {
    writeSkill('# Skill Content');
    writeSkill('# FDE Content', 'fde.md');
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toContain('# 宪法约束');
    expect(result).toContain('# 企业规则');
    expect(result).toContain('# Skill Content');
    expect(result).toContain('# FDE Content');
  });

  it('全四层完整加载链', () => {
    writeSkill('# Skill');
    writeSkill('# FDE', 'fde.md');
    writeSkill('# Think', 'think.md');
    const kd = path.join(tmpDir, '.sofagent', 'knowledge');
    fs.mkdirSync(kd, { recursive: true });
    fs.writeFileSync(path.join(kd, 'k1.md'), '# Knowledge 1');
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toContain('# 宪法约束');
    expect(result).toContain('# 企业规则');
    expect(result).toContain('# 历史经验');
    expect(result).toContain('# Knowledge 1');
  });

  it('knowledge top-5 截断', () => {
    const kd = path.join(tmpDir, '.sofagent', 'knowledge');
    fs.mkdirSync(kd, { recursive: true });
    // 用大时间跨度确保不同的 mtime
    const baseTime = Date.now() - 100000;
    for (let i = 1; i <= 10; i++) {
      const p = path.join(kd, `k${i}.md`);
      fs.writeFileSync(p, `# Knowledge ${i}`);
      const ts = new Date(baseTime - i * 10000);
      fs.utimesSync(p, ts, ts);
    }
    const result = buildConstrainedSystemPrompt(tmpDir);
    // 只取前 5 个（其余 5 个不会出现）
    let count = 0;
    for (let i = 1; i <= 10; i++) {
      if (result.includes(`# Knowledge ${i}`)) count++;
    }
    expect(count).toBe(5);
  });

  it('knowledge 每篇截断 2000 字符', () => {
    const kd = path.join(tmpDir, '.sofagent', 'knowledge');
    fs.mkdirSync(kd, { recursive: true });
    const longContent = 'A'.repeat(3000);
    fs.writeFileSync(path.join(kd, 'long.md'), longContent);
    const result = buildConstrainedSystemPrompt(tmpDir);
    // 输出中应只包含前 2000 个 A
    expect(result).toContain('A'.repeat(2000));
    // 不应包含第 2001 个 A（因为被截断了）
    expect(result).not.toContain('A'.repeat(2001));
  });

  it('persona.md 注入', () => {
    writeSkill('Test persona', 'persona.md');
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toContain('# 用户画像 (persona)');
    expect(result).toContain('Test persona');
  });

  it('persona.md 截断 500 字符', () => {
    writeSkill('P'.repeat(1000), 'persona.md');
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toContain('P'.repeat(500));
    expect(result).not.toContain('P'.repeat(501));
  });

  it('自定义 skillDir', () => {
    const dir = path.join(tmpDir, '.my-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Custom Skill');
    const result = buildConstrainedSystemPrompt(tmpDir, { skillDir: '.my-skill' });
    expect(result).toContain('# 宪法约束');
    expect(result).toContain('# Custom Skill');
  });

  it('文件不存在时静默跳过不报错', () => {
    // 只放部分文件，其余不存在
    writeSkill('# Only SKILL exists');
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toContain('# 宪法约束');
    expect(result).not.toContain('# 企业规则');
    expect(result).not.toContain('# 历史经验');
  });
});
