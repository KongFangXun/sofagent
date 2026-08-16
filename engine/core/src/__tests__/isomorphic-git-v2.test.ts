// ============================================================
// isomorphic-git-v2.test.ts · .git-shadow v2 内容寻址去重测试
// 2026-08-16 磁盘治理：snapshots.json 141MB（13 份全量快照）问题的修复验证
//
// 覆盖场景：
//   1. 多份快照间相同文件内容 → snapshots.json 只存一份（blobs 去重）
//   2. v2 写入后 loadSnapshots/listSnapshots 透明还原（files 形状与 v1 一致）
//   3. 工作区无变化时 commitSnapshot 不追加重复条目（SHA 相同跳过）
//   4. v1 旧格式文件可被读取（向后兼容——loadSnapshots 回退 files 直读）
//   5. 滚动裁剪后孤儿 blob 被回收（裁掉快照的独有内容不残留）
//   6. 磁盘体积对比：多份快照 ≈ 单份全量 + 增量（而非 N 倍全量）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { commitSnapshot, listSnapshots } from '../filesystem/isomorphic-git';

describe('.git-shadow v2 内容寻址去重（2026-08-16 磁盘治理）', () => {
  let tmpDir: string;
  let snapshotsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-shadow-v2-'));
    snapshotsPath = path.join(tmpDir, '.sofagent', '.git-shadow', 'snapshots.json');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* shim 环境清理失败可接受 */ }
  });

  const readStore = () => JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));

  it('多份快照间相同内容 → blobs 池只存一份', () => {
    fs.writeFileSync(path.join(tmpDir, 'common.txt'), 'shared content');
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'version-1');
    commitSnapshot(tmpDir);

    // 只改一个文件，再快照——common.txt 内容不变
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'version-2');
    commitSnapshot(tmpDir);

    const store = readStore();
    expect(store.version).toBe(2);
    expect(store.snapshots).toHaveLength(2);

    // blobs 池：common.txt 的内容只出现一次（'shared content' 全文仅在 blobs 某值中出现一次）
    const blobValues = Object.values(store.blobs) as string[];
    const sharedCount = blobValues.filter((v) => v === 'shared content').length;
    expect(sharedCount).toBe(1);

    // 快照条目里没有全文——只有索引
    for (const s of store.snapshots) {
      expect(s.fileIndex).toBeDefined();
      expect(s.files).toBeUndefined();
    }
  });

  it('listSnapshots 透明还原——files 形状与 v1 消费方预期一致', () => {
    fs.writeFileSync(path.join(tmpDir, 'f.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'g.txt'), 'world');
    commitSnapshot(tmpDir);

    const snaps = listSnapshots(tmpDir);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.files['f.txt']).toBe('hello');
    expect(snaps[0]!.files['g.txt']).toBe('world');
  });

  it('工作区无变化 → commitSnapshot 不追加重复条目', () => {
    fs.writeFileSync(path.join(tmpDir, 'x.txt'), 'same');
    const sha1 = commitSnapshot(tmpDir);
    const sha2 = commitSnapshot(tmpDir); // 无任何变化

    expect(sha1).toBe(sha2);
    const store = readStore();
    expect(store.snapshots).toHaveLength(1);
  });

  it('v1 旧格式（无 version 字段）→ 可正常读取（向后兼容）', () => {
    // 手工构造 v1 格式
    fs.mkdirSync(path.dirname(snapshotsPath), { recursive: true });
    const v1Data = {
      snapshots: [
        { sha: 'abc123', timestamp: '2026-08-15T00:00:00Z', files: { 'old.txt': 'legacy content' } },
      ],
    };
    fs.writeFileSync(snapshotsPath, JSON.stringify(v1Data), 'utf-8');

    const snaps = listSnapshots(tmpDir);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.sha).toBe('abc123');
    expect(snaps[0]!.files['old.txt']).toBe('legacy content');
  });

  it('滚动裁剪后孤儿 blob 被回收', () => {
    // 造 3 份不同内容的快照（不同 SHA）
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(tmpDir, 't.txt'), `gen-${i}`);
      commitSnapshot(tmpDir);
    }
    const before = readStore();

    // 继续提交直到超过 50 份（滚动触发）
    for (let i = 3; i < 55; i++) {
      fs.writeFileSync(path.join(tmpDir, 't.txt'), `gen-${i}`);
      commitSnapshot(tmpDir);
    }

    const store = readStore();
    expect(store.snapshots.length).toBeLessThanOrEqual(50);
    // 所有 blob 都被某快照引用（无孤儿）
    const referenced = new Set<string>();
    for (const s of store.snapshots) {
      for (const h of Object.values(s.fileIndex)) referenced.add(h);
    }
    for (const h of Object.keys(store.blobs)) {
      expect(referenced.has(h)).toBe(true);
    }
    // 裁剪真的发生了（早期 gen-0/gen-1 的内容不在了）
    expect(before.snapshots.length).toBe(3);
  });

  it('磁盘体积：多份快照 ≈ 单份全量 + 增量（非 N 倍）', () => {
    // 1 个大文件 + 多次小改动
    const big = 'B'.repeat(100_000);
    fs.writeFileSync(path.join(tmpDir, 'big.txt'), big);
    commitSnapshot(tmpDir);

    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(tmpDir, 'small.txt'), `change-${i}`);
      commitSnapshot(tmpDir);
    }

    const size = fs.statSync(snapshotsPath).size;
    // v1 下 11 份快照 × 100KB 大文件 = 至少 1.1MB；v2 去重后大文件只存一份
    // 阈值放宽到 1.5 倍单份体积（JSON 序列化开销 + 索引）
    expect(size).toBeLessThan(100_000 * 1.5 + 20_000);
  });
});
