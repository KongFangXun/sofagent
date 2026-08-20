// doctor.test.ts · 审计日志 hash chain 完整性校验（P0-② 安全修复的回归保护）
//
// v1.2.9: checkHistoryChainIntegrity 下沉到 core（同包 ./audit-history），
// 消除 core → audit 反向依赖。vitest spyOn 作用在同一模块缓存实例，
// doctor.ts 内的动态 import('./audit-history') 与测试的静态 import 命中同一实例。
//
// FLAG-2 升级：doctor 改用 checkHistoryChainDetailed 区分
//   「篡改（红）」与「历史不可复验（黄，key/环境漂移）」。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
    vi.restoreAllMocks();
  });

  it('链完整时 auditLog=true 且不被误判为失败', () => {
    const spy = vi
      .spyOn(auditHistory, 'checkHistoryChainDetailed')
      .mockReturnValue({ status: 'ok' });
    const r = runDoctor(tmp);
    expect(r.auditLog).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('篡改检测（红）：auditLog=false 且 allOk=false（P0-② 安全修复的回归保护）', () => {
    vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({
      status: 'tampered',
      index: 3,
      detail: '历史条目 3 HMAC 签名不匹配（hmacAlgo=stable），疑似内容被篡改',
    });
    const r = runDoctor(tmp);
    expect(r.auditLog).toBe(false);
    expect(r.allOk).toBe(false);
  });

  it('历史不可复验（黄）：auditLog=true 且 allOk=true，不误报为篡改（FLAG-2 修复）', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({
      status: 'unverifiable',
      detail: '部分历史段（v2 含环境指纹条目）因 ~/.sofagent-key 或环境指纹漂移无法复验',
    });
    const r = runDoctor(tmp);
    // 黄色提示：不判失败（auditLog 保持 true，即便其余检查在空 tmp 下不通过）
    expect(r.auditLog).toBe(true);
    // 输出应含「不可复验」但不含「篡改痕迹」
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('不可复验');
    expect(output).not.toContain('篡改痕迹');
    logSpy.mockRestore();
  });

  it('审计包调用抛错时降级不误报（catch 分支）', () => {
    vi
      .spyOn(auditHistory, 'checkHistoryChainDetailed')
      .mockImplementation(() => {
        throw new Error('no audit');
      });
    const r = runDoctor(tmp);
    // 保持默认 true，不误报篡改
    expect(r.auditLog).toBe(true);
  });

  // v1.3.9 五：VERSION 滞后提示补升级安全性一句——沙箱 HOME 模拟（不碰真实 ~/.sofagent）
  it('VERSION 滞后 → 输出含升级安全性说明（升级保留数据与 hooks）', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'sofagent-doctor-home-'));
    const savedHome = process.env.SOFAGENT_HOME;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env.SOFAGENT_HOME = fakeHome;
      writeFileSync(join(fakeHome, 'VERSION'), '1.3.6\n', 'utf-8'); // 旧版本 → 触发滞后分支
      runDoctor(tmp);
      const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('升级保留 ~/.sofagent/data/');
      expect(output).toContain('已装 hooks');
      expect(output).toContain('CHANGELOG');
    } finally {
      logSpy.mockRestore();
      if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
      else process.env.SOFAGENT_HOME = savedHome;
      try { rmSync(fakeHome, { recursive: true, force: true }); } catch { /* */ }
    }
  });
});
