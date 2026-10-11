// ============================================================
// device-register-pusher.test.ts · 版本清单上报端口 × 采集声明 destination 对齐
// v1.5.9 BUG-35 二阶影响修复（device-register.ts createVersionManifestPusher）
// ============================================================
//
// 背景：BUG-35 把 device-upload-policy 的 destination 校验改为 fail-closed
// （声明锁目的地时，请求不传 = 拒绝）。`createVersionManifestPusher` 原调
// deviceDataPush 不传 destination → 一旦声明锁了 destination，OTA 版本清单
// 上报会被静默拒绝。修复：pusher 按**声明本身**取值透传 destination（不硬编码
// 常量、不改函数签名）。
//
// 本文件验收（正向）：政策声明了 destination 时上报被接受（ok:true）。
// 负向（声明与请求目的地不符即拒）落在检查所在层——见
//   engine/core/src/__tests__/device-upload-policy.test.ts
// 的「BUG-35 · 目的地核对 fail-closed 三态」3 例（undefined→拒 / 'B'→拒 / 'A'→放行），
// pusher 层不重复该防线。
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateAgentIdentity,
  saveDeviceUploadPolicy,
  type AgentIdentity,
} from '@sofagent/core';
import { createVersionManifestPusher } from '../tools/device-register';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-pusher-'));
  tmpDirs.push(dir);
  return dir;
}

describe('createVersionManifestPusher × 采集声明 destination（BUG-35 对齐）', () => {
  let dataDir: string;
  let legal: AgentIdentity;

  beforeAll(() => {
    dataDir = mkDataDir();
    process.env.SOFAGENT_DATA = dataDir;
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-key-iso-'));
    tmpDirs.push(keyDir);
    fs.writeFileSync(path.join(keyDir, '.sofagent-key'), 'test-hmac-key-0123456789abcdef', 'utf-8');
    process.env.SOFAGENT_KEY_PATH = path.join(keyDir, '.sofagent-key');

    legal = generateAgentIdentity('device-pusher-legal', { principal: 'enterprise-ota' });
    // 注册设备（deviceDataPush 的 gateDevice 前置）
    const daemon = require('@sofagent/daemon') as {
      registerDevice: (i: AgentIdentity, o: Record<string, unknown>, d?: string) => { ok: boolean };
    };
    const reg = daemon.registerDevice(
      legal,
      { kind: 'pc', capabilities: ['version-manifest'], tenant: 'default' },
      dataDir,
    );
    expect(reg.ok).toBe(true);
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  const manifest = () => ({
    deviceId: legal.agentId,
    targetVersion: '1.5.9',
    components: { daemon: '1.5.9' },
    outcome: 'ok',
    at: new Date().toISOString(),
  });

  it('政策声明了 destination → OTA 版本清单上报被接受（ok:true·BUG-35 对齐）', async () => {
    saveDeviceUploadPolicy(
      { version: 1, deviceId: legal.agentId, declarations: [{ category: 'metrics', destination: 'platform-ingest' }] },
      dataDir,
    );
    const pusher = createVersionManifestPusher(legal as unknown as Record<string, unknown>);
    const r = await pusher(manifest());
    expect(r.ok).toBe(true);
    expect(typeof r.seq).toBe('number');
  });

  it('声明无 destination → 上报仍被接受（目的地管控为声明可选项）', async () => {
    saveDeviceUploadPolicy(
      { version: 1, deviceId: legal.agentId, declarations: [{ category: 'metrics' }] },
      dataDir,
    );
    const pusher = createVersionManifestPusher(legal as unknown as Record<string, unknown>);
    const r = await pusher(manifest());
    expect(r.ok).toBe(true);
  });
});
