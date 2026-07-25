// doctor.test.ts · 审计日志 hash chain 完整性校验（P0-② 安全修复的回归保护）
//
// doctor.ts 通过动态 require('@sofagent/audit') 调用 checkHistoryChainIntegrity()。
// 由于 vitest 默认将该 workspace 包外部化，vi.mock 不会拦截动态 require 路径，
// 因此这里直接 spyOn 真实模块导出的函数——test 与 doctor 共享同一 require 缓存实例，
// spy 会同时作用于 doctor 内部的 require 调用。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require('@sofagent/audit');
import { runDoctor } from '../doctor';

describe('doctor 审计日志链完整性校验', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'doctor-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('链完整时 auditLog=true 且不被误判为失败', () => {
    const spy = vi
      .spyOn(audit, 'checkHistoryChainIntegrity')
      .mockReturnValue(true);
    const r = runDoctor(tmp);
    expect(r.auditLog).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('链断裂时 auditLog=false 且 allOk=false（P0-② 安全修复的回归保护）', () => {
    vi.spyOn(audit, 'checkHistoryChainIntegrity').mockReturnValue(false);
    const r = runDoctor(tmp);
    expect(r.auditLog).toBe(false);
    expect(r.allOk).toBe(false);
  });

  it('audit 包调用抛错时降级不误报（catch 分支）', () => {
    vi
      .spyOn(audit, 'checkHistoryChainIntegrity')
      .mockImplementation(() => {
        throw new Error('no audit');
      });
    const r = runDoctor(tmp);
    // 保持默认 true，不误报篡改
    expect(r.auditLog).toBe(true);
  });
});
