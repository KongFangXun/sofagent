// ============================================================
// diff-parser.ts · git diff 解析器
// v1.4.5: 添加 isomorphic-git fallback（当系统 git 不可用时）
// v1.4.5（十二）：>5MB diff 缝隙修复——maxBuffer 溢出不再跳过内容扫描，
//   改走 spill 落盘（spawnSync stdio fd 重定向，零内存写文件）+ 分块读回。
//   读回上限 64MB：以内全量扫描（oversized 不置位，无审计盲区）；
//   超限截断（oversized 置位，WARN 注入）+ spillFile locator 供按需取回。
// ============================================================

import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, openSync, closeSync, readSync } from 'fs';
import { join } from 'path';
import { getDataDir } from './data-paths';

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  lines: string[];
  /**
   * 该文件的 diff 超过读回上限（64MB）被截断的标记。
   * 置位时 lines 只含截断前内容，调用方（audit/index.ts）据此注入 WARN 级发现；
   * spillFile 提供落盘 locator，审计规则可按需取回全量内容。
   * v1.3.9 语义变化：5MB 溢出但读回成功（≤64MB）时不再置位——内容已全量扫描。
   */
  oversized?: boolean;
  /**
   * v1.3.9（十二）：超大 diff 的 spill 落盘文件绝对路径（locator）。
   * diff 超 5MB 时先溢出到磁盘再分块读回——落盘件保留，
   * 审计规则（如 A2 密钥检测）可经此路径按需取回全量内容。
   */
  spillFile?: string;
}

/**
 * git diff --numstat 输出的单条记录
 * 格式：<added_lines>\t<deleted_lines>\t<file_path>
 */
export interface NumstatEntry {
  path: string;
  addedLines: number;
  deletedLines: number;
}

// ============================================================
// v1.3.9（十二）：超大 diff spill 落盘 + 分块读回
// ============================================================

/** 读回上限——单文件 diff 溢出落盘后允许读回的最大字节数（超过则截断 + locator 取回） */
const SPILL_READ_CAP = 64 * 1024 * 1024;

/** 分块读取大小（8MB 一块，流式拼行） */
const SPILL_CHUNK = 8 * 1024 * 1024;

/**
 * spill 落盘目录：显式 SOFAGENT_DATA 环境变量 > ~/.sofagent/data/（引擎 home）
 *
 * v1.4.3 P2-e 修复（跨仓密钥泄漏面）：旧实现 `join(process.env.SOFAGENT_DATA ?? 'data', 'spill')`
 * 在 SOFAGENT_DATA 未设时落 **CWD/data/spill（被审仓库内）**——本仓靠 .gitignore `/data/` 兜底，
 * 但跨仓审计时对方仓库无此 ignore，spill 文件（可能含密钥类 diff 内容）会被对方 commit 卷入。
 * 改走 core getDataDir SSOT 解析链（显式 > SOFAGENT_DATA > SOFAGENT_HOME/data），spill 恒落
 * 被审仓库外的引擎数据目录（与 audit-history 的 resolveHomeDir 惯例真正同源——旧注释自称
 * 「与 audit-history 保持同一惯例」实际解析链完全不同，注释与实现二重漂移）。
 */
function resolveSpillDir(): string {
  return join(getDataDir(), 'spill');
}

/**
 * 超大 diff 的 spill 读取结果
 */
interface SpillReadResult {
  /** 读回的 diff 行（截断时只含前段） */
  lines: string[];
  /** 是否因超过读回上限被截断 */
  truncated: boolean;
  /** spill 落盘文件绝对路径（locator，无论是否截断都保留） */
  spillFile: string;
}

/**
 * 把一次 git diff 输出 spill 到磁盘文件（spawnSync stdio fd 重定向，零内存），
 * 再分块读回拼行。攻击者构造超大 diff 藏密钥的场景（LIMITATIONS >5MB 缝隙）
 * 由这条路径兜住：内容不再因 execFileSync maxBuffer 跳过扫描。
 *
 * @param gitArgs git diff 完整参数（与 execFileSync 调用一致）
 * @param cwd 仓库目录
 * @param filePath 文件路径（spill 文件名去重用）
 */
function spillDiffToLines(gitArgs: string[], cwd: string | undefined, filePath: string): SpillReadResult {
  const spillDir = resolveSpillDir();
  // mode 0o700：spill 目录可能落密钥类 diff 内容——v1.2.3 权限加固纪律（场景 153）
  mkdirSync(spillDir, { recursive: true, mode: 0o700 });
  const hash = createHash('sha256').update(`${filePath}:${gitArgs.join(' ')}`).digest('hex').slice(0, 16);
  const spillFile = join(spillDir, `diff-${hash}.diff`);

  // 第一步：stdout 直接重定向进文件——spawnSync 对 fd 型 stdio 不做缓冲，
  // git 输出多大都不占 Node 内存
  const fd = openSync(spillFile, 'w');
  try {
    spawnSync('git', gitArgs, { cwd, stdio: ['ignore', fd, 'ignore'] });
  } finally {
    closeSync(fd);
  }

  // 第二步：分块读回拼行（带跨块残行拼接）
  const lines: string[] = [];
  let truncated = false;
  let totalBytes = 0;
  let carry = '';
  const readFd = openSync(spillFile, 'r');
  try {
    const buf = Buffer.allocUnsafe(SPILL_CHUNK);
    for (;;) {
      // readSync 返回字节数（数字）——不是 { bytesRead } 对象
      const bytesRead = readSync(readFd, buf, 0, SPILL_CHUNK, null);
      if (bytesRead === 0) break;
      if (totalBytes + bytesRead > SPILL_READ_CAP) {
        truncated = true;
        break; // 截断——剩余内容经 spillFile locator 按需取回
      }
      totalBytes += bytesRead;
      const chunk = carry + buf.toString('utf-8', 0, bytesRead);
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline === -1) {
        carry = chunk;
      } else {
        const complete = chunk.slice(0, lastNewline);
        for (const line of complete.split('\n')) lines.push(line);
        carry = chunk.slice(lastNewline + 1);
      }
    }
    if (!truncated && carry.length > 0) lines.push(carry); // 末行无换行符的残余
  } finally {
    closeSync(readFd);
  }

  return { lines, truncated, spillFile };
}

/**
 * 读取单文件 diff 内容（execFileSync 5MB 快路径 + 溢出 spill 兜底）。
 * v1.3.9（十二）：溢出不再「跳过内容审计」——落盘读回，A2 密钥检测照常扫全量。
 */
function readDiffLines(
  gitArgs: string[],
  cwd: string | undefined,
  filePath: string
): { lines: string[]; oversized: boolean; spillFile?: string } {
  try {
    const diffContent = execFileSync('git', gitArgs, {
      encoding: 'utf-8',
      cwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { lines: diffContent.split('\n'), oversized: false };
  } catch (err) {
    const isBufOverflow = (err as NodeJS.ErrnoException)?.code === 'ENOBUFS'
      || /maxBuffer/i.test((err as Error)?.message ?? '');
    if (!isBufOverflow) {
      console.error('[diff-parser] 读取文件差异失败:', err);
      return { lines: [], oversized: false };
    }
    // 溢出 → spill 落盘分块读回（内容照扫，不再跳过）
    console.error(`[diff-parser] 文件 ${filePath} 的 diff 超过 5MB，spill 落盘后分块扫描`);
    const spilled = spillDiffToLines(gitArgs, cwd, filePath);
    if (spilled.truncated) {
      console.error(`[diff-parser] 文件 ${filePath} 的 diff 超过 64MB 读回上限，已截断（全量内容经 spill 落盘：${spilled.spillFile}）`);
    }
    return {
      lines: spilled.lines,
      oversized: spilled.truncated,
      ...(spilled.truncated || spilled.lines.length > 0 ? { spillFile: spilled.spillFile } : {}),
    };
  }
}

/**
 * 判断当前工作目录是否在 git 仓库内
 */
export function isInGitRepo(cwd?: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'], // 静默 stderr
    });
    return true;
  } catch {
    // 吞掉 stack trace（非 git 目录是正常场景，不该打原生 Node 堆栈）；
    // 调用方（parseDiff/parseStagedDiff）会给出友好的"不在 git 仓库"提示
    return false;
  }
}

/**
 * 检测 git 命令输出是否为帮助文本（而非正常的 diff 输出）
 * 当 git diff 收到无效参数时可能输出帮助文本到 stdout
 *
 * 启发式检测：
 * - 以 "usage:" 开头（英文帮助）
 * - 以 "用法：" 开头（中文帮助）
 * - 第一行包含 "git diff"
 */
function isGitHelpText(output: string): boolean {
  const firstLine = output.split('\n')[0]?.toLowerCase() ?? '';
  return (
    firstLine.startsWith('usage:') ||
    firstLine.startsWith('用法：') ||
    firstLine.startsWith('用法:') ||
    (firstLine.includes('git diff') && !firstLine.includes('\t'))
  );
}

/**
 * 解析 git diff 指定范围的文件变更
 */
export function parseDiff(range: string, cwd?: string): DiffFile[] {
  const files: DiffFile[] = [];

  // 参数格式校验：range 只允许 [a-zA-Z0-9~^.\-/] 字符，防止命令注入和 git flag 注入
  // `/` 是合法 refspec 字符（分支名 origin/main）；execFileSync 数组传参不经 shell，无注入风险
  if (!/^[a-zA-Z0-9~^.\-\/]+$/.test(range)) {
    console.error(
      `参数校验失败: range "${range}" 包含非法字符。只允许 [a-zA-Z0-9~^.-/] 字符。`
    );
    console.error(
      '提示：使用 git refspec 而非文件路径，例如 HEAD~1..HEAD 或 origin/main..HEAD'
    );
    return files;
  }

  // 非 git 仓库检测——给用户明确的错误提示
  if (!isInGitRepo(cwd)) {
    console.error('错误：当前目录不在 git 仓库内。sofagent-audit 需要 git 仓库才能运行。');
    return files;
  }

  try {
    // 检测首次提交——HEAD 或 HEAD~1 在全新仓库首次 commit 时不存在
    // commit-msg hook 传 --diff HEAD，命令行传 --diff HEAD~1..HEAD，两种都要覆盖
    if (range.includes('HEAD')) {
      const refToVerify = range.includes('HEAD~1') ? 'HEAD~1' : 'HEAD';
      try {
        execFileSync('git', ['rev-parse', '--verify', refToVerify], {
          encoding: 'utf-8',
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        // v1.3.1 #11: 不打印整个 err 对象（首跑会输出完整 stack trace）。
        // v1.3.5 #28: console.error 降级为 debug 开关——首跑（空 HEAD）是正常场景，
        // 开发者向的 [diff-parser] 内部报错不应泄漏到用户 stderr；上层已有
        // 人话提示（下方 console.log），SOFAGENT_DEBUG=1 时才输出技术细节。
        if (process.env.SOFAGENT_DEBUG === '1') {
          console.error('[diff-parser] 验证 git ref 失败:', err instanceof Error ? err.message : String(err));
        }
        // v1.3.8 P1-B1：此前的「首次提交，无需审计」提示改为 stderr + [sofagent] 前缀——
        // 它是状态说明而非审计结果，混在 stdout 会让 quick 模式的输出顺序错乱
        // （parseDiff 先打「无需审计」→ cli-quick 又打「审计最近一次 commit」，互相矛盾）。
        // 调用方（cli-quick）已自带产品化的「首个 commit 无基线不审计」输出。
        console.error('[sofagent] ⚠️ 无 diff 基线（首次提交或空仓库）——没有前一个版本可对比，本次返回空 diff。');
        return files;
      }
    }

    // 获取变更文件列表——execFileSync 不 spawn shell，参数作为数组传递，避免命令注入
    // v1.0.5: 加 --find-renames 避免重命名+修改文件漏检
    // v1.3.8 P1-B5：stdio pipe stderr——非法 refspec 时 git 的 raw stderr
    // （fatal: ambiguous argument ...）不再直接透传到用户终端，由 catch 统一产品化提示
    const output = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--find-renames', '--name-status', range], {
      encoding: 'utf-8',
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 检测 git 帮助文本：当 range 无效时，git diff 可能输出帮助文本而非 diff
    // 帮助文本以 "usage:" 开头或包含 "git diff" 帮助内容
    const trimmedOutput = output.trim();
    if (trimmedOutput.length > 0 && isGitHelpText(trimmedOutput)) {
      console.error(`错误：git diff "${range}" 返回了帮助文本而非差异输出。请检查 diff range 参数是否有效。`);
      return files;
    }

    const lines = trimmedOutput.split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.split('\t');
      const statusCode = parts[0];
      if (!statusCode) continue;

      let status: DiffFile['status'] = 'modified';
      let path: string;
      let oldPath: string | undefined;

      if (statusCode.startsWith('R')) {
        // 重命名: R100 old.ts\tnew.ts
        status = 'renamed';
        const p1 = parts[1];
        const p2 = parts[2];
        if (!p1 || !p2) continue;
        oldPath = p1;
        path = p2;
      } else if (statusCode === 'A') {
        status = 'added';
        const p = parts[1];
        if (!p) continue;
        path = p;
      } else if (statusCode === 'D') {
        status = 'deleted';
        const p = parts[1];
        if (!p) continue;
        path = p;
      } else {
        // M = modified
        const p = parts[1];
        if (!p) continue;
        path = p;
      }

      if (path) {
        // 读取具体 diff 内容
        // v1.2.0 修复：rename 文件必须同时传 oldPath 和 path 作为 pathspec，
        // 否则 git 无法配对 rename，R100 纯改名会被当成全新文件输出全量 diff
        // v1.3.9（十二）：溢出走 spill 落盘读回——内容不跳过，A2 密钥检测全量覆盖
        const pathspec = (status === 'renamed' && oldPath) ? [oldPath, path] : [path];
        const gitArgs = ['-c', 'core.quotePath=false', 'diff', range, '--', ...pathspec];
        const { lines: diffLines, oversized, spillFile } = readDiffLines(gitArgs, cwd, path);

        files.push({ path, status, oldPath, lines: diffLines, ...(oversized ? { oversized: true } : {}), ...(spillFile ? { spillFile } : {}) });
      }
    }
  } catch (err) {
    // git diff 失败——非 git 仓库或无提交记录
    // v1.3.8 P1-B5：产品化提示（[sofagent] 前缀）替代 raw git stderr 透传；
    // 技术细节只在 SOFAGENT_DEBUG=1 时输出
    if (process.env.SOFAGENT_DEBUG === '1') {
      console.error('[diff-parser] git diff 失败:', (err as Error).message);
    }
    console.error(`[sofagent] ⚠️ 无法解析 diff 范围 "${range}"——请检查 ref 是否存在（如 HEAD~1..HEAD），或仓库是否尚无提交。`);
  }

  return files;
}

/**
 * 解析 git staged 文件变更（--cached 模式，用于首次提交场景）
 * 与 parseDiff 不同，不依赖 HEAD~1..HEAD 范围，而是直接扫描 staged 文件
 */
export function parseStagedDiff(): DiffFile[] {
  const files: DiffFile[] = [];

  if (!isInGitRepo()) {
    console.error('错误：当前目录不在 git 仓库内。sofagent-audit 需要 git 仓库才能运行。');
    return files;
  }

  try {
    // 获取 staged 文件列表
    const output = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-status'], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const trimmedOutput = output.trim();
    if (trimmedOutput.length === 0) {
      return files;
    }

    const lines = trimmedOutput.split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.split('\t');
      const statusCode = parts[0];
      if (!statusCode) continue;

      let status: DiffFile['status'] = 'modified';
      let path: string;
      let oldPath: string | undefined;

      if (statusCode.startsWith('R')) {
        status = 'renamed';
        const p1 = parts[1];
        const p2 = parts[2];
        if (!p1 || !p2) continue;
        oldPath = p1;
        path = p2;
      } else if (statusCode === 'A') {
        status = 'added';
        const p = parts[1];
        if (!p) continue;
        path = p;
      } else if (statusCode === 'D') {
        status = 'deleted';
        const p = parts[1];
        if (!p) continue;
        path = p;
      } else {
        const p = parts[1];
        if (!p) continue;
        path = p;
      }

      if (path) {
        // 读取 staged diff 内容
        // v1.2.0 修复：rename 文件必须同时传 oldPath 和 path 作为 pathspec，
        // 否则 git 无法配对 rename，R100 纯改名会被当成全新文件输出全量 diff
        // v1.3.9（十二）：溢出走 spill 落盘读回——内容不跳过（与 parseDiff 同机制）
        const pathspec = (status === 'renamed' && oldPath) ? [oldPath, path] : [path];
        const gitArgs = ['-c', 'core.quotePath=false', 'diff', '--cached', '--', ...pathspec];
        // parseStagedDiff 不收 cwd（沿用 v1.3.8 前行为：在当前目录跑 git）
        const { lines: diffLines, oversized, spillFile } = readDiffLines(gitArgs, undefined, path);

        files.push({ path, status, oldPath, lines: diffLines, ...(oversized ? { oversized: true } : {}), ...(spillFile ? { spillFile } : {}) });
      }
    }
  } catch (err) {
    console.error('无法执行 git diff --cached:', (err as Error).message);
  }

  return files;
}

/**
 * 获取 diff 中新增的行（以 + 开头）
 */
export function getAddedLines(diffFile: DiffFile): string[] {
  return diffFile.lines
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.substring(1));
}

/**
 * 获取 diff 中删除的行（以 - 开头）
 */
export function getRemovedLines(diffFile: DiffFile): string[] {
  return diffFile.lines
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.substring(1));
}

/**
 * 解析 git diff --numstat 输出
 * 格式示例：
 *   10\t5\tsrc/index.ts
 *   0\t20\tsrc/legacy.ts
 *   200\t0\tsrc/new-file.ts
 * 第一列：添加行数，第二列：删除行数（- 表示二进制），第三列：文件路径
 */
export function parseNumstat(numstatOutput: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  const lines = numstatOutput.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const addedStr = parts[0];
    const deletedStr = parts[1];
    if (addedStr === undefined || deletedStr === undefined) continue;
    const path = parts.slice(2).join('\t'); // 文件名可能含 \t

    // 处理二进制文件（显示为 -）
    const addedLines = addedStr === '-' ? 0 : parseInt(addedStr, 10);
    const deletedLines = deletedStr === '-' ? 0 : parseInt(deletedStr, 10);

    if (isNaN(addedLines) || isNaN(deletedLines)) continue;

    entries.push({ path, addedLines, deletedLines });
  }

  return entries;
}

// ============================================================
// v1.0.8: isomorphic-git fallback
// 当系统 git 不可用时，使用 isomorphic-git shadow repo 生成 diff
// ============================================================

/**
 * 使用 isomorphic-git shadow repo 生成 diff（无需系统 git）
 *
 * 适用于 CI 环境中没有安装 git 或 git 版本过旧的场景。
 * 依赖 isomorphic-git npm 包（纯 JS 实现，无原生依赖）。
 *
 * @param dir 项目根目录
 * @returns DiffFile 数组
 */
export async function parseDiffWithIsomorphicGit(dir: string): Promise<DiffFile[]> {
  try {
    const { generateDiff } = await import('./filesystem/isomorphic-git');
    const isoDiffs = generateDiff(dir);

    return isoDiffs.map((d) => ({
      path: d.path,
      status: d.status,
      lines: generateLineDiff(d.oldContent, d.newContent),
    }));
  } catch (err) {
    console.error('[diff-parser] isomorphic-git fallback 失败:', (err as Error).message);
    return [];
  }
}

/**
 * 生成类 unified diff 行（用于兼容现有规则引擎）
 */
function generateLineDiff(oldContent: string | null, newContent: string | null): string[] {
  const lines: string[] = [];

  if (oldContent === null && newContent !== null) {
    // 新增文件
    lines.push(`+++ b/file`);
    for (const line of newContent.split('\n')) {
      lines.push(`+${line}`);
    }
  } else if (newContent === null && oldContent !== null) {
    // 删除文件
    lines.push(`--- a/file`);
    for (const line of oldContent.split('\n')) {
      lines.push(`-${line}`);
    }
  } else if (oldContent !== null && newContent !== null) {
    // 修改文件
    lines.push(`--- a/file`);
    lines.push(`+++ b/file`);
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      if (oldLine === undefined && newLine !== undefined) {
        lines.push(`+${newLine}`);
      } else if (newLine === undefined && oldLine !== undefined) {
        lines.push(`-${oldLine}`);
      } else if (oldLine !== newLine) {
        lines.push(`-${oldLine}`);
        lines.push(`+${newLine}`);
      }
    }
  }

  return lines;
}
