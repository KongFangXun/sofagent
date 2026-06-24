// ============================================================
// diff-parser.ts · git diff 解析器
// ============================================================

import { execSync } from 'child_process';

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

  try {
    // 获取变更文件列表
    const output = execSync(`git diff --name-status ${range}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.split('\t');
      const statusCode = parts[0];

      let status: DiffFile['status'] = 'modified';
      let path: string;
      let oldPath: string | undefined;

      if (statusCode.startsWith('R')) {
        // 重命名: R100 old.ts\tnew.ts
        status = 'renamed';
        oldPath = parts[1];
        path = parts[2];
      } else if (statusCode === 'A') {
        status = 'added';
        path = parts[1];
      } else if (statusCode === 'D') {
        status = 'deleted';
        path = parts[1];
      } else {
        // M = modified
        path = parts[1];
      }

      if (path) {
        // 读取具体 diff 内容
        let diffLines: string[] = [];
        try {
          const diffContent = execSync(`git diff ${range} -- "${path}"`, {
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
