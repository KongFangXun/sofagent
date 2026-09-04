// ============================================================
// audit/cli/agent-shield.ts · AgentShield 五类配置面扫描 CLI（v1.4.4）
// ============================================================
//
// 用法：
//   sofagent-audit agent-shield [--json] [--no-process] [--fail-on warn]
//                               [--mcp <path>] [--hooks <dir>] [--repo <dir>]
//                               [--allow <name>]...
//
// 背景：AgentShield 五类扫描（MCP 配置风险 / Hook 注入 / Agent 配置越权 /
//   密钥增强 / 影子 AI）自 v1.3.7 起已实现且有测试，但长期零生产调用点，
//   而双语 README 把它当核心能力宣传——属「声称已交付但无入口」的盲区。
//   本 CLI 补上生产入口，让该能力可被用户直接调用、可被 CI 接入。
//
// 只读契约：本 CLI 全程只读扫描，不写任何文件、不改任何配置。
//
// 退出码（与 24 规则审计出口同语义）：
//   0 = 无发现（或仅 INFO）· 1 = 有 WARN（--fail-on warn 时）· 2 = 有 FAIL
// ============================================================

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createAgentShield, DEFAULT_KNOWN_AGENTS } from '../agent-shield';
import type { ShieldFinding, ShieldScanResult } from '../agent-shield';

/** agent-shield 子命令参数 */
export interface AgentShieldArgs {
  /** JSON 输出（CI 消费） */
  json: boolean;
  /** 关闭进程源扫描（CI 沙箱内 ps 不可靠时） */
  noProcess: boolean;
  /** 判定阈值：warn = 有 WARN 即 exit 1（默认）；fail = 仅 FAIL 才非零 */
  failOn: 'warn' | 'fail';
  /** 指定 MCP 配置文件（不指定走自动发现） */
  mcpConfig?: string;
  /** 指定 hook 目录（不指定走自动发现） */
  hooksDir?: string;
  /** 项目根目录（默认 process.cwd()） */
  repoDir: string;
  /** 追加的进程白名单（可重复传入） */
  allow: string[];
}

/** 五类类别的中文标签（人读输出用） */
const CATEGORY_LABEL: Record<ShieldFinding['category'], string> = {
  'mcp-risk': 'MCP 配置风险',
  'hook-injection': 'Hook 注入',
  'agent-config': 'Agent 配置越权',
  'secret-enhanced': '密钥泄露（配置面）',
  'shadow-ai': '影子 AI',
};

/** 类别展示顺序（与 agent-shield.ts 五类编号一致） */
const CATEGORY_ORDER: ShieldFinding['category'][] = [
  'mcp-risk',
  'hook-injection',
  'agent-config',
  'secret-enhanced',
  'shadow-ai',
];

/** 严重度图标（与审计出口同语义） */
function severityIcon(severity: ShieldFinding['severity']): string {
  return severity === 'FAIL' ? '❌' : severity === 'WARN' ? '⚠️' : 'ℹ️';
}

/**
 * MCP 配置自动发现：sofagent 自家约定 + 主流编辑器约定。
 * 只返回存在的文件——不存在不报错（未用该工具属正常）。
 */
export function discoverMcpConfigs(repoDir: string): string[] {
  const candidates = [
    join(homedir(), '.workbuddy', 'mcp.json'), // sofagent / WorkBuddy
    join(repoDir, '.mcp.json'), // Claude Code 仓库级
    join(repoDir, '.vscode', 'mcp.json'), // VS Code / Copilot
    join(repoDir, '.cursor', 'mcp.json'), // Cursor
  ];
  return candidates.filter(existsSync);
}

/**
 * Agent 约束配置自动发现：SKILL 体系 + 各平台用户级规则文件。
 */
export function discoverAgentConfigs(repoDir: string): string[] {
  const candidates = [
    join(repoDir, 'SKILL', 'SKILL.md'), // sofagent 规范资产唯一源
    join(repoDir, 'SKILL.md'), // Agent Skills 标准布局（仓库根单文件）
    join(repoDir, 'AGENTS.md'), // Codex 约定
    join(repoDir, 'CLAUDE.md'), // Claude Code 仓库级
    join(homedir(), '.claude', 'CLAUDE.md'), // Claude Code 用户级
    join(homedir(), '.codex', 'fde.md'), // Codex 工作规则
    // v1.4.5 T16: install.sh 实际部署路径补齐——此前只查复数 skills/ 目录，
    // install.sh:779 实际写 $SOFAGENT_HOME/skill/（单数）+ 平台 symlink
    // （.{platform}/skills/sofagent → 单数源目录）。旧候选表对默认安装
    // 完全扫不到 SKILL（agent-config 面对标准安装形同虚设）。
    join(homedir(), '.sofagent', 'skill', 'SKILL.md'), // install.sh 单数源（默认安装）
    join(homedir(), '.sofagent', 'skills', 'sofagent', 'SKILL.md'), // 兼容旧版复数目录
    join(homedir(), '.workbuddy', 'skills', 'sofagent', 'SKILL.md'), // workbuddy 平台 symlink
    join(homedir(), '.openclaw', 'skills', 'sofagent', 'SKILL.md'), // openclaw 平台 symlink
    join(homedir(), '.cursor', 'skills', 'sofagent', 'SKILL.md'), // cursor 平台 symlink
  ];
  return candidates.filter(existsSync);
}

/** 密钥扫描目标：MCP 配置（内联 env 凭证高发区）+ 仓库 .env */
export function discoverSecretTargets(repoDir: string, mcpConfigs: string[]): string[] {
  const targets = [...mcpConfigs];
  const envFile = join(repoDir, '.env');
  if (existsSync(envFile)) targets.push(envFile);
  return targets;
}

/** Hook 目录自动发现：git hooks（优先），退回空（scanHooks 自行判空） */
export function discoverHooksDir(repoDir: string): string | undefined {
  const gitHooks = join(repoDir, '.git', 'hooks');
  return existsSync(gitHooks) ? gitHooks : undefined;
}

/**
 * 运行 agent-shield CLI。
 *
 * @param args 命令参数
 * @returns 退出码 0 / 1 / 2
 */
export function runAgentShieldCli(args: AgentShieldArgs): number {
  const shield = createAgentShield({
    scanProcesses: !args.noProcess,
    knownAgentWhitelist: [...DEFAULT_KNOWN_AGENTS, ...args.allow],
  });

  const mcpConfigs = args.mcpConfig ? [args.mcpConfig] : discoverMcpConfigs(args.repoDir);
  const hooksDir = args.hooksDir ?? discoverHooksDir(args.repoDir);
  const agentConfigs = discoverAgentConfigs(args.repoDir);
  const secretTargets = discoverSecretTargets(args.repoDir, mcpConfigs);

  // 每个 MCP 配置单独扫（target 需精确到文件），再合并
  const result: ShieldScanResult = shield.scanAll({
    hooksDir,
    agentConfigs,
    secretTargets,
    repoDir: args.repoDir,
  });
  for (const c of mcpConfigs) result.findings.push(...shield.scanMcpConfig(c));

  if (args.json) {
    console.log(JSON.stringify({
      command: 'agent-shield',
      repoDir: args.repoDir,
      scanned: {
        mcpConfigs,
        hooksDir: hooksDir ?? null,
        agentConfigs,
        secretTargets,
        processes: !args.noProcess,
      },
      findings: result.findings,
      stats: result.stats,
      exitCode: computeExitCode(result, args.failOn),
    }, null, 2));
  } else {
    printHumanReadable(result, args, hooksDir, mcpConfigs, agentConfigs, secretTargets);
  }

  return computeExitCode(result, args.failOn);
}

/** 按阈值计算退出码：FAIL 恒 2，WARN 视 failOn */
export function computeExitCode(result: ShieldScanResult, failOn: 'warn' | 'fail'): number {
  const hasFail = result.findings.some((f) => f.severity === 'FAIL');
  if (hasFail) return 2;
  const hasWarn = result.findings.some((f) => f.severity === 'WARN');
  if (hasWarn && failOn === 'warn') return 1;
  return 0;
}

/** 人读输出：按类别分组 + 统计 + 修复提示 */
function printHumanReadable(
  result: ShieldScanResult,
  args: AgentShieldArgs,
  hooksDir: string | undefined,
  mcpConfigs: string[],
  agentConfigs: string[],
  secretTargets: string[],
): void {
  const { findings } = result;
  const failCount = findings.filter((f) => f.severity === 'FAIL').length;
  const warnCount = findings.filter((f) => f.severity === 'WARN').length;
  const infoCount = findings.filter((f) => f.severity === 'INFO').length;

  console.log('\n🛡️  AgentShield 五类配置面扫描');
  console.log(`   项目根目录：${args.repoDir}`);
  console.log(`   扫描面：MCP ${mcpConfigs.length} · Hook ${hooksDir ? 1 : 0} · Agent 配置 ${agentConfigs.length} · 密钥目标 ${secretTargets.length} · 进程源 ${args.noProcess ? '关' : '开'}`);

  if (findings.length === 0) {
    console.log('\n✅ 五类配置面全部干净——未发现注入/越权/泄露/影子 agent 痕迹');
    return;
  }

  for (const category of CATEGORY_ORDER) {
    const group = findings.filter((f) => f.category === category);
    if (group.length === 0) continue;
    console.log(`\n${severityIcon('INFO')} ${CATEGORY_LABEL[category]}（${group.length}）`);
    for (const f of group) {
      console.log(`   ${severityIcon(f.severity)} [${f.severity}] ${f.target}`);
      console.log(`      ${f.message}`);
      console.log(`      证据：${f.evidence}`);
    }
  }

  console.log(`\n📊 汇总：FAIL ${failCount} · WARN ${warnCount} · INFO ${infoCount}`);
  if (failCount > 0) {
    console.log('\n   处置建议：FAIL 项须先修再提交——配置文件本身是可被注入的攻击面。');
    console.log('   Hook 注入 / 指令覆盖注入应视为供应链事件，排查配置来源后恢复。');
  } else if (warnCount > 0) {
    console.log('\n   处置建议：WARN 项不阻断（如远程 MCP 端点、白名单外 AI 进程），按需确认后加入 --allow。');
  }
}

/** agent-shield 子命令用法（--help 输出） */
export const AGENT_SHIELD_HELP = `
用法: sofagent-audit agent-shield [选项]

  AgentShield 五类配置面扫描——Agent 的配置文件/工具定义/MCP 端点本身可被注入
  恶意指令，是独立于代码变更（git diff）的攻击面。全程只读，不写任何文件。

  五类扫描:
    MCP 配置风险     server 权限范围 + 数据出网路径（curl|sh / 命令替换 / 远程端点）
    Hook 注入        git hook / session hook 含恶意代码
    Agent 配置越权    SKILL.md / fde.md 含越权指令或 prompt 注入
    密钥泄露（配置面） A2 扩展——扫配置文件，不只 git diff
    影子 AI          扫进程/配置/仓库发现未注册 agent

选项:
  --json              JSON 输出（CI 消费）
  --no-process        关闭进程源扫描（CI 沙箱内 ps 不可靠时）
  --fail-on <w>       判定阈值：warn（默认，有 WARN 即 exit 1）/ fail（仅 FAIL 非零）
  --mcp <path>        指定 MCP 配置文件（不指定走自动发现）
  --hooks <dir>       指定 hook 目录（不指定走自动发现）
  --repo <dir>        项目根目录（默认当前目录）
  --allow <name>      追加进程白名单（可重复传入）
  --help              显示本帮助

退出码: 0=干净 · 1=有 WARN（--fail-on warn）· 2=有 FAIL
`.trim();

/**
 * 参数解析：从 argv 数组中提取 agent-shield 参数。
 * 只识别 agent-shield 自有的 flag——全局 flag（--json 等）由上层级解析。
 */
export function parseAgentShieldArgs(argv: string[]): AgentShieldArgs {
  // 顶层 parser 遇到子命令即 break，--help 不会走到上层——此处自行处理
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(AGENT_SHIELD_HELP);
    process.exit(0);
  }

  const args: AgentShieldArgs = {
    json: false,
    noProcess: false,
    failOn: 'warn',
    repoDir: process.cwd(),
    allow: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--no-process') {
      args.noProcess = true;
    } else if (arg === '--fail-on' && argv[i + 1]) {
      i++;
      const v = argv[i];
      // 非法值退回默认 warn——不阻断（配置面扫描是提示性能力）
      if (v === 'warn' || v === 'fail') args.failOn = v;
    } else if (arg === '--mcp' && argv[i + 1]) {
      i++;
      args.mcpConfig = argv[i]!;
    } else if (arg === '--hooks' && argv[i + 1]) {
      i++;
      args.hooksDir = argv[i]!;
    } else if (arg === '--repo' && argv[i + 1]) {
      i++;
      args.repoDir = argv[i]!;
    } else if (arg === '--allow' && argv[i + 1]) {
      i++;
      args.allow.push(argv[i]!);
    }
  }

  return args;
}
