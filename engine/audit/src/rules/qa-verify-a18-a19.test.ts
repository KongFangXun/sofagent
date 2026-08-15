// ============================================================
// qa-verify-a18-a19.test.ts · QA 独立验证边界用例（v1.1.4）
// 由 QA 工程师编写，用于独立验证 A18/A19 的边界行为
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA18 } from './rule-a18-junk-file';
import { checkRuleA19 } from './rule-a19-commit-msg-quality';
import { makeDiffFile, makeCtx } from '../test-utils';

// ────────────────────────────────────────
// A18 垃圾文件 · 边界验证
// ────────────────────────────────────────
describe('A18 QA 边界验证', () => {
  // 测试：a.ts 单字母文件名应命中垃圾模式 → WARN
  it('a.ts（单字母 + .ts）→ WARN', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('a.ts')]));
    expect(result.status).toBe('WARN');
  });

  // 测试：test.txt 临时前缀应命中 → WARN
  it('test.txt（临时前缀）→ WARN', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('test.txt')]));
    expect(result.status).toBe('WARN');
  });

  // 测试：双重豁免——tests/ 目录 + .test.ts 后缀都命中豁免 → PASS
  it('tests/foo.test.ts（双重豁免）→ PASS', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('tests/foo.test.ts')]));
    expect(result.status).toBe('PASS');
  });

  // 测试：正规源码文件不应误报 → PASS
  it('src/index.ts（正规文件）→ PASS', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('src/index.ts')]));
    expect(result.status).toBe('PASS');
  });

  // 测试：README.md 不在垃圾模式中 → PASS
  it('README.md（非垃圾模式）→ PASS', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('README.md')]));
    expect(result.status).toBe('PASS');
  });

  // 测试：b.md 单字母文件名应命中 → WARN
  it('b.md（单字母 + .md）→ WARN', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('b.md')]));
    expect(result.status).toBe('WARN');
  });

  // 测试：old-name.txt 可疑命名应命中 → WARN
  it('old-name.txt（可疑命名）→ WARN', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('old-name.txt')]));
    expect(result.status).toBe('WARN');
  });

  // 测试：foo123.js 临时前缀 + 数字应命中 → WARN
  it('foo123.js（临时前缀 + 数字）→ WARN', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('foo123.js')]));
    expect(result.status).toBe('WARN');
  });

  // 测试：test/ 目录豁免 → PASS
  it('test/helper.ts（test/ 目录豁免）→ PASS', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('test/helper.ts')]));
    expect(result.status).toBe('PASS');
  });

  // 测试：__tests__/ 目录豁免 → PASS
  it('__tests__/unit.spec.ts（目录 + spec 双豁免）→ PASS', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('__tests__/unit.spec.ts')]));
    expect(result.status).toBe('PASS');
  });

  // 测试：A18 永远不产生 FAIL，只产生 WARN
  it('即使命中垃圾文件也不产生 FAIL', () => {
    const result = checkRuleA18(makeCtx([makeDiffFile('a.txt'), makeDiffFile('b.js')]));
    expect(result.status).toBe('WARN');
    expect(result.status).not.toBe('FAIL');
  });
});

// ────────────────────────────────────────
// A19 commit message 质量 · 边界验证
// ────────────────────────────────────────
describe('A19 QA 边界验证', () => {
  // 测试：add 命中黑名单（且长度不足）→ FAIL
  it('"add"（黑名单 + 长度 3）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'add' }));
    expect(result.status).toBe('FAIL');
  });

  // 测试：update 命中黑名单 → FAIL
  it('"update"（黑名单）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'update' }));
    expect(result.status).toBe('FAIL');
  });

  // 测试：feat: add login 不精确匹配黑名单，长度足够 → PASS
  it('"feat: add login"（非精确匹配，长度 16）→ PASS', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'feat: add login' }));
    expect(result.status).toBe('PASS');
  });

  // 测试：空字符串降级 → PASS
  it('""（空）→ PASS（降级）', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: '' }));
    expect(result.status).toBe('PASS');
  });

  // 测试：wip 命中黑名单 → FAIL
  it('"wip"（黑名单）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'wip' }));
    expect(result.status).toBe('FAIL');
  });

  // 测试：asdf 命中黑名单 → FAIL
  it('"asdf"（黑名单）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'asdf' }));
    expect(result.status).toBe('FAIL');
  });

  // 测试：tmp 命中黑名单 → FAIL
  it('"tmp"（黑名单）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'tmp' }));
    expect(result.status).toBe('FAIL');
  });

  // 测试：change 命中黑名单 → FAIL
  it('"change"（黑名单）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'change' }));
    expect(result.status).toBe('FAIL');
  });

  // 测试：长度刚好 7 字符（< 8），非黑名单 → FAIL
  it('"abcdefg"（长度 7 < 8）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'abcdefg' }));
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('长度不足');
  });

  // 测试：长度刚好 8 字符，非黑名单 → PASS
  it('"abcdefgh"（长度 8）→ PASS', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'abcdefgh' }));
    expect(result.status).toBe('PASS');
  });

  // 测试：大小写不敏感——ADD（大写）也应命中黑名单
  it('"ADD"（大写黑名单）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'ADD' }));
    expect(result.status).toBe('FAIL');
  });

  // 测试：前后空格 trim 后匹配——"  fix  "应命中黑名单
  it('"  fix  "（trim 后命中黑名单）→ FAIL', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: '  fix  ' }));
    expect(result.status).toBe('FAIL');
  });

  // 测试：包含黑名单词但不精确匹配——"fix bug"长度足够，非精确匹配 → PASS
  it('"fix bug here"（含 fix 但非精确匹配，长度 12）→ PASS', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'fix bug here' }));
    expect(result.status).toBe('PASS');
  });

  // 测试：null/undefined → PASS（降级）
  it('commitMsg 为 null → PASS（降级）', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: undefined }));
    expect(result.status).toBe('PASS');
  });

  // 测试：A19 产生的是工程规范级 FAIL（v1.2.5 起 index.ts SSOT=工程规范）
  it('ruleClass 为 工程规范', () => {
    const result = checkRuleA19(makeCtx([makeDiffFile('src/x.ts')], { commitMsg: 'valid' }));
    expect(result.ruleClass).toBe('工程规范');
  });
});
