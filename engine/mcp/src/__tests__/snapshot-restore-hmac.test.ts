// ============================================================
// snapshot-restore-hmac.test.ts · F52 快照 HMAC 指纹安全回归测试
// ============================================================
//
// 背景（为什么必须有这个文件）：
//   snapshots.json 是磁盘明文，恶意进程可直接编辑其中文件内容——
//   snapshot_restore 会把被篡改内容写回工作区（快照文件此前无完整性
//   校验，全链路裸奔；「人审」是同 tool call 自报布尔，无带外通道）。
//
// F52 修复后的防线（写入签名 / 读取验签 / 恢复提示）：
//   saveSnapshots 写入时对每个条目 HMAC 签名（复用 audit-history 基建：
//   getHmacKey 同一密钥 + stableStringify 稳定序列化 + 128bit 截断）；
//   loadSnapshots 读取时验签，失配抛错（fail-closed）；无签名条目 =
//   legacy，放行但恢复路径显式提示。
//
// 覆盖（全链路：core 存储层 + mcp snapshot_restore 工具层）：
// - 正常链路：创建快照（带签名）→ human_confirmed=true 恢复成功
// - 篡改快照：改 snapshots.json 内文件内容 → 恢复被拒（含原因输出）
// - legacy 兼容：手工构造无签名条目 → 恢复成功 + console.warn 显式提示
// - 密钥丢失：带签名条目 + 密钥文件不在场 → 拒绝（fail-closed 不假绿）
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { commitSnapshot, listSnapshots } from '@sofagent/core';
import { snapshotRestore } from '../tools/snapshot-restore';

let tmpRoot: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-snap-hmac-'));
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  const keyPath = path.join(tmpRoot, 'test-hmac-key');
  fs.writeFileSync(keyPath, 'f52-test-hmac-key-0123456789abcdef');
  process.env.SOFAGENT_KEY_PATH = keyPath;
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* */ }
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** snapshots.json 的 shadow 存储路径（.sofagent/.git-shadow/） */
const shadowDirOf = (dir: string): string => path.join(dir, '.sofagent', '.git-shadow');
const snapshotsJsonOf = (dir: string): string => path.join(shadowDirOf(dir), 'snapshots.json');

describe('F52 · 快照 HMAC 指纹（core 存储层 + mcp 工具层）', () => {
  it('test_snapshotRestore_正常链路_创建带签名快照并恢复成功', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), 'v1 内容');
    const sha = commitSnapshot(tmpRoot);

    // 写入侧签名落地：snapshots.json 内条目带 hmacSig
    const store = JSON.parse(fs.readFileSync(snapshotsJsonOf(tmpRoot), 'utf-8'));
    expect(store.version).toBe(2);
    expect(store.snapshots[0].hmacSig).toMatch(/^[0-9a-f]{32}$/);

    // 改工作区 → 恢复（human_confirmed=true 全链路）
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), 'v2 被改了');
    const result = await snapshotRestore({ sha, project_dir: tmpRoot, human_confirmed: true });
    expect(result.data.isError).toBe(false);
    expect(result.data.executed).toBe(true);
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('v1 内容');
  });

  it('test_snapshotRestore_篡改快照内容_恢复被拒且输出原因', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '正常内容');
    const sha = commitSnapshot(tmpRoot);

    // 攻击：直接编辑 snapshots.json 的 blob 内容（绕过一切上层）
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    const firstBlobKey = Object.keys(store.blobs)[0]!;
    store.blobs[firstBlobKey] = '恶意注入内容 PAYLOAD';
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    const result = await snapshotRestore({ sha, project_dir: tmpRoot, human_confirmed: true });
    expect(result.data.isError).toBe(true);
    expect(result.data.executed).toBe(false);
    expect(result.text).toContain('[sofagent] 快照恢复失败');
    // blob 偷换分支：条目签名不失效，但 blob 池校验暴露内容与索引不符
    expect(result.text).toContain('快照完整性校验失败');
    expect(result.text).toContain('blob 池被偷换');
    // 工作区未被污染
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('正常内容');
  });

  it('test_snapshotRestore_篡改条目元数据_签名失配恢复被拒', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '正常内容');
    const sha = commitSnapshot(tmpRoot);

    // 攻击变体：改条目自身（timestamp——伪造快照时间）
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    store.snapshots[0].timestamp = '2099-01-01T00:00:00.000Z';
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    const result = await snapshotRestore({ sha, project_dir: tmpRoot, human_confirmed: true });
    expect(result.data.isError).toBe(true);
    expect(result.data.executed).toBe(false);
    expect(result.text).toContain('HMAC 签名不匹配');
    expect(result.text).toContain('篡改');
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('正常内容');
  });

  it('test_snapshotRestore_无签名legacy快照_恢复成功并显式提示', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), 'legacy 内容');
    const sha = commitSnapshot(tmpRoot);

    // 手工剥掉签名——模拟 F52 之前写入的存量快照
    const storePath = snapshotsJsonOf(tmpRoot);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
    for (const s of store.snapshots) delete s.hmacSig;
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    // 条目被标记为 legacy
    const entries = listSnapshots(tmpRoot);
    expect(entries[0]!.hmacLegacy).toBe(true);

    // 恢复成功（兼容存量）+ console.warn 显式提示
    const warnSpy: MockInstance = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      fs.writeFileSync(path.join(tmpRoot, 'app.md'), '改过了');
      const result = await snapshotRestore({ sha, project_dir: tmpRoot, human_confirmed: true });
      expect(result.data.isError).toBe(false);
      expect(result.data.executed).toBe(true);
      expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('legacy 内容');
      const warned = warnSpy.mock.calls.some((c) => String(c[0]).includes('legacy'));
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('test_snapshotRestore_密钥丢失_带签名条目拒绝恢复（fail-closed）', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'app.md'), '签名时代内容');
    const sha = commitSnapshot(tmpRoot);

    // 密钥文件消失（误删 / 换机未带备份）
    fs.rmSync(process.env.SOFAGENT_KEY_PATH!);

    const result = await snapshotRestore({ sha, project_dir: tmpRoot, human_confirmed: true });
    expect(result.data.isError).toBe(true);
    expect(result.data.executed).toBe(false);
    expect(result.text).toContain('密钥不可用');
    expect(fs.readFileSync(path.join(tmpRoot, 'app.md'), 'utf-8')).toBe('签名时代内容');
  });
});
