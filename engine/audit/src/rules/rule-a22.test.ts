// ============================================================
// rule-a22.test.ts · A22 不越权限——权限提升检测测试 (v1.2.9)
// ============================================================

import { describe, it, expect } from 'vitest';
import { scanA22 } from './rule-a22-privilege-escalation';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A22 不越权限', () => {
  it('chmod 777 → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/setup.sh', [
        '+chmod 777 /etc',
      ]),
    ]);
    const result = scanA22(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('写 sudoers → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/setup.sh', [
        "+echo 'ALL ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers",
      ]),
    ]);
    const result = scanA22(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('setuid bash → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/escalate.sh', [
        '+chmod u+s /bin/bash',
      ]),
    ]);
    const result = scanA22(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('普通 chmod 755 → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/build.sh', [
        '+chmod 755 dist/cli.js',
      ]),
    ]);
    const result = scanA22(ctx);
    expect(result.status).toBe('PASS');
  });

  it('普通 chmod +x → PASS', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/build.sh', [
        '+chmod +x deploy.sh',
      ]),
    ]);
    const result = scanA22(ctx);
    expect(result.status).toBe('PASS');
  });

  it('chown root → FAIL', () => {
    const ctx = makeCtx([
      makeDiffFile('scripts/escalate.sh', [
        '+chown root:root /tmp/evil',
      ]),
    ]);
    const result = scanA22(ctx);
    expect(result.status).toBe('FAIL');
  });

});

// ============================================================
// v1.8.0 · 测试文件降级 WARN（跳过 ≠ 通过）——对齐 A20 finding-11 范式
// 修复前：.test. 文件静默 continue 整文件跳过判 PASS（提权零告警）
// ============================================================
describe('A22 测试文件降级 WARN', () => {
  it('.test. 文件含 sudo chmod 777 提权 → WARN 留痕（非静默 PASS）', () => {
    const ctx = makeCtx([
      makeDiffFile('src/escalation.setup.test.ts', [
        '+sudo chmod 777 /etc/sudoers',
      ]),
    ]);
    const result = scanA22(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details.some(d => d.includes('测试文件跳过深检') && d.includes('escalation.setup.test.ts'))).toBe(true);
    expect(result.details.some(d => d.includes('跳过 ≠ 通过'))).toBe(true);
  });

  it('__tests__/ 文件含 setuid → WARN 留痕', () => {
    const ctx = makeCtx([
      makeDiffFile('src/__tests__/privilege.test.ts', [
        '+chmod u+s /bin/bash',
      ]),
    ]);
    const result = scanA22(ctx);
    expect(result.status).toBe('WARN');
    expect(result.details.some(d => d.includes('__tests__/privilege.test.ts'))).toBe(true);
  });
});
