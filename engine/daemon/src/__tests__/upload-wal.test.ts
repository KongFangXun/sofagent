// ============================================================
// upload-wal.test.ts · G11 上行 WAL 暂存/断点续传/加密测试（v1.4.9 T3）
// ============================================================
//
// 覆盖面（验收 ③④ + 故障注入）：
//   1. enqueue 加密入队：WAL 落盘 + 明文不落盘（只存密文）
//   2. 无 HMAC 密钥 → 拒绝入队（fail-closed：不可加密 = 不可上行）
//   3. 断点续传：ack 游标推进后 pendingUploads 不含已 ack 段
//   4. 断网暂存：入队后不 ack，条目留在 pending（恢复后可续传）
//   5. 解密对称面：decryptPendingUpload 还原明文
//   6. 密文篡改（故障注入）：tag 校验失败 → null（不返回部分明文）
//   7. WAL 坏行容错：崩溃半行不丢后续记录
//   8. 游标单调性：ack 小值不回退游标
//   9. uploadWalStats 观测面
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  enqueueUpload,
  ackUpload,
  failUpload,
  pendingUploads,
  readUploadCursor,
  decryptPendingUpload,
  uploadWalStats,
  uploadWalPath,
  resetUploadWal,
  deriveUploadAesKey,
} from '../upload-wal';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-upload-wal-'));
  tmpDirs.push(dir);
  return dir;
}

function withTestKey(): void {
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-key-iso-'));
  tmpDirs.push(keyDir);
  fs.writeFileSync(path.join(keyDir, '.sofagent-key'), 'test-upload-aes-key-0123456789abcdef', 'utf-8');
  process.env.SOFAGENT_KEY_PATH = path.join(keyDir, '.sofagent-key');
}

describe('upload-wal（G11 上行 WAL + 断点续传 + 加密）', () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkDataDir();
    withTestKey();
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  it('验收 ④：enqueue 加密入队——WAL 落盘且明文不落盘（只存密文）', () => {
    const r = enqueueUpload('device-1', 'metrics', '敏感前缀 token=sk-abc123 明文内容', {
      redactHits: 1,
      dataDir,
    });
    expect(r.ok).toBe(true);
    expect(r.seq).toBe(1);
    const walContent = fs.readFileSync(uploadWalPath(dataDir), 'utf-8');
    expect(walContent).not.toContain('明文内容');
    expect(walContent).not.toContain('sk-abc123');
    // 密文三件套在位
    const rec = JSON.parse(walContent.trim()) as { ciphertext: string; iv: string; tag: string };
    expect(rec.ciphertext.length).toBeGreaterThan(0);
    expect(rec.iv.length).toBeGreaterThan(0);
    expect(rec.tag.length).toBeGreaterThan(0);
  });

  it('fail-closed：无 HMAC 密钥 → 拒绝入队（no-aes-key）', () => {
    const realKey = process.env.SOFAGENT_KEY_PATH;
    // 指向不存在的密钥文件 = 无密钥环境
    process.env.SOFAGENT_KEY_PATH = path.join(os.tmpdir(), 'sofagent-nonexistent-key');
    const r = enqueueUpload('device-1', 'metrics', 'x', { dataDir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-aes-key');
    process.env.SOFAGENT_KEY_PATH = realKey;
  });

  it('参数缺失 → invalid-params', () => {
    expect(enqueueUpload('', 'metrics', 'x', { dataDir }).reason).toBe('invalid-params');
    expect(enqueueUpload('device-1', '', 'x', { dataDir }).reason).toBe('invalid-params');
  });

  it('验收 ③：断网暂存不丢（入队即落盘可查）+ 恢复后可续传', () => {
    resetUploadWal(dataDir);
    const e1 = enqueueUpload('device-1', 'metrics', 'seg-1', { dataDir })!;
    const e2 = enqueueUpload('device-1', 'metrics', 'seg-2', { dataDir })!;
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    // 未 ack（断网态）——全部留在 pending
    const pending = pendingUploads(dataDir);
    expect(pending).toHaveLength(2);
    expect(readUploadCursor(dataDir)).toBe(0);
  });

  it('验收 ③：游标续传——ack 后已确认段不重传', () => {
    // ack seq=1（平台确认第一段）
    const ack = ackUpload(1, { deviceId: 'device-1', dataDir });
    expect(ack.ok).toBe(true);
    const pending = pendingUploads(dataDir);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.seq).toBe(2); // seq=1 已确认不重传
    expect(readUploadCursor(dataDir)).toBe(1);
  });

  it('游标单调：ack 小值不回退', () => {
    ackUpload(2, { deviceId: 'device-1', dataDir });
    ackUpload(1, { deviceId: 'device-1', dataDir }); // 乱序小 ack
    expect(readUploadCursor(dataDir)).toBe(2);
    expect(pendingUploads(dataDir)).toHaveLength(0);
  });

  it('fail 记录不回退游标：失败条目留在 pending（下轮重试）', () => {
    const e3 = enqueueUpload('device-1', 'metrics', 'seg-3', { dataDir })!;
    failUpload(e3.seq!, '传输失败', { deviceId: 'device-1', dataDir });
    expect(readUploadCursor(dataDir)).toBe(2);
    expect(pendingUploads(dataDir)).toHaveLength(1); // seq=3 仍待传
  });

  it('验收 ④ 对称面：decryptPendingUpload 还原明文', () => {
    const pending = pendingUploads(dataDir);
    const plain = decryptPendingUpload(pending[0]!);
    expect(plain).toBe('seg-3');
  });

  it('故障注入：密文篡改 → 解密 null（tag 校验失败不返回部分明文）', () => {
    const pending = pendingUploads(dataDir);
    const tampered = {
      ciphertext: Buffer.from('tampered-payload!!').toString('base64'),
      iv: pending[0]!.iv,
      tag: pending[0]!.tag,
    };
    expect(decryptPendingUpload(tampered)).toBeNull();
  });

  it('故障注入：WAL 崩溃半行——坏行跳过不丢后续记录', () => {
    const e4 = enqueueUpload('device-1', 'metrics', 'seg-4', { dataDir })!;
    // 手工追加一个半行（模拟崩溃中断）
    fs.appendFileSync(uploadWalPath(dataDir), '{"type":"enqueue","seq":99,"trunc', 'utf-8');
    const e5 = enqueueUpload('device-1', 'metrics', 'seg-5', { dataDir })!;
    // e4/e5 均可读（半行被跳过）
    const pending = pendingUploads(dataDir).map((p) => p.seq);
    expect(pending).toContain(e4.seq!);
    expect(pending).toContain(e5.seq!);
    expect(pending).not.toContain(99);
  });

  it('uploadWalStats 观测面（记录数 / 游标 / 待传量）', () => {
    const stats = uploadWalStats(dataDir);
    expect(stats.cursor).toBe(2);
    expect(stats.pending).toBe(pendingUploads(dataDir).length);
    expect(stats.total).toBeGreaterThanOrEqual(stats.enqueued + stats.acked + stats.failed - 1);
  });

  it('无密钥环境：deriveUploadAesKey 返回 null', () => {
    const realKey = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = path.join(os.tmpdir(), 'sofagent-nonexistent-key-2');
    expect(deriveUploadAesKey()).toBeNull();
    process.env.SOFAGENT_KEY_PATH = realKey;
  });

  it('WAL 文件权限 0600（密文落盘收紧）', () => {
    const mode = fs.statSync(uploadWalPath(dataDir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
