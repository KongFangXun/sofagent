// ============================================================
// A8 不逃验证（过程层 · 能力拐杖）
// package.json / build.gradle 等构建文件变更后是否有 test/build 命令记录
// 违规 → exit code 2
// v0.94：新增 --silent 双路径——无日志 + silent 走 diff 启发式，只 WARN 不 FAIL
// ============================================================

import { hasTestOrBuildExecution } from '../log-checker';
import type { AuditContext, RuleCheck } from './types';

const BUILD_FILES = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'build.gradle', 'build.gradle.kts', 'Cargo.toml', 'Cargo.lock', 'requirements.txt', 'Pipfile', 'pyproject.toml', 'go.mod', 'go.sum', 'Gemfile', 'composer.json', 'Dockerfile', 'docker-compose.yml', 'Makefile', '.env.example', 'tsconfig.json', 'next.config.js', 'vite.config.ts'];

export function checkRuleA8(ctx: AuditContext): RuleCheck {
  const { diffFiles, logEntries } = ctx;
  const rule: RuleCheck = {
    name: 'A8 不逃验证',
    number: 8,
    status: 'PASS',
    details: [],
    evidenceMode: 'hybrid',
    ruleClass: '能力拐杖',
  };

  // 检查是否有构建/依赖文件变更
  const buildFileChanges = diffFiles.filter((f) => {
    const name = f.path.split('/').pop() || f.path;
    return BUILD_FILES.includes(name);
  });

  if (buildFileChanges.length === 0) {
    // 没有构建文件变更，不需要检查
    return rule;
  }

  // 无日志 + silent → 只 WARN 不 FAIL
  if (ctx.silent && logEntries.length === 0) {
    rule.status = 'WARN';
    rule.details.push(`--silent 模式：构建文件变更 (${buildFileChanges.map((f) => f.path).join(', ')}) 后无日志，无法验证是否执行测试/构建。`);
    return rule;
  }

  // 有构建文件变更，检查是否有 test/build 执行记录
  if (logEntries.length === 0) {
    rule.status = 'WARN';
    rule.details.push(`构建文件变更 (${buildFileChanges.map((f) => f.path).join(', ')}) 后无测试/构建执行记录（未找到任务日志）。`);
    return rule;
  }

  if (hasTestOrBuildExecution(logEntries)) {
    rule.status = 'PASS';
  } else {
    rule.status = 'FAIL';
    rule.details.push(`构建文件变更 (${buildFileChanges.map((f) => f.path).join(', ')}) 后无测试/构建命令执行记录。`);
  }

  return rule;
}
