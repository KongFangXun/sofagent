#!/usr/bin/env node
// skillopt CLI · v1.3.1

const args = process.argv.slice(2);
const subcommand = args[0];

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-skillopt — Skill 质量分析 / 优化建议 / 自动重构');
    console.log('Usage: sofagent-skillopt <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  run <path>     运行 Skill 优化（调用 skillopt-sleep CLI）');
    console.log('  check <path>   扫描 Skill 文件安全性');
    process.exit(0);
  }

  switch (subcommand) {
    case 'run': {
      const targetPath = args[1];
      if (!targetPath) {
        console.error('❌ run 需要 <path> 参数');
        console.error('   用法: sofagent-skillopt run <skill-file-path>');
        process.exit(1);
      }
      const { runSkillOpt, validateCandidate, isSkillOptAvailable } = await import('./skillopt-integration');

      if (!isSkillOptAvailable()) {
        console.error('❌ skillopt-sleep CLI 不可用。请确保已安装 skillopt-sleep。');
        process.exit(1);
      }

      console.log(`sofagent-skillopt v${require('../../package.json').version} — 运行 Skill 优化`);
      console.log(`  目标: ${targetPath}`);

      const result = runSkillOpt(targetPath);
      if (!result.success) {
        console.error(`❌ SkillOpt 运行失败: ${result.error}`);
        process.exit(1);
      }

      console.log(`✅ SkillOpt 完成`);
      if (result.candidatePath) {
        const validation = validateCandidate(result.candidatePath, targetPath);
        console.log(`  候选文件: ${result.candidatePath}`);
        console.log(`  可替换: ${validation.canReplace ? '✅ 是' : '❌ 否'}`);
        console.log(`  原因: ${validation.reason}`);
        if (validation.scoreDiff !== undefined) {
          console.log(`  分数差: ${validation.scoreDiff > 0 ? '+' : ''}${validation.scoreDiff}`);
        }
      }
      break;
    }
    case 'check': {
      const targetPath = args[1];
      if (!targetPath) {
        console.error('❌ check 需要 <path> 参数');
        console.error('   用法: sofagent-skillopt check <skill-file-or-dir>');
        process.exit(1);
      }
      const { scanSkillSafety } = await import('./skill-safety-check');

      const mode = args.includes('--json') ? 'json' : args.includes('--quiet') ? 'quiet' : 'terminal';
      console.log(`sofagent-skillopt v${require('../../package.json').version} — Skill 安全扫描`);
      console.log(`  目标: ${targetPath}`);
      console.log('');

      const result = scanSkillSafety(targetPath, { mode });

      // 退出码：0=SAFE, 1=DANGEROUS, 2=SUSPICIOUS
      if (result.verdict === 'DANGEROUS') {
        process.exit(1);
      } else if (result.verdict === 'SUSPICIOUS') {
        process.exit(2);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-skillopt <run|check>');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
