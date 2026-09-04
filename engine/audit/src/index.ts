#!/usr/bin/env node
// ============================================================
// sofagent-audit · 提交时审计 CLI 入口
// v1.4.4 · 审计闭环六步（检测+分类+根因+改进+回归+上线）
// v1.0.8 精简（历史）：compose→orchestrator, subagent→orchestrator,
//          skillopt-run→skillopt, ab-test→ab-test,
//          daemon→daemon, doctor/verify→core (deprecation shim)
// ============================================================
// 扫描 git diff，检查 Agent 是否遵守审计规则。
// 最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块。
//
// 用法：
//   node engine/audit/dist/index.js --diff HEAD~1..HEAD --task "修复登录页 bug"
//   node engine/audit/dist/index.js --diff HEAD~1..HEAD --silent --task "test"
//   node engine/audit/dist/index.js --diff HEAD~1..HEAD --ci --task "test"
//   node engine/audit/dist/index.js --root-cause
//   node engine/audit/dist/index.js --regression ./src
//   node engine/audit/dist/index.js ontology view
//
// 退出码：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规（A1 不碰敏感 / A2 不泄密钥）
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { parseDiff, parseStagedDiff, isInGitRepo, type DiffFile } from '@sofagent/core';
import { loadConfig, ConfigLoadError, ConfigParseError, ConfigSignatureError } from '@sofagent/core';
import { VERSION } from '@sofagent/core';
import { BASELINE_RULE_KEYS } from '@sofagent/core';
import { checkConflict, mergeFederationResults } from '@sofagent/core';
import { generateOntologyView } from '@sofagent/ontology';
import { resolveDiffEndpoint } from './diff-ref';
import { checkLogs } from '@sofagent/core';
import { createShadowRepo, commitSnapshot, hasShadowRepo } from '@sofagent/core';
import { runRules, productSignature, type AuditResult } from './reporter';
// v1.3.9 B22: installHook 路径复用 init 的 gitignore 保障——此前 --install-hook 不写 .gitignore，
// shadow 快照数据可被 git add . 卷入用户仓库（LIMITATIONS 声称与行为不符）。
import { ensureGitignore } from './commands/init';
// v1.4.4 交付 2：国标对齐 GB/T 48000.3-2026（条款映射清单 + 覆盖度评估）
export { GB48000_CLAUSE_MAP, assessGb48000Coverage, buildGb48000RuleCheck } from './gb48000';
export type { Gb48000ClauseMapping, Gb48000Status, Gb48000Coverage } from './gb48000';
import { loadHistory, appendHistory, sanitizeFreeText, type AuditHistoryEntry } from './audit-history';
// v1.4.5 T1/T4: hook 安装核心抽取——core.hooksPath 尊重 + 用户 hook 链式保留
import { resolveHooksDir, installHooks } from './hook-install';
// v1.4.5 T8: sanitizePatterns 编译复用 ReDoS 双层防护（静态检测 + 运行时对抗测试）
import { compileSanitizePattern } from './ruleset-loader';

// Re-export for external consumers —— doctor 等外部调用方需要通过
// require('@sofagent/audit') 使用 checkHistoryChainIntegrity
export { checkHistoryChainIntegrity } from './audit-history';

// Re-export core 审计原语——daemon/mcp/orchestrator 通过 @sofagent/audit 消费（v1.2.9）
export { runRules, productSignature } from './reporter';
export type { AuditResult } from './reporter';
export { loadHistory, appendHistory } from './audit-history';
export type { AuditHistoryEntry } from './audit-history';
// Re-export core diff/log/config 原语（mcp-server.ts 从 audit 消费 parseDiff/checkLogs/loadConfig/VERSION）
export { parseDiff, checkLogs, loadConfig, VERSION } from '@sofagent/core';

// 训练语料导出（MCP corpus_export 经 require('@sofagent/audit') 消费此面）
export { exportRuleCorpus, generateVerifiers } from './export/exporter';
export { buildRuleCorpusBody, signBody, jsonToYaml } from './export/exporter';
export { buildVerifiersManifest, buildVerifiersWithOverrides } from './export/reward-mapping';
export type {
  RuleCorpusBody,
  RuleCorpusExport,
  RuleExportEntry,
  RewardHint,
  Verifiability,
} from './export/rule-schema';

// v1.3.9: re-export P0 数据主权 + skill 安全审查，供 daemon/mcp/orchestrator/skillopt 消费
export { DataSovereigntyLogger, resolveSovereigntyLogPath, resolveDateArg, sanitizeRecord } from './data-sovereignty';
export type { DataSovereigntyRecord, SovereigntyLogEntry } from './data-sovereignty';
export { generateDailyReport, generateWeeklyReport, generateMonthlyReport, generateReport, aggregateStats } from './report-generator';
export type { GeneratedReport, ReportKind } from './report-generator';
export { findFiles, scanFile } from './rules/skill-safety-engine';
export type { SafetyResult, SafetyRule } from './rules/skill-safety-rules';
// Re-export webhook 推送（mcp-server.ts 从 audit 消费 pushAuditResult）
export { pushAuditResult } from './webhook';
export type { WebhookPlatform } from './webhook';
// SSRF 守卫 re-export——daemon 等其他出站推送方复用同一判定（单一事实源，禁副本）
export { isPrivateWebhookUrl } from './webhook';
// v1.4.4 交付三：成本审计维度（cost_query MCP 与外部脚本 import 用）
export { runCostAudit, loadWorklogSlice } from './cost-audit';
export type { CostBudget, CostFinding, WorklogSlice } from './cost-audit';
// v1.3.9 交付⑭：分级降级梯队（韧性设计——workflow never stops）
export {
  DegradationManager,
  getCapability,
  filterRulesForLevel,
  isLlmUnavailable,
  isAuditTimeout,
  isDaemonCrash,
  LEVEL_ORDER,
} from './degradation';
export type { DegradationLevel, DegradationTrigger, DegradationRecord, LevelCapability, DegradationManagerOptions } from './degradation';
import { analyzeRootCause } from './audit-root-cause';
import { runVerifyChain, runVerifyCommit } from './commands/verify';
import { formatSuggestions } from './config-suggestion';
import { runRegression, type DiffSnapshot } from './audit-regression';
import { defaultRules, extendedRules } from './rules';
import { scanWorkspace, formatWorkspaceScan } from './workspace-scan';
import type { RuleCheck } from './rules/types';
import { pushAuditResult, type WebhookPlatform } from './webhook';
import { getFixSuggestion } from './fix-suggestions';
import { buildSessionReport, writeSessionReport } from './session-report';
import { loadPermission, checkPermission } from './permission';

/** 统一退出函数——确保退出码契约（0=全绿，1=警告，2=违规）执行一致性 */
function exit(code: 0 | 1 | 2, message?: string): never {
  if (message) console.error(message);
  process.exit(code);
}

/**
 * v1.4.4 交付十三：beforeAfter 结构化摘要——从 diff 提取变更前/后值。
 * 截断至 MAX 字符 + 复用脱敏语义（A2/A9 敏感内容打码），diff 原文不进 history.jsonl。
 * 提取规则：删除行（-）→ before，新增行（+）→ after；各取前 3 条，单条截断 120 字符。
 */
const BEFORE_AFTER_MAX_ITEMS = 3;
const BEFORE_AFTER_MAX_CHARS = 120;
function buildBeforeAfterSummary(diffFiles: DiffFile[]): { before?: string; after?: string } | undefined {
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) return undefined;
  const before: string[] = [];
  const after: string[] = [];
  for (const file of diffFiles) {
    if (!file || !Array.isArray(file.lines)) continue;
    for (const line of file.lines) {
      if (!line || line.length < 1) continue;
      if (line.startsWith('+') && !line.startsWith('+++')) {
        if (after.length < BEFORE_AFTER_MAX_ITEMS) after.push(line.substring(1).slice(0, BEFORE_AFTER_MAX_CHARS));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        if (before.length < BEFORE_AFTER_MAX_ITEMS) before.push(line.substring(1).slice(0, BEFORE_AFTER_MAX_CHARS));
      }
      if (before.length >= BEFORE_AFTER_MAX_ITEMS && after.length >= BEFORE_AFTER_MAX_ITEMS) break;
    }
    if (before.length >= BEFORE_AFTER_MAX_ITEMS && after.length >= BEFORE_AFTER_MAX_ITEMS) break;
  }
  if (before.length === 0 && after.length === 0) return undefined;
  // v1.4.5 T2: 落盘前过 sanitizeFreeText（REDACTION_PATTERNS 管道）——
  // beforeAfter 从 diff 行原文提取，密钥可混入；audit-history.ts 的
  // baseSanitized 只覆盖 ruleResults/commitMsg/task，actionGovernance.beforeAfter
  // 不在其内（嵌套对象未被展开脱敏）——必须在构建侧就打码，否则 diff 里的
  // sk-xxx/AKIAxxx 明文全文进 history.jsonl，审计工具自身成为第二泄漏点。
  const raw = {
    ...(before.length > 0 ? { before: before.join('\n') } : {}),
    ...(after.length > 0 ? { after: after.join('\n') } : {}),
  };
  return {
    before: sanitizeFreeText(raw.before) ?? undefined,
    after: sanitizeFreeText(raw.after) ?? undefined,
  };
}

interface Args {
  diffRange: string;
  task?: string;
  strict: boolean;
  silent: boolean;
  ci: boolean;
  installHook: boolean;
  json: boolean;
  rootCause: boolean;
  /** v1.2.9: --verify-chain 校验 HMAC hash chain 完整性 */
  verifyChain: boolean;
  /** v1.2.9: --verify-commit <hash> 检查 commit 是否有审计记录 */
  verifyCommit?: string;
  /** v1.4.4 交付 2：--gb48000 国标对齐维度（opt-in 默认 false，不影响默认审计行为） */
  gb48000: boolean;
  regressionDir?: string;
  webhook?: WebhookPlatform;
  webhookUrl?: string;
  mcp: boolean;
  init: boolean;
  signConfig: boolean;
  /** staged 模式（首次提交场景）——diffRange 值为 --cached */
  cached: boolean;
  /** v1.0.9: 恢复到指定快照 SHA */
  revertSha?: string;
  /** v1.0.9: --timeline 查看快照时间线 */
  timeline?: boolean;
  timelineLimit?: number;
  timelineJson?: boolean;
  /** v1.0.9: ontology 子命令 */
  ontologyCommand?: string;
  /** v1.2.5 P2: conflict-check 子命令 */
  conflictCheckCommand?: boolean;
  /** v1.2.5 P2: federation-distill 子命令 */
  federationDistillCommand?: boolean;
  /** v1.4.4: agent-shield 子命令（AgentShield 五类配置面扫描） */
  agentShieldCommand?: boolean;
  /** corpus 子命令：训练语料导出三件套 */
  corpusCommand?: boolean;
  /** v1.2.9: support-bundle 子命令 */
  supportBundle: boolean;
  /** v1.4.4: 审计 session 产物（默认开启，--no-session 关闭） */
  noSession: boolean;
  /** v1.4.4: --commit-msg 完整 commit message（hook 场景传完整 body 供 A9 扫描） */
  commitMsgArg?: string;
  /** v1.2.9 (⑧-3): --format github 输出为 GitHub Annotations 格式 */
  format?: string;
  /** v1.2.9 (⑧-2): --ruleset 指定规则集名称（如 sofagent / security） */
  ruleset?: string;
  /** v1.2.9 (⑧-2): --ruleset-path 指定本地规则集目录 */
  rulesetPath?: string;
  /** v1.2.9 (⑧-2): --list-rulesets 列出可用规则集 */
  listRulesets?: boolean;
  /** v1.4.4 #15: --warn-as-error 让 WARN 返回 exit 2（安全优先，CI 阻断） */
  warnAsError: boolean;
  /** v1.4.4 #15: --warn-as-info 让 WARN 返回 exit 0（CI 不阻断，仅信息性） */
  warnAsInfo: boolean;
}


/**
 * 顶层子命令白名单（v1.4.4 补 agent-shield）。
 * 位置参数必须是其中之一；否则按「未知子命令」报错。
 */
const SUBCOMMANDS = ['ontology', 'conflict-check', 'federation-distill', 'agent-shield', 'corpus'];

function parseArgs(argv: string[]): Args {
  const args: Args = { diffRange: 'HEAD~1..HEAD', strict: false, silent: false, ci: false, installHook: false, json: false, rootCause: false, verifyChain: false, webhookUrl: process.env.SOFAGENT_WEBHOOK_URL, mcp: false, init: false, signConfig: false, cached: false, noSession: false, conflictCheckCommand: false, federationDistillCommand: false, agentShieldCommand: false, supportBundle: false, format: undefined, ruleset: undefined, rulesetPath: undefined, listRulesets: false, warnAsError: false, warnAsInfo: false, gb48000: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--diff') {
      // --diff 无显式值（末尾或后跟其他 flag）→ 用默认 HEAD~1..HEAD，
      // 不再落进「不支持的参数 --diff」矛盾报错
      const next = argv[i + 1];
      if (next === '--cached') {
        i++;
        args.diffRange = '--cached';
        args.cached = true;
      } else if (next && !next.startsWith('-')) {
        i++;
        args.diffRange = next as string;
      } else {
        args.diffRange = 'HEAD~1..HEAD';
      }
    } else if (argv[i] === '--task' && argv[i + 1]) {
      i++;
      args.task = argv[i] as string;
    } else if (argv[i] === '--commit-msg' && argv[i + 1]) {
      i++;
      args.commitMsgArg = argv[i] as string;
    } else if (argv[i] === '--strict') {
      args.strict = true;
    } else if (argv[i] === '--gb48000') {
      // v1.4.4 交付 2：国标对齐维度（opt-in——信息条目，不影响 exitCode）
      args.gb48000 = true;
    } else if (argv[i] === '--warn-as-error') {
      // v1.4.4 #15: WARN 视为 error（exit 2），CI 阻断。安全优先。
      args.warnAsError = true;
    } else if (argv[i] === '--warn-as-info') {
      // v1.4.4 #15: WARN 视为 info（exit 0），CI 不阻断。仅信息性输出。
      args.warnAsInfo = true;
    } else if (argv[i] === '--silent') {
      args.silent = true;
    } else if (argv[i] === '--ci') {
      args.ci = true;
      args.silent = true;   // --ci 隐含 --silent（CI 友好输出），不隐含 --strict
    } else if (argv[i] === '--install-hook') {
      args.installHook = true;
    } else if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--root-cause') {
      args.rootCause = true;
    } else if (argv[i] === '--verify-chain') {
      args.verifyChain = true;
    } else if (argv[i] === '--verify-commit' && argv[i + 1]) {
      i++;
      args.verifyCommit = argv[i] as string;
    } else if (argv[i] === '--regression' && argv[i + 1]) {
      i++;
      args.regressionDir = argv[i] as string;
    } else if (argv[i] === '--revert') {
      // v1.0.8: 无参报错修复
      if (!argv[i + 1] || argv[i + 1]!.startsWith('--')) {
        console.error('❌ sofagent 提示：缺少快照 SHA 参数，用法: sofagent-audit --revert <snapshot-sha>');
        console.error('   查看可用快照：sofagent-audit --timeline');
        exit(2);
      }
      i++;
      args.revertSha = argv[i] as string;
    } else if (argv[i] === '--timeline') {
      // v1.0.8: 快照时间线
      args.timeline = true;
      args.timelineJson = argv.includes('--json');
      // 下一个参数如果是数字则为 limit
      if (argv[i + 1] && /^\d+$/.test(argv[i + 1]!)) {
        i++;
        args.timelineLimit = parseInt(argv[i] as string, 10);
      }
    } else if (argv[i] === '--webhook' && argv[i + 1]) {
      i++;
      const platform = argv[i] as string;
      if (platform === 'dingtalk' || platform === 'feishu' || platform === 'wecom') {
        args.webhook = platform;
      } else {
        console.error(`❌ sofagent 提示：不支持的 webhook 平台 "${platform}"（可用: dingtalk / feishu / wecom）`);
        exit(1);
      }
    } else if (argv[i] === '--webhook-url' && argv[i + 1]) {
      i++;
      args.webhookUrl = argv[i] as string;
    } else if (argv[i] === '--mcp') {
      // MCP Server 模式：启动 JSON-RPC 2.0 over stdio
      args.mcp = true;
    } else if (argv[i] === '--init') {
      args.init = true;
    } else if (argv[i] === '--sign-config') {
      args.signConfig = true;
    } else if (argv[i] === '--support-bundle') {
      args.supportBundle = true;
    } else if (argv[i] === '--no-session') {
      args.noSession = true;
    } else if (argv[i] === '--no-daemon') {
      // v1.4.4 #48: --no-daemon flag——跳过 daemon 注册（init 流程使用）。
      // init.ts 通过 process.argv.includes('--no-daemon') 消费，
      // 此处仅注册为已知 flag，避免 parseArgs 误报「不支持的参数」。
      // 值由 init 流程直接从 process.argv 读取，不存入 args。
    } else if (argv[i] === '--format' && argv[i + 1]) {
      i++;
      args.format = argv[i] as string;
    } else if (argv[i] === '--ruleset' && argv[i + 1]) {
      i++;
      args.ruleset = argv[i] as string;
    } else if (argv[i] === '--ruleset-path' && argv[i + 1]) {
      i++;
      args.rulesetPath = argv[i] as string;
    } else if (argv[i] === '--list-rulesets') {
      args.listRulesets = true;
    } else if (argv[i] === 'ontology' && argv[i + 1]) {
      i++;
      args.ontologyCommand = argv[i] as string;
      break; // 子命令之后的参数属该子命令——顶层 parser 到此为止
    } else if (argv[i] === 'conflict-check') {
      // v1.2.5 P2: conflict-check 子命令
      args.conflictCheckCommand = true;
      break;
    } else if (argv[i] === 'federation-distill') {
      // v1.2.5 P2: federation-distill 子命令
      args.federationDistillCommand = true;
      break;
    } else if (argv[i] === 'agent-shield') {
      // v1.4.4: agent-shield 子命令
      args.agentShieldCommand = true;
      break;
    } else if (argv[i] === 'corpus') {
      // corpus 子命令：训练语料导出三件套
      args.corpusCommand = true;
      break;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      const verbose = argv.includes('--verbose');
      console.log(`sofagent-audit v${VERSION} · FDE Harness 的审计引擎\n`);
      console.log('快速开始:');
      console.log('  安装    npm install -g @sofagent/audit && sofagent-audit --init');
      console.log('  试用    sofagent-audit --diff HEAD~1..HEAD');
      console.log('  npx     npx -y -p @sofagent/audit sofagent-audit --init');
      console.log('命令:');
      console.log('  sofagent-audit --diff <range> [--task <desc>]   审计 git diff');
      console.log('  sofagent-audit --init                           一键初始化（配置+hook+冒烟）');
      console.log('  sofagent-audit --doctor                         运行环境健康检查（检查 config / hook / 版本一致性）');
      console.log('  sofagent-audit --sign-config                    对 config.yml 签名（消除防篡改警告）');
      console.log('  sofagent-audit --support-bundle                 一键生成 issue 摘要 + 证据 zip（脱敏）');
      console.log('  sofagent-audit --root-cause                     根因分析');
      console.log('  sofagent-audit --verify-chain                   审计链完整性校验');
      console.log('  sofagent-audit --verify-commit <hash>           检查 commit 审计记录');
      console.log('  sofagent-audit --regression <dir>               回归验证');
      console.log('  sofagent-audit --install-hook                   安装 pre-commit + commit-msg + post-commit hook');
      console.log('  sofagent-audit --revert <snapshot-sha>           恢复到指定快照');
      console.log('  sofagent-audit --timeline [N]                   查看快照时间线');
      console.log('  sofagent-audit ontology view                    本体人类可读视图');
      console.log('  子命令自有参数见各自 --help 说明：');
      console.log('  sofagent-audit agent-shield [--json] [--no-process]   AgentShield 五类配置面扫描（MCP/Hook/配置/密钥/影子 AI）');
      console.log('  sofagent-audit conflict-check [--fix] [--json]       知识矛盾/孤儿/死链检测');
      console.log('  sofagent-audit federation-distill [--json]           联邦蒸馏');
      console.log('  sofagent-audit corpus export [--scope all] [--json]  训练语料导出三件套（规则+方法论+样本）');
      console.log('');
      if (verbose) {
        console.log('v1.0.8 已弃用的子命令（将在 v1.5.0 移除，请尽快迁移）:');
        console.log('  compose      → sofagent-orchestrator compose');
        console.log('  subagent run → sofagent-orchestrator subagent run');
        console.log('  skillopt-run → sofagent-skillopt');
        console.log('  ab-test      → sofagent-ab-test');
        console.log('  daemon       → sofagent-daemon');
        console.log('  doctor/verify → sofagent-core（npm install -g @sofagent/core）');
      }
      console.log('模式对照表:');
      console.log('  默认模式    全部规则（含 Agent 日志）   exit 0/1/2');
      console.log('  --silent    跳过依赖 Agent 日志的规则（A3/A7/A8/A14 等）exit 0/1/2');
      console.log('  --strict    任何警告都 exit 2            exit 0/2');
      console.log('  --ci        = --silent（CI 友好输出，无交互提示）     exit 0/1/2');
      console.log('');
      console.log('双入口对照:');
      console.log('  sofagent-audit      quick 只读审计（17 条默认规则，秒级）');
      console.log('  sofagent-audit-full 完整引擎（--init / --diff <range> / 24 条规则）——详见 README「快速开始」');
      if (verbose) {
        console.log('\n完整参数列表:');
        console.log('  --diff <range>     git diff 范围（默认 HEAD~1..HEAD）');
        console.log('  --task <desc>      任务描述');
        console.log('  --strict           严格模式');
        console.log('  --silent           跳过依赖 Agent 日志的规则（A3/A7/A8/A14 等，无日志环境用）');
        console.log('  --ci               CI 模式（= --silent，CI 友好输出，无交互提示）');
        console.log('  --json             JSON 输出');
        console.log('  --install-hook     安装 pre-commit + commit-msg + post-commit hook');
        console.log('  --root-cause       根因分析');
        console.log('  --verify-chain     审计链完整性校验');
        console.log('  --verify-commit    检查 commit 审计记录');
        console.log('  --regression <dir> 回归验证');
        console.log('  --init             一键初始化');
        console.log('  --doctor           环境健康检查（内置完整诊断）');
        console.log('  --baseline         建立 dist 基准哈希（影子审计器防线信任锚，等价 --reset-baseline）');
        console.log('  --reset-baseline   重置 dist 基准哈希（rebuild 后一键重置，自动路由 doctor）');
        console.log('  --sign-config      对 config.yml 签名（消除防篡改警告）');
        console.log('  --no-session      不写入 session 报告文件');
        console.log('  --webhook <p>      webhook 推送（dingtalk/feishu/wecom）');
        console.log('  --webhook-url <u>  webhook URL');
        console.log('  --format github    输出为 GitHub Actions Annotations 格式');
        console.log('  --ruleset <name>   指定规则集（sofagent / security / 社区包）');
        console.log('  --ruleset-path <d> 加载本地自定义规则集目录');
        console.log('  --list-rulesets    列出可用规则集');
        console.log('  --mcp              MCP Server（已拆分为 @sofagent/mcp）');
        console.log('\n退出码: 0=全通过 / 1=有警告 / 2=有违规');
      } else {
        console.log('\n完整参数列表: sofagent-audit --help --verbose');
      }
      exit(0);
    } else if (argv[i] === '--version') {
      console.log(`sofagent-audit v${VERSION}`);
      exit(0);
    } else {
      const arg = argv[i];
      if (arg && arg.startsWith('--')) {
        console.error(`❌ sofagent 提示：不支持的参数 "${arg}"`);
        console.error('   使用 --help 查看可用参数');
        exit(1);
      } else if (arg && !arg.startsWith('-')) {
        // v1.0.8: 未知子命令报错（子命令之后的参数已在子命令分支 break，不会流到这里）
        if (!SUBCOMMANDS.includes(arg)) {
          console.error(`未知子命令: ${arg}`);
          console.error(`可用子命令: ${SUBCOMMANDS.join(', ')}`);
          exit(1);
        }
      }
    }
  }
  return args;
}

/**
 * 安装 git pre-commit + commit-msg + post-commit hook（三层防线）
 * 从 cwd 往上查找 .git 目录，将 hooks/ 下三个模板复制到 .git/hooks/
 *
 * v1.3.9 P0-RC3: hook 安装清单与 --init 对齐——installHook() 也安装 post-commit。
 * 老用户 `sofagent-audit --install-hook` 升级时不再 miss post-commit（--no-verify 绕过的唯一防线）。
 * v1.4.4 H-01: 补装 pre-commit（.sofagent/ 永不入库主防线——staged 清理在
 * commit 对象生成前生效，规避 macOS git 内存 index 快照时序问题）。
 */
function installHook(): void {
  // v1.4.5 T1: hook 落点改经 resolveHooksDir（core.hooksPath 优先，缺省 .git/hooks）。
  // 此前硬编码 $gitDir/hooks——repo 配置 core.hooksPath=.githooks 时装到 .git/hooks，
  // git 根本不会执行（等于没装），且 --doctor 按 hooksPath 找不到还误报未安装。
  const resolution = resolveHooksDir(process.cwd());
  if (!resolution) {
    console.error('❌ sofagent 提示：当前目录不是 git 仓库。请在 git 仓库内运行此命令，或先 git init。');
    exit(1);
  }

  // v1.3.9 B22: 与 --init 路径对齐——装 hook 前确保 .sofagent/ 被 .gitignore 排除，
  // 防止 .sofagent/.git-shadow/ 快照数据被 git add . 卷入用户仓库（幂等，已有条目则跳过）。
  try {
    ensureGitignore(dirname(resolution.gitDir));
  } catch (e) {
    console.warn('[sofagent] 警告：更新 .gitignore 失败，请手动添加 .sofagent/', e instanceof Error ? e.message : String(e));
  }

  // 定位 hook 模板（dist/index.js 编译后，模板在 ../../hooks/ 相对于 dist/）
  const hooksTemplateDir = join(__dirname, '..', 'hooks');

  try {
    const result = installHooks({ cwd: process.cwd(), templateDir: hooksTemplateDir });
    if (result.configured) {
      console.log(`ℹ️ [sofagent] 检测到 core.hooksPath=${result.configuredValue ?? ''}——hook 已安装到配置目录（git 将从该目录执行 hook）`);
    }
    console.log('   每次 git commit 时会自动运行 sofagent-audit 检查；pre-commit 拦 .sofagent/ 入库，post-commit 在提交后对账 --no-verify 绕过。');
    exit(0);
  } catch (e) {
    console.error(`❌ sofagent 提示：${e instanceof Error ? e.message : String(e)}`);
    exit(1);
  }
}

/**
 * --root-cause 模式：分析审计历史，输出根因报告 + 配置建议
 */
function runRootCauseAnalysis(): void {
  try {
    const history = loadHistory();

    if (history.length === 0) {
      console.log('无历史数据。运行 sofagent-audit --diff <range> 后会自动记录审计历史。');
      exit(0);
    }

    const report = analyzeRootCause(history);
    const output = formatSuggestions(report);
    console.log(output);

    exit(0);
  } catch (err) {
    console.error(`❌ sofagent 根因分析失败: ${err instanceof Error ? err.message : String(err)}`);
    console.error('  可能是审计记录格式不一致。如刚升级版本，历史记录可能缺少部分字段。');
    exit(1);
  }
}

/**
 * --regression 模式：对指定目录下的历史快照跑回归验证
 * 第一版只接受 fixture 目录路径，加载里面的预构筑 snapshots
 * @param dir fixture 目录路径
 */
function runRegressionMode(dir: string): void {
  if (!existsSync(dir)) {
    console.error(`❌ sofagent 提示：目录不存在——${dir}`);
    exit(1);
  }

  // 从 fixture 目录加载 snapshots
  // fixture 目录结构：每个 .json 文件是一个 snapshot
  const snapshots = loadSnapshotsFromDir(dir);

  if (snapshots.length === 0) {
    console.log(`目录 ${dir} 中没有找到快照文件。`);
    console.log('快照文件格式：JSON，包含 timestamp / diffFiles / logEntries / previousResults 字段。');
    exit(0);
  }

  const report = runRegression(snapshots, defaultRules);

  console.log('\n=== 回归验证报告 ===\n');
  console.log(`快照数: ${report.totalSnapshots}`);
  console.log(`新增问题: ${report.newIssues}`);
  console.log(`解决问题: ${report.resolvedIssues}`);
  console.log(`无变化: ${report.unchanged}`);

  if (report.details.length > 0) {
    console.log('\n--- 详细变化 ---');
    for (const detail of report.details) {
      const icon = detail.newStatus === 'PASS' ? '✅' : detail.newStatus === 'WARN' ? '⚠️ ' : '❌';
      console.log(`  ${icon} [${detail.timestamp}] ${detail.ruleName}: ${detail.oldStatus} → ${detail.newStatus}`);
    }
  }

  console.log('\n=== 报告结束 ===\n');
  exit(0);
}

/**
 * 从 fixture 目录加载快照文件
 * @param dir 目录路径
 * @returns DiffSnapshot 数组
 */
function loadSnapshotsFromDir(dir: string): DiffSnapshot[] {
  const snapshots: DiffSnapshot[] = [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    process.stderr.write(`[sofagent-audit] warn: snapshot 目录不可读: ${(err as Error).message}\n`);
    return snapshots;
  }

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const data = JSON.parse(content);
      // 宽松解析——只提取必要字段
      snapshots.push({
        timestamp: data.timestamp || file,
        diffFiles: data.diffFiles || [],
        logEntries: data.logEntries || [],
        task: data.task,
        previousResults: (data.previousResults || []) as RuleCheck[],
      });
    } catch (err) {
      // 跳过解析失败的文件
      process.stderr.write(`[sofagent-audit] warn: snapshot 解析失败: ${(err as Error).message}\n`);
    }
  }

  return snapshots;
}

// ============================================================
// v1.0.9: --timeline 快照时间线
// ============================================================

function printTimeline(limit: number, json: boolean): void {
  try {
    const { listAllSnapshots } = awaitLoadSnapshot();
    const projectDir = process.cwd();
    const snapshots = listAllSnapshots(projectDir).slice(0, limit);

    if (json) {
      console.log(JSON.stringify(snapshots, null, 2));
      return;
    }

    if (snapshots.length === 0) {
      console.log('暂无快照。运行审计后会自动创建快照。');
      return;
    }

    for (const snap of snapshots) {
      const time = new Date(snap.timestamp).toLocaleString('zh-CN');
      console.log(`${time}  ${snap.shortSha}  ${snap.fileCount} 文件`);
    }
    console.log(`\n  共 ${snapshots.length} 条快照（最近 ${limit} 条）`);
    console.log('  回滚：sofagent-audit --revert <SHA>');
  } catch (err) {
    console.error('❌ sofagent 获取快照时间线时遇到问题:', (err as Error).message);
    exit(1);
  }
}

// 同步加载 snapshot 模块（v1.4.4 从 @sofagent/daemon 迁移到 @sofagent/core，消除循环依赖）
function awaitLoadSnapshot(): typeof import('@sofagent/core') {
  try {
    return require('@sofagent/core');
  } catch {
    throw new Error('sofagent core 模块未安装。请先安装依赖。');
  }
}

// v1.0.9: confirm 辅助函数（非 TTY 自动确认，不挂起）
function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(true);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (ans) => {
      rl.close();
      resolve(/^(y|yes|是)$/i.test(ans.trim()));
    });
  });
}

/**
 * v1.3.9 (DP-1) 版本一致性自检——检测陈旧全局安装。
 *
 * 原理：运行中的产物有自己的 package.json（与 dist/index.js 同级上层目录），
 * 读取其实际 version，与编译进代码的 VERSION 常量（来自 @sofagent/core/constants.ts）比对。
 * 如果不一致，说明全局安装的 npm 包比当前源码旧（用户本地源码已更新但忘了 npm i -g 刷新）。
 *
 * 这是轻量、同进程、无副作用的检查，仅在 CLI 入口运行一次，不阻断任何操作。
 * --version / --help 等快速出口在 parseArgs 内已 process.exit，不会走到这里。
 */
function checkVersionConsistency(): void {
  try {
    // dist/index.js → 上级目录的 package.json（npm 安装时与 dist 同层）
    const pkgPath = join(__dirname, '..', 'package.json');
    if (!existsSync(pkgPath)) return; // 开发模式或非标准安装，静默跳过
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const pkgVersion = pkg?.version;
    if (typeof pkgVersion === 'string' && pkgVersion !== VERSION) {
      console.warn(
        `⚠️ 版本不一致：sofagent-audit 全局安装为 v${pkgVersion}，当前源码为 v${VERSION}。`
      );
      console.warn(
        `   全局安装可能陈旧，建议刷新：npm i -g @sofagent/audit@latest`
      );
    }
  } catch (err) {
    // 读取失败不阻断运行——自检是 advisory，绝不能影响主流程
    process.stderr.write(`[sofagent-audit] warn: 版本自检读取失败: ${(err as Error).message}\n`);
  }
}

async function main(): Promise<void> {
  // DP-1: 版本一致性自检（轻量、不阻断）
  checkVersionConsistency();

  // === v1.0.8 deprecation shim ===
  // 在 args 解析之后、主 switch 分支之前，拦截已迁移的子命令
  const rawArgs = process.argv.slice(2);

  // compose → sofagent-orchestrator (v1.0.8 友好报错降级，不再 execFileSync)
  if (rawArgs.includes('compose')) {
    console.error('⚠️  "sofagent-audit compose" 已弃用，将在 v1.5.0 移除，请尽快迁移到 "sofagent-orchestrator compose"。');
    console.error('   请直接运行：sofagent-orchestrator compose');
    console.error('   安装：npm install -g @sofagent/orchestrator');
    exit(1);
  }

  // doctor → @sofagent/core 内置健康检查(移除对 core CLI 的 doctor 错误推荐——
  // core CLI 只支持子命令形式，flag 形式不合法；且 audit --doctor 已直接调用 core 的
  // runDoctor，本就是完整诊断，无需再引导到别的命令）
  // v1.3.9：--reset-baseline 自动路由到 doctor（不带 --doctor 也不报未知参数——
  // rebuild dist 后一键重置基准哈希，bugfix #18 执行遗留）
  // v1.4.4 G-01：--baseline 作为 --reset-baseline 的显式别名——语义都是「计算当前
  // dist SHA-256 写入 audit-hash.txt 建立基线」（信任锚 = 首次人工执行时刻）
  const wantsBaseline = rawArgs.includes('--reset-baseline') || rawArgs.includes('--baseline');
  if (rawArgs.includes('--doctor') || wantsBaseline) {
    try {
      const { runDoctor } = await import('@sofagent/core');
      const report = runDoctor(process.cwd(), {
        resetBaseline: wantsBaseline,
      });
      // v1.4.4 (F-23): doctor 仅在 error 时返回非零，warning 时返回 0——
      // 对 cron/CI 脚本友好（仅警告不应被解释为失败）。人类如需 warning 也失败，用 --doctor --strict。
      if (rawArgs.includes('--strict')) {
        exit(report.allOk ? 0 : report.failCount > 0 ? 2 : 1);
      }
      exit(report.failCount > 0 ? 1 : 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' || (err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        // audit 自身的简易诊断（检查 git 仓库 + audit 安装状态）
        console.log('audit 环境自检：');
        const gitAvailable = (() => { try { require('child_process').execFileSync('git', ['--version'], { stdio: 'pipe' }); return true; } catch { return false; } })();
        console.log(`  ${gitAvailable ? '✅' : '❌'} git ${gitAvailable ? '可用' : '不可用'}`);
        console.log(`  ✅ sofagent-audit CLI 可用`);
        exit(0);
      }
      throw err;
    }
  }

  // verify → sofagent-core (v1.0.8 友好报错降级，不再 execFileSync)
  if (rawArgs.includes('verify')) {
    console.error('⚠️  "sofagent-audit verify" 已弃用，将在 v1.5.0 移除，请尽快迁移到 "sofagent-core verify"。');
    console.error('   请直接运行：sofagent-core verify');
    console.error('   安装：npm install -g @sofagent/core');
    exit(1);
  }

  const args = parseArgs(process.argv);

  // P1-A9: 无参数运行静默写库——用户无意识触发真实审计并写入全局数据。
  // 无参数时（argv 仅含 node + 脚本路径，无任何 flag），改为输出 help 而非默认执行审计。
  if (process.argv.slice(2).length === 0) {
    console.log(`sofagent-audit v${VERSION} · FDE Harness 的审计引擎\n`);
    console.log('⚠️  无参数运行不会执行审计。请指定要执行的操作：\n');
    console.log('常用命令:');
    console.log('  sofagent-audit --init                           一键初始化（配置+hook+冒烟）');
    console.log('  sofagent-audit --diff HEAD~1..HEAD              审计最近一次 commit');
    console.log('  sofagent-audit --diff --cached                  审计暂存区（commit-msg hook 用）');
    console.log('  sofagent-audit --diff origin/main..HEAD         审计分支差异');
    console.log('  sofagent-audit --doctor                         运行环境健康检查');
    console.log('  sofagent-audit --verify-chain                   审计链完整性校验');
    console.log('  sofagent-audit --help                           查看全部命令');
    console.log('');
    console.log('提示：commit-msg hook 会自动运行审计，通常无需手动执行。');
    exit(0);
  }

  // --mcp 模式：MCP Server 已拆分为独立包 @sofagent/mcp
  if (args.mcp) {
    console.log('MCP Server 已拆分为独立包 @sofagent/mcp。');
    console.log('请使用 sofagent-mcp 命令启动，或在 package.json 中安装 @sofagent/mcp。');
    console.log('');
    console.log('安装: npm install @sofagent/mcp');
    console.log('启动: npx sofagent-mcp');
    console.log('');
    console.log('MCP Client 配置示例:');
    console.log('  {');
    console.log('    "mcpServers": {');
    console.log('      "sofagent": {');
    console.log('        "command": "npx",');
    console.log('        "args": ["sofagent-mcp"]');
    console.log('      }');
    console.log('    }');
    console.log('  }');
    exit(0);
  }

  // --init 模式：一键初始化 config + hook + 冒烟测试
  if (args.init) {
    const { runInit } = await import('./commands/init');
    runInit();
    return;
  }

  // --sign-config 模式：对 config.yml 签名（消除防篡改警告）
  if (args.signConfig) {
    const { signConfig, getConfigFile } = await import('@sofagent/core');
    const configPath = getConfigFile();
    try {
      const result = signConfig(configPath);
      console.log(`✅ config.yml 签名完成（${result}）：${configPath}`);
      exit(0);
    } catch (err) {
      console.error(`❌ 签名失败: ${err instanceof Error ? err.message : String(err)}`);
      console.error('   提示：签名需要 HMAC 密钥（~/.sofagent-key），运行 sofagent-audit --init 可自动生成');
      exit(1);
    }
  }

  // v1.2.9: --support-bundle 模式——一键生成 issue 摘要 + 证据 zip
  if (args.supportBundle) {
    const { generateSupportBundle } = await import('./support-bundle');
    try {
      const zipPath = await generateSupportBundle();
      const stats = statSync(zipPath);
      const sizeKB = Math.round(stats.size / 1024);
      console.log(`✅ support-bundle 已生成：${zipPath}（${sizeKB}KB）`);
      console.log('   包含：version.txt / doctor-output.txt / audit-log-recent.jsonl / config-summary.yml / install-info.txt');
      exit(0);
    } catch (err) {
      console.error(`❌ support-bundle 生成失败: ${err instanceof Error ? err.message : String(err)}`);
      exit(1);
    }
  }

  // ontology 子命令（v1.0.9 新增，v1.0.8 改用 @sofagent/ontology）
  // audit 已声明 @sofagent/ontology 依赖——改静态 import 获类型安全（此前动态 import 运行时才报错）
  if (args.ontologyCommand === 'view') {
    try {
      const output = generateOntologyView(process.cwd());
      process.stdout.write(output);
      process.stdout.write('\n');
      exit(0);
    } catch (err) {
      process.stderr.write(`❌ ontology view 失败: ${(err as Error).message}\n`);
      exit(1);
    }
  }

  // v1.2.5 P2：conflict-check 子命令（知识矛盾检测 CLI）
  if (args.conflictCheckCommand) {
    const { runConflictCheckCli, parseConflictCheckArgs } = await import('./cli/conflict-check');
    const cliArgs = parseConflictCheckArgs(rawArgs);
    try {
      // checkConflict 已下沉到 core——静态 import，类型安全（此前 any + 变量名动态 import）
      const exitCode = runConflictCheckCli(cliArgs, checkConflict);
      exit(exitCode as 0 | 1 | 2);
    } catch (err) {
      console.error(`❌ conflict-check 失败: ${(err as Error).message}`);
      console.error('   提示：conflict-check 需要 knowledge/ 目录存在（运行 --init 创建）');
      exit(1);
    }
  }

  // v1.2.5 P2：federation-distill 子命令（联邦蒸馏 CLI）
  if (args.federationDistillCommand) {
    const { runFederationDistillCli, parseFederationDistillArgs } = await import('./cli/federation-distill');
    const cliArgs = parseFederationDistillArgs(rawArgs);
    try {
      // mergeFederationResults 已下沉到 core——静态 import，类型安全
      const exitCode = runFederationDistillCli(cliArgs, mergeFederationResults);
      exit(exitCode as 0 | 1 | 2);
    } catch (err) {
      console.error(`❌ federation-distill 失败: ${(err as Error).message}`);
      console.error('   提示：federation-distill 需要 @sofagent/daemon 包（npm install @sofagent/daemon）');
      exit(1);
    }
  }

  // v1.4.4：agent-shield 子命令（AgentShield 五类配置面扫描 CLI）
  if (args.agentShieldCommand) {
    const { runAgentShieldCli, parseAgentShieldArgs } = await import('./cli/agent-shield');
    const cliArgs = parseAgentShieldArgs(rawArgs);
    try {
      // createAgentShield 就在 audit 包内——无跨包依赖，直接跑
      const exitCode = runAgentShieldCli(cliArgs);
      exit(exitCode as 0 | 1 | 2);
    } catch (err) {
      console.error(`❌ agent-shield 失败: ${(err as Error).message}`);
      console.error('   提示：agent-shield 只读扫描，需要可读的项目根目录（--repo <dir> 指定）');
      exit(1);
    }
  }

  // corpus 子命令（训练语料导出三件套 CLI）
  if (args.corpusCommand) {
    const { runCorpusExportCli, parseCorpusArgs } = await import('./cli/corpus');
    const cliArgs = parseCorpusArgs(rawArgs);
    try {
      const exitCode = await runCorpusExportCli(cliArgs);
      exit(exitCode as 0 | 1);
    } catch (err) {
      console.error(`❌ corpus export 失败: ${(err as Error).message}`);
      console.error('   提示：样本聚合需要 data/ 目录存在（各源缺席属常态，导出仍继续）');
      exit(1);
    }
  }

  // --timeline 模式：快照时间线（v1.0.9 新增）
  if (args.timeline) {
    printTimeline(args.timelineLimit || 20, args.timelineJson || false);
    return;
  }

  // --install-hook 在开头处理，完成后退出
  if (args.installHook) {
    installHook();
    return;
  }

  // --verify-chain 模式（v1.2.9 新增）
  if (args.verifyChain) {
    runVerifyChain();
    return;
  }

  // --verify-commit <hash> 模式（v1.2.9 新增）
  if (args.verifyCommit) {
    runVerifyCommit(args.verifyCommit);
    return;
  }

  // --root-cause 模式：分析审计历史，输出根因报告 + 配置建议
  if (args.rootCause) {
    runRootCauseAnalysis();
    return;
  }

  // --regression 模式：对指定目录下的历史快照跑回归验证
  if (args.regressionDir) {
    runRegressionMode(args.regressionDir);
    return;
  }

  // v1.2.9 (⑧-2): --list-rulesets → 列出可用规则集后退出
  if (args.listRulesets) {
    const { listAvailableRulesets, formatRulesetList } = require('./ruleset-loader');
    const infos = listAvailableRulesets(args.rulesetPath);
    console.log(formatRulesetList(infos));
    exit(0);
  }

  // --revert 模式：恢复到指定快照（v1.0.9 新增，v1.0.9 确认交互改进）
  if (args.revertSha) {
    try {
      const { restoreSnapshot, listAllSnapshots } = await import('@sofagent/core');
      const projectDir = process.cwd();

      // 列出可用快照供用户参考
      const snapshots = listAllSnapshots(projectDir);
      if (snapshots.length === 0) {
        console.error('❌ 没有可用的快照。请先运行审计以创建快照。');
        exit(1);
      }

      console.log('可用快照:');
      for (const s of snapshots) {
        console.log(`  ${s.shortSha}  ${s.timestamp}  (${s.fileCount} 个文件)`);
      }
      console.log('');

      // v1.0.9: 使用 confirm() 辅助函数（非 TTY 自动确认）
      const confirmed = await confirm(`⚠️  即将恢复到快照 ${args.revertSha}。此操作将覆盖当前文件。确认？`);
      if (!confirmed) {
        console.log('已取消恢复操作。');
        exit(0);
      }

      const restored = restoreSnapshot(projectDir, args.revertSha);
      console.log(`✅ 已恢复 ${restored.length} 个文件:`);
      for (const f of restored) {
        console.log(`  → ${f}`);
      }
      console.log('');
      console.log('💡 建议运行 npm run build && npm test 验证恢复结果。');
    } catch (err) {
      console.error(`❌ 恢复失败: ${(err as Error).message}`);
      exit(1);
    }
    return;
  }

  // 1. 检查 git 仓库
  if (!isInGitRepo()) {
    if (args.json) {
      console.log(JSON.stringify({ exitCode: 2, rules: [], error: 'NOT_A_GIT_REPO' }, null, 2));
    } else {
      console.error('错误：当前目录不在 git 仓库内。sofagent-audit 需要 git 仓库才能运行。');
    }
    exit(2);
  }

  // 2. 解析 git diff（--cached 模式用于首次提交场景）
  let diffFiles: DiffFile[];
  try {
    diffFiles = args.cached ? parseStagedDiff() : parseDiff(args.diffRange);
  } catch {
    // v1.2.9: diff 解析本身报错（如无效 range）——git fatal 不能当"无变更"处理
    if (args.json) {
      console.log(JSON.stringify({ exitCode: 2, rules: [], error: 'DIFF_PARSE_FAILED' }, null, 2));
    } else {
      console.error(`❌ diff 获取失败——range 可能无效: ${args.diffRange ?? args.cached ? '--cached' : '(空)'}`);
      console.error('  示例: sofagent-audit --diff origin/main..HEAD');
    }
    exit(2);
  }

  // v1.2.9: diff 为空时二次验证——如果 --diff range 无效（git 报 fatal），parseDiff 可能返回空数组
  if (!args.cached && diffFiles.length === 0 && args.diffRange) {
    try {
      execFileSync('git', ['diff', '--exit-code', args.diffRange], { stdio: 'pipe' });
    } catch (err) {
      const rawStderr = (err as { stderr?: string | Buffer }).stderr;
      const stderr = typeof rawStderr === 'string' ? rawStderr
        : Buffer.isBuffer(rawStderr) ? rawStderr.toString('utf-8')
        : '';
      // git diff --exit-code 对"无变更"返回 1，对"range 无效"返回 128+不同 stderr
      if (stderr.includes('fatal') || stderr.includes('not a valid') || stderr.includes('unknown revision')) {
        if (args.json) {
          console.log(JSON.stringify({ exitCode: 2, rules: [], error: 'INVALID_DIFF_RANGE' }, null, 2));
        } else {
          console.error(`❌ diff range 无效: ${args.diffRange}`);
          console.error(`  git 报错: ${stderr.trim()}`);
        }
        exit(2);
      }
    }
  }

  if (diffFiles.length === 0) {
    if (args.json) {
      console.log(JSON.stringify({ exitCode: 0, rules: [] }, null, 2));
    } else {
      console.log('✅ 没有文件变更，无需审计。');
    }
    exit(0);
  }

  // 超大 diff（>5MB）被跳过内容审计的文件 → 注入 WARN 级发现，消除审计盲区。
  // 作为一条合成 WARN 规则追加到审计结果，使其在 text/table 报告与 --json 输出中
  // 均可见。WARN 不拦截提交（不改 exit code 判定），但明确告知「这些文件未被审计」。
  const oversizedPaths = diffFiles.filter((f) => f.oversized).map((f) => f.path);

  // 2. 读取任务日志
  const logEntries = checkLogs();

  // 3. 读取 commit message（优先级：--commit-msg 完整消息 > --task subject > COMMIT_EDITMSG > git log > 空）
  let commitMsg = args.commitMsgArg || args.task || '';

  if (!commitMsg) {
    try {
      const gitDirResult = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf-8' }).trim();
      const gitDir = gitDirResult.startsWith('/') ? gitDirResult : join(process.cwd(), gitDirResult);
      const editMsgPath = join(gitDir, 'COMMIT_EDITMSG');
      if (existsSync(editMsgPath)) {
        commitMsg = readFileSync(editMsgPath, 'utf-8').trim();
      }
    } catch {
      // git rev-parse 失败（非 git 仓库），留空
    }
  }

  // 最终 fallback：git log
  // v1.0.9: 从 --diff range 提取终点 commit，而非始终取 HEAD
  if (!commitMsg) {
    try {
      // v1.0.9 T02：从 --diff range 提取**终点** commit，而非始终取 HEAD
      const refArg = resolveDiffEndpoint(args.diffRange);
      commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B', refArg], { encoding: 'utf-8' }).trim();
    } catch {
      // 完全无法获取，保持空
    }
  }

  // P2 安全：过滤 commit message 中的 ANSI 转义码（防止注入审计报告输出）
  if (commitMsg) {
    // eslint-disable-next-line no-control-regex
    commitMsg = commitMsg.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  // 4. 加载审计配置（三级 fallback）——YAML 语法错误时按模式处理
  let config;
  try {
    config = loadConfig(undefined, args.strict);
  } catch (err) {
    if (err instanceof ConfigSignatureError) {
      // 验签失败 = fail-closed：无论何种模式都阻断（exit 2），唯一行动指引已在错误消息内
      const msg = `config.yml 签名校验失败: ${err.message}`;
      if (args.json) {
        console.log(JSON.stringify({ exitCode: 2, rules: [], error: 'CONFIG_SIGNATURE_ERROR', detail: msg }, null, 2));
      } else {
        console.error(`❌ ${msg}`);
      }
      exit(2);
    }
    if (err instanceof ConfigLoadError || err instanceof ConfigParseError) {
      const msg = `config.yml 解析错误: ${err.message}`;
      if (args.json) {
        console.log(JSON.stringify({ exitCode: args.strict ? 2 : 1, rules: [], error: 'CONFIG_PARSE_ERROR', detail: msg }, null, 2));
        exit(args.strict ? 2 : 1);
      }
      console.error(`❌ ${msg}`);
      // --strict / --ci 模式下阻断（exit 2），默认模式 WARN（exit 1）
      exit(args.strict ? 2 : 1);
    }
    throw err;
  }

  // 4.3 配置完整性检查：检测 config.yml 中是否关闭了规则（防篡改）
  // v1.2.9: 阈值从 >3 改为 >0——关闭任意条规则即输出显眼告警（不阻断，保持灵活性但确保可追溯）
  let configDisabledTooMany = false;
  if (config?.rules) {
    // v1.2.5: 追加 a20-a23（A20-A23 新增安全红线规则）
    // v1.4.4: 规则清单改从 rules 注册表派生（单一事实源）——新增规则自动纳入，无需再手动同步
    // `[0] ?? ''`：split 恒返回至少一项，但 noUncheckedIndexedAccess 下标类型为 string | undefined，
    // 显式兜底让 tsc 通过（npm run check 此前因此长期 EXIT=1）
    const ALL_RULE_KEYS = [...defaultRules, ...extendedRules].map((r) => r.name.split(' ')[0]?.toLowerCase() ?? '');
    // 基线规则集合与 core 共享常量统一（单一事实源）
    const BASELINE_KEYS = new Set<string>(BASELINE_RULE_KEYS);
    const disabledEntries = Object.entries(config.rules)
      .filter(([key, val]) => val === false && !BASELINE_KEYS.has(key) && ALL_RULE_KEYS.includes(key));
    const disabledCount = disabledEntries.length;
    const totalActive = ALL_RULE_KEYS.length;

    // v1.2.9: 关闭任意条规则即告警（不再等 >3），并记录到 history.jsonl 留下痕迹
    if (disabledCount > 0) {
      const disabledList = disabledEntries.map(([key]) => key).join(', ');
      console.warn(`\u26a0\ufe0f  当前有 ${disabledCount} 条规则被关闭（${disabledList}）。如果这不是你主动配置的，config.yml 可能已被篡改。`);
      // 关闭规则时在 history.jsonl 记录一条 audit log（rule_disabled 事件）
      // v1.3.9 #38: 路径解析与主审计历史统一——此前用 resolveAuditDir()（只感知
      //   SOFAGENT_HOME），隔离环境（SOFAGENT_DATA=/tmp/x）下事件写进默认链
      //   ~/.sofagent/data/audit/history.jsonl，污染真实数据目录。
      //   改用 getHistoryFilePath()（显式 dataDir > SOFAGENT_DATA > 默认链），
      //   与 loadHistory/appendHistory 同一套解析口径。
      try {
        const { getHistoryFilePath } = await import('@sofagent/core');
        const { appendFileSync, mkdirSync, existsSync: dirExists } = await import('fs');
        const { dirname: pathDirname } = await import('path');
        const historyFile = getHistoryFilePath();
        const historyDir = pathDirname(historyFile);
        if (!dirExists(historyDir)) {
          mkdirSync(historyDir, { recursive: true });
        }
        const record = JSON.stringify({
          timestamp: new Date().toISOString(),
          event: 'rule_disabled',
          disabledRules: disabledList,
          count: disabledCount,
        });
        appendFileSync(historyFile, record + '\n');
      } catch {
        // 记录失败不影响核心审计流程
      }
    }

    if (disabledCount > 3) {
      // 非基线规则全关 → 阻断（exit 1 WARN），不再「全绿 PASS」
      configDisabledTooMany = true;
    }
  }

  // 4.5 权限检查（v1.0.8：权限作用域化）
  const permission = loadPermission(process.cwd());
  const permissionDenials: string[] = [];
  for (const file of diffFiles) {
    const check = checkPermission(permission, file.path, 'write');
    if (!check.allowed) {
      permissionDenials.push(`${file.path}: ${check.matchedRule || 'denied'}`);
    }
  }

  // 5. 运行规则
  // v1.4.5 T5: 改经 runRulesMonitored——审计引擎超时自动降级（full→rules-only→minimal），
  // 降级事实写审计日志（FALLBACK_DEGRADE）并在规则列表注入 DEGRADATION_NOTICE WARN
  const { runRulesMonitored } = await import('./rules/runner');
  const results = runRulesMonitored(diffFiles, logEntries, args.task, args.strict, args.silent, commitMsg || undefined, config, undefined, args.gb48000);

  // v1.2.9 (⑧-2): --ruleset / --ruleset-path → 运行 JSON 规则集（叠加在内置规则之上）
  if (args.ruleset || args.rulesetPath) {
    try {
      const { loadRuleset, loadRulesetFromPath, runRulesetRules, computeExitCode } = require('./ruleset-loader');
      let ruleset;
      if (args.rulesetPath) {
        ruleset = args.ruleset
          ? loadRulesetFromPath(args.rulesetPath, args.ruleset)
          : loadRulesetFromPath(args.rulesetPath);
      } else {
        ruleset = loadRuleset(args.ruleset);
      }
      const rulesetResults = runRulesetRules(diffFiles, ruleset);
      results.rules.push(...rulesetResults);
      // 重新计算 exitCode（取内置审计和规则集审计中的最高严重级别）
      const rulesetExit = computeExitCode(rulesetResults);
      if (rulesetExit > results.exitCode) {
        results.exitCode = rulesetExit;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ 规则集加载失败: ${msg}`);
      exit(1);
    }
  }

  // 非基线规则全关（disabledCount>3）→ 阻断（exit 1 WARN）
  if (configDisabledTooMany && results.exitCode === 0) {
    results.exitCode = 1;
  }

  // 6. 输出结果
  if (permissionDenials.length > 0) {
    results.permissionDenials = permissionDenials;
  }

  // 超大 diff 审计盲区 → 注入 WARN 级发现（报告中可见，不拦截提交）。
  // text/table 人类可读格式：打印醒目 WARN 行；--json 输出绝不掺入（保持机器可读纯净）。
  // P1-A6: 安全敏感文件名模式（.env/secret/key/credential）在 oversized 场景升级为 FAIL（exit 2）
  const SENSITIVE_FILE_RE = /\.(env|envrc|pfx|p12|key|pem|secret|credential)s?(\.|$)/i;
  const oversizedSensitivePaths = oversizedPaths.filter((p) => SENSITIVE_FILE_RE.test(p));
  const oversizedNormalPaths = oversizedPaths.filter((p) => !SENSITIVE_FILE_RE.test(p));

  if (oversizedPaths.length > 0 && !args.json) {
    console.log('');
    // 安全敏感文件 → FAIL 级别告警（堵住「故意构造超大 diff 藏密钥」攻击路径）
    // v1.3.9（十二）：spill 落盘后内容已扫描至 64MB 读回上限——oversized 现在表示
    // 「超上限截断」而非「跳过扫描」；全量内容经 spillFile locator 可按需取回
    if (oversizedSensitivePaths.length > 0) {
      console.log(`  🔴 [sofagent] 审计盲区（FAIL）：以下 ${oversizedSensitivePaths.length} 个安全敏感文件的 diff 超过 64MB 读回上限，已截断扫描且阻止提交（全量内容经 spill 落盘可取回）`);
      for (const p of oversizedSensitivePaths) {
        console.log(`       - ${p}（文件名匹配密钥模式）`);
      }
      console.log('       安全敏感文件（.env/secret/key/credential）在 oversized 场景升级为 FAIL——请确认无密钥泄漏后缩减文件大小再提交。');
    }
    // 普通文件 → WARN（保持 F-22 有意设计）
    if (oversizedNormalPaths.length > 0) {
      console.log(`  ⚠️  [sofagent] 审计盲区（WARN）：以下 ${oversizedNormalPaths.length} 个文件的 diff 超过 64MB 读回上限，已截断扫描（spill 落盘 locator 可按需取回全量内容）`);
      for (const p of oversizedNormalPaths) {
        console.log(`       - ${p}`);
      }
      console.log('       可能为二进制/lock/minified 文件，请人工确认这些文件无密钥泄漏/越界改动。');
    }
  }
  // 超大 diff 普通文件 → exit=1（WARN 而非 0），「13 项检查 PASS」不再误导
  if (oversizedNormalPaths.length > 0 && results.exitCode === 0) {
    results.exitCode = 1;
  }
  // P1-A6: 超大 diff 安全敏感文件 → exit=2（FAIL，阻止提交）
  if (oversizedSensitivePaths.length > 0) {
    results.exitCode = 2;
  }

  // v1.2.9 (⑧-3): --format github → 输出 GitHub Annotations 格式
  if (args.format === 'github') {
    const { generateGithubOutput } = require('./formatters/github-formatter');
    const ruleCount = results.rules.length;
    const output = generateGithubOutput(results, ruleCount);
    console.log(output);
    exit(results.exitCode as 0 | 1 | 2);
  }

  printResults(results, diffFiles, args.json, args.ci, args.silent);

  // v1.4.4 交付三: 成本审计维度（opt-in WARN only——不配 budget 不审计；
  // 不进 A1-A23 规则体系，exitCode 不变；铁律 12：WARN 不拦截任务执行）
  if (!args.json) {
    const costBudget = config.cost?.budget;
    if (costBudget && (costBudget.maxTokensPerRun || costBudget.maxCostPerDay)) {
      try {
        // v1.4.4 G-05: 数据目录解析收编进 data-paths SSOT getDataDir()（与 getHistoryFilePath
        // 同链：SOFAGENT_DATA > SOFAGENT_HOME/data，消灭 homedir 硬编码回退）
        const { getDataDir } = require('@sofagent/core') as typeof import('@sofagent/core');
        const costDataDir = getDataDir();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { runCostAudit, loadWorklogSlice } = require('./cost-audit');
        const costFindings = runCostAudit({
          worklog: loadWorklogSlice(costDataDir),
          budget: costBudget,
        });
        for (const f of costFindings) {
          console.log(`⚠️ [sofagent] 成本告警 [${f.dimension}]: ${f.message}`);
        }
      } catch {
        // 成本审计是附带维度，异常静默降级（不阻断主审计）
      }
    }
  }

  // v1.3.9: 工作区垃圾残留扫描（WARN 不阻断——附带的巡检能力，防「实验残留」积压）
  if (!args.json) {
    const wsScan = scanWorkspace();
    for (const line of formatWorkspaceScan(wsScan)) {
      console.log(line);
    }
  }

  // 7. webhook 推送（fire-and-forget，配置了 webhook 时 PASS/WARN/FAIL 三态都推送）
  // v1.4.4: 优先 CLI --webhook/--webhook-url，回退 config.yml audit.webhook.{platform,url}，
  //         再回退环境变量 SOFAGENT_WEBHOOK_URL（已在 parseArgs 初始化 webhookUrl）。
  //         修复场景：commit-msg hook 不传 CLI webhook 参数，用户在 config.yml 配了 webhook 也不生效。
  const webhookPlatform = args.webhook || config.webhook?.platform;
  const webhookUrlFinal = args.webhookUrl || config.webhook?.url;
  if (webhookPlatform && webhookUrlFinal) {
    try {
      // v1.2.9 编译自定义脱敏正则
      // v1.4.5 T8: 编译复用 ruleset-loader 的 compileSanitizePattern（含
      // detectReDoSPattern 静态检测 + 100ms 运行时对抗测试）——此前直接
      // new RegExp(p.pattern)，config.yml 塞入 (a+)+ 类邪恶 pattern 可让
      // 每次 webhook 推送的正则替换挂死审计进程（审计工具被配置反杀）。
      const customSanitizePatterns = config.sanitizePatterns
        ? config.sanitizePatterns
            .map((p) => {
              const compiled = compileSanitizePattern(p.pattern, p.replacement);
              return compiled; // null = 无效/ReDoS 风险正则——剔除该条，其余规则照常推送
            })
            .filter((p): p is { pattern: RegExp; replacement: string } => p !== null)
        : undefined;
      const pushed = await pushAuditResult({
        platform: webhookPlatform,
        url: webhookUrlFinal,
        task: args.task,
        rules: results.rules,
        exitCode: results.exitCode,
      }, customSanitizePatterns);
      if (!pushed) {
        console.warn('⚠️  webhook 推送失败或无需推送（不影响审计结果）。');
      }
    } catch {
      console.warn('⚠️  webhook 推送异常（不影响审计结果）。');
    }
  }

  // 8. 写入审计历史（JSONL 持久化，用于根因分析和回归验证）
  let commitSha: string | undefined;
  let parentSha: string | undefined;
  let isPreCommitPhase = false;
  try {
    // 获取当前 HEAD SHA
    // 注：isInGitRepo() 已在入口处确认处于 git 仓库，因此 rev-parse HEAD 失败
    // 只可能是「unborn HEAD」（首次提交，尚无任何 commit）——而非"非 git 环境"。
    // 此时用空树 SHA 作为 diff 基准（git hash-object -t tree /dev/null），
    // 给出准确提示，避免误导性的"非 git 环境"警告。
    try {
      commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      // 计算空树 SHA 作为首次提交的 diff 基准（失败时回退到众所周知的常量）
      try {
        commitSha = execFileSync('git', ['hash-object', '-t', 'tree', '/dev/null'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      } catch {
        commitSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // 空树 SHA-1 常量
      }
      console.warn('[sofagent] 提示：首次提交（unborn HEAD），对比空树进行审计');
    }

    // v1.2.9 commit-msg hook 场景下（--commit-msg 由 hook 传入），审计运行在
    // commit 对象生成之前——此刻 git rev-parse HEAD 得到的是新提交的**父提交** SHA，
    // 而非正在创建的提交。若直接记入 commitSha，追溯链整体错位一个 commit，
    // --verify-commit 按 SHA 匹配必然张冠李戴（100% 误报）。
    // 修复：hook 场景把「审计时 HEAD」如实记入 parentSha，标记 commitPhase='pre-commit'；
    // commitSha 不伪造（留空）。--verify-commit / post-commit 对账按 parentSha fallback 匹配。
    // 手动 --diff <range>（无 --commit-msg）保持原语义：HEAD 已存在，commitSha = 当前 HEAD。
    if (args.commitMsgArg !== undefined) {
      isPreCommitPhase = true;
      parentSha = commitSha;
      commitSha = undefined;
    }

    // A4 研读落地：Action Governance 审计 5 字段 schema + 决策溯源组
    // 发起方 = git 提交作者；非 git 环境 / 文件系统审计下退化为 unknown（不伪造）
    // v1.3.9 B9 修复：git log -1 在 unborn HEAD（首次 commit，hook 运行于 commit 对象生成前）
    // 时失败 → 配置齐全也报「作者获取失败」。改用配置来源（不依赖 commit 历史）：
    //   1. git var GIT_AUTHOR_IDENT（配置链解析出的完整身份，含 name + email）
    //   2. git config user.name（兜底）
    let actor = 'unknown';
    try {
      const ident = execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      // 格式："Name <email> timestamp tz"——取 < 之前的 name 部分
      const name = ident.split('<')[0]?.trim();
      if (name) actor = name;
    } catch {
      try {
        const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (name) actor = name;
      } catch {
        // git 不可用 / 未配置身份：审计正常运行，仅 actor 退化为 unknown
        console.warn('[sofagent] 警告：git 作者获取失败，actor 标记为 unknown');
      }
    }
    const govTimestamp = new Date().toISOString();
    // 目标实体 = 本次变更涉及的文件路径（最多取前 20 个，避免记录超长）
    const targetEntity = diffFiles.length > 0
      ? diffFiles.slice(0, 20).map((f) => f.path).join('; ')
      : 'no-file-change';

    const historyEntry: AuditHistoryEntry = {
      timestamp: govTimestamp,
      diffRange: args.diffRange,
      task: args.task,
      exitCode: results.exitCode,
      ruleResults: results.rules,
      diffFileCount: diffFiles.length,
      commitMsg: commitMsg || undefined,
      commitSha,
      // v1.2.9 pre-commit 阶段记录父提交 SHA（= 审计时 HEAD），
      // --verify-commit / post-commit 对账按此 fallback 匹配。旧记录无此字段。
      parentSha,
      commitPhase: isPreCommitPhase ? 'pre-commit' : undefined,
      engine: `sofagent-audit v${VERSION}`,
      actionGovernance: {
        actor,
        timestamp: govTimestamp,
        targetEntity,
        // v1.4.4 交付十三：beforeAfter 结构化摘要回填——从 diff 提取前/后值（截断至 200 字符 + 脱敏，
        // diff 原文不进 history.jsonl；A2/A9 脱敏语义不变）
        beforeAfter: buildBeforeAfterSummary(diffFiles),
        context: args.task || commitMsg || undefined,
        decisionProvenance: {
          who: actor,
          when: govTimestamp,
          // v1.4.4 交付十三：whichDataVersion 契约就位——FDE 知识库版本化未就绪时留空（不报错），
          // 版本化落地后从 knowledge 版本元数据回填
          whichDataVersion: undefined,
          whichApp: `sofagent-audit v${VERSION}`,
        },
      },
    };
    appendHistory(historyEntry);
  } catch {
    // 历史写入失败不影响审计结果
    process.stderr.write('[sofagent-audit] 警告: 审计历史写入失败，跳过（不影响审计结果）\n');
  }

  // 8.5 session 产物（P0：审计结果 session 可见性）——v1.3.9
  if (!args.noSession) {
    try {
      const report = buildSessionReport(results, diffFiles, { task: args.task, commitSha });
      const { jsonPath, mdPath } = writeSessionReport(report);
      // 不打扰终端，但 stderr 轻量提示产物位置（非 --ci 时）
      if (!args.ci && !args.silent) {
        process.stderr.write(`[sofagent] session 报告已写入: ${jsonPath}\n`);
      }
    } catch {
      process.stderr.write('[sofagent-audit] 警告: session 报告写入失败，跳过（不影响审计结果）\n');
    }
  }

  // 审计通过（PASS）后自动创建 shadow repo 快照，供 --timeline/--revert 使用
  // 设计原则：只有 PASS 才快照（WARN/FAIL 不快照，符合「审计通过后自动快照」契约）
  // v1.4.4：snapshot helpers 已从 @sofagent/daemon 迁移到 @sofagent/core，循环依赖已消除
  // 拦截后也存 snapshot——拦截记录比通过记录更有审计价值（--timeline 应可见被拦截的变更）
  if (isInGitRepo()) {
    try {
      if (!hasShadowRepo(process.cwd())) {
        createShadowRepo(process.cwd());
      }
      commitSnapshot(process.cwd());
    } catch {
      // 快照失败不影响审计结果
      process.stderr.write('[sofagent-audit] 警告: 快照创建失败，跳过（不影响审计结果）\n');
    }
  }

  // think.md 生成由 @sofagent/think 的 generateThinkEntry 负责（审计后反思生成器），
  // 其内部经 @sofagent/core 的 appendThinkEntry 契约写入，保证 append-only 不变量。
  // audit 包不直接写 think.md（避免反向依赖 think 生成器）。

  // v1.4.4 #15: WARN 退出码可配——默认 WARN→exit 1（安全优先）。
  // --warn-as-error: WARN→exit 2（CI 阻断，要求零警告）
  // --warn-as-info: WARN→exit 0（CI 不阻断，仅信息性）
  // 两者互斥时 --warn-as-error 优先（安全优先）。仅影响 WARN（exit 1）场景，不改 FAIL（exit 2）。
  // --strict 已覆盖「WARN→2」语义，--warn-as-error 与之等价但语义更明确。
  if (results.exitCode === 1) {
    if (args.warnAsError) {
      results.exitCode = 2;
    } else if (args.warnAsInfo) {
      results.exitCode = 0;
    }
  }

  exit(results.exitCode as 0 | 1 | 2);
}

// ============================================================
// CJK 宽度计算——终端中文字符占 2 列，ASCII 占 1 列
// padEnd 按字符数 pad，会导致 banner 右边框错位
// ============================================================

function isCJK(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||  // CJK Unified Ideographs
    (code >= 0x3000 && code <= 0x303f) ||  // CJK Symbols and Punctuation
    (code >= 0xff00 && code <= 0xffef)     // Fullwidth Forms
  );
}

function visualWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += isCJK(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return w;
}

function padVisual(str: string, width: number): string {
  const pad = width - visualWidth(str);
  return pad > 0 ? str + ' '.repeat(pad) : str;
}

// ============================================================
// banner 辅助——生成带左右边框的行
// ============================================================

const BANNER_WIDTH = 44; // ╔══ ... ══╗ 内部宽度

function bannerTop(): string {
  return '╔' + '═'.repeat(BANNER_WIDTH) + '╗';
}

function bannerBottom(): string {
  return '╚' + '═'.repeat(BANNER_WIDTH) + '╝';
}

function bannerLine(text: string): string {
  return '║ ' + padVisual(text, BANNER_WIDTH - 2) + ' ║';
}

// ============================================================
// 历史拦截统计
// ============================================================

function getHistoryStats(): { total: number; thisMonth: number } | null {
  try {
    const history = loadHistory(500);
    if (history.length === 0) return null;

    const now = new Date();
    const yearMonth = now.toISOString().slice(0, 7); // YYYY-MM
    const thisMonth = history.filter((e) => e.timestamp.startsWith(yearMonth)).length;

    return { total: history.length, thisMonth };
  } catch {
    // history 文件损坏/不可读——统计是展示性信息，降级 null 不影响审计
    return null;
  }
}

export function printResults(results: AuditResult, diffFiles: DiffFile[], json: boolean, ci: boolean, silent?: boolean): void {
  // JSON 输出模式——输出结构化 JSON，适合 CI 系统解析
  if (json) {
    // JSON 顶层补产品签名——此前只有 exitCode+rules，CI/CD 无法区分 sofagent 产出
    console.log(JSON.stringify({
      engine: 'sofagent-audit',
      version: VERSION,
      verdict: results.exitCode === 0 ? 'PASS' : results.exitCode === 1 ? 'WARN' : 'FAIL',
      timestamp: new Date().toISOString(),
      signature: productSignature(results.exitCode, results.rules.length, defaultRules.length + extendedRules.length),
      exitCode: results.exitCode,
      rules: results.rules,
    }, null, 2));
    return;
  }

  // 静默 / CI 模式——只抑制输出，不改 exit code 判定
  if (ci || silent) {
    // 产品签名（text 人类可读输出头部；--json 已在上方提前 return，绝不加签名）
    console.log(productSignature(results.exitCode, results.rules.length, defaultRules.length + extendedRules.length));
    // ★ v1.4.4: 无条件向 stdout 输出一行结论（session 可见性核心）
    const c = results.exitCode;
    const failN = results.rules.filter((r) => r.status === 'FAIL').length;
    const warnN = results.rules.filter((r) => r.status === 'WARN').length;
    const n = results.rules.length;
    const defaultCnt = defaultRules.length;
    const extendedCnt = extendedRules.length;
    const totalCnt = defaultCnt + extendedCnt;
    const line =
      c === 0
        ? `✅ [sofagent] 审计通过 · ${n} 项检查 · ${totalCnt} 条规则 (${defaultCnt} 默认 + ${extendedCnt} 扩展) · exit 0`
        : c === 1
          ? `⚠️ [sofagent] 审计 ${warnN} 警告 · exit 1`
          : `❌ [sofagent] 审计拦截 ${failN} 违规 · exit 2`;
    console.log(line);

    const problems = results.rules.filter((r) => r.status !== 'PASS' && r.status !== 'SKIPPED');
    if (problems.length === 0) {
      // v1.2.9: — PASS 时即使 --ci 也输出极简签名到 stderr（防遗忘装了 sofagent）
      // 口径统一（run-02 P1-5）：本跑检查数与注册规则数分列，不再混用「N 条规则」
      const n = results.rules.length;
      const dCnt = defaultRules.length;
      const eCnt = extendedRules.length;
      const tCnt = dCnt + eCnt;
      const passLine = n === tCnt
        ? `✅ [sofagent] 审计通过 · ${tCnt} 条规则 (${dCnt} 默认 + ${eCnt} 扩展)`
        : `✅ [sofagent] 审计通过 · ${n} 项检查 · ${tCnt} 条规则 (${dCnt} 默认 + ${eCnt} 扩展)`;
      process.stderr.write(passLine + '\n');
      return;
    }

    for (const rule of problems) {
      const icon = rule.status === 'FAIL' ? '❌' : '⚠️';
      const classTag = rule.ruleClass === '业务底线' ? '[底线]' : rule.ruleClass === '能力拐杖' ? '[拐杖]' : '';
      for (const detail of rule.details) {
        console.log(`${icon} [sofagent] ${rule.name} ${classTag}: ${detail}`);
      }
      // 修复建议
      const suggestion = getFixSuggestion(rule.name);
      if (suggestion) {
        console.log(`   怎么修: ${suggestion}`);
      }
    }
    console.log(`\n[sofagent] 判定: ${results.exitCode === 1 ? '⚠️  WARN' : '❌ FAIL'} (exit ${results.exitCode})`);
    return;
  }

  // ===== v1.0.9 可视化输出 =====

  const exitCode = results.exitCode;
  const totalRules = results.rules.length;
  const failCount = results.rules.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.rules.filter((r) => r.status === 'WARN').length;
  const skipCount = results.rules.filter((r) => r.status === 'SKIPPED').length;
  const passCount = totalRules - failCount - warnCount - skipCount;

  // banner 状态
  const statusLabel = exitCode === 0 ? '✅ [sofagent] 审计通过' : exitCode === 1 ? '⚠️  [sofagent] 有警告' : '❌ [sofagent] 审计拦截';
  const actionLabel = exitCode === 0 ? '可以放心提交' : exitCode === 1 ? '建议修复后再提交' : '提交已被阻止';
  const issueWord = failCount > 0 ? `${failCount} 违规` : warnCount > 0 ? `${warnCount} 警告` : '0 违规';

  console.log('');
  // 口径统一（run-02 P1-5）：defaultCnt/extendedCnt 前置计算——签名行与明细行
  // 同源同口径「N 项检查 · M 条规则 (D 默认 + E 扩展)」，quick 模式不再出现
  // 横幅「17 规则」与明细「24 条规则」自相矛盾。
  const defaultCnt = defaultRules.length;
  const extendedCnt = extendedRules.length;
  const totalCnt = defaultCnt + extendedCnt;
  // 产品签名行（人类可读输出头部，FAIL 拦截时醒目，让用户知道是 sofagent 拦的）
  console.log('  ' + productSignature(exitCode, totalRules, totalCnt));
  console.log(bannerTop());
  console.log(bannerLine(`sofagent-audit · FDE Harness · v${VERSION}`));
  console.log(bannerLine(`扫描 ${diffFiles.length} 文件 · ${totalRules} 项检查 · ${totalCnt} 条规则 (${defaultCnt} 默认 + ${extendedCnt} 扩展) · ${issueWord}`));
  console.log(bannerLine(`${statusLabel}  ·  ${actionLabel}`));
  console.log(bannerBottom());

  // 违规/警告详情
  const problems = results.rules.filter((r) => r.status !== 'PASS');
  if (problems.length > 0) {
    console.log('');
    for (const rule of problems) {
      const icon = rule.status === 'FAIL' ? '❌' : '⚠️';
      const classTag = rule.ruleClass === '业务底线' ? '[底线]' : rule.ruleClass === '能力拐杖' ? '[拐杖]' : '';
      for (const detail of rule.details) {
        console.log(`  ${icon} [sofagent] ${rule.name} ${classTag}: ${detail}`);
        // 修复建议（v1.0.9 新增）
        const suggestion = getFixSuggestion(rule.name);
        if (suggestion) {
          console.log(`     怎么修: ${suggestion}`);
        }
      }
    }
  }

  // 规则网格——一行展示全部规则状态
  console.log('');
  const gridParts = results.rules.map((r) => {
    const num = r.number >= 200 ? `E${r.number - 200}` : `A${r.number}`;
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : r.status === 'SKIPPED' ? '⏭️' : '❌';
    return `${num} ${icon}`;
  });
  // 分两行避免太长
  const half = Math.ceil(gridParts.length / 2);
  console.log(`  审计规则   ${gridParts.slice(0, half).join('  ')}`);
  if (gridParts.length > half) {
    console.log(`             ${gridParts.slice(half).join('  ')}`);
  }

  // 扩展规则状态
  if (!results.rules.some((r) => r.number > 11)) {
    // v1.3.9 P2-23: E3 已并入 A11（不滥资源），不再单独列出，避免用户误以为存在 E3 规则
    console.log('  扩展规则   未启用（E1 E2 E4 + A14-A17，config 中开启）');
  }

  // 历史拦截统计(loadHistory(500) 是"最近 500 条"截断语义，不是全量统计——
  // 措辞明确"最近"，避免被误读为历史全量拦截数）
  const stats = getHistoryStats();
  if (stats) {
    console.log('');
    console.log(`  历史拦截：最近 ${stats.total} 条审计记录（本月 ${stats.thisMonth} 条；loadHistory 截断 500 条上限）`);
  }

  // 判定行
  console.log('');
  const judgeIcon = exitCode === 0 ? '✅ PASS' : exitCode === 1 ? '⚠️  WARN (有警告)' : '❌ FAIL (有违规)';
  console.log(`  [sofagent] 判定: ${judgeIcon} · exit code ${exitCode}`);
  const ruleSummary = exitCode === 0
    ? `${results.rules.length} 条规则全部通过`
    : `${results.rules.length} 条规则已完成检测`;
  console.log(`  审计引擎: sofagent-audit v${VERSION} · ${ruleSummary}`);

  // v1.0.8: PASS 时向 stderr 输出轻量签名行（防遗忘装了 sofagent）
  if (exitCode === 0) {
    process.stderr.write(`✅ sofagent-audit v${VERSION} · ${results.rules.length} 条规则全部通过\n`);
    // v1.3.9+: PASS 时补行动指示——消除"PASS 无感"（审计通过与失败都带 [sofagent]，用户看不出持续感）
    console.log('  下次 commit 也将自动审计——无需任何操作，持续守护中');
  }

  // 失败时输出"下一步"指引
  // 移除「git commit --no-verify」教程式绕过提示——审计引擎不应教用户关掉自己。
  // 如需临时跳过请咨询安全管理员并在 CI 侧补审。
  if (exitCode > 0) {
    console.log('');
    console.log('  ┌─ 下一步 ─────────────────────────────────────────────┐');
    console.log('  │ 1. 修复上述问题后重新 git add + git commit            │');
    console.log('  │ 2. 如确需临时跳过，请咨询安全管理员并在 CI 侧补审     │');
    console.log('  │ 3. 查看完整文档：sofagent-audit --help                │');
    console.log('  └──────────────────────────────────────────────────────┘');
  }

  console.log('');
}

// v1.4.4: 仅作为 CLI 入口时执行 main，避免被测试 import 时触发副作用（如 process.exit）
if (require.main === module) {
  main().catch((err) => {
    console.error('sofagent-audit 内部错误:', err.message);
    exit(2);
  });
}
