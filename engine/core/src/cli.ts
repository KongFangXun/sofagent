#!/usr/bin/env node
// core CLI · v1.4.1

const args = process.argv.slice(2);
const subcommand = args[0];

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-core — 核心运行时 / doctor / 配置解析 / 通用类型');
    console.log('Usage: sofagent-core <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  doctor        运行健康检查（环境 / 配置 / 数据目录 / Hook / 依赖）');
    console.log('  doctor --repair  自动修复可修复的问题（创建目录 / 安装依赖等）');
    console.log('  verify        装后验证（9 个检查类别）');
    console.log('');
    console.log('Verify options:');
    console.log('  --json        JSON 机器可读输出');
    console.log('  --quiet       只输出失败和警告');
    console.log('  --quick       快速模式——仅 4 项核心检查');
    console.log('  --platform X  手动指定平台（workbuddy/openclaw/claude/codex/hermes）');
    process.exit(0);
  }

  switch (subcommand) {
    case 'doctor': {
      const { runDoctor, runDoctorWithRepair } = await import('./doctor');
      const projectDir = process.cwd();
      const isRepair = args.includes('--repair');
      const report = isRepair
        ? runDoctorWithRepair(projectDir, true)
        : runDoctor(projectDir);
      process.exit(report.allOk ? 0 : 1);
    }
    case 'verify': {
      // 重新解析 verify 的默认参数（跳过 'verify' 子命令名）
      const verifyArgs = process.argv.slice(3);
      const { runQuickChecks, runWorkBuddyChecks, runAllChecks } = await import('./verify/checks');
      const { Verifier } = await import('./verify/verifier');
      const { HOME, resolveSofagentData } = await import('./verify/utils');

      const isJson = verifyArgs.includes('--json');
      const isQuiet = verifyArgs.includes('--quiet');
      const isQuick = verifyArgs.includes('--quick');

      const platformIdx = verifyArgs.indexOf('--platform');
      const platform: string = (platformIdx !== -1 && verifyArgs[platformIdx + 1])
        ? verifyArgs[platformIdx + 1] as string
        : 'workbuddy';

      const dataDir = resolveSofagentData(platform);
      const v = new Verifier(isJson, isQuiet);

      if (!isQuiet) {
        v.printBanner();
        v.printPlatformInfo(platform, dataDir);
      }

      const verifyArgsObj = { json: isJson, quiet: isQuiet, quick: isQuick, platform };

      if (isQuick) {
        runQuickChecks(v, verifyArgsObj, HOME, dataDir);
      } else {
        runAllChecks(v, verifyArgsObj, platform, dataDir, HOME, dataDir);
      }

      const result = v.getResult();

      if (isJson) {
        v.outputJson();
      } else {
        v.outputSummary();
      }

      process.exit(result.fail > 0 ? 1 : 0);
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-core <doctor|verify>');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
