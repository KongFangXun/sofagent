#!/usr/bin/env node
// think CLI · v1.3.9

const args = process.argv.slice(2);
const subcommand = args[0];

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-think — 思考链分析 / 推理路径追踪 / 决策可视化 / 思维审计');
    console.log('Usage: sofagent-think <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  generate       基于 diff + 审计结果生成 think.md 条目');
    console.log('');
    console.log('Options:');
    console.log('  --diff <range>  git diff 范围（默认 HEAD~1..HEAD）');
    console.log('  --task <desc>   任务描述');
    process.exit(0);
  }

  switch (subcommand) {
    case 'generate': {
      const { generateThinkEntry } = await import('./think-generator');
      const { parseDiff, isInGitRepo } = await import('@sofagent/core');

      // 解析参数
      const diffIdx = args.indexOf('--diff');
      const taskIdx = args.indexOf('--task');

      const diffRange = (diffIdx !== -1 && args[diffIdx + 1])
        ? args[diffIdx + 1] as string
        : 'HEAD~1..HEAD';
      const taskDesc: string | undefined = (taskIdx !== -1 && args[taskIdx + 1])
        ? args[taskIdx + 1] as string
        : undefined;

      if (!isInGitRepo()) {
        console.error('❌ 当前目录不在 git 仓库内');
        process.exit(1);
      }

      console.log(`sofagent-think v${require('../../package.json').version} — 生成 think.md 条目`);
      try {
        const diffFiles = parseDiff(diffRange);
        if (diffFiles.length === 0) {
          console.log('没有文件变更，跳过生成。');
          process.exit(0);
        }

        // 构造基本审计结果（think-generator 需要 AuditResult）
        const auditResult = {
          exitCode: 0,
          rules: [],
        };

        generateThinkEntry(diffFiles, auditResult, taskDesc);
        console.log(`✅ 已生成 think.md 条目（基于 ${diffFiles.length} 个变更文件）`);
      } catch (err) {
        console.error(`❌ 生成失败: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-think generate');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
