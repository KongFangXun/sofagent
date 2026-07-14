#!/usr/bin/env node
// orchestrator CLI · v1.1.0

const args = process.argv.slice(2);
const subcommand = args[0];

async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-orchestrator — 多 Agent 协作 / 工作流调度 / prompt 模板');
    console.log('Usage: sofagent-orchestrator <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  compose --task <desc>        使用 DeepAgents 编排任务，输出 YAML 工作流');
    console.log('  subagent run <name> --task <desc>  启动 Sub Agent 执行任务');
    console.log('  compare                       编排方案 A/B 对比');
    process.exit(0);
  }

  switch (subcommand) {
    case 'compose': {
      const taskIdx = args.indexOf('--task');
      const taskDesc = taskIdx !== -1 ? args[taskIdx + 1] : undefined;
      if (!taskDesc) {
        console.error('❌ compose 需要 --task <描述> 参数');
        process.exit(1);
      }
      const { composeWithDeepAgents } = await import('./composer');
      const result = await composeWithDeepAgents(taskDesc);
      if (result) {
        console.log(result);
      } else {
        console.error('❌ 编排失败：deepagents 不可用或编排过程出错');
        process.exit(1);
      }
      break;
    }
    case 'subagent': {
      const action = args[1];
      if (action !== 'run') {
        console.error('❌ 未知子命令: subagent ' + (action || ''));
        console.error('   用法: sofagent-orchestrator subagent run <name> --task <desc>');
        process.exit(1);
      }
      const agentName = args[2];
      if (!agentName) {
        console.error('❌ subagent run 需要 <name> 参数');
        process.exit(1);
      }
      const taskIdx = args.indexOf('--task');
      const taskDesc = taskIdx !== -1 ? args[taskIdx + 1] : undefined;
      if (!taskDesc) {
        console.error('❌ subagent run 需要 --task <描述> 参数');
        process.exit(1);
      }
      const { listAgents } = await import('./registry');
      const { spawnSubAgent } = await import('./launcher');
      const dataDir = process.env.SOFAGENT_DATA_DIR || '.sofagent';
      const agents = listAgents(dataDir);
      const definition = agents.find((a) => a.name === agentName);
      if (!definition) {
        console.error(`❌ 未找到 Sub Agent: ${agentName}`);
        console.error('   可用 Agent:', agents.map((a) => a.name).join(', '));
        process.exit(1);
      }
      const output = await spawnSubAgent(definition, taskDesc);
      console.log(output);
      break;
    }
    case 'compare': {
      const { extractMetrics, generateReport, promoteWorkflow } = await import('./orchestrator-compare');

      const currentIdx = args.indexOf('--current');
      const candidateIdx = args.indexOf('--candidate');
      const promoteMode = args.includes('promote');

      if (promoteMode) {
        const candDir = candidateIdx !== -1 ? args[candidateIdx + 1] : undefined;
        if (!candDir) {
          console.error('❌ compare promote 需要 --candidate <dir>');
          process.exit(1);
        }
        promoteWorkflow(candDir);
        console.log('✅ 已晋升 candidate 为 current');
      } else {
        const currentDir = currentIdx !== -1 ? args[currentIdx + 1] : undefined;
        const candidateDir = candidateIdx !== -1 ? args[candidateIdx + 1] : undefined;
        if (!currentDir || !candidateDir) {
          console.error('❌ compare 需要 --current <dir> 和 --candidate <dir>');
          console.error('   用法: sofagent-orchestrator compare --current <dir> --candidate <dir>');
          console.error('          sofagent-orchestrator compare promote --candidate <dir>');
          process.exit(1);
        }
        const curr = extractMetrics(currentDir);
        const cand = extractMetrics(candidateDir);
        const date = new Date().toISOString().split('T')[0]!;
        console.log(generateReport(curr, cand, date));
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Usage: sofagent-orchestrator <compose|subagent|compare> [options]');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
