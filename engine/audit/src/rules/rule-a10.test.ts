// ============================================================
// rule-a10.test.ts · A10 不引毒源——供应链检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA10 } from './rule-a10-no-poison';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A10 不引毒源', () => {
  it('package.json 引入 GitHub raw URL → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('package.json', [
        '+    "evil-pkg": "https://raw.githubusercontent.com/hacker/pwn/master/evil.tar.gz"',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('requirements.txt 引入 git+http → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('requirements.txt', [
        '+evil-pkg @ git+http://evil.com/repo.git',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('Cargo.toml git 依赖使用 http 协议 → PASS（非 git+http 格式不匹配）', () => {
    const ctx = makeCtx([
      makeDiffFile('Cargo.toml', [
        '+evil-crate = { git = "http://evil-server.com/malware" }',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('PASS'); // git+http 模式不在这里匹配
  });

  it('正常 npm registry 依赖 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('package.json', [
        '+    "react": "^18.0.0"',
        '+    "lodash": "4.17.21"',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('PASS');
  });

  it('正常 PyPI 依赖 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('requirements.txt', [
        '+requests==2.28.0',
        '+flask>=2.0',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('PASS');
  });

  it('非依赖文件变更 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/index.ts', [
        '+import evil from "https://raw.githubusercontent.com/hacker/pwn"',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([
      makeDiffFile('package.json', ['+    "react": "^18.0.0"']),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('非官方 npm registry → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('package.json', [
        '+    "bad-pkg": { "registry": "http://evil-registry.com/npm/" }',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('PyPI test.pypi.org 允许通过', () => {
    const ctx = makeCtx([
      makeDiffFile('requirements.txt', [
        '+--index-url https://test.pypi.org/simple/',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('PASS');
  });

  it('非官方 PyPI 源 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('requirements.txt', [
        '+--index-url http://evil-mirror.com/simple/',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('FAIL');
  });

  // ── v1.3.5 run-01 回归锁：A10 只扫依赖域，scripts 键不误报 ──

  it('scripts 域键（check/postbuild）不再被当包名误报 → PASS', () => {
    // 复现 run-01 事故：package.json 加 postbuild 时 check 行进了 diff added，
    // "check" 与 chalk 编辑距离 2 → 误报 typosquatting 拦截自家 commit
    const ctx = makeCtx([
      makeDiffFile('package.json', [
        '+  "scripts": {',
        '+    "check": "tsc --noEmit",',
        '+    "postbuild": "node -e \"...\""',
        '+  },',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('PASS');
  });

  it('dependencies 域内真包名照常检测（chalk 仿冒包 chek → FAIL）', () => {
    const ctx = makeCtx([
      makeDiffFile('package.json', [
        '+  "dependencies": {',
        '+    "chek": "^5.0.0",',
        '+  },',
      ]),
    ]);
    const result = checkRuleA10(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details.join(' ')).toContain('chek');
  });

});
