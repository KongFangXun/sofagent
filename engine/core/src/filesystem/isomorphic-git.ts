// ============================================================
// isomorphic-git.ts · 同构 Git 引擎（自研）
// v1.3.4 新增：纯 JS 实现的 git diff / shadow repo
//
// 用途：
//   - 在非 git 目录中创建 shadow repo，实现文件快照和差异追踪
//   - 作为 diff-parser.ts 的 fallback——当系统 git 不可用时切换
//   - 支持 daemon/snapshot.ts 的快照提交
//
// 自研同构 Git 引擎（命名借鉴 isomorphic-git 风格，非 npm 包依赖）
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { randomBytes } from 'crypto';
import { REDACTION_PATTERNS } from '../shared/secret-patterns';

/** 被追踪的文件信息 */
interface TrackedFile {
  path: string;
  content: string;
}

/** 两个版本之间的差异 */
export interface IsoDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  oldContent: string | null;
  newContent: string | null;
}

/** 快照记录 */
export interface SnapshotEntry {
  sha: string;
  timestamp: string;
  files: Record<string, string>; // path → content
}

/**
 * v1.3.4 交付 1（P0）：对快照内容做脱敏处理——复用 shared/secret-patterns 的
 * REDACTION_PATTERNS（AKIA / sk- / ghp_ / 手机号等），防止密钥明文写进 snapshots.json。
 *
 * 扫描机制自己的快照不能成为密钥泄漏点（审计工具自查）。
 */
function sanitizeSnapshotContent(content: string): string {
  let sanitized = content;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    // REDACTION_PATTERNS 的 pattern 带 g flag，每次替换后需重置 lastIndex
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/** 快照上限——防止 snapshots.json 无限增长（主仓曾达 317MB）。超出时滚动覆盖最旧。 */
const MAX_SNAPSHOTS = 50;

/**
 * 为目录创建 shadow git 仓库（.sofagent/.git-shadow/）
 *
 * 结构：
 *   .sofagent/.git-shadow/
 *     snapshots.json  — 快照索引 + 文件内容存储
 *     config.json     — 仓库元信息
 *
 * @param dir 要追踪的目录
 * @returns shadow repo 的路径
 */
export function createShadowRepo(dir: string): string {
  const shadowDir = join(dir, '.sofagent', '.git-shadow');
  if (!existsSync(shadowDir)) {
    mkdirSync(shadowDir, { recursive: true, mode: 0o700 });
  }

  // 写入仓库配置文件
  const configPath = join(shadowDir, 'config.json');
  if (!existsSync(configPath)) {
    const config = {
      version: '1.0.8',
      created: new Date().toISOString(),
      trackedDir: dir,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  // 初始化快照索引
  const snapshotsPath = join(shadowDir, 'snapshots.json');
  if (!existsSync(snapshotsPath)) {
    writeFileSync(snapshotsPath, JSON.stringify({ snapshots: [] }, null, 2), 'utf-8');
  }

  return shadowDir;
}

/**
 * 读取 shadow repo 的快照索引
 */
function loadSnapshots(shadowDir: string): SnapshotEntry[] {
  const snapshotsPath = join(shadowDir, 'snapshots.json');
  if (!existsSync(snapshotsPath)) {
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(snapshotsPath, 'utf-8'));
    return Array.isArray(data.snapshots) ? data.snapshots : [];
  } catch {
    return [];
  }
}

/**
 * 保存快照索引到 shadow repo
 *
 * v1.3.4 交付 1（P0）：保存前做滚动裁剪——超过 MAX_SNAPSHOTS（50）时移除最旧的，
 * 避免 snapshots.json 无限增长（主仓曾达 317MB）。
 */
function saveSnapshots(shadowDir: string, snapshots: SnapshotEntry[]): void {
  // 滚动覆盖——超限时移除最旧的（数组首部）
  const toSave = snapshots.length > MAX_SNAPSHOTS
    ? snapshots.slice(snapshots.length - MAX_SNAPSHOTS)
    : snapshots;
  const snapshotsPath = join(shadowDir, 'snapshots.json');
  writeFileSync(snapshotsPath, JSON.stringify({ snapshots: toSave }, null, 2), 'utf-8');
}

/**
 * 扫描目录中所有文件（排除 .sofagent/ 和 node_modules/ 等）
 *
 * v1.3.4 交付 1（P0）扩展排除规则：
 *   - 现有：.sofagent / node_modules / .git / dist / .git-shadow
 *   - 新增：fixtures/ 目录（含已知密钥样本）、*.test.ts（测试文件）、.env.example
 *   - 原因：测试 fixture 和示例文件含合法密钥样本，不应进快照（否则审计自己会扫到自己）
 *
 * @param dir 要扫描的目录
 * @returns TrackedFile 数组（content 已经过 sanitize 脱敏）
 */
function scanFiles(dir: string): TrackedFile[] {
  const files: TrackedFile[] = [];
  const excludePatterns = ['.sofagent', 'node_modules', '.git', 'dist', '.git-shadow'];
  // v1.3.4 交付 1：测试 fixture / 密钥样本文件不应进快照
  const excludeFileSuffixes = ['.test.ts', '.env.example'];
  const excludeDirNames = ['fixtures', '__tests__', '__fixtures__'];

  function walk(currentDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      // 跳过排除目录
      if (excludePatterns.includes(entry)) continue;
      // v1.3.4: 跳过测试 fixture 目录
      if (excludeDirNames.includes(entry)) continue;
      if (entry.startsWith('.')) continue;

      const fullPath = join(currentDir, entry);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        // v1.3.4: 跳过测试文件 / 密钥样本文件
        if (excludeFileSuffixes.some((sfx) => entry.endsWith(sfx))) continue;

        try {
          const rawContent = readFileSync(fullPath, 'utf-8');
          // v1.3.4 交付 1（P0）：写入快照前做脱敏——密钥明文打码
          const content = sanitizeSnapshotContent(rawContent);
          const relativePath = relative(dir, fullPath);
          files.push({ path: relativePath, content });
        } catch {
          // 二进制文件或读取失败，跳过
        }
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * 生成 SHA-like 标识符（使用文件内容的简化哈希）
 */
function computeHash(content: string): string {
  // 简单的 FNV-1a 哈希 + 随机后缀，用于本地快照去重
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash = hash >>> 0;
  }
  // 附加时间戳 + 随机后缀确保唯一性
  const suffix = randomBytes(4).toString('hex');
  return `${hash.toString(16).padStart(8, '0')}-${suffix}`;
}

/**
 * 生成目录的差异（当前文件 vs 上次快照）
 *
 * 使用 isomorphic-git 风格的文件追踪：
 * 1. 扫描当前目录的所有文件
 * 2. 与 shadow repo 中最近一次快照对比
 * 3. 输出 added / modified / deleted 文件列表
 *
 * @param dir 要生成差异的目录
 * @returns IsoDiff 数组
 */
export function generateDiff(dir: string): IsoDiff[] {
  const diffs: IsoDiff[] = [];
  const shadowDir = join(dir, '.sofagent', '.git-shadow');

  // 如果没有 shadow repo，先创建一个
  if (!existsSync(shadowDir)) {
    createShadowRepo(dir);
  }

  const snapshots = loadSnapshots(shadowDir);
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const currentFiles = scanFiles(dir);

  // 构建当前文件 map
  const currentMap = new Map<string, string>();
  for (const file of currentFiles) {
    currentMap.set(file.path, file.content);
  }

  if (!latest) {
    // 无历史快照——所有文件都是新增
    for (const file of currentFiles) {
      diffs.push({
        path: file.path,
        status: 'added',
        oldContent: null,
        newContent: file.content,
      });
    }
  } else {
    const oldMap = new Map<string, string>(Object.entries(latest.files));

    // 检查新增和修改
    for (const [path, content] of currentMap) {
      if (!oldMap.has(path)) {
        diffs.push({ path, status: 'added', oldContent: null, newContent: content });
      } else if (oldMap.get(path) !== content) {
        diffs.push({ path, status: 'modified', oldContent: oldMap.get(path) ?? null, newContent: content });
      }
    }

    // 检查删除
    for (const [path, content] of oldMap) {
      if (!currentMap.has(path)) {
        diffs.push({ path, status: 'deleted', oldContent: content, newContent: null });
      }
    }
  }

  return diffs;
}

/**
 * 提交当前文件状态到 shadow repo（快照）
 *
 * 由 daemon/snapshot.ts 在审计通过后调用
 *
 * @param dir 要快照的目录
 * @returns 新快照的 SHA
 */
export function commitSnapshot(dir: string): string {
  const shadowDir = join(dir, '.sofagent', '.git-shadow');
  if (!existsSync(shadowDir)) {
    createShadowRepo(dir);
  }

  const snapshots = loadSnapshots(shadowDir);
  const currentFiles = scanFiles(dir);

  // 生成当前文件 map
  const files: Record<string, string> = {};
  for (const file of currentFiles) {
    files[file.path] = file.content;
  }

  // 生成 SHA（基于所有文件内容的哈希）
  const contentForHash = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, c]) => `${p}:${c.length}`)
    .join('\n');
  const sha = computeHash(contentForHash);

  const entry: SnapshotEntry = {
    sha,
    timestamp: new Date().toISOString(),
    files,
  };

  snapshots.push(entry);
  saveSnapshots(shadowDir, snapshots);

  return sha;
}

/**
 * 恢复到指定快照
 *
 * 只读恢复——将快照中的文件内容写回工作目录。
 * 不自动 push，不自动 revert。
 *
 * @param dir 工作目录
 * @param sha 快照 SHA
 * @returns 恢复的文件路径列表
 */
export function revertToSnapshot(dir: string, sha: string): string[] {
  const shadowDir = join(dir, '.sofagent', '.git-shadow');
  if (!existsSync(shadowDir)) {
    throw new Error(`Shadow repo 不存在: ${shadowDir}`);
  }

  const snapshots = loadSnapshots(shadowDir);
  const target = snapshots.find((s) => s.sha === sha);
  if (!target) {
    throw new Error(`快照 ${sha} 未找到。可用快照: ${snapshots.map((s) => s.sha.slice(0, 8)).join(', ')}`);
  }

  const restored: string[] = [];
  for (const [relativePath, content] of Object.entries(target.files)) {
    const fullPath = join(dir, relativePath);
    try {
      // 确保父目录存在
      const parentDir = dirname(fullPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true, mode: 0o700 });
      }
      writeFileSync(fullPath, content, 'utf-8');
      restored.push(relativePath);
    } catch (err) {
      console.error(`sofagent 恢复文件时遇到问题: ${fullPath}`, (err as Error).message);
    }
  }

  return restored;
}

/**
 * 列出 shadow repo 中的所有快照
 *
 * @param dir 工作目录
 * @returns 快照条目数组
 */
export function listSnapshots(dir: string): SnapshotEntry[] {
  const shadowDir = join(dir, '.sofagent', '.git-shadow');
  if (!existsSync(shadowDir)) return [];
  return loadSnapshots(shadowDir);
}

/**
 * 检查 shadow repo 是否存在
 */
export function hasShadowRepo(dir: string): boolean {
  return existsSync(join(dir, '.sofagent', '.git-shadow'));
}

/**
 * 为指定文件列表生成文件系统差异
 *
 * 与 generateDiff() 不同，此函数仅对传入的 filePaths 列表生成 diff，
 * 不做全目录扫描。适用于 daemon fs-watch 回调场景——只对变更文件做审计。
 *
 * 将每个文件当前内容与 shadow repo 最近快照对比，未在快照中的文件视为 'added'。
 *
 * @param dir 项目根目录
 * @param filePaths 要生成差异的文件路径列表（相对于 dir）
 * @returns IsoDiff 数组
 */
export function generateFilesystemDiff(dir: string, filePaths: string[]): IsoDiff[] {
  const diffs: IsoDiff[] = [];
  const shadowDir = join(dir, '.sofagent', '.git-shadow');

  // 加载最近一次快照
  let latestMap: Map<string, string> | null = null;
  if (existsSync(shadowDir)) {
    const snapshots = loadSnapshots(shadowDir);
    if (snapshots.length > 0) {
      const latest = snapshots[snapshots.length - 1]!;
      latestMap = new Map<string, string>(Object.entries(latest.files));
    }
  }

  for (const relativePath of filePaths) {
    const fullPath = join(dir, relativePath);

    // 读取当前文件内容
    let currentContent: string | null = null;
    try {
      currentContent = readFileSync(fullPath, 'utf-8');
    } catch {
      // 文件可能已被删除
    }

    const oldContent = latestMap?.get(relativePath) ?? null;

    if (currentContent === null && oldContent === null) {
      // 文件既不在当前目录也不在快照中——跳过
      continue;
    }

    if (currentContent === null && oldContent !== null) {
      diffs.push({ path: relativePath, status: 'deleted', oldContent, newContent: null });
    } else if (oldContent === null && currentContent !== null) {
      diffs.push({ path: relativePath, status: 'added', oldContent: null, newContent: currentContent });
    } else if (currentContent !== null && oldContent !== null && currentContent !== oldContent) {
      diffs.push({ path: relativePath, status: 'modified', oldContent, newContent: currentContent });
    }
    // 内容相同 → 不生成 diff
  }

  return diffs;
}
