// ============================================================
// device-upload-policy.test.ts · G11 采集声明策略测试（v1.4.9 T3）
// ============================================================
//
// 覆盖面（验收 ①② + 故障注入）：
//   1. 空声明全拒（无配置 = fail-closed 缺省态）
//   2. 声明内类别放行 + declaration 回显
//   3. 类别未声明拒绝
//   4. 目的地核对（声明与请求不符 → 拒）
//   5. 设备不归属拒绝
//   6. 配置损坏/结构非法故障注入
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  authorizeDeviceUpload,
  loadDeviceUploadPolicy,
  saveDeviceUploadPolicy,
  deviceUploadPolicyPath,
} from '../device-upload-policy';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-device-upload-policy-'));
  tmpDirs.push(dir);
  return dir;
}

describe('authorizeDeviceUpload fail-closed 判定链', () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkDataDir();
  });

  it('验收 ①：无声明文件 → 任何 push 拒绝（empty-policy）', () => {
    const r = authorizeDeviceUpload('device-1', 'metrics', { dataDir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty-policy');
  });

  it('参数缺失 → invalid-params', () => {
    expect(authorizeDeviceUpload('', 'metrics', { dataDir }).reason).toBe('invalid-params');
    expect(authorizeDeviceUpload('device-1', '', { dataDir }).reason).toBe('invalid-params');
  });

  it('故障注入：JSON 损坏 → null 全拒', () => {
    const p = deviceUploadPolicyPath(dataDir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'not-json{{', 'utf-8');
    expect(loadDeviceUploadPolicy(dataDir)).toBeNull();
    expect(authorizeDeviceUpload('device-1', 'metrics', { dataDir }).reason).toBe('empty-policy');
  });

  it('故障注入：declarations 非数组 → null 全拒', () => {
    const p = deviceUploadPolicyPath(dataDir);
    fs.writeFileSync(p, JSON.stringify({ version: 1, deviceId: 'device-1', declarations: 'metrics' }), 'utf-8');
    expect(loadDeviceUploadPolicy(dataDir)).toBeNull();
  });

  it('验收 ②：声明内类别放行 + declaration 回显（授权依据）', () => {
    saveDeviceUploadPolicy(
      {
        version: 1,
        deviceId: 'device-1',
        declarations: [
          { category: 'metrics', frequency: '@daily', destination: 'platform-ingest' },
          { category: 'audit-digest' },
        ],
      },
      dataDir,
    );
    // BUG-35 行为变更：声明带 destination 时请求须显式提供且一致——补上匹配目的地
    const r = authorizeDeviceUpload('device-1', 'metrics', { destination: 'platform-ingest', dataDir });
    expect(r.ok).toBe(true);
    expect(r.declaration!.category).toBe('metrics');
    expect(r.declaration!.frequency).toBe('@daily');
  });

  it('验收 ②：声明外类别拒绝（category-not-declared）', () => {
    const r = authorizeDeviceUpload('device-1', 'inference-result', { dataDir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('category-not-declared');
  });

  it('目的地核对：声明带 destination 且请求不符 → 拒绝', () => {
    const r = authorizeDeviceUpload('device-1', 'metrics', { destination: 'other-endpoint', dataDir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('destination-mismatch');
  });

  it('目的地核对：声明带 destination 且请求一致 → 放行', () => {
    const r = authorizeDeviceUpload('device-1', 'metrics', { destination: 'platform-ingest', dataDir });
    expect(r.ok).toBe(true);
  });

  it('目的地核对：声明未指定 destination → 任意请求放行（可选项不强制）', () => {
    const r = authorizeDeviceUpload('device-1', 'audit-digest', { destination: 'anywhere', dataDir });
    expect(r.ok).toBe(true);
  });

  it('设备不归属（deviceId 不匹配）→ 拒绝', () => {
    const r = authorizeDeviceUpload('device-other', 'metrics', { dataDir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('device-not-in-policy');
  });

  it('坏声明条目剔除不整表丢弃（category 非字符串条目被过滤）', () => {
    saveDeviceUploadPolicy(
      {
        version: 1,
        deviceId: 'device-1',
        declarations: [
          { category: 'metrics' },
          { category: '' },
          null as unknown as { category: string },
        ],
      },
      dataDir,
    );
    const loaded = loadDeviceUploadPolicy(dataDir);
    expect(loaded!.declarations).toHaveLength(1);
    expect(loaded!.declarations[0]!.category).toBe('metrics');
  });
});

// ============================================================
// BUG-35 · 目的地核对 fail-closed（声明锁 A 时请求缺 destination 必须拒绝）
// ------------------------------------------------------------
// 缺陷：原判据 `decl.destination && opts.destination && decl.destination !== opts.destination`
// 在请求省略 destination（undefined）时短路放行 ⇒ 「声明把类别锁到端点 A，
// 却仍可从无目的地推」的 fail-open 缺口。
// 修复：声明有 destination 即要求请求目的地严格相等（缺失 ≠ 相等 → 拒）。
// 三态锁定：undefined → 拒；'B' → 拒；'A' → 放行。
// ⚠️ 回到 `&& opts.destination` → 本用例第一例立刻变红。
// ============================================================
describe('BUG-35 · 目的地核对 fail-closed 三态', () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkDataDir();
    saveDeviceUploadPolicy(
      {
        version: 1,
        deviceId: 'device-1',
        declarations: [{ category: 'metrics', destination: 'A' }],
      },
      dataDir,
    );
  });

  it('请求省略 destination（undefined）→ 拒绝（声明锁 A 不得 fail-open）', () => {
    const r = authorizeDeviceUpload('device-1', 'metrics', { dataDir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('destination-mismatch');
  });

  it("请求 destination='B' 与声明 'A' 不符 → 拒绝", () => {
    const r = authorizeDeviceUpload('device-1', 'metrics', { destination: 'B', dataDir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('destination-mismatch');
  });

  it("请求 destination='A' 与声明一致 → 放行", () => {
    const r = authorizeDeviceUpload('device-1', 'metrics', { destination: 'A', dataDir });
    expect(r.ok).toBe(true);
    expect(r.declaration!.destination).toBe('A');
  });
});

afterAll(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
