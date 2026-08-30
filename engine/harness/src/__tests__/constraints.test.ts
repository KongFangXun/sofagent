// ============================================================
// constraints.test.ts · buildConstrainedSystemPrompt 四层加载链测试
// v1.4.4 第九章 #73：占位重写——原「无配置返回空」单断言
// 同义反复（typeof 永真），改为行为级验证。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildConstrainedSystemPrompt } from '../index';

describe('buildConstrainedSystemPrompt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-harness-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
  });

  const writeSkill = (name: string, content: string) => {
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.sofagent', name), content, 'utf-8');
  };

  it('目录不存在时返回空字符串（无约束可加载）', () => {
    const result = buildConstrainedSystemPrompt(path.join(tmpDir, 'nonexistent'));
    expect(result).toBe('');
  });

  it('宪法层：SKILL.md 被加载并带层标签', () => {
    writeSkill('SKILL.md', '# 底线\n- 不越权');
    const result = buildConstrainedSystemPrompt(tmpDir);
    expect(result).toContain('# 宪法约束');
    expect(result).toContain('- 不越权');
  });

  it('三层拼接顺序：宪法 → 企业规则 → 历史经验', () => {
    writeSkill('SKILL.md', 'constitution-marker');
    writeSkill('fde.md', 'enterprise-marker');
    writeSkill('think.md', 'reflection-marker');
    const result = buildConstrainedSystemPrompt(tmpDir);
    const iConst = result.indexOf('# 宪法约束');
    const iFde = result.indexOf('# 企业规则');
    const iThink = result.indexOf('# 历史经验');
    // 三层都加载且顺序正确（加载链顺序是产品行为）
    expect(iConst).toBeGreaterThanOrEqual(0);
    expect(iFde).toBeGreaterThan(iConst);
    expect(iThink).toBeGreaterThan(iFde);
    expect(result).toContain('constitution-marker');
    expect(result).toContain('enterprise-marker');
    expect(result).toContain('reflection-marker');
  });

  it('skillDir 参数可覆盖子目录名（测试隔离用）', () => {
    fs.mkdirSync(path.join(tmpDir, 'custom-skill'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'custom-skill', 'SKILL.md'), 'custom-dir-marker', 'utf-8');
    const result = buildConstrainedSystemPrompt(tmpDir, { skillDir: 'custom-skill' });
    expect(result).toContain('custom-dir-marker');
  });
});
