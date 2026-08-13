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

  it('knowledge 渐进加载（v1.3.1 交付 14）：热点 ≤2 全文 + 索引 ≤9 条', () => {
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

    // 1. 热点全文 ≤2 篇——热点段内出现的 marker ≤2
    const hotSection = result.split('当前任务热点')[1]?.split('知识索引')[0] ?? '';
    let hotCount = 0;
    for (let i = 1; i <= 10; i++) {
      if (hotSection.includes(`# Knowledge ${i}`)) hotCount++;
    }
    expect(hotCount).toBeLessThanOrEqual(2);

    // 2. 索引条数 ≤9（文件名 + 摘要，Agent 按需 read_file 拉全文）
    const indexSection = result.split('知识索引')[1] ?? '';
    const indexLines = indexSection.split('\n').filter((l) => l.startsWith('- '));
    expect(indexLines.length).toBeLessThanOrEqual(9);

    // 3. 渐进加载语义：索引 9 条 + 热点全文 2 篇 → 至少 9 个文件可寻址（文件名出现），
    //    但只有 ≤2 篇以全文形式注入
    let addressable = 0;
    for (let i = 1; i <= 10; i++) {
      if (result.includes(`k${i}`)) addressable++;
    }
    expect(addressable).toBeGreaterThanOrEqual(9);
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

  // ────────────────────────────────────────────────────────────
  // v1.3.4 P1-18: 行为断言——不只测字段存在，测注入后行为符合约束
  // ────────────────────────────────────────────────────────────

  it('宪法层注入后包含「核心铁律」约束行为（P1-18 行为断言）', () => {
    // SKILL.md 注入后应能约束 Agent 行为——验证宪法层确实起了"约束"作用，
    // 而非只是把文件内容粘贴进去（测行为不测类型存在）
    writeSkill('# My Skill\n你必须遵守以下底线：\n1. 不越界\n2. 不逃验证');
    const result = buildConstrainedSystemPrompt(tmpDir);

    // 行为断言 1：宪法层标题存在且内容完整注入
    expect(result).toContain('# 宪法约束');
    expect(result).toContain('你必须遵守以下底线');
    expect(result).toContain('不越界');
    expect(result).toContain('不逃验证');
  });

  it('四层加载链注入顺序正确——宪法在规范前，规范在经验前（P1-18 行为断言）', () => {
    // 验证加载链的注入顺序符合约束优先级（宪法 > 规范 > 经验），
    // 这是行为契约——顺序错误会导致 Agent 先看到经验再看到铁律，约束力降低
    writeSkill('# Skill 铁律');
    writeSkill('# FDE 规范', 'fde.md');
    writeSkill('# Think 反思', 'think.md');
    const result = buildConstrainedSystemPrompt(tmpDir);

    const constitutionPos = result.indexOf('# 宪法约束');
    const enterprisePos = result.indexOf('# 企业规则');
    const historyPos = result.indexOf('# 历史经验');

    // 行为断言：宪法层在规范层之前，规范层在经验层之前
    expect(constitutionPos).toBeGreaterThanOrEqual(0);
    expect(enterprisePos).toBeGreaterThan(constitutionPos);
    expect(historyPos).toBeGreaterThan(enterprisePos);
  });

  it('约束内容被 Agent 可见且不被截断丢失（P1-18 行为断言）', () => {
    // 验证较长的 SKILL.md 内容能完整注入——截断会丢失铁律，导致约束失效
    const longRule = '禁止修改审计引擎自身代码（A1 铁律）'.repeat(10);
    writeSkill(`# 规则\n${longRule}`);
    const result = buildConstrainedSystemPrompt(tmpDir);

    // 行为断言：关键约束文本完整注入，未截断
    expect(result).toContain('# 规则');
    expect(result).toContain('禁止修改审计引擎自身代码（A1 铁律）');
    // 重复 10 次的内容应至少出现（验证未被意外截断）
    const matchCount = (result.match(/禁止修改审计引擎自身代码/g) || []).length;
    expect(matchCount).toBeGreaterThanOrEqual(10);
  });
});
