#!/usr/bin/env node
// ============================================================
// cli-quick.ts · npx sofagent-audit 零配置 CLI 入口
// v1.5.0 (⑧-1)：30 秒 aha moment——任何 git repo 都能跑
//
// 依赖说明（v1.5.0 P0-R13）：
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
// 退出码（v1.4.9 P1-15 补全口径——原「四态」表述漏记用法错误态，且崩溃态与
// 「非 git 仓库」**撞码 3**，实测两义并存）：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规
//       另一来源：承载安全语义的参数拼错（--ruleset* / --config / --task / --include
//       等，见下方 SEMANTIC_FLAG_PREFIXES 分支）＝ **用法错误**，与审计发现共用 2——
//       两者都属「必须中断」，故不分码（v1.4.6 finding-12 起）。
//   3 = 非 git 仓库（runCliQuick 的 `return 3`，见 `if (!isGitRepo)` 分支）
//   4 = 引擎崩溃（uncaughtException / unhandledRejection 兜底，见下方两处 process.exit）
// ============================================================

// v1.4.8 阶段七：与 index.ts 同源的崩溃兜底——引擎异常用专属退出码 4
// （区别 0=全绿/1=警告/2=违规/3=非 git 仓库），使 hook 的「非 0/1/2 ⇒ fail-loud 阻断」
// 分支能识别崩溃，避免 fail-open 静默放行。
// v1.4.9 P1-15：**3 → 4**。原用 3 与 cli-quick 自己的「非 git 仓库 ⇒ return 3」撞码
// （实测两义并存：非 git 目录跑出 3，SOFAGENT_HOME 越界崩溃也跑出 3），撞码使问题定位
// 需要靠 stderr 猜。独立为 4 后「崩溃」与「用错目录」可由退出码单义区分。
// ⚠️ 与 index.ts 顶部同名常量/处理块**手同步**（两文件本就各自独立注册）
// ——漂移由 `src/__tests__/cli-crash-exit-code.test.ts` 双侧行为锁兜住，不靠注释自律。
const EXIT_ENGINE_CRASH = 4;

// v1.4.3 F-08/§：quick 模式「跳过」的解释串——**单一常量，两个输出分支共用**。
// 缺陷（两层）：
//   ① 定性缺失——原串只说「跳过的是什么（归因类规则缺席）」，未答「为什么可接受」。
//      企业 IT 视角下「N 条跳过」读起来像「N 条没查」，缺一句「硬证据类已全量跑」的
//      定性，用户无法据此判断这次审计是否够用。
//   ② 漂移面 ×2——该串在 PASS 分支与非 PASS 分支**各写一份字面量**（改前 :224 / :242），
//      措辞改动必须两处同改，漏一处即形成「同一 CLI 两种解释」。
// v1.5.1 C8：措辞统一为「**本批未检查**」并显式声明「未检查 ≠ 通过」——
//   `docs/LIMITATIONS.md` 已主动披露「SKIPPED ≠ 通过」，但终端措辞强度不匹配；
//   「跳过」易被误读成「无问题」（fail-fast 命中后跳过的规则**本次未检查**）。
//   机器可读契约不动：JSON 的 `status: 'SKIPPED'` 一字未改。
// 修法：提取为本常量（漂移面归零）+ 补「git diff 硬证据类规则已全量执行，未检查项非漏检」。
// 保留 v1.4.3 F-08 的归因口径如实化与两条升级路径（--task / --init），本条不得覆盖它。
// ⚠️ 漂移由 `src/__tests__/cli-quick-skip-hint.test.ts` 的**双分支行为锁**兜住。
export const QUICK_SKIP_HINT =
  'ⓘ 本批未检查（未检查 ≠ 通过）= quick 模式不含归因分析（需任务描述/Agent 日志输入的规则）'
  + '；git diff 硬证据类规则已全量执行，未检查项非漏检'
  + '——用 --task 走完整引擎，或安装后运行 sofagent-audit；`--init` 装 hook 走完整引擎';

/** SKIPPED 的计数文案（v1.5.1 C8：不使用孤立的「跳过」二字） */
function skipCountLabel(count: number, failFast: boolean): string {
  return `⚠️ ${count} 条本批未检查${failFast ? '（critical 命中后 fail-fast）' : ''}`;
}

/** 是否存在 fail-fast 型未检查（details 由 rules/runner.ts 的 critical fast-fail 分支写入） */
function hasFailFastSkip(rules: AuditResult['rules']): boolean {
  return rules.some(
    (r) => r.status === 'SKIPPED' && r.details.some((d) => d.includes('critical 层')),
  );
}

process.on('uncaughtException', (err) => {
  console.error(`\u274c sofagent-audit(quick) 引擎异常退出: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(EXIT_ENGINE_CRASH);
});
process.on('unhandledRejection', (reason) => {
  console.error(`\u274c sofagent-audit(quick) 未处理的 Promise 拒绝: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exit(EXIT_ENGINE_CRASH);
});

import { execFileSync, spawnSync } from 'child_process';
import { FULL_ONLY_FLAGS as FULL_ONLY_FLAGS_SRC, AUDIT_SUBCOMMANDS as AUDIT_SUBCOMMANDS_SRC } from './cli/flag-table';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseDiff, isInGitRepo, type DiffFile } from '@sofagent/core';
import { runRules, type AuditResult, type RuleCheck } from './reporter';
import { resolveDiffEndpoint } from './diff-ref';

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
 * v1.5.1 F1：判定 diff 范围能否被 git 解析——区分「无效范围」与「合法但无变更」。
 *
 * 为什么不能整串丢给 `git rev-parse --verify`：`--verify` 只接受**单个 rev**，
 * 对 `HEAD~1..HEAD` 这类范围表达式必失败（实测 exit 1）——若照此判定，合法范围
 * 会被误判为无效。故范围形如 `A..B` / `A...B` 时**逐端点**验证。
 *
 * 切分口径：三点范围（`A...B`，git 的 merge-base 语义）先于二点范围切分，
 * 否则 `HEAD~3...HEAD` 会被切成 `['HEAD~3', '.HEAD']` 造成误判。
 * 空端点（如 `..HEAD`）不参与验证，交回原行为——本函数只封「无效范围」这一条路径。
 *
 * @param range git refspec（如 'HEAD~3..HEAD'、'origin/main..HEAD'、'nonsense-range'）
 * @returns true = 全部端点可解析（合法范围，含确实无变更的范围）
 */
function isResolvableDiffRange(range: string): boolean {
  const endpoints = (range.includes('...') ? range.split('...') : range.split('..')).filter(
    (part) => part.length > 0
  );
  // 无任何非空端点可验证 ⇒ 不新增拦截面，保持既有行为
  if (endpoints.length === 0) {
    return true;
  }
  return endpoints.every((rev) => {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', rev], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      // 不解析的 ref：git 报错已在 --quiet 下静默，由调用方输出产品化文案
      return false;
    }
  });
}

/**
 * 获取指定 ref 的完整 commit message（供 A9 注入检测）。
 * quick 模式此前 runRules 第 6 参 commitMsg=undefined——A9 无输入假绿。
 * 失败时返回 null（不打 raw git stderr，同 P1-B5 原则）。
 *
 * v1.4.4 D-1：加可选 ref 参数——range 模式下 A9 的输入必须取被审计
 * range 的终点（`git log -1 <ref>`），而非字面 HEAD。此前 `git log -1`
 * 写死 HEAD，range 审计 HEAD~3..HEAD 时 A9 被字面 HEAD 的 commitMsg
 * 污染（误报面），且被审计历史 commit 自带的注入 payload 完全漏检（漏报面）。
 * 复用 full 模式现成件 resolveDiffEndpoint()（diff-ref.ts），与 full 模式
 * commitMsg 语义对齐：含 `..` 取终点、普通 ref 原样、空回退 HEAD。
 *
 * @param ref 读取 commit message 的 git ref（默认 'HEAD'，语义与旧行为等价）
 * @returns commit message，或 null（ref 不可解析 / 非 git 仓库）
 */
function getLatestCommitMsg(ref: string = 'HEAD'): string | null {
  try {
    const msg = execFileSync('git', ['log', '-1', '--pretty=%B', ref], {
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
  // v1.5.1 C8：计数文案统一用「本批未检查」（不再用孤立的「跳过」二字）——
  // 与 docs/LIMITATIONS.md 的「SKIPPED ≠ 通过」口径强度对齐。fail-fast 限定词
  // 按实测数据决定（details 含 critical 层）——quick 模式亦可无 fail-fast 的未检查项。
  const failFast = hasFailFastSkip(result.rules);
  parts.push('');
  if (violationCount === 0 && warnCount === 0) {
    // v1.3.4 P1-8: PASS 时输出可感知回声——让用户明确知道「sofagent 在工作且通过了」
    // v1.3.2 P2-17: 解释 17 条默认 vs 24 条总量，消除「少装了什么」的认知落差
    // v1.5.1 M13①：补 `[sofagent]` 签名——改前本行无前缀、紧随其后的回声行有
    // `✓ [sofagent] …`，同一屏一行署名一行不署名。产品自称口径与下方回声行一致。
    parts.push(`✅ [sofagent] 全部 ${passCount} 条规则通过（默认 17 条 · 完整 24 条含扩展，扩展规则经 config 启用，规则集用 --ruleset 加载）${skipCount > 0 ? `（${skipCountLabel(skipCount, failFast)}）` : ''}`);
    // v1.3.5 #7: 跳过计数解释——让用户知道「跳过」是 quick 模式缺输入而非漏检
    // v1.4.3 F-08 (bugfix 批): 归因口径如实化——quick 模式不含归因分析（ATTRIBUTION
    // 引擎需任务描述/Agent 日志输入），原措辞「需任务描述输入的规则」未点破归因
    // 缺席，用户误以为 quick 也做归因。指向两条升级路径：--task 走完整引擎 / 全局安装。
    if (skipCount > 0) {
      parts.push(QUICK_SKIP_HINT);
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
    if (skipCount > 0) summaryParts.push(skipCountLabel(skipCount, failFast));
    parts.push(`📊 ${summaryParts.join(' · ')}`);
    // v1.3.5 #7: 跳过计数解释（同上，非 PASS 分支也需要）
    // v1.4.3 F-08: 同 PASS 分支——归因口径如实化
    if (skipCount > 0) {
      parts.push(QUICK_SKIP_HINT);
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
  // v1.4.8 深模块条目 8：flag/子命令单源——从 cli/flag-table.ts 派生
  // （历史 F-12/F-13 两次漂移均因两处手工同步；各成员的收录理由注释见 flag-table）
  const FULL_ONLY_FLAGS = [...FULL_ONLY_FLAGS_SRC];
  // v1.4.6 finding-12: 子命令同样需要完整引擎——此前只拦 flag 不拦子命令，
  // npx 主入口敲 `sofagent-audit agent-shield`（或 ontology/conflict-check/
  // federation-distill/corpus）时子命令落进下方位置参数 diffRange 分支，
  // parseDiff('agent-shield') 抛「diff 解析失败」→ 引擎崩溃 ⇒ 退出码 4
  // （v1.4.9 P1-15：此处原先写 exit 3，与上面「非 git 仓库 ⇒ 3」撞码，已改 4）。
  // 清单与 index.ts SUBCOMMANDS 保持对齐。
  const FULL_ONLY_SUBCOMMANDS = [...AUDIT_SUBCOMMANDS_SRC];

  for (const arg of argv.slice(2)) {
    if (FULL_ONLY_FLAGS.includes(arg) || FULL_ONLY_SUBCOMMANDS.includes(arg)) {
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

  // ── v1.5.1 第八章：`demo` 子命令分支（五分钟戏剧弧 · L4 卸包） ──
  // 挂点：本文件就是 sofagent-audit 的子命令入口（package.json bin →
  //   dist/cli-quick.js），demo 挂在这里 → **不新增 bin**（不碰「13 bin → 1」
  //   收敛叙事），且传播命令与试用命令同体（去掉 `demo` 参数就是真审计）。
  // 位置：放在 FULL_ONLY 路由之后、--help 之前——demo 自带 --help 文案，
  //   且 demo 不要求当前目录是 git 仓库（它在 /tmp 自建沙箱），
  //   故必须在下方 isGitRepo 检查之前拦截。
  // 惰性 require：demo.ts 静态依赖 rules/index（24 条规则模块）——
  //   顶层 import 会给既有零配置审计路径（npx sofagent-audit 的 30 秒 aha）
  //   凭空加上这份冷启动开销。既有路径**行为与开销零变化**，是本分支的硬约束。
  //
  // 为什么不用 flag-table 的 AUDIT_SUBCOMMANDS 登记：该表是「quick 侧见名
  //   转完整引擎」的路由清单（cli-quick.ts:319），demo 登记进去反而会被路由到
  //   不认识它的完整引擎（dist/index.js）。demo 是 quick 侧自己的分支。
  if (argv[2] === 'demo') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runDemoCli } = require('./cli/demo');
    return runDemoCli(argv) as number;
  }

  // 拦截 --help / --version
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('sofagent-audit — AI Agent 行为审计\n');
    console.log('用法（quick 只读审计，零安装）：');
    console.log('  npx -y -p @sofagent/audit sofagent-audit              审计最近一次 commit（官方入口，始终最新；不写 history.jsonl 无留痕，适合临时检查）');
    console.log('  npx -y -p @sofagent/audit sofagent-audit HEAD~3..HEAD   审计指定范围（quick 模式直接跑，规则覆盖面同 quick；不写 history.jsonl）');
    console.log('  npx -y -p @sofagent/audit sofagent-audit -v, --version 显示版本号');
    console.log('  npx -y -p @sofagent/audit sofagent-audit -h, --help    显示此帮助\n');
    console.log('  npx -y -p @sofagent/audit sofagent-audit --stats          审计聚合报告（近 30 天治理 KPI——v1.4.3）');
    console.log('  npx -y -p @sofagent/audit sofagent-audit --stats --days 7  窗口可调（近 7 天）');
    console.log('  npx -y -p @sofagent/audit sofagent-audit --stats --json   机器可读 JSON（SIEM/监控消费）\n');
    // v1.5.1 第八章：demo 子命令披露（本行是纯新增——既有各行的文案与顺序一字未动）
    console.log('  npx -y -p @sofagent/audit sofagent-audit demo           五分钟戏剧弧（亲眼看一次拦截发生，v1.5.1）');
    console.log('  npx -y -p @sofagent/audit sofagent-audit demo --speed fast  60 秒精简版（跳幕①②直入拦截）\n');
    // v1.3.9 四十四：双模式边界一次性讲清——此前用户敲 --init/--doctor 撞二次安装门槛
    // 却无处查边界，这里显式并列 quick flag 集 vs 完整引擎 flag 集 + 升级命令。
    console.log('双模式边界：');
    console.log('  quick 模式（本入口，零安装只读审计）仅支持：[diff 范围参数] + -h/--help + -v/--version + --stats/--days/--json；');
    console.log('  （--ruleset 等完整引擎 flag 传入时 quick 会自动路由完整引擎不报错——见下方 flag 清单）');
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
    console.log('  --silent            跳过依赖 Agent 日志的规则（A3/A7/A8/A14 等）');
    console.log('  --ci                CI 模式（输出适合 CI 解析）');
    console.log('  --strict            严格模式（无日志时 WARN 升级为 FAIL）');
    console.log('  --task <subject>    传入任务标题（A3 越界检查用）');
    console.log('  --commit-msg <msg>  传入完整 commit message（A9 注入检查用）');
    console.log('  --sign-config       对 config.yml 签名（防篡改）');
    console.log('  --verify-chain      校验审计历史 HMAC 链完整性');
    console.log('  --verify-commit     校验单个 commit 完整性（v1.2.9+）');
    console.log('  --support-bundle    打包诊断信息\n');
    // v1.4.9 P2-8：退出码此前只写在源码头注释里，`--help` 面零披露——
    // 用户（尤其 CI 里）拿到 3 无从查证。此处补全，与头注释同口径
    // （3 = 非 git 仓库为**本入口专属**；完整引擎把非 git 仓库记为 2）。
    console.log('退出码（quick 模式口径）：');
    console.log('  0 = 全通过');
    console.log('  1 = 有警告');
    console.log('  2 = 有违规（另一来源：承载安全语义的参数拼错 = 用法错误，与审计发现共用 2）');
    console.log('  3 = 非 git 仓库（跑错目录——与「引擎崩溃」单义区分）');
    console.log('  4 = 引擎崩溃（uncaughtException / unhandledRejection 兜底）\n');
    console.log('完整安装：npm install -g @sofagent/audit');
    return 0;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../package.json');
    console.log(`sofagent-audit v${pkg.version}`);
    return 0;
  }

  // ── v1.4.3 第七章：审计聚合指标（--stats / --days N / --json）──
  // 只读聚合（history.jsonl 零写入——HMAC 链完整性不受影响）；--json 纯净
  // 机器可读（零人类可读混行——企业 SIEM/监控平台消费）。
  if (argv.includes('--stats')) {
    const daysIdx = argv.indexOf('--days');
    const days =
      daysIdx !== -1 && argv[daysIdx + 1] && Number.isFinite(Number(argv[daysIdx + 1]))
        ? Math.max(1, Math.floor(Number(argv[daysIdx + 1])))
        : 30;
    const asJson = argv.includes('--json');
    const { computeAuditStats, formatStatsReport, formatStatsJson } = require('./stats');
    const report = computeAuditStats({ days });
    if (asJson) {
      console.log(formatStatsJson(report));
    } else {
      console.log(formatStatsReport(report));
    }
    // 聚合报告落盘 data/dashboard/audit-stats.json（对齐 train-status.json
    // 落盘模式——2026-08-29 拍板：只落盘，Dashboard 消费移 v1.5.0）
    try {
      const { existsSync: fsExists, mkdirSync, writeFileSync } = require('fs');
      const { join: pathJoin } = require('path');
      const { statsHistoryFilePath } = require('./stats');
      const historyFile = statsHistoryFilePath();
      const dashboardDir = pathJoin(historyFile, '..', '..', 'dashboard');
      if (fsExists(dashboardDir) || true) {
        mkdirSync(dashboardDir, { recursive: true });
        writeFileSync(
          pathJoin(dashboardDir, 'audit-stats.json'),
          JSON.stringify(report, null, 2),
          'utf-8',
        );
      }
    } catch {
      /* 落盘失败不阻断输出（聚合报告已打印——落盘是观测增强） */
    }
    return 0;
  }

  // v1.3.1 #12: 未知 flag 检测——quick 模式支持的参数有限，
  // 不在此列表中的 `-` 开头参数会被静默忽略，用户误以为审计已覆盖。
  // v1.4.7 批次 M：fail-loud 分级——可能承载安全语义的拼错形态（--ruleset* / --config*
  // / --task* 等）升级 exit 2（对齐 S359 三态退出码：exit 2 = 用法错误，非审计发现）：
  // 用户想加载规则集却敲错拼写（--rulesets 复数 / --ruleset=security 等号），拿到绿灯
  // 且无中断 = CI 假绿直通车。纯未知 flag 保留 warn（未来兼容噪声）。
  const QUICK_KNOWN_FLAGS = new Set([
    '--help', '-h', '--version', '-v',
    // v1.4.3 第七章：聚合指标参数组（--stats 主入口 + --days/--json 修饰）
    '--stats', '--days', '--json',
  ]);
  // 承载安全语义的参数前缀——拼错即用法错误（exit 2），不静默放行
  const SEMANTIC_FLAG_PREFIXES = ['--ruleset', '--config', '--task', '--au', '--exclud', '--includ'];
  const warnedFlags = new Set<string>();
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('-') && !FULL_ONLY_FLAGS.includes(arg) && !QUICK_KNOWN_FLAGS.has(arg)) {
      // 语义前缀命中（含等号/复数拼错形态）：exit 2 fail-loud
      const base = arg.split('=')[0] ?? arg;
      if (SEMANTIC_FLAG_PREFIXES.some((p) => base.startsWith(p))) {
        console.error(`❌ 未知参数: ${arg}——该形态可能承载安全语义（规则集/配置/任务范围），拼错即用法错误；请核对 --help 合法参数表`);
        process.exit(2);
      }
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
  // 现行行为（v1.4.5 起根 commit 补审）：有 SHA 无父提交 → 对比空树 SHA 补审全部新增内容
  // （见下方 diffFiles.length === 0 分支）；无 SHA 时提示不审计，不静默填充。
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
    // 规则：有基线但 diff 为空称「无文件变更」；根 commit 补审见下方 hasBaseline 分支。
    //
    // v1.5.1 M13②：空态输出**三处字面重复且均无产品签名**（改前 :506/:525/:535），
    // 而「误以为没装」的分支恰恰最该署名（同屏另两处回声行已有 `[sofagent]` 前缀）。
    // 现收口为一个 printEmpty 闭包：单一字面量 + `[sofagent]` 签名；标题行保持各分支原样。
    const printEmpty = (title?: string): void => {
      if (title !== undefined) {
        console.log(title);
        console.log('');
      }
      console.log('✅ [sofagent] 无文件变更——没有需要审计的内容。');
    };
    const hasBaseline = commitSha !== null && hasParentCommit();
    if (diffRange !== 'HEAD~1..HEAD') {
      // v1.5.1 F1：显式指定的范围必须先证明**可解析**，再谈「无变更」。
      // 缺陷：无效 ref（如 `nonsense-range`）在 parseDiff 内吞掉 git 报错并返回空数组，
      // 与「合法范围确实无变更」共用同一条 exit 0 路径 ⇒ 敲错 ref 即拿假绿；而本文件对
      // 「非 git 仓库」「diff 解析失败」都 fail-loud（exit 3），唯独无效范围放行，自相矛盾。
      // 判据：全部端点可解析 ⇒ 保持原行为（exit 0）；任一端点不可解析 ⇒ fail-loud。
      // 默认范围 `HEAD~1..HEAD` 不进本分支（其空态由下方 hasBaseline 分支统一处理，含
      // 根 commit 空树补审），故根 commit / 真无变更两种既有行为与文案零变化。
      if (!isResolvableDiffRange(diffRange)) {
        console.log('⚠️  diff 解析失败。');
        console.log(`   无法解析 diff 范围「${diffRange}」的 ref——请检查 ref 是否存在（如 HEAD~1..HEAD、origin/main..HEAD），或仓库是否尚无提交。`);
        return 3;
      }
      printEmpty(`🔍 审计指定范围（${diffRange}）`);
      return 0;
    }
    if (!hasBaseline) {
      // v1.4.5 审查 P1 修复：根 commit 补审——此前「首个 commit 无基线不审计」直接 exit 0，
      // 是假绿：首次提交（HEAD 存在但无父提交）含密钥/越界内容也放行。现用 git 空树 SHA 作
      // diff 基准，审计第一个 commit 的全部新增内容，与完整引擎（index.ts）的空树补审对齐。
      if (commitSha !== null) {
        const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
        try {
          diffFiles = parseDiff(`${EMPTY_TREE_SHA}..HEAD`);
        } catch {
          diffFiles = [];
        }
        if (diffFiles.length > 0) {
          console.log(`🔍 审计首个 commit（${commitSha}）——首次提交无父基线，对比空树审计全部新增内容。`);
          console.log('');
          // 已有内容，继续下方规则运行（不 return）
        } else {
          printEmpty();
          return 0;
        }
      } else {
        console.log('ℹ️ [sofagent] 首个 commit 无基线不审计——没有前一个版本可对比，下次提交起自动生效。');
        return 0;
      }
    } else {
      printEmpty(`🔍 审计最近一次 commit（${commitSha}）`);
      return 0;
    }
  }

  // 6. 运行审计规则（quick 模式：silent=true，零日志依赖）
  // v1.3.3 #8: quickMode=true 标记——A3（不改越界）见到跳过：quick 模式无真实任务描述，
  // task='quick-audit' 与任何文件都不匹配，必然 100% 误报越界 WARN。
  // v1.3.8 P1-B2: 传入真实 commitMsg（git log -1 取）——此前第 6 参恒 undefined，
  // A9（prompt 注入检测）在 quick 模式无输入假绿；commitMsg 取不到时 A9 按
  // 无输入处理（输出标「跳过」），不再假绿。
  // v1.3.8 P1-B4: 改用对象参数签名（十位置参数四布尔陷阱重构）。
  // v1.4.4 D-1: commitMsg 取被审计 range 终点（resolveDiffEndpoint）——
  // 与 diff 面（parseDiff(diffRange)）同源，range 模式下 A9 不再被字面 HEAD 污染。
  const commitMsg = getLatestCommitMsg(resolveDiffEndpoint(diffRange)) ?? undefined;
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
