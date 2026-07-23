// ============================================================
// E1 不落测试（扩展层 · 能力拐杖）
// src/ 下源码文件变了但 *.test.ts/*.spec.js 没动 → WARN
// evidenceMode: git-diff（纯 diff 判定，不依赖日志）
// ============================================================

import type { AuditContext, RuleCheck } from './types';

/** 源码文件扩展名 → 对应测试文件后缀 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.test.js', '.test.jsx', '.spec.ts', '.spec.tsx', '.spec.js', '.spec.jsx'];

export function checkRuleE1(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'E1 不落测试',
    number: 201,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '能力拐杖',
  };

  const { diffFiles } = ctx;

  // 筛选 src/ 下的源码文件（非测试文件）
  const srcSourceFiles = diffFiles.filter((f) => {
    if (!f.path.startsWith('src/')) return false;
    const hasSourceExt = SOURCE_EXTENSIONS.some((ext) => f.path.endsWith(ext));
    if (!hasSourceExt) return false;
    // 排除测试文件本身
    return !TEST_SUFFIXES.some((suffix) => f.path.endsWith(suffix));
  });

  // 无 src/ 变更时跳过
  if (srcSourceFiles.length === 0) {
    return rule;
  }

  // 检查是否有测试文件变更
  const hasTestFiles = diffFiles.some((f) =>
    TEST_SUFFIXES.some((suffix) => f.path.endsWith(suffix))
  );

  if (!hasTestFiles) {
    rule.status = 'WARN';
    rule.details.push(
      `src/ 下 ${srcSourceFiles.length} 个源码文件变更，但无测试文件 (*.test.ts/*.spec.js) 变更: ${srcSourceFiles.slice(0, 3).map((f) => f.path).join(', ')}${srcSourceFiles.length > 3 ? ` 等` : ''}`
    );
  }

  return rule;
}
