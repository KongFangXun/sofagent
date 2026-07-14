// ============================================================
// daemon.test.ts · 守护进程测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startWatching } from '../fs-watch';
import type { FileWatcher } from '../fs-watch';

describe('startWatching', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-daemon-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('返回具有 stop 方法的 FileWatcher', () => {
    // 创建最小项目结构
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');
    const sofagentDir = path.join(tmpDir, '.sofagent');
    fs.mkdirSync(sofagentDir, { recursive: true });
    fs.writeFileSync(path.join(sofagentDir, 'watch.yml'), 'cron: []\n');

    const watcher: FileWatcher = startWatching(tmpDir, () => {});
    expect(watcher).toHaveProperty('stop');
    expect(typeof watcher.stop).toBe('function');
    // 清理
    watcher.stop();
  });
});
