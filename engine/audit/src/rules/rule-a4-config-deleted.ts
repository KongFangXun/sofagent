// ============================================================
// A4 不删配置（追溯层 · 能力拐杖）
// 检测关键配置/lock 文件被删除（diff status = 'deleted'）
// evidenceMode: git-diff
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleCheck } from './types';

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

export function checkRuleA4(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A4 不删配置',
    number: 4,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '能力拐杖',
  };

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
    rule.status = 'WARN';
    rule.details.push(
      `检测到配置/lock 文件被删除: ${deletedConfigs.join(', ')}。配置文件删除可能影响项目构建和部署。`
    );
  }

  return rule;
}
