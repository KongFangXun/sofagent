// ============================================================
// diff-parser.ts · git diff 解析器
// ============================================================

import { execFileSync } from 'child_process';

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  lines: string[];
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

/**
 * 判断当前工作目录是否在 git 仓库内
 */
export function isInGitRepo(): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'], // 静默 stderr
    });
    return true;
  } catch {
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
export function parseDiff(range: string): DiffFile[] {
  const files: DiffFile[] = [];

  // 参数格式校验：range 只允许 [a-zA-Z0-9~^.\-] 字符，防止命令注入和 git flag 注入
  if (!/^[a-zA-Z0-9~^.\-]+$/.test(range)) {
    console.error(
      `参数校验失败: range "${range}" 包含非法字符。只允许 [a-zA-Z0-9~^.-] 字符。`
    );
    return files;
  }

  // 非 git 仓库检测——给用户明确的错误提示
  if (!isInGitRepo()) {
    console.error('错误：当前目录不在 git 仓库内。sofagent-audit 需要 git 仓库才能运行。');
    return files;
  }

  try {
    // 检测首次提交——HEAD 或 HEAD~1 在全新仓库首次 commit 时不存在
    // pre-commit hook 传 --diff HEAD，命令行传 --diff HEAD~1..HEAD，两种都要覆盖
    if (range.includes('HEAD')) {
      const refToVerify = range.includes('HEAD~1') ? 'HEAD~1' : 'HEAD';
      try {
        execFileSync('git', ['rev-parse', '--verify', refToVerify], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        console.log('首次提交，无需审计（没有前一个版本可对比）。审计引擎已就绪，下次提交生效。');
        return files;
      }
    }

    // 获取变更文件列表——execFileSync 不 spawn shell，参数作为数组传递，避免命令注入
    // v1.0.5: 加 --find-renames 避免重命名+修改文件漏检
    const output = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--find-renames', '--name-status', range], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
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
        let diffLines: string[] = [];
        try {
          const diffContent = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', range, '--', path], {
            encoding: 'utf-8',
            maxBuffer: 5 * 1024 * 1024,
          });
          diffLines = diffContent.split('\n');
        } catch {
          // 文件可能无法读取差异
        }

        files.push({ path, status, oldPath, lines: diffLines });
      }
    }
  } catch (err) {
    // git diff 失败——非 git 仓库或无提交记录
    console.error('无法执行 git diff:', (err as Error).message);
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
        let diffLines: string[] = [];
        try {
          const diffContent = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--cached', '--', path], {
            encoding: 'utf-8',
            maxBuffer: 5 * 1024 * 1024,
          });
          diffLines = diffContent.split('\n');
        } catch {
          // 文件可能无法读取差异
        }

        files.push({ path, status, oldPath, lines: diffLines });
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
