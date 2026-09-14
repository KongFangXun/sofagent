// ============================================================
// device-data-policy.test.ts · G10 数据面白名单策略测试（v1.4.9 T2）
// ============================================================
//
// 覆盖面（验收 ①② + 故障注入）：
//   1. isPathAllowed 纯函数边界（相等 / 子路径 / 前缀绕过 / 空清单）
//   2. 空白名单全拒（无配置文件 = fail-closed 缺省态）
//   3. 配置损坏 / 结构非法 → null → 全拒（故障注入）
//   4. 白名单内放行 + allowedDir 回显
//   5. 越界路径拒绝（含 /data-secret 借 /data 前缀的攻击面）
//   6. 设备不归属（deviceId 不匹配 → 拒——防串设备放行）
//   7. 保存/加载往返
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isPathAllowed,
  normalizeDirPath,
  authorizeDeviceRead,
  loadDeviceDataPolicy,
  saveDeviceDataPolicy,
  deviceDataPolicyPath,
} from '../device-data-policy';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-device-data-policy-'));
  tmpDirs.push(dir);
  return dir;
}

describe('isPathAllowed 纯函数（G10 白名单匹配语义）', () => {
  it('白名单内子路径放行', () => {
    expect(isPathAllowed('/data/reports/a.json', ['/data'])).toBe(true);
  });

  it('目录本体放行', () => {
    expect(isPathAllowed('/data', ['/data'])).toBe(true);
  });

  it('多目录清单任一命中放行', () => {
    expect(isPathAllowed('/var/logs/x.log', ['/data', '/var/logs'])).toBe(true);
  });

  it('前缀字符串相似但非目录边界 → 拒绝（/data-secret 借 /data 前缀的攻击面）', () => {
    expect(isPathAllowed('/data-secret/steal.txt', ['/data'])).toBe(false);
  });

  it('空清单 → 拒绝（默认空 = 全拒）', () => {
    expect(isPathAllowed('/data/a.txt', [])).toBe(false);
  });

  it('路径为空串 → 拒绝', () => {
    expect(isPathAllowed('', ['/data'])).toBe(false);
  });

  it('清单条目非字符串 → 跳过该条目', () => {
    expect(isPathAllowed('/data/a', ['/other', null as unknown as string])).toBe(false);
  });

  it('normalizeDirPath 去尾部分隔符（/data/ 与 /data 等价）', () => {
    expect(normalizeDirPath('/data///')).toBe('/data');
    expect(isPathAllowed('/data/a', ['/data/'])).toBe(true);
  });
});

describe('authorizeDeviceRead fail-closed 判定链', () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkDataDir();
  });

  it('验收 ①：无策略文件 → 任何路径读取拒绝（empty-policy）', () => {
    const r = authorizeDeviceRead('device-1', '/data/anything.txt', dataDir);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty-policy');
  });

  it('参数缺失 → invalid-params', () => {
    expect(authorizeDeviceRead('', '/data/a', dataDir).reason).toBe('invalid-params');
    expect(authorizeDeviceRead('device-1', '', dataDir).reason).toBe('invalid-params');
  });

  it('故障注入：配置文件 JSON 损坏 → 按无策略处理（全拒）', () => {
    const cfgPath = deviceDataPolicyPath(dataDir);
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, '{corrupted!!!', 'utf-8');
    const r = authorizeDeviceRead('device-1', '/data/a', dataDir);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty-policy');
  });

  it('故障注入：结构非法（deviceId 缺失）→ null 全拒', () => {
    const cfgPath = deviceDataPolicyPath(dataDir);
    fs.writeFileSync(cfgPath, JSON.stringify({ version: 1, allowedDirs: ['/data'] }), 'utf-8');
    expect(loadDeviceDataPolicy(dataDir)).toBeNull();
    expect(authorizeDeviceRead('device-1', '/data/a', dataDir).reason).toBe('empty-policy');
  });

  it('故障注入：allowedDirs 非数组 → null 全拒', () => {
    const cfgPath = deviceDataPolicyPath(dataDir);
    fs.writeFileSync(cfgPath, JSON.stringify({ version: 1, deviceId: 'device-1', allowedDirs: '/data' }), 'utf-8');
    expect(loadDeviceDataPolicy(dataDir)).toBeNull();
  });

  it('验收 ②：白名单内路径放行 + allowedDir 回显（授权依据）', () => {
    saveDeviceDataPolicy(
      { version: 1, deviceId: 'device-1', allowedDirs: ['/data/reports'] },
      dataDir,
    );
    const r = authorizeDeviceRead('device-1', '/data/reports/2026-09.json', dataDir);
    expect(r.ok).toBe(true);
    expect(r.allowedDir).toBe('/data/reports');
  });

  it('验收 ②：白名单外路径拒绝（path-not-allowed）', () => {
    const r = authorizeDeviceRead('device-1', '/etc/passwd', dataDir);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('path-not-allowed');
  });

  it('越界：/data-secret 借 /data 前缀拒绝（边界字符）', () => {
    saveDeviceDataPolicy(
      { version: 1, deviceId: 'device-1', allowedDirs: ['/data'] },
      dataDir,
    );
    expect(authorizeDeviceRead('device-1', '/data-secret/x', dataDir).reason).toBe('path-not-allowed');
  });

  it('设备不归属（deviceId 不匹配）→ 拒绝（防串设备放行）', () => {
    const r = authorizeDeviceRead('device-2', '/data/reports/a.json', dataDir);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('device-not-in-policy');
  });

  it('保存/加载往返：坏目录条目被剔除不整表丢弃', () => {
    saveDeviceDataPolicy(
      { version: 1, deviceId: 'device-1', allowedDirs: ['/data', '', 42 as unknown as string] },
      dataDir,
    );
    const loaded = loadDeviceDataPolicy(dataDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.allowedDirs).toEqual(['/data']);
  });

  it('配置文件权限 0600（安全配置面收紧）', () => {
    const cfgPath = deviceDataPolicyPath(dataDir);
    const mode = fs.statSync(cfgPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

afterAll(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
