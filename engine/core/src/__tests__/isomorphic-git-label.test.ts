// ============================================================
// isomorphic-git-label.test.ts · 快照 label 维度回归测试（v1.5.0 TASK-18）
//
// 覆盖场景（任务书验收：带 label 创建 → list 可见 → rollback 到该 label → 文件状态断言恢复）：
//   1. createShadowRepo(dir, label) 双参——config.json 记 label 维度
//   2. commitSnapshot(dir, label)——快照条目带 label，listSnapshots 可见
//   3. findSnapshotByLabel——label 精确匹配取最新；无 label 快照不误匹配
//   4. revertToSnapshot 到 label 定位的快照——文件内容断言恢复
//   5. 向后兼容：无 label 调用走现路径（config.json/快照条目无 label 字段）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createShadowRepo,
  commitSnapshot,
  listSnapshots,
  findSnapshotByLabel,
  revertToSnapshot,
} from '../filesystem/isomorphic-git';

describe('快照 label 维度（v1.5.0 TASK-18）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-shadow-label-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('createShadowRepo(dir, label) 双参——config.json 记 label；无 label 时保持旧形态', () => {
    const shadowDir = createShadowRepo(tmpDir, 'pre-deploy');
    const config = JSON.parse(fs.readFileSync(path.join(shadowDir, 'config.json'), 'utf-8'));
    expect(config.label).toBe('pre-deploy');

    // 向后兼容：无 label 调用——label 记 null（不抛错、路径不变）
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-shadow-nolabel-'));
    try {
      const shadow2 = createShadowRepo(tmp2);
      const cfg2 = JSON.parse(fs.readFileSync(path.join(shadow2, 'config.json'), 'utf-8'));
      expect(cfg2.label).toBeNull();
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });

  it('commitSnapshot 带 label → listSnapshots 可见；v2 存取往返不丢 label', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'v1\n');
    const sha1 = commitSnapshot(tmpDir, 'checkpoint-a');
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'v2\n');
    commitSnapshot(tmpDir);  // 无 label 快照混入
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'v3\n');
    commitSnapshot(tmpDir, 'checkpoint-a');  // 同 label 第二份（应取最新）

    const snaps = listSnapshots(tmpDir);
    expect(snaps.length).toBe(3);
    const labeled = snaps.filter((s) => s.label === 'checkpoint-a');
    expect(labeled.length).toBe(2);

    // findSnapshotByLabel：同 label 取最新（v3 内容的那份）
    const found = findSnapshotByLabel(tmpDir, 'checkpoint-a');
    expect(found).not.toBeNull();
    expect(found!.files['a.txt']).toBe('v3\n');
    expect(found!.sha).not.toBe(sha1);

    // 无 label 快照不误匹配；不存在的 label → null
    expect(findSnapshotByLabel(tmpDir, 'ghost')).toBeNull();
  });

  it('全链路：带 label 快照 → 修改文件 → rollback 到 label → 文件状态恢复', () => {
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'function main() { return 1; }\n');
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# doc v1\n');
    commitSnapshot(tmpDir, 'safe-point');

    // 快照后破坏性修改
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'function main() { return 999; /* bug */ }\n');
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# doc v2 (broken)\n');

    // rollback 到 label
    const target = findSnapshotByLabel(tmpDir, 'safe-point');
    expect(target).not.toBeNull();
    const restored = revertToSnapshot(tmpDir, target!.sha);
    expect(restored.length).toBe(2);

    // 文件状态断言恢复
    expect(fs.readFileSync(path.join(tmpDir, 'app.js'), 'utf-8')).toBe('function main() { return 1; }\n');
    expect(fs.readFileSync(path.join(tmpDir, 'readme.md'), 'utf-8')).toBe('# doc v1\n');
  });

  it('向后兼容：既有无 label 快照的读路径不回归（旧条目无 label 字段照常恢复）', () => {
    fs.writeFileSync(path.join(tmpDir, 'old.txt'), 'old content\n');
    const sha = commitSnapshot(tmpDir);  // 无 label
    fs.writeFileSync(path.join(tmpDir, 'old.txt'), 'changed\n');

    const restored = revertToSnapshot(tmpDir, sha);
    expect(restored).toContain('old.txt');
    expect(fs.readFileSync(path.join(tmpDir, 'old.txt'), 'utf-8')).toBe('old content\n');
    // 无 label 快照不在 label 匹配面
    expect(findSnapshotByLabel(tmpDir, 'safe-point')).toBeNull();
  });
});
