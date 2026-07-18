#!/usr/bin/env node
// orchestrator CLI · v1.1.4
//
// loop 子命令 v1.1.4 升级：默认走 LangGraph StateGraph 节点级流转
// （engineer→audit→reviewer→human_confirm），支持 --resume 从 checkpoint
// 恢复。旧版 DeepAgents 串行路径通过 --legacy 保留兼容。

const args = process.argv.slice(2);
const subcommand = args[0];
async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-orchestrator — 多 Agent 协作 / 工作流调度 / prompt 模板');
    console.log('Usage: sofagent-orchestrator <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  compose --task <desc>            使用 DeepAgents 编排任务，输出 YAML 工作流');
    console.log('  subagent run <name> --task <desc> 启动 Sub Agent 执行任务（engineer / reviewer 等）');
    console.log('  loop --task <desc>               LOOP StateGraph 自动流转');
    console.log('       engineer (AI) → audit (CLI) → reviewer (AI) → human_confirm (HITL)');
    console.log('       --resume                     从最近 checkpoint 恢复续跑');
    console.log('       --legacy                     使用旧版 DeepAgents 串行（v1.1.3 兼容）');
    console.log('  loop --workflow <path>            Workflow 模式：消费外部编排平台 YAML（需 LOOP_AUTO=1）');
    console.log('  compare                          编排方案 A/B 对比');
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
        console.error('❌ sofagent 提示：deepagents 可选依赖未安装，编排功能暂不可用');
        console.error('   如需使用编排，请安装 deepagents（详见 ARCHITECTURE.md）');
        process.exit(1);
      }
      break;
    }
    case 'subagent': {
      const action = args[1];
      if (action !== 'run') {
        console.error(`❌ sofagent 提示：不支持的子命令 "${action || ''}"`);
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
        console.error(`❌ sofagent 提示：未找到名为 "${agentName}" 的 Sub Agent`);
        console.error('   已注册的 Agent:', agents.map((a) => a.name).join(', '));
        process.exit(1);
      }
      const output = await spawnSubAgent(definition, taskDesc);
      console.log(output);
      break;
    }
    case 'loop': {
      const legacyMode = args.includes('--legacy');
      const resumeMode = args.includes('--resume');

      if (legacyMode) {
        // 旧版兼容路径
        const taskIdx = args.indexOf('--task');
        const taskDesc = taskIdx !== -1 ? args[taskIdx + 1] : undefined;
        if (!taskDesc && !resumeMode) {
          console.error('❌ loop --legacy 需要 --task <描述> 参数');
          process.exit(1);
        }
        const { runLOOPIteration } = await import('./loop-runner');
        const result = await runLOOPIteration(taskDesc!);
        console.log('');
        console.log(`判定: ${result.verdict === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`迭代次数: ${result.iterations}`);
        process.exit(result.verdict === 'PASS' ? 0 : 1);
        break;
      }

      // v1.1.3: StateGraph 路径
      if (resumeMode) {
        const { resumeLoopGraph } = await import('./loop/graph');
        const result = await resumeLoopGraph();
        if (!result) {
          console.log('ℹ️ 未找到可恢复的 checkpoint');
          process.exit(2);
        }
        console.log('');
        console.log(`终态: ${result.finalStatus}`);
        console.log(`重试次数: ${result.retryCount}`);
        process.exit(result.finalStatus === 'completed' ? 0 : 1);
        break;
      }

      // v1.1.4: Workflow 模式——消费外部编排平台产出的 workflow.yml
      const workflowIdx = args.indexOf('--workflow');
      if (workflowIdx !== -1) {
        const workflowPath = args[workflowIdx + 1];
        if (!workflowPath) {
          console.error('❌ loop --workflow 需要 <path> 参数');
          process.exit(1);
        }
        if (process.env.LOOP_AUTO !== '1') {
          console.warn('⚠️  提示: workflow 模式建议设置 LOOP_AUTO=1（自动审核判定），否则每个子任务后仍需人工确认');
        }
        const stopOnBlocked = !args.includes('--no-stop-on-blocked');
        const { runLoopWorkflow } = await import('./loop/workflow');
        const wfResult = await runLoopWorkflow(workflowPath, { stopOnBlocked });
        console.log('');
        console.log(`Workflow: ${wfResult.workflowName}`);
        console.log(`终态: ${wfResult.finalStatus}`);
        console.log(`完成: ${wfResult.nodesCompleted}/${wfResult.nodesTotal}`);
        if (wfResult.nodesBlocked > 0) {
          console.log(`阻塞: ${wfResult.nodesBlocked}`);
        }
        for (const nr of wfResult.nodeResults) {
          const icon = nr.status === 'completed' ? '✅' : '⛔';
          console.log(`  ${icon} [${nr.nodeId}] ${nr.task.slice(0, 60)}... (retry: ${nr.retryCount})`);
        }
        process.exit(wfResult.finalStatus === 'completed' ? 0 : 2);
        break;
      }

      const taskIdx = args.indexOf('--task');
      const taskDesc = taskIdx !== -1 ? args[taskIdx + 1] : undefined;
      if (!taskDesc) {
        console.error('❌ loop 需要 --task <描述> 参数（追加 --resume 从 checkpoint 恢复）');
        process.exit(1);
      }
      const { runLoopGraph } = await import('./loop/graph');
      const result = await runLoopGraph(taskDesc);
      console.log('');
      console.log(`终态: ${result.finalStatus}`);
      console.log(`重试次数: ${result.retryCount}`);
      console.log(`checkpointId: ${result.checkpointId}`);
      process.exit(result.finalStatus === 'completed' ? 0 : result.finalStatus === 'blocked' ? 2 : 1);
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
      console.error(`❌ sofagent 提示：不支持的子命令 "${subcommand}"`);
      console.error('   可用子命令: compose | subagent | loop | compare');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
