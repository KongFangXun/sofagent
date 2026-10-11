// ============================================================
// log-channel.test.ts · v1.5.9 BUG-74 日志通道解析 + 旧通道 tombstone
// ============================================================
//
// 覆盖：
//   1. resolveLaunchdLogOutPath：plist StandardOutPath 解析 / 无 plist → null
//   2. launchedByLaunchd：darwin + XPC_SERVICE_NAME=com.sofagent.* → true
//   3. resolveActiveLogChannel：plist 优先 / 无 plist 回退旧通道
//   4. ensureDaemonLogTombstone：旧通道活跃 → 不写；失败迁移 → 写；幂等
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DAEMON_LOG_TOMBSTONE,
  launchdPlistPath,
  resolveLaunchdLogOutPath,
  launchedByLaunchd,
  resolveActiveLogChannel,
  ensureDaemonLogTombstone,
} from '../log-channel';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-log-channel-'));
});

afterEach(() => {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best-effort */ }
});

function writePlist(outPath: string): void {
  const plist = launchdPlistPath(tmpHome);
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(
    plist,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      '  <key>Label</key><string>com.sofagent.daemon</string>',
      '  <key>StandardOutPath</key>',
      `  <string>${outPath}</string>`,
      '  <key>StandardErrorPath</key>',
      `  <string>${outPath}</string>`,
      '</dict></plist>',
    ].join('\n'),
    'utf-8',
  );
}

describe('BUG-74 · 日志通道解析', () => {
  it('无 plist → resolveLaunchdLogOutPath 返回 null', () => {
    expect(resolveLaunchdLogOutPath(tmpHome)).toBeNull();
  });

  it('plist 存在 → 解析出 StandardOutPath', () => {
    writePlist('/tmp/daemon-launchd.log');
    expect(resolveLaunchdLogOutPath(tmpHome)).toBe('/tmp/daemon-launchd.log');
  });

  it('launchedByLaunchd：darwin + XPC_SERVICE_NAME=com.sofagent.* → true；非 darwin → false', () => {
    expect(launchedByLaunchd({ XPC_SERVICE_NAME: 'com.sofagent.daemon' }, 'darwin')).toBe(true);
    expect(launchedByLaunchd({ XPC_SERVICE_NAME: 'com.apple.something' }, 'darwin')).toBe(false);
    expect(launchedByLaunchd({ XPC_SERVICE_NAME: 'com.sofagent.daemon' }, 'linux')).toBe(false);
    expect(launchedByLaunchd({}, 'darwin')).toBe(false);
  });

  it('无 plist 且非 launchd → 活跃通道回退旧 daemon.log', () => {
    const legacy = path.join(tmpHome, 'data', 'daemon.log');
    expect(resolveActiveLogChannel(legacy, { home: tmpHome, env: {} })).toBe(legacy);
  });

  it('plist 声明 StandardOutPath → 活跃通道以 plist 为准（≠ 旧 daemon.log）', () => {
    const legacy = path.join(tmpHome, 'data', 'daemon.log');
    writePlist('/var/log/daemon-launchd.log');
    expect(resolveActiveLogChannel(legacy, { home: tmpHome, env: {} })).toBe('/var/log/daemon-launchd.log');
  });
});

describe('BUG-74 · 旧 daemon.log tombstone（幂等）', () => {
  it('旧通道仍活跃（activeChannel === legacy）→ 不写', () => {
    const legacy = path.join(tmpHome, 'daemon.log');
    fs.writeFileSync(legacy, 'last line before SIGTERM\n', 'utf-8');
    const r = ensureDaemonLogTombstone(legacy, { activeChannel: legacy });
    expect(r).toEqual({ written: false, reason: 'channel-active' });
    expect(fs.readFileSync(legacy, 'utf-8')).not.toContain(DAEMON_LOG_TOMBSTONE);
  });

  it('通道已迁移 → 追加 tombstone 行', () => {
    const legacy = path.join(tmpHome, 'daemon.log');
    fs.writeFileSync(legacy, 'last line before SIGTERM\n', 'utf-8');
    const r = ensureDaemonLogTombstone(legacy, { activeChannel: '/var/log/daemon-launchd.log' });
    expect(r).toEqual({ written: true, reason: 'written' });
    const content = fs.readFileSync(legacy, 'utf-8');
    expect(content).toContain(DAEMON_LOG_TOMBSTONE);
    // 原内容保留（append 语义）
    expect(content).toContain('last line before SIGTERM');
  });

  it('幂等：重复调用只写一次（第二次 already-present，文件恰好 1 行 tombstone）', () => {
    const legacy = path.join(tmpHome, 'daemon.log');
    fs.writeFileSync(legacy, 'x\n', 'utf-8');
    const r1 = ensureDaemonLogTombstone(legacy, { activeChannel: '/var/log/daemon-launchd.log' });
    const r2 = ensureDaemonLogTombstone(legacy, { activeChannel: '/var/log/daemon-launchd.log' });
    expect(r1.written).toBe(true);
    expect(r2).toEqual({ written: false, reason: 'already-present' });
    const content = fs.readFileSync(legacy, 'utf-8');
    const count = content.split('\n').filter((l) => l.includes('日志通道已迁移')).length;
    expect(count).toBe(1);
  });

  it('旧 daemon.log 不存在 → 创建并写入 tombstone（用户排查时可见）', () => {
    const legacy = path.join(tmpHome, 'data', 'daemon.log');
    const r = ensureDaemonLogTombstone(legacy, { activeChannel: '/var/log/daemon-launchd.log' });
    expect(r.written).toBe(true);
    expect(fs.readFileSync(legacy, 'utf-8')).toContain(DAEMON_LOG_TOMBSTONE);
  });
});
