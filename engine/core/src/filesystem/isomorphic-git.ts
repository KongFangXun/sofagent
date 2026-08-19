// ============================================================
// isomorphic-git.ts · 同构 Git 引擎（自研）
// v1.3.7 新增：纯 JS 实现的 git diff / shadow repo
//
// 用途：
//   - 在非 git 目录中创建 shadow repo，实现文件快照和差异追踪
//   - 作为 diff-parser.ts 的 fallback——当系统 git 不可用时切换
//   - 支持 daemon/snapshot.ts 的快照提交
//
// 自研同构 Git 引擎（命名借鉴 isomorphic-git 风格，非 npm 包依赖）
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { createHash } from 'crypto';
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
 * v2 存储格式（2026-08-16 磁盘治理）：内容寻址去重。
 *
 * v1 问题：每份快照全文存所有文件（path → content 直存），13 份快照 = 141MB，
 * 50 份上限将膨胀到 545MB——而快照间 99% 文件内容相同，纯冗余。
 *
 * v2 结构：
 *   {
 *     version: 2,
 *     blobs: { [contentHash]: fileContent },   // 内容池——跨快照共享，同内容只存一份
 *     snapshots: [{ sha, timestamp, fileIndex: { [path]: contentHash } }]  // 快照只存索引
 *   }
 *
 * loadSnapshots() 透明还原为 v1 形状（files: path → content），所有消费方零改动。
 * 兼容：读 v1（无 version 字段）自动按旧格式解析。
 */
interface ShadowStore {
  version?: number;
  blobs?: Record<string, string>;
  snapshots?: Array<{ sha: string; timestamp: string; fileIndex?: Record<string, string>; files?: Record<string, string> }>;
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
 *
 * v2 格式透明还原：fileIndex + blobs → files（path → content），消费方零感知。
 * v1 格式（无 version 字段）直接按旧结构解析。
 */
function loadSnapshots(shadowDir: string): SnapshotEntry[] {
  const snapshotsPath = join(shadowDir, 'snapshots.json');
  if (!existsSync(snapshotsPath)) {
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(snapshotsPath, 'utf-8')) as ShadowStore;
    if (!Array.isArray(data.snapshots)) return [];
    // v2：内容寻址还原
    if (data.version === 2 && data.blobs) {
      return data.snapshots.map((s) => {
        if (!s.fileIndex) return { sha: s.sha, timestamp: s.timestamp, files: s.files ?? {} };
        const files: Record<string, string> = {};
        for (const [p, h] of Object.entries(s.fileIndex)) {
          files[p] = data.blobs![h] ?? ''; // blob 丢失时降级为空串（不 crash 恢复流程）
        }
        return { sha: s.sha, timestamp: s.timestamp, files };
      });
    }
    // v1：旧格式直读
    return data.snapshots.map((s) => ({ sha: s.sha, timestamp: s.timestamp, files: s.files ?? {} }));
  } catch {
    return [];
  }
}

/**
 * 保存快照索引到 shadow repo
 *
 * v1.3.4：滚动裁剪——超过 MAX_SNAPSHOTS（50）时移除最旧。
 * v2（2026-08-16）：内容寻址去重——文件内容进 blobs 池（同内容只存一份），
 * 快照条目只存 path → hash 索引；裁剪后孤儿 blob（无快照引用）一并回收。
 * 实测效果：13 份全量快照 141MB → 去重后约 11MB（只存真实变化 + 单份基线）。
 */
function saveSnapshots(shadowDir: string, snapshots: SnapshotEntry[]): void {
  // 滚动覆盖——超限时移除最旧的（数组首部）
  const toSave = snapshots.length > MAX_SNAPSHOTS
    ? snapshots.slice(snapshots.length - MAX_SNAPSHOTS)
    : snapshots;

  // 内容寻址去重：构建 blobs 池 + 每快照的 path → hash 索引
  const blobs: Record<string, string> = {};
  const indexed = toSave.map((s) => {
    const fileIndex: Record<string, string> = {};
    for (const [p, content] of Object.entries(s.files)) {
      const h = computeHash(`blob:${content}`);
      if (!blobs[h]) blobs[h] = content; // 同内容只存一份
      fileIndex[p] = h;
    }
    return { sha: s.sha, timestamp: s.timestamp, fileIndex };
  });

  // 回收孤儿 blob：只保留被引用的（裁剪掉的快照其独有 blob 一并释放）
  const referenced = new Set<string>();
  for (const s of indexed) {
    for (const h of Object.values(s.fileIndex)) referenced.add(h);
  }
  const prunedBlobs: Record<string, string> = {};
  for (const [h, content] of Object.entries(blobs)) {
    if (referenced.has(h)) prunedBlobs[h] = content;
  }

  const snapshotsPath = join(shadowDir, 'snapshots.json');
  // v1.3.8 交付九：并发竞态加固——临时文件 + rename 原子替换。
  // 原实现 writeFileSync 直写 snapshots.json：daemon fs-watch 批量事件与
  // 手动 rollback 并发时，两方同时直写会让读者拿到半截 JSON（loadSnapshots
  // JSON.parse 失败静默返回 []，快照全丢）。写 .tmp 再 rename——同一文件系统
  // 内 rename 原子，读者要么看到旧版要么看到新版。
  const tmpPath = `${snapshotsPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ version: 2, blobs: prunedBlobs, snapshots: indexed }, null, 2), 'utf-8');
  renameSync(tmpPath, snapshotsPath);
}

/**
 * 判断文件是否为二进制（v1.3.6 新增 · 2026-08-16 图片损坏事故）
 *
 * 检测规则：前 8000 字节内出现 NUL 字节（0x00）即判为二进制。
 * 文本文件（源码 / Markdown / YAML / JSON）不含 NUL；二进制格式（PNG/JPG/PDF/zip 等）
 * 几乎必然在前 8KB 内出现 NUL。这是 git 官方 is_binary 的同款启发式。
 *
 * 背景：原实现用 readFileSync(path, 'utf-8') 读二进制文件，Node 会把无效 UTF-8
 * 字节静默替换成 U+FFFD 而不抛异常——损坏内容被存进快照，恢复时图片永久损毁。
 */
function isBinaryBuffer(buf: Buffer): boolean {
  const sampleLen = Math.min(buf.length, 8000);
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
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
          // 🔴 v1.3.6 修复（2026-08-16 图片损坏事故）：先读 Buffer 判二进制——
          // 原实现直接 readFileSync(fullPath, 'utf-8')，二进制文件（PNG 等）的无效
          // UTF-8 字节（如 0x89）会被 Node 静默替换成 U+FFFD 而不抛异常，损坏的
          // 字符串被存进快照，恢复时图片永久损毁（README 6 张图裂图事故根因）。
          // 二进制文件不进文本快照——它无法被 sanitize 脱敏，也无需文本级回溯。
          const buf = readFileSync(fullPath);
          if (isBinaryBuffer(buf)) {
            continue; // 二进制文件跳过，不进快照
          }
          const rawContent = buf.toString('utf-8');
          // v1.3.4 交付 1（P0）：写入快照前做脱敏——密钥明文打码
          const content = sanitizeSnapshotContent(rawContent);
          const relativePath = relative(dir, fullPath);
          files.push({ path: relativePath, content });
        } catch {
          // 读取失败，跳过
        }
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * 生成 SHA-like 标识符（内容哈希）
 *
 * v2 修正（2026-08-16）：
 *   1. 去掉随机后缀——原实现 `${hash}-${randomBytes(4)}` 导致同一内容每次哈希不同，
 *      是快照去重与「无变化跳过」失效的根因（生产 13 份快照中 2 份内容全同仍被追加）。
 *   2. FNV-1a 32 位 → sha256 截断 16 hex（64 位）——32 位在 ~50 份快照的短内容场景
 *      即可碰撞（实测 content-0..content-51 序列出现同哈希），64 位碰撞概率可忽略。
 * 快照 SHA 唯一性由内容保证：内容不同哈希必不同；同 SHA = 同内容 = 可安全去重。
 */
function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
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
  // v2 修正（2026-08-16）：原实现用 `${path}:${content.length}` 做哈希输入——
  // 等长不同内容（如 version-1/version-2）会产出相同 SHA，被「无变化跳过」误判。
  // 改为内容哈希参与：内容变 SHA 必变，SHA 同内容必同。
  const contentForHash = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, c]) => `${p}:${computeHash(c)}`)
    .join('\n');
  const sha = computeHash(contentForHash);

  // v2：无变化跳过——工作区与最近快照相同时不追加重复条目（省磁盘 + 恢复点列表干净）
  if (isUnchangedSnapshot(snapshots, sha)) {
    return sha;
  }

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
 * v2（2026-08-16 磁盘治理）：检查快照是否需要落盘。
 *
 * 去重跳过——工作区无变化（SHA 与最近快照相同）时不追加新条目。
 * 实测主仓 13 份快照中 2 份是重复 SHA（连续 commit 无变化），
 * 纯浪费磁盘与列表噪音（listSnapshots/rollback 恢复点选择）。
 * 返回 false = 无变化已跳过，commitSnapshot 直接返回现有 SHA。
 */
function isUnchangedSnapshot(snapshots: SnapshotEntry[], sha: string): boolean {
  if (snapshots.length === 0) return false;
  return snapshots[snapshots.length - 1]!.sha === sha;
}

/**
 * 恢复到指定快照（v1.3.8 交付九：两阶段原子恢复）
 *
 * 只读恢复——将快照中的文件内容写回工作目录。
 * 不自动 push，不自动 revert。
 *
 * 🔴 v1.3.8 加固（原实现的事故隐患）：
 *   原实现逐文件 writeFileSync 直写工作目录——恢复进行到一半时进程崩溃
 *   （OOM / SIGKILL / 磁盘满），工作区一半是旧内容一半是新内容，且无任何
 *   回滚手段（快照未动，但工作区已被污染成不可用的中间态）。
 *
 *   两阶段协议：
 *     阶段一（staging）：所有目标文件先写入 .sofagent/.revert-staging/ 下的
 *       镜像目录树。任何一个文件写失败 → 立即抛错，工作目录保持完整原状。
 *     阶段二（commit）：staging 全部落盘成功后，逐文件 rename 原子替换到
 *       工作目录。rename 同文件系统原子——任意时刻读者看到的文件要么是
 *       完整旧版要么是完整新版。
 *
 *   注意：rename 阶段理论上仍可能在中途被打断（SIGKILL 无 handler 可拦截），
 *   但此时 staging 目录留存于 runDir 内，可据此人工续做/回退；且每单个文件
 *   都是原子替换（不存在半截文件），损害面从「任意文件可能截断」收敛为
 *   「部分文件已换新、部分未换」——配合 staging 留痕可完整续做。
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

  // ── 阶段一：全量写入 .sofagent/.revert-staging/（不触碰工作目录）──
  // staging 根 = <dir>/.sofagent/.revert-staging——与工作目录同文件系统，
  // 保证阶段二 rename 的原子性；.sofagent 本身在 scanFiles 排除清单内，
  // staging 内容不会被下一次快照收进来。
  const stagingRoot = join(dir, '.sofagent', '.revert-staging');
  // 残留清理：上次恢复中断可能留下旧 staging 中的部分文件。
  // 逐项清空 staging 根内部（readdir + rmSync）——不整体 rm staging 根本身，
  // 避免两次系统调用（rm + mkdir）之间的窗口；清理失败不阻断（后续写入
  // 会立刻暴露同一问题并走 staging 失败路径，工作目录仍零污染）。
  if (existsSync(stagingRoot)) {
    try {
      for (const entry of readdirSync(stagingRoot)) {
        rmSync(join(stagingRoot, entry), { recursive: true, force: true });
      }
    } catch { /* 清理失败会在下方写入时暴露 */ }
  } else {
    mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  }

  const stagedFiles: Array<{ stagingPath: string; finalPath: string; relativePath: string }> = [];
  for (const [relativePath, content] of Object.entries(target.files)) {
    const finalPath = join(dir, relativePath);
    const stagingPath = join(stagingRoot, relativePath);
    const stagingParent = dirname(stagingPath);
    try {
      if (!existsSync(stagingParent)) {
        mkdirSync(stagingParent, { recursive: true, mode: 0o700 });
      }
      writeFileSync(stagingPath, content, 'utf-8');
      stagedFiles.push({ stagingPath, finalPath, relativePath });
    } catch (err) {
      // 阶段一失败：工作目录一个字节都没动，原状完整。
      // staging 留在原地（尸检证据）——不删，让调用方/人工可以看到失败现场。
      throw new Error(
        `恢复中止（staging 阶段写入失败，工作目录未被修改）: ${stagingPath}: ${(err as Error).message}`
      );
    }
  }

  // ── 阶段二：校验通过后逐文件 rename 原子切换 ──
  // 单文件失败：记录错误继续切换其余文件（rename 失败通常是权限/句柄问题，
  // 中止也无济于事——已切换的文件保持新内容，错误如实上报由调用方决策）。
  const restored: string[] = [];
  const commitErrors: string[] = [];
  for (const { stagingPath, finalPath, relativePath } of stagedFiles) {
    try {
      const finalParent = dirname(finalPath);
      if (!existsSync(finalParent)) {
        mkdirSync(finalParent, { recursive: true, mode: 0o700 });
      }
      renameSync(stagingPath, finalPath);
      restored.push(relativePath);
    } catch (err) {
      commitErrors.push(`${relativePath}: ${(err as Error).message}`);
      console.error(`sofagent 恢复文件时遇到问题: ${finalPath}`, (err as Error).message);
    }
  }

  // 全部切换成功 → staging 目录已空壳，清掉；有失败 → 留存（含未切换的残留文件）
  if (commitErrors.length === 0) {
    try { rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* 空目录清理失败无害 */ }
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
