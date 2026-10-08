// ============================================================
// watch-config.ts · 文件监控配置解析器
// v1.5.7 从 sofagent/audit/src/config/watch-config.ts 迁出
// v1.3.7 新增：从 .sofagent/watch.yml 加载配置
// v1.5.7: 追加 cron 配置段 + CronJob 类型
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

/** 默认 watch 配置（v1.4.8 F-31: paths 从写死的 src/ 等改为 '.'——旧默认在无 src/ 目录的
 * 仓库（如本仓）下「监控 0 个目录」仍打 ✅，fs 审计触发面整体空转；监控根目录 + ignore
 * 排除法对任意 git 仓库形态都有效） */
export const DEFAULT_WATCH_CONFIG: WatchConfig = {
  paths: ['.'],
  ignore: ['node_modules/', '.git/', 'dist/', '*.map', '*.d.ts'],
  debounceMs: 5000,
  mode: 'all',
};

/**
 * F46（v1.5.7）：watch.yml 两级路径解析 SSOT——[项目级路径, 全局级路径]。
 *
 * 全局级经 core 的 resolveHomeDir（读 SOFAGENT_HOME 环境变量，缺省 ~/.sofagent）——
 * 与 loadWatchConfig 内部判定**同一口径**，消费方（fs-watch 三分支文案 / cron 全局
 * fallback / 模板生成）不得自拼第二份路径。导出本函数即「零复制」承诺：路径规则
 * 变更只改这一处。
 */
export function resolveWatchYmlPaths(cwd?: string): [string, string] {
  const baseDir = cwd || process.cwd();
  const projectLevel = join(baseDir, '.sofagent', 'watch.yml');
  let homeDir: string;
  try {
    const { homedir } = require('os') as typeof import('os');
    homeDir = process.env.SOFAGENT_HOME ?? homedir();
  } catch {
    homeDir = process.env.SOFAGENT_HOME ?? process.env.HOME ?? '/tmp';
  }
  const globalLevel = join(homeDir, 'watch.yml');
  return [projectLevel, globalLevel];
}

/**
 * 加载 watch 配置（三级 fallback）
 *   1. ${cwd}/.sofagent/watch.yml
 *   2. $SOFAGENT_HOME/watch.yml（缺省 ~/.sofagent——v1.5.7 F46 起经
 *      resolveWatchYmlPaths SSOT 解析，与 install.sh 首装落点同口径）
 *   3. 默认配置
 *
 * @param cwd 工作目录
 * @returns WatchConfig
 */
export function loadWatchConfig(cwd?: string): WatchConfig {
  const baseDir = cwd || process.cwd();

  // 1. 尝试项目级配置
  const [projectConfigPath, globalConfigPath] = resolveWatchYmlPaths(baseDir);
  const projectConfig = tryLoadWatchYml(projectConfigPath);
  if (projectConfig) {
    return mergeWatchDefaults(projectConfig);
  }

  // 2. 尝试全局配置（路径经 SSOT 解析——此前硬编码 homedir()，SOFAGENT_HOME
  //    自定义根目录下与 install.sh 首装落点断链）
  const globalConfig = tryLoadWatchYml(globalConfigPath);
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

    // 🔴 v1.5.4 复查批：模板写侧是 snake_case（`debounce_ms`），读侧类型/消费方是 camelCase
    // （`debounceMs`，见 fs-watch.ts）——键名错配会让用户照模板调的防抖**静默落默认 5000**
    // 且无任何提示。此处做**读侧归一**（snake → camel）：存量已生成的 yml 继续有效，零迁移成本。
    // 类型放宽走 `Record<string, unknown>` 显式读取，不用 `as any`（禁类型擦除糊法）。
    const rawWatch = watch as Record<string, unknown>;
    if (result.debounceMs === undefined && typeof rawWatch['debounce_ms'] === 'number') {
      result.debounceMs = rawWatch['debounce_ms'];
    }

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
 *
 * F46（v1.5.7）：支持自省注入——`introspectedPaths` 传入时模板的 paths 段写
 * 探测结果（调用方 = daemon fs-watch 的 introspectDefaultWatchPaths：项目根
 * 一级目录，排除 .git/node_modules/dist/build/隐藏目录）而非占位 '.'。
 * 不传时维持旧模板（'.'——向后兼容，既有调用方 audit init 行为不变）。
 *
 * @param introspectedPaths 自省探测出的监控路径（可选——不传回落 '.'）
 */
export function generateWatchTemplate(introspectedPaths?: string[]): string {
  const paths = introspectedPaths && introspectedPaths.length > 0 ? introspectedPaths : ['.'];
  return [
    '# sofagent 文件监控配置',
    '# 由 daemon/fs-watch 在启动时读取',
    '',
    'watch:',
    '  # 要监控的路径（相对于项目根目录；以下为首装自省探测结果，可按需收窄）',
    '  paths:',
    ...paths.map((p) => `    - ${JSON.stringify(p)}`),
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
    '  # 键名：`debounce_ms`（模板口径）与 `debounceMs`（内部口径）**两种写法都接受**',
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
