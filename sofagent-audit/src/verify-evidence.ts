// ============================================================
// verify-evidence.ts · 最小可信验证器 · v0.92
// ============================================================
// 扫描 .sofagent/task/logs/ 下今日记录，检查有无客观证据
// （测试 exit code / lint 结果），有标 [已验证]，无标 [未验证]。
//
// 用法：npx ts-node src/verify-evidence.ts [--daemon] [file-path]
//       --daemon  静默模式，仅返回 exit code（0=已验证, 1=未验证/无日志）
// ============================================================

import { readFileSync, existsSync } from 'fs';

const VERSION = '0.92';

/** 测试相关证据关键词 */
const TEST_PATTERN = /exit\.code|测试.*(pass|fail|通过|失败)|test.*(pass|fail)|✅.*pass|❌.*fail/i;

/** lint 相关证据关键词 */
const LINT_PATTERN = /lint|eslint|prettier|shellcheck/i;

/** build 相关证据关键词 */
const BUILD_PATTERN = /build.*(success|fail)|编译.*(成功|失败)|npm run build|make/i;

/**
 * 扫描日志文件中的客观证据（测试/lint/build 关键词）。
 * @param filePath - 日志文件路径，默认 `${cwd}/.sofagent/task/logs/${YYYY-MM}/${YYYY-MM-DD}.md`
 * @param daemonMode - 静默模式，不输出 console
 * @returns 0 = 已验证（有证据），1 = 未验证（无证据或无日志）
 */
export function verifyEvidence(filePath?: string, daemonMode: boolean = false): number {
  const resolvedPath = filePath ?? getDefaultLogPath();

  if (!daemonMode) {
    console.log(`sofagent verify-evidence v${VERSION}`);
    console.log(`扫描目标: ${resolvedPath}`);
    console.log('');
  }

  if (!existsSync(resolvedPath)) {
    if (!daemonMode) {
      console.log('❌ 今日无 task/logs 记录');
    }
    return 1;
  }

  let content: string;
  try {
    content = readFileSync(resolvedPath, 'utf-8');
  } catch {
    if (!daemonMode) {
      console.log('❌ 无法读取日志文件');
    }
    return 1;
  }

  // 检查客观证据关键词
  const hasTest = countMatches(content, TEST_PATTERN);
  const hasLint = countMatches(content, LINT_PATTERN);
  const hasBuild = countMatches(content, BUILD_PATTERN);
  const total = hasTest + hasLint + hasBuild;

  if (total > 0) {
    if (!daemonMode) {
      console.log(`[已验证] 检测到客观证据：测试 ${hasTest} 处 / lint ${hasLint} 处 / build ${hasBuild} 处`);
      console.log('→ 本轮闭环评分有客观证据支撑');
    }
    return 0;
  } else {
    if (!daemonMode) {
      console.log('[未验证] 未检测到测试 / lint / build 等客观证据');
      console.log('→ 本轮闭环评分依赖 LLM 自评，可信度有限');
    }
    return 1;
  }
}

/**
 * 统计内容中正则匹配的次数（非重叠匹配）。
 */
function countMatches(content: string, pattern: RegExp): number {
  // 重置 lastIndex，避免全局正则的状态问题
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    count++;
  }
  return count;
}

/**
 * 生成默认日志文件路径。
 */
function getDefaultLogPath(): string {
  const now = new Date();
  const today = formatDate(now);
  const month = today.slice(0, 7); // YYYY-MM
  return `${process.cwd()}/.sofagent/task/logs/${month}/${today}.md`;
}

/**
 * 格式化日期为 YYYY-MM-DD。
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * CLI 入口函数，处理 process.argv。
 */
export function main(): void {
  const args = process.argv.slice(2);
  let daemonMode = false;
  let filePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--daemon') {
      daemonMode = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`sofagent verify-evidence v${VERSION} · 最小可信验证器`);
      console.log('');
      console.log('用法: npx ts-node src/verify-evidence.ts [--daemon] [file-path]');
      console.log('  --daemon  静默模式，仅返回 exit code（0=已验证, 1=未验证/无日志）');
      console.log('  file-path 日志文件路径（默认 .sofagent/task/logs/<月>/<日>.md）');
      process.exit(0);
    } else if (args[i] === '--version') {
      console.log(`sofagent verify-evidence v${VERSION}`);
      process.exit(0);
    } else {
      filePath = args[i];
    }
  }

  const exitCode = verifyEvidence(filePath, daemonMode);
  process.exit(exitCode);
}

// 直接运行时执行 CLI
if (require.main === module) {
  main();
}
