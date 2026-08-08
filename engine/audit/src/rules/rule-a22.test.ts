// ============================================================
// rule-a22.test.ts · A22 不越权限——权限提升检测测试 (v1.2.8)
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA22 } from './rule-a22-privilege-escalation';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A22 不越权限', () => {
  it('chmod 777 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/setup.sh', [
        '+chmod 777 /etc',
      ]),
    ]);
    const result = checkRuleA22(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('写 sudoers → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/setup.sh', [
        "+echo 'ALL ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers",
      ]),
    ]);
    const result = checkRuleA22(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('setuid bash → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/escalate.sh', [
        '+chmod u+s /bin/bash',
      ]),
    ]);
    const result = checkRuleA22(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('普通 chmod 755 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/build.sh', [
        '+chmod 755 dist/cli.js',
      ]),
    ]);
    const result = checkRuleA22(ctx);
    expect(result.status).toBe('PASS');
  });

  it('普通 chmod +x → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/build.sh', [
        '+chmod +x deploy.sh',
      ]),
    ]);
    const result = checkRuleA22(ctx);
    expect(result.status).toBe('PASS');
  });

  it('chown root → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/escalate.sh', [
        '+chown root:root /tmp/evil',
      ]),
    ]);
    const result = checkRuleA22(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([
      makeDiffFile('src/index.ts', ['+const x = 1;']),
    ]);
    const result = checkRuleA22(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });
});
