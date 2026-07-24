// ============================================================
// fs-watch.ts · 文件系统监控守护进程
// v1.2.0 新增：基于 Node.js 内置 fs.watch 的文件变更监控
// v1.2.0：迁移至 @sofagent/daemon
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

  console.log(`[fs-watch] 监控已启动（${watchers.length} 个目录，防抖 ${config.debounceMs}ms）`);

  return {
    config,
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
