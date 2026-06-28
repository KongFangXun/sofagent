import type { AuditContext } from './rules/types';
import type { DiffFile } from './diff-parser';

export function makeDiffFile(
  path: string,
  lines: string[] = [],
  status: DiffFile['status'] = 'modified',
): DiffFile {
  return { path, status, lines };
}

export function makeCtx(
  diffFiles: DiffFile[],
  overrides: Partial<Omit<AuditContext, 'diffFiles'>> = {},
): AuditContext {
  return { diffFiles, logEntries: [], ...overrides };
}
