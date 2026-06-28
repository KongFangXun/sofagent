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

  try {
    // 获取变更文件列表——execFileSync 不 spawn shell，参数作为数组传递，避免命令注入
    const output = execFileSync('git', ['diff', '--name-status', range], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = output.trim().split('\n').filter(Boolean);

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
          const diffContent = execFileSync('git', ['diff', range, '--', path], {
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
