#!/usr/bin/env node
// orchestrator CLI · v1.1.9
//
// loop 子命令 v1.1.9 升级：默认走 LangGraph StateGraph 节点级流转
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
    console.log('  compose --task <desc> [--run] [--enterprise-workflow <f>] [--variants A,B,C,D] [--label <n>] [--alt-prompt <f>]');
    console.log('                                   使用 DeepAgents 编排任务（--run 执行编排）；默认只打印 YAML 工作流');
    console.log('  subagent run <name> [--mode deploy|sustain] --task <desc>');
    console.log('                                   启动 Sub Agent 执行任务（engineer / reviewer / fde 等）');
    console.log('                                   --mode 缺省 deploy；sustain 用于 FDE 持续优化模式');
    console.log('  loop --task <desc>               LOOP StateGraph 自动流转');
    console.log('       engineer (AI) → audit (CLI) → reviewer (AI) → human_confirm (HITL)');
    console.log('       --resume                     从最近 checkpoint 恢复续跑');
    console.log('       --legacy                     使用旧版 DeepAgents 串行（v1.1.3 兼容）');
    console.log('  compare                          编排方案 A/B 对比');
    process.exit(0);
  }

  switch (subcommand) {
    case 'compose': {
      // v1.1.9 (F-02): 检测 --run / --variants 等新 flag，委托给 composeTask（单一实现源）
      const hasNewFlags = args.includes('--run') ||
        args.includes('--variants') ||
        args.includes('--enterprise-workflow') ||
        args.includes('--label') ||
        args.includes('--alt-prompt');
      if (hasNewFlags) {
        // 委托给 orchestrator-compare.ts 的 composeTask（去掉 'compose' 前缀）
        const { composeTask } = await import('./orchestrator-compare');
        await composeTask(args.slice(1));
        break;
      }
      // 原有路径：只打印 YAML，不执行
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
        console.error('   用法: sofagent-orchestrator subagent run <name> [--mode deploy|sustain] --task <desc>');
        process.exit(1);
      }
      // v1.1.5 审-8：解析 --mode <deploy|sustain>，缺省 deploy（向后兼容）
      const { parseSubagentRunArgs } = await import('./cli-args');
      let parsed: ReturnType<typeof parseSubagentRunArgs>;
      try {
        parsed = parseSubagentRunArgs(args.slice(2));
      } catch (err) {
        console.error(`❌ ${(err as Error).message}`);
        process.exit(1);
      }
      const { agentName, task: taskDesc, mode } = parsed!;
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
      const output = await spawnSubAgent(definition, taskDesc, mode);
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
