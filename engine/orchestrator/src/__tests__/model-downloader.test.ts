// ============================================================
// model-downloader.test.ts · v1.4.2 章四 · 基座模型下载管理测试
//
// 覆盖：
//   - 全新下载（206 分片续传 → 原子 rename + 版本清单）
//   - 断点续传（.part.meta 已存 → 从 offset 起；url 变更作废重来）
//   - 幂等（manifest 已存 → 不重下）
//   - 磁盘空间预检（不足结构化拒绝 / totalSize 未知跳过预检 / 续传只查增量）
//   - HTTP 200 全量回退（服务器不支持 Range——作废断点重写）
//   - 分片失败重试（指数退避——maxRetries 后结构化失败不抛出）
//   - 进度回调（每分片一次——received/total 递增）
//   - 下载不完整（totalSize 已知但字节不符——断点已存待重跑）
//
// 全部注入 fetchRange / freeSpaceFn（零真实网络零真实大文件——对齐
// train-env ExecFn 注入模式）；dataDir 用临时目录（真实文件系统断言）。
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  downloadModel,
  preflightDiskSpace,
  readPartMeta,
  partPaths,
  modelDir,
  modelFilePath,
  modelManifestPath,
  DEFAULT_CHUNK_BYTES,
  type FetchRangeFn,
  type RangeResponse,
  type FreeSpaceFn,
  type ModelManifest,
} from '../train/model-downloader';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-dl-test-'));
});

// ──────────────────────────────────────
// mock 工厂
// ──────────────────────────────────────

/** 造内存假文件（fetchRange 按需切片） */
function makeServingFile(content: string | Buffer, opts: { totalSize?: number | null } = {}): {
  fetchRange: FetchRangeFn;
  calls: Array<{ url: string; offset: number }>;
} {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const calls: Array<{ url: string; offset: number }> = [];
  const fetchRange: FetchRangeFn = async (url, offset) => {
    calls.push({ url, offset });
    if (offset >= buf.length) {
      return { status: 206, chunk: Buffer.alloc(0), totalSize: opts.totalSize ?? buf.length };
    }
    const end = Math.min(buf.length, offset + DEFAULT_CHUNK_BYTES);
    return { status: 206, chunk: buf.subarray(offset, end), totalSize: opts.totalSize ?? buf.length };
  };
  return { fetchRange, calls };
}

/** 全量响应（200——服务器不支持 Range） */
function makeAlways200(content: string | Buffer): FetchRangeFn {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return async () => ({ status: 200, chunk: buf, totalSize: buf.length });
}

const INFINITE_SPACE: FreeSpaceFn = () => Number.POSITIVE_INFINITY;
const FIXED_NOW = () => 1_800_000_000_000;

function readManifest(name: string): ModelManifest {
  const p = modelManifestPath(dataDir, name);
  expect(existsSync(p)).toBe(true);
  return JSON.parse(readFileSync(p, 'utf-8')) as ModelManifest;
}

// ──────────────────────────────────────
// 全新下载
// ──────────────────────────────────────

describe('model-downloader · 全新下载', () => {
  it('test_downloadModel_全新下载_206分片落盘_清单写入', async () => {
    const content = 'A'.repeat(1000);
    const { fetchRange, calls } = makeServingFile(content);

    const r = await downloadModel({
      dataDir,
      name: 'Qwen3-8B',
      url: 'https://example.com/qwen.bin',
      fetchRange,
      freeSpaceFn: INFINITE_SPACE,
      now: FIXED_NOW,
    });

    expect(r.ok).toBe(true);
    expect(r.filePath).toBe(modelFilePath(dataDir, 'Qwen3-8B'));
    expect(r.receivedThisSession).toBe(1000);

    // 文件内容完整
    expect(readFileSync(r.filePath ?? '', 'utf-8')).toBe(content);

    // 版本清单：来源 url + 大小 + 时间
    const m = readManifest('Qwen3-8B');
    expect(m.schemaVersion).toBe('v1');
    expect(m.name).toBe('Qwen3-8B');
    expect(m.sourceUrl).toBe('https://example.com/qwen.bin');
    expect(m.sizeBytes).toBe(1000);
    expect(m.downloadedAt).toBe(new Date(FIXED_NOW()).toISOString());

    // 断点元数据已留档（.done 后缀）
    const { meta } = partPaths(dataDir, 'Qwen3-8B');
    expect(existsSync(`${meta}.done`)).toBe(true);

    // 首次从 offset 0 拉
    expect(calls[0]?.offset).toBe(0);
  });

  it('test_downloadModel_多分片循环_进度回调递增', async () => {
    // 内容超过一分片（32MB）→ 至少两轮循环
    const bigContent = Buffer.alloc(DEFAULT_CHUNK_BYTES + 100, 7);
    const { fetchRange } = makeServingFile(bigContent);

    const progress: Array<{ received: number; total: number | null }> = [];
    const r = await downloadModel({
      dataDir,
      name: 'BigModel',
      url: 'https://example.com/big.bin',
      fetchRange,
      freeSpaceFn: INFINITE_SPACE,
      now: FIXED_NOW,
      onProgress: (received, total) => progress.push({ received, total }),
    });

    expect(r.ok).toBe(true);
    expect(r.receivedThisSession).toBe(DEFAULT_CHUNK_BYTES + 100);
    // 分片边界对齐：第一片 32MB、第二片 100
    expect(progress.map((p) => p.received)).toEqual([DEFAULT_CHUNK_BYTES, DEFAULT_CHUNK_BYTES + 100]);
    expect(progress[0]?.total).toBe(DEFAULT_CHUNK_BYTES + 100);
  });

  it('test_downloadModel_totalSize未知_短分片判定到尾_仍成功', async () => {
    // 服务器不给 Content-Range total → totalSize=null → 短分片（<32MB）即到尾
    const { fetchRange } = makeServingFile('small-model-weights', { totalSize: null });

    const r = await downloadModel({
      dataDir,
      name: 'UnknownSize',
      url: 'https://example.com/no-len.bin',
      fetchRange,
      freeSpaceFn: INFINITE_SPACE,
      now: FIXED_NOW,
    });

    expect(r.ok).toBe(true);
    expect(readFileSync(r.filePath ?? '', 'utf-8')).toBe('small-model-weights');
  });
});

// ──────────────────────────────────────
// 断点续传
// ──────────────────────────────────────

describe('model-downloader · 断点续传', () => {
  it('test_downloadModel_断点续传_从offset起收增量', async () => {
    const content = '0123456789'.repeat(100); // 1000 bytes
    // 预置断点：已收 400 bytes
    const { part, meta } = partPaths(dataDir, 'ResumeModel');
    mkdirSync(join(part, '..'), { recursive: true });
    writeFileSync(part, content.slice(0, 400));
    writeFileSync(
      meta,
      JSON.stringify({ url: 'https://example.com/r.bin', receivedBytes: 400, totalSize: 1000, updatedAt: '2026-08-30T00:00:00.000Z' }),
    );

    const { fetchRange, calls } = makeServingFile(content);

    const r = await downloadModel({
      dataDir,
      name: 'ResumeModel',
      url: 'https://example.com/r.bin',
      fetchRange,
      freeSpaceFn: INFINITE_SPACE,
      now: FIXED_NOW,
    });

    expect(r.ok).toBe(true);
    expect(r.receivedThisSession).toBe(600); // 只算增量
    expect(calls[0]?.offset).toBe(400); // 从断点起拉
    expect(readFileSync(r.filePath ?? '', 'utf-8')).toBe(content); // 拼接完整
  });

  it('test_downloadModel_断点url变更_作废重来', async () => {
    const content = 'abcdefghij'.repeat(50); // 500 bytes
    // 断点指向旧 url
    const { part, meta } = partPaths(dataDir, 'SwitchModel');
    mkdirSync(join(part, '..'), { recursive: true });
    writeFileSync(part, 'OLD-PARTIAL');
    writeFileSync(
      meta,
      JSON.stringify({ url: 'https://old.example.com/x.bin', receivedBytes: 10, totalSize: 500, updatedAt: '2026-08-30T00:00:00.000Z' }),
    );

    const { fetchRange, calls } = makeServingFile(content);

    const r = await downloadModel({
      dataDir,
      name: 'SwitchModel',
      url: 'https://new.example.com/x.bin', // 换源
      fetchRange,
      freeSpaceFn: INFINITE_SPACE,
      now: FIXED_NOW,
    });

    expect(r.ok).toBe(true);
    expect(calls[0]?.offset).toBe(0); // 断点作废——从头
    expect(readFileSync(r.filePath ?? '', 'utf-8')).toBe(content); // 旧断点未混入
  });

  it('test_readPartMeta_不存在或坏数据_返回null', () => {
    expect(readPartMeta(dataDir, 'Nope')).toBeNull();
    const { meta } = partPaths(dataDir, 'BadMeta');
    mkdirSync(join(meta, '..'), { recursive: true });
    writeFileSync(meta, 'not-json{');
    expect(readPartMeta(dataDir, 'BadMeta')).toBeNull();
    writeFileSync(meta, JSON.stringify({ url: 123, receivedBytes: 'x' })); // 字段类型错
    expect(readPartMeta(dataDir, 'BadMeta')).toBeNull();
  });
});

// ──────────────────────────────────────
// 幂等
// ──────────────────────────────────────

describe('model-downloader · 幂等', () => {
  it('test_downloadModel_已有manifest_不重下', async () => {
    // 先完整下载一遍
    const { fetchRange: fr1, calls: calls1 } = makeServingFile('first-full-download');
    await downloadModel({
      dataDir, name: 'IdemModel', url: 'https://example.com/i.bin',
      fetchRange: fr1, freeSpaceFn: INFINITE_SPACE, now: FIXED_NOW,
    });
    expect(calls1.length).toBeGreaterThan(0);

    // 第二次（manifest 已在）→ 零网络请求直接返回
    const { fetchRange: fr2, calls: calls2 } = makeServingFile('should-not-be-fetched');
    const r = await downloadModel({
      dataDir, name: 'IdemModel', url: 'https://example.com/i.bin',
      fetchRange: fr2, freeSpaceFn: INFINITE_SPACE, now: FIXED_NOW,
    });

    expect(r.ok).toBe(true);
    expect(calls2).toHaveLength(0);
    expect(r.receivedThisSession).toBe(0);
    expect(r.manifest?.sizeBytes).toBe('first-full-download'.length);
    // 文件未被覆盖
    expect(readFileSync(r.filePath ?? '', 'utf-8')).toBe('first-full-download');
  });
});

// ──────────────────────────────────────
// 磁盘空间预检
// ──────────────────────────────────────

describe('model-downloader · 磁盘空间预检', () => {
  it('test_preflightDiskSpace_空间充足_ok', () => {
    const r = preflightDiskSpace('/data', 1000, 0, () => 10_000);
    expect(r.ok).toBe(true);
    expect(r.needBytes).toBe(1050); // 1000 * 1.05
  });

  it('test_preflightDiskSpace_空间不足_结构化拒绝', () => {
    const r = preflightDiskSpace('/data', 1000, 0, () => 500);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('磁盘空间不足');
  });

  it('test_preflightDiskSpace_续传只查增量', () => {
    // 已收 800 / 总 1000 → 只需 200 * 1.05 = 210
    const r = preflightDiskSpace('/data', 1000, 800, () => 300);
    expect(r.ok).toBe(true);
    expect(r.needBytes).toBe(210);
  });

  it('test_preflightDiskSpace_totalSize未知_跳过预检', () => {
    const r = preflightDiskSpace('/data', null, 0, () => 0);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('跳过');
  });

  it('test_downloadModel_空间不足_下载前结构化拒绝', async () => {
    const { fetchRange } = makeServingFile(Buffer.alloc(2000));
    const r = await downloadModel({
      dataDir, name: 'TightDisk', url: 'https://example.com/t.bin',
      fetchRange, freeSpaceFn: () => 100, // 只有 100 bytes
      now: FIXED_NOW,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('磁盘空间不足');
    // 未产出最终文件
    expect(existsSync(modelFilePath(dataDir, 'TightDisk'))).toBe(false);
  });
});

// ──────────────────────────────────────
// HTTP 200 全量回退
// ──────────────────────────────────────

describe('model-downloader · 200 全量回退', () => {
  it('test_downloadModel_服务器不支持Range_200全量重写', async () => {
    const content = 'full-content-from-server';
    // 预置一个脏断点（旧分片内容）
    const { part, meta } = partPaths(dataDir, 'NoRangeModel');
    mkdirSync(join(part, '..'), { recursive: true });
    writeFileSync(part, 'STALE-PARTIAL');
    writeFileSync(
      meta,
      JSON.stringify({ url: 'https://example.com/n.bin', receivedBytes: 13, totalSize: null, updatedAt: '2026-08-30T00:00:00.000Z' }),
    );

    const r = await downloadModel({
      dataDir, name: 'NoRangeModel', url: 'https://example.com/n.bin',
      fetchRange: makeAlways200(content), freeSpaceFn: INFINITE_SPACE, now: FIXED_NOW,
    });

    expect(r.ok).toBe(true);
    // 200 → 作废旧断点重写（无 STALE-PARTIAL 混入）
    expect(readFileSync(r.filePath ?? '', 'utf-8')).toBe(content);
    expect(r.manifest?.sizeBytes).toBe(content.length);
  });
});

// ──────────────────────────────────────
// 失败与重试
// ──────────────────────────────────────

describe('model-downloader · 失败与重试', () => {
  it('test_downloadModel_分片失败_指数退避重试后成功', async () => {
    const content = 'retry-then-ok';
    let failures = 0;
    let delayCalls = 0;
    const fetchRange: FetchRangeFn = async (_url, offset) => {
      if (offset === 0 && failures < 2) {
        failures += 1;
        throw new Error('ECONNRESET');
      }
      const buf = Buffer.from(content);
      return { status: 206, chunk: buf.subarray(offset), totalSize: buf.length };
    };

    const r = await downloadModel({
      dataDir, name: 'RetryModel', url: 'https://example.com/re.bin',
      fetchRange, freeSpaceFn: INFINITE_SPACE, now: FIXED_NOW,
      maxRetries: 3, retryBaseDelayMs: 1, // 测试提速——退避 1ms
      onProgress: () => {
        delayCalls += 1;
      },
    });

    expect(r.ok).toBe(true);
    expect(failures).toBe(2); // 前两次失败
    expect(r.receivedThisSession).toBe(content.length);
    expect(delayCalls).toBe(1); // 成功落盘一次进度
  });

  it('test_downloadModel_重试至上限_结构化失败不抛出', async () => {
    const fetchRange: FetchRangeFn = async () => {
      throw new Error('network down');
    };

    const r = await downloadModel({
      dataDir, name: 'DeadNet', url: 'https://example.com/d.bin',
      fetchRange, freeSpaceFn: INFINITE_SPACE, now: FIXED_NOW,
      maxRetries: 2, retryBaseDelayMs: 1,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('重试 2 次仍失败');
    expect(r.error).toContain('network down');
    expect(r.filePath).toBeNull();
  });

  it('test_downloadModel_下载不完整_断点已存_指引重跑', async () => {
    // totalSize 声明 1000 但服务器实际只给 600 → 完整性核对失败
    const content = 'x'.repeat(600);
    const { fetchRange } = makeServingFile(content, { totalSize: 1000 });

    const r = await downloadModel({
      dataDir, name: 'ShortModel', url: 'https://example.com/s.bin',
      fetchRange, freeSpaceFn: INFINITE_SPACE, now: FIXED_NOW,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('下载不完整');
    expect(r.error).toContain('600/1000');
    // 断点保留——重跑可续
    const meta = readPartMeta(dataDir, 'ShortModel');
    expect(meta?.receivedBytes).toBe(600);
    expect(meta?.totalSize).toBe(1000);
  });
});

// ──────────────────────────────────────
// 路径口径
// ──────────────────────────────────────

describe('model-downloader · 路径口径', () => {
  it('test_路径函数_doctor缓存目录一致', () => {
    expect(modelDir(dataDir, 'Qwen3-8B')).toBe(join(dataDir, 'models', 'Qwen3-8B'));
    expect(modelFilePath(dataDir, 'Qwen3-8B')).toBe(
      join(dataDir, 'models', 'Qwen3-8B', 'model.safetensors'),
    );
    expect(modelManifestPath(dataDir, 'Qwen3-8B')).toBe(
      join(dataDir, 'models', 'Qwen3-8B', 'model-manifest.json'),
    );
    const { part, meta } = partPaths(dataDir, 'Qwen3-8B');
    expect(part.endsWith('.safetensors.part')).toBe(true);
    expect(meta.endsWith('.safetensors.part.meta')).toBe(true);
  });
});
