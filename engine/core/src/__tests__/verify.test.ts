// ============================================================
// verify.test.ts · 装后验证测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Verifier } from '../verify/verifier';

describe('Verifier', () => {
  it('初始化后检查计数为 0', () => {
    const v = new Verifier(false, false);
    const result = v.getResult();
    expect(result.total).toBe(0);
  });

  it('checkPass 添加通过记录', () => {
    const v = new Verifier(false, false);
    v.checkPass('test passed');
    const result = v.getResult();
    expect(result.pass).toBe(1);
    expect(result.checks[0]!.status).toBe('pass');
  });

  it('checkFail 添加失败记录', () => {
    const v = new Verifier(false, false);
    v.checkFail('[EXPECTED FAILURE] test failed');
    const result = v.getResult();
    expect(result.fail).toBe(1);
    expect(result.checks[0]!.status).toBe('fail');
  });

  it('checkWarn 添加警告记录', () => {
    const v = new Verifier(false, false);
    v.checkWarn('test warning');
    const result = v.getResult();
    expect(result.warn).toBe(1);
    expect(result.checks[0]!.status).toBe('warn');
  });

  it('getResult 汇总所有检查', () => {
    const v = new Verifier(false, false);
    v.checkPass('item 1');
    v.checkWarn('item 2');
    v.checkFail('item 3');
    const result = v.getResult();
    expect(result.pass).toBe(1);
    expect(result.warn).toBe(1);
    expect(result.fail).toBe(1);
    expect(result.total).toBe(3);
  });
});

// ============================================================
// D-6 (v1.4.4)：verify utils 哨兵值治理——读不到 ≠ 结论
// 此前三个降级哨兵（'???' / false / 0）被消费面当结论值用：
// '???' 伪装权限正常 / false 与「不可执行」混淆 / 0 伪装「空目录 PASS」
// ============================================================
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getFileMode, isExecutable, countFilesInDir } from '../verify/utils';

describe('verify utils 哨兵值（D-6：读不到 ≠ 结论）', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sofagent-d6-'));
  });

  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不阻塞 */ }
  });

  it('getFileMode：文件不存在 → 返回 unreadable 哨兵（不是 ???）', () => {
    const mode = getFileMode(join(tmp, 'nonexistent.md'));
    expect(mode).toBe('unreadable');
    // 哨兵不得被 slice(-1) 后落进宽松权限白名单（'?' 不在 ['7','6','3','2']）
    expect(['7', '6', '3', '2']).not.toContain(mode.slice(-1));
  });

  it('getFileMode：正常文件 → 返回八进制权限串', () => {
    const f = join(tmp, 'normal.md');
    writeFileSync(f, 'x');
    chmodSync(f, 0o644);
    expect(getFileMode(f)).toBe('644');
  });

  it('isExecutable：文件不存在 → 返回 null（与 false 语义分离）', () => {
    expect(isExecutable(join(tmp, 'nonexistent.sh'))).toBeNull();
  });

  it('isExecutable：正常可执行文件 → true；不可执行 → false', () => {
    const exec = join(tmp, 'run.sh');
    writeFileSync(exec, '#!/bin/sh\n');
    chmodSync(exec, 0o755);
    expect(isExecutable(exec)).toBe(true);
    chmodSync(exec, 0o644);
    expect(isExecutable(exec)).toBe(false);
  });

  it('countFilesInDir：目录不存在 → 抛错（不再返回 0 伪装空目录）', () => {
    expect(() => countFilesInDir(join(tmp, 'no-such-dir'), '.md')).toThrow();
  });

  it('countFilesInDir：正常目录 → 正确计数', () => {
    writeFileSync(join(tmp, 'a.md'), 'x');
    writeFileSync(join(tmp, 'b.md'), 'x');
    writeFileSync(join(tmp, 'c.txt'), 'x');
    expect(countFilesInDir(tmp, '.md')).toBe(2);
  });
});
