#!/usr/bin/env node
// ============================================================
// cli-quick.ts · npx sofagent-audit 零配置 CLI 入口
// v1.4.2 (⑧-1)：30 秒 aha moment——任何 git repo 都能跑
//
// 依赖说明（v1.4.2 P0-R13）：
//   本文件 import @sofagent/core（见 package.json dependencies）。
//   git clone 后直接跑 dist/cli-quick.js 会报 MODULE_NOT_FOUND——
//   需先 `npm install`（根目录安装会 link workspace 依赖）或
//   `npm install -g @sofagent/audit` 全局安装后再用 npx sofagent-audit。
//   构建产物 dist/ 会被 npm run build 覆盖，勿直接改 dist 文件。
//
// 用法：
//   npx -y -p @sofagent/audit sofagent-audit               # 审计最近一次 commit（官方入口）
//   npx -y -p @sofagent/audit sofagent-audit HEAD~3..HEAD  # 审计指定范围
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
 * v1.3.8 P1-B5：非零退出时 git 的 raw stderr（如 fatal: Needed a single revision）
 * 不再透传到用户终端——execFileSync 默认把 stderr 印到父进程 stderr，此处
 * stdio 全 pipe 后静默失败，由调用方输出产品化提示。
 *
 * @returns commit 短 SHA，或 null（非 git 仓库 / 无 commit）
 */
function getLatestCommitSha(): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return sha;
  } catch {
    // 非 git 仓库取不到 HEAD SHA——降级 null，输出省略该字段
    return null;
  }
}

/**
 * v1.3.8 P1-B1：检测 HEAD 是否存在父提交（HEAD~1 可解析）。
 * 首个 commit 场景：commitSha 有值但 HEAD~1 不存在 → parseDiff 返回空，
 * 此前被误报为「审计最近一次 commit + 无文件变更」（与 parseDiff 打印的
 * 「首次提交，无需审计」互相矛盾）。此探测用于区分「无基线」与「真无变更」。
 */
function hasParentCommit(): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD~1'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    // 首次提交（无 HEAD~1）或非 git 仓库——按「无父提交」处理
    return false;
  }
}

/**
 * v1.3.8 P1-B2：获取最近一次 commit 的完整 message（供 A9 注入检测）。
 * quick 模式此前 runRules 第 6 参 commitMsg=undefined——A9 无输入假绿。
 * 失败时返回 null（不打 raw git stderr，同 P1-B5 原则）。
 */
function getLatestCommitMsg(): string | null {
  try {
    const msg = execFileSync('git', ['log', '-1', '--pretty=%B'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return msg.trim() || null;
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
 * v1.3.5 #6（补漏）：1728da6d 在函数体引入 isRangeMode/range 但漏改签名，
 *   generateQuickOutput 直接 ReferenceError（3 个 cli-quick 测试红）——此处补上参数。
 *
 * @param result 审计结果
 * @param commitSha 最近一次 commit 的短 SHA（null = 无法获取）
 * @param diffRange diff 范围（v1.3.5 #6：非默认范围时标题/回声按 range 呈现）
 * @returns 完整输出字符串
 */
export function generateQuickOutput(
  result: AuditResult,
  commitSha: string | null,
  diffRange: string = 'HEAD~1..HEAD'
): string {
  const parts: string[] = [];
  const isRangeMode = diffRange !== 'HEAD~1..HEAD';
  const range = diffRange;

  // 标题行
  if (commitSha && isRangeMode) {
    // v1.3.5 #6: range 模式标题与实际审计范围一致，不再误称「最近一次 commit」
    parts.push(`🔍 审计指定范围（${diffRange}）`);
  } else if (commitSha) {
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
    parts.push(`✅ 全部 ${passCount} 条规则通过（默认 17 条 · 完整 24 条含扩展，扩展规则经 config 启用，规则集用 --ruleset 加载）${skipCount > 0 ? `（${skipCount} 条跳过）` : ''}`);
    // v1.3.5 #7: 跳过计数解释——让用户知道「跳过」是 quick 模式缺输入而非漏检
    if (skipCount > 0) {
      parts.push(`ⓘ 跳过 = 需任务描述/Agent 日志输入的规则（quick 模式无此输入）——\`--init\` 装 hook 走完整引擎`);
    }
    // v1.3.4 P1-8: 显著回声行——用户用了三周可能不知道 sofagent 在工作，此行解决可感知性
    if (commitSha && !isRangeMode) {
      parts.push(`✓ [sofagent] ${passCount} 条规则全通过（commit ${commitSha}）`);
    } else if (commitSha && isRangeMode) {
      parts.push(`✓ [sofagent] ${passCount} 条规则全通过（range ${range}）`);
    }
  } else {
    const summaryParts: string[] = [];
    if (violationCount > 0) summaryParts.push(`${violationCount} 条违规`);
    if (warnCount > 0) summaryParts.push(`${warnCount} 条警告`);
    if (passCount > 0) summaryParts.push(`${passCount} 条通过`);
    if (skipCount > 0) summaryParts.push(`${skipCount} 条跳过`);
    parts.push(`📊 ${summaryParts.join(' · ')}`);
    // v1.3.5 #7: 跳过计数解释（同上，非 PASS 分支也需要）
    if (skipCount > 0) {
      parts.push(`ⓘ 跳过 = 需任务描述/Agent 日志输入的规则（quick 模式无此输入）——\`--init\` 装 hook 走完整引擎`);
    }
  }

  // v1.3.8 P1-B2: 扩展规则默认关闭披露——此前只写「完整 24 条含扩展」但未明示
  // 扩展规则默认关闭，用户误以为 quick 已经全跑；显式披露规则覆盖面。
  // 措辞注意：首个「N 条」数字须为 17 或 24（check-version 维度 13 逐行取首个数字对账 SSOT）
  parts.push('ⓘ 默认只跑 17 条规则（扩展规则默认关闭，config 启用）——规则集用 --ruleset 加载');

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
        // v1.3.5 #12: 补 monorepo 路径——clone 本仓库直接跑 dist 的用户遇到的是
        //   MODULE_NOT_FOUND（见本文件头部依赖说明），需要本地装依赖+构建而非全局装包
        console.log('   或本仓库内：npm install && npm run build，然后用 sofagent-audit-full ' + arg);
        return 1;
      }
    }
  }

  // 拦截 --help / --version
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('sofagent-audit — AI Agent 行为审计\n');
    console.log('用法（quick 只读审计，零安装）：');
    console.log('  npx -y -p @sofagent/audit sofagent-audit              审计最近一次 commit（官方入口，始终最新）');
    console.log('  npx -y -p @sofagent/audit sofagent-audit HEAD~3..HEAD   审计指定范围（路由到完整引擎）');
    console.log('  npx -y -p @sofagent/audit sofagent-audit -v, --version 显示版本号');
    console.log('  npx -y -p @sofagent/audit sofagent-audit -h, --help    显示此帮助\n');
    // v1.3.9 四十四：双模式边界一次性讲清——此前用户敲 --init/--doctor 撞二次安装门槛
    // 却无处查边界，这里显式并列 quick flag 集 vs 完整引擎 flag 集 + 升级命令。
    console.log('双模式边界：');
    console.log('  quick 模式（本入口，零安装只读审计）仅支持：[diff 范围参数] + -h/--help + -v/--version；');
    console.log('  完整引擎（--init/--doctor/--diff/--cached/--ruleset/--task/--commit-msg 等）需 --init 装 hook 或全局安装；');
    console.log('  从 quick 升级到完整：npm install -g @sofagent/audit（或 npx -y -p @sofagent/audit sofagent-audit-full）\n');
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

  // 3. 取 commit SHA（v1.3.8 P1-B5：失败时已静默 raw stderr，此处输出产品化提示）
  const commitSha = getLatestCommitSha();

  // v1.3.4 P2-15: SHA 为 null 时输出显著警告（而非静默用 'unknown' 填充）
  // v1.3.8 P1-B5: 提示语产品化——不透传 git 原始报错（fatal: Needed a single revision）
  if (commitSha === null) {
    console.log('⚠️ [sofagent] 无法获取 commit SHA（仓库可能尚无提交记录），审计记录将不含 commit 关联。');
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
    // v1.3.8 P1-B1：首次 commit 输出矛盾修复——此前三行并存：
    //   ①「首次提交，无需审计」（parseDiff 内打印）②「审计最近一次 commit（SHA）」
    //   ③「无文件变更」——「无需审计」与「正在审计」互相打架。
    // 规则：无 SHA 或无父提交（= 无 diff 基线）时明说「首个 commit 无基线不审计」；
    //   有基线但 diff 为空才称「无文件变更」。
    const hasBaseline = commitSha !== null && hasParentCommit();
    if (diffRange !== 'HEAD~1..HEAD') {
      console.log(`🔍 审计指定范围（${diffRange}）`);
      console.log('');
      console.log('✅ 无文件变更——没有需要审计的内容。');
    } else if (!hasBaseline) {
      console.log('ℹ️ [sofagent] 首个 commit 无基线不审计——没有前一个版本可对比，下次提交起自动生效。');
    } else {
      console.log(`🔍 审计最近一次 commit（${commitSha}）`);
      console.log('');
      console.log('✅ 无文件变更——没有需要审计的内容。');
    }
    return 0;
  }

  // 6. 运行审计规则（quick 模式：silent=true，零日志依赖）
  // v1.3.3 #8: quickMode=true 标记——A3（不改越界）见到跳过：quick 模式无真实任务描述，
  // task='quick-audit' 与任何文件都不匹配，必然 100% 误报越界 WARN。
  // v1.3.8 P1-B2: 传入真实 commitMsg（git log -1 取）——此前第 6 参恒 undefined，
  // A9（prompt 注入检测）在 quick 模式无输入假绿；commitMsg 取不到时 A9 由引擎按
  // 无输入处理（输出标「跳过」），不再假绿。
  // v1.3.8 P1-B4: 改用对象参数签名（十位置参数四布尔陷阱重构）。
  const commitMsg = getLatestCommitMsg() ?? undefined;
  const result = runRules({
    diffFiles,
    logEntries: [],
    task: 'quick-audit',
    silent: true,
    commitMsg,
    quickMode: true,
  });

  // 7. 格式化输出（v1.3.5 #6: 传入 diffRange 供 range 模式标题感知）
  const output = generateQuickOutput(result, commitSha, diffRange);
  console.log(output);

  // 8. 返回退出码
  return result.exitCode;
}

// 直接运行（非 require）
if (require.main === module) {
  const exitCode = runCliQuick(process.argv);
  process.exit(exitCode);
}
