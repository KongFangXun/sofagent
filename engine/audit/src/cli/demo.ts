// ============================================================
// cli/demo.ts · `sofagent-audit demo` 五分钟戏剧弧（v1.5.1 第八章）
// ============================================================
//
// 定位：转化漏斗第一环——一条命令让新用户在五分钟内**亲眼看一次拦截发生**。
// 形态：`[通道]`（演示编排）｜ L4 卸包——串接既有能力的脚本面，
//       **零新引擎逻辑**（不新增规则、不改判定、不新增 bin）。
//
// 🔴 挂点：`sofagent-audit` 的子命令入口就是 src/cli-quick.ts
//    （package.json bin → dist/cli-quick.js），本模块由 cli-quick 的
//    `argv[2] === 'demo'` 分支调用。**不新增 bin**——不碰「13 bin → 1」收敛叙事，
//    且传播命令与试用命令同体（看完 demo 去掉 `demo` 就是真审计）。
//    主分发形态：`npx -y -p @sofagent/audit sofagent-audit demo`
//
// 🔴 确定性与真实性双约束：
//    ① 固定种子（demo-fixtures/seed.ts）+ 固定 git 日期/身份 + 固定沙箱密钥
//       → 判定结果、commit SHA、回滚 diff 与 demo-report.md 跨次运行一致；
//    ② **全程真实引擎**——幕③ 是真的 `git commit` 触发真的 git hook 调用真的
//       审计引擎（零 mock 拦截、零预录输出）。mock 掉的 demo 等于没有 demo。
//
// 🔴 沙箱隔离：只在 /tmp 建演示仓库，真实文件零接触——
//    三个环境变量把子进程的全部读写引到沙箱内：
//      SOFAGENT_HOME=<sandbox>/.sofagent        （审计数据 / 内部状态的根）
//      SOFAGENT_DATA=<sandbox>/.sofagent/data   （history.jsonl 落点，兼防
//                                                用户环境已设 SOFAGENT_DATA 时越界）
//      SOFAGENT_KEY_PATH=<sandbox>/.sofagent/demo-key（HMAC 密钥，绝不碰
//                                               用户的 ~/.sofagent-key）
//    退出时 rm -rf 沙箱（成功与失败路径都清）。
//
// 🔴 零依赖：纯终端文本输出（不引 TUI 库）——截图即可传播，
//    且 npx 冷启动不拖依赖。
//
// 用法：
//   sofagent-audit demo                  五幕完整版
//   sofagent-audit demo --speed fast     60 秒精简版（跳幕①②，直入拦截）
//   sofagent-audit demo --out <dir>      指定产物目录（缺省 `<dataDir>/demo`，即
//                                        `$SOFAGENT_DATA/demo`——沿用仓内 dataDir 解析口径）
// ============================================================

import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { installHooks } from '../hook-install';
import { resolveHomeDir, getDataDir, extractConstraintsFromPrompt, generateAgentIdentity, listAllSnapshots, restoreSnapshot } from '@sofagent/core';
import { defaultRules, extendedRules } from '../rules/index';
import {
  SANDBOX_PREFIX,
  SANDBOX_PLACEHOLDER,
  DEMO_GIT_USER,
  DEMO_GIT_DATE,
  DEMO_TASK_SUBJECT,
  SEED_BASE_SUBJECT,
  SEED_GITIGNORE,
  SEED_ORDERS_JS,
  SEED_CUSTOMERS_JS,
  SEED_SYSTEM_PROMPT,
  SEED_WORKFLOW_YML,
  WORKFLOW_PATH,
  VIOLATION_ENV_FILE,
  VIOLATION_ENV_CONTENT,
  VIOLATION_ENV_SUBJECT,
  VIOLATION_SECRET_FILE,
  VIOLATION_SECRET_SUBJECT,
  VIOLATION_SCOPE_FILE,
  POLLUTION_MARKER,
  demoSandboxKey,
  violationSecretContent,
  violationScopeContent,
} from './demo-fixtures/index';

// ============================================================
// 类型
// ============================================================

/** 演示速度档位：normal = 五幕完整；fast = 跳幕①②（60 秒精简版） */
export type DemoSpeed = 'normal' | 'fast';

/** 单幕执行结果 */
export interface DemoActResult {
  /** 幕名（如「幕③ · 拦截」） */
  scope: string;
  /** 本幕是否按预期完成 */
  ok: boolean;
}

/**
 * 一次违规注入的实测判决。
 * 🔴 字段全部来自**真实执行**：hookExit 是 `git commit` 的真实退出码，
 *    hitRules 从引擎原始输出里解析（不是我们「声称」命中了哪条）。
 */
export interface ViolationVerdict {
  /** 规则号（A1 / A2 / A3） */
  ruleId: string;
  /** 违规类型（如「敏感文件 .env」） */
  title: string;
  /** 本次注入涉及的沙箱相对路径 */
  file: string;
  /** commit subject（A3 的 task 来源） */
  subject: string;
  /** 引擎判定：commit 是否被拒（hook 非零退出 → git commit 非零） */
  rejected: boolean;
  /** `git commit` 的真实退出码 */
  hookExit: number;
  /** 从引擎输出解析出的命中规则号（升序去重） */
  hitRules: string[];
  /** 引擎原始输出（用于报告与终端的证据面） */
  raw: string;
}

/** runDemo 的完整产物 */
export interface DemoRunResult {
  /** 0 = 五幕全绿；1 = 引擎未构建 / 必要条件缺失 */
  exitCode: number;
  /** 沙箱目录（已清理时仅作记录） */
  sandboxDir: string;
  /** 沙箱是否已清理干净 */
  sandboxCleaned: boolean;
  /** 沙箱隔离探针结论（真实 ~/.sofagent 未被写入） */
  isolationOk: boolean;
  /** 三类违规实测判决 */
  verdicts: ViolationVerdict[];
  /** 幕⑤ HMAC 链验证是否通过 */
  chainOk: boolean;
  /** demo-report.md 落盘路径 */
  reportPath: string;
  /** 五幕原始终端输出落盘路径（CI artifact） */
  transcriptPath: string;
  /** 逐幕结果 */
  acts: DemoActResult[];
}

/** CLI 解析结果 */
export interface DemoArgs {
  speed: DemoSpeed;
  outDir: string;
  help: boolean;
  unknown: string[];
}

// ============================================================
// 输出缓冲：终端 + transcript 双写
// ============================================================

/** 演示输出器——每行同时进终端与 transcript（CI artifact 的原文） */
class DemoPrinter {
  readonly transcript: string[] = [];

  line(text = ''): void {
    console.log(text);
    this.transcript.push(text);
  }

  /** 引擎原始输出缩进展示（保留原文进 transcript，便于 artifact 举证） */
  engineOutput(text: string): void {
    const trimmed = text.replace(/\s+$/, '');
    if (trimmed === '') return;
    for (const l of trimmed.split('\n')) {
      console.log(`  │ ${l}`);
    }
    this.transcript.push(...trimmed.split('\n').map((l) => `  | ${l}`));
  }
}

/** 幕标题（终端视觉锚点——截图传播时的信息骨架） */
function actHeader(p: DemoPrinter, title: string): void {
  p.line('');
  p.line('═'.repeat(64));
  p.line(title);
  p.line('═'.repeat(64));
}

// ============================================================
// 路径解析（挂点：两种布局都要命中）
// ============================================================

/**
 * 解析「完整引擎 CLI 入口」绝对路径（幕③ hook 要执行的审计引擎）。
 *
 * hook 模板（engine/audit/hooks/commit-msg）的执行面按
 * `SOFAGENT_AUDIT_ENTRY` 显式注入优先——本函数为它提供值。
 * 两个候选覆盖两种布局：
 *   ① dist 布局（npm 分发形态）：__dirname=dist/cli → dist/index.js
 *   ② src 布局（vitest / ts-node）：__dirname=src/cli → engine/audit/dist/index.js
 *
 * @returns 入口绝对路径；两候选均不存在时返回 null（调用方 fail-loud）
 */
export function resolveEngineEntry(): string | null {
  const candidates = [
    join(__dirname, '..', 'index.js'),
    join(__dirname, '..', '..', 'dist', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * 解析 hook 模板目录。两种布局下 `__dirname/../../hooks` 恰好都命中：
 *   dist 布局：<pkg>/dist/cli → <pkg>/hooks
 *   src  布局：engine/audit/src/cli → engine/audit/hooks
 * package.json 的 files 已含 `hooks/` → npm 分发包里模板同在。
 */
export function resolveHooksTemplateDir(): string {
  return join(__dirname, '..', '..', 'hooks');
}

// ============================================================
// 子进程执行
// ============================================================

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  combined: string;
}

/** 执行命令并回收输出（永不抛——退出码由调用方判读） */
function run(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): RunResult {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env, encoding: 'utf-8' });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return { status: r.status ?? -1, stdout, stderr, combined: `${stdout}${stderr}` };
}

/** git 快捷封装（固定 `--no-pager`，防交互式分页挂住 CI） */
function git(args: string[], cwd: string, env: NodeJS.ProcessEnv): RunResult {
  return run('git', ['--no-pager', ...args], { cwd, env });
}

// ============================================================
// 沙箱
// ============================================================

/** 沙箱根目录（/tmp 优先——任务书硬约束「只在 /tmp 建 demo 仓」） */
function sandboxBaseDir(): string {
  return existsSync('/tmp') ? '/tmp' : tmpdir();
}

/**
 * 构造子进程环境：把审计引擎的全部读写引到沙箱内。
 *
 * 🔴 SOFAGENT_HOME_ALLOWED_PREFIXES 是必需项而非可选：@sofagent/core 的
 *    sanitizeSofagentHome 对越界的 SOFAGENT_HOME **fail-loud 抛错**（v1.4.8 R6），
 *    而 /tmp 不在默认白名单（home / /opt/sofagent / /var/lib/sofagent）内。
 *    该环境变量是产品既有的显式放行通道（企业自定义根目录同款），
 *    此处只放行**本次沙箱根**，不放行整个 /tmp。
 */
function sandboxEnv(sandbox: string, engineEntry: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = join(sandbox, '.sofagent');
  return {
    ...process.env,
    // 审计数据 / 内部状态根（history.jsonl、快照、session 报告全在沙箱内）
    SOFAGENT_HOME: home,
    SOFAGENT_HOME_ALLOWED_PREFIXES: sandbox,
    // 显式覆盖 SOFAGENT_DATA——用户环境若已设它，缺此项会把审计历史写进用户目录
    SOFAGENT_DATA: join(home, 'data'),
    // HMAC 密钥指向沙箱（绝不触碰用户 ~/.sofagent-key）
    SOFAGENT_KEY_PATH: join(home, 'demo-key'),
    // hook 模板的执行面：显式注入，避免回退到被审仓库内不可达的默认解析链
    SOFAGENT_AUDIT_ENTRY: engineEntry,
    // 确定性：固定提交时间与身份（两次运行产出同一 commit SHA）
    GIT_AUTHOR_DATE: DEMO_GIT_DATE,
    GIT_COMMITTER_DATE: DEMO_GIT_DATE,
    GIT_AUTHOR_NAME: DEMO_GIT_USER.name,
    GIT_AUTHOR_EMAIL: DEMO_GIT_USER.email,
    GIT_COMMITTER_NAME: DEMO_GIT_USER.name,
    GIT_COMMITTER_EMAIL: DEMO_GIT_USER.email,
    ...extra,
  };
}

/** 沙箱构建结果 */
interface Sandbox {
  dir: string;
  env: NodeJS.ProcessEnv;
}

/**
 * 幕 0 · 沙箱构建：
 *   mkdtemp（/tmp）→ git init → 固定身份 → **真实 installHooks**（三层防线）
 *   → 写白名单 `.gitignore` → 落沙箱密钥。
 *
 * 🔴 复用既有安装器而非手抄 hook：installHooks 是 --init / --install-hook 的
 *    同一实现（core.hooksPath 尊重、用户 hook 链式保留、chmod 755 全在其中）——
 *    手抄一份 hook 内容即制造「demo 测的不是真 hook」的静默退化面。
 * 🔴 core.excludesFile=/dev/null：宿主全局 gitignore（常见 `~/.gitignore_global`
 *    已排除 .env）会让幕③ 的 .env 注入**静默不生效**——演示必须与宿主配置无关。
 */
function buildSandbox(engineEntry: string, p: DemoPrinter, templateDir: string): Sandbox {
  const dir = mkdtempSync(join(sandboxBaseDir(), SANDBOX_PREFIX));
  const env = sandboxEnv(dir, engineEntry);

  git(['init', '-q', '.'], dir, env);
  git(['config', 'user.name', DEMO_GIT_USER.name], dir, env);
  git(['config', 'user.email', DEMO_GIT_USER.email], dir, env);
  git(['config', 'core.excludesFile', '/dev/null'], dir, env);

  // 真实安装器：三层防线（pre-commit / commit-msg / post-commit）落 .git/hooks
  installHooks({ cwd: dir, templateDir, log: () => { /* 安装回声由本幕统一输出 */ } });

  writeFileSync(join(dir, '.gitignore'), SEED_GITIGNORE, 'utf-8');

  // 沙箱密钥：HMAC 链路真实签名（否则验链退化为弱校验），且只存在于沙箱内
  mkdirSync(join(dir, '.sofagent'), { recursive: true, mode: 0o700 });
  const keyPath = join(dir, '.sofagent', 'demo-key');
  writeFileSync(keyPath, `${demoSandboxKey()}\n`, 'utf-8');
  chmodSync(keyPath, 0o600);

  p.line(`  沙箱仓库   ${dir}`);
  p.line(`  hook 模板  ${templateDir}`);
  p.line(`  审计引擎   ${engineEntry}`);
  p.line(`  隔离根     SOFAGENT_HOME=${join(dir, '.sofagent')}`);
  p.line('  真 hook 已安装（pre-commit / commit-msg / post-commit 三层防线）');

  return { dir, env };
}

// ============================================================
// 幕① · 进场写规则（基线提交）
// ============================================================

/**
 * 幕①：写入虚构电商「示例优选」基线内容并做一次**真实审计的基线提交**。
 *
 * 基线提交必须走 hook（不用 --no-verify）：① 它是「审计通过」的第一拍
 * （用户先看到绿灯，幕③ 的红灯才有落差）；② 审计引擎在通过态落一个
 * 干净快照——幕④ 回滚的目标就是它。
 */
function act1SeedRepo(sb: Sandbox, p: DemoPrinter, speed: DemoSpeed): { ok: boolean; baselineSha: string | null } {
  const { dir, env } = sb;
  if (speed === 'fast') {
    p.line('  ⏩ fast 档：跳过幕①②的内容生成（基线提交保留——幕③④ 需要基线）。');
  }

  writeFileSync(join(dir, 'orders.js'), SEED_ORDERS_JS, 'utf-8');
  writeFileSync(join(dir, 'customers.js'), SEED_CUSTOMERS_JS, 'utf-8');
  if (speed === 'normal') {
    writeFileSync(join(dir, WORKFLOW_PATH), SEED_WORKFLOW_YML, 'utf-8');
    p.line('  已生成  workflow.yml（节点声明模板）');
  }
  p.line('  已生成  orders.js · customers.js（虚构电商「示例优选」）');

  git(['add', '-A'], dir, env);
  const commit = git(['commit', '-m', SEED_BASE_SUBJECT], dir, env);
  if (speed === 'normal') p.engineOutput(commit.combined);

  const baselineSha = git(['rev-parse', 'HEAD'], dir, env).stdout.trim();
  const ok = commit.status === 0 && baselineSha !== '';
  p.line(`  基线提交 ${ok ? '✅ 审计通过' : '❌ 未通过'}  HEAD=${baselineSha.slice(0, 8)}`);
  return { ok, baselineSha: ok ? baselineSha : null };
}

// ============================================================
// 幕② · 约束注入
// ============================================================

/**
 * 幕②：演示「约束先于行动注入」。三块内容**全部由真实引擎产出**：
 *   ① `extractConstraintsFromPrompt`（@sofagent/core）解析加载链 L1 约束摘要；
 *   ② `generateAgentIdentity` 计算真实身份指纹（确定性：同 prompt/tools/约束同指纹）；
 *   ③ 规则注册表（../rules/index）给出本次要跑的**真实**规则清单与条数。
 */
function act2InjectConstraints(sb: Sandbox, p: DemoPrinter): boolean {
  const constraints = extractConstraintsFromPrompt(SEED_SYSTEM_PROMPT);
  // tools 列表取真实规则 ID——「注入的约束」与「判定它的规则」同源，不是装饰
  const tools = defaultRules.map((r) => r.id);
  const identity = generateAgentIdentity('示例优选·订单工程师', {
    systemPrompt: SEED_SYSTEM_PROMPT,
    tools,
    constraints,
    principal: 'demo',
  });

  p.line('  加载链 L1 约束摘要（extractConstraintsFromPrompt 真实解析）：');
  for (const c of constraints) p.line(`    · ${c}`);
  p.line('');
  p.line(`  身份指纹 fingerprint = ${identity.fingerprint}`);
  p.line(`  身份短码 shortCode   = ${identity.shortCode}`);
  p.line('');
  p.line(`  本次要跑的规则：默认 ${defaultRules.length} 条 + 扩展 ${extendedRules.length} 条 = ${defaultRules.length + extendedRules.length} 条`);
  p.line(`  （默认档：${defaultRules.map((r) => r.id).join(' ')}）`);

  const ok = constraints.length > 0 && identity.fingerprint.length > 0;
  if (!ok) p.line('  ❌ 约束注入未产出（extractConstraintsFromPrompt 返回空）');
  return ok;
}

// ============================================================
// 幕③ · 拦截（重头戏）
// ============================================================

/**
 * 从引擎原始输出解析真实命中的规则号。
 * 引擎逐条输出形如 `❌ [sofagent] A1 不碰敏感 [底线]: …`——
 * 只认「引擎自己写的行」，不采信调用方的预设期望。
 */
export function parseHitRules(engineOutput: string): string[] {
  const hits = new Set<string>();
  const re = /\[sofagent\]\s+(A\d+)\s/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(engineOutput)) !== null) {
    if (m[1]) hits.add(m[1]);
  }
  return [...hits].sort();
}

/**
 * 执行一次「注入 → 真实提交 → hook 真实拦截」的完整回合。
 *
 * 🔴 本函数是全 demo 的重心：它调用的是**真的 git commit**，由真的
 *    .git/hooks/commit-msg 拉起**真的审计引擎**（SOFAGENT_AUDIT_ENTRY 指定），
 *    退出码来自引擎判定链（0=全绿 / 1=警告放行 / 2=违规阻断 ⇒ hook exit 1）。
 *    没有任何 mock、没有任何预录文本。
 */
function attemptCommit(
  sb: Sandbox,
  spec: { ruleId: string; title: string; file: string; content: string; subject: string },
  p: DemoPrinter,
): ViolationVerdict {
  const { dir, env } = sb;
  writeFileSync(join(dir, spec.file), spec.content, 'utf-8');
  git(['add', '-A'], dir, env);

  const r = git(['commit', '-m', spec.subject], dir, env);
  const hitRules = parseHitRules(r.combined);
  const rejected = r.status !== 0;

  p.line('');
  p.line(`  ── 注入 ${spec.ruleId} · ${spec.title}（${spec.file}）`);
  p.line(`　　 commit subject: ${spec.subject}`);
  p.engineOutput(r.combined);
  p.line(`　　 实测：命中规则 = ${hitRules.length > 0 ? hitRules.join(' ') : '(无)'} · git commit exit = ${r.status} · ${rejected ? '❌ commit 被拒' : '⚠️ commit 放行'}`);

  return { ruleId: spec.ruleId, title: spec.title, file: spec.file, subject: spec.subject, rejected, hookExit: r.status, hitRules, raw: r.combined };
}

/**
 * 幕③：三类违规各走一次**独立**提交。
 *
 * 🔴 为什么必须分三次提交：runner 的 critical 层一命中 FAIL 就 fast-fail
 *    后续层（rules/runner.ts:206）——A1/A2（critical）与 A3（warning 层）
 *    混在同一次提交里，A3 会被标 SKIPPED，看不到它的真实判定。
 *
 * 🔴 三类各自的**真实**档位（不改判定逻辑，如实呈现）：
 *    A1 不碰敏感（critical · 业务底线）→ FAIL → exit 2 → commit 被拒
 *    A2 不泄密钥（critical · 业务底线）→ FAIL → exit 2 → commit 被拒
 *    A3 不改越界（warning · 能力拐杖）→ WARN → exit 1 → **commit 放行**
 *       —— A3 的 ruleClass 是「能力拐杖」，runner 明确把拐杖类 FAIL/WARN
 *          降为 advisory 不阻断（rules/runner.ts:266）。这是引擎的既有语义，
 *          demo 不掩饰、也不改判定去凑「三连红」。这条「漏网」正是幕④
 *          快照回滚的素材（滚回兜住拐杖规则放过去的污染）。
 *
 * 每回合之间清掉上一回合的违规产物（模拟「人修好违规后重试」），
 * 使沙箱工作区回到基线——快照时间线不被前两回合的残留污染。
 */
function act3Intercept(sb: Sandbox, p: DemoPrinter): ViolationVerdict[] {
  const { dir, env } = sb;
  const verdicts: ViolationVerdict[] = [];

  // 违规一：密钥/凭据文件落进仓库（A1）
  verdicts.push(
    attemptCommit(
      sb,
      { ruleId: 'A1', title: '敏感文件入库（.env）', file: VIOLATION_ENV_FILE, content: VIOLATION_ENV_CONTENT, subject: VIOLATION_ENV_SUBJECT },
      p,
    ),
  );
  cleanupViolationArtifact(dir, env, VIOLATION_ENV_FILE);

  // 违规二：云访问密钥硬编码进源码（A2）
  verdicts.push(
    attemptCommit(
      sb,
      { ruleId: 'A2', title: '硬编码密钥', file: VIOLATION_SECRET_FILE, content: violationSecretContent(), subject: VIOLATION_SECRET_SUBJECT },
      p,
    ),
  );
  cleanupViolationArtifact(dir, env, VIOLATION_SECRET_FILE);

  // 违规三：越界编辑（task 只点名 orders.js，却改了客户数据）
  verdicts.push(
    attemptCommit(
      sb,
      { ruleId: 'A3', title: '越界编辑（任务范围外的客户数据）', file: VIOLATION_SCOPE_FILE, content: violationScopeContent(), subject: DEMO_TASK_SUBJECT },
      p,
    ),
  );

  return verdicts;
}

/** 清掉一回合的违规产物，使工作区回到基线（前两回合均被拦截，无 commit 产生） */
function cleanupViolationArtifact(dir: string, env: NodeJS.ProcessEnv, file: string): void {
  git(['reset', '-q'], dir, env);
  try {
    rmSync(join(dir, file), { force: true });
  } catch {
    /* 为何可静默：rmSync 已带 force:true（文件不存在不抛），此处只兜权限/占用类异常；
       而该产物已随上一行 `git reset -q` 退出暂存区，残留物由幕末 cleanupSandbox 的
       rmSync 连带清除，且 `!existsSync(sandboxDir)` 是硬断言（sandboxCleaned 进 allGreen）。
       任何一侧真失败都会被收尾那行看见 ⇒ 不产生假绿，故此处不另报一次。 */
  }
}

// ============================================================
// 幕④ · 快照回滚
// ============================================================

/** 幕④ 结果 */
interface RollbackOutcome {
  ok: boolean;
  /** 回滚前（被污染）的内容，用于对比展示 */
  before: string;
  /** 回滚后的内容 */
  after: string;
  /** 恢复的文件列表 */
  restored: string[];
  /** 回滚后的 git diff（工作区 vs HEAD——漏网提交造成的差异） */
  diff: string;
  /** 目标快照 SHA（含与不含头尾的完整值由 listAllSnapshots 给出） */
  snapshotSha: string;
}

/**
 * 幕④：拿幕③ 的「漏网」污染做素材——调用**真实 `snapshot_restore`**。
 *
 * 目标快照的定位方式：幕① 基线提交触发的那次审计在审计通过后自动建了
 * shadow 快照（engine/audit/src/index.ts:1567，PASS/拦截态都建）。本幕在
 * 幕③ 之前记录当时的**最新**快照 SHA，即「污染前」的状态指针。
 *
 * 恢复后 `git diff`（工作区 vs HEAD）可见：漏网提交带进仓库的
 * 客户个人信息被快照复原拉回基线——「拦截拦不住的，回滚兜得住」。
 */
function act4Rollback(sb: Sandbox, p: DemoPrinter, prePollutionSha: string | null): RollbackOutcome {
  const { dir, env } = sb;
  const target = join(dir, VIOLATION_SCOPE_FILE);
  const before = existsSync(target) ? readFileSync(target, 'utf-8') : '';

  if (prePollutionSha === null) {
    p.line('  ❌ 未取到污染前快照（幕① 基线审计未建快照）——回滚演示跳过');
    return { ok: false, before, after: before, restored: [], diff: '', snapshotSha: '' };
  }

  p.line(`  污染前快照 ${prePollutionSha}`);
  p.line(`  污染现场（${VIOLATION_SCOPE_FILE} 含 ${POLLUTION_MARKER}）：`);
  p.engineOutput(before);

  // 真实快照恢复（human_confirmed=true 是 snapshot_restore 的强制人审判定入口）
  const restored = restoreSnapshot(dir, prePollutionSha);
  const after = existsSync(target) ? readFileSync(target, 'utf-8') : '';
  const diff = git(['diff', '--', VIOLATION_SCOPE_FILE], dir, env).combined;

  p.line(`  已恢复 ${restored.length} 个文件：${restored.join(', ')}`);
  p.line('  复原后 diff（工作区 vs HEAD——漏网变更被拉回基线）：');
  p.engineOutput(diff);

  const ok = restored.includes(VIOLATION_SCOPE_FILE) && !after.includes(POLLUTION_MARKER) && diff.trim() !== '';
  p.line(`  幕④ 结论：${ok ? '✅ 快照复原前后 diff 可见，污染已回退' : '❌ 复原未生效或 diff 为空'}`);
  return { ok, before, after, restored, diff, snapshotSha: prePollutionSha };
}

// ============================================================
// 幕⑤ · 举证导出
// ============================================================

/**
 * 幕⑤：调用**真实 `--verify-chain`**（同一入口 cmd/verify.ts 的 runVerifyChain）
 * 校验沙箱审计史的 HMAC 链，并把五幕结果落成 demo-report.md。
 *
 * 沙箱密钥（幕 0 写入）使链条目带 hmacSig + hmacAlgo='stable'，
 * 校验走的是 HMAC-SHA256 复算路径，不是弱化的 SHA-256 退化档。
 */
function act5Evidence(sb: Sandbox, p: DemoPrinter, engineEntry: string): { ok: boolean; raw: string; records: number } {
  const { dir, env } = sb;
  const r = run(process.execPath, [engineEntry, '--verify-chain'], { cwd: dir, env });
  p.engineOutput(r.combined);

  const chainOk = r.status === 0 && r.combined.includes('HMAC hash chain 完整');

  // 真实记录条数（沙箱审计史——不读用户 ~/.sofagent）
  const historyFile = join(dir, '.sofagent', 'data', 'audit', 'history.jsonl');
  let records = 0;
  if (existsSync(historyFile)) {
    records = readFileSync(historyFile, 'utf-8').trim().split('\n').filter(Boolean).length;
  }
  p.line(`  HMAC 链验证：${chainOk ? '✅ 通过（退出码 0）' : '❌ 未通过'} · 沙箱审计史 ${records} 条记录`);
  return { ok: chainOk, raw: r.combined, records };
}

// ============================================================
// 报告生成（确定性：路径归一化 + 零时间戳）
// ============================================================

/**
 * 报告归一化：把两类**天然易变**的值替换为占位符——
 *   ① 沙箱绝对路径 → `<SANDBOX>`（mkdtemp 随机后缀，跨次必然不同）
 *   ② ISO-8601 时间戳 → `<TIMESTAMP>`（审计记录的写入时刻，跨次必然不同）
 *
 * 🔴 这不是「预录输出」：被归一化的只有这两类环境相关值，
 *    引擎的判定结论（规则号 / 违规文案 / exit 码 / diff 正文）**逐字保留**。
 *    归一化的目的是让「固定种子 ⇒ 跑一万次结果一致」成为**可机械校验**的
 *    字节级断言（CI 跑两次 diff 即验），而不是停留在口头承诺。
 */
function normalize(text: string, sandbox: string): string {
  const withoutPath = sandbox === '' ? text : text.split(sandbox).join(SANDBOX_PLACEHOLDER);
  return withoutPath.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<TIMESTAMP>');
}

/**
 * 生成 demo-report.md。
 * 🔴 确定性契约：不含时间戳、沙箱路径归一化为 <SANDBOX>——同一版本跑一万次，
 *    本文件字节一致（「跑一万次结果一致」的可验证落点）。
 */
export function buildReport(input: {
  version: string;
  speed: DemoSpeed;
  sandbox: string;
  verdicts: ViolationVerdict[];
  rollback: RollbackOutcome;
  chainOk: boolean;
  chainRaw: string;
  records: number;
  isolationOk: boolean;
  sandboxCleaned: boolean;
  sandboxRecords: number;
  sandboxShadow: boolean;
}): string {
  const n = (s: string): string => normalize(s, input.sandbox);
  const L: string[] = [];

  L.push('# sofagent demo · 五分钟戏剧弧实测报告');
  L.push('');
  L.push(`- 审计引擎版本：v${input.version}`);
  L.push(`- 演示档位：${input.speed === 'fast' ? 'fast（跳幕①②直入拦截）' : 'normal（五幕完整）'}`);
  L.push(`- 沙箱仓库：${SANDBOX_PLACEHOLDER}（/tmp 下临时目录，退出已清理）`);
  L.push('- 执行方式：真实 `git commit` → 真实 git hook → 真实审计引擎（零 mock 拦截、零预录输出）');
  L.push('- 归一化声明：沙箱绝对路径 → `<SANDBOX>`、ISO 时间戳 → `<TIMESTAMP>`（仅此两类环境相关值；');
  L.push('  规则号、违规文案、退出码、diff 正文均为引擎原始输出，逐字未改）。');
  L.push('  同一版本跑一万次，本文件字节一致——`固定种子` 的可机械校验落点。');
  L.push('');
  L.push('## 幕③ 三类违规实测判决');
  L.push('');
  L.push('| 违规 | 类型 | 目标文件 | 命中规则 | git commit 退出码 | 结果 |');
  L.push('|---|---|---|---|---|---|');
  for (const v of input.verdicts) {
    L.push(
      `| ${v.ruleId} | ${v.title} | \`${v.file}\` | ${v.hitRules.length > 0 ? v.hitRules.join(' ') : '(无)'} | ${v.hookExit} | ${
        v.rejected ? '**commit 被拒**' : 'commit 放行（引擎既有档位）'
      } |`,
    );
  }
  L.push('');
  L.push('> 引擎既有档位说明（如实呈现，非演示器判定）：critical 层（A1/A2）命中 FAIL ⇒ exit 2 ⇒');
  L.push('> hook 阻断 commit；warning 层的能力拐杖规则（A3）命中 WARN ⇒ exit 1 ⇒ hook 放行。');
  L.push('> 这条「漏网」由幕④ 快照回滚兜住。');
  L.push('');
  L.push('### 引擎原始输出（逐回合）');
  L.push('');
  for (const v of input.verdicts) {
    L.push(`#### ${v.ruleId} · ${v.title}`);
    L.push('');
    L.push('```');
    L.push(n(v.raw.trim()));
    L.push('```');
    L.push('');
  }
  L.push('## 幕④ 快照回滚');
  L.push('');
  L.push(`- 目标快照：\`${input.rollback.snapshotSha}\``);
  L.push(`- 恢复文件：${input.rollback.restored.length > 0 ? input.rollback.restored.join(', ') : '(无)'}`);
  L.push(`- 回滚前含污染标记 \`${POLLUTION_MARKER}\`：${input.rollback.before.includes(POLLUTION_MARKER) ? '是' : '否'}`);
  L.push(`- 回滚后含污染标记 \`${POLLUTION_MARKER}\`：${input.rollback.after.includes(POLLUTION_MARKER) ? '是' : '否'}`);
  L.push('');
  L.push('复原前后 diff（工作区 vs HEAD）：');
  L.push('');
  L.push('```diff');
  L.push(n(input.rollback.diff.trim()));
  L.push('```');
  L.push('');
  L.push('## 幕⑤ HMAC 链验证');
  L.push('');
  L.push(`- 结论：${input.chainOk ? '✅ HMAC hash chain 完整——所有记录可验证' : '❌ 未通过'}`);
  L.push(`- 沙箱审计史记录数：${input.records}`);
  L.push('');
  L.push('```');
  L.push(n(input.chainRaw.trim()));
  L.push('```');
  L.push('');
  L.push('## 沙箱隔离');
  L.push('');
  L.push('- 判定依据（**因果证明**，不受并发干扰）：本次运行的审计痕迹是否全部落在沙箱内');
  L.push(`  - 沙箱审计史记录数：${input.sandboxRecords}（≥3 = 引擎写入确实落在沙箱）`);
  L.push(`  - 沙箱快照 shadow repo：${input.sandboxShadow ? '在位' : '缺失'}`);
  L.push(`  - 结论：**${input.isolationOk ? '通过' : '失败'}**`);
  L.push('- 隔离手段：SOFAGENT_HOME / SOFAGENT_DATA / SOFAGENT_KEY_PATH 全部指向沙箱；');
  L.push('  SOFAGENT_HOME_ALLOWED_PREFIXES 仅放行本次沙箱根（不放行整个 /tmp）');
  L.push(`- 沙箱退出后已 rm -rf 并回读校验（${input.sandboxCleaned ? '通过：目录已不存在' : '失败：目录仍存在'}） → ${SANDBOX_PLACEHOLDER}`);
  L.push('- 注：真实目录的指纹观测不进本报告——它是全局共享状态，写入报告会让');
  L.push('  报告随「同期是否有别的审计在跑」而变，破坏「跑一万次结果一致」的可校验性。');
  L.push('');
  L.push('---');
  L.push('');
  L.push('— sofagent demo · 全程真实引擎，可复现（固定种子 / 固定提交时间 / 固定沙箱密钥）');
  L.push('');

  return L.join('\n');
}

// ============================================================
// 隔离探针
// ============================================================

/**
 * 真实用户目录指纹（用于**观测**真实目录是否被写入）。
 * 只读 stat，不读内容、不写任何东西。缺文件记 'absent'（新用户即此态）。
 *
 * ⚠️ 本探针只能作**观测**，不能作 demo 的判定依据：它对比的是全局状态，
 *    任何与本 demo 无关的进程（用户自己的审计 / daemon / 另一条 demo）
 *    在同一窗口写真实 history.jsonl 都会让指纹变化——拿它当开关会让
 *    「用户跑 demo 时恰好有别的审计在写」变成假的「隔离失败」。
 *    真正的判定用 `sandboxWriteEvidence()` 的**因果证明**（见下）。
 */
function realHomeFingerprint(): string {
  const home = resolveHomeDir();
  const targets = [join(home, 'data', 'audit', 'history.jsonl'), join(home, 'data', 'audit', 'history-chain-head'), join(homedir(), '.sofagent-key')];
  return targets
    .map((t) => {
      try {
        const st = statSync(t);
        return `${t}=${st.size}:${st.mtimeMs}`;
      } catch {
        return `${t}=absent`;
      }
    })
    .join('|');
}

/**
 * 沙箱隔离的**因果证明**——断言「引擎的写入真的落在沙箱内」。
 *
 * 为什么用因果证明而不是对比真实目录指纹：真实目录是全局共享状态，
 * 任何无关进程写入都会污染对比（假阳性），而本断言直接检查
 * 「这一次运行产生的审计痕迹在不在沙箱里」——若 SOFAGENT_HOME /
 * SOFAGENT_DATA 的重定向失效，这些痕迹会跑到用户目录，沙箱里必然为空。
 * 这恰好是隔离失效的唯一真实故障形态，且**完全不受并发影响**。
 *
 * @returns 证据充分时返回 true
 */
function sandboxWriteEvidence(dir: string): { ok: boolean; records: number; shadow: boolean } {
  const historyFile = join(dir, '.sofagent', 'data', 'audit', 'history.jsonl');
  let records = 0;
  if (existsSync(historyFile)) {
    records = readFileSync(historyFile, 'utf-8').trim().split('\n').filter(Boolean).length;
  }
  // 快照落在沙箱（shadow repo 是审计引擎在 PASS/拦截态自建的）
  const shadow = existsSync(join(dir, '.sofagent', '.git-shadow', 'snapshots.json'));
  // 幕 0/①/③ 至少产生 3 条审计记录（基线 + 三类违规各一次）
  return { ok: records >= 3 && shadow, records, shadow };
}

// ============================================================
// 沙箱清理
// ============================================================

/** 清沙箱并回读校验（「退出清理干净」的硬断言，不是「调了 rm 就算数」） */
function cleanupSandbox(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 为何可静默：紧接着的 `return !existsSync(dir)` 就是回读判定本身——rm 是否真成功
       不靠「没抛异常」推断，而由回读给出；调用方拿该返回值当 sandboxCleaned 参与 allGreen，
       失败在收尾行可见，故此处无需再报一次。 */
  }
  return !existsSync(dir);
}

// ============================================================
// 主流程
// ============================================================

/**
 * 跑完整五幕（含沙箱构建与清理）。
 *
 * @param opts.speed 速度档位
 * @param opts.outDir 产物目录（demo-report.md / demo-transcript.txt）
 * @param opts.templateDir hook 模板目录覆盖（测试注入用；缺省按 __dirname 推导）
 * @returns 运行结果（含逐幕结论与实测判决）
 */
export function runDemo(opts: { speed: DemoSpeed; outDir: string; templateDir?: string }): DemoRunResult {
  const p = new DemoPrinter();
  const acts: DemoActResult[] = [];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const version: string = require('../../package.json').version;

  p.line('');
  p.line('╔══════════════════════════════════════════════════════════════╗');
  p.line('║   sofagent demo · 五分钟戏剧弧                               ║');
  p.line('║   一条命令，亲眼看一次拦截发生                                ║');
  p.line('╚══════════════════════════════════════════════════════════════╝');
  p.line(`  审计引擎 v${version} · ${opts.speed === 'fast' ? 'fast 档' : '完整五幕'} · 全程真实引擎（零 mock）`);

  // 前置：引擎入口必须存在（fail-loud——静默回退会让「测的不是本仓代码」）
  const engineEntry = resolveEngineEntry();
  if (engineEntry === null) {
    p.line('');
    p.line('❌ 未找到完整引擎入口（dist/index.js）——demo 需要它来让 git hook 拉起真实审计。');
    p.line('   仓库内请先构建：npm run build --workspace=engine/audit');
    p.line('   或直接用 npm 分发形态：npx -y -p @sofagent/audit sofagent-audit demo');
    return {
      exitCode: 1,
      sandboxDir: '',
      sandboxCleaned: true,
      isolationOk: true,
      verdicts: [],
      chainOk: false,
      reportPath: '',
      transcriptPath: '',
      acts,
    };
  }

  const templateDir = opts.templateDir ?? resolveHooksTemplateDir();
  if (!existsSync(join(templateDir, 'commit-msg'))) {
    p.line('');
    p.line(`❌ 未找到 hook 模板目录（缺 commit-msg）：${templateDir}`);
    p.line('   仓库内请先构建：npm run build --workspace=engine/audit');
    return {
      exitCode: 1,
      sandboxDir: '',
      sandboxCleaned: true,
      isolationOk: true,
      verdicts: [],
      chainOk: false,
      reportPath: '',
      transcriptPath: '',
      acts,
    };
  }

  const isolationBefore = realHomeFingerprint();
  let sandboxDir = '';
  let sandboxCleaned = false;
  let verdicts: ViolationVerdict[] = [];
  let rollback: RollbackOutcome = { ok: false, before: '', after: '', restored: [], diff: '', snapshotSha: '' };
  let chainOk = false;
  let chainRaw = '';
  let records = 0;
  let actsOk = false;
  let evidence: { ok: boolean; records: number; shadow: boolean } = { ok: false, records: 0, shadow: false };

  // ── 五幕执行：任何一幕抛错都必须走 finally 清沙箱（异常路径同样零残留） ──
  try {
    // ── 幕 0 · 沙箱构建（五幕共同的底座） ──
    actHeader(p, '幕 0 · 沙箱构建（仅 /tmp，真实文件零接触）');
    const sb = buildSandbox(engineEntry, p, templateDir);
    sandboxDir = sb.dir;
    acts.push({ scope: '幕 0 · 沙箱构建', ok: true });

    // ── 幕① · 进场写规则 ──
    actHeader(p, '幕① · 进场写规则（生成 workflow.yml + 本体数据）');
    const act1 = act1SeedRepo(sb, p, opts.speed);
    acts.push({ scope: '幕① · 进场写规则', ok: act1.ok });

    // 幕③ 之前记下「污染前」快照指针（幕① 基线审计落地的干净快照）
    const snapshots = act1.ok ? listAllSnapshots(sb.dir) : [];
    const prePollutionSha = snapshots.length > 0 ? (snapshots[snapshots.length - 1] as { sha: string }).sha : null;

    // ── 幕② · 约束注入 ──
    actHeader(p, '幕② · 约束注入（加载链 system prompt 摘要）');
    let act2Ok = true;
    if (opts.speed === 'fast') {
      p.line('  ⏩ fast 档：跳过约束注入摘要（直入拦截）。');
    } else {
      act2Ok = act2InjectConstraints(sb, p);
    }
    acts.push({ scope: '幕② · 约束注入', ok: act2Ok });

    // ── 幕③ · 拦截（重头戏） ──
    actHeader(p, '幕③ · 拦截（重头戏——真实 commit 触发真实 hook）');
    verdicts = act3Intercept(sb, p);
    const act3Ok = verdicts.every((v) => v.hitRules.length > 0) && verdicts.some((v) => v.rejected);
    acts.push({ scope: '幕③ · 拦截', ok: act3Ok });

    // ── 幕④ · 快照回滚 ──
    actHeader(p, '幕④ · 快照回滚（拦截拦不住的，回滚兜得住）');
    rollback = act4Rollback(sb, p, prePollutionSha);
    acts.push({ scope: '幕④ · 快照回滚', ok: rollback.ok });

    // ── 幕⑤ · 举证导出 ──
    actHeader(p, '幕⑤ · 举证导出（HMAC 验链 + demo-report.md）');
    const act5 = act5Evidence(sb, p, engineEntry);
    chainOk = act5.ok;
    chainRaw = act5.raw;
    records = act5.records;
    acts.push({ scope: '幕⑤ · 举证导出', ok: act5.ok });

    actsOk = act1.ok && act2Ok && act3Ok && rollback.ok && act5.ok;

    // 隔离的因果证明：本次运行的审计痕迹必须全部落在沙箱内
    evidence = sandboxWriteEvidence(sb.dir);
  } catch (err) {
    // 幕内异常不吞：如实写进终端，交由 finally 清沙箱后以非零退出
    p.line('');
    p.line(`❌ demo 执行异常：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (sandboxDir !== '') {
      sandboxCleaned = cleanupSandbox(sandboxDir);
    }
  }

  // ── 隔离判定（因果证明）+ 真实目录观测 ──
  const isolationOk = evidence.ok;
  const realHomeUnchanged = realHomeFingerprint() === isolationBefore;
  actHeader(p, '收尾 · 沙箱隔离与清理');
  p.line(`  引擎写入全部落在沙箱内：${isolationOk ? '✅ 通过' : '❌ 失败'}（沙箱审计史 ${evidence.records} 条 · 沙箱快照 ${evidence.shadow ? '在位' : '缺失'}）`);
  p.line(`  沙箱已清理：${sandboxCleaned ? '✅ 通过（目录已不存在）' : '❌ 失败（目录仍存在）'}`);
  p.line(
    `  观测：真实 ~/.sofagent 指纹${realHomeUnchanged ? '未变' : '有变化'}` +
      '（仅供参考——其它进程同期写入真实审计史也会让指纹变化，非本 demo 判定依据）',
  );

  // ── 落盘产物（沙箱清理后再写，使报告中的隔离结论与清理结论为终值） ──
  const reportPath = join(opts.outDir, 'demo-report.md');
  const transcriptPath = join(opts.outDir, 'demo-transcript.txt');
  try {
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(
      reportPath,
      buildReport({
        version,
        speed: opts.speed,
        sandbox: sandboxDir,
        verdicts,
        rollback,
        chainOk,
        chainRaw,
        records,
        isolationOk,
        sandboxCleaned,
        sandboxRecords: evidence.records,
        sandboxShadow: evidence.shadow,
      }),
      'utf-8',
    );
  } catch (err) {
    p.line(`  ⚠️ 报告落盘失败：${err instanceof Error ? err.message : String(err)}`);
  }

  p.line('');
  p.line('─'.repeat(64));
  p.line(`  三类违规实测：${verdicts.map((v) => `${v.ruleId}=${v.hitRules.length > 0 ? '命中' : '未命中'}${v.rejected ? '(commit 被拒)' : '(WARN 放行)'}`).join(' · ') || '(未执行)'}`);
  p.line(`  幕④ 回滚：${rollback.ok ? '✅ diff 可见' : '❌'} · 幕⑤ 验链：${chainOk ? '✅ 通过' : '❌ 未通过'}`);
  const allGreen = actsOk && isolationOk && sandboxCleaned && chainOk;
  p.line(`  总判定：${allGreen ? '✅ 五幕全绿' : '❌ 有未达成项'}`);
  p.line('─'.repeat(64));
  p.line('');
  p.line(`  报告      ${reportPath}`);

  // 五幕原文落盘。**必须先落盘再打印路径**：反过来的话，上一秒刚把路径打给用户、
  // 下一秒写盘失败被吞掉 ⇒ 用户拿着一个不存在的文件路径，而 allGreen 不含写盘结果、
  // 演示照报「五幕全绿」——那是**撒谎**（不是「吞错」）。此处用布尔承接真实结果，
  // 失败时① stderr 打可见警告行 ② 路径行据实打印「（写入失败，未生成）」。
  // 写盘失败**不计入 exitCode**：终端五幕已完整输出，演示判定不该因产物副本变红。
  let transcriptWritten = true;
  try {
    writeFileSync(transcriptPath, `${p.transcript.join('\n')}\n`, 'utf-8');
  } catch (err) {
    transcriptWritten = false;
    console.error(
      `  ⚠️ 五幕原文落盘失败：${transcriptPath} —— ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  p.line(`  五幕原文  ${transcriptWritten ? transcriptPath : '（写入失败，未生成）'}`);

  return {
    exitCode: allGreen ? 0 : 1,
    sandboxDir,
    sandboxCleaned,
    isolationOk,
    verdicts,
    chainOk,
    reportPath,
    transcriptPath,
    acts,
  };
}

// ============================================================
// CLI 解析与入口
// ============================================================

/** 解析 demo 子命令参数（`--speed fast` 透传 + `--out`） */
export function parseDemoArgs(argv: string[]): DemoArgs {
  const rest = argv.slice(3); // argv[2] === 'demo'
  const speedIdx = rest.indexOf('--speed');
  const speed: DemoSpeed = speedIdx !== -1 && rest[speedIdx + 1] === 'fast' ? 'fast' : 'normal';
  const outIdx = rest.indexOf('--out');
  // 缺省产物目录落 **dataDir 下**（getDataDir：显式 > SOFAGENT_DATA > 默认数据目录）——
  // 不再默认写 `~/.sofagent/demo`：demo 自己宣称「沙箱隔离、真实文件零接触」，
  // 默认产物却落到用户家目录会与这句承诺观感冲突；`--out` 覆盖能力保留。
  const outDir = outIdx !== -1 && rest[outIdx + 1] ? (rest[outIdx + 1] as string) : join(getDataDir(), 'demo');
  const known = new Set(['--speed', 'fast', '--out', outDir, '--help', '-h']);
  const unknown = rest.filter((a) => !known.has(a));
  return { speed, outDir, help: rest.includes('--help') || rest.includes('-h'), unknown };
}

/** demo 子命令帮助文本 */
export function demoHelpText(): string {
  return [
    'sofagent-audit demo — 五分钟戏剧弧（一条命令，亲眼看一次拦截发生）',
    '',
    '用法：',
    '  npx -y -p @sofagent/audit sofagent-audit demo                 五幕完整版',
    '  npx -y -p @sofagent/audit sofagent-audit demo --speed fast    60 秒精简版（跳幕①②直入拦截）',
    '  npx -y -p @sofagent/audit sofagent-audit demo --out <dir>     指定产物目录（缺省 `<dataDir>/demo`，即 `$SOFAGENT_DATA/demo`）',
    '',
    '五幕：',
    '  幕 0  沙箱构建——只在 /tmp 建演示仓库，真实文件零接触',
    '  幕①   进场写规则——生成 workflow.yml + 本体数据，基线提交真过审计',
    '  幕②   约束注入——加载链 system prompt 摘要 + 身份指纹',
    '  幕③   拦截重头戏——真实 commit 触发真实 hook，三类违规实测',
    '  幕④   快照回滚——拦截拦不住的，回滚兜得住（复原前后 diff）',
    '  幕⑤   举证导出——HMAC 链验证 + demo-report.md 落盘',
    '',
    '产物：',
    '  <out>/demo-report.md       确定性实测报告（跨次运行一致）',
    '  <out>/demo-transcript.txt  五幕原始终端输出（可直接做 CI artifact）',
    '',
    '全程真实引擎：demo 不 mock 拦截、不预录输出——三类违规由真的 git hook',
    '拉起真的审计引擎判定，commit 被拒是引擎判定的结果，不是演示器的剧本。',
  ].join('\n');
}

/**
 * demo 子命令 CLI 入口（由 cli-quick.ts 的 `argv[2] === 'demo'` 分支调用）。
 *
 * @param argv process.argv
 * @returns 进程退出码（0 = 五幕全绿；1 = 有未达成项）
 */
export function runDemoCli(argv: string[]): number {
  const args = parseDemoArgs(argv);

  if (args.help) {
    console.log(demoHelpText());
    return 0;
  }
  if (args.unknown.length > 0) {
    console.error(`❌ demo 未知参数: ${args.unknown.join(' ')}`);
    console.error('   合法参数：--speed fast | --out <dir> | --help');
    return 2;
  }

  const result = runDemo({ speed: args.speed, outDir: args.outDir });
  return result.exitCode;
}
