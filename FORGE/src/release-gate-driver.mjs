#!/usr/bin/env node
// ============================================================
// FORGE/src/release-gate-driver.mjs · FORGE release-gate-loop Driver
//
// 发版闸门循环编排层：V 阶段（5 步验证）+ F 阶段（verdict FAIL 时触发的修复链）。
// V 跑完出 PASS/FAIL。FAIL → F 链（f-diagnose → f-fix → f-audit，最多 3 轮）。
//
// 用法：
//   node FORGE/src/release-gate-driver.mjs --target v1.2.1 [--dry-run] [--skip-acceptance]
//   node FORGE/src/release-gate-driver.mjs --step <step> --target v1.2.1 [--run-dir <dir>]
//   node FORGE/src/release-gate-driver.mjs --help
//   <step> 可选: acceptance|regression|coverage|consolidate|verdict|f-diagnose|f-fix|f-audit
//
// 自 forks 为 worker：
//   node FORGE/src/release-gate-driver.mjs --worker --step <step> --run-dir <abs> --target <ver>
//
// 模型配置（V + F 双角色，v1.2.8）：
//   V（验证者）/ F（修复者）= glm-5.3（智谱 Coding Plan 订阅制，GLM_API_KEY，v1.4.1 起）
//   V = reviewer skill + REVIEWER_TOOLS（只读）· F = engineer skill + ENGINEER_TOOLS（可写代码）
//   f-audit = driver 步骤（role:null，不调 LLM，driver 直接跑 sofagent-audit）
//   历史选型：deepseek-v4-flash（v1.3.9 按量低成本档）→ glm-5.3（v1.4.1 切换）
//
// 与 fresh-eyes-driver 的差异：
//   - V+F 双角色（无 A/B 双盲），V 只读验证，F 读写修复
//   - V 单轮线性 5 步 → verdict → FAIL 时 F 链最多 3 轮收敛
//   - V 用 REVIEWER_TOOLS（只读），F 用 ENGINEER_TOOLS（可写）
// ============================================================

import { spawn, execSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, statSync,
  appendFileSync, readdirSync, copyFileSync, createWriteStream,
  openSync, closeSync, unlinkSync,
} from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// ── undici headersTimeout 对齐（run-13/14/15 三轮根因修复）───────────
// 现象：GLM-5.3-flash thinking 模式 + 大 payload（regression 证据 ~19KB）下，
// 首 token 前思考常超 300s。Node fetch（undici）默认 headersTimeout=300s 在
// SDK 超时（600s）之前掐线——「Request timed out ... waiting for response
// headers」。模型还在思考，连接先死（run-15 sub-progress 实测 954s 无 chunk
// 的洞 = 300s 掐线 ×2 次重试 + 开销）。
// 修法：全局 dispatcher 的 headers/body timeout 与 createModel 的 SDK
// timeout（600s）对齐。任何进程内 fetch/ChatOpenAI 请求统一生效。
try {
  const { Agent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 }));
} catch { /* undici 不可用（理论不发生——Node 18+ 内置））：维持默认，风险回到修复前 */ }

// v1.2.7 功能⑤：继承 driver-base 公共编排层
import { createForgeDriverBase, runPreflight, formatPreflightReport, resolveMaxConcurrency, checkDriverLiveness } from './driver-base.mjs';
import { createGateTools } from './gate-tools.mjs';

// 可见性：核心层 + 适配器（agent 无关 + 渐进适配）
import { createVisibility, EVENTS } from './visibility.mjs';

// L2：SubAgent 内部可观测（工具调用序列 + 模型推理心跳）
import { createProgressMiddleware } from './progress-middleware.mjs';

// 模块级引用——让 catch 块也能写可见性事件（失败场景覆盖）
let globalVisibility = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '../..');

// CJS interop — dist 产物是 CommonJS，.mjs 里用 createRequire 导入
const require = createRequire(import.meta.url);

// ─── 路径常量 ────────────────────────────────────────────────
const LOOP_DIR    = join(REPO_ROOT, 'FORGE/SKILL/release-gate-loop');
const PROMPTS_DIR = join(LOOP_DIR, 'prompts');
// runs 输出优先到 SOFAGENT_HOME/data/forge-runs/，
// fallback 到仓库内 data/forge-runs/（开发模式兼容）
const SOFAGENT_HOME = process.env.SOFAGENT_HOME || join(os.homedir(), '.sofagent');
const RUNS_DIR    = join(SOFAGENT_HOME, 'data', 'forge-runs');
const LEDGER_PATH = join(REPO_ROOT, 'FORGE/LEDGER.md');
const AGENTS_DIR  = join(REPO_ROOT, 'SKILL/agents');

// ─── 单角色模型配置（V = 验证者，从 FORGE/models/ 加载）──────
// V 用 glm-5.3（智谱 Coding Plan 订阅制，OpenAI 兼容接口，v1.4.1 起）。
// 换模型改 FORGE/models/profile.mjs 即可，不需要改 driver 代码。
import { resolveConfigs, resolvePricing } from '../models/index.mjs';
const MODEL_CONFIGS = resolveConfigs(AGENTS_DIR);

// ─── 模型定价（从 FORGE/models/ 加载）─────────────────────
// 单位：CNY per 1M tokens（百万 token 计价）
// 定价按当前 profile 模型（glm-5.3）字段估算成本，recordUsage 输出真实 cost_cny（非 null）。
const MODEL_PRICING = resolvePricing();

// ─── driver-base 公共编排层实例 ──────────────────────────
// v1.2.7 功能⑤：继承 driver-base，复用公共工具函数。
// release-gate-driver 保留自身的差异化逻辑（单角色 V、单轮线性串行、
// 预执行器、PASS/FAIL 裁决），公共工具函数（sliceMultiOutput 等）从 base 复用。
const base = createForgeDriverBase({
  driverName: 'release-gate',
  loopDir: LOOP_DIR,
  repoRoot: REPO_ROOT,
  modelConfigs: MODEL_CONFIGS,
  modelPricing: MODEL_PRICING,
});

// ─── v1.3.6 交付⑩：FORGE 隔离加固（run-07 事故根因修复，镜像 fresh-eyes）───
// driver 启动时在 runDir 内建 worktree 副本，worker 的文件写入/git 操作全落副本分支；
// run 结束（正常/异常/中止）teardown 清理，主仓 git status 全程干净。
// worker 子进程通过 FORGE_WORKTREE_ROOT 环境变量继承隔离副本路径（spawn 时注入）。
// 🔴 镜像漂移铁律：fresh-eyes 修过的隔离逻辑，release-gate 必须有对应实现。
let globalWorktree = process.env.FORGE_WORKTREE_ROOT
  ? { worktreeDir: process.env.FORGE_WORKTREE_ROOT }
  : null;
// driver 模式下 runDir 创建后赋值；worker 子进程不赋值（teardown 守卫——
// worktree 生命周期归 driver 进程所有，worker 退出不得清理）。
let globalRunDir = null;

// 安全 teardown——所有退出路径（正常/catch/uncaughtException）共用。
// 绝不抛错：teardown 自身失败只打日志，不掩盖原始退出原因。
function safeTeardownWorktree() {
  if (!globalWorktree || !globalRunDir) return;
  try {
    const r = base.teardownWorktree(globalRunDir);
    if (r.removed) console.log(`   worktree 清理 = 已移除（分支 ${r.branch ?? ''} 保留待人工 cherry-pick 回流）`);
  } catch (err) {
    console.warn(`   worktree 清理失败（不阻塞退出）: ${err.message}`);
  } finally {
    globalWorktree = null;
  }
}

// ─── 步骤定义（prompt / output / inputs / maxTokens）─────────────────────
// v1.2.8 功能⑤：从单角色 V 升级为 V + F 双角色 + audit gate
// V 步骤补加 role: 'V' 显式化（v1.2.7 无此字段）
// F 步骤为 v1.2.8 新增（LLM 步骤）
// f-audit 为 driver 步骤（role: null，不调 LLM，driver 直接执行 runAuditGate）
// maxTokens：步骤级输出 token 上限覆盖。未定义时回退到 MODEL_CONFIGS[role].maxTokens。
// consolidate 需合并 acceptance/regression/coverage 三份完整报告为单份 stage6-report，输出超长，
// 单独调高到 32000，避免顶格 16000 被截断生成不了合法报告（整轮降级根因）。
// ─── v1.2.9 功能①：acceptance 维度分片 ──────────────────────
// 把 acceptance-test.sh 的 N 个场景按 12 个维度分片，每片一个独立 worker 分析。
// 每个 worker 只分析分配到的场景编号范围（从 acceptance-raw.log 中提取），
// 产出 acceptance-sN.md，最后 acceptance-consolidate 合并为单份 acceptance.md。
//
// 分片策略：按场景编号均分（N / 12 个场景/片）。
// v1.3.0 修复：场景数硬编码 148 → 动态从 acceptance-test.sh 提取（与 check-test-count.sh 同口径），
// 防场景数增长后（S149+）超出分片范围导致新场景零分析。
const ACCEPTANCE_TOTAL_SCENARIOS = (() => {
  const scriptPath = join(__dirname, '../../FORGE/playbook/acceptance-test.sh');
  try {
    const s = readFileSync(scriptPath, 'utf8');
    const m = s.match(/^scenario (\d+)[a-z]? "/gm);
    const maxNum = m ? Math.max(...m.map(x => parseInt(x.match(/\d+/)[0], 10))) : 148;
    return maxNum;
  } catch { return 148; }
})();
const ACCEPTANCE_SHARD_COUNT = parseInt(process.env.FORGE_ACCEPTANCE_SHARDS || '12', 10);

/**
 * 计算每个分片负责的场景编号范围。
 * @returns {Array<{id:number, start:number, end:number}>}
 */
function computeAcceptanceShards() {
  const shards = [];
  const perShard = Math.ceil(ACCEPTANCE_TOTAL_SCENARIOS / ACCEPTANCE_SHARD_COUNT);
  for (let i = 0; i < ACCEPTANCE_SHARD_COUNT; i++) {
    const start = i * perShard + 1;
    const end = Math.min((i + 1) * perShard, ACCEPTANCE_TOTAL_SCENARIOS);
    if (start > ACCEPTANCE_TOTAL_SCENARIOS) break;
    shards.push({ id: i + 1, start, end });
  }
  return shards;
}

const ACCEPTANCE_SHARDS = computeAcceptanceShards();

/**
 * 动态生成 acceptance 分片步骤 + consolidate 步骤。
 * 替换原来的单个 acceptance 步骤。
 */
function buildAcceptanceSteps() {
  const steps = {};
  const shardInputs = [];
  for (const s of ACCEPTANCE_SHARDS) {
    steps[`acceptance-s${s.id}`] = {
      role: 'V',
      prompt: `acceptance-shard-${s.id}.md`,
      outputs: [`acceptance-s${s.id}.md`],
      inputs: [],
      shard: s,
      recursionLimit: 40,
    };
    shardInputs.push(`acceptance-s${s.id}.md`);
  }
  // consolidate：合并 12 份分片报告为单份 acceptance.md
  steps['acceptance-consolidate'] = {
    role: 'V',
    prompt: 'acceptance-consolidate.md',
    outputs: ['acceptance.md'],
    inputs: shardInputs,
    maxTokens: 16000,
  };
  return steps;
}

const STEPS = {
  // v1.2.9 功能①：acceptance 分片（12 个 shard worker + 1 个 consolidate）
  ...buildAcceptanceSteps(),
  'regression':  { role: 'V', prompt: 'regression.md',  outputs: ['regression.md'],  inputs: ['regression-precheck.json'], precheck: true },
  'coverage':    { role: 'V', prompt: 'coverage.md',    outputs: ['coverage.md'],    inputs: ['acceptance.md', 'coverage-precheck.json'], precheck: true },
  'consolidate': { role: 'V', prompt: 'consolidate.md', outputs: ['stage6-report.md'], inputs: ['acceptance.md', 'regression.md', 'coverage.md'], maxTokens: 32000 },
  'verdict':     { role: 'V', prompt: 'verdict.md',     outputs: ['verdict.md'],     inputs: ['stage6-report.md'] },
  // v1.2.8 新增 F 步骤（LLM 步骤——verdict FAIL 后触发）
  'f-diagnose':  { role: 'F', prompt: 'f-diagnose.md',  outputs: ['fix-plan.md'],     inputs: ['verdict.md'] },
  'f-fix':       { role: 'F', prompt: 'f-fix.md',       outputs: ['fix-summary.md'],  inputs: ['fix-plan.md', 'verdict.md'] },
  // v1.2.8 新增 audit 步骤（driver 步骤——role: null，不调 LLM）
  'f-audit':     { role: null, prompt: null,            outputs: ['audit-result.md'], inputs: [], driverFn: 'runAuditGate' },
};

// 步骤执行顺序（driver 按此顺序串行执行）
// v1.2.9 功能①：acceptance 拆为 12 shard + consolidate，替换原单步 acceptance。
// shard 步骤并行执行（spawnParallel），consolidate 在所有 shard 完成后串行。
const ACCEPTANCE_SHARD_STEPS = ACCEPTANCE_SHARDS.map(s => `acceptance-s${s.id}`);
const STEP_ORDER = [...ACCEPTANCE_SHARD_STEPS, 'acceptance-consolidate', 'regression', 'coverage', 'consolidate', 'verdict'];

// 每步的 recursionLimit（L3 框架兜底——L1/L2 熔断应在此之前触发）
// v1.2.5+ 优化：regression 改用 driver 预执行器（parseRegressionDimensions + runRegressionPrecheck），
// 命令执行从 LLM 手里剥离。worker 只读 regression-precheck.json 判定结果，工具调用 ≤ 5 次，
// recursionLimit 从 400 降到 50（不再需要模型逐维度跑命令，也消除了 GraphRecursionError）。
// v1.2.5+ coverage：同样加预执行器（runCoveragePrecheck），recursionLimit 100→40，
// worker 只读 coverage-precheck.json 交叉判定。
const STEP_RECURSION_LIMITS = {
  // v1.2.9 功能①：acceptance shard 用 40（短任务——分析日志片段）
  'acceptance-consolidate': 60,
  'regression':  50,
  'coverage':    40,
  'consolidate': 80,
  'verdict':     50,
};

// ═══════════════════════════════════════════════════════════
//  三层熔断常量（移植自 fresh-eyes-driver，适配 release-gate 单角色 V 架构）
// ═══════════════════════════════════════════════════════════
// L1 软熔断：stateModifier 注入 HumanMessage 强制写报告
// L2 硬熔断：stream 循环物理 break + grace window 报告抢救
// L3 框架兜底：LangGraph recursionLimit（上面的 STEP_RECURSION_LIMITS）
//
// 数值关系：30(劝) → 40(拽) → L3(杀)
// release-gate 任务比 fresh-eyes 简单（读预执行结果 + 分析文档），
// 所以阈值比 fresh-eyes(50/60) 更低，更早收敛。
const TOOL_SOFT_LIMIT = 35;   // L1：超过此数注入"立即写报告"HumanMessage
const TOOL_HARD_LIMIT = 45;   // L2：超过此数进入 grace window
const GRACE_STEPS_DEFAULT = 0;    // 零窗口模式（v1.2.7：撞硬上限立即中断，和 fresh-eyes-driver 对齐）
const GRACE_STEPS_ANALYSIS = 0;  // 分析型步骤同样零窗口

// v1.2.7：isReportText + REPORT_MIN_CHARS 提到模块级（和 fresh-eyes-driver 对齐，避免局部作用域引用 bug）
// v1.4.3 修正：此处原为 300，与 fresh-eyes-driver 的 500 不一致。查 commit
//   0e924794（「同步 fresh-eyes 熔断修复」）可知它本就是一次同步提交、注释也写明
//   「对齐」，300 系同步时的疏漏——500 才是 run-07 实战定下的阈值（GLM 的 172 字符
//   思考碎片被当成报告写入产物文件）。两者不一致意味着同一份文本在 fresh-eyes 判
//   不达标、在 release-gate 判达标，而这两个 driver 分别是审查与发版门禁的裁决口，
//   口径打架会让同一份产物在两处得到相反结论。
const REPORT_MIN_CHARS = 500;
function isReportText(text) {
  if (!text || !text.trim()) return false;
  if (text.length >= REPORT_MIN_CHARS) return true;
  if (/^#{1,3}\s/m.test(text)) return true;
  return false;
}

// 维度级超时覆盖（默认 60s；重遍历/全仓扫描类维度给更长时间）
// v1.2.5：维度 49（旧路径零残留 node 递归遍历 7 目录）实测 60s 超时 → 上调 120s
const DIM_TIMEOUT_OVERRIDE = {
  49: 120_000,
  // v1.3.6（run-08/09）：106 含全量 check-test-count（12 包测试实跑 ~55-95s），
  // 60s 上限必超时误报 ERR——放宽到 150s。根因是维度脚本跑全量测试太重，
  // v1.3.7 可改为只跑 --quiet 快速路径（SSOT 校验 <1s），届时回收此 override。
  106: 150_000,
  // v1.3.6（2026-08-18/run-01）：110 含全量 check-version.sh（70 项跨包扫描
  // ~60-90s）+ check-test-count，60s 必超时误报 ERR——放宽到 150s（与 106 同类）。
  110: 150_000,
  // v1.4.3（run-01 复验）：111⑤ 含全量 test-count.sh（12 包测试实跑 >60s），
  // 60s 上限必超时误报 ERR——放宽到 150s（与 106/110 同类：维度脚本跑全量测试）。
  // run-05 实证 150s 仍不够（8GB 机器全量实跑波动 >150s）——放宽到 240s；
  // 配合 buildPrecheckEvidence fail-closed 口径（超时=失败），超时不再被静默放过。
  111: 240_000,
};

// ═══════════════════════════════════════════════════════════
//  CLI 参数解析
// ═══════════════════════════════════════════════════════════
function parseArgs(argv) {
  const args = { target: null, dryRun: false,
                 worker: false, step: null, runDir: null,
                 skipAcceptance: false, help: false,
                 resume: false, checkAlive: null,
                 judgmentOnly: false, acceptanceRange: null, autoFix: false,
                 daemon: false, watch: null, watchInterval: 30, watchThreshold: 90 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help             = true;
    else if (a === '--target')           args.target         = argv[++i];
    else if (a === '--dry-run')     args.dryRun         = true;
    else if (a === '--worker')      args.worker         = true;
    else if (a === '--step')        args.step           = argv[++i];
    else if (a === '--run-dir')     args.runDir         = argv[++i];
    else if (a === '--skip-acceptance') args.skipAcceptance = true;
    // v1.2.8 功能⑦：断点续跑（参数名与 driver-base.parseDriverArgs / fresh-eyes 保持一致）
    else if (a === '--resume')      args.resume         = true;
    // v1.3.8 交付五：liveness 探针——只认 status.json 心跳不认日志
    else if (a === '--check-alive') args.checkAlive     = argv[++i];
    // v1.3.8 交付七：判断层瘦身——一次启动直达四步，跳过 acceptance 分片
    else if (a === '--judgment-only')    args.judgmentOnly    = true;
    else if (a === '--acceptance-range') args.acceptanceRange = argv[++i];
    // v1.3.8 交付七：F 修复链默认关闭，显式开关才进
    else if (a === '--auto-fix')    args.autoFix        = true;
    // v1.3.9 进程守护：--daemon 自脱离进程树；--watch 主管模式（心跳监控+死因审计+自动 resume）
    else if (a === '--daemon')      args.daemon    = true;
    else if (a === '--watch')       args.watch     = argv[++i];
    else if (a === '--watch-interval')  args.watchInterval  = parseInt(argv[++i], 10);
    else if (a === '--watch-threshold') args.watchThreshold = parseInt(argv[++i], 10);
  }
  return args;
}

// ═══════════════════════════════════════════════════════════
//  Worker 模式 — 在独立子进程内执行单个步骤
// ═══════════════════════════════════════════════════════════

/**
 * 从 SKILL.md 构建 systemPrompt。
 *
 * 复用 fresh-eyes-driver 的逻辑：剥离 frontmatter、提取身份标签。
 * 末尾追加 macOS BSD 工具约束段 + 纯只读铁律段（release-gate-loop 特有）。
 */
function buildSystemPrompt(skillPath) {
  const raw = readFileSync(skillPath, 'utf-8');
  const parts = raw.split('---');
  if (parts.length < 3) return raw.trim();
  const fm = parts[1];
  const body = parts.slice(2).join('---').trim();
  const val = (k) => (fm.match(new RegExp(`^${k}:\\s*(.*)`, 'm')) ?? [])[1]?.trim() ?? '';
  const header = [
    `[Agent: ${val('name')}]`,
    val('description') ? `[描述: ${val('description')}]` : '',
    val('triggers') ? `[触发条件: ${val('triggers')}]` : '',
  ].filter(Boolean).join('\n');

  // macOS BSD 工具约束——GLM 常用 Linux 语法导致命令报错
  const shellConstraints = [
    '',
    '## 🔴 铁律：macOS BSD 工具约束（违反必崩）',
    '',
    '你在 macOS 上运行，shell 是 BSD 版本，**不是 GNU/Linux**。以下命令在此环境会报错：',
    '- `grep -P` → 不存在，用 `grep -E`',
    '- `sed --version` / `sed -V` → 不存在，`sed -i` 必须带后缀 `sed -i ""`',
    '- `openssl --version` / `openssl -V` → 用 `openssl version`（无横杠）',
    '- `cat -A` → 用 `cat -v` 或 `od -c`',
    '- `stat --format` → 用 `stat -f`',
    '- `readlink -f` → 用 `python3 -c "import os; print(os.path.realpath(\'...\'))`"',
    '- `command -v` 代替 `which`（更可移植）',
    '- `<(...)` process substitution → 不支持',
    '',
    '**铁律：命令报错时立即换方案或跳过，禁止用相同语法重试。**',
  ].join('\n');

  // 纯只读铁律——release-gate-loop 核心约束
  const readOnlyRule = [
    '',
    '## 🔴 铁律：纯只读（release-gate-loop 核心约束）',
    '',
    '你**不得创建或修改任何代码或文档文件**。你的任务是验证 + 生成报告，不是修复。',
    '',
    '**禁止操作：**',
    '- 禁止使用 write_file / edit_file 等写工具',
    '- 禁止 git commit / git push',
    '- 禁止 npm publish / npm install',
    '- 禁止修改 acceptance-test.sh / regression-checklist.md / 任何源码',
    '',
    '**允许操作：**',
    '- 读文件（read_file / ls / glob / grep）',
    '- 跑验证命令（bash / node / grep 等，但不得有写副作用）',
    '- 写自己的产物文件（driver 从你的最终回复中提取）',
  ].join('\n');

  return header + '\n\n' + body + shellConstraints + '\n' + readOnlyRule;
}

/**
 * 为角色 V 创建 LLM 模型实例。
 *
 * 模型配置从 FORGE/models/ 加载（profile.mjs 定义角色→模型映射）。
 * 当前配置：V = glm-5.3（智谱 Coding Plan 订阅制，OpenAI 兼容接口，v1.4.1 起）。
 * 换模型只改 FORGE/models/profile.mjs，不需要改 driver 代码。
 *
 * 参数注入按模型文件声明的字段自适应：若模型定义 thinking 字段则走 thinking 分支，
 * 定义 reasoningEffort 则走 reasoningEffort 分支——历史注记：deepseek-v4-flash 时代
 * 用 reasoningEffort='max' + temperature=1.0（无 thinking 字段）；切模型后以
 * FORGE/models/glm-5.3.mjs 实际字段为准。
 *
 * @param {string} role 角色名（本 driver 固定为 'V'）
 * @param {number} [maxTokensOverride] 步骤级输出 token 上限覆盖，优先于 cfg.maxTokens
 */
async function createModel(role, maxTokensOverride) {
  const cfg = MODEL_CONFIGS[role];
  const apiKey = process.env[cfg.apiKeyEnv];

  // run-15 修复：判断层（本 driver）reasoningEffort 降档 max→high。
  // 判断层任务形态 =「读 precheck 证据写报告」，不需要 max 档思考深度；
  // max 档在 thinking 模式下首 token 前思考常超 300s，是 headersTimeout
  // 掐线事故的放大器（fresh-eyes 的 A/B 审查仍走模型文件的 max，不受影响）。
  const effectiveCfg = { ...cfg };
  if (effectiveCfg.reasoningEffort === 'max') {
    effectiveCfg.reasoningEffort = 'high';
  }

  if (!apiKey) {
    throw new Error(`环境变量 ${cfg.apiKeyEnv} 未设置（角色 ${role}）`);
  }

  const { ChatOpenAI } = await import('@langchain/openai');

  const ctorArgs = {
    modelName: cfg.model,
    configuration: { baseURL: cfg.baseURL },
    apiKey: apiKey,
    openAIApiKey: apiKey,
    // v1.3.7 run-28 修复：LLM 超时保护（同 driver-base/fresh-eyes）
    timeout: 600_000,
    maxRetries: 2,
  };

  // 限制输出 token（防止 thinking 模式无限消耗）
  // 步骤级 maxTokensOverride 优先于角色默认值 cfg.maxTokens
  const effectiveMaxTokens = maxTokensOverride ?? cfg.maxTokens;
  if (effectiveMaxTokens) {
    ctorArgs.maxTokens = effectiveMaxTokens;
  }

  // GLM-5.2 / DeepSeek 特殊参数（thinking + reasoningEffort）
  if (effectiveCfg.reasoningEffort) {
    ctorArgs.reasoningEffort = effectiveCfg.reasoningEffort;
  }
  if (effectiveCfg.thinking) {
    // modelKwargs 会原样透传到 API 请求 body
    ctorArgs.modelKwargs = { thinking: effectiveCfg.thinking };
  }

  try {
    return new ChatOpenAI(ctorArgs);
  } catch (err) {
    if (cfg.thinking) {
      // 退化：去掉 thinking 再试（reasoning_effort 大概率被支持）
      console.warn(`[release-gate] ChatOpenAI 不接受 thinking 参数，退化仅用 reasoningEffort: ${err.message}`);
      delete ctorArgs.modelKwargs;
      return new ChatOpenAI(ctorArgs);
    }
    throw err;
  }
}

// ─── 工具输出截断（v1.2.5 性能优化 → v1.2.8 功能③：迁移到统一中间件）──
// v1.2.8：truncateToolOutput 从 tool-output-budget.mjs 统一导入，
// 不再在此文件内联定义。删除旧实现 L293-309。
import { truncateToolOutput, DEFAULT_BUDGET as TOOL_OUTPUT_MAX_LINES } from './tool-output-budget.mjs';

/**
 * 从 dist 导入工具集（REVIEWER_TOOLS）。
 * 转换 ExecutableTool → DynamicStructuredTool（与 fresh-eyes-driver 同逻辑）。
 * v1.3.9（五）：V 角色 worker 追加门禁内部 tool（check_version / check_docs /
 * check_review_system）——worker 从 run_bash 执行 shell 升级为调内部 tool，
 * DSH 后端启用时同一工具经 DSH tool 注册机制暴露（见 gate-tools.mjs）。
 */
function loadTools(role, progressMw = null) {
  const cfg = MODEL_CONFIGS[role];
  const toolsModule = require('../../engine/orchestrator/dist/tools.js');
  const rawTools = toolsModule[cfg.toolsKey];
  if (!rawTools) {
    throw new Error(`工具集 ${cfg.toolsKey} 未在 dist/tools.js 中找到`);
  }

  const { tool } = require('@langchain/core/tools');
  const { z } = require('zod');

  // v1.3.9（五）：门禁脚本工具化（首期三个）——V 角色（验证 worker）追加
  const gateTools = role === 'V' ? createGateTools() : [];

  return [...rawTools.map((rawTool) => {
    if (rawTool.lc_namespace) return rawTool;

    const properties = rawTool.schema?.properties || {};
    const zodShape = {};
    const requiredFields = rawTool.schema?.required || [];

    for (const [key, prop] of Object.entries(properties)) {
      let zodField;
      if (prop.type === 'string') {
        zodField = z.string();
      } else if (prop.type === 'number' || prop.type === 'integer') {
        zodField = z.number();
      } else if (prop.type === 'boolean') {
        zodField = z.boolean();
      } else {
        zodField = z.string();
      }
      if (prop.description) zodField = zodField.describe(prop.description);
      if (!requiredFields.includes(key)) zodField = zodField.optional();
      zodShape[key] = zodField;
    }

    const wrappedTool = tool(
      async (input) => {
        // v1.2.5：工具输出截断——超过 200 行的输出只保留头尾，防止上下文膨胀
        // v1.3.6 交付⑩：worktree 隔离（镜像 fresh-eyes）——globalWorktree 存在时
        // run_bash cwd 切到副本，f-fix 的 git 写入（含模拟 commit）全部落隔离分支，
        // 主仓工作区与主分支历史零污染（run-07 事故根因修复）。
        const execFn = async () => {
          let raw;
          if (rawTool.name === 'run_bash') {
            const cmd = String((input && input.command) ?? '');
            // 剥离开头 `cd <路径>` 或 `cd <路径> && ...` 前缀（模型常拼错用户名路径）
            const stripped = cmd.replace(/^cd\s+("([^"]*)"|'([^']*)'|\S+)(\s*(?:&&|\|\||;|\|)\s*)?/, '');
            const { execSync } = await import('child_process');
            try {
              const stdout = execSync(stripped, {
                encoding: 'utf-8',
                maxBuffer: 16 * 1024 * 1024,
                timeout: 60_000,
                cwd: (globalWorktree && globalWorktree.worktreeDir) || REPO_ROOT,
              });
              raw = stdout || '(命令执行完成，无 stdout 输出)';
            } catch (err) {
              const e = err || {};
              const stderr = e.stderr ? (typeof e.stderr === 'string' ? e.stderr : e.stderr.toString()) : '';
              raw = `命令执行失败（exit ${e.status ?? '?'}）：${e.message ?? ''}\n${stderr}`;
            }
            if (cmd !== stripped) {
              raw = `[已自动剥离 cd 前缀，在项目根目录执行]\n${raw}`;
            }
          } else {
            raw = await rawTool.func(input);
          }
          return truncateToolOutput(raw);
        };
        if (progressMw) {
          return await progressMw.wrapToolCall(
            { tool: rawTool.name, args: input },
            execFn,
          );
        }
        return await execFn();
      },
      {
        name: rawTool.name,
        description: rawTool.description,
        schema: z.object(zodShape),
      }
    );

    return wrappedTool;
  }), ...gateTools];
}

/**
 * 从 DeepAgent invoke 结果中提取 usage 数据（多级 fallback）。
 * 与 fresh-eyes-driver 完全一致的 4 路径 fallback。
 */
function extractUsage(result) {
  if (result?.usage) {
    const u = result.usage;
    const pt = u.prompt_tokens ?? u.input_tokens ?? 0;
    const ct = u.completion_tokens ?? u.output_tokens ?? 0;
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
  }

  if (result?.llmResult?.usage) {
    const u = result.llmResult.usage;
    const pt = u.prompt_tokens ?? u.input_tokens ?? 0;
    const ct = u.completion_tokens ?? u.output_tokens ?? 0;
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
  }

  if (result?.messages?.length > 0) {
    const last = result.messages[result.messages.length - 1];
    if (last?.usage_metadata) {
      const u = last.usage_metadata;
      const pt = u.input_tokens ?? u.prompt_tokens ?? 0;
      const ct = u.output_tokens ?? u.completion_tokens ?? 0;
      return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
    }
    if (last?.response_metadata?.token_usage) {
      const u = last.response_metadata.token_usage;
      const pt = u.prompt_tokens ?? 0;
      const ct = u.completion_tokens ?? 0;
      return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
    }
  }

  return null;
}

/**
 * 记录单次 invoke 的 usage 到 runDir/usage.jsonl。
 * 单角色 V，round 字段固定为 1（单轮）。
 */
function recordUsage(runDir, step, role, model, result, latencyMs, target) {
  const usagePath = join(runDir, 'usage.jsonl');
  const pricing = MODEL_PRICING[model];
  const usage = extractUsage(result);

  let billing = 'pay-as-you-go';
  for (const [roleKey, cfg] of Object.entries(MODEL_CONFIGS)) {
    if (cfg.model === model) { billing = cfg.billing; break; }
  }

  let record;
  if (usage) {
    let cost = null;
    let priceConfidence;
    if (billing === 'subscription') {
      cost = null;
      priceConfidence = 'subscription';
    } else if (pricing) {
      cost = ((usage.prompt_tokens / 1_000_000) * pricing.input +
             (usage.completion_tokens / 1_000_000) * pricing.output);
      priceConfidence = 'estimated';
    } else {
      cost = null;
      priceConfidence = 'no-pricing';
    }

    record = {
      ts:                 new Date().toISOString(),
      target:             target,
      step:               step,
      role:               role,
      model:              model,
      prompt_tokens:      usage.prompt_tokens,
      completion_tokens:  usage.completion_tokens,
      total_tokens:       usage.total_tokens,
      cost_cny:           cost,
      price_confidence:   priceConfidence,
      latency_ms:         latencyMs,
    };
  } else {
    record = {
      ts:                 new Date().toISOString(),
      target:             target,
      step:               step,
      role:               role,
      model:              model,
      usage:              null,
      note:               'API 未返回 usage 字段',
      latency_ms:         latencyMs,
    };
  }

  appendFileSync(usagePath, JSON.stringify(record) + '\n', 'utf-8');
}

/**
 * 解析 changelog 文件路径（相对 REPO_ROOT）。
 *
 * changelog 目录结构（v1.2.5 实测）：
 *   docs/changelog/v1.2/v1.2.5.md   ← 按大版本嵌套子目录
 * 顶层 docs/changelog/v1.2.5.md 不存在。
 *
 * 解析顺序：
 *   1. docs/changelog/TARGET.md        （顶层——部分老版本在此）
 *   2. docs/changelog/v-子目录/TARGET.md（扫 v1.x 等嵌套目录，取第一个命中）
 * 均未命中 → 返回 null（调用方回退到顶层路径字符串，模型自行处理）。
 *
 * @param {string} target 版本号，如 "v1.2.5"
 * @returns {string|null} 相对路径（/ 分隔），未找到返回 null
 */
function resolveChangelogPath(target) {
  // run-01 修复：target 归一化带 v 前缀——--target 1.3.5（无 v）时子目录文件名拼成
  // v1.3/1.3.5.md（缺 v）导致 precheck 提取为空、coverage 人工补救。归一化后两种传法等价。
  const norm = target.startsWith('v') ? target : `v${target}`;
  const topLevel = `docs/changelog/${norm}.md`;
  if (existsSync(join(REPO_ROOT, topLevel))) {
    return topLevel;
  }
  // 递归扫 docs/changelog/ 下的 v1.x 等子目录，找 TARGET.md（按 major.minor 猜目录再全扫兜底）
  const changelogDir = join(REPO_ROOT, 'docs/changelog');
  if (existsSync(changelogDir)) {
    // 猜测目录：v1.3.5 → v1.3/（major.minor）
    const mm = norm.match(/^v(\d+\.\d+)\.\d+/);
    if (mm) {
      const guess = `docs/changelog/v${mm[1]}/${norm}.md`;
      if (existsSync(join(REPO_ROOT, guess))) return guess;
    }
    for (const sub of readdirSync(changelogDir, { withFileTypes: true })) {
      if (!sub.isDirectory() || !sub.name.startsWith('v')) continue;
      const candidate = `docs/changelog/${sub.name}/${norm}.md`;
      if (existsSync(join(REPO_ROOT, candidate))) {
        return candidate;
      }
    }
  }
  console.warn(`[driver] changelog 未找到（顶层+嵌套均无）: ${target}，回退到顶层路径字符串`);
  return topLevel;
}

/**
 * v1.4.0（run-04~07 根因修复）：把 precheck 证据内容直接注入 userMessage。
 *
 * 背景：DSH CLI 桥接（dsh-backend.ts）无法把 sofagent 自定义工具注入子进程——
 * worker 只有 DSH 自带 bash/fs 工具链，但 release-gate 的 worker prompt 要求
 * 「读 precheck.json（1 次 tool call）→ 判定」。工具不可用 → 「工具调用结果摘要
 * 0 条」→ 报告永远「证据不足」判 FAIL（run-04/05 ERROR、run-07 FAIL 全因此）。
 *
 * 正解：precheck.json 本就是 driver 预执行生成的证据（方案 A：命令执行从 LLM 剥离）。
 * 证据内容由 driver 直接注入 userMessage——worker 无需任何工具即可判定，
 * DSH / LangGraph 双后端兼容，且省掉 worker 的读文件工具调用。
 *
 * @param {string} runDir 当前 run 目录
 * @param {{inputs?: string[], precheck?: boolean}} stepDef 步骤定义
 * @returns {string} 注入文本（非 precheck 步骤返回空串）
 */
function buildPrecheckEvidence(runDir, stepDef) {
  if (!stepDef?.precheck || !Array.isArray(stepDef.inputs)) return '';

  const blocks = [];
  for (const f of stepDef.inputs) {
    // v1.4.0：只注入 precheck.json 产物（driver 预执行的证据）；acceptance.md 等
    // 原始日志/报告文件仍走路径注入（内容太大，且 worker 已有路径可读）
    if (!f.endsWith('-precheck.json')) continue;
    const p = join(runDir, f);
    if (!existsSync(p)) {
      blocks.push(`[driver 注入] ${f}: 文件不存在——跳过（worker 判定时注意此文件缺失的影响）`);
      continue;
    }
    try {
      const data = JSON.parse(readFileSync(p, 'utf-8'));

      // ── regression-precheck.json：逐维度 exitCode + 输出摘要 ──
      if (data.dims && (data.meta?.dims || typeof data.dims === 'object')) {
        const dims = typeof data.dims === 'object' ? Object.values(data.dims) : data.dims;
        const lines = [`[driver 注入] ${f} 内容（${dims.length} 维度，逐维度判定依据）：`];
        let failCount = 0;
        for (const d of dims) {
          // run-05 实证 fail-closed：exitCode=null（超时/异常）也计入失败——
          // 超时=证据缺失=未通过。旧口径 `!== 0 && !== null` 把超时当「非失败」，
          // V 看到汇总「0 失败」与 dim 111 exit=ERR 自相矛盾，判定输入不完整。
          const isFail = d.exitCode !== 0;
          if (isFail) failCount++;
          const out = String(d.output ?? '').replace(/\n/g, '⏎').slice(0, 200);
          lines.push(`  - 维度 ${d.num}「${d.title}」: exit=${d.exitCode ?? 'ERR(超时/异常)'}${d.truncated ? '（输出截断）' : ''}${out ? ` | 输出: ${out}` : ''}`);
        }
        lines.push(`  → 汇总：${dims.length} 维度中 ${failCount} 个失败（非零退出码或超时 ERR，fail-closed：超时=证据缺失=未通过）${failCount ? '（详见上方非 0/ERR 项）' : '，全部通过'}`);
        blocks.push(lines.join('\n'));
        continue;
      }

      // ── coverage-precheck.json：changelog 模块 + 场景索引 ──
      // v1.4.0（run-19 复验）：全量输出，不做 slice 截断——252 场景 num+title 实测
      // 仅 ~12KB，截断反而让 worker 无法核验模块→场景覆盖矩阵（P1-1/P1-2 根因）
      if (data.meta?.modules || data.changelog) {
        const lines = ['[driver 注入] ' + f + ' 内容：'];
        if (data.meta) {
          lines.push(`  - meta: modules=${data.meta.modules ?? '?'} / scenarios=${data.meta.scenarios ?? '?'}（changelog: ${data.meta.changelogPath ?? '?'}）`);
        }
        if (Array.isArray(data.changelog)) {
          lines.push(`  - changelog 模块（${data.changelog.length}，全量）:`);
          for (const m of data.changelog) {
            lines.push(`    * ${m.title ?? '(无标题)'}`);
          }
        }
        if (Array.isArray(data.scenarios)) {
          lines.push(`  - 场景索引（${data.scenarios.length}，全量）:`);
          for (const s of data.scenarios) {
            lines.push(`    * S${s.num} ${s.title ?? ''}`);
          }
        }
        blocks.push(lines.join('\n'));
        continue;
      }

      // 兜底：整体 JSON 摘要
      const raw = JSON.stringify(data).slice(0, 1500);
      blocks.push(`[driver 注入] ${f} 内容摘要: ${raw}`);
    } catch (e) {
      blocks.push(`[driver 注入] ${f}: 解析失败（${e.message}）——worker 判定时注意`);
    }
  }

  return blocks.length ? '--- precheck 证据（driver 已预执行，直接据此判定，无需调用工具） ---\n' + blocks.join('\n\n') : '';
}

/**
 * v1.4.3（run-19 根因）：非 precheck 步骤的上一步产物内容注入。
 *
 * 背景：v1.4.3 性能优化「判断层直连模式」（跳过 DSH 桥接 worker）落地后，
 * verdict / consolidate 等无 precheck:true 的步骤在直连模式下既无工具结果
 * （messages 为空数组）也无 precheck 证据（buildPrecheckEvidence 返回空串）
 * → generateReportWithoutTools 的 reportPrompt 只剩「（本次审查没有任何工具
 * 结果或 precheck 证据）」→ verdict 永远「零证据」判 ERROR（run-19 实证：
 * verdict/consolidate 双双输出「未收到任何工具调用结果」HOLD 报告）。
 *
 * 语义修正：这些步骤的 stepDef.inputs 本就是 driver 中转的上一步产物文件
 * （verdict ← stage6-report.md；consolidate ← acceptance/regression/coverage
 * 三报告）——DSH 桥接时代 worker 用 read 工具自己读；直连模式没有工具，
 * 证据就必须像 precheck 一样由 driver 随 prompt 送达（方案 A 语义一贯）。
 *
 * 尺寸控制：单文件截 12000 字符（run-07 实证：stage6-report.md 7397 字符被旧值
 * 6000 截断，verdict 第 5 节前置条件 #4/#5 丢失——12000 覆盖实测最大产物全量），
 * 多文件合计 ≤ inputs.length × 12000（硬顶 150000）。
 * 合计预算随输入数缩放是 run-08 三修：consolidate 要并 12 份分片报告，固定
 * 20000 总额导致 s8~s12（恰含 v1.4.3 新场景 S345~S358）静默截断，被 verdict
 * 升格 P1-10。「单文件上限 × 输入数」让每份输入都可完整到达，硬顶防异常膨胀。
 * 截断提示以「字符」计量并显式注明（run-07 教训：V 曾把文件 13720 字节误读为
 * 「注入止于 7397 字符」——字节 ≠ 字符，UTF-8 中文 3 字节）。
 *
 * @param {string} runDir 当前 run 目录
 * @param {{inputs?: string[], precheck?: boolean}} stepDef 步骤定义
 * @returns {string} 注入文本（precheck 步骤返回空串——已由 buildPrecheckEvidence 覆盖）
 */
function buildInputsEvidence(runDir, stepDef) {
  if (stepDef?.precheck || !Array.isArray(stepDef?.inputs)) return '';
  const blocks = [];
  const totalBudget = Math.min(150_000, Math.max(20_000, stepDef.inputs.length * 12_000));
  let total = 0;
  for (const f of stepDef.inputs) {
    const p = join(runDir, f);
    if (!existsSync(p)) {
      blocks.push(`[driver 注入] ${f}: 文件不存在——上一步产物缺失，判定时按「数据不完整」处理`);
      continue;
    }
    try {
      const raw = readFileSync(p, 'utf-8');
      const budget = Math.max(0, totalBudget - total);
      const clipped = raw.length > Math.min(12_000, budget)
        ? raw.slice(0, Math.min(12_000, budget)) + `\n…（截断，全文 ${raw.length} 字符（字符数非字节数），见 ${p}）`
        : raw;
      total += clipped.length;
      blocks.push(`[driver 注入] ${f} 内容（上一步产物，判定依据）：\n${clipped}`);
    } catch (e) {
      blocks.push(`[driver 注入] ${f}: 读取失败（${e.message}）——判定时按「数据不完整」处理`);
    }
  }
  return blocks.length ? '--- 上一步产物证据（driver 已中转，直接据此判定，无需调用工具） ---\n' + blocks.join('\n\n') : '';
}

/**
 * v1.4.3（run-07 P0-V1 根因修复）：acceptance 分片的日志分段证据注入。
 *
 * 背景：直连模式（裸 LLM）下分片 worker 无工具，而分片 stepDef `inputs: []`
 * 且无 precheck → buildPrecheckEvidence / buildInputsEvidence 双双返回空串 →
 * worker 收到「没有任何工具结果或 precheck 证据——如实说明证据缺失」→ 12 分片
 * 全部如实判 BLOCKED（run-07 实证）。acceptance-raw.log 一直躺在 runDir 里，
 * 但从未进入任何注入路径；prompt 里的 {runDir} 占位符也无替换逻辑。
 *
 * 方案：复用 run-21 定谳「预跑日志是权威（driver 确定性判定优先于 LLM 解读）」——
 * driver 按分片的场景范围从 acceptance-raw.log 切出对应段（`━━━ 场景 N:` 标记
 * 分界）+ 日志尾部汇总行，随 userMessage 注入。worker 无需工具即可逐场景判定。
 *
 * 尺寸控制：单分片切段 ≤ 24000 字符（实测 12 分片均分 73524 字节日志，均 ~6KB，
 * 富余 4 倍；超限截断并注明——日志异常膨胀时降级不阻塞）。
 *
 * @param {string} runDir 当前 run 目录
 * @param {{shard?: {id: number, start: number, end: number}}} stepDef 步骤定义
 * @returns {string} 注入文本（非分片步骤返回空串）
 */
function buildShardEvidence(runDir, stepDef) {
  const shard = stepDef?.shard;
  if (!shard) return '';

  const logPath = join(runDir, 'acceptance-raw.log');
  if (!existsSync(logPath)) {
    return `[driver 注入] acceptance-raw.log: 文件不存在——预跑日志缺失，按「数据不完整」处理（你的分片范围 S${shard.start}~S${shard.end} 无法核验，结论标 SKIP）`;
  }

  let raw;
  try {
    raw = readFileSync(logPath, 'utf-8');
  } catch (e) {
    return `[driver 注入] acceptance-raw.log: 读取失败（${e.message}）——按「数据不完整」处理，结论标 SKIP`;
  }

  // 按场景标记行切片：`━━━ 场景 N: 标题 ━━━`
  // 提取 [shard.start, shard.end] 范围内的所有场景段 + 日志尾部汇总行。
  // 🔴 先剥离 ANSI 色码（run-08 实证）：acceptance-test.sh 场景行带
  // `\x1b[0;36m` 前缀（CYAN），`^━` 锚定正则 291 场景段全数脱靶 → 分片
  // 全判 SKIP。同 extractAcceptanceResult（run-21 回放）的剥离口径。
  raw = raw.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = raw.split(/\r?\n/);
  const sceneHeaderRe = /^━+\s*场景\s*(\d+)\s*[:：]/;
  const segments = [];
  const headLines = []; // 首个场景段之前的内容（日志头/进度行）
  let current = null; // { num, lines: [] }
  for (const line of lines) {
    const m = line.match(sceneHeaderRe);
    if (m) {
      if (current) segments.push(current);
      else if (headLines.length < 200) headLines.push(line); // 头部防膨胀上限
      current = { num: parseInt(m[1], 10), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      headLines.push(line);
    }
  }
  if (current) segments.push(current);

  // 尾部汇总行（权威判定源，run-21 先例）：
  // 汇总行（「验收测试结果：N 通过 / M 失败」「全部通过」）物理上出现在最后一个
  // 场景段**内部**（脚本在末场景后直接打印统计）——按行索引反查定位在段尾为
  // 空串时会命中日志末尾（run-08 实证 bug），改为**直接在日志尾部窗口内按
  // 语义正则提取**权威行，不做位置切片。
  // run-08 P0-1 harness 联动：acceptance-test.sh 汇总新增第三类「N 跳过」与
  // 「⚠️ 有 N 个场景因环境依赖跳过」行——词表补「有 \d+ 个场景因环境依赖跳过」，
  // 跳过数必须进入分片证据面（跳过=证据缺失，审查者需知晓）。
  const tailLines = lines.slice(-30).join('\n');
  const summaryHits = [
    ...tailLines.matchAll(/^\s*(?:.*?：)?\s*(?:✅|❌|⚠️)?\s*(验收测试结果：.*|SUMMARY:.*|全部通过.*|有 \d+ 个场景失败.*|有 \d+ 个场景因环境依赖跳过.*)$/gm),
  ].map(m => m[1].trim());
  const tail = summaryHits.length ? summaryHits.join('\n') : tailLines.split('\n').filter(Boolean).slice(-5).join('\n');

  const mine = segments.filter(s => s.num >= shard.start && s.num <= shard.end);
  const blocks = [];
  blocks.push(`[driver 注入] acceptance-raw.log 分片证据——你的场景范围 = S${shard.start}~S${shard.end}（以本注入为准，忽略 prompt 模板中的范围数字与 {runDir} 路径——直连模式无工具，日志内容已由 driver 切出送达）`);

  if (mine.length === 0) {
    blocks.push(`  → 日志中未找到 S${shard.start}~S${shard.end} 范围内的任何场景标记（共解析出 ${segments.length} 个场景段）。编号跳号是设计模式；整段范围缺失 = 该范围无场景（结论标 SKIP 并注明），不视为 FAIL。`);
  } else {
    let total = 0;
    for (const s of mine) {
      let text = s.lines.join('\n');
      if (text.length > 24_000) {
        text = text.slice(0, 24_000) + `\n…（本场景段截断，原文 ${text.length} 字符——字符数非字节数）`;
      }
      total += text.length;
      blocks.push(text);
    }
    blocks.push(`--- 日志尾部汇总行（脚本真实统计，判定以此为准） ---\n${tail}`);
    blocks.push(`（本分片注入 ${mine.length} 个场景段，共 ${total} 字符——字符数非字节数；全文见 ${logPath}）`);
  }

  return '--- acceptance 预跑日志分片证据（driver 已切出，直接据此判定，无需调用工具） ---\n' + blocks.join('\n\n');
}

/**
 * Worker 主逻辑：读 prompt → 建 model+tools → invoke → 写产物。
 */
async function runWorker(step, runDir, target) {
  const stepDef = STEPS[step];
  if (!stepDef) throw new Error(`未知步骤: ${step}`);

  // v1.2.8：从 STEPS 定义读取角色，不再硬编码 'V'。
  // V 步骤 → reviewer skill，F 步骤 → engineer skill。
  const role = stepDef.role;
  const cfg  = MODEL_CONFIGS[role];

  // worker-alive 戳（v1.3.6 交付⑩：镜像 fresh-eyes-driver——修 A 忘 B 是必然的）：
  // 每 30s 写时间戳到 runDir，事后可区分「driver 死（戳还在跳）」vs「整树死（戳同停）」。
  // SIGKILL 下 driver/worker 都来不及写终态，这是唯一的尸检证据。
  // 戳文件本身保留供取证（worker 进程退出时定时器随进程回收，无需显式清理）。
  const workerAlivePath = join(runDir, 'worker-alive.json');
  const writeAliveStamp = () => {
    try {
      writeFileSync(workerAlivePath, JSON.stringify({
        step, pid: process.pid, ts: new Date().toISOString(),
      }) + '\n');
    } catch { /* 戳写失败不中断 worker 主流程 */ }
  };
  setInterval(writeAliveStamp, 30_000);
  writeAliveStamp(); // 首跑立即写一次（否则最早 30s 内无戳）

  // 1. 构建 systemPrompt
  const systemPrompt = buildSystemPrompt(cfg.agentSkillPath);

  // 2. 读 prompt 正文
  // v1.4.3（run-07）：统一替换 {runDir} 占位符——分片 prompt 写着
  // `{runDir}/acceptance-raw.log`，但旧代码无替换逻辑，worker 收到的是字面
  // `{runDir}` 且直连模式无工具可读——占位符从未生效过。
  const promptTemplate = readFileSync(join(PROMPTS_DIR, stepDef.prompt), 'utf-8')
    .replaceAll('{runDir}', runDir);

  // 3. 组装 user message：prompt 正文 + 路径注入 + target 注入
  const inputPaths = stepDef.inputs.map(f => `  - ${join(runDir, f)}`).join('\n');
  const outputPaths = stepDef.outputs.map(f => `  - ${join(runDir, f)}`).join('\n');

  // v1.4.0 修复（run-04~07 连续 ERROR/FAIL 根因）：DSH CLI 桥接下 sofagent 自定义工具
  // 无法注入子进程（dsh-backend.ts WARN「不生效」）→ worker 读不到 precheck.json →
  // 「工具调用结果摘要 0 条」→ 报告永远「证据不足」判 FAIL。
  // 正解：precheck.json 本来就是 driver 预执行生成的证据（方案 A 语义）——**证据内容
  // 由 driver 直接注入 userMessage**，worker 无需任何工具即可判定（DSH/LangGraph 双后端兼容）。
  const precheckEvidence = buildPrecheckEvidence(runDir, stepDef);
  // v1.4.3（run-19 根因）：非 precheck 步骤的上一步产物内容注入——直连模式
  // （无工具）下 verdict/consolidate 的唯一证据面，缺失即「零证据」ERROR。
  const inputsEvidence = buildInputsEvidence(runDir, stepDef);
  // v1.4.3（run-07 P0-V1 根因）：acceptance 分片的日志分段证据——直连模式下
  // 分片无工具、无 precheck、无 inputs，raw.log 切段是唯一判定依据。
  const shardEvidence = buildShardEvidence(runDir, stepDef);

  // 注入 changelog 路径（步骤③ coverage 需要）
  // v1.2.5 bugfix：changelog 按版本号嵌套在 docs/changelog/v1.2/v1.2.5.md，
  // 顶层 docs/changelog/v1.2.5.md 不存在 → 模型陷入找文件死循环（run-06 coverage 崩溃根因）。
  // 修复：先试顶层，不存在则扫 v1.x 等子目录匹配。
  const changelogPath = resolveChangelogPath(target);

  // v1.3.6 交付⑩：项目根目录指向 worktree 隔离副本（worker 通过
  // FORGE_WORKTREE_ROOT env 继承；env 缺失时回退主仓——降级不阻塞）。
  // f-fix 的代码修改全部落副本分支，主仓工作区与主分支历史零污染。
  const workerProjectRoot = (globalWorktree && globalWorktree.worktreeDir) || REPO_ROOT;

  const userMessage = [
    promptTemplate.trim(),
    '',
    '--- driver 注入 ---',
    `本次验证对象 = sofagent ${target} 完整交付物`,
    // 版本锚点声明（run-05 P0-2 根因）：发版时序上 SSOT bump 在阶段十（publish），
    // 闸门跑在阶段六——仓库 package.json/tag 仍指上一版属 SOP 正常状态，不是
    // 「身份断裂」。但 worker 会在 precheck/日志里看到旧 SSOT，各报告自行引用
    // 旧号 → verdict 误判「三份输入版本互相矛盾」。显式声明口径：报告版本锚点
    // 统一写候选版本（${target}）；仓库 SSOT 滞后是预期，发现时如实记录「SSOT
    // 仍指 vX.Y.Z（待阶段十 bump）」即可，不得当作阻塞项。
    `版本口径 = 候选版本 ${target}；仓库 package.json/tag 的 SSOT 此刻仍指上一版属发版时序正常状态（bump 在阶段十），报告中的版本锚点一律写 ${target}，SSOT 滞后不构成阻塞项`,
    `项目根目录 = ${workerProjectRoot}`,
    // v1.3.0 修复：acceptance shard 动态注入实际场景范围（覆盖模板写死的旧范围文字）
    stepDef.shard ? `你负责的实际场景范围 = S${stepDef.shard.start} 到 S${stepDef.shard.end}（以本注入为准，忽略 prompt 模板中写死的范围数字）` : '',
    inputPaths ? `输入文件（已由 driver 中转）：\n${inputPaths}` : '',
    // v1.4.0：precheck 证据内容直接注入（DSH 桥接下 worker 无工具可用，证据必须随 prompt 送达）
    precheckEvidence,
    // v1.4.3（run-19 根因）：上一步产物内容注入（verdict ← stage6-report.md 等）
    inputsEvidence,
    // v1.4.3（run-07 P0-V1 根因）：acceptance 分片日志分段注入
    shardEvidence,
    `Changelog 路径 = ${changelogPath}`,
    `产物输出路径（把你的输出写到这个文件）：\n${outputPaths}`,
  ].filter(Boolean).join('\n');

  // 4. 创建 model + tools + agent
  // 步骤级 maxTokens 覆盖（如 consolidate=32000）优先于角色默认值
  const model = await createModel(role, stepDef.maxTokens);

  // L2：ProgressMiddleware 注入
  // 单角色，文件名 sub-progress.jsonl（不带角色字母）
  let progressMw = null;
  try {
    progressMw = createProgressMiddleware({ roundDir: runDir, role: 'V' });
  } catch (mwErr) {
    console.warn(`[worker:${step}] ProgressMiddleware 创建失败（不影响主流程）: ${mwErr.message}`);
  }
  const tools = loadTools(role, progressMw);

  // v1.3.4 增量：编排层与执行层分离——worker 通过 ExecutionBackend 接口调用 agent。
  // createReactAgent 调用迁移到 langgraph-backend.ts 内部，stateModifier / stream 逻辑
  // 作为回调传入（零改动、零回归风险——FORGE 精细逻辑保留在 driver 侧）。
  const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');

  // v1.2.5 性能优化：stateModifier 同时实现「system prompt 注入」+「上下文裁剪」。
  // prompt 和 stateModifier 互斥（LangGraph 源码 _getPrompt 强校验），
  // 所以把 systemPrompt 移到 stateModifier 内部以 SystemMessage 形式注入。
  //
  // v1.2.6 内存优化：preModelHook 物理裁剪 state.messages。
  // stateModifier 只裁剪「发给 LLM 的 prompt」，不影响 LangGraph 内部 state——
  // state.messages 数组在工具调用循环中持续增长（每次 +2 条：AI tool_call + ToolMessage），
  // 全部消息内容（thinking tokens、工具输出）驻留在内存中。
  // preModelHook 在每次模型调用前物理替换 state.messages，旧消息可被 GC 回收。
  // 实测：regression 步骤 17 次工具调用从 OOM(exit 137) 降到正常完成。
  const MAX_CONTEXT_MESSAGES = 16;
  const systemMsg = new SystemMessage(systemPrompt);

  // 🔴 F-4 修复：从 fresh-eyes-driver.mjs 复制 trimMessagesSafe + estimateTokens。
  // 原 release-gate 用 raw slice 裁剪，会切断 tool_calls ↔ ToolMessage 配对，
  // 产生孤立消息触发 LangGraph / DeepSeek API 校验报错。

  // trimMessagesSafe 做 3 步：
  //   1. slice 取最后 keepCount 条
  //   2. 清除配对：扫一遍，标记所有孤立的 tool_calls / ToolMessage，从结果中移除
  //   3. 返回清洗后的安全消息数组
  function trimMessagesSafe(messages, keepCount) {
    if (messages.length <= keepCount) return [...messages];
    let recent = messages.slice(-keepCount);

    // 配对清洗：收集所有 AI tool_calls 的 id 和所有 ToolMessage 的 tool_call_id
    // 如果 ToolMessage 的 tool_call_id 在 recent 中找不到对应的 AI tool_calls → 移除
    // 如果 AI tool_calls 的某个 tool_call_id 在 recent 中找不到对应的 ToolMessage → 从 tool_calls 中移除该条
    // 如果 AI 消息的所有 tool_calls 都找不到对应 ToolMessage → 移除整条 AI 消息

    const aiToolCallIds = new Set();
    for (const msg of recent) {
      if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
        for (const tc of msg.tool_calls) {
          if (tc.id) aiToolCallIds.add(String(tc.id));
        }
      }
    }

    const toolMsgIds = new Set();
    for (const msg of recent) {
      if (msg?._getType?.() === 'tool' && msg.tool_call_id) {
        toolMsgIds.add(String(msg.tool_call_id));
      }
    }

    // 过滤：移除孤立的 ToolMessage 和孤立的 AI tool_calls
    const cleaned = [];
    for (const msg of recent) {
      const type = msg?._getType?.();
      if (type === 'tool' && msg.tool_call_id) {
        // ToolMessage 有对应的 AI tool_calls？→ 保留
        if (aiToolCallIds.has(String(msg.tool_call_id))) {
          cleaned.push(msg);
        }
        // 否则跳过（孤立的 ToolMessage）
      } else if (type === 'ai' && msg.tool_calls?.length > 0) {
        // AI 消息有 tool_calls → 检查每个 tool_call 是否都有对应的 ToolMessage
        const validCalls = msg.tool_calls.filter(tc =>
          !tc.id || toolMsgIds.has(String(tc.id))
        );
        if (validCalls.length === msg.tool_calls.length) {
          // 所有配对完整 → 保留原消息
          cleaned.push(msg);
        } else if (validCalls.length > 0) {
          // 部分配对 → 保留消息但更新 tool_calls（创建修改副本）
          cleaned.push({ ...msg, tool_calls: validCalls });
        }
        // 所有 tool_calls 都无配对 → 跳过（孤立的 AI tool_calls）
      } else {
        // 普通消息（Human/AI text/System）→ 直接保留
        cleaned.push(msg);
      }
    }

    return cleaned;
  }

  // 粗估消息总 token 数（content 长度 / 4）
  function estimateTokens(messages) {
    let totalChars = 0;
    for (const msg of messages) {
      const content = msg?.content;
      if (typeof content === 'string') {
        totalChars += content.length;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === 'string') {
            totalChars += part.length;
          } else if (part && typeof part.text === 'string') {
            totalChars += part.text.length;
          }
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  // v1.3.4 增量：stateModifier 构造为闭包——传给 langgraph-backend 作为 stateModifierFactory 回调。
  // 逻辑零改动（保留所有 run-XX 教训沉淀）：工具预算软熔断 + 上下文裁剪 + tool_calls 配对清洗。
  const buildStateModifier = ({ systemPrompt: _sp, toolBudget: _tb }) => {
    return (state) => {
      const messages = state.messages ?? [];

      // 统计历史消息中所有 AI tool_calls 总数
      let toolCallCount = 0;
      for (const msg of messages) {
        if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
          toolCallCount += msg.tool_calls.length;
        }
      }

      // 上下文裁剪辅助函数：保留 system + 第一条 user + 最后 N 条
      // F-4：用 trimMessagesSafe 替换 raw slice，避免孤立 tool_calls/ToolMessage
      const trimmed = (extra) => {
        if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
          return extra ? [systemMsg, extra, ...messages] : [systemMsg, ...messages];
        }
        const first = messages[0];
        const recent = trimMessagesSafe(messages, MAX_CONTEXT_MESSAGES);
        return extra ? [systemMsg, extra, first, ...recent] : [systemMsg, first, ...recent];
      };

      // L2 硬熔断：更强制的"最终警告"
      if (toolCallCount >= TOOL_HARD_LIMIT) {
        const forceReport = new HumanMessage({
          content: '【🔴 系统最终警告 🔴】你已调用 ' + toolCallCount + ' 次工具，远超预算。' +
            '现在必须立即输出完整的分析报告文本。禁止再调用任何工具。' +
            '直接在回复中写出你的完整分析结果。'
        });
        return trimmed(forceReport);
      }

      // L1 软熔断：强制收尾指令
      if (toolCallCount >= TOOL_SOFT_LIMIT) {
        const forceReport = new HumanMessage({
          content: '【系统强制指令】你已经调用了 ' + toolCallCount + ' 次工具，超过软上限。' +
            '立即停止所有探索，用已掌握的信息写报告并写入产物文件。不要再调任何工具。'
        });
        console.warn(`  ⚡ [${step}#V] 工具调用 ${toolCallCount} 次超软上限，注入强制收尾指令`);
        return trimmed(forceReport);
      }

      // 正常：只做上下文裁剪
      return trimmed(null);
    };
  };

  // v1.3.4 增量：preModelHook 保留（token 维度激进裁剪）——传给 langgraph-backend 的 modelConfig.preModelHook
  const preModelHook = (state) => {
      // F-4：token 维度激进裁剪——只在 token 超硬阈值时裁剪。
      // 消息条数裁剪已由 stateModifier 处理，这里补 stateModifier 看不见的维度：
      // 单条消息超长（如 500 行审查报告全文）导致总 token 爆炸但消息条数还不多。
      const messages = state.messages ?? [];
      const tokenEst = estimateTokens(messages);

      // token 超硬阈值 → 激进裁剪
      if (tokenEst > 100000) {
        const first = messages[0];
        const recent = trimMessagesSafe(messages, 12);
        return { ...state, messages: [first, ...recent] };
      }

      return state;
    };

  // 5. 通过 ExecutionBackend 执行 agent（v1.3.4 增量）
  //    stream 循环逻辑（toolCallCount / hardBreak / gotReport / graceWindow）作为
  //    streamHandler 回调传入——backend 在每个 chunk 调 streamHandler，返回
  //    { hardBreak: true } 时中断 stream 并返回已累积的消息。
  console.log(`[worker:${step}] 开始执行（role=V, model=${cfg.model}）`);
  const t0 = Date.now();

  const recursionLimit = STEP_RECURSION_LIMITS[step] ?? stepDef.recursionLimit ?? 50;

  // streamHandler 闭包——维护 toolCallCount / graceWindow / hardBreak 状态
  // 逻辑零改动（保留所有 run-XX 教训沉淀）
  let streamToolCallCount = 0;
  let inGraceWindow = false;
  let graceStepCount = 0;
  let hardBreak = false;
  let gotReport = false;
  const graceSteps = (step === 'coverage' || step === 'consolidate')
    ? GRACE_STEPS_ANALYSIS : GRACE_STEPS_DEFAULT;

  const streamHandler = (chunk) => {
    for (const [, delta] of Object.entries(chunk)) {
      const msgs = delta?.messages;
      if (!Array.isArray(msgs)) continue;
      for (const msg of msgs) {
        // 检测 AI 消息是否有非空 content（报告文本）
        if (msg?._getType?.() === 'ai') {
          const c = msg?.content;
          let textContent = '';
          if (typeof c === 'string') textContent = c;
          else if (Array.isArray(c)) textContent = c.map(x => typeof x === 'string' ? x : x?.text ?? '').join('');
          // 窗口期内检测报告质量
          if (inGraceWindow && isReportText(textContent)) {
            gotReport = true;
            console.log(`  ✅ [${step}#V] 写报告窗口内捕获到报告文本（${textContent.length} 字符）`);
          }
        }

        // 工具调用计数
        if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
          for (const tc of msg.tool_calls) {
            streamToolCallCount++;
            console.log(`  → [${step}#V] tool #${streamToolCallCount}: ${tc.name}`);
          }
        }
      }
    }

    // L2：撞硬上限 → 进入 grace window
    if (streamToolCallCount >= TOOL_HARD_LIMIT && !inGraceWindow && !hardBreak) {
      inGraceWindow = true;
      console.warn(`  ⏳ [${step}#V] 工具调用 ${streamToolCallCount} 次撞硬上限，进入 ${graceSteps} 步写报告窗口`);
    }

    // Grace window 倒计时
    if (inGraceWindow && !gotReport && !hardBreak) {
      graceStepCount++;
      if (graceStepCount >= graceSteps) {
        hardBreak = true;
        console.warn(`  🛑 [${step}#V] 写报告窗口耗尽（${graceSteps} 步），模型仍未输出文本，强制中断`);
        return { hardBreak: true };
      }
    }

    // 窗口期内拿到报告 → 正常结束
    if (gotReport) {
      console.log(`  📝 [${step}#V] 报告已捕获，正常结束`);
      return { hardBreak: true };
    }

    return {};
  };

  const invokeAgent = async () => {
    // v1.4.3 性能优化（run-16 实测拍板）：判断层直走裸 LLM 报告生成，跳过
    // DSH 桥接 worker 空转。依据：
    //   ① 方案 A 语义下证据 100% 在 prompt（precheckEvidence 随 userMessage
    //      注入）——worker 的 bash/fs 工具链对「读证据写判定」零增益；
    //   ② run-16 实测 DSH 桥接四步全部空转 175-359s 后吐空 stdout（headless
    //      子进程内撞同类超时/空响应），再落到裸 LLM 兜底——纯负资产双跑；
    //   ③ 裸 LLM 流式路径（run-16 修复②）已产出高质量判定书（regression
    //      4310 字符，P0/P1 结构完整，还能反向抓门禁假绿）。
    // 逃生舱：FORGE_WORKER=dsh 显式要求时仍走完整 worker（DSH 链路诊断用）。
    if (process.env.FORGE_WORKER !== 'dsh') {
      console.log('[worker] 判断层直连模式（裸 LLM 流式，跳过 DSH 桥接空转）——FORGE_WORKER=dsh 可启用完整 worker');
      // v1.4.3（run-19 根因）：直连模式下证据面 = precheck 证据 + 上一步产物
      // （verdict/consolidate 无 precheck，inputs 产物是其唯一判定依据）
      // + run-07 P0-V1：acceptance 分片的日志分段证据
      const bare = await generateReportWithoutTools(model, [], step, 'V', stepDef, [precheckEvidence, inputsEvidence, shardEvidence].filter(Boolean).join('\n\n'));
      return { messages: [], content: bare ?? '', hardBreak: false, usage: undefined };
    }

    // v1.3.4 增量：通过 ExecutionBackend 调用 agent
    // v1.3.9（五）：执行层切 DSH 默认（fallback 保留作降级——DSH rc 期守卫
    // 拦截自动降级 LangGraph，DSH 正式版发布后无需改代码自动切换）
    // v1.4.0 修正（run-04/05 根因 + 用户拍板「必须走 DSH」）：worker **走 DSH**——
    //   实测 DSH headless 用自带 read/bash 工具链能完整完成 worker 判定流程
    //   （读 precheck/acceptance 文件 + 判定 + 输出报告，无需注入 sofagent 工具）。
    //   之前的「worker 强制 LangGraph」方向错误已回滚——DSH 工具面覆盖 worker 需求。
    // FORGE_BACKEND 可显式覆盖（逃生舱：FORGE_BACKEND=langgraph 走 LangGraph）。
    const { createExecutionBackend } = await import('../../engine/orchestrator/dist/execution-backend.js');
    const backendPref = process.env.FORGE_BACKEND === 'langgraph' ? 'langgraph' : 'dsh';
    const backend = await createExecutionBackend({ preferred: backendPref });
    console.log(`[worker] 执行后端：preferred=${backendPref} → actual=${backend.name}`);
    const execResult = await backend.execute({
      systemPrompt,
      task: userMessage,
      tools,
      modelConfig: { model, preModelHook },
      toolBudget: { softLimit: TOOL_SOFT_LIMIT, hardLimit: TOOL_HARD_LIMIT },
      recursionLimit,
      stateModifierFactory: buildStateModifier,
      streamHandler,
    });

    // 兼容下游 extractAgentText / extractUsage 的返回格式
    return {
      messages: execResult.rawMessages ?? [],
      content: execResult.output ?? '',   // DSH CLI 桥接无 rawMessages——output 是唯一文本面（ExecutionResult 标准字段）
      hardBreak: execResult.hardBreak || hardBreak,
      // v1.4.3 第六章步三同步受益：运行时级 usage 透传（DSH session.events
      // 自动计量——extractUsage 的 result.usage 路径优先命中，零手记）
      usage: execResult.runtimeUsage ?? undefined,
    };
  };

  const result = progressMw
    ? await progressMw.wrapModelCall({ step, role: 'V', model: cfg.model }, invokeAgent)
    : await invokeAgent();
  const latencyMs = Date.now() - t0;

  // 5b. 记录 usage
  try {
    recordUsage(runDir, step, role, cfg.model, result, latencyMs, target);
  } catch (usageErr) {
    console.warn(`[worker:${step}] usage 记录失败（不影响主流程）: ${usageErr.message}`);
  }

  // 6. 提取文本输出
  // v1.4.2 修复（run-11 根因）：兜底不再限 hardBreak——DSH 后端正常返回但 output
  // 为空（agent 在工具调用后未产出任何 assistant 文本，summarizeSession 扫事件流
  // 得空串）同样撞「Agent 未返回内容」整步作废。对齐 fresh-eyes-driver 三层兜底
  // （裸 LLM → 碎片合成 → 抛错）：文本为空即尝试裸 LLM 报告生成，precheckEvidence
  // 是 DSH 桥接下的唯一证据面（run-11 实证：regression/coverage 两 worker 均死于
  // 该场景，证据 32KB/34KB 全在 prompt 里，裸 LLM 完全可判）。
  let text = extractAgentText(result);
  if (!text) {
    console.warn(`  ┄ [${step}] agent 未输出文本${result?.hardBreak ? '（硬熔断后）' : '（正常返回但 content 空）'}，启动无工具裸 LLM 报告生成`);
    try {
      // v1.4.3（run-19）：兜底路径证据面与直连模式对齐（precheck + 上一步产物）
      text = await generateReportWithoutTools(model, result?.messages ?? [], step, 'V', stepDef, [precheckEvidence, inputsEvidence].filter(Boolean).join('\n\n'));
    } catch (bareErr) {
      console.warn(`  ┄ [${step}] 裸 LLM 报告生成失败: ${bareErr.message}`);
    }
    if (!text) {
      // 最终兜底：从工具结果碎片合成最小报告（对齐 fresh-eyes synthesizeReportFromMessages）
      text = synthesizeFallbackReport(step, [precheckEvidence, inputsEvidence].filter(Boolean).join('\n\n'));
    }
    if (!text) {
      throw new Error(`[worker:${step}] Agent 未返回内容（裸 LLM 兜底与碎片合成均失败）`);
    }
    console.log(`  ✅ [${step}] 兜底报告生成成功（${text.length} 字符，质量受限标注见报告内）`);
  }

  // 7. 写产物（release-gate 每步只产出 1 个文件）
  if (stepDef.outputs.length === 1) {
    const outPath = join(runDir, stepDef.outputs[0]);
    writeFileSync(outPath, text, 'utf-8');
    console.log(`[worker:${step}] 产物已写入 ${outPath}`);
  } else {
    const slices = sliceMultiOutput(text, stepDef.outputs);
    for (const filename of stepDef.outputs) {
      const outPath = join(runDir, filename);
      writeFileSync(outPath, slices[filename], 'utf-8');
      console.log(`[worker:${step}] 产物已写入 ${outPath}`);
    }
  }
}

/**
 * 按 `===FILE: <filename>===` 分隔符切片多产物输出。
 * v1.2.7 功能⑤：复用 driver-base 的 sliceMultiOutput 实现。
 */
const sliceMultiOutput = base.sliceMultiOutput;

/**
 * 从 DeepAgent invoke 结果中提取文本（兼容多种返回格式）。
 */
function extractAgentText(result) {
  if (typeof result === 'string') return result;
  // 直接有 content 字段（非 messages 结构）
  if (result?.content) {
    const content = result.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('');
    }
    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') return content.text;
      if (typeof content.content === 'string') return content.content;
      return JSON.stringify(content);
    }
  }
  // messages 数组结构（LangGraph stream 返回格式）
  if (result?.messages) {
    // 从后往前找最后一条「有报告级 content 的」AI 消息。
    //
    // v1.2.7 修复（同步自 fresh-eyes-driver run-07）：原来只要 text.trim()
    // 非空就返回，但 GLM 在硬熔断前的最后一条 AI message 可能是一句中间思考
    // 碎片（如"现在我已经有了所需的所有数据。让我阅读日志的中间部分..."），
    // 碎片被当成报告写入了产物文件。
    //
    // 报告质量门控：≥REPORT_MIN_CHARS 字符 或 含 ## 标题行（与 stream loop 的 isReportText 一致）。
    // 如果所有 AI message 都不达标 → 返回 null → 走 generateReportWithoutTools 降级。
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      const isAI = msg?._getType?.() === 'ai' || (msg?.tool_calls !== undefined && msg?.content !== undefined);
      if (!isAI) continue;

      const content = msg?.content;
      // 提取文本
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) text = content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('');
      else if (content && typeof content === 'object') {
        if (typeof content.text === 'string') text = content.text;
        else if (typeof content.content === 'string') text = content.content;
        else text = JSON.stringify(content);
      }
      // 报告质量门控：非空 + (≥REPORT_MIN_CHARS 字符 或 含 ## 标题行)
      if (text.trim() && isReportText(text)) return text;
    }
    // 所有 AI message 都不达标（碎片/中间思考）→ 返回空，让调用方走 generateReportWithoutTools。
    // 注意：硬中断场景下最后一条可能是 ToolMessage（工具返回值），不能把工具返回值当报告。
    return '';
  }
  // 最终 fallback——避免 String(object) 产出 "[object Object]"
  if (result && typeof result === 'object') {
    return JSON.stringify(result);
  }
  return String(result ?? '');
}

/**
 * 硬熔断后的无工具裸 LLM 报告生成。
 *
 * 当 agent 撞硬上限（TOOL_HARD_LIMIT + 零窗口）仍未输出文本时，
 * 从 ToolMessage 中提取摘要，构造无 tools 的 prompt 让模型直接输出报告。
 *
 * v1.2.7：从 fresh-eyes-driver.mjs 同步——release-gate 和 fresh-eyes 共享
 * 相同的熔断架构，需要相同的降级策略，否则 release-gate 撞硬上限后直接 throw。
 *
 * @param {object} model    已初始化的 LLM 实例（ChatOpenAI）
 * @param {Array}  messages agent 执行期间累积的消息列表
 * @param {string} step     当前步骤名（acceptance/regression/coverage/consolidate/verdict）
 * @param {string} role     角色名（release-gate 固定为 'V'）
 * @param {object} stepDef  步骤定义（含 outputs 数组）
 * @param {string} [precheckEvidence] v1.4.0：driver 预执行的 precheck 证据文本
 *   （DSH 桥接无 tool messages 时作为兜底报告的判定依据，见 buildPrecheckEvidence）
 * @returns {Promise<string|null>} 报告文本，或 null（生成失败）
 */
async function generateReportWithoutTools(model, messages, step, role, stepDef, precheckEvidence) {
  // 1. 从工具结果中提取关键摘要（文件路径 + grep 结果等）
  // 每个 ToolMessage 截取前 500 字符，去重后最多 20 条（~10K tokens prompt）
  const toolSummaries = [];
  for (const msg of messages) {
    if (msg?._getType?.() === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.trim()) {
        toolSummaries.push(content.slice(0, 500).trim());
      }
    }
  }
  const unique = [...new Set(toolSummaries)].slice(0, 20);

  // 2. 构造裸 LLM 请求——无 tools，只有 system + user 消息
  const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');

  // v1.4.0：DSH 桥接下 messages 为空（无 rawMessages），precheckEvidence 是唯一证据面——
  // 把它注入报告生成上下文，避免兜底报告永远「0 条工具结果」判 FAIL
  const evidenceBlocks = [];
  if (unique.length > 0) {
    evidenceBlocks.push(`以下是 ${unique.length} 条工具结果摘要：\n---\n${unique.map((s, i) => `[${i + 1}] ${s}`).join('\n')}\n---`);
  }
  if (precheckEvidence) {
    evidenceBlocks.push(`以下是 driver 预执行的 precheck 证据（命令已由 driver 执行，直接据此判定，无需再调用工具）：\n---\n${precheckEvidence}\n---`);
  }

  const reportPrompt = [
    '你是发版闸门审查报告生成器。以下是之前审查过程中工具调用的结果摘要。',
    '请基于这些信息，写出完整的审查报告。',
    '',
    '报告要求：',
    `- 步骤：${step}（角色 ${role}）`,
    `- 产物文件：${(stepDef?.outputs ?? ['report.md']).join(', ')}`,
    '- 每条发现标注优先级：P0（严重/阻塞）/ P1（应该修）/ P2（观察项）',
    '- 给出文件路径和具体描述',
    '- 基于摘要中能看到的实际证据做判断——如果摘要中有明确的代码/配置/路径问题，标 P0 或 P1',
    '- 只有当摘要信息确实不足以确认时才标 P2"待证实"',
    '- 用中文写，Markdown 格式',
    '',
    ...(evidenceBlocks.length > 0
      ? evidenceBlocks
      : ['（本次审查没有任何工具结果或 precheck 证据——如实说明证据缺失，不要编造）']),
  ].join('\n');

  const reportMessages = [
    new SystemMessage('你是 sofagent 项目的发版闸门独立审查者。现在需要你根据已有工具调用结果写出审查报告。不调用任何工具，直接输出报告文本。'),
    new HumanMessage(reportPrompt),
  ];

  // 3. 裸调用——不带 tools，模型只能输出文本。
  // run-15 修复：invoke→stream——流式首字节早、TCP 保活，thinking 模型
  // 长思考不再撞 headersTimeout（invoke 一次性等完整响应最脆弱）。
  let respText = '';
  try {
    const stream = await model.stream(reportMessages);
    for await (const chunk of stream) {
      const c = typeof chunk === 'string' ? chunk : (chunk?.content ?? '');
      if (typeof c === 'string') respText += c;
      else if (Array.isArray(c)) respText += c.map(x => (typeof x === 'string' ? x : x?.text ?? '')).join('');
    }
  } catch (streamErr) {
    // 流式失败回退 invoke（双路径防 stream 接口在部分适配器上不可用）
    const response = await model.invoke(reportMessages);
    respText = typeof response === 'string' ? response : (response?.content ?? '');
  }
  // 处理数组格式 content
  if (Array.isArray(respText)) {
    return respText.map(x => typeof x === 'string' ? x : x?.text ?? '').join('');
  }
  return typeof respText === 'string' && respText.trim() ? respText : null;
}

/**
 * v1.4.2（run-11 根因）：裸 LLM 也失败时的最终兜底——基于 precheckEvidence
 * 合成结构化占位报告（对齐 fresh-eyes synthesizeReportFromMessages 的「降级
 * 不丢证据」原则）。DSH 桥接下 messages 为空数组，工具结果不可得，precheck
 * 证据是唯一可用素材。产物明确标注「质量受限」，让下游 consolidate/verdict
 * 能识别这是降级判定而非正常 worker 判定。
 *
 * @param {string} step             步骤名
 * @param {string} precheckEvidence driver 预执行的 precheck 证据文本
 * @returns {string}                占位报告文本，证据也缺时返回空串
 */
function synthesizeFallbackReport(step, precheckEvidence) {
  if (!precheckEvidence) return '';
  return [
    `## ${step} 判定报告（降级生成——质量受限）`,
    '',
    '> ⚠️ **本报告由 driver 兜底合成**：worker agent 未产出文本，裸 LLM 生成亦失败。',
    '> 判定依据为 driver 预执行的 precheck 证据（命令已实际执行，结果真实），',
    '> 但未经 worker 语义审查——请主 session 复验后采信。',
    '',
    '--- precheck 证据（判定依据） ---',
    precheckEvidence,
    '',
    '---',
    `**降级占位**：${step} 未经独立语义判定，按 fail-closed 原则交由 verdict 步骤裁量。`,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════
//  Driver 模式 — 编排 5 步线性验证
// ═══════════════════════════════════════════════════════════

/**
 * 生成 run 目录路径：runs/release-gate-loop/YYYY-MM-DD/run-NN/
 * 单轮结构，无 round 子目录。
 */
function resolveRunDir(dryRun = false) {
  // dry-run 改道 /tmp 草稿目录：dry-run 全部落盘（status.json/latest.json/
  // round 目录）自动进草稿，runs/ 正式编号零污染（run-02~09 全是烟测 DRY-RUN
  // 残留的根因修复——烟测调 --dry-run 曾每次 mkdir 2 个正式 run 目录）。
  if (dryRun) {
    const runDir = join(os.tmpdir(), 'forge-dryrun', `release-gate-${process.pid}-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    return { runDir, runId: 'dry-run', dateStr: 'dry-run' };
  }
  const now = new Date();
  const y  = String(now.getFullYear());
  const m  = String(now.getMonth() + 1).padStart(2, '0');
  const d  = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  const workflowDir = join(RUNS_DIR, 'release-gate-loop');
  const dateDir = join(workflowDir, dateStr);

  let runNum = 1;
  if (existsSync(dateDir)) {
    const existing = readdirSync(dateDir)
      .filter(n => n.startsWith('run-'))
      .map(n => parseInt(n.replace('run-', ''), 10))
      .filter(n => !isNaN(n));
    if (existing.length > 0) runNum = Math.max(...existing) + 1;
  }

  const runDir = join(dateDir, `run-${String(runNum).padStart(2, '0')}`);
  mkdirSync(runDir, { recursive: true });
  return { runDir, runId: `${y}${m}${d}-${String(runNum).padStart(2, '0')}`, dateStr: `${y}-${m}-${d}` };
}

/**
 * v1.2.8 功能⑦：从已有 run 目录反推 runId / dateStr（resume 模式复用已有目录）。
 * run 目录结构：RUNS_DIR/release-gate-loop/YYYY-MM-DD/run-NN/
 *
 * @param {string} runDir - 已有 run 目录绝对路径
 * @returns {{runDir: string, runId: string, dateStr: string}}
 */
function resolveRunDirInfo(runDir) {
  const runName = basename(runDir);              // run-03
  const dateDir = basename(dirname(runDir));     // 2026-08-07
  const runNumStr = runName.replace('run-', '').padStart(2, '0');
  const digits = dateDir.replace(/-/g, '');
  return { runDir, runId: `${digits}-${runNumStr}`, dateStr: dateDir };
}

/**
 * v1.2.8 功能⑦：--resume 时自动发现最近的 run 目录。
 *
 * release-gate-loop 不写 latest.json 指针，直接扫目录：
 * 日期目录倒序 → 每天取最大的 run-NN。
 *
 * 铁律：只读发现，不修改任何已有产物。
 *
 * @returns {string|null} 最近的 run 目录绝对路径；无任何历史 run 时返回 null
 */
function discoverLatestRunDir() {
  const workflowDir = join(RUNS_DIR, 'release-gate-loop');
  if (!existsSync(workflowDir)) return null;
  const dates = readdirSync(workflowDir)
    .filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort()
    .reverse();
  for (const dateStr of dates) {
    const dateDir = join(workflowDir, dateStr);
    const nums = readdirSync(dateDir)
      .filter(n => n.startsWith('run-'))
      .map(n => parseInt(n.replace('run-', ''), 10))
      .filter(n => !isNaN(n));
    if (nums.length > 0) {
      const runDir = join(dateDir, `run-${String(Math.max(...nums)).padStart(2, '0')}`);
      if (existsSync(runDir)) return runDir;
    }
  }
  return null;
}

/**
 * 起一个 worker 子进程（真·零上下文：独立 node 进程）。
 * 返回 Promise，resolve 时子进程已退出。
 *
 * @param {string} step      步骤名
 * @param {string} runDir    run 目录绝对路径
 * @param {string} target    验证目标版本号
 */
function spawnWorker(step, runDir, target) {
  return new Promise((resolveP, rejectP) => {
    // v1.3.6 交付⑩：worktree 隔离透传——worker 读 FORGE_WORKTREE_ROOT 后把
    // run_bash cwd / 项目根目录全部切到副本（f-fix 改代码零污染主仓）。
    const env = { ...process.env };
    if (globalWorktree && globalWorktree.worktreeDir) {
      env.FORGE_WORKTREE_ROOT = globalWorktree.worktreeDir;
    }
    // v1.3.6 OOM 修复（run-05 事故）：worker 此前裸 spawn（默认 heap 可膨胀至
    // ~4GB），6 并发即压垮 8GB 机器。对齐 fresh-eyes worker 的 1024MB heap 上限
    // ——grep/read 型轻负载够用，并发 6 也只占 ≤6GB heap 上限，配合并发 clamp 双保险。
    const child = spawn(process.execPath, [
      '--max-old-space-size=1024',
      __filename,
      '--worker',
      '--step', step,
      '--run-dir', runDir,
      '--target', target,
    ], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'inherit', 'inherit'],
      env,
    });

    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`worker ${step} 退出码 ${code}`));
    });
    child.on('error', rejectP);
  });
}

/**
 * v1.2.9 功能①：并行执行 acceptance 分片 worker（带并发限制）。
 *
 * 并发池模式（v1.4.3 性能优化）：N 个 lane 常驻，worker 完成立刻补位下一个——
 * 替代原批次模式（每 concurrency 个一批、整批 Promise.allSettled 等齐再开下
 * 一批）的「批间长尾空转」：批内最慢 worker 拖住整批，快 worker 早已闲置。
 * 12 片按完成顺序补位，总耗时 ≈ 最慢 lane 的累计而非「每批最慢者之和」。
 * 结果按 workers 输入顺序回填（完成顺序无关，下游 consolidate 拿到稳定序）。
 *
 * @param {Array<[string,string,string]>} workers  [step, runDir, target] 元组数组
 * @param {string} _target  验证目标版本号（当前未使用，预留）
 * @param {number} maxConcurrency  最大并发数
 * @returns {Promise<{results: Array, failures: Array}>}
 */
async function spawnAcceptanceShards(workers, _target, maxConcurrency = 6) {
  const concurrency = Math.max(1, Math.min(maxConcurrency, workers.length));
  const results = new Array(workers.length);
  const failures = [];
  let nextIndex = 0;

  console.log(`  [acceptance 并发池] ${workers.length} 个 shard，${concurrency} lane 常驻补位`);

  const lane = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= workers.length) return;
      const [step, runDir, target] = workers[i];
      try {
        results[i] = { step, value: await spawnWorker(step, runDir, target) };
      } catch (reason) {
        results[i] = { step, value: null };
        failures.push({ step, reason });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => lane()));
  return { results, failures };
}

/**
 * 执行环境指纹自检（run-15/16/17 假红事故根因防御）。
 *
 * 事故复盘：driver 由 AI session 在 WorkBuddy 沙箱内启动时，子进程 PATH 首位被
 * 注入 brokered-bin/toybox（busybox 系）——BRE 交替 `\|` 按字面量匹配、wc 无
 * 右对齐补齐、报错无换行粘连。96 维 precheck 中所有依赖 `\|` 交替、括号表达式、
 * wc 格式的检查集体假红（run-17 实测 30/96 维 FAIL），LLM 判断层吃全假数据产出
 * 误导性 NO-GO。独立终端原生跑（BSD 工具链）无此问题（run-14 全绿对照）。
 *
 * 三指纹（run-15~17 实测提炼，缺一不可）：
 *   ① grep BRE 交替：`echo x | grep -q "a\|x"`——busybox 系把 `\|` 当字面量，
 *      永不命中；BSD/GNU grep 正常命中（exit 0）
 *   ② wc 输出格式：`echo hi | wc -l`——BSD/GNU 右对齐补齐（前导空格），
 *      busybox 系无补齐
 *   ③ PATH 注入探测：process.env.PATH 首段含 brokered-bin/toybox 字样
 *
 * v1.4.3 自愈升级（用户拍板「修复成可以在 WorkBuddy 里跑的状态」）：检测到
 * 污染指纹不再直接拒跑，而是先自愈——净化 PATH（剥掉所有 brokered-bin/toybox
 * 段）+ 剥 BASH_ENV（沙箱注入的 bash 启动脚本）→ 重测三指纹 → 通过则继续跑。
 * 仍不通过才 fail-closed 拒跑。这样 driver 可直接在 AI session 内启动
 * （run-18+ WorkBuddy 内跑），独立终端原生跑不受影响（零指纹命中零净化）。
 */
function assertNativeToolchain() {
  const collectFingerprints = () => {
    const fingerprints = [];
    // 指纹③：PATH 首段注入探测（最直接，但沙箱形态可能演化，仅作辅助）。
    // 注意分隔符是 PATH 列表分隔符（macOS/Linux 为 ':'），不是路径分隔符 '/'。
    const pathFirst = (process.env.PATH || '').split(':')[0] || '';
    if (/brokered-bin|toybox/i.test(pathFirst)) {
      fingerprints.push(`PATH 首段含沙箱工具目录: ${pathFirst}`);
    }
    try {
      // 指纹①：BRE 交替——busybox/toybox grep 不支持（当字面量，永不命中）
      const r1 = spawnSync('bash', ['-c', 'echo x | grep -q "a\\|x"'], { encoding: 'utf8', timeout: 5000 });
      if (r1.status !== 0) fingerprints.push(`grep BRE 交替 "\\|" 失效（exit=${r1.status}）——busybox/toybox 系工具链`);
      // 指纹②：wc 补齐——BSD/GNU 右对齐带前导空格，busybox 系裸输出
      const r2 = spawnSync('bash', ['-c', 'echo hi | wc -l'], { encoding: 'utf8', timeout: 5000 });
      if (r2.status === 0 && r2.stdout && !/^\s+\d/.test(r2.stdout)) {
        fingerprints.push(`wc -l 输出无右对齐补齐（"${r2.stdout.trim()}"）——busybox/toybox 系工具链`);
      }
    } catch (fpErr) {
      // 自检自身异常——fail-closed：宁可拒跑也不在不可信环境执行 96 维门禁
      console.error(`[driver] 环境指纹自检执行异常: ${fpErr.message}`);
      console.error('[driver] fail-closed 拒跑——请检查 bash/grep/wc 可用性后重试。');
      process.exit(1);
    }
    return fingerprints;
  };

  let fingerprints = collectFingerprints();

  // ── 自愈路径：检测到污染先净化，净化后复测通过则继续跑 ──
  if (fingerprints.length > 0) {
    console.warn('[driver] ⚠️ 检测到沙箱工具链污染指纹——启动自愈（净化 PATH + 剥 BASH_ENV）：');
    for (const f of fingerprints) console.warn(`[driver]   · ${f}`);

    // 一、净化 PATH：剥掉所有含 brokered-bin/toybox 的段（不只首段——沙箱可能多处注入）
    const origPath = process.env.PATH || '';
    const cleanedSegs = origPath.split(':').filter(seg => seg && !/brokered-bin|toybox/i.test(seg));
    const removedSegs = origPath.split(':').filter(seg => seg && /brokered-bin|toybox/i.test(seg));
    if (removedSegs.length > 0) {
      process.env.PATH = cleanedSegs.join(':');
      console.log(`[driver] 自愈①：PATH 已剥 ${removedSegs.length} 个沙箱段（${removedSegs.map(s => s.split('/').pop()).join(', ')}）`);
    }
    // 二、剥 BASH_ENV：沙箱常以 BASH_ENV 注入 bash 启动脚本（可能重挂污染 PATH/alias）
    if (process.env.BASH_ENV) {
      console.log(`[driver] 自愈②：BASH_ENV 已剥（原值 ${process.env.BASH_ENV}）`);
      delete process.env.BASH_ENV;
    }
    // 三、复测：净化后再跑三指纹，全部通过才放行
    const after = collectFingerprints();
    if (after.length === 0) {
      console.log('[driver] ✅ 自愈成功——净化后三指纹全部通过（BRE 交替/wc 补齐/PATH 首段正常），继续执行');
    } else {
      console.error('[driver] 🔴 自愈失败——净化后仍有指纹命中：');
      for (const f of after) console.error(`[driver]   · ${f}`);
      console.error('[driver] fail-closed 拒跑：净化后工具链仍不可信，BRE 交替/括号表达式/wc 格式类维度检查将集体假红（run-15/16/17 实测 30/96 维）。');
      console.error('[driver] 处置：请在独立终端原生启动 driver，或检查沙箱 broker 的 PATH 注入策略。');
      process.exit(1);
    }
    return;
  }
  console.log('[driver] 环境指纹自检通过（BSD/GNU 原生工具链，BRE 交替/wc 补齐正常）');
}

/**
 * 运行一个 shell 命令并等待完成（用于 driver 直接执行，无 run_bash 60s 限制）。
 *
 * @param {string} command    shell 命令
 * @param {string} cwd        工作目录
 * @param {number} timeoutMs  超时（毫秒）
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runCommand(command, cwd, timeoutMs) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn('bash', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectP(new Error(`命令超时 (${timeoutMs}ms): ${command}`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolveP({ stdout, stderr, code });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      rejectP(err);
    });
  });
}

/**
 * driver 直接预跑 acceptance-test.sh（绕过 LLM agent 的 60s 限制）。
 *
 * 流程：
 *   1. 先 cd engine/audit && npm run build（acceptance-test.sh 依赖 dist 产物）
 *   2. spawn bash acceptance-test.sh，等待完成（Node.js 没有 60s 限制）
 *   3. 完整输出写入 {runDir}/acceptance-raw.log
 *
 * 即使预跑失败也不中断——把错误写入 acceptance-raw.log，让 worker 从错误日志生成报告。
 *
 * @param {string} runDir   run 目录绝对路径
 * @returns {Promise<{ exitCode: number, logPath: string, stdout: string }>}
 */
async function runAcceptanceTestDirectly(runDir) {
  const logPath = join(runDir, 'acceptance-raw.log');
  const scriptPath = join(REPO_ROOT, 'FORGE/playbook/acceptance-test.sh');

  // 第 1 步：构建审计包（acceptance-test.sh 依赖 dist 产物）
  // 优化：dist/index.js 已存在时跳过 build，减少 driver 被 sandbox kill 的窗口
  const auditDist = join(REPO_ROOT, 'engine/audit/dist/index.js');
  if (existsSync(auditDist)) {
    console.log('[driver] 审计包 dist 已存在，跳过 build');
  } else {
    console.log('[driver] 预跑 acceptance-test.sh — 先构建审计包 (engine/audit)...');
    try {
      const buildResult = await runCommand(
        'npm run build',
        join(REPO_ROOT, 'engine/audit'),
        120_000,
      );
      if (buildResult.code !== 0) {
        console.warn(`[driver] 构建审计包退出码 ${buildResult.code}（继续尝试运行测试）`);
      } else {
        console.log('[driver] 审计包构建完成');
      }
    } catch (buildErr) {
      console.warn(`[driver] 审计包构建失败（继续尝试运行测试）: ${buildErr.message}`);
    }
  }

  // 第 2 步：直接 spawn acceptance-test.sh，driver 等待完成
  // v1.2.5 加固：流式写入日志（sandbox kill 时已捕获部分不丢失）+ progress 日志 + signal 处理
  const ACCEPTANCE_TIMEOUT_MS = 900_000; // 15 分钟（比 sandbox kill 窗口长，但不至于等太久）
  console.log(`[driver] 开始运行 acceptance-test.sh（超时 ${ACCEPTANCE_TIMEOUT_MS / 60_000} 分钟）...`);
  const startTime = Date.now();

  const result = await new Promise((resolveP, rejectP) => {
    const child = spawn('bash', [scriptPath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let lastProgressLog = Date.now();

    // 流式写入：收到数据就追加到日志文件（sandbox kill 时已捕获部分不丢失）
    const writeStream = createWriteStream(logPath, { flags: 'w' });

    child.stdout.on('data', (d) => {
      stdout += d;
      writeStream.write(d);
      // 每 30s 输出一次进度（便于诊断卡住位置）
      if (Date.now() - lastProgressLog > 30_000) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const lastLine = stdout.trim().split('\n').pop()?.slice(0, 80) || '(empty)';
        console.log(`[driver] acceptance-test.sh 运行中... ${elapsed}s, 已捕获 ${stdout.length} bytes, 末行: ${lastLine}`);
        lastProgressLog = Date.now();
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      writeStream.write(d);
    });

    // 超时处理
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      writeStream.end(`\n--- DRIVER TIMEOUT (${ACCEPTANCE_TIMEOUT_MS}ms) ---\n`);
      rejectP(new Error(`acceptance-test.sh 超时 (${ACCEPTANCE_TIMEOUT_MS}ms)`));
    }, ACCEPTANCE_TIMEOUT_MS);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      writeStream.end(stderr ? `\n--- STDERR ---\n${stderr}` : '');
      const fullLog = stdout + (stderr ? '\n--- STDERR ---\n' + stderr : '');
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      // v1.2.5: 处理 signal——被 sandbox kill 时 code=null, signal='SIGTERM'/'SIGKILL'
      if (signal) {
        console.warn(`[driver] acceptance-test.sh 被信号终止: ${signal}（可能是 sandbox kill），耗时 ${elapsed}s，已捕获 ${stdout.length} bytes`);
      } else {
        console.log(`[driver] acceptance-test.sh 完成，exit code = ${code}，耗时 ${elapsed}s`);
      }
      resolveP({ exitCode: code ?? -1, logPath, stdout: fullLog });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      writeStream.end();
      rejectP(err);
    });
  });

  console.log(`[driver] 日志已流式写入 ${logPath}`);

  return result;
}

// ═══════════════════════════════════════════════════════════
// v1.2.5+ 性能优化：regression 预执行器（方案 A：执行层从 LLM 剥离）
// ═══════════════════════════════════════════════════════════
// 背景：run-02 实测 regression worker 跑了 1665 个工具调用、耗时 ~50 分钟，
//   worker 在模型写完报告前被 GraphRecursionError(limit=400) 截断崩溃。
//   根因：regression-checklist.md 的命令是确定性的，但 LLM 逐维度探索执行，
//   大量重复读文件/乱试命令/失败重试，把「确定性检查」跑成了「探索型任务」。
// 方案：driver 直接解析 checklist 的 ```bash 代码块并按维度批量执行（零 LLM），
//   结果写入 {runDir}/regression-precheck.json。worker 只读该文件判定 PASS/FAIL，
//   工具调用从 1665 次降到 ~5 次，消除递归超限 + 大幅提速。

/**
 * 解析 regression-checklist.md，提取每个维度的 bash 代码块。
 * 锚点：`#### N. 维度标题`；块：维度内所有 ```bash ... ``` 代码块。
 * 跳过维度外的代码块（如「清单自身健康度自校验」）。
 *
 * @returns {Array<{ num: number, title: string, script: string }>}
 */
function parseRegressionDimensions() {
  const checklistPath = join(REPO_ROOT, 'FORGE/playbook/regression-checklist.md');
  const md = readFileSync(checklistPath, 'utf-8');
  const lines = md.split('\n');

  const dims = [];
  let current = null;       // { num, title, blocks: [] }
  let inCode = false;
  let codeBuf = [];
  let manualFlag = false;   // v1.4.0：人工核对项标记（维度 94 实证——占位命令被 worker 当真执行致崩溃）

  const flushCode = () => {
    if (current && codeBuf.length > 0) {
      current.script = (current.script || '') + codeBuf.join('\n') + '\n';
    }
    codeBuf = [];
  };

  for (const line of lines) {
    const dimMatch = line.match(/^####\s+(\d+)\.\s+(.*)$/);
    if (dimMatch) {
      flushCode();
      current = { num: parseInt(dimMatch[1], 10), title: dimMatch[2].trim(), script: '' };
      dims.push(current);
      manualFlag = false;   // 每个维度重置
      continue;
    }
    // v1.4.0：人工核对项标记检测——checklist 用「⚠️ 本维度是**人工核对项**…不要作为命令直接执行」标注。
    // 这种维度的代码块是操作指引（含 <script.sh> 占位符），不是可执行命令——worker 执行会崩（No such file）。
    // 命中后丢弃当前维度的脚本，worker 判定时按「人工核对」处理。
    if (current && /人工核对项|不要作为命令直接执行/.test(line)) {
      manualFlag = true;
      current.script = '';  // 清空已收集的脚本
    }
    if (/^```bash\s*$/.test(line)) {
      flushCode();           // 上一个块收尾（如有）
      inCode = true;
      codeBuf = [];
      continue;
    }
    if (/^```\s*$/.test(line)) {
      flushCode();
      inCode = false;
      continue;
    }
    if (inCode && current && !manualFlag) {
      codeBuf.push(line);
    }
    // 维度外的代码块（current === null 或不在维度内）忽略
  }
  flushCode();

  return dims.filter(d => d.script.trim().length > 0);
}

/**
 * 执行一个维度的 bash 脚本（单次 runCommand，无 60s 限制），捕获输出。
 * 失败不中断——exitCode 和 output 都记录，交给 worker 判定。
 *
 * v1.3.6 exit 语义归一化（release-gate run-08/09 两轮假 FAIL 根治）：
 *   checklist 45/87 维的尾命令是「grep 无命中=1」「循环尾判假=1」「grep -q X && echo ⚠️
 *   未命中=1」等语义——健康态本身返回非零，driver 记 exitCode!==0 后 worker 必误判 FAIL。
 *   逐维改脚本永远改不完（45 处且新增维度还会犯），在执行层归一：
 *   ① 退出码非零但输出无任何失败标记（❌/FAIL/⚠️/缺失/漂移/超标/CRITICAL）→ 判定
 *      信号重写为 0，并在 output 追加归一化说明（worker 与人工可追溯）
 *   ② 输出含失败标记 → 保留原退出码（真 FAIL 不受影响）
 *   ③ 超时/异常（exitCode=null）不变
 *   注：⚠️ 是 checklist 的 WARN 语义（缺失警告），保守归入失败标记——worker 可按
 *   ⚠️ 降级为 WARN，但那是 worker 的判定自由，执行层不吞。
 */
async function execRegressionDim(script, timeoutMs = 60_000) {
  try {
    // v1.3.6 PROJECT_ROOT 注入（run-09 发现）：维度脚本大量引用 "$PROJECT_ROOT/..."，
    // 但 bash -c 子进程无此变量 → 展开为空 → grep "/engine/..." 路径断 → 断言全部
    // 未命中却因 || echo ⚠️ 收尾而 exit 0 逃过判定（#98/#99 双重 bug：路径断+假绿）。
    // 注入后 $PROJECT_ROOT 正确指向仓库根，脚本按设计路径执行。
    const script2 = `export PROJECT_ROOT="${REPO_ROOT}"\n${script}`;
    const { stdout, stderr, code } = await runCommand(script2, REPO_ROOT, timeoutMs);
    let output = `${stdout}\n${stderr}`.trim();
    let exitCode = code ?? null;
    // 归一化规则：非零退出 + 输出零失败标记 = 语义性退出码（grep 无命中等），非真 FAIL
    if (exitCode !== 0 && exitCode !== null && !/(❌|FAIL|⚠️|缺失|漂移|超标|CRITICAL)/.test(output)) {
      output += `\n[driver] exit 语义归一化：原 exit=${exitCode} 但输出无失败标记——判定为语义性退出码（grep 无命中/尾判假），重写为 0。若该维度确有问题，请在维度脚本补显式 ❌ 输出（见 regression-checklist.md 维护公约·维度脚本编写三铁律）`;
      exitCode = 0;
    }
    // run-16 修复（R-01 假绿根因）：反向防御——exit=0 但输出含显式 ❌。
    // 维度脚本用 `cmd || echo "❌ ..."` 收尾时 || 分支保证整体 exit 0，❌ 漏网
    // （run-16 实测 6 维度：51/113/115/123/126/128 全部假绿）。与既有归一化
    // 方向互补：那边防假 FAIL，这边防假绿。重写为 1 并追加说明（worker 与
    // 人工可追溯），宁可假红待复核也不吞真失败——fail-closed。
    // v1.4.3 修正（run-19/20 全量定谳，三个假红家族统一收敛）：❌ 判定
    // 改为「行首锚定」——真失败标记的形态是 ❌ 出现在行首（允许空白与
    // markdown 装饰前缀 > * # -）；行中 ❌ 一律视为内容引用，不触发翻转。
    // 三个假红家族：
    // ① 「✅ 行内引用」——checklist 收尾惯例 `echo "✅ 三 tools 齐（若上方
    //    无 ❌）"`，健康态本身带 ❌ 字面量（run-19 dim 125/127）；
    // ② driver 自我消息污染——归一化文案含「补显式 ❌ 输出」字样，反向
    //    防御匹配到自己刚追加的 [driver] 说明行（run-20 dim 60/62）；
    // ③ grep 内容引用——维度脚本 grep 命中文档正文/脚本源码自带的 ❌
    //    字面量，如 enterprise-deploy.md 能力对照表、check-version.sh 的
    //    echo 语句（run-19/20 dim 1/3/8/64/95 五维，原生复跑实证为 PASS）。
    // 判定只看维度脚本真实输出（剥 [driver] 前缀行）+ 行首锚定。
    const userOutput = output.split('\n').filter(l => !l.startsWith('[driver]')).join('\n');
    if (exitCode === 0 && /^[\s>*#•·-]*❌/m.test(userOutput)) {
      output += `\n[driver] 反向防御：原 exit=0 但输出含显式 ❌——维度脚本以 || echo ❌ 收尾导致失败被 exit 0 掩盖（假绿），重写为 1。真失败见上方 ❌ 行；若为脚本误报请修脚本（见 regression-checklist.md 维度脚本编写三铁律）。`;
      exitCode = 1;
    }
    return { exitCode, output: output.slice(0, 8000) };
  } catch (err) {
    return { exitCode: null, output: `[driver] 执行异常: ${err.message}` };
  }
}

/**
 * 预执行全部 regression 维度，写 {runDir}/regression-precheck.json。
 *
 * 文件格式：
 * {
 *   "meta": { "source": "FORGE/playbook/regression-checklist.md", "dims": 49, "runAt": "..." },
 *   "dims": {
 *     "1": { "num": 1, "title": "CHANGELOG 纯度与完整性", "exitCode": 0, "output": "..." },
 *     ...
 *   }
 * }
 *
 * worker 依据 exitCode + output 判定 PASS/FAIL/⏰/⏸️，不再自己跑命令。
 *
 * @param {string} runDir  run 目录
 */
async function runRegressionPrecheck(runDir) {
  console.log('[driver] 预执行 regression-checklist（方案 A：命令执行从 LLM 剥离）...');
  const t0 = Date.now();
  const dims = parseRegressionDimensions();
  console.log(`[driver] 解析到 ${dims.length} 个维度（含 bash 代码块）`);

  const payload = {
    meta: {
      source: 'FORGE/playbook/regression-checklist.md',
      dims: dims.length,
      runAt: new Date().toISOString(),
      note: '由 driver 预执行生成（v1.2.5+ 方案 A）。worker 只读此文件判定，禁止重新执行命令。',
    },
    dims: {},
  };

  // ── 并行执行（run-16 性能优化：串行 775s → 并行 ~180s）──
  // 维度间无依赖（脚本只读仓库 + 写 tmp），但两类维度不能盲目并行：
  //   ① 重维度（106/110/111 跑全量测试门禁，150s 级 CPU 密集）
  //   ② 互踩型（同时跑 git/测试会互抢锁，如 audit 锁文件）
  // 策略：分两波——第一波并行跑全部轻维度（并发 6，8GB 安全值，FORGE
  // run-07 OOM 教训后的保守档），第二波串行跑重维度（DIM_TIMEOUT_OVERRIDE
  // 声明的 150s 档，它们本身含全量 test-count 会打满 CPU，串行反而总耗时
  // 更优且零互踩风险）。输出顺序仍按维度号排列（payload.dims 是 dict，
  // 写入顺序无关，但日志按 num 排序打印保持可读时间线）。
  const HEAVY_DIMS = new Set(Object.keys(DIM_TIMEOUT_OVERRIDE).map(Number));
  const lightDims = dims.filter(d => !HEAVY_DIMS.has(d.num));
  const heavyDims = dims.filter(d => HEAVY_DIMS.has(d.num));
  const concurrency = Math.min(6, lightDims.length || 1);

  const executeDim = async (dim) => {
    const timeout = DIM_TIMEOUT_OVERRIDE[dim.num] ?? 60_000;
    const { exitCode, output } = await execRegressionDim(dim.script, timeout);
    // v1.3.8 run-10 修复：output 按行截断（保留前 12 行 + 截断标记）。
    // 91 维 × 平均 567 字符 ≈ 51KB JSON → 555 行，worker 的 sf_read 上限 500 行
    // 读不全 → 末尾维度数据缺失（run-10：59/91 维不可判定）。按行截断后总量
    // 可控（≤ 91×(12+2) ≈ 1274 行 × JSON 转义 ≈ 仍可能超——故配合按字符截断，
    // 两者取先到者，实测单维 ≤12 行 + ≤400 字符后 JSON 总行数 < 500）。
    const MAX_DIM_LINES = 12;
    const MAX_DIM_CHARS = 400;
    let truncatedOutput = output;
    const outLines = output.split('\n');
    if (outLines.length > MAX_DIM_LINES) {
      truncatedOutput = `${outLines.slice(0, MAX_DIM_LINES).join('\n')}\n…[${outLines.length - MAX_DIM_LINES} 行截断——完整输出见维度脚本实跑]`;
    }
    if (truncatedOutput.length > MAX_DIM_CHARS) {
      // v1.4.3 修复（run-01 P1-4）：截断在多字节字符中间会产出 U+FFFD 乱码（维度 101
      // LIMIT_B= 值被切半）。按码点回退到完整字符边界再截；同时保护「数值关键行」——
      // LIMIT_B/LIMIT/期望/报告/exit 这类短判定行若被截掉，从原文补到尾部保证可见。
      // 关键行提取基于原始整行（output 变量），不基于截断残余——避免判定行横跨截断
      // 点时被切成两段都匹配不上。
      let cut = MAX_DIM_CHARS;
      while (cut > 0 && (truncatedOutput.codePointAt(cut) & 0xfc00) === 0xdc00) cut--;  // 跳过低代理
      while (cut > 0 && (truncatedOutput.codePointAt(cut - 1) >= 0xd800 && truncatedOutput.codePointAt(cut - 1) <= 0xdbff)) cut--;  // 不切代理对
      const head = truncatedOutput.slice(0, cut);
      const keyLineRe = /^[^\n]{0,80}(LIMIT_B?=|期望[=：]|报告[=：])[^\n]{0,40}$/gm;
      const tailKeep = (output.match(keyLineRe) || [])
        .filter(l => !head.includes(l) && !/^\s*$/.test(l)).slice(0, 5);
      truncatedOutput = head + (tailKeep.length ? '\n' + tailKeep.join('\n') : '') + `\n…[${truncatedOutput.length - cut} 字符截断${tailKeep.length ? '，关键行已保留' : ''}]`;
    }
    return {
      num: dim.num, title: dim.title, exitCode,
      output: truncatedOutput,
      truncated: outLines.length > MAX_DIM_LINES || output.length > MAX_DIM_CHARS,
      rawLen: output.length, lineCount: outLines.length,
    };
  };

  // 第一波：轻维度并行（并发池）
  const results = new Map();
  const queue = [...lightDims];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const dim = queue.shift();
      if (!dim) break;
      const r = await executeDim(dim);
      results.set(dim.num, r);
    }
  });
  await Promise.all(workers);
  // 第二波：重维度串行（全量测试门禁类，CPU 密集防互踩）
  for (const dim of heavyDims) {
    const r = await executeDim(dim);
    results.set(dim.num, r);
  }

  // 按维度号顺序写 payload + 日志（时间线可读）
  for (const num of [...results.keys()].sort((a, b) => a - b)) {
    const r = results.get(num);
    payload.dims[String(num)] = {
      num: r.num, title: r.title, exitCode: r.exitCode,
      output: r.output, truncated: r.truncated,
    };
    console.log(`  [precheck] 维度 ${r.num} ${r.title.slice(0, 24)}... exit=${r.exitCode ?? 'ERR'} (${r.rawLen}B${r.lineCount > 12 ? `→${r.lineCount} 行截断` : ''})`);
  }

  const outPath = join(runDir, 'regression-precheck.json');
  // v1.3.8 run-10 修复：紧凑格式写盘（单行 JSON）——sf_read 是「行数」限制非字符限制，
  // indent=2 格式化的 637 行结构开销（91 维 × 7 行）白白撞 500 行上限（run-10：59/91 维
  // 数据缺失实锤）。单行格式下 totalLines≈1 ≤ 500 → sf_read 整行全量返回，彻底绕过上限。
  writeFileSync(outPath, JSON.stringify(payload), 'utf-8');
  console.log(`[driver] regression-precheck.json 已写入 ${outPath}（${dims.length} 维度，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return outPath;
}

// ═══════════════════════════════════════════════════════════
// v1.2.5+ 性能优化：coverage 预执行器（方案 A 扩展到步骤③）
// ═══════════════════════════════════════════════════════════
// 背景：run-06 coverage worker 因注入的 changelog 路径错误（docs/changelog/v1.2.5.md
//   不存在，实际在 docs/changelog/v1.2/v1.2.5.md）陷入找文件死循环，39 个工具调用
//   后撞硬上限，写报告窗口耗尽被强杀（"Agent 未返回内容"）。
// 方案：driver 预解析 changelog 功能模块标题 + acceptance-test.sh 场景索引，
//   写入 coverage-precheck.json。worker 只读该文件做交叉判定，不再自行 find/grep。

/**
 * 解析 acceptance-test.sh 的场景索引（编号 + 标题）。
 * 格式：`scenario N "标题"`（可跨多行——标题在下一行；用正则宽松匹配）。
 *
 * @returns {Array<{ num: number, title: string }>}
 */
function parseAcceptanceScenarios() {
  const accPath = join(REPO_ROOT, 'FORGE/playbook/acceptance-test.sh');
  const src = readFileSync(accPath, 'utf-8');
  const scenarios = [];
  // 匹配 scenario <num> "<title>..."> 或 scenario <num> 换行 "<title>"
  // v1.4.0 修复（run-22 coverage P1-1 误报根因）：场景**内容字符串**里可能出现
  // 「...A19 scenario 48...」字样（echo 文案）——旧正则无行首锚定会误匹配为场景声明
  // （S48 title='>'）。要求 scenario 前是行首/换行（(^|\n)\s*）。
  const re = /(^|\n)\s*scenario\s+(\d+)\s*(?:\([^)]*\))?\s*"([^"]{0,120})/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const title = m[3].trim();
    if (title.length > 0) {
      scenarios.push({ num: parseInt(m[2], 10), title });
    }
  }
  return scenarios;
}

/**
 * 解析 changelog 的功能模块标题（## 开头的一级模块）。
 *
 * @param {string} changelogRelPath changelog 相对路径（resolveChangelogPath 结果）
 * @returns {Array<{ title: string }>}
 */
function parseChangelogModules(changelogRelPath) {
  const absPath = join(REPO_ROOT, changelogRelPath);
  if (!existsSync(absPath)) {
    console.warn(`[driver] changelog 不存在，模块解析为空: ${changelogRelPath}`);
    return [];
  }
  const md = readFileSync(absPath, 'utf-8');
  const modules = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^##\s+(.+)$/);
    if (m && !/^##\s+(背景|前置依赖|状态)/.test(line)) {
      modules.push({ title: m[1].trim() });
    }
  }
  return modules;
}

/**
 * 预执行 coverage 交叉检查的数据准备，写 {runDir}/coverage-precheck.json。
 *
 * 文件格式：
 * {
 *   "meta": { "changelogPath": "docs/changelog/v1.2/v1.2.5.md", "modules": N, "scenarios": M, "runAt": "..." },
 *   "changelog": [ { "title": "🔗 激活链 Phase 1：ACTIVATE" }, ... ],
 *   "scenarios": [ { "num": 1, "title": "..." }, ... ]
 * }
 *
 * worker 依据 changelog 模块 + 场景索引交叉判定覆盖情况，不再自行探索文件。
 *
 * @param {string} runDir  run 目录
 * @param {string} target  版本号
 * @returns {string} 产物路径
 */
async function runCoveragePrecheck(runDir, target) {
  console.log('[driver] 预执行 coverage（方案 A：场景索引 + changelog 模块从 LLM 剥离）...');
  const t0 = Date.now();

  const changelogRel = resolveChangelogPath(target);
  const changelogModules = parseChangelogModules(changelogRel);
  const scenarios = parseAcceptanceScenarios();

  const payload = {
    meta: {
      changelogPath: changelogRel,
      modules: changelogModules.length,
      scenarios: scenarios.length,
      runAt: new Date().toISOString(),
      note: '由 driver 预执行生成（v1.2.5+ 方案 A）。worker 只读此文件做覆盖交叉判定，禁止重新探索文件。',
    },
    changelog: changelogModules,
    scenarios,
  };

  const outPath = join(runDir, 'coverage-precheck.json');
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[driver] coverage-precheck.json 已写入 ${outPath}（${changelogModules.length} 模块 / ${scenarios.length} 场景，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return outPath;
}

/**
 * 从报告文本中提取裁决关键词（PASS/FAIL/SKIP）。
 *
 * v1.4.3：原为 parseVerdict 与 parseStepResults 内部各写一份、实现完全相同的
 * 嵌套函数（22 行 ×2）。提到模块级共用——两份副本是同一套解析纪律的两个拷贝，
 * 改一处漏一处就会让「verdict.md 判 FAIL」和「LEDGER 记 PASS」对不上，而这
 * 两者是发版门禁的最后两道口径，必须同源。
 *
 * 健壮性要点：
 *  1. 先剥离 ``` 围栏代码块——报告正文的日志转储/负向测试输出常含 FAIL 字样，
 *     它们不是裁决结论，必须先去除以免污染解析。
 *  2. 只在「判定」「结论」标记所在行及其紧邻窗口内提取结论词，
 *     绝不做「全文含 FAIL 即判 FAIL」这类脆弱兜底。
 *  3. 标记与结论词之间允许夹杂 emoji（✅/❌）、标点（：:）、空白与 markdown 符号；
 *     一旦出现中文或英文字母（如「判定理由」「判定为」）即中断匹配，
 *     防止误抓「无 FAIL 条目」「全部判定 PASS」这类无关句子。
 *     例外：表格标记「终审裁决」「最终裁决」「终审结论」单独放宽（允许中文前缀
 *     + \b 断词）——run-01/run-02/run-04 实证 LLM 把裁决写进表格行且每轮换标记词，
 *     严格正则抓不到导致 ERROR 记账；放宽仅限表格组标记。
 *  4. 同义裁决词（BLOCKED/BLOCK/NO-GO/HOLD/不予放行/不通过/阻塞/阻断）语义等价 FAIL
 *     （fail-closed），仅在标记紧邻窗口内匹配——见 run-16 修复；HOLD 为
 *     run-19 原生复跑新增（LLM 安全审查惯例措辞，driver 记账曾脱钩）；
 *     阻断为 run-04 实证新增（「阻断（BLOCKED）」与「阻塞」同义，链表此前漏收）。
 */
function extractVerdictKeyword(raw) {
  const stripped = raw.replace(/```[\s\S]*?```/g, '\n');
  const lines = stripped.split(/\r?\n/);
  // 标记分两组（run-01 补「终审裁决」，run-02 补「最终裁决」，run-04 补「终审结论」）：
  // 严格组（判定/结论）维持「中文即中断」纪律；表格组（终审裁决/最终裁决/终审结论）
  // ——LLM 把裁决写进表格行 `| **终审结论** | 🚫 **阻断（BLOCKED）…** |`，结论词前有
  // 中文（阻断），严格正则抓不到 → driver 记 ERROR 与内容裁决 FAIL 脱钩。故该组
  // 放宽为「允许中文/emoji/markdown 混合前缀」（\b 防 PASSword 类误抓）；同一
  // LLM 不同 run 会换表格标记词，同组收编，防逐词打补丁。
  // 分两级扫描（run-08 三修）：强标记组（专属裁决词）优先于普通组（判定/结论）。
  // 背景：verdict.md 实测裁决行「🚫 发版闸门维持 BLOCK」不含「判定/结论」字样，
  // 而正文叙述句「三项上游判定（…coverage 有条件通过…）」含「判定」——
  // 单层扫描时叙述句先于真裁决行命中。强组前置让专属裁决词的窗口（真裁决行
  // 就在其下）优先消费，叙述句窗口轮不到。
  const strongMarkers = ['终审裁决', '最终裁决', '终审结论', '最终裁定', '闸门判定', '闸门状态', '最终状态'];
  // 普通组收词纪律：仅收「裁决语境」词，靠普通组纪律（紧邻窗口 + 中文中断
  // + BLOCK 否决）防叙述句误抓。「裁决」：run-03 实证 LLM 把契约词「结果」
  // 漂成「裁决」（`- **裁决**：✅ **PASS**`），裸词不在词表 → regression 记
  // SKIP 与报告 PASS 脱钩；「结果」：prompt 模板格式契约词本身（「**结果**：
  // PASS 裸词独占一行」）——契约词必须在词表内闭环，否则 LLM 严格守约反被漏。
  // 「实测结果：exit=0」「结果显示」等叙述句由中文中断纪律挡住（为/显/依 均
  // 为中文，中断裸词匹配）。
  const plainMarkers = ['判定', '结论', '裁决', '结果'];
  const markers = [...strongMarkers, ...plainMarkers];
  // 普通组窗口含英文闸门否定词（BLOCK/NO-GO/HOLD）时拒判肯定语义——run-08 实证：
  // 叙述句窗口「acceptance BLOCK / regression PASS / coverage 有条件通过」同窗口
  // 混排多关卡词，肯定词命中会覆盖全文真实裁决 FAIL。强组窗口不受此限（强组
  // 词本身专属裁决语境，无叙述句混排问题）。passive 否决同时放行下一 marker 继续扫描。
  const NEGATION_EN = /BLOCKED|BLOCK|NO-GO|HOLD/;
  // 裸词右边界纪律：命中词后紧跟连字符 = 复合术语（fail-closed / pass-through
  // / fail-fast 等），不是裸裁决词。run-04 实证：regression.md 表格 meta 行
  // 「96 维度逐维度判定，fail-closed：超时=证据缺失=未通过」——「判定」标记后
  // 全角逗号（U+FF0C，不在中文中断排除集）穿透前缀量词，「fail」被 lazy 匹配
  // 抓走 → PASS 报告记 FAIL。捕获组终点 = match 终点回退词长（match.index 是
  // 整段前缀起点，不能直接用）。
  const isCompoundTerm = (text, match) => text[match.index + match[0].length] === '-';
  for (const marker of markers) {
    const isStrong = strongMarkers.includes(marker);
    for (let i = 0; i < lines.length; i++) {
      const col = lines[i].indexOf(marker);
      if (col === -1) continue;
      // 窗口 = 标记行剩余部分 + 后续 3 行
      const windowText = lines.slice(i, i + 4).join('\n').slice(col + marker.length);
      const re = isStrong
        ? /^[^A-Za-z]*?(PASS|FAIL|SKIP)\b/i
        : /^[^A-Za-z\u4e00-\u9fff]*?(PASS|FAIL|SKIP)/i;
      const m = windowText.match(re);
      if (m && !isCompoundTerm(windowText, m)) return m[1].toUpperCase();
      // run-16 修复：LLM 审查者常用同义裁决词（BLOCKED/BLOCK/NO-GO/不予放行/
      // 不通过/阻塞/HOLD）——语义全部等价 FAIL（fail-closed），不再误记 ERROR/SKIP。
      // 仅在「结论/判定」标记紧邻窗口内匹配，维持既有防误抓纪律。
      // HOLD：run-19 原生复跑实证——LLM 审查者按安全审查惯例写「HOLD（不放行）」，
      // 解析器未认导致 driver 记账 ERROR 与真实裁决脱钩。
      // 阻断：run-04 实证——「🚫 阻断（BLOCKED）」，与「阻塞」同义，链表此前漏收。
      const mBlock = windowText.match(/^[^A-Za-z\u4e00-\u9fff]*?(BLOCKED|BLOCK|NO-GO|HOLD)/i);
      if (mBlock && !isCompoundTerm(windowText, mBlock)) return 'FAIL';
      if (/^[^A-Za-z\u4e00-\u9fff]*(不予放行|不通过|未通过|不得放行|不放行|阻塞|阻断|暂缓放行)/.test(windowText)) return 'FAIL';
      // run-07 实证：coverage 报告写「有条件通过（CONDITIONAL PASS）」、regression 写
      // 「96/96 维度全部通过」——严格正则只认裸 PASS/FAIL 词，全数漏抓 → status.json
      // 记 SKIP，下游 consolidate/verdict 证据面失真。补「条件性通过/通过」语义组：
      // 「有条件通过」= PASS（条件在正文发现清单承载）。
      // run-08 三修：普通组（非强组）肯定语义前先做 BLOCK 否决——窗口混排英文
      // 否定词说明该窗口是叙述句/多关卡混排（如 verdict.md L24「三项上游判定
      // （acceptance BLOCK / … / coverage 有条件通过）」），肯定词不可信，跳过
      // 该窗口继续扫描后续 marker（真实裁决行「闸门最终状态：BLOCK」由强组捕获）。
      // 肯定组放否定组之后——防「不通过」被「通过」抢先命中。
      if (!isStrong && NEGATION_EN.test(windowText)) continue;
      // run-04 形态：「| 裁决 | ✅ **通过（PASS）** |」——「通过」中文挡住裸词
      // lazy 前缀，语义组又只收「全部/全数/有条件」前缀。「中文肯定词 + 括号裸词」
      // 复合形态按括号内裸词判定（通=PASS / 不通过=FAIL 已由否定组前置处理）。
      // 括号用 [^(]* 跨越：LLM 常写全角括号（U+FF08），ASCII \( 匹配不到
      // （run-04 实证：ASCII 版正则全 null，宽松版当场命中）。
      {
        const paren = windowText.match(/^[^A-Za-z\u4e00-\u9fff]*通过[^(]*\(?\s*(PASS|FAIL|SKIP)\b/i);
        if (paren) return paren[1].toUpperCase();
      }
      if (/有条件通过|有条件放行|条件通过/.test(windowText)) return 'PASS';
      if (/(全部通过|全数通过|全部成功)/.test(windowText)) return 'PASS';
    }
  }
  return null;
}

/**
 * 从 verdict.md 解析最终裁决（PASS/FAIL）。
 * driver 用于 LEDGER 记录和最终输出。
 *
 * @param {string} runDir   run 目录
 * @returns {{ verdict: string, reason: string }}
 */
function parseVerdict(runDir) {
  const verdictPath = join(runDir, 'verdict.md');

  if (!existsSync(verdictPath)) {
    return { verdict: 'ERROR', reason: 'verdict.md 不存在（步骤⑤未产出）' };
  }

  const text = readFileSync(verdictPath, 'utf-8');

  // 裁决关键词提取已提到模块级 extractVerdictKeyword——v1.4.3 之前此处
  // 与 parseStepResults 内各存一份 22 行的相同副本，改一处漏一处会让
  // verdict.md 的裁决与 LEDGER 的记录对不上。
  const keyword = extractVerdictKeyword(text);
  if (keyword === 'PASS' || keyword === 'FAIL') {
    return { verdict: keyword, reason: 'verdict.md 裁决' };
  }

  // 兜底：找不到可判定的结论标记。不再用「全文含 FAIL」误判，直接报 ERROR。
  return { verdict: 'ERROR', reason: 'verdict.md 未能从「判定/结论」行解析出 PASS/FAIL' };
}

/**
 * 从三份产物中提取各步骤的验证结果（PASS/FAIL/SKIP）。
 * 用于 LEDGER 记录。
 *
 * @param {string} runDir   run 目录
 * @returns {{ acceptance: string, regression: string, coverage: string }}
 */
function parseStepResults(runDir) {
  function extractResult(filename) {
    const filePath = join(runDir, filename);
    if (!existsSync(filePath)) return 'SKIP';
    const text = readFileSync(filePath, 'utf-8');
    const keyword = extractVerdictKeyword(text);
    if (keyword) return keyword;
    // 兜底：报告缺少可识别的结论标记 → 记为 SKIP（未知），
    // 不再用「全文含 FAIL」把 PASS 报告误判成 FAIL。
    return 'SKIP';
  }

  // v1.3.0 run-21 修复：acceptance 结果用确定性日志判定，不依赖 LLM worker 解读。
  //
  // 背景：acceptance-consolidate/分片 worker 解读预跑日志不可靠——run-21 实测：
  //   ① 把 grep 命令的 exit code（无匹配→1）误当脚本退出码，幻觉「EXIT: 1」；
  //   ② 不懂场景编号非连续设计，把不存在的编号（105/107/109-116）当「9 场景缺失」；
  //   ③ 把 S028 的 ⚠️ WARN 当缺陷 → 误判 acceptance FAIL → F 修复链对假 FAIL 空跑一轮。
  //
  // 修复：预跑日志总结行是权威（「验收测试结果：N 通过 / M 失败」+「✅ 全部通过」），
  // driver 用确定性正则判定。日志存在且可解析 → 直接给结论（覆盖 LLM 解读）；
  // 日志缺失/不可解析 → 回退 extractResult('acceptance.md')（LLM 解读兜底）。
  //
  // v1.4.3（run-08 三修）：日志 PASS + 合并报告 FAIL → 冲突即 FAIL（fail-closed）。
  // 背景：run-08 实测——日志汇总「368/368 · EXIT 0」但 consolidate 裁决 BLOCK
  // （场景 28 WARN 未计入统计，汇总与分片证据矛盾）。两个权威打架时不能再单边
  // 采信日志（run-21 拍板防的是 worker 幻觉 FAIL；run-08 的 BLOCK 是审查者拿
  // 分片原文指出的真实统计矛盾）。fail-closed：冲突 = 验收链自身不可信 = FAIL，
  // 宁可人工复核误报，不可漏报放行。仅合并报告显式判 FAIL 时才触发冲突路径；
  // 报告 SKIP/未知时维持 run-21 日志权威口径。
  function extractAcceptanceResult() {
    const logPath = join(runDir, 'acceptance-raw.log');
    let logResult = null;
    if (existsSync(logPath)) {
      const raw = readFileSync(logPath, 'utf-8');
      // 剥离 ANSI 颜色码——acceptance-test.sh 输出带 \x1b[0;32m 等转义，
      // 「241 通过」实为「\x1b[0;32m241 通过\x1b[0m」，直接正则匹配会失败（run-21 回放实测）。
      const log = raw.replace(/\x1b\[[0-9;]*m/g, '');
      const summaryMatch = log.match(/验收测试结果：\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
      if (summaryMatch) {
        const passCount = parseInt(summaryMatch[1], 10);
        const failCount = parseInt(summaryMatch[2], 10);
        // run-08 P0-1 harness 联动：跳过存在时脚本输出「⚠️ 有 N 个场景因环境
        // 依赖跳过」而非「✅ 全部通过」——/全部通过/ 自然不命中 → logResult=FAIL。
        // 这是正确语义（跳过=证据面缺失，不该记 PASS），无需为跳过改判定逻辑；
        // 仅需确记：无跳过路径（全部通过行存在）行为不变。
        if (passCount > 0 && failCount === 0 && /全部通过/.test(log)) logResult = 'PASS';
        else logResult = 'FAIL';
      }
    }
    const reportResult = extractResult('acceptance.md');
    if (logResult === 'PASS' && reportResult === 'FAIL') {
      // 日志说全过、审查裁决说阻塞——验收链自相矛盾，fail-closed 记 FAIL
      return 'FAIL';
    }
    return logResult ?? reportResult;
  }

  return {
    acceptance:  extractAcceptanceResult(),
    regression:  extractResult('regression.md'),
    coverage:    extractResult('coverage.md'),
  };
}

/**
 * 复制 stage6-report.md 到桌面。
 * 目标路径：~/Desktop/vX.Y-stage6-report.md
 */
function copyToDesktop(runDir, target) {
  const reportPath = join(runDir, 'stage6-report.md');
  if (!existsSync(reportPath)) {
    console.warn('[driver] stage6-report.md 不存在，跳过桌面复制');
    return;
  }
  const desktopPath = join(os.homedir(), 'Desktop', `${target}-stage6-report.md`);
  try {
    copyFileSync(reportPath, desktopPath);
    // 副本头部标注正本位置——桌面件是提醒，看完可放心删（正本在 run 目录永久留档）
    const body = readFileSync(desktopPath, 'utf-8');
    const provenance = `<!-- 副本——正本: ${reportPath}（可放心删除） -->\n`;
    if (!body.startsWith('<!-- 副本')) writeFileSync(desktopPath, provenance + body, 'utf-8');
    console.log(`[driver] 报告已复制到桌面: ${desktopPath}`);
  } catch (err) {
    console.warn(`[driver] 桌面复制失败（不影响主流程）: ${err.message}`);
  }
}

/**
 * 向 LEDGER.md 追加一行。
 * 格式（release-gate 列定义）：
 *   日期 | run-id | 循环 | 步数 | acceptance | regression | coverage | 裁决 | → runs 指针
 */
function appendLedger(dateStr, runId, steps, results, verdict, runDir) {
  const relPath = runDir.replace(REPO_ROOT + '/', '');
  const line = [
    dateStr.padEnd(14),
    runId.padEnd(14),
    'release-gate'.padEnd(12),
    String(steps).padEnd(4),
    results.acceptance.padEnd(10),
    results.regression.padEnd(10),
    results.coverage.padEnd(8),
    verdict.padEnd(7),
    relPath,
  ].join(' | ');

  const content = `\n${line}\n`;
  appendFileSync(LEDGER_PATH, content, 'utf-8');
  console.log(`[driver] LEDGER 已追加: ${line}`);
}

/**
 * 读 usage.jsonl 全量累计，生成 _summary 行并追加到文件末尾。
 * 单角色 V，by_role 只有 V。
 */
function appendUsageSummary(runDir, steps) {
  const usagePath = join(runDir, 'usage.jsonl');
  const byRole = {
    V: { model: '', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_cny: 0 },
  };

  if (existsSync(usagePath)) {
    const lines = readFileSync(usagePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec._summary) continue;
      if (!rec.role || !(rec.role in byRole)) continue;

      byRole[rec.role].model = rec.model || byRole[rec.role].model;
      if (rec.prompt_tokens)     byRole[rec.role].prompt_tokens     += rec.prompt_tokens;
      if (rec.completion_tokens) byRole[rec.role].completion_tokens += rec.completion_tokens;
      if (rec.total_tokens)      byRole[rec.role].total_tokens      += rec.total_tokens;
      if (rec.cost_cny)          byRole[rec.role].cost_cny          += rec.cost_cny;
    }
  }

  const totalTokens = byRole.V.total_tokens;
  const totalCost   = byRole.V.cost_cny;

  const summary = {
    _summary:       true,
    total_tokens:   totalTokens,
    total_cost_cny: Number(totalCost.toFixed(6)),
    steps:          steps,
    by_role:        byRole,
    v_billing:      'subscription',
  };

  appendFileSync(usagePath, JSON.stringify(summary) + '\n', 'utf-8');
  return summary;
}

// ═══════════════════════════════════════════════════════════
//  可见性：适配器探测
// ═══════════════════════════════════════════════════════════

/**
 * 探测环境中可用的进度适配器。
 * 与 fresh-eyes-driver 一致——返回空数组，session 自己读 status.json。
 */
async function detectReporters() {
  return [];
}

// ═══════════════════════════════════════════════════════════
//  v1.3.9 进程守护：daemon 自脱离 + watcher 主管（Harness 理念）
//  与 fresh-eyes-driver 同构平移（commit 767d7c10 的守护三件套）。
// ═══════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * detached spawn 本 driver（脱离父进程树）。
 * WorkBuddy run_in_background 进程挂 Electron 进程树，主 session turn 结束被
 * 整体 SIGKILL（run-01 两次静默死亡根因）。detached:true 让子进程成为孤儿
 * （launchd 收养），宿主会话结束不影响存活。日志 stdio 绑文件 fd（非 ignore）。
 */
function spawnDetachedDriver(args, logPath, env = {}) {
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, 'a');
  try {
    const child = spawn(process.execPath, [__filename, ...args], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ...env },
    });
    child.unref();
    return child.pid;
  } finally {
    closeSync(logFd);
  }
}

/**
 * 死因审计——Harness「审计」能力落地。
 * driver 死后把死因证据落盘 runDir/death-audit.jsonl（append）：
 * verdict = signal-abort（latest.json stopReason='aborted-signal'，SIGTERM 优雅）
 *         / external-kill（无 stopReason + driver.pid 残留 = 非优雅退出，默认）。
 */
function auditDriverDeath(runDir, liveness) {
  const entry = {
    ts: new Date().toISOString(),
    heartbeatAgeMs: liveness.heartbeatAgeMs ?? null,
    lastEvent: liveness.lastEvent ?? null,
    phase: liveness.phase ?? null,
    pidfile: (() => {
      try {
        const p = join(runDir, 'driver.pid');
        return existsSync(p) ? readFileSync(p, 'utf-8').trim() : null;
      } catch { return null; }
    })(),
    stopReason: null,
    verdict: 'external-kill',
  };
  try {
    const latestPath = join(runDir, 'latest.json');
    if (existsSync(latestPath)) {
      const latest = JSON.parse(readFileSync(latestPath, 'utf-8'));
      if (latest.stopReason) entry.stopReason = latest.stopReason;
    }
  } catch { /* latest.json 读失败不阻断审计 */ }
  if (entry.stopReason === 'aborted-signal') entry.verdict = 'signal-abort';
  try {
    appendFileSync(join(runDir, 'death-audit.jsonl'), JSON.stringify(entry) + '\n');
  } catch { /* 审计落盘失败不阻断 watcher 主循环 */ }
  return entry;
}

/**
 * 从 runDir 现有元数据构造 resume 参数（target）。
 * latest.json 优先，resume-point.json 兜底。缺 target 返回 null（无法续跑）。
 * release-gate 无 maxRounds 概念（单轮 V+F 流程），只取 target。
 */
function buildRespawnArgs(runDir) {
  for (const f of ['latest.json', 'resume-point.json']) {
    try {
      const p = join(runDir, f);
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, 'utf-8'));
      if (j && typeof j.target === 'string' && j.target) {
        return { target: j.target };
      }
    } catch { /* 单个源损坏继续尝试下一个 */ }
  }
  return null;
}

/**
 * watcher 主管主循环——Harness 理念：注入（启动规则）→ 审计（死因落盘）→
 * 回溯（--resume 断点续跑）。每 intervalSec 读 status.json 心跳；心跳停 →
 * 死因审计 → spawnDetachedDriver --resume 拉起；verdict.md 产出 → watcher 退出。
 */
async function runWatcher(runDir, intervalSec, thresholdSec) {
  const log = (msg) => console.log(`[watcher] ${new Date().toISOString()} ${msg}`);
  mkdirSync(runDir, { recursive: true });
  try { writeFileSync(join(runDir, 'watcher.pid'), String(process.pid)); } catch { /* pidfile 失败不阻断 */ }
  log(`启动 pid=${process.pid} · 盯 ${runDir} · interval=${intervalSec}s threshold=${thresholdSec}s`);

  let resumeCount = 0;
  while (true) {
    if (existsSync(join(runDir, 'verdict.md'))) {
      log('✅ verdict.md 已产出——主管任务完成，退出');
      return;
    }
    const live = checkDriverLiveness(runDir, { thresholdMs: thresholdSec * 1000 });
    if (live.alive) {
      await sleep(intervalSec * 1000);
      continue;
    }
    const death = auditDriverDeath(runDir, live);
    log(`🛑 driver 死亡（heartbeat ${Math.round((death.heartbeatAgeMs ?? 0) / 1000)}s 未更新）→ verdict=${death.verdict} phase=${death.phase ?? '?'}`);
    const respawn = buildRespawnArgs(runDir);
    if (!respawn) {
      log('⚠️ 无法构造 resume 参数（缺 target）——主管退出，需人工介入');
      return;
    }
    resumeCount++;
    log(`🔄 自动拉起 driver #${resumeCount}：--target ${respawn.target} --resume`);
    try {
      spawnDetachedDriver(
        ['--target', respawn.target, '--resume'],
        join(runDir, 'driver.log'),
        { SOFAGENT_DAEMON_CHILD: '1' },
      );
    } catch (err) {
      log(`💥 spawn 失败: ${err.message}——主管退出，需人工介入`);
      return;
    }
    // 拉起后睡眠一轮，避免 driver 刚启动 status.json 未生成被误判 dead 反复拉起
    await sleep(intervalSec * 1000);
  }
}

/**
 * 确保 acceptance 步骤的预跑日志存在。
 *
 * 三种情况：
 *   1. --skip-acceptance 且日志不存在 → 写占位文件，提示手动预跑
 *   2. 日志已存在 → 跳过预跑（复用模式）
 *   3. 其他 → driver 直接预跑 acceptance-test.sh
 *
 * @param {object} args   解析后的 CLI 参数
 * @param {string} runDir run 目录绝对路径
 */
async function ensureAcceptancePreRun(args, runDir) {
  const preRunLog = join(runDir, 'acceptance-raw.log');
  const externalLog = '/tmp/acceptance-raw.log';
  if (args.skipAcceptance && !existsSync(preRunLog)) {
    // v1.2.7 修复：先检查 /tmp/acceptance-raw.log（外部预跑日志），存在就复制到 runDir
    // 根因：runDir 由 driver 启动时创建，用户无法在启动前预跑日志到 runDir
    if (existsSync(externalLog)) {
      copyFileSync(externalLog, preRunLog);
      console.log(`  [driver] --skip-acceptance 已从 ${externalLog} 复制预跑日志到 runDir`);
    } else {
      console.log('  [driver] --skip-acceptance 已指定，但未找到预跑日志');
      console.log(`  [driver] 请先手动预跑：bash FORGE/playbook/acceptance-test.sh > ${externalLog} 2>&1`);
      writeFileSync(preRunLog,
        '--skip-acceptance 模式：未预跑 acceptance-test.sh。\n' +
        `请手动预跑后把日志放到 ${externalLog}（driver 会自动复制），\n` +
        '或去掉 --skip-acceptance 参数让 driver 自动预跑。\n',
        'utf-8');
    }
  } else if (existsSync(preRunLog)) {
    console.log('  [driver] acceptance-raw.log 已存在，跳过预跑（复用模式）');
  } else {
    console.log('  [driver] acceptance 特殊处理：driver 直接预跑 acceptance-test.sh');
    try {
      await runAcceptanceTestDirectly(runDir);
    } catch (e) {
      console.warn(`  [driver] acceptance-test.sh 预跑失败: ${e.message}`);
      // 即使预跑失败也继续 spawnWorker，让 agent 从错误日志中生成报告
      writeFileSync(
        preRunLog,
        `acceptance-test.sh 预跑失败: ${e.message}\n${e.stack || ''}`,
        'utf-8',
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════════════════════

/**
 * 打印用法帮助。
 */
function printHelp() {
  console.log(`
release-gate-driver.mjs - FORGE release-gate-loop Driver

用法:
  node FORGE/src/release-gate-driver.mjs --target <version> [options]
  node FORGE/src/release-gate-driver.mjs --judgment-only --target <version>
  node FORGE/src/release-gate-driver.mjs --step <step> --target <version> [options]
  node FORGE/src/release-gate-driver.mjs --worker --step <step> --run-dir <dir> --target <version>

参数:
  --target <ver>            验证目标版本号 (如 v1.2.4)
  --step <stepName>         只执行单个步骤然后退出 (单步模式)
                            stepName: acceptance | regression | coverage | consolidate | verdict
  --run-dir <dir>           指定 run 目录绝对路径 (单步模式下用于多步共享同一目录)
  --skip-acceptance         跳过 acceptance 预跑 (复用手动预跑的 acceptance-raw.log)
  --judgment-only           [v1.3.8 交付七] 判断层瘦身模式——一次启动直达判断层四步
                            (regression → coverage → consolidate → verdict)，跳过
                            acceptance 分片。脚本层已直跑保证 acceptance，LLM 只审
                            有判断空间的环节（run-04 实测省 61% token）
  --acceptance-range <S-S>  [v1.3.8 交付七] acceptance 分片抽查化——全流程模式下只跑
                            指定场景区间（如 --acceptance-range S294-S310，本版新增
                            场景），不跑全量 12 分片。与 --judgment-only 互斥使用
  --auto-fix                [v1.3.8 交付七] 显式开启 F 修复链。默认关闭——verdict
                            FAIL 即 loop-end，无 f-diagnose/f-fix/f-audit 产物，
                            修复责任交回主 session（阶段五）
  --check-alive <runDir>    [v1.3.8 交付五] liveness 探针——只认 status.json 心跳
                            不认日志（LLM 长窗口日志冻结 ≠ 死亡）。心跳 <90s →
                            RC=0 输出 alive；超时 → RC=1 输出 dead + 最后 event/phase
  --dry-run                 只打印将执行的步骤，不实际运行
  --worker                  内部 worker 模式 (由 driver spawn，一般不手动使用)
  --help, -h                显示此帮助信息

模式说明:
  全量模式 (默认):      串行执行全部 5 步，每步 spawn 独立 worker 子进程
  判断层模式 (--judgment-only): 跳过 acceptance 分片，直达判断层四步——
                        阶段六 SOP 默认（脚本层直跑 + 判断层 LLM）
  单步模式 (--step): 只执行指定步骤，执行完后进程退出 (exit 0)
                    stdout 打印: [driver] STEP_DONE: <stepName> EXIT_CODE=0
                    与全量模式使用相同的 run 目录逻辑，确保产物写到正确位置
                    适合外层 bash 脚本编排，每步一个全新进程，内存归零
`);
}

async function main() {
  const args = parseArgs(process.argv);

  // ─── run-06 教训：macOS 睡眠冻结 event loop 775s → watchdog 误 abort worker ───
  // caffeinate 防 idle 睡眠（合盖电池模式 OS 强制睡眠无法阻止，由 watchdog 双钟鉴别兜底）。
  // 仅 macOS（darwin）有 caffeinate；子进程随 driver 退出自动终止（-w 绑定本进程）。
  if (process.platform === 'darwin' && !args.help && !args.checkAlive && !args.watch) {
    try {
      const { spawn } = await import('child_process');
      const caf = spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: false, stdio: 'ignore' });
      caf.unref();
      console.log('[caffeinate] 防 idle 睡眠守护已挂（绑定本进程存活期）');
    } catch { /* 非 macOS 或 caffeinate 缺失：静默跳过，双钟鉴别兜底 */ }
  }

  // ─── 帮助 ───
  if (args.help) {
    printHelp();
    return;
  }

  // ─── v1.3.8 交付五：liveness 探针（--check-alive <runDir>）───
  // 只认 status.json 心跳不认日志——LLM 长窗口期间日志冻结≠死亡。
  // alive → RC=0 输出 alive；超 90s / 无心跳 → RC=1 输出 dead + 最后 event/phase。
  if (args.checkAlive !== null) {
    const result = checkDriverLiveness(args.checkAlive);
    console.log(`[check-alive] ${args.checkAlive}`);
    console.log(result.report);
    process.exit(result.rc);
  }

  // ─── v1.3.9 watcher 主管模式（--watch <runDir>）───
  // 纯监控进程：无 LLM 调用，不可能撞长窗口/熔断；driver 死了自动审计死因并 --resume 拉起。
  if (args.watch) {
    await runWatcher(args.watch, args.watchInterval, args.watchThreshold);
    process.exit(0);
  }

  // ─── Worker 模式 ───
  if (args.worker) {
    if (!args.step || !args.runDir || !args.target) {
      console.error('worker 模式需要 --step --run-dir --target');
      process.exit(1);
    }
    // v1.4.3（run-20 教训）：LLM 网络错误（5xx/网络超时）重试 ×2——智谱侧
    // 故障窗口内一次 500 即整步崩溃，17/17 步全毁。对齐 fresh-eyes 空响应
    // 重试先例：仅对网络类错误重试（判定依据：错误消息含「网络错误」/5xx
    // 状态码/timeout 字样），业务错误不重试（重试也不会好）。
    const isNetworkError = (e) => /网络错误|网络超时|timeout|timed?\s*out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|\b5\d{2}\b/.test(String(e?.message || ''));
    const MAX_ATTEMPTS = 3; // 首跑 + 重试 ×2
    let attempt = 0;
    let lastErr = null;
    while (attempt < MAX_ATTEMPTS) {
      attempt++;
      try {
        await runWorker(args.step, args.runDir, args.target);
        // v1.3.6 交付⑩：worker 写完产物后强制退出（镜像 fresh-eyes run-23 修复）。
        // workerAliveTimer 是残留句柄——不清理会阻止事件循环排空 → worker 进程永不退出
        // → driver 的 spawn await 永久挂起。process.exit 无视残留句柄，强制回收。
        process.exit(0);
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_ATTEMPTS && isNetworkError(err)) {
          const waitSec = 15 * attempt; // 递退避：15s / 30s
          console.error(`[worker:${args.step}] 第 ${attempt} 次尝试失败（网络类错误: ${String(err.message).slice(0, 120)}），${waitSec}s 后重试（${MAX_ATTEMPTS - attempt} 次剩余）`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          continue;
        }
        console.error(`[worker:${args.step}] 失败: ${err.message}`);
        if (err.errors) {
          console.error('--- 子错误 (' + err.errors.length + ' 条) ---');
          for (const [i, subErr] of err.errors.entries()) {
            console.error(`  [${i}] ${subErr?.message || subErr}`);
            if (subErr?.stack) {
              console.error('     stack:', subErr.stack.split('\n').slice(0, 6).join('\n'));
            }
          }
        } else {
          console.error('--- stack ---');
          console.error(err.stack);
        }
        process.exit(1);
      }
    }
    // 理论不可达（循环内必 exit）——防御性兜底
    console.error(`[worker:${args.step}] 重试 ${MAX_ATTEMPTS} 次后仍失败: ${lastErr?.message}`);
    process.exit(1);
  }

  // ─── Driver 模式 ───

  // ─── v1.2.8 功能⑦：断点续跑（--resume）───
  // release-gate 的"轮" = V 阶段一轮 + 可能的 F 修复轮。断点策略：
  //   - V 阶段 verdict 解析后写 { phase: 'verdict-done', verdict, fixRoundsRun: 0 }
  //   - 每个 F 轮完成后写 { phase: 'f-round-done', fixRoundsRun: round }
  //   - V 阶段步骤幂等可重跑（产物会被覆盖），V 阶段内不写步骤级断点
  // 铁律：resume 只跳过重跑，不修改已有产物；dry-run 永远不写断点；
  // worker 模式已在上面 return，不处理 resume。
  let resumeState = null;        // loadResumePoint 的结果（null = 无断点）
  let resumeRunDir = null;       // resume 复用的已有 run 目录
  let skipVPhase = false;        // 断点已过 verdict → 跳过 V 阶段 5 步
  let resumeVerdict = null;      // 断点记录的 verdict（resume 进入 F 链的入口）
  let resumeReason = 'resume：复用断点记录的 verdict';
  let resumeFixRoundsRun = 0;    // F 链已完成轮数
  let resumeCompletedSteps = 0;  // 已完成步数（V:5 + F:每轮 3 步）

  // ─── v1.3.8 交付五：resume 自动检测 ───
  // 启动时（未显式传 --resume）扫描最近 run 目录的 resume-point.json——
  // 存在可续跑断点（verdict-done FAIL / f-round-done 未收敛）则自动进入
  // resume 模式（等价显式传参）；断点显示已收敛 PASS 由下方消费逻辑直接退出。
  // 🔴 只做入口接线，不改 resume 语义。
  if (!args.resume && !args.dryRun && !args.worker && !args.step) {
    try {
      const candidate = discoverLatestRunDir();
      if (candidate) {
        const candidateState = base.loadResumePoint(candidate);
        if (candidateState && candidateState.phase === 'verdict-done' && candidateState.verdict === 'FAIL') {
          resumeRunDir = candidate;
          args.resume = true;
          console.log(`🔄 检测到未消费断点（自动进入 resume 模式，从 F 修复链续跑）:`);
          console.log(`   runDir = ${candidate}`);
          console.log(`   断点   = phase=${candidateState.phase} verdict=${candidateState.verdict}`);
        } else if (candidateState && candidateState.phase === 'f-round-done' && candidateState.verdict !== 'PASS') {
          resumeRunDir = candidate;
          args.resume = true;
          console.log(`🔄 检测到未消费断点（自动进入 resume 模式，F 链已完成 ${candidateState.fixRoundsRun ?? 0} 轮）:`);
          console.log(`   runDir = ${candidate}`);
        }
      }
    } catch (probeErr) {
      console.warn(`   ⚠️ resume 断点探测失败（降级为全新启动）: ${probeErr.message}`);
    }
  }

  if (args.resume && !args.dryRun) {
    const discovered = discoverLatestRunDir();
    if (!discovered) {
      console.warn('⚠️  --resume：未找到任何历史 run 目录，从头开始');
    } else {
      resumeState = base.loadResumePoint(discovered);
      if (!resumeState) {
        console.warn(`⚠️  --resume：${discovered} 无有效断点（resume-point.json 不存在或损坏），从头开始`);
      } else if (resumeState.phase === 'verdict-done' && resumeState.verdict === 'PASS') {
        console.log('✅ resume：上次 V 阶段 verdict=PASS，无需续跑');
        process.exit(0);
      } else if (resumeState.phase === 'f-round-done' && resumeState.verdict === 'PASS') {
        console.log('✅ resume：F 修复链已收敛为 PASS，无需续跑');
        process.exit(0);
      } else if (resumeState.phase === 'verdict-done' && resumeState.verdict === 'FAIL') {
        resumeRunDir = discovered;
        skipVPhase = true;
        resumeVerdict = 'FAIL';
        resumeFixRoundsRun = 0;
        resumeCompletedSteps = STEP_ORDER.length;
        console.log(`🔄 resume：上次 V 阶段 verdict=FAIL，从 F 修复链 Round 1 开始，复用 ${discovered}`);
      } else if (resumeState.phase === 'f-round-done') {
        resumeRunDir = discovered;
        skipVPhase = true;
        resumeVerdict = 'FAIL';
        resumeFixRoundsRun = typeof resumeState.fixRoundsRun === 'number' ? resumeState.fixRoundsRun : 0;
        resumeCompletedSteps = STEP_ORDER.length + resumeFixRoundsRun * 3;
        console.log(`🔄 resume：F 修复链已完成 ${resumeFixRoundsRun} 轮，从 Round ${resumeFixRoundsRun + 1} 开始，复用 ${discovered}`);
      } else {
        console.warn(`⚠️  --resume：断点 phase=${resumeState.phase || '?'} 不可续跑（V 阶段内中断），从头开始`);
        // 从头开始 = 新建 run 目录——不能复用旧 runDir 覆盖已有产物
        resumeState = null;
      }
    }
  }

  if (!args.target) {
    // --target 未传时从断点读取 target（v1.2.8 功能⑦）；断点也没有则报错退出
    if (resumeState && typeof resumeState.target === 'string' && resumeState.target) {
      args.target = resumeState.target;
      console.log(`   target    = ${args.target}（从断点恢复）`);
    } else {
      console.error('用法: node FORGE/src/release-gate-driver.mjs --target vX.Y.Z [--dry-run] [--skip-acceptance] [--resume]');
      console.error('      node FORGE/src/release-gate-driver.mjs --step <acceptance|regression|coverage|consolidate|verdict|f-diagnose|f-fix|f-audit> --target vX.Y.Z');
      console.error('      node FORGE/src/release-gate-driver.mjs --help');
      console.error('      --resume 模式也需 --target，除非断点中已保存 target');
      process.exit(1);
    }
  }

  // 验证环境变量（dry-run 跳过）
  // v1.2.8：V + F 双角色都需要校验
  const missingEnvs = [];
  for (const role of ['V', 'F']) {
    const cfg = MODEL_CONFIGS[role];
    if (!process.env[cfg.apiKeyEnv])  missingEnvs.push(cfg.apiKeyEnv);
    if (!process.env[cfg.specEnv])    missingEnvs.push(cfg.specEnv);
  }
  if (missingEnvs.length > 0 && !args.dryRun) {
    console.error(`缺少环境变量: ${missingEnvs.join(', ')}`);
    console.error('请在 ~/.zshrc 中设置后 source ~/.zshrc');
    process.exit(1);
  }

  // ─── v1.4.0：清理 DSH worker 残留空文件（防污染工作树）───
  // DSH CLI 桥接 spawn 无 cwd 隔离（继承 REPO_ROOT）——DSH agent 工具行为可能在仓库根
  // 创建 vX.Y.Z 格式的 0 字节空文件（v1.3.7 已多次出现：08-19/08-24 release-gate 运行期，
  // 全仓代码无直接创建源 → LLM 执行版本相关命令误重定向）。启动时清理 0 字节残留。
  try {
    const { readdirSync, statSync, unlinkSync } = await import('node:fs');
    const strays = readdirSync(REPO_ROOT).filter(
      (f) => /^v\d+\.\d+\.\d+$/.test(f) && statSync(join(REPO_ROOT, f)).size === 0
    );
    if (strays.length > 0) {
      for (const f of strays) unlinkSync(join(REPO_ROOT, f));
      console.log(`   🧹 清理 DSH 残留空文件: ${strays.join(', ')}`);
    }
  } catch { /* cleanup 失败不阻断 */ }

  // ─── preflight-check 跑前自检 ───
  // 发版门禁单次跑 30-60 分钟（V 阶段 + 可能的 F 修复链），环境不健康时
  // 中途崩溃代价极高。开跑前把路径/管道/API/预算/目录/磁盘全部验一遍。
  // 铁律：dry-run 跳过（不真跑 worker）；--step 单步模式跳过（外层编排每步
  // 一个全新进程，重复自检纯浪费且会拖慢编排）；preflight 自身异常降级
  // WARN 绝不阻塞；HALT 级失败才 exit(1)。
  if (!args.dryRun && !args.step) {
    let preflightResult;
    try {
      preflightResult = await runPreflight({
        repoRoot: REPO_ROOT,
        runDir: join(RUNS_DIR, 'release-gate-loop'), // 预检 runs 根目录可写（幂等 mkdir）
        modelConfigs: MODEL_CONFIGS,
        roles: ['V', 'F'],
        loopName: 'release-gate-loop',
        toolConfig: {
          globalSoft: TOOL_SOFT_LIMIT, globalHard: TOOL_HARD_LIMIT,
        },
      });
    } catch (pfErr) {
      // preflight 模块自身异常——降级 WARN，绝不因检查工具故障阻塞主流程
      console.warn(`   ⚠️ preflight-check 自身异常（降级跳过）: ${pfErr.message}`);
      preflightResult = null;
    }
    if (preflightResult) {
      console.log(formatPreflightReport(preflightResult));
      if (preflightResult.shouldHalt) process.exit(1);
    }
  }

  // ─── 执行环境指纹自检（run-15/16/17 假红事故根因防御）───
  // AI 沙箱（brokered-bin/toybox）内启动 driver 会让 96 维 precheck 集体假红，
  // 判断层吃假数据产出误导性 NO-GO。任何非 dry-run 模式开跑前必须过指纹自检。
  // dry-run 跳过（不真跑维度检查，环境指纹无实际影响面）。
  if (!args.dryRun) {
    assertNativeToolchain();
  }

  // ─── 单步模式 (--step，非 worker) ───
  // 只执行指定步骤，然后进程退出。每步一个全新进程，内存归零。
  // 适合外层 bash 编排脚本逐步调用。
  // v1.2.8：支持 V + F + audit(driver) 全部步骤
  const ALL_STEPS = [...STEP_ORDER, 'f-diagnose', 'f-fix', 'f-audit'];
  if (args.step && !args.worker) {
    if (!ALL_STEPS.includes(args.step)) {
      console.error(`未知步骤: ${args.step}，可选: ${ALL_STEPS.join(', ')}`);
      process.exit(1);
    }

    // run 目录：优先使用 --run-dir，否则自动发现最新 run 目录或新建
    let stepRunDir = args.runDir;
    if (!stepRunDir) {
      const resolved = resolveRunDir(args.dryRun);
      stepRunDir = resolved.runDir;
    }
    if (!existsSync(stepRunDir)) {
      mkdirSync(stepRunDir, { recursive: true });
    }

    console.log(`[driver] 单步模式: step=${args.step} target=${args.target}`);
    console.log(`[driver] run-dir = ${stepRunDir}`);

    // acceptance 特殊处理：单步模式下也执行预跑逻辑
    // v1.2.9 功能①：acceptance shard 步骤也需要预跑日志
    if (args.step === 'acceptance' || args.step.startsWith('acceptance-s') || args.step === 'acceptance-consolidate') {
      await ensureAcceptancePreRun(args, stepRunDir);
    }

    try {
      // v1.2.8：role:null 步骤走 driver 直接执行（runAuditGate），不 spawn worker
      const stepDef = STEPS[args.step];
      if (stepDef.role === null) {
        console.log(`[driver] ${args.step} = driver 步骤（role:null），直接执行 ${stepDef.driverFn}`);
        // v1.3.6 交付⑩：FORGE_WORKTREE_ROOT 继承时 git 操作在副本上（隔离）；
        // 未设 env 时 gitRoot=undefined → 回退主仓（单步调试向后兼容）。
        const result = await base.runAuditGate(stepRunDir, args.step, 1, {
          gitRoot: (globalWorktree && globalWorktree.worktreeDir) || undefined,
        });
        console.log(`[driver] audit gate: passed=${result.passed} exitCode=${result.exitCode}`);
      } else {
        await runWorker(args.step, stepRunDir, args.target);
      }
      console.log(`[driver] STEP_DONE: ${args.step} EXIT_CODE=0`);
      process.exit(0);
    } catch (err) {
      console.error(`[driver] STEP_DONE: ${args.step} EXIT_CODE=1 ERROR=${err.message}`);
      process.exit(1);
    }
  }

  // 建 run 目录（v1.2.8 功能⑦：resume 模式复用已有目录，不新建）
  // v1.3.9：daemon 子进程优先用父进程经 SOFAGENT_DAEMON_RUNDIR 传入的 runDir——
  // 否则子进程重新 resolveRunDir 会新建不同序号目录（父打印 run-03 子实际跑 run-04）。
  const { runDir, runId, dateStr } = process.env.SOFAGENT_DAEMON_RUNDIR
    ? resolveRunDirInfo(process.env.SOFAGENT_DAEMON_RUNDIR)
    : resumeRunDir
      ? resolveRunDirInfo(resumeRunDir)
      : resolveRunDir(args.dryRun);
  globalRunDir = runDir; // v1.3.6 交付⑩：teardown 守卫（崩溃处理器需要 runDir）

  // ─── v1.3.9 daemon 模式（--daemon）：spawn detached 自脱离进程树 ───
  // 与 fresh-eyes-driver 同构（commit 767d7c10）：子进程经 SOFAGENT_DAEMON_CHILD=1
  // 标记跳过本分支避免递归；日志重定向 runDir/driver.log；--dry-run 透传防误真跑。
  // 🔴 位置必须在 runDir 定义之后（TDZ：提前引用 runDir 会 ReferenceError）。
  if (args.daemon && !process.env.SOFAGENT_DAEMON_CHILD) {
    const daemonLog = join(runDir, 'driver.log');
    // release-gate 无 --max-rounds（单轮 V+F 流程），childArgs 只带 target/resume/dry-run
    const childArgs = ['--target', args.target];
    if (args.resume) childArgs.push('--resume');
    if (args.dryRun) childArgs.push('--dry-run');
    const childPid = spawnDetachedDriver(childArgs, daemonLog, {
      SOFAGENT_DAEMON_CHILD: '1',
      SOFAGENT_DAEMON_RUNDIR: runDir, // 子进程复用本 runDir，避免重新 resolve 得不同目录
    });
    console.log(`🛰️ daemon 模式：driver 已脱离进程树（pid=${childPid}），日志 → ${daemonLog}`);
    console.log(`   监控: node FORGE/src/release-gate-driver.mjs --check-alive ${runDir}`);
    process.exit(0);
  }

  // ─── v1.3.6 worktree 留存根治：启动时陈旧兜底扫描（镜像 fresh-eyes）───
  try {
    const stale = base.cleanupStaleWorktrees({ runsRoot: join(RUNS_DIR, 'release-gate-loop'), excludeRunDir: runDir });
    if (stale.cleaned > 0) {
      console.log(`   陈旧清理   = 收走 ${stale.cleaned} 个超 7 天的遗留 worktree（分支保留待回流）`);
      for (const line of stale.detail) console.log(`     · ${line}`);
    }
  } catch (staleErr) {
    console.warn(`   ⚠️ 陈旧 worktree 扫描失败（不阻塞）: ${staleErr.message}`);
  }

  // ─── v1.3.6 交付⑩：worktree 隔离（run-07 事故根因修复，镜像 fresh-eyes）───
  // f-fix worker 的代码修改全部落副本分支，主仓工作区与主分支历史零污染。
  // 失败降级（不隔离直跑），绝不因隔离基建故障阻塞发版闸门主流程。
  // 磁盘预算：副本不含 node_modules（~50MB/run），测试类验证回主仓跑。
  // dry-run 跳过（不真跑 worker，无需隔离）。
  if (!args.dryRun) {
    try {
      globalWorktree = base.setupWorktree(runDir, { runId });
      console.log(`   隔离模式   = worktree ${globalWorktree.reused ? '复用' : '新建'}（分支 ${globalWorktree.branch}，基线 ${globalWorktree.baseSha.slice(0, 8)}）`);
    } catch (wtErr) {
      console.warn(`   ⚠️ worktree 隔离创建失败（降级为共享主仓模式）: ${wtErr.message}`);
      globalWorktree = null;
    }
  }

  // ─── v1.3.6 worktree 留存根治：SIGTERM/SIGINT 信号清理（镜像 fresh-eyes）───
  // 人工 pkill / Ctrl-C 终止时也执行 teardown，worktree 不再留存。
  const disarmSignalCleanup = base.registerSignalCleanup({
    cleanup: () => {
      safeTeardownWorktree();
      // v1.3.9 pidfile：SIGTERM 优雅终止时删除——watcher 审计死因时，
      // pidfile 残留 = 非优雅退出（SIGKILL/进程树清理），佐证 external-kill。
      try { unlinkSync(join(runDir, 'driver.pid')); } catch { /* 无 pidfile 正常 */ }
      try {
        base.updateLatestPointer(runDir, {
          round: 0,
          totalRounds: 0,
          stopReason: 'aborted-signal',
        });
      } catch { /* latest.json 更新失败不阻塞退出 */ }
    },
    stopReason: 'aborted-signal',
  });

  // ─── v1.2.8 功能⑦：断点写入闭包 ───
  // 铁律：dry-run 永远不写断点；断点只存状态摘要不存大体积数据；
  // 写失败不阻断主流程（断点是优化层不是正确性层）。
  // round 字段：V 阶段 verdict-done 时为 0，F 轮完成时为已完成 F 轮数。
  const saveGateCheckpoint = (phase, currentVerdict, fixRounds) => {
    if (args.dryRun) return;
    try {
      base.saveResumePoint(runDir, {
        round: fixRounds,
        completed: true,
        phase,
        verdict: currentVerdict,
        fixRoundsRun: fixRounds,
        target: args.target,
      });
    } catch (ckptErr) {
      console.warn(`  ⚠️  断点写入失败（不影响主流程）: ${ckptErr.message}`);
    }
  };

  // ─── 可见性：初始化 ───
  const reporters = await detectReporters();
  const visibility = createVisibility(runDir, reporters);
  globalVisibility = visibility;
  visibility.emit(EVENTS.RUN_START, {
    target: args.target,
    runDir: runDir.replace(REPO_ROOT + '/', ''),
  });
  console.log(`   可见性     = ${reporters.length} 个适配器`);

  // v1.3.9 心跳定时器 + pidfile（镜像 fresh-eyes v1.2.7 心跳机制）：
  // 每 15s 更新 status.json 心跳，watcher 判死依赖；driver.pid 供死因审计
  // （SIGTERM 时 cleanup 删除，残留=非优雅退出佐证）。
  // 🔴 仅非 dry-run 注册——dry-run 不真跑不需要心跳，且 dry-run 结束路径是
  // return（非 process.exit），残留 timer 会让事件循环不排空 → 进程挂住。
  // heartbeatTimer 声明提到 main 作用域：main 正常结束路径 clearInterval 引用。
  let heartbeatTimer = null;
  if (!args.dryRun) {
    heartbeatTimer = setInterval(() => {
      try { visibility.heartbeat(); } catch { /* 心跳失败不中断 */ }
    }, 15_000);
    try { writeFileSync(join(runDir, 'driver.pid'), String(process.pid)); } catch { /* pidfile 失败不阻断 */ }
  }

  console.log(`\n🚪 release-gate-loop 启动`);
  console.log(`   target    = sofagent ${args.target}`);
  console.log(`   run-dir    = ${runDir}`);
  console.log(`   dry-run    = ${args.dryRun}`);
  if (args.skipAcceptance) {
    console.log(`   skip-acc   = true（跳过 acceptance 预跑，复用手动预跑日志）`);
  }
  // v1.2.8 功能⑦：启动日志打印 resume 状态
  if (args.resume && !args.dryRun) {
    if (resumeRunDir) {
      console.log(`   resume     = 断点恢复（phase=${resumeState.phase} verdict=${resumeState.verdict} F 轮=${resumeFixRoundsRun}）`);
    } else {
      console.log(`   resume     = 无有效断点，从头开始`);
    }
  }
  console.log(`   V          = ${MODEL_CONFIGS.V.model} (${MODEL_CONFIGS.V.baseURL})`);
  console.log(`   F          = ${MODEL_CONFIGS.F?.model || 'N/A'} (${MODEL_CONFIGS.F?.baseURL || 'N/A'}) [v1.2.8]`);

  if (args.dryRun) {
    console.log(`\n  [dry-run] 将执行以下步骤：`);
    console.log(`  ── V 阶段（验证）──`);
    if (args.judgmentOnly) {
      // v1.3.8 交付七：判断层瘦身模式——跳过 acceptance 分片，直达判断层四步
      console.log(`    ① acceptance   [跳过——--judgment-only 判断层模式]`);
      console.log(`       依据：acceptance 脚本结果由脚本层直跑保证（exit 0 + SUMMARY 全过），`);
      console.log(`       LLM 复核确定性结果增值≈0（run-04 实测 61% token 花在此）`);
    } else {
      console.log(args.skipAcceptance
        ? `    ① acceptance × ${ACCEPTANCE_SHARD_COUNT} 维度分片 (--skip-acceptance)  → acceptance-s1~12.md → acceptance.md`
        : `    ① acceptance × ${ACCEPTANCE_SHARD_COUNT} 维度分片 (跑 acceptance-test.sh)  → acceptance-s1~12.md → acceptance.md`);
      console.log(`       分片范围 = ${args.acceptanceRange ? `抽查区间 ${args.acceptanceRange}（--acceptance-range）` : '全量均分（v1.3.8 起默认抽查化可选）'}`);
      console.log(`       分片 worker 并行（并发 = min(FORGE_ACCEPTANCE_CONCURRENCY, FORGE_MAX_CONCURRENCY)），各分析场景范围`);
    }
    console.log('    ② regression  (跑 regression-checklist)   → regression.md');
    console.log('    ③ coverage    (覆盖率交叉检查)             → coverage.md');
    console.log('       ②③ 并行执行（数据依赖独立：regression 只吃 precheck.json，coverage 另吃 acceptance.md）');
    console.log('    ④ consolidate (合并三份结果)               → stage6-report.md');
    console.log('    ⑤ verdict     (PASS/FAIL 裁决)             → verdict.md');
    if (args.autoFix) {
      console.log(`  ── F 阶段（修复，verdict=FAIL 时触发，最多 3 轮）-- --auto-fix 显式开启 [v1.3.8]`);
      console.log('    f-diagnose  (F 诊断)                        → fix-plan.md');
      console.log('    f-fix       (F 修复)                        → fix-summary.md');
      console.log('    f-audit     (driver: runAuditGate)          → audit-result.md');
    } else {
      console.log(`  ── F 阶段（修复）── 默认关闭：verdict FAIL 即停（loop-end），无 f-* 产物 [v1.3.8]`);
      console.log('     显式传 --auto-fix 才进修复链（f-diagnose → f-fix → f-audit，最多 3 轮）');
    }
    console.log('\n  ✅ dry-run 完成（未实际执行）\n');

    visibility.emit(EVENTS.LOOP_END, {
      verdict: 'DRY-RUN',
      stopReason: 'dry-run',
    });
    return;
  }

  // ─── V 阶段：5 步串行执行（acceptance → regression → coverage → consolidate → verdict）───
  // v1.2.8 功能⑦：resume 断点已过 verdict 时跳过整个 V 阶段（产物复用，不重跑不覆盖）
  let completedSteps = resumeCompletedSteps;
  let stopReason = 'completed';
  const stepErrors = [];

  if (skipVPhase) {
    console.log(`\n  🔄 resume：跳过 V 阶段 5 步（断点已完成），从 F 修复链继续`);
  }

  // v1.2.9 功能①：acceptance shard 步骤并行执行——在循环外先处理。
  // 预跑 acceptance-test.sh（所有 shard 共享同一份日志）
  // v1.3.8 交付七：--judgment-only 判断层模式跳过整个 acceptance 分片——
  // 脚本层（acceptance-test.sh）已由 session 直跑拿到确定性保证，driver 只
  // 跑有判断空间的 regression → coverage → consolidate → verdict 四步。
  if (!skipVPhase && !args.judgmentOnly) {
    // v1.3.8 交付七：--acceptance-range S294-S310 抽查化——分片范围从
    // 全量 12 片均分改为只覆盖指定区间（本版新增场景），shard 数量按区间
    // 场景数收敛（区间不足一片时合并为一片）。
    let shardsToRun = ACCEPTANCE_SHARDS;
    if (args.acceptanceRange) {
      const m = String(args.acceptanceRange).match(/^S(\d+)\s*-\s*S(\d+)$/i);
      if (!m) {
        console.error(`❌ --acceptance-range 格式非法: ${args.acceptanceRange}（应为 S294-S310 形式）`);
        process.exit(1);
      }
      const rangeStart = parseInt(m[1], 10);
      const rangeEnd = parseInt(m[2], 10);
      if (rangeStart > rangeEnd || rangeEnd > ACCEPTANCE_TOTAL_SCENARIOS) {
        console.error(`❌ --acceptance-range 区间非法: ${args.acceptanceRange}（上限 S${ACCEPTANCE_TOTAL_SCENARIOS}）`);
        process.exit(1);
      }
      // 按区间重新分片：沿用均分策略但只覆盖 [rangeStart, rangeEnd]
      const rangeCount = rangeEnd - rangeStart + 1;
      const shardCount = Math.min(ACCEPTANCE_SHARD_COUNT, Math.ceil(rangeCount / Math.ceil(rangeCount / 12)));
      const perShard = Math.ceil(rangeCount / shardCount);
      shardsToRun = [];
      for (let i = 0; i < shardCount; i++) {
        const start = rangeStart + i * perShard;
        const end = Math.min(rangeStart + (i + 1) * perShard - 1, rangeEnd);
        if (start > rangeEnd) break;
        shardsToRun.push({ id: i + 1, start, end });
      }
      console.log(`\n  [交付七] acceptance 抽查化：区间 S${rangeStart}-S${rangeEnd}（${rangeCount} 场景 → ${shardsToRun.length} 片，跳过全量 ${ACCEPTANCE_SHARD_COUNT} 片）`);
    }

    await ensureAcceptancePreRun(args, runDir);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  V 步骤 — acceptance × ${shardsToRun.length} 维度分片（并行${args.acceptanceRange ? ' · 抽查区间' : ''}）`);
    console.log(`${'═'.repeat(60)}`);

    // 并行执行所有 acceptance shard worker
    // v1.3.6 OOM 修复（run-05 事故 2026-08-17）：分片批次并发上限此前只看
    // FORGE_ACCEPTANCE_CONCURRENCY（默认 6），完全无视 FORGE_MAX_CONCURRENCY——
    // 8GB 机器 FORGE_MAX_CONCURRENCY=1 启动后仍 6 并发 × 2GB heap → OOM SIGKILL
    // 整树。修复：实际并发取两者最小值，FORGE_MAX_CONCURRENCY 作为全局硬上限
    // 对所有并发路径（worker 池 + 分片批次）一致生效。
    //
    // v1.3.7 ⑦ 自适应并发：FORGE_MAX_CONCURRENCY 的解析从写死 env 改为
    // resolveMaxConcurrency()（显式 CLI/env > totalmem 预算表 > 兜底 1）——
    // 未显式设置时 8GB 机器自动取 1，无需用户手工设 env。与 fresh-eyes driver
    // 共用 driver-base 实现（镜像漂移零容忍）。
    //
    // profile='direct'：release-gate worker 是判断层直连模式（裸 LLM 流式，
    // RSS ~64MB/worker），比 DSH 档假设（1GB/worker）低一个数量级——
    // 预算表按直连档推导（8GB 机器 → 4）。fresh-eyes 的 DSH 桥接 worker
    // 不适用本档（继续用默认 'dsh' 档）。
    const GATE_CONCURRENCY_RESOLVED = resolveMaxConcurrency({ defaultConcurrency: 1, profile: 'direct' });
    const shardWorkers = shardsToRun.map(s => [`acceptance-s${s.id}`, runDir, args.target]);
    const MAX_ACC_CONCURRENCY = Math.min(
      parseInt(process.env.FORGE_ACCEPTANCE_CONCURRENCY || '6', 10),
      GATE_CONCURRENCY_RESOLVED.concurrency
    );
    const { results: shardResults, failures: shardFailures } = await spawnAcceptanceShards(shardWorkers, args.target, MAX_ACC_CONCURRENCY);

    for (const f of shardFailures) {
      console.warn(`\n  ⚠️  ${f.step} 失败: ${f.reason?.message || f.reason}`);
      // 降级：写最小占位文件
      const outFile = `${f.step}.md`;
      const outPath = join(runDir, outFile);
      if (!existsSync(outPath)) {
        writeFileSync(outPath,
          `# ${outFile} · ${f.step} 崩溃（降级占位）\n\n` +
          `> ⚠️ worker 异常终止: ${f.reason?.message || f.reason}\n` +
          `> 其他分片的结果仍可用。\n`,
          'utf-8');
      }
      stepErrors.push({ step: f.step, error: f.reason?.message || String(f.reason) });
    }

    // v1.4.3 P1-2（run-06 V 裁决）：闸门阻塞早停——分片**全灭**（成功 0）说明
    // 环境级故障（API 全挂/网络断/权限收窄），继续跑 consolidate 与后续步骤只会
    // 空转产出无效报告（run-06 实证：S1 阻塞后 11 个分片同步空转烧完整轮预算）。
    // 部分失败不早停（单分片问题不污染其他分片证据）。
    const shardOk = shardResults.filter(r => r.value !== null).length;
    if (shardsToRun.length > 0 && shardOk === 0) {
      console.error(`\n  🔴 acceptance 分片 0/${shardsToRun.length} 成功——环境级故障，早停本轮（闸门阻塞早停）`);
      console.error(`     处置：排查环境后 --resume 或重跑；本轮产物不具评审效力`);
      stopReason = 'shards-all-failed';
      visibility.emit(EVENTS.LOOP_END, {
        verdict: 'ERROR',
        stopReason,
      });
      return { verdict: 'ERROR', stopReason };
    }

    for (const r of shardResults) {
      if (r.value !== null) completedSteps++;
    }

    console.log(`  ✅ acceptance 分片完成（${shardResults.filter(r => r.value !== null).length}/${shardsToRun.length} 成功）`);

    // acceptance-consolidate：合并分片报告（串行执行，用标准 spawnWorker）
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  V 步骤 — acceptance-consolidate（合并 ${shardsToRun.length} 份分片报告）`);
    console.log(`${'═'.repeat(60)}`);
    try {
      await spawnWorker('acceptance-consolidate', runDir, args.target);
      completedSteps++;
      console.log(`  ✅ acceptance-consolidate 完成`);
    } catch (consErr) {
      console.warn(`\n  ⚠️  acceptance-consolidate 失败: ${consErr.message}`);
      console.warn(`     降级：直接拼接分片报告作为 acceptance.md`);
      // 降级：直接拼接所有分片
      const parts = ['# Acceptance Test 结果（降级——分片拼接）', ''];
      for (const s of shardsToRun) {
        const sPath = join(runDir, `acceptance-s${s.id}.md`);
        if (existsSync(sPath)) {
          parts.push(readFileSync(sPath, 'utf-8'), '');
        }
      }
      writeFileSync(join(runDir, 'acceptance.md'), parts.join('\n'), 'utf-8');
      stepErrors.push({ step: 'acceptance-consolidate', error: consErr.message });
    }
  }

  // ── v1.3.8 交付七修复（run-06/run-10 实测迭代）：--judgment-only 模式注入 acceptance 真实结果 ──
  // 判断层跳过 acceptance 分片（脚本层直跑保证），但 consolidate/verdict 的 inputs
  // 声明了 acceptance.md——缺文件会让 fail-closed 误判 FAIL。
  // 修复演进：
  //   run-06：注入占位符 → run-10 发现占位被 verdict 拒绝（fail-closed 正确，占位无实证）；
  //   本版（run-10 修复）：找不到脚本层日志时**主动跑一次 acceptance-test.sh 拿真数据**，
  //   而不是写占位——保证注入的永远是实证。SOP 已规定脚本层预跑日志落盘 acceptance-raw.log
  //   （SOFAGENT_ACCEPTANCE_LOG 可覆盖路径），driver 兜底主动执行。
  if (!skipVPhase && args.judgmentOnly) {
    const accOutPath = join(runDir, 'acceptance.md');
    let accRawPath = process.env.SOFAGENT_ACCEPTANCE_LOG || join(REPO_ROOT, 'acceptance-raw.log');
    if (!existsSync(accRawPath)) {
      // 脚本层未预跑：driver 主动执行 acceptance（一次性，结果落盘 acceptance-raw.log 供复用）
      console.log('[driver] --judgment-only：未找到脚本层预跑日志，主动执行 acceptance-test.sh（一次性）...');
      const { execSync } = await import('node:child_process');
      try {
        const raw = execSync('bash FORGE/playbook/acceptance-test.sh', {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          timeout: 600_000, // 10 分钟上限（314 场景实测约 1.5 分钟）
          maxBuffer: 10 * 1024 * 1024,
        });
        writeFileSync(accRawPath, raw, 'utf-8');
        console.log(`[driver] --judgment-only：acceptance 实测完成，日志已落盘 ${accRawPath}`);
      } catch (execErr) {
        // execSync 失败时 stdout 在 .stdout 字段（非零退出仍返回 Buffer）
        const partial = execErr.stdout?.toString() || execErr.message || '';
        writeFileSync(accRawPath, partial, 'utf-8');
        console.error(`[driver] --judgment-only：acceptance 执行异常（exit=${execErr.status ?? 'unknown'}），日志已尽力落盘——若 SUMMARY 非全过，consolidate 会据此判 FAIL（这是真数据，不是占位）`);
      }
    }
    const raw = readFileSync(accRawPath, 'utf-8');
    // v1.4.0 修复：原 `raw.slice(0, 4000)` 硬编码截断前 4000 字符——63KB 的 acceptance 日志
    // 只注入前 128 行（场景 1-17），consolidate/verdict 拿到残缺证据误判「场景 17 截断 + 无 SUMMARY」。
    // 改为：完整日志 + 尾部 SUMMARY 兜底（consolidate 判定依赖 SUMMARY 行；超长场景保留全部证据）。
    const rawLines = raw.split('\n');
    const accBody = raw.length <= 120_000 ? raw : rawLines.slice(0, 3000).join('\n') + '\n...（日志超长截断，见尾部 SUMMARY）\n' + rawLines.slice(-60).join('\n');
    const accContent =
      `# acceptance-test 结果（--judgment-only 模式 · 脚本层实测注入）\n\n` +
      `> 来源：${accRawPath}\n\n` +
      `\`\`\`\n${accBody}\n\`\`\`\n`;
    writeFileSync(accOutPath, accContent, 'utf-8');
    const summaryLine = raw.split('\n').filter(l => l.includes('SUMMARY')).slice(-1)[0] || '（未找到 SUMMARY 行）';
    console.log(`[driver] --judgment-only：acceptance 实证已注入 ${accOutPath}（${summaryLine}）`);
  }

  // 非 acceptance shard 步骤串行执行（跳过已处理的 acceptance shard 步骤）
  const nonShardSteps = (skipVPhase ? [] : STEP_ORDER).filter(
    step => !ACCEPTANCE_SHARD_STEPS.includes(step) && step !== 'acceptance-consolidate'
  );

  // v1.4.3 性能优化：regression 与 coverage 并行波。数据依赖实况——
  // regression inputs = [regression-precheck.json]，coverage inputs =
  // [acceptance.md, coverage-precheck.json]，两者互不消费对方产物（STEP_ORDER
  // 串行是历史遗留）。coverage-precheck 是纯解析（读 changelog/场景定义 → 写
  // json），与 regression 维度脚本的 git/test 执行零互踩，并行安全。
  // precheck 与 spawnWorker 都在波内完成；错误记账（stepErrors/stopReason/
  // EVENTS.STEP_DONE）与串行路径完全一致——只省墙钟，不改语义。
  const PARALLEL_WAVE = ['regression', 'coverage'];

  const runStepWithPrechecks = async (step) => {
    const stepIndex = STEP_ORDER.indexOf(step) + 1;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  V 步骤 ${stepIndex}/${STEP_ORDER.length} — ${step}`);
    console.log(`${'═'.repeat(60)}`);

    // regression 特殊处理（v1.2.5+）：driver 预执行 checklist，worker 只读结果判定
    if (step === 'regression' && STEPS.regression.precheck) {
      try {
        await runRegressionPrecheck(runDir);
      } catch (preErr) {
        console.warn(`[driver] regression 预执行失败（worker 将回退到自行执行）: ${preErr.message}`);
      }
    }

    // coverage 特殊处理（v1.2.5+）：driver 预解析场景索引 + changelog 模块，worker 只读判定
    if (step === 'coverage' && STEPS.coverage.precheck) {
      try {
        await runCoveragePrecheck(runDir, args.target);
      } catch (preErr) {
        console.warn(`[driver] coverage 预执行失败（worker 将回退到自行执行）: ${preErr.message}`);
      }
    }

    try {
      await spawnWorker(step, runDir, args.target);
      completedSteps++;

      // v1.4.3 P1-2（run-06 V 裁决）：产物完整性校验——worker exit 0 但产物缺失/
      // 空文件（如 stall abort 后 agent 层吞错）按步骤失败记账，不让空缺流入
      // 合并/裁定步。outputs 声明即契约。
      const stepDef = STEPS[step];
      const missingOutputs = (stepDef?.outputs || []).filter(
        f => !existsSync(join(runDir, f)) || statSync(join(runDir, f)).size === 0,
      );
      if (missingOutputs.length > 0) {
        throw new Error(`产物缺失或空文件: ${missingOutputs.join(', ')}（worker exit 0 但未落盘——agent 层吞错）`);
      }

      visibility.emit(EVENTS.STEP_DONE, {
        step,
        stepIndex,
        totalSteps: STEP_ORDER.length,
      });

      console.log(`  ✅ ${step} 完成`);

      // 步骤④完成后复制报告到桌面
      if (step === 'consolidate') {
        copyToDesktop(runDir, args.target);
      }
    } catch (stepErr) {
      console.warn(`\n  ⚠️  ${step} 失败: ${stepErr.message}`);
      console.warn(`     继续执行后续步骤（步骤崩溃不中断）`);
      stepErrors.push({ step, error: stepErr.message });

      visibility.emit(EVENTS.STEP_DONE, {
        step,
        stepIndex,
        totalSteps: STEP_ORDER.length,
        error: stepErr.message,
      });

      stopReason = 'step-error';
    }
  };

  const sequentialSteps = [];
  // 从前往后找第一个 wave 步骤——wave 是连续的 ['regression','coverage']，
  // 首个成员即波起点；波前全串行，波后（consolidate/verdict）串行尾巴。
  // 注意不能从后往前扫：那会把 regression 留在前导串行、波里只剩 coverage。
  let waveIndex = nonShardSteps.length;
  for (let i = 0; i < nonShardSteps.length; i++) {
    if (PARALLEL_WAVE.includes(nonShardSteps[i])) {
      waveIndex = i;
      break;
    }
  }
  for (let i = 0; i < waveIndex; i++) sequentialSteps.push(nonShardSteps[i]);
  const waveSteps = nonShardSteps.slice(waveIndex, waveIndex + PARALLEL_WAVE.length)
    .filter(st => PARALLEL_WAVE.includes(st));
  const tailSteps = nonShardSteps.slice(waveIndex + waveSteps.length);

  for (const step of sequentialSteps) {
    await runStepWithPrechecks(step);
  }

  if (waveSteps.length > 0) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  V 并行波 — ${waveSteps.join(' ∥ ')}（数据依赖独立，precheck + worker 并行）`);
    console.log(`${'═'.repeat(60)}`);
    await Promise.all(waveSteps.map(st => runStepWithPrechecks(st)));
  }

  for (const step of tailSteps) {
    await runStepWithPrechecks(step);
  }

  // ─── 解析 V 阶段裁决 ───
  // v1.4.3 P1-2：分片全灭早停路径直接落账 ERROR——不 parseVerdict（verdict.md
  // 不存在或为降级占位，解析必得 ERROR，直接声明语义更明确）。
  if (stopReason === 'shards-all-failed') {
    saveGateCheckpoint('verdict-done', 'ERROR', 0);
    visibility.emit(EVENTS.LOOP_END, {
      verdict: 'ERROR',
      stopReason,
      completedSteps,
      stepErrors: stepErrors.map(e => e.step),
    });
    disarmSignalCleanup();
    safeTeardownWorktree();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    return 'ERROR';
  }
  const results = parseStepResults(runDir);
  let verdict, reason;
  if (skipVPhase) {
    // v1.2.8 功能⑦：resume 模式下 verdict 取自断点（V 阶段未重跑，
    // 断点是唯一权威——不重新 parseVerdict，避免读旧 verdict.md 产生歧义）
    verdict = resumeVerdict;
    reason = resumeReason;
    console.log(`\n  🔄 resume：verdict=${verdict}（来自断点）`);
  } else {
    ({ verdict, reason } = parseVerdict(runDir));
    // v1.2.8 功能⑦：V 阶段完成后（verdict 解析后）写断点
    // fixRoundsRun=0 表示 F 轮尚未开始；V 阶段内不写步骤级断点（幂等可重跑）
    saveGateCheckpoint('verdict-done', verdict, 0);
  }

  // ═══════════════════════════════════════════════════════════
  //  v1.2.8 功能⑤：F 修复链——verdict FAIL 时触发
  //  流程：verdict FAIL → f-diagnose → f-fix → f-audit → 回到 verdict 判定
  //  最多 MAX_FIX_ROUNDS 轮，每轮独立诊断+修复+审计
  // ═══════════════════════════════════════════════════════════
  const MAX_FIX_ROUNDS = 3;
  const F_STEPS = ['f-diagnose', 'f-fix', 'f-audit'];
  // run-01 假 PASS 修复：f-audit 真实结果跨迭代传递（保守判定，见下方收敛逻辑）
  let lastAuditGateResult = null;
  // v1.2.8 功能⑦：resume 模式从断点恢复已完成 F 轮数，从 fixRoundsRun+1 继续
  let fixRoundsRun = resumeFixRoundsRun;

  // ─── v1.3.8 交付七：F 循环 FAIL 即停 ───
  // verdict FAIL 且未显式传 --auto-fix → 直接 loop-end，不进修复链、
  // 无任何 f-* 产物。修复责任交回主 session（阶段五）——driver 盲审的
  // 独立性与修复者的上下文不该混在同一 run 里。
  if (verdict === 'FAIL' && !args.autoFix) {
    console.log(`\n  ❌ verdict=FAIL — 循环终止（--auto-fix 未开启，不进 F 修复链）`);
    console.log(`     产物：verdict.md + stage6-report.md；无 f-diagnose/f-fix/f-audit 产物`);
    console.log(`     下一步：回阶段五人工修复（docs/changelog/releasing/06-release-gate.md）`);
    stopReason = 'verdict-fail-stop';
  }

  while (verdict === 'FAIL' && fixRoundsRun < MAX_FIX_ROUNDS && args.autoFix) {
    fixRoundsRun++;
    const round = fixRoundsRun;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🚪 F 修复链 — Round ${round}/${MAX_FIX_ROUNDS}`);
    console.log(`     verdict=${verdict} reason=${reason}`);
    console.log(`${'═'.repeat(60)}`);

    for (const fStep of F_STEPS) {
      const stepDef = STEPS[fStep];
      console.log(`\n  [F/${round}] ${fStep} ...`);

      try {
        if (stepDef.role === null) {
          // driver 步骤：直接执行 runAuditGate（不 spawn worker）
          console.log(`     → driver 步骤（role:null），执行 ${stepDef.driverFn}`);
          // v1.3.6 交付⑩：worktree 隔离时 f-fix 的 commit 落副本分支，
          // auto-commit / diff 在副本上跑（审计二进制仍从主仓加载）。
          const auditResult = await base.runAuditGate(runDir, fStep, round, {
            gitRoot: (globalWorktree && globalWorktree.worktreeDir) || undefined,
          });
          console.log(`     audit gate: passed=${auditResult.passed} exitCode=${auditResult.exitCode}`);
          // run-01 假 PASS 修复：把 f-audit 的真实 passed 传出循环外供收敛判定用。
          // 原 bug：返回值只打日志被扔掉，外层用「audit-result.md 不含 VIOLATIONS」
          // 文本判定（COMMIT FAILED 时不含 VIOLATIONS → 乐观 true → verdict 被强改 PASS）。
          lastAuditGateResult = auditResult;
          completedSteps++;
        } else {
          // LLM 步骤：spawn worker
          await spawnWorker(fStep, runDir, args.target);
          completedSteps++;
          console.log(`  ✅ ${fStep} 完成`);
        }
      } catch (fErr) {
        console.warn(`\n  ⚠️  ${fStep} 失败: ${fErr.message}`);
        stepErrors.push({ step: `${fStep}/${round}`, error: fErr.message });
        // F 步骤失败不中断循环，继续下一步（降级处理）
      }
    }

    // 重新解析裁决（F 修复后可能变 PASS）
    // 注意：f-fix 改了代码，需要重跑 verdict 才能拿到新裁决。
    // 但重跑 verdict 意味着再 spawn 一个 V worker——这里走轻量路径：
    // 如果 f-audit passed=true，认为本轮修复有效，跳出 F 链。
    // 如果 f-audit passed=false（有违规），继续下一轮 F 链。
    //
    // run-01 假 PASS 修复：判定源从「audit-result.md 文本不含 VIOLATIONS」（乐观默认 true，
    // COMMIT FAILED / EXECUTION FAILED 时不含 VIOLATIONS → 假收敛）改为
    // 「runAuditGate 真实返回 passed + 产物存在性」双重信号：
    //   - lastAuditGateResult.passed === true 且 audit-result.md 无 FAIL 标记 → 收敛
    //   - f-audit 从未执行（异常跳过）→ 不收敛，进下一轮
    //
    // 🔴 v1.3.6 第三重校验（run-08 + 2026-08-18/run-01 两轮假 PASS 根治）：
    //   f-audit 审的是 worktree 分支 HEAD~1..HEAD 的 diff——f-fix 若零 commit，
    //   diff 为空，audit 对空 diff 必然全绿 → 「修复收敛」是假的。判定收敛前必须
    //   校验 F 分支自基线起有真实新 commit：零 commit = f-fix 没干活 = 修复失败，
    //   禁止判收敛（继续下一轮 F 或耗尽轮数报 FAIL）。
    const fBranchCommitCount = (() => {
      try {
        if (!globalWorktree || !globalWorktree.branch || !globalWorktree.baseSha) return -1; // 无 worktree 信息，无法校验（老路径兼容：不做拦截）
        const out = execSync(
          `git rev-list --count ${globalWorktree.baseSha}..${globalWorktree.branch}`,
          { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 15_000 },
        ).toString().trim();
        return parseInt(out, 10);
      } catch { return -1; } // git 失败不阻塞（保守放行到下重信号）
    })();
    const auditResultPath = join(runDir, 'audit-result.md');
    let auditPassed = false; // 保守默认（run-01 教训：乐观默认 = 假 PASS 温床）
    if (lastAuditGateResult) {
      auditPassed = lastAuditGateResult.passed === true;
    }
    if (auditPassed && existsSync(auditResultPath)) {
      const auditText = readFileSync(auditResultPath, 'utf-8');
      if (auditText.includes('COMMIT FAILED') || auditText.includes('EXECUTION FAILED') || auditText.includes('❌ VIOLATIONS')) {
        auditPassed = false;
      }
    }
    if (auditPassed && fBranchCommitCount === 0) {
      auditPassed = false;
      console.warn(`  🔴 [F/${round}] 零 commit 校验拦截：F 分支自基线无任何新 commit——f-fix 未产生代码改动，audit 全绿是对空 diff 的假绿。不判收敛（run-08 + 2026-08-18/run-01 两轮假 PASS 根因）`);
    }
    if (!lastAuditGateResult) {
      console.warn(`  ⚠️  [F/${round}] f-audit 无执行结果（异常跳过），不判收敛——继续下一轮`);
    }

    if (auditPassed) {
      console.log(`\n  [F/${round}] audit gate 通过（无违规），F 修复链收敛`);
      verdict = 'PASS';
      reason = `F 修复链 Round ${round} 后 audit 通过`;
      // v1.3.0 run-21 修复：F 收敛后同步 verdict.md——否则文件仍是 V 阶段 FAIL 文本，
      // 监控端读 verdict.md(FAIL) 与 status.json(PASS) 矛盾（run-21 实测）。
      // 追加收敛记录而非覆盖（保留 V 阶段 FAIL 依据可追溯）。
      try {
        const verdictPath = join(runDir, 'verdict.md');
        if (existsSync(verdictPath)) {
          appendFileSync(verdictPath,
            `\n---\n\n## F 修复链收敛（Round ${round}）\n\n判定更新：FAIL → **PASS**\n依据：f-audit 通过（无 VIOLATIONS），F 修复链收敛\n`,
            'utf-8');
        }
      } catch (vErr) {
        console.warn(`  ⚠️  verdict.md 同步失败（不影响主流程）: ${vErr.message}`);
      }
      // Bug-F2 修复：F 修复链收敛为 PASS 后，重新解析 results 确保状态一致。
      // 原 bug：results 只在 V 阶段结束后解析一次（L1980），F 修复后 verdict 改为 PASS
      // 但 results.acceptance/regression 仍为初始 FAIL 值——状态不一致。
      const updatedResults = parseStepResults(runDir);
      results.acceptance = updatedResults.acceptance;
      results.regression = updatedResults.regression;
      results.coverage = updatedResults.coverage;
      console.log(`     更新后 results: acceptance=${results.acceptance} regression=${results.regression} coverage=${results.coverage}`);
      // v1.2.8 功能⑦：本轮 F 完成且收敛为 PASS → 写断点（resume 时识别为已完成）
      saveGateCheckpoint('f-round-done', verdict, round);
      break;
    } else {
      console.log(`\n  [F/${round}] audit gate 发现违规，${round < MAX_FIX_ROUNDS ? '进入下一轮修复' : '已达最大轮次上限'}`);
      // v1.2.8 功能⑦：本轮 F 完成（仍有违规）→ 写断点，resume 从 round+1 继续
      saveGateCheckpoint('f-round-done', 'FAIL', round);
    }
  }

  if (verdict === 'FAIL' && fixRoundsRun >= MAX_FIX_ROUNDS) {
    stopReason = 'fix-rounds-exhausted';
    console.log(`\n  ⚠️  F 修复链已达 ${MAX_FIX_ROUNDS} 轮上限，仍有违规——标记为 FAIL 交付`);
  }

  // v1.2.8 功能⑦：循环正常走完（含 fix-rounds-exhausted）写最终断点——
  // 记录终态 verdict，resume 时直接识别为已完成（PASS）或轮次耗尽（FAIL），
  // 不会无意义地重新续跑。
  saveGateCheckpoint('f-round-done', verdict, fixRoundsRun);

  // usage.jsonl 全量摘要
  const usageSummary = appendUsageSummary(runDir, completedSteps);
  console.log(
    `\n  [总用量] tokens: ${usageSummary.total_tokens.toLocaleString()}  ` +
    `(V+F 订阅制)`
  );

  // 写 LEDGER
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  循环结束 — 停止原因: ${stopReason}`);
  console.log(`  完成步数: ${completedSteps}（V: 5 + F 链: ${fixRoundsRun * 3}）`);
  console.log(`  验证结果: acceptance=${results.acceptance} regression=${results.regression} coverage=${results.coverage}`);
  console.log(`  最终裁决: ${verdict} (${reason})`);
  if (fixRoundsRun > 0) {
    console.log(`  F 修复链: ${fixRoundsRun}/${MAX_FIX_ROUNDS} 轮`);
  }
  if (stepErrors.length > 0) {
    console.log(`  步骤错误: ${stepErrors.map(e => e.step).join(', ')}`);
  }
  console.log(`${'═'.repeat(60)}`);

  appendLedger(dateStr, runId, completedSteps, results, verdict, runDir);

  // 可见性：循环结束
  visibility.emit(EVENTS.LOOP_END, {
    verdict,
    stopReason,
    completedSteps,
    results,
    stepErrors: stepErrors.map(e => e.step),
  });

  // v1.3.6 worktree 留存根治：正常结束解除信号清理（后续 safeTeardownWorktree 兜底）
  disarmSignalCleanup();
  // v1.3.6 交付⑩：正常结束清理 worktree（LEDGER 已在上方留行）
  safeTeardownWorktree();

  // v1.3.9：正常结束清理心跳定时器（dry-run 不注册，null 守卫）——否则
  // 15s interval 阻止事件循环排空 → main return 后进程挂住。
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  console.log(`\n${verdict === 'PASS' ? '✅' : '❌'} release-gate-loop 完成 — 裁决: ${verdict}\n`);
}

// ─── v1.3.6 交付⑩：全局异常兜底（镜像 fresh-eyes）───
// 进程被 OS 直接杀死（OOM SIGKILL）时 main().catch() 不执行。
// uncaughtException / unhandledRejection handler 确保崩溃路径也清理 worktree。
process.on('uncaughtException', (err) => {
  console.error(`\n💥 uncaughtException: ${err.message}`);
  console.error(err.stack);
  safeTeardownWorktree(); // 崩溃路径也清理 worktree
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(`\n💥 unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  if (reason instanceof Error) console.error(reason.stack);
  safeTeardownWorktree(); // 崩溃路径也清理 worktree
  process.exit(1);
});

main().catch(err => {
  console.error(`\n💥 致命错误: ${err.message}`);
  console.error(err.stack);
  if (globalVisibility) {
    globalVisibility.emit(EVENTS.ERROR, {
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 3).join(' | '),
    });
    globalVisibility.emit(EVENTS.LOOP_END, {
      verdict: 'ERROR',
      stopReason: 'fatal-error',
    });
  }
  // v1.3.6 交付⑩：fatal-error 路径也清理 worktree（异常退出同样清理——铁律）
  safeTeardownWorktree();
  process.exit(1);
});
