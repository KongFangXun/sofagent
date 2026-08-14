#!/usr/bin/env node
// ============================================================
// cli-quick.ts · npx sofagent-audit 零配置 CLI 入口
// v1.3.4 (⑧-1)：30 秒 aha moment——任何 git repo 都能跑
//
// 依赖说明（v1.3.4 P0-R13）：
//   本文件 import @sofagent/core（见 package.json dependencies）。
//   git clone 后直接跑 dist/cli-quick.js 会报 MODULE_NOT_FOUND——
//   需先 `npm install`（根目录安装会 link workspace 依赖）或
//   `npm install -g @sofagent/audit` 全局安装后再用 npx sofagent-audit。
//   构建产物 dist/ 会被 npm run build 覆盖，勿直接改 dist 文件。
//
// 用法：
//   npx sofagent-audit              # 审计最近一次 commit
//   npx sofagent-audit HEAD~3..HEAD # 审计指定范围
//
// 设计约束：
//   - 零配置——不读 .sofagent/，不依赖 SKILL 加载链
//   - 自动检测——有 .git 就跑，没有就提示
//   - 零 token——纯本地规则扫描，不调 LLM
//   - 3 秒内输出——规则扫描本身是毫秒级
//
// 退出码：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规
//   3 = 非 git 仓库
// ============================================================

import { execFileSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseDiff, isInGitRepo, type DiffFile } from '@sofagent/core';
import { runRules, type AuditResult, type RuleCheck } from './reporter';

/**
 * 获取最近一次 commit 的短 SHA
 *
 * v1.3.4 P2-15：git rev-parse 失败时返回 null（而非 'unknown'），
 * 调用方在 SHA 为 null 时输出显著警告——避免 'unknown' 悄悄进审计记录导致后续对账 mismatch。
 *
 * @returns commit 短 SHA，或 null（非 git 仓库 / 无 commit）
 */
function getLatestCommitSha(): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf-8',
    }).trim();
    return sha;
  } catch {
    return null;
  }
}

/**
 * 格式化单条审计结果为 emoji 输出行
 *
 * @param rule 单条规则检查结果
 * @returns 格式化后的输出行数组
 */
export function formatQuickResult(rule: RuleCheck): string[] {
  const lines: string[] = [];
  const icon =
    rule.status === 'FAIL' ? '❌' :
    rule.status === 'WARN' ? '⚠️ ' :
    rule.status === 'SKIPPED' ? '⏭️ ' :
    '✅';

  if (rule.status === 'PASS' || rule.status === 'SKIPPED') {
    // PASS / SKIPPED 不逐条输出，汇总即可
    return lines;
  }

  // FAIL / WARN 逐条输出详情
  if (rule.details.length === 0) {
    lines.push(`${icon} ${rule.name}`);
  } else {
    for (const detail of rule.details) {
      lines.push(`${icon} ${rule.name}：${detail}`);
    }
  }

  return lines;
}

/**
 * 生成完整的 quick 模式输出
 *
 * v1.3.4 P1-8：PASS 时输出汇总回声（让用户感知到 sofagent 在工作，而非只感受 FAIL）。
 * v1.3.4 P2-15：commitSha 为 null 时输出显著警告（非 git 仓库）。
 *
 * @param result 审计结果
 * @param commitSha 最近一次 commit 的短 SHA（null = 无法获取）
 * @returns 完整输出字符串
 */
export function generateQuickOutput(
  result: AuditResult,
  commitSha: string | null
): string {
  const parts: string[] = [];

  // 标题行
  if (commitSha) {
    parts.push(`🔍 审计最近一次 commit（${commitSha}）`);
  } else {
    // v1.3.4 P2-15: SHA 为 null 时输出显著警告
    parts.push(`🔍 审计最近一次 commit（⚠️ 无法获取 commit SHA）`);
  }
  parts.push('');

  // 违规 / 警告详情
  let violationCount = 0;
  let warnCount = 0;
  let passCount = 0;
  let skipCount = 0;

  for (const rule of result.rules) {
    if (rule.status === 'FAIL') violationCount++;
    else if (rule.status === 'WARN') warnCount++;
    else if (rule.status === 'PASS') passCount++;
    else if (rule.status === 'SKIPPED') skipCount++;

    const ruleLines = formatQuickResult(rule);
    parts.push(...ruleLines);
  }

  // 汇总行
  parts.push('');
  if (violationCount === 0 && warnCount === 0) {
    // v1.3.4 P1-8: PASS 时输出可感知回声——让用户明确知道「sofagent 在工作且通过了」
    // v1.3.2 P2-17: 解释 17 条默认 vs 24 条总量，消除「少装了什么」的认知落差
    parts.push(`✅ 全部 ${passCount} 条规则通过（默认规则 · 共 24 条，扩展规则用 --ruleset 加载）${skipCount > 0 ? `（${skipCount} 条跳过）` : ''}`);
    // v1.3.4 P1-8: 显著回声行——用户用了三周可能不知道 sofagent 在工作，此行解决可感知性
    if (commitSha) {
      parts.push(`✓ [sofagent] ${passCount} 条规则全通过（commit ${commitSha}）`);
    }
  } else {
    const summaryParts: string[] = [];
    if (violationCount > 0) summaryParts.push(`${violationCount} 条违规`);
    if (warnCount > 0) summaryParts.push(`${warnCount} 条警告`);
    if (passCount > 0) summaryParts.push(`${passCount} 条通过`);
    if (skipCount > 0) summaryParts.push(`${skipCount} 条跳过`);
    parts.push(`📊 ${summaryParts.join(' · ')}`);
  }

  // 产品签名
  parts.push('');
  parts.push('— sofagent 审计 · 零 token 纯 git diff 扫描');

  return parts.join('\n');
}

/**
 * cli-quick 主入口
 *
 * @param argv 命令行参数（process.argv）
 * @returns 退出码
 */
export function runCliQuick(argv: string[]): number {
  // F-13 (v1.3.0 bugfix)：拦截需要完整引擎的参数，路由到 dist/index.js（spawn 方式）
  // ⚠️ 清单已按 engine/audit/src/index.ts 实测校准（2026-08-09）：
  //    - 删除 '--repair'（完整版不存在该 flag）
  //    - 删除 '--verify'（不是 flag；verify 子命令是弃用 shim，走子命令路径即可）
  //    - 新增 '--verify-commit'（v1.2.9 新增 flag，需要完整引擎，否则会被 quick 吞掉）
  const FULL_ONLY_FLAGS = ['--init', '--doctor', '--install-hook',
    '--list-rulesets', '--ruleset', '--ruleset-path',
    '--support-bundle', '--sign-config', '--verify-chain', '--verify-commit',
    // v1.3.1 #1: 以下参数需要完整引擎——quick 模式不审计暂存区/commit-msg，
    // 会静默吞掉这些参数导致 hook 审计滞后。
    '--diff', '--cached', '--silent', '--ci', '--task', '--commit-msg'];

  for (const arg of argv.slice(2)) {
    if (FULL_ONLY_FLAGS.includes(arg)) {
      // 路由到完整引擎（dist/index.js）
      const indexPath = join(__dirname, 'index.js');
      try {
        const result = spawnSync(process.execPath, [indexPath, ...argv.slice(2)], {
          stdio: 'inherit',
          cwd: process.cwd(),
        });
        return result.status ?? 1;
      } catch {
        console.log('⚠️  此命令需要完整安装：');
        console.log('   npm install -g @sofagent/audit');
        console.log('   或使用 sofagent-audit-full ' + arg);
        return 1;
      }
    }
  }

  // 拦截 --help / --version
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('sofagent-audit — AI Agent 行为审计\n');
    console.log('用法（quick 只读审计，零安装）：');
    console.log('  npx sofagent-audit              审计最近一次 commit');
    console.log('  npx sofagent-audit HEAD~3..HEAD 审计指定范围（路由到完整引擎）');
    console.log('  npx sofagent-audit -v, --version 显示版本号');
    console.log('  npx sofagent-audit -h, --help    显示此帮助\n');
    console.log('以下 flag 需完整引擎（sofagent-audit-full 或全局安装），quick 模式会自动路由或提示安装：');
    console.log('  --init              安装 git hook（每次 commit 自动审计）');
    console.log('  --doctor            健康诊断 + 完整性校验');
    console.log('  --install-hook      仅安装 hook');
    console.log('  --diff <range>      审计指定 diff 范围（如 origin/main..HEAD）');
    console.log('  --cached            审计暂存区（pre-commit 场景）');
    console.log('  --ruleset <name>    加载规则集（sofagent / security / 社区包）');
    console.log('  --ruleset-path <p>  加载自定义 JSON 规则路径');
    console.log('  --list-rulesets     列出可用规则集');
    console.log('  --silent            静默模式');
    console.log('  --ci                CI 模式（输出适合 CI 解析）');
    console.log('  --strict            严格模式（无日志时 WARN 升级为 FAIL）');
    console.log('  --task <subject>    传入任务标题（A3 越界检查用）');
    console.log('  --commit-msg <msg>  传入完整 commit message（A9 注入检查用）');
    console.log('  --sign-config       对 config.yml 签名（防篡改）');
    console.log('  --verify-chain      校验审计历史 HMAC 链完整性');
    console.log('  --verify-commit     校验单个 commit 完整性（v1.2.9+）');
    console.log('  --support-bundle    打包诊断信息\n');
    console.log('完整安装：npm install -g @sofagent/audit');
    return 0;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../package.json');
    console.log(`sofagent-audit v${pkg.version}`);
    return 0;
  }

  // v1.3.1 #12: 未知 flag 检测——quick 模式支持的参数有限，
  // 不在此列表中的 `-` 开头参数会被静默忽略，用户误以为审计已覆盖。
  const QUICK_KNOWN_FLAGS = new Set([
    '--help', '-h', '--version', '-v',
  ]);
  const warnedFlags = new Set<string>();
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('-') && !FULL_ONLY_FLAGS.includes(arg) && !QUICK_KNOWN_FLAGS.has(arg)) {
      if (!warnedFlags.has(arg)) {
        console.warn(`⚠️  未知参数: ${arg}，请检查 --help`);
        warnedFlags.add(arg);
      }
    }
  }

  // 1. 检测 git 仓库
  const cwd = process.cwd();
  const isGitRepo = existsSync(join(cwd, '.git')) || isInGitRepo();

  if (!isGitRepo) {
    console.log('⚠️  当前目录不在 git 仓库内。');
    console.log('   npx sofagent-audit 需要在 git 仓库内运行。');
    console.log('   请 cd 到你的项目目录后重试。');
    return 3;
  }

  // 2. 确定 diff 范围（默认 HEAD~1..HEAD）
  const diffRange = argv[2] && !argv[2].startsWith('-') && argv[2] !== 'quick'
    ? argv[2]
    : 'HEAD~1..HEAD';

  // 3. 取 commit SHA
  const commitSha = getLatestCommitSha();

  // v1.3.4 P2-15: SHA 为 null 时输出显著警告（而非静默用 'unknown' 填充）
  if (commitSha === null) {
    console.log('⚠️ [sofagent] 无法获取 commit SHA（当前目录可能不是 git 仓库或无 commit），审计记录将不含 commit 关联。');
  }

  // 4. 解析 diff——parseDiff 接收 git refspec（如 HEAD~1..HEAD），内部执行 git diff
  let diffFiles: DiffFile[];
  try {
    diffFiles = parseDiff(diffRange);
  } catch {
    console.log('⚠️  diff 解析失败。');
    return 3;
  }

  if (diffFiles.length === 0) {
    const shaLabel = commitSha || '⚠️ 无 SHA';
    console.log(`🔍 审计最近一次 commit（${shaLabel}）`);
    console.log('');
    console.log('✅ 无文件变更——没有需要审计的内容。');
    return 0;
  }

  // 6. 运行审计规则（quick 模式：silent=true，零日志依赖）
  // v1.3.3 #8: quickMode=true 标记——A3（不改越界）见到跳过：quick 模式无真实任务描述，
  // task='quick-audit' 与任何文件都不匹配，必然 100% 误报越界 WARN。
  const result = runRules(diffFiles, [], 'quick-audit', false, true, undefined, undefined, undefined, false, true);

  // 7. 格式化输出
  const output = generateQuickOutput(result, commitSha);
  console.log(output);

  // 8. 返回退出码
  return result.exitCode;
}

// 直接运行（非 require）
if (require.main === module) {
  const exitCode = runCliQuick(process.argv);
  process.exit(exitCode);
}
