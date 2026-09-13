// ============================================================
// daemon.test.ts · 守护进程测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startWatching, formatFileWatchStartLine } from '../fs-watch';
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

// ============================================================
// v1.4.9 P1-12 · cli 层「文件监听已启动」假绿回归锁
// ------------------------------------------------------------
// 缺陷：cli.ts `daemon start` 无条件 `console.log('  ✅ 文件监听已启动')`——
//   watch.yml 无有效路径（实际建立 0 个 watcher）时同样报「已启动」＝假绿，
//   用户看到 ✅ 却完全没有监控面。
// 三个锁面（缺一则洞可复现）：
//   ① 纯函数口径：formatFileWatchStartLine 对 0 / N 的映射；
//   ② 真实计数：startWatching 在「空 paths」与「paths: [.]」下的 watchedCount；
//   ③ 接线：cli.ts 的那一行**必须**走该纯函数，不得退回硬编码字符串。
//      ③ 用**源文本守卫**而非进程级 E2E——`daemon start` 是常驻进程，且会向真实
//      `~/.sofagent/` 写健康报告/密钥（测试污染真实 HOME），无法在单测里跑。
//      手动 E2E 实测（v1.4.9 P1-12，空 watch.yml）输出两行：
//        [fs-watch] ⚠️ 监控 0 个目录（paths 全部不存在）——…（v1.4.8 F-31，本项不动）
//          ⚠️ 文件监听未启动（watch.yml 无有效路径）            ← 本项新增，两层同看不矛盾
// ============================================================
describe('formatFileWatchStartLine（v1.4.9 P1-12）', () => {
  it('0 个目录 → ⚠️ 未启动，且不含 ✅ / 已启动', () => {
    const line = formatFileWatchStartLine(0);
    expect(line).toContain('⚠️');
    expect(line).toContain('文件监听未启动');
    // 反向断言是本次修复的实质：修复前这一行恒为 ✅ …已启动
    expect(line).not.toContain('✅');
    expect(line).not.toContain('已启动');
  });

  it('N>0 → ✅ 已启动并带上目录数', () => {
    const line = formatFileWatchStartLine(3);
    expect(line).toContain('✅');
    expect(line).toContain('已启动');
    expect(line).toContain('3 个目录');
    expect(line).not.toContain('⚠️');
  });
});

describe('文件监听启动行端到端口径（v1.4.9 P1-12）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-fswatch-'));
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  /** 写入 watch.yml（显式含 watch.paths 段 ⇒ 不回落全局/默认配置，判定确定） */
  function writeWatchYml(pathsYaml: string): void {
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'watch.yml'), `watch:\n${pathsYaml}`);
  }

  it('watch.yml paths 为空 → watchedCount=0 且 cli 行报 ⚠️（不含 ✅ / 已启动）', () => {
    writeWatchYml('  paths: []\n');
    const watcher = startWatching(tmpDir, () => {});
    try {
      expect(watcher.watchedCount).toBe(0);
      // 合成＝cli 实际打印的那一行
      const line = formatFileWatchStartLine(watcher.watchedCount);
      expect(line).toContain('⚠️');
      expect(line).not.toContain('✅');
      expect(line).not.toContain('已启动');
    } finally {
      watcher.stop();
    }
  });

  it('watch.yml paths 为 . → watchedCount>0 且 cli 行报 ✅ 并带目录数', () => {
    writeWatchYml('  paths:\n    - .\n');
    const watcher = startWatching(tmpDir, () => {});
    try {
      expect(watcher.watchedCount).toBeGreaterThan(0);
      const line = formatFileWatchStartLine(watcher.watchedCount);
      expect(line).toContain('✅');
      expect(line).toContain(`${watcher.watchedCount} 个目录`);
      expect(line).not.toContain('⚠️');
    } finally {
      watcher.stop();
    }
  });
});

describe('cli.ts 接线守卫（v1.4.9 P1-12）', () => {
  it('启动行走 formatFileWatchStartLine(watcher.watchedCount)，不再硬编码 ✅ 文案', () => {
    const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.ts'), 'utf-8');
    // 正向：接线存在（删掉/改回硬编码都让这条红）
    expect(cliSrc).toContain('formatFileWatchStartLine(watcher.watchedCount)');
    // 反向：缺陷原文案不得复活（该字符串在修复前是 cli.ts:240 的硬编码字面量）
    expect(cliSrc).not.toContain('✅ 文件监听已启动');
  });
});
