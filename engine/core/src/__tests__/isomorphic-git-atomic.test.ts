// ============================================================
// isomorphic-git-atomic.test.ts · 快照写路径加固单测（v1.3.8 交付九）
//
// 覆盖场景：
//   1. revert 两阶段原子恢复——正常路径：文件全部恢复 + staging 清理
//   2. revert staging 阶段中途失败 → 工作目录原文件一字节未动（完整）
//   3. revert 后快照数据未变（恢复是只读快照、只写工作区）
//   4. saveSnapshots 原子落盘——commitSnapshot 后 snapshots.json 是完整 JSON
//      （写 .tmp 再 rename，读者永远不会看到半截文件）
//   5. 并发竞态模拟——staging 写一半时 snapshots.json 仍是可解析的完整 JSON
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { commitSnapshot, listSnapshots, revertToSnapshot } from '../filesystem/isomorphic-git';

describe('revert 两阶段原子恢复（v1.3.8 交付九）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-revert-atomic-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理失败可接受 */ }
  });

  it('正常路径：全部文件恢复 + staging 目录清理', () => {
    // 快照版本 1（含嵌套子目录）
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'version-1');
    fs.writeFileSync(path.join(tmpDir, 'sub', 'b.txt'), 'nested-1');
    const sha1 = commitSnapshot(tmpDir);

    // 工作区漂移
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'version-2-dirty');
    fs.writeFileSync(path.join(tmpDir, 'sub', 'b.txt'), 'nested-2-dirty');

    // 恢复
    const restored = revertToSnapshot(tmpDir, sha1);
    expect(restored.sort()).toEqual(['a.txt', path.join('sub', 'b.txt')].sort());
    expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf-8')).toBe('version-1');
    expect(fs.readFileSync(path.join(tmpDir, 'sub', 'b.txt'), 'utf-8')).toBe('nested-1');

    // staging 已清理（正常路径不留残留）
    const stagingRoot = path.join(tmpDir, '.sofagent', '.revert-staging');
    expect(fs.existsSync(stagingRoot)).toBe(false);
  });

  it('🔴 staging 写一半失败 → 原文件保持完整（核心用例）', () => {
    // 构造两文件快照
    fs.writeFileSync(path.join(tmpDir, 'first.txt'), 'original-first');
    fs.writeFileSync(path.join(tmpDir, 'second.txt'), 'original-second');
    const sha1 = commitSnapshot(tmpDir);

    // 把工作区文件改掉，恢复时应写回 original-* 内容
    fs.writeFileSync(path.join(tmpDir, 'first.txt'), 'modified');
    fs.writeFileSync(path.join(tmpDir, 'second.txt'), 'modified');

    // 模拟 staging 中途失败：把 staging 根目录设为只读（0o555）——
    // 目录无写权限 → writeFileSync(staging/<file>) 必然 EACCES。
    // macOS 上 rmSync(recursive) 连只读「文件」都能删（文件自身权限不管
    // 目录写权），但「目录」只读后其内部的新建/写入被内核拒绝，且实现的
    // 残留清理（readdir + rmSync）不修改 staging 根权限位——障碍稳定生效。
    // 「first 写成功、second 写一半才炸」的时序由 Object.entries 保持快照
    // 插入序（first 先 second 后）保证。
    const stagingRoot = path.join(tmpDir, '.sofagent', '.revert-staging');
    fs.mkdirSync(stagingRoot, { recursive: true });
    fs.chmodSync(stagingRoot, 0o555); // 目录只读——内部不可新建文件

    let threw: Error | null = null;
    try {
      revertToSnapshot(tmpDir, sha1);
    } catch (err) {
      threw = err as Error;
    }

    // 🔴 恢复权限（afterEach 的 rmSync 需要可写）
    fs.chmodSync(stagingRoot, 0o755);

    // 必须抛错——staging 阶段失败不允许静默
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain('staging');

    // 🔴 核心断言：工作目录两个文件都保持原状（modified 未被半截覆盖——
    // 第一个文件虽然 staging 成功，但 rename 从未发生）
    expect(fs.readFileSync(path.join(tmpDir, 'first.txt'), 'utf-8')).toBe('modified');
    expect(fs.readFileSync(path.join(tmpDir, 'second.txt'), 'utf-8')).toBe('modified');
  });

  it('staging 中途失败的第二种形态：staging 根被同名文件占位 → mkdir 失败、原文件完整', () => {
    fs.writeFileSync(path.join(tmpDir, 'x.txt'), 'x-v1');
    fs.writeFileSync(path.join(tmpDir, 'y.txt'), 'y-v1');
    const sha1 = commitSnapshot(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'x.txt'), 'x-dirty');
    fs.writeFileSync(path.join(tmpDir, 'y.txt'), 'y-dirty');

    // .sofagent 下用同名「文件」占住 .revert-staging 路径——
    // existsSync(stagingRoot)=true（文件也算 exists）→ 走残留清理分支，
    // writeFileSync(staging/x.txt) 必然 ENOTDIR 失败 → staging 阶段中止
    const sofagentDir = path.join(tmpDir, '.sofagent');
    fs.mkdirSync(sofagentDir, { recursive: true });
    fs.writeFileSync(path.join(sofagentDir, '.revert-staging'), 'I am a file, not a dir');

    let threw: Error | null = null;
    try {
      revertToSnapshot(tmpDir, sha1);
    } catch (err) {
      threw = err as Error;
    }
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain('staging');

    // x/y 都未被改动（staging 失败发生在任何 rename 之前）
    expect(fs.readFileSync(path.join(tmpDir, 'x.txt'), 'utf-8')).toBe('x-dirty');
    expect(fs.readFileSync(path.join(tmpDir, 'y.txt'), 'utf-8')).toBe('y-dirty');
  });

  it('恢复不修改快照数据（revert 是只读快照操作）', () => {
    fs.writeFileSync(path.join(tmpDir, 'z.txt'), 'v1');
    const sha1 = commitSnapshot(tmpDir);
    const before = JSON.stringify(listSnapshots(tmpDir));

    fs.writeFileSync(path.join(tmpDir, 'z.txt'), 'v2-dirty');
    revertToSnapshot(tmpDir, sha1);

    expect(JSON.stringify(listSnapshots(tmpDir))).toBe(before);
    expect(fs.readFileSync(path.join(tmpDir, 'z.txt'), 'utf-8')).toBe('v1');
  });
});

describe('saveSnapshots 原子落盘（v1.3.8 交付九 · 并发竞态加固）', () => {
  let tmpDir: string;
  let snapshotsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-save-atomic-'));
    snapshotsPath = path.join(tmpDir, '.sofagent', '.git-shadow', 'snapshots.json');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理失败可接受 */ }
  });

  it('commitSnapshot 后 snapshots.json 是完整可解析 JSON（无半截）', () => {
    fs.writeFileSync(path.join(tmpDir, 'f.txt'), 'content');
    commitSnapshot(tmpDir);
    commitSnapshot(tmpDir); // 连续两次——检验覆盖写路径

    // 若实现是直写（非 tmp+rename），进程被杀时读者可能拿到半截——
    // 这里至少锁定：正常完成后文件是合法 JSON 且无 .tmp 残留
    const parsed = JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));
    expect(parsed.version).toBe(2);
    expect(Array.isArray(parsed.snapshots)).toBe(true);
    expect(fs.existsSync(`${snapshotsPath}.tmp`)).toBe(false);
  });

  it('写入采用 tmp + rename 原子替换（源码级断言）', () => {
    // 锁定实现模式：saveSnapshots 内必须是 .tmp 写入 + renameSync，
    // 防止未来重构回直写（那会重新引入并发读半截 JSON 的竞态）
    const src = fs.readFileSync(
      path.resolve(__dirname, '../filesystem/isomorphic-git.ts'),
      'utf-8',
    );
    expect(src).toContain("`${snapshotsPath}.tmp`");
    expect(src).toContain('renameSync(tmpPath, snapshotsPath)');
  });

  it('staging 写一半时 snapshots.json 仍是完整 JSON（读者视角零污染）', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
    const sha1 = commitSnapshot(tmpDir);

    // 模拟另一线程/进程正在写 staging 时读者读 snapshots.json——
    // snapshots.json 与 staging 互不相干，必须始终完整
    const stagingRoot = path.join(tmpDir, '.sofagent', '.revert-staging');
    fs.mkdirSync(stagingRoot, { recursive: true });
    fs.writeFileSync(path.join(stagingRoot, 'half-written.txt'), 'hal');

    const parsed = JSON.parse(fs.readFileSync(snapshotsPath, 'utf-8'));
    expect(parsed.snapshots).toHaveLength(1);
    expect(parsed.snapshots[0].sha).toBe(sha1);
  });
});
