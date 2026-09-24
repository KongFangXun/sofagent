// ============================================================
// fs-watch.ts · 文件系统监控守护进程
// v1.3.7 新增：基于 Node.js 内置 fs.watch 的文件变更监控
// v1.5.2：迁移至 @sofagent/daemon
//
// 设计原则：
//   - 零外部依赖（不依赖 chokidar）——使用 Node.js 内置 fs.watch
//   - 5 秒防抖——聚合短时间内多次文件变更，避免频繁触发审计
//   - 配置驱动——从 .sofagent/watch.yml 读取监控路径和忽略规则
//
// 用法：
//   import { startWatching } from './daemon/fs-watch';
//   const watcher = startWatching('/path/to/project', (changedFiles) => {
//     console.log('检测到文件变更:', changedFiles);
//   });
//   // 停止监控: watcher.stop();
// v1.1.0: 递归监控——遍历子目录建多 watcher

import { watch, FSWatcher } from 'fs';
import { readdirSync, statSync } from 'fs';
import { join, relative, basename } from 'path';
import { loadWatchConfig, type WatchConfig } from '@sofagent/core';

/** 监控回调——收到变更文件路径列表 */
export type ChangeCallback = (changedFiles: string[]) => void;

/** 监控器实例 */
export interface FileWatcher {
  /** 停止所有监控 */
  stop: () => void;
  /** 获取当前配置 */
  config: WatchConfig;
  /**
   * 实际建立的目录 watcher 数（v1.4.9 P1-12）。
   * `0` = config.paths 全部不存在/不可读 ⇒ 监控面空转，cli 层据此报 ⚠️ 而非 ✅。
   * 语义边界：这是**启动时刻**快照（stop() 之后不再有意义）。
   */
  watchedCount: number;
}

/**
 * cli 展示口径（v1.4.9 P1-12）——「文件监听启动结果 → 一行用户可见文案」。
 *
 * 抽成纯函数的原因：cli.ts 的 `daemon start` 是**常驻进程**，其打印行无法在单测里
 * 跑起来；v1.4.5 T4 的 cron 分流（cli.ts:216-224）就因同行形态而无回归锁，
 * 本项不重复该缺口。
 *
 * 与 fs-watch 层 v1.4.8 F-31 的 ⚠️ 文案（`监控 0 个目录（paths 全部不存在）…`）**两层同看**：
 *   本层回答「cli 要不要报『已启动』」（面向用户的操作反馈）；
 *   fs-watch 层回答「监控面为什么是空的」（面向排查的根因提示）。
 * 两层措辞不矛盾、不重复上报。
 */
export function formatFileWatchStartLine(watchedCount: number): string {
  return watchedCount > 0
    ? `  ✅ 文件监听已启动（${watchedCount} 个目录）`
    : '  ⚠️ 文件监听未启动（watch.yml 无有效路径）';
}

/**
 * 检查文件路径是否匹配 ignore 模式
 * 简单的 glob 匹配：支持 ** 和 * 通配符
 */
function matchesIgnore(filePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // 简单匹配：目录前缀匹配
    if (pattern.endsWith('/') && filePath.startsWith(pattern)) {
      return true;
    }
    // 后缀匹配（如 *.map）
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // .map, .d.ts
      if (filePath.endsWith(ext)) {
        return true;
      }
    }
    // 精确匹配
    if (filePath === pattern || filePath.startsWith(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * 检查文件路径是否在监控范围内
 */
function isInWatchPaths(filePath: string, watchPaths: string[]): boolean {
  for (const watchPath of watchPaths) {
    if (filePath.startsWith(watchPath) || watchPath === '.' || watchPath === './') {
      return true;
    }
  }
  return false;
}

/**
 * 启动文件系统监控
 *
 * @param projectDir 项目根目录
 * @param onChange 文件变更回调
 * @returns FileWatcher 实例
 */
export function startWatching(projectDir: string, onChange: ChangeCallback): FileWatcher {
  const config = loadWatchConfig(projectDir);
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const changedFiles = new Set<string>();
  let stopped = false;

  /**
   * 处理 debounce 后的变更通知
   */
  function flushChanges(): void {
    if (stopped) return;
    if (changedFiles.size === 0) return;

    const files = Array.from(changedFiles);
    changedFiles.clear();
    try {
      onChange(files);
    } catch (err) {
      console.error('[fs-watch] 回调执行失败:', (err as Error).message);
    }
  }

  /**
   * 记录文件变更并将防抖计时器重置
   */
  function onFileChange(relativePath: string): void {
    if (stopped) return;

    // 检查是否被忽略
    if (matchesIgnore(relativePath, config.ignore)) return;

    changedFiles.add(relativePath);

    // 重置防抖计时器
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flushChanges, config.debounceMs);
  }

  /**
   * 为单个目录路径创建 fs.watch
   */
  function watchPath(watchPath: string): void {
    const fullPath = join(projectDir, watchPath);

    let watcher: FSWatcher;
    try {
      watcher = watch(fullPath, { recursive: false }, (eventType, filename) => {
        if (!filename) return;

        let relativePath: string;
        try {
          relativePath = relative(projectDir, join(fullPath, filename));
        } catch {
          relativePath = `${watchPath}/${filename}`;
        }

        if (eventType === 'rename' || eventType === 'change') {
          onFileChange(relativePath);
        }
      });

      watcher.on('error', (err) => {
        // fs.watch 在某些平台上对不存在的目录会报错
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return; // 目录不存在，静默跳过
        }
        console.warn(`[fs-watch] 监控错误 (${watchPath}):`, (err as Error).message);
      });

      watchers.push(watcher);
    } catch (err) {
      // 路径不存在或不可访问
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      console.warn(`[fs-watch] 无法监控路径 ${watchPath}:`, (err as Error).message);
    }
  }

  // v1.1.0: 递归遍历所有子目录，为每个目录建独立 watcher
  const watchedDirs = new Set<string>();

  function collectSubdirs(root: string): string[] {
    const dirs: string[] = [root];
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          dirs.push(...collectSubdirs(join(root, entry.name)));
        }
      }
    } catch { /* 权限/不存在，跳过 */ }
    return dirs;
  }

  // 启动所有配置路径的递归监控
  for (const wp of config.paths) {
    const basePath = join(projectDir, wp);
    const allDirs = collectSubdirs(basePath);
    for (const dir of allDirs) {
      if (watchedDirs.has(dir)) continue;
      watchedDirs.add(dir);
      // 计算相对于 projectDir 的路径用于 watchPath
      const relDir = relative(projectDir, dir) || '.';
      watchPath(relDir);
    }
  }

  // v1.4.8 F-31: 0 目录从 ✅ 改 ⚠️——监控面空转必须可见
  if (watchers.length === 0) {
    console.warn(`[fs-watch] ⚠️ 监控 0 个目录（paths 全部不存在）——fs 审计触发面为空，请在 .sofagent/watch.yml 配置有效路径`);
  } else {
    console.log(`[fs-watch] 监控已启动（${watchers.length} 个目录，防抖 ${config.debounceMs}ms）`);
  }

  return {
    config,
    // v1.4.9 P1-12：暴露实际建立的 watcher 数（启动时刻快照）——
    // cli 层据此分流 ✅/⚠️，不再无条件打 ✅（此前 0 目录也报「已启动」＝假绿）。
    watchedCount: watchers.length,
    stop: () => {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // 关闭失败忽略
        }
      }
      watchers.length = 0;
      console.log('[fs-watch] 监控已停止');
    },
  };
}
