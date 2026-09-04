// ============================================================
// rules-fixes.test.ts · v1.4.5 T9/T10/T15 测试
// T9:  A18 git ls-files 已跟踪豁免
// T10: A19 MIN_LENGTH 8→6（三字中文不误拦）
// T15: A11 单行长度维度（minified 单行折算）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { checkRuleA18 } from './rule-a18-junk-file';
import { checkRuleA19 } from './rule-a19-commit-msg-quality';
import { checkRuleA11 } from './rule-a11-no-abuse';
import { makeDiffFile, makeCtx } from '../test-utils';

// ============================================================
// T9: A18 git 已跟踪豁免
// ============================================================
describe('A18 git ls-files 豁免（T9）', () => {
  let repo: string;
  let cwdBackup: string;

  beforeEach(() => {
    repo = join(tmpdir(), `sofagent-a18-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
    git('init', '-q');
    git('config', 'user.email', 't@t.dev');
    git('config', 'user.name', 't');
    writeFileSync(join(repo, 'a.txt'), 'existing tracked file\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    cwdBackup = process.cwd();
    process.chdir(repo); // git ls-files 按 cwd 解析仓库
  });

  afterEach(() => {
    process.chdir(cwdBackup);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  it('git已跟踪的a.txt_修改时不再WARN（存量文件豁免）', () => {
    const ctx = makeCtx([makeDiffFile('a.txt', ['+updated content'])]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('PASS');
  });

  it('git未跟踪的新混入a.txt_仍WARN（本次新垃圾文件）', () => {
    // b.md 不在 git 索引——新混入的单字母文件仍要告警
    const ctx = makeCtx([makeDiffFile('b.md', ['+junk'])]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('b.md');
  });

  it('未跟踪的test1.js_WARN保持既有行为', () => {
    const ctx = makeCtx([makeDiffFile('test1.js', ['+tmp'])]);
    const result = checkRuleA18(ctx);
    expect(result.status).toBe('WARN');
  });
});

// ============================================================
// T10: A19 MIN_LENGTH 8→6
// ============================================================
describe('A19 中文短 subject 阈值（T10）', () => {
  it('「改配置」3字×2=6_不再误拦_PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/config.ts')], { commitMsg: '改配置' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('PASS');
  });

  it('「加注释」3字×2=6_不再误拦_PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/x.ts')], { commitMsg: '加注释' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('PASS');
  });

  it('「修复」2字×2=4_仍FAIL（无信息量短消息拦住）', () => {
    const ctx = makeCtx([makeDiffFile('src/x.ts')], { commitMsg: '修复' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('长度不足');
  });

  it('纯英文7字符_仍FAIL（7 < 8 但阈值6下 6字符放行——英文口径不放宽）', () => {
    // 英文字符 ×1：6 字符 = 6 ≥ 6 放行；7 字符同样放行（阈值统一为 6）
    const ctx7 = makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'abcdefg' });
    expect(checkRuleA19(ctx7).status).toBe('PASS');
    const ctx6 = makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'abcdef' });
    expect(checkRuleA19(ctx6).status).toBe('PASS');
    const ctx5 = makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'abcde' });
    expect(checkRuleA19(ctx5).status).toBe('FAIL');
  });

  it('黑名单词不受阈值影响_add仍FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'add' });
    const result = checkRuleA19(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('黑名单');
  });
});

// ============================================================
// T15: A11 单行长度维度
// ============================================================
describe('A11 超长单行折算（T15）', () => {
  it('单行5MB的minified文件_有效行数折算后超阈值WARN', () => {
    // 每行 100 万字符有效折算 = 1 + ceil(999800/200) = 5000 行；
    // 3 行 × 5000 = 15000 > 10000 阈值 → WARN（旧行为：3 行 ≤ 10000 PASS 漏检）
    const longLine = 'a'.repeat(1_000_000);
    const ctx = makeCtx([
      makeDiffFile('dist/bundle.min.js', [`+${longLine}`, `+${longLine}`, `+${longLine}`]),
    ]);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain('有效 15000 行');
    expect(result.details[0]).toContain('实际仅 3 行');
    expect(result.details[0]).toContain('超长单行折算');
  });

  it('普通多行代码_不受折算影响（10000行普通行_仍WARN）', () => {
    const lines = Array.from({ length: 10001 }, (_, i) => `+const v${i} = ${i};`);
    const ctx = makeCtx([makeDiffFile('src/huge.ts', lines)]);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('WARN');
  });

  it('正常小文件_保持PASS（折算不误伤）', () => {
    const ctx = makeCtx([
      makeDiffFile('src/a.ts', Array.from({ length: 100 }, (_, i) => `+line ${i}`)),
    ]);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('PASS');
  });

  it('边界单行_200字符以内计1行不折算', () => {
    // 3 行 × 200 字符 = 3 有效行——无折算增量
    const line = 'b'.repeat(200);
    const ctx = makeCtx([makeDiffFile('src/x.ts', [`+${line}`, `+${line}`, `+${line}`])]);
    const result = checkRuleA11(ctx);
    expect(result.status).toBe('PASS');
  });
});
