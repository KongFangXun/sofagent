#!/usr/bin/env node
// ============================================================
// sofagent-verify · 装后验证脚本（TypeScript 版）——入口文件
// v1.1.9 从 sofagent/audit/src/verify.ts 迁出
// ============================================================
// 验证 sofagent 安装完整性（9 个检查类别，~48 项动态）。
// 由 verify.sh (942 行 bash) + windows/verify.ps1 合并而来，
// 注册为 npm 包 bin。最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块。
//
// 用法：
//   sofagent-verify              彩色终端输出，显示所有检查项
//   sofagent-verify --json       JSON 机器可读输出（CI/CD 用）
//   sofagent-verify --quiet      只输出失败和警告，全通过时静默
//   sofagent-verify --quick      快速模式——仅 4 项核心检查
//   sofagent-verify --platform X 手动指定平台（openclaw/workbuddy/claude/codex/hermes）
//   sofagent-verify --help       显示此帮助
//
// 退出码：
//   0 = 全部通过
//   1 = 存在失败项
// ============================================================

import { existsSync } from 'fs';
import { join } from 'path';
import { VERSION } from './shared/constants.js';
import type { Args } from './verify/types.js';
import { HOME, resolveSofagentData } from './verify/utils.js';
import { Verifier } from './verify/verifier.js';
import { runQuickChecks, runWorkBuddyChecks, runAllChecks } from './verify/checks.js';

// ── 参数解析 ──
function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, quiet: false, quick: false, platform: '' };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) { i++; continue; }
    if (arg === '--json') {
      args.json = true;
      i++;
    } else if (arg === '--quiet') {
      args.quiet = true;
      i++;
    } else if (arg === '--quick') {
      args.quick = true;
      i++;
    } else if (arg === '--platform') {
      const next = argv[i + 1];
      if (next !== undefined) {
        args.platform = next.toLowerCase();
        i += 2;
      } else {
        i++;
      }
    } else if (arg.startsWith('--platform=')) {
      args.platform = arg.slice('--platform='.length).toLowerCase();
      i++;
    } else if (arg === '--help') {
      console.log(`sofagent-verify v${VERSION} · 安装完整性验证`);
      console.log('  正常模式  彩色终端，显示所有检查项');
      console.log('  --json    JSON 机器可读输出（CI/CD 用）');
      console.log('  --quiet   只输出失败和警告，全通过时静默');
      console.log('  --quick   快速模式——仅 4 项核心检查（SKILL.md / .sofagent/ / sofagent-audit compose / fde.md）');
      console.log('  --platform <name>  手动指定平台（openclaw/workbuddy/claude/codex/hermes）');
      console.log('  --help    显示此帮助');
      console.log('退出码: 0=全部通过 1=存在失败项');
      process.exit(0);
    } else {
      // 未知参数静默忽略
      i++;
    }
  }
  return args;
}

// ════════════════════════════════════════
// 主函数
// ════════════════════════════════════════
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const v = new Verifier(args.json, args.quiet);

  // ── 平台探测 ──
  let platform = args.platform;
  if (!platform) {
    if (existsSync(join(HOME, '.openclaw'))) platform = 'openclaw';
    else if (existsSync(join(HOME, '.workbuddy'))) platform = 'workbuddy';
    else if (existsSync(join(HOME, '.claude'))) platform = 'claude';
    else if (existsSync(join(HOME, '.codex'))) platform = 'codex';
    else if (existsSync(join(HOME, '.hermes'))) platform = 'hermes';
    else platform = 'openclaw'; // 默认回退
  }

  // ── 按平台确定目标路径 ──
  let target = '';
  switch (platform) {
    case 'openclaw':
      target = process.env.OPENCLAW_STATE_DIR || join(HOME, '.openclaw');
      break;
    case 'workbuddy':
      target = ''; // 工作区数据目录，不做系统级检查
      break;
    case 'claude':
      target = join(HOME, '.claude');
      break;
    case 'codex':
      target = join(HOME, '.codex');
      break;
    case 'hermes':
      target = join(HOME, '.hermes');
      break;
    default:
      target = process.env.OPENCLAW_STATE_DIR || join(HOME, '.openclaw');
      platform = 'openclaw';
      break;
  }

  const openclawDir = target || join(HOME, '.openclaw');
  const sofagentData = resolveSofagentData(openclawDir);

  // ── banner + 平台信息 ──
  v.printBanner();
  v.printPlatformInfo(platform, target || '工作区');

  // ════════════════════════════════════════
  // --quick 模式：仅 4 项核心检查
  // ════════════════════════════════════════
  if (args.quick) {
    if (!args.json && !args.quiet) console.log('  ⚡ 快速模式 — 4 项核心检查');
    v.hr();

    runQuickChecks(v, args, openclawDir, sofagentData);

    // 输出总结并退出
    if (args.json) {
      v.outputJson();
    } else {
      v.outputSummary();
      if (v.failTotal === 0) {
        console.log('  ✅ quick 模式通过！运行 sofagent-verify（无 --quick）获取完整检查。');
      } else {
        console.log(`  ❌ sofagent 验证：${v.failTotal} 项未通过。请运行 install.sh 修复后重试。`);
      }
      console.log('');
    }
    process.exit(v.failTotal > 0 ? 1 : 0);
  }

  // ════════════════════════════════════════
  // WorkBuddy 平台专属检查（5 项后直接退出）
  // ════════════════════════════════════════
  if (platform === 'workbuddy') {
    runWorkBuddyChecks(v, openclawDir, sofagentData);

    // 输出总结并退出
    if (args.json) {
      v.outputJson();
    } else {
      v.outputSummary();
      if (v.failTotal === 0) {
        console.log('  ✅ sofagent WorkBuddy 部署验证通过！');
        console.log('');
        console.log('  下一步:');
        console.log('    1. 确认 sofagent Skill 已加载（下次对话应出现初始化提示）');
        console.log('    2. 试用 /goal 命令开始第一个任务');
      } else {
        console.log(`  ❌ sofagent 验证：${v.failTotal} 项未通过。请运行 install.sh 修复后重试。`);
      }
      console.log('');
    }
    process.exit(v.failTotal > 0 ? 1 : 0);
  }

  // ════════════════════════════════════════
  // 全量检查 §1-§11
  // ════════════════════════════════════════
  runAllChecks(v, args, platform, target, openclawDir, sofagentData);

  // ════════════════════════════════════════
  // 总结
  // ════════════════════════════════════════
  if (args.json) {
    v.outputJson();
  } else {
    v.outputSummary();

    if (v.failTotal === 0) {
      if (!args.quiet) {
        console.log('  ✅ sofagent 安装验证通过！');
        console.log('');
        switch (platform) {
          case 'openclaw':
            console.log('  下一步:');
            console.log('    1. 注册 before_prompt_build Hook（见 install.sh 输出）');
            console.log('    2. 启动 OpenClaw，检查 system prompt 是否包含 sofagent 底线规则');
            console.log('    3. 运行 sofagent-audit compose 测试编排是否正常');
            break;
          case 'workbuddy':
            console.log('  下一步:');
            console.log('    1. 确认 sofagent Skill 已加载（下次对话应出现初始化提示）');
            console.log('    2. 试用 /goal 命令开始第一个任务');
            break;
          case 'claude':
          case 'codex':
          case 'hermes':
            console.log('  下一步:');
            console.log('    1. 将种子指令粘贴到配置文件（见 install.sh 输出）');
            console.log('    2. 在下一轮对话中回复「sofagent」验证加载');
            break;
        }
        console.log('');
        console.log('  📊 约束底座占用：~3,000 token（128K 窗口的 2.5%）');
        console.log('');
      } else if (v.passTotal > 0) {
        console.log(`  ✅ ${v.passTotal} 项全部通过`);
        console.log('');
      }
    } else {
      console.log(`  ❌ 发现 ${v.failTotal} 项失败。请先运行 install.sh 修复。`);
      console.log('');
    }
  }

  process.exit(v.failTotal > 0 ? 1 : 0);
}

main();
