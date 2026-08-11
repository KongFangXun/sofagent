// ============================================================
// watch-config.ts · 文件监控配置解析器
// v1.3.2 从 sofagent/audit/src/config/watch-config.ts 迁出
// v1.3.2 新增：从 .sofagent/watch.yml 加载配置
// v1.3.2: 追加 cron 配置段 + CronJob 类型
//
// 配置结构（watch.yml）：
//   watch:
//     paths: []          # 要监控的路径列表
//     ignore: []         # 忽略模式（glob）
//     debounce_ms: 5000  # 防抖间隔（毫秒）
//     mode: all          # all | changed_only
//   cron:
//     - schedule: "@weekly"
//       agent: "fde"
//       mode: "sustain"
//       task: "周度巡检"
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad, YAMLException } from 'js-yaml';

/** 定时任务配置（v1.0.9 新增） */
export interface CronJob {
  schedule: '@weekly' | '@daily' | '@hourly';
  agent?: string;
  mode?: string;
  task: string;
}

/** watch.yml 配置结构 */
export interface WatchConfig {
  /** 要监控的路径列表（相对于工作目录） */
  paths: string[];
  /** 忽略模式列表（glob 风格） */
  ignore: string[];
  /** 防抖延迟（毫秒），默认 5000 */
  debounceMs: number;
  /** 监控模式：all（全部）或 changed_only（仅变更文件） */
  mode: 'all' | 'changed_only';
  /** 定时任务配置（v1.0.9 新增） */
  cron?: CronJob[];
}

/** 默认 watch 配置 */
export const DEFAULT_WATCH_CONFIG: WatchConfig = {
  paths: ['src/', 'agents/', '.sofagent/'],
  ignore: ['node_modules/', '.git/', 'dist/', '*.map', '*.d.ts'],
  debounceMs: 5000,
  mode: 'all',
};

/**
 * 加载 watch 配置（三级 fallback）
 *   1. ${cwd}/.sofagent/watch.yml
 *   2. ~/.sofagent/watch.yml
 *   3. 默认配置
 *
 * @param cwd 工作目录
 * @returns WatchConfig
 */
export function loadWatchConfig(cwd?: string): WatchConfig {
  const baseDir = cwd || process.cwd();

  // 1. 尝试项目级配置
  const projectConfig = tryLoadWatchYml(join(baseDir, '.sofagent', 'watch.yml'));
  if (projectConfig) {
    return mergeWatchDefaults(projectConfig);
  }

  // 2. 尝试全局配置
  let homeDir: string;
  try {
    const { homedir } = require('os') as typeof import('os');
    homeDir = homedir();
  } catch {
    homeDir = process.env.HOME || '/tmp';
  }
  const globalConfig = tryLoadWatchYml(join(homeDir, '.sofagent', 'watch.yml'));
  if (globalConfig) {
    return mergeWatchDefaults(globalConfig);
  }

  // 3. 默认配置
  return { ...DEFAULT_WATCH_CONFIG };
}

/** tryLoadWatchYml 的返回类型——包含 watch 段和顶层 cron 段 */
interface WatchYmlResult {
  watchConfig: Partial<WatchConfig> | null;
  cronJobs: CronJob[] | undefined;
}

/**
 * 尝试从 YAML 文件加载 watch + cron 配置
 */
function tryLoadWatchYml(filePath: string): Partial<WatchConfig> & { cron?: CronJob[] } | null {
  if (!existsSync(filePath)) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  try {
    const parsed = yamlLoad(content) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const watch = parsed['watch'];
    if (!watch || typeof watch !== 'object') {
      return null;
    }
    const result: Partial<WatchConfig> & { cron?: CronJob[] } = watch as Partial<WatchConfig>;

    // 解析顶层 cron 配置段
    const cronRaw = parsed['cron'];
    if (Array.isArray(cronRaw)) {
      result.cron = cronRaw as CronJob[];
    }

    return result;
  } catch (err) {
    if (err instanceof YAMLException) {
      console.warn(`⚠️ watch.yml 文件格式有问题: ${err.message}`);
    }
    return null;
  }
}

/**
 * 合并部分配置与默认值
 */
function mergeWatchDefaults(partial: Partial<WatchConfig> & { cron?: CronJob[] }): WatchConfig {
  return {
    paths: partial.paths ?? DEFAULT_WATCH_CONFIG.paths,
    ignore: partial.ignore ?? DEFAULT_WATCH_CONFIG.ignore,
    debounceMs: typeof partial.debounceMs === 'number' ? partial.debounceMs : DEFAULT_WATCH_CONFIG.debounceMs,
    mode: partial.mode === 'changed_only' ? 'changed_only' : DEFAULT_WATCH_CONFIG.mode,
    cron: partial.cron,
  };
}

/**
 * 生成默认 watch.yml 内容
 */
export function generateWatchTemplate(): string {
  return [
    '# sofagent 文件监控配置',
    '# 由 daemon/fs-watch 在启动时读取',
    '',
    'watch:',
    '  # 要监控的路径（相对于项目根目录）',
    '  paths:',
    '    - src/',
    '    - agents/',
    '    - .sofagent/',
    '',
    '  # 忽略模式（glob 风格）',
    '  ignore:',
    '    - node_modules/',
    '    - .git/',
    '    - dist/',
    '    - "*.map"',
    '    - "*.d.ts"',
    '',
    '  # 防抖延迟（毫秒），文件变更后等待此时间再触发审计',
    '  debounce_ms: 5000',
    '',
    '  # 监控模式：all（全部文件） / changed_only（仅变更文件）',
    '  mode: all',
    '',
    '# 定时任务（v1.0.9 新增）：daemon 启动后自动按周期触发 Sub Agent 巡检',
    '# cron:',
    '#   - schedule: "@weekly"',
    '#     agent: "fde"',
    '#     mode: "sustain"',
    '#     task: "周度巡检"',
    '',
  ].join('\n');
}
