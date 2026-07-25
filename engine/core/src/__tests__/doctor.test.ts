// doctor.test.ts · 审计日志 hash chain 完整性校验（P0-② 安全修复的回归保护）
//
// v1.2.0: checkHistoryChainIntegrity 下沉到 core（同包 ./audit-history），
// 消除 core → audit 反向依赖。vitest spyOn 作用在同一模块缓存实例，
// doctor.ts 内的动态 import('./audit-history') 与测试的静态 import 命中同一实例。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as auditHistory from '../audit-history';
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
      .spyOn(auditHistory, 'checkHistoryChainIntegrity')
      .mockReturnValue(true);
    const r = runDoctor(tmp);
    expect(r.auditLog).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('链断裂时 auditLog=false 且 allOk=false（P0-② 安全修复的回归保护）', () => {
    vi.spyOn(auditHistory, 'checkHistoryChainIntegrity').mockReturnValue(false);
    const r = runDoctor(tmp);
    expect(r.auditLog).toBe(false);
    expect(r.allOk).toBe(false);
  });

  it('audit 包调用抛错时降级不误报（catch 分支）', () => {
    vi
      .spyOn(auditHistory, 'checkHistoryChainIntegrity')
      .mockImplementation(() => {
        throw new Error('no audit');
      });
    const r = runDoctor(tmp);
    // 保持默认 true，不误报篡改
    expect(r.auditLog).toBe(true);
  });
});
