#!/usr/bin/env node
// core CLI · v1.5.2

// flag 别名路由（run-08 P0-1）：--doctor 是用户高频习惯写法（audit CLI 同名 flag
// 已路由到 runDoctor）——core 此前只认裸词子命令，手滑写 --doctor 会得到
// Unknown subcommand，验收场景 28 即因此 WARN（输出无 post-commit 字样，
// 被误判为 doctor 检测缺失，实则检测一直在）。flag → 子命令归一，两种写法都可用。
// v1.5.3 章四：同款把裸 --refresh 归一为 doctor refresh（写操作，兑现 audit CLI
// `index.ts` 的「--refresh 自动路由」承诺——core 侧亦不报未知参数）。
const rawArgs = process.argv.slice(2);
const isFlagRouter = rawArgs[0] === '--doctor' || rawArgs[0] === '--refresh';
const subcommand = isFlagRouter ? 'doctor' : rawArgs[0];
// 保留原 flag（不清 slice）——裸 `--refresh` 时 rawArgs.slice(1) 会把 flag 本身丢掉，
// 致 args=['doctor'] 不含 refresh ⇒ 误跑只读 doctor。
const args = isFlagRouter ? ['doctor', ...rawArgs] : rawArgs;

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-core — 核心运行时 / doctor / 配置解析 / 通用类型');
    console.log('Usage: sofagent-core <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  doctor        运行健康检查（环境 / 配置 / 数据目录 / Hook / 依赖）');
    console.log('  doctor --repair  自动修复可修复的问题（创建目录 / 安装依赖等）');
    console.log('  doctor --refresh 备份当前配置 → 重置默认 → 前后 diff 报告（写操作，留痕）');
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
      const { runDoctor, runDoctorWithRepair, runDoctorRefresh } = await import('./doctor');
      const projectDir = process.cwd();
      // v1.5.3 章四：--refresh 是**写操作**（覆写 config.yml）——与只读 doctor 分流，
      // 三段执行（备份 → 默认重置 → diff 报告）后以结果码退出。
      if (args.includes('--refresh')) {
        const result = runDoctorRefresh(projectDir);
        process.exit(result.ok ? 0 : 1);
      }
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
      console.error('Usage: sofagent-core <doctor|verify>   (flags: --doctor, --refresh)');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
