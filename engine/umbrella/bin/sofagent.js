#!/usr/bin/env node
// ============================================================
// bin/sofagent.js · npm 裸名总包（umbrella）CLI 入口 · 单入口域路由
//
// v1.5.6 章一：13 个 bin → `sofagent <域> <动作>` 单入口。
//   本文件从「单一转发（→ audit cli-quick）」升级为「域路由分发」：
//   按域解析到既有实现包的 CLI 入口，spawn 转发，行为与旧命令逐条一致。
//   域 → 子命令全映射表见 docs/changelog/v1.5/v1.5.6.md 章一附录。
//
// 设计约束（保持 umbrella 的零编译期耦合）：
//   - 用 spawn 转发而非静态 import：总包与实现包之间零依赖声明，
//     实现包可独立升级/替换，总包永不失配。
//   - 路径解析：require.resolve('@sofagent/<pkg>') 得 main 入口（在 dist/ 内），
//     同目录推出目标 CLI 文件（cli.js / cli-quick.js / mcp-server.js …）。
//     workspace 态与独立安装态路径推导一致（node_modules/@sofagent/<pkg>/dist/）。
//   - 保留字（status/where/version/dashboard/web/data/help）是**产品级面**，
//     不属任何业务域，由本路由直接作答（dashboard/web/data 转安装态 wrapper）。
//
// 环境变量：
//   SOFAGENT_SINGLE_ENTRY=1 —— 由本路由注入子进程，告知旧命令入口
//   「你是被单入口路由调用的」，旧命令据此**抑制弃用提示**（实现入口路径）；
//   用户直接敲旧命令时无此变量 → 打印弃用提示（shim 入口路径）。
// ============================================================

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);

// ── 域 → 实现包映射（唯一 SSOT：改域在此处改，不在别处再写一份）──
// file = 目标 CLI 文件（相对该包 dist/ 目录）
const DOMAINS = {
  audit: { pkg: '@sofagent/audit', file: 'cli-quick.js', fullFile: 'index.js' },
  core: { pkg: '@sofagent/core', file: 'cli.js' },
  daemon: { pkg: '@sofagent/daemon', file: 'cli.js' },
  device: { pkg: '@sofagent/daemon', file: 'cli.js', note: '设备面 · create-usb-key 等' },
  train: { pkg: '@sofagent/orchestrator', file: 'cli.js', note: '训练子命令（train …）' },
  ontology: { pkg: '@sofagent/ontology', file: 'cli.js' },
  evolve: { pkg: '@sofagent/evolve', file: 'cli.js' },
  eval: { pkg: '@sofagent/eval', file: 'cli.js' },
  think: { pkg: '@sofagent/think', file: 'cli.js' },
  'ab-test': { pkg: '@sofagent/ab-test', file: 'cli.js' },
  workflow: { pkg: '@sofagent/orchestrator', file: 'cli.js', note: 'compose / loop / activate / run-enterprise' },
  team: { pkg: '@sofagent/orchestrator', file: 'cli.js', note: 'subagent / vote / formation / plugin-probe' },
  orchestrator: { pkg: '@sofagent/orchestrator', file: 'cli.js', note: '编排域全量（catch-all）' },
  compare: { pkg: '@sofagent/orchestrator', file: 'orchestrator-compare.js' },
  mcp: { pkg: '@sofagent/mcp', file: 'mcp-server.js' },
};

// ── 保留字（产品级面 · 安装态/入口态询问，不属业务域）──
const RESERVED = new Set(['status', 'where', 'version', 'dashboard', 'web', 'data', 'help']);

const AGENT_HOME = process.env.SOFAGENT_HOME || join(homedir(), '.sofagent');

function readVersion() {
  // npm 裸名入口报**包版本**（随包分发的真值）；安装态 VERSION 仅作兜底
  try {
    const pkgJson = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const v = JSON.parse(readFileSync(pkgJson, 'utf8')).version;
    if (v) return v;
  } catch {
    /* 落到安装态兜底 */
  }
  try {
    return readFileSync(join(AGENT_HOME, 'VERSION'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

function domainList() {
  return Object.entries(DOMAINS)
    .map(([name, d]) => `  sofagent ${name.padEnd(13)} → ${d.pkg}${d.note ? '（' + d.note + '）' : ''}`)
    .join('\n');
}

function printHelp() {
  console.log(`sofagent ${readVersion()} · 单入口 CLI（<域> <动作>）`);
  console.log('');
  console.log('用法 / Usage:  sofagent <域> <动作> [参数…]');
  console.log('               sofagent <保留字>');
  console.log('');
  console.log('业务域 / Domains:');
  console.log(domainList());
  console.log('');
  console.log('保留字 / Reserved（产品级面）:');
  console.log('  status     版本 + daemon 状态 + 数据位置');
  console.log('  where      所有安装路径');
  console.log('  version    仅版本号');
  console.log('  dashboard  打开终端 Dashboard');
  console.log('  web        打开 Web Dashboard');
  console.log('  data       打开数据目录');
  console.log('  help       本帮助');
  console.log('');
  console.log('示例 / Examples:');
  console.log('  sofagent audit                              审计最近一次 commit（零配置）');
  console.log('  sofagent audit --full --diff HEAD~1..HEAD   完整引擎审计');
  console.log('  sofagent team formation --list              列出六种内置阵型');
  console.log('  sofagent train doctor --gpu                 训练环境体检');
  console.log('');
  console.log('旧命令（sofagent-audit / sofagent-daemon / …）进入兼容期：仍可用，会提示新入口。');
}

// dashboard / web / data 依赖安装态资产——转交安装态 wrapper（~/.sofagent/bin/sofagent）
function delegateToInstallWrapper(cmd, rest) {
  const wrapper = join(AGENT_HOME, 'bin', 'sofagent');
  if (existsSync(wrapper)) {
    const r = spawnSync(wrapper, [cmd, ...rest], {
      stdio: 'inherit',
      env: { ...process.env, SOFAGENT_FROM_ROUTER: '1' },
    });
    return r.status === null ? 130 : r.status;
  }
  console.error(`[sofagent] 「${cmd}」需要 install.sh 安装态资产（未检测到 ${wrapper}）。`);
  console.error('[sofagent] 请先安装：bash install.sh  或  bash bootstrap.sh');
  return 1;
}

function handleReserved(cmd, rest) {
  switch (cmd) {
    case 'version':
      console.log(readVersion());
      return 0;
    case 'status': {
      console.log(`sofagent ${readVersion()}`);
      const daemonJson = join(AGENT_HOME, 'data', 'daemon.json');
      if (existsSync(daemonJson)) {
        try {
          const d = JSON.parse(readFileSync(daemonJson, 'utf8'));
          console.log(`daemon: ${d.mode || d.status || 'unknown'}`);
        } catch {
          console.log('daemon: unknown（daemon.json 不可解析）');
        }
      } else {
        console.log('daemon: not initialized');
      }
      console.log(`data: ${join(AGENT_HOME, 'data')}/`);
      console.log('note: 安装态信息；仓库审计用 sofagent audit');
      return 0;
    }
    case 'where':
      console.log(`Install:  ${AGENT_HOME}`);
      console.log(`Data:     ${join(AGENT_HOME, 'data')}/`);
      console.log(`Skill:    ${join(AGENT_HOME, 'skill')}/`);
      console.log(`Internal: ${join(AGENT_HOME, 'internal')}/`);
      return 0;
    case 'dashboard':
    case 'web':
    case 'data':
      return delegateToInstallWrapper(cmd, rest);
    case 'help':
    default:
      printHelp();
      return 0;
  }
}

// ── 域路由 ──
function resolveDomainCli(domain, rest) {
  const spec = DOMAINS[domain];
  const entry = require.resolve(spec.pkg); // main 入口（在 dist/ 内）
  const distDir = dirname(entry);
  // audit 域：--full 走完整引擎（audit 第二 bin），参数面其余原样
  if (domain === 'audit' && spec.fullFile) {
    const idx = rest.indexOf('--full');
    if (idx !== -1) {
      const cliPath = join(distDir, spec.fullFile);
      if (!existsSync(cliPath)) throw new Error(`完整引擎入口缺失：${cliPath}（请先 npm run build）`);
      return { cliPath, args: [...rest.slice(0, idx), ...rest.slice(idx + 1)] };
    }
  }
  const cliPath = join(distDir, spec.file);
  if (!existsSync(cliPath)) throw new Error(`域实现入口缺失：${cliPath}（请先 npm run build）`);
  return { cliPath, args: rest };
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    // audit-first 保留：裸 `sofagent` 仍直通审计（旧行为不破——v1.5.6 前的默认入口）
    const target0 = resolveDomainCli('audit', []);
    const r0 = spawnSync(process.execPath, [target0.cliPath], {
      stdio: 'inherit',
      env: { ...process.env, SOFAGENT_SINGLE_ENTRY: '1' },
    });
    return r0.status === null ? 130 : r0.status;
  }
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return 0;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(readVersion());
    return 0;
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  if (RESERVED.has(cmd)) return handleReserved(cmd, rest);

  if (!Object.prototype.hasOwnProperty.call(DOMAINS, cmd)) {
    console.error(`[sofagent] 未知域：${cmd}`);
    console.error('');
    console.error('业务域：');
    console.error(domainList());
    console.error('');
    console.error('保留字：status · where · version · dashboard · web · data · help');
    console.error('');
    console.error('提示：旧命令（sofagent-audit / sofagent-daemon / …）在兼容期内仍可用。');
    return 2;
  }

  let target;
  try {
    target = resolveDomainCli(cmd, rest);
  } catch (err) {
    console.error(`[sofagent] 无法定位域「${cmd}」的实现入口：${err && err.message ? err.message : err}`);
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const inRepo = existsSync(join(repoRoot, 'engine', 'audit', 'package.json'));
    console.error(inRepo
      ? '[sofagent] 检测到在仓库内运行且实现包尚未构建——请先在仓库根执行：npm install && npm run build'
      : '[sofagent] 请尝试重新安装：npm i -g sofagent');
    return 127;
  }

  const result = spawnSync(process.execPath, [target.cliPath, ...target.args], {
    stdio: 'inherit',
    env: { ...process.env, SOFAGENT_SINGLE_ENTRY: '1' },
  });
  if (result.error) {
    console.error(`[sofagent] 启动域「${cmd}」失败：${result.error.message}`);
    return 127;
  }
  return result.status === null ? 130 : result.status;
}

process.exit(main());
