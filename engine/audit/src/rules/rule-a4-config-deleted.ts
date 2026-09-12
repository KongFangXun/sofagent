// ============================================================
// A4 不删配置（追溯层 · 能力拐杖）
// 检测关键配置/lock 文件被删除（diff status = 'deleted'）
// evidenceMode: git-diff
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleScan, RuleStatus } from './types';

/** 精确匹配的关键配置文件 */
const EXACT_CONFIG_FILES = new Set([
  '.gitignore',
  'tsconfig.json',
  'Dockerfile',
  'Makefile',
  'deploy.yml',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.env.example',
]);

export function scanA4(ctx: AuditContext): RuleScan {
  let status: RuleStatus = 'PASS';
  const details: string[] = [];

  const { diffFiles } = ctx;

  const deletedConfigs: string[] = [];

  for (const file of diffFiles) {
    // 只检测被删除的文件
    if (file.status !== 'deleted') continue;

    const name = basename(file.path);

    // 精确匹配
    if (EXACT_CONFIG_FILES.has(name)) {
      deletedConfigs.push(file.path);
      continue;
    }

    // 后缀匹配：*.lock
    if (name.endsWith('.lock')) {
      deletedConfigs.push(file.path);
      continue;
    }
  }

  if (deletedConfigs.length > 0) {
    status = 'WARN';
    details.push(
      `检测到配置/lock 文件被删除: ${deletedConfigs.join(', ')}。配置文件删除可能影响项目构建和部署。`
    );
  }

  return { status, details };
}
