// ============================================================
// rule-a23.test.ts · A23 不逃路径——路径穿越检测测试 (v1.2.9)
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA23 } from './rule-a23-path-traversal';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A23 不逃路径', () => {
  it('../../../etc/passwd → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('src/malicious.ts', [
        "+fs.readFileSync('../../../etc/passwd')",
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('../../.ssh/id_rsa → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('src/malicious.ts', [
        "+fs.readFileSync('../../.ssh/id_rsa')",
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('symlink 指向 /etc → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/setup.sh', [
        '+ln -s /etc/passwd ./link',
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('正常相对路径 ./src/index.ts → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/app.ts', [
        "+import { foo } from './src/index'",
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('PASS');
  });

  it('正常绝对路径 /usr/local/bin → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('src/config.ts', [
        "+const nodePath = '/usr/local/bin/node'",
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('PASS');
  });

  it('三级以上路径穿越 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('src/malicious.ts', [
        "+const path = '../../../../some/dir'",
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([
      makeDiffFile('src/index.ts', ['+const x = 1;']),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  it('路径穿越到 .env → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('src/malicious.ts', [
        "+fs.readFileSync('../../../.env')",
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('FAIL');
  });

  // v1.3.1 #47: 真实 symlink 检测——diff 文件头含 new mode 120000
  it('真实 symlink（new mode 120000）指向绝对路径 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('evil-link', [
        'new mode 120000',
        'index 0000000..abc1234',
        '--- /dev/null',
        '+++ b/evil-link',
        '+/etc/passwd',
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('symlink');
  });

  it('真实 symlink（new mode 120000）指向 .ssh/id_rsa → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('shortcut', [
        'new mode 120000',
        '--- /dev/null',
        '+++ b/shortcut',
        '+/home/user/.ssh/id_rsa',
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('真实 symlink 指向正常相对路径 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('config-link', [
        'new mode 120000',
        '--- /dev/null',
        '+++ b/config-link',
        '+./config/default.yml',
      ]),
    ]);
    const result = checkRuleA23(ctx);
    expect(result.status).toBe('PASS');
  });
});
