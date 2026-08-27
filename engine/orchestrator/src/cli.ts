#!/usr/bin/env node
// orchestrator CLI · v1.4.1
//
// loop 子命令 v1.3.7 升级：默认走 LangGraph StateGraph 节点级流转
// （engineer→audit→reviewer→human_confirm），支持 --resume 从 checkpoint
// 恢复。旧版串行路径通过 --legacy 保留兼容。

import { join } from 'path';

const args = process.argv.slice(2);
const subcommand = args[0];
async function main() {
  if (!subcommand || subcommand === '--help') {
    console.log('sofagent-orchestrator — 多 Agent 协作 / 工作流调度 / prompt 模板');
    console.log('Usage: sofagent-orchestrator <subcommand> [options]');
    console.log('');
    console.log('Subcommands:');
    console.log('  compose --task <desc> [--run] [--enterprise-workflow <f>] [--variants A,B,C,D] [--label <n>] [--alt-prompt <f>]');
    console.log('                                   使用 createReactAgent 编排任务（--run 执行编排）；默认只打印 YAML 工作流');
    console.log('  subagent run <name> [--mode deploy|sustain] --task <desc>');
    console.log('                                   启动 Sub Agent 执行任务（engineer / reviewer / fde 等）');
    console.log('                                   --mode 缺省 deploy；sustain 用于 FDE 持续优化模式');
    console.log('  loop --task <desc>               LOOP StateGraph 自动流转');
    console.log('       engineer (AI) → audit (CLI) → reviewer (AI) → human_confirm (HITL)');
    console.log('       --resume                     从最近 checkpoint 恢复续跑');
    console.log('       --resolve <checkpointId> --decision approve|reject|aborted');
    console.log('                                  对 awaiting_human 挂起的 HITL 写入人工决策并续跑');
    console.log('       --data-dir <dir>             HITL pending/resolved 根路径（默认 {SOFAGENT_DATA}）');
    console.log('       --legacy                     使用旧版串行路径（v1.1.3 兼容）');
    console.log('  compare                          编排方案 A/B 对比');
    console.log('  activate [--dry-run] [--node-filter id1,id2]');
    console.log('                                   激活 FDE 交付物 → 注册企业 SubAgent');
    console.log('                                   --dry-run 只预览不写文件');
    console.log('                                   --node-filter 只激活指定节点');
    console.log('  run-enterprise [--workflow <path>]');
    console.log('                                   v1.2.8: 从 workflow.yml 构建图 + 逐节点执行企业 Agent');
    console.log('  evolve [--data-dir <dir>] [--skill-dir <dir>] [--threshold <n>]');
    console.log('                                   v1.3.5: /evolve 聚合器——从 think.md + decision-log + 错题本');
    console.log('                                   提取 instinct，置信度达标聚合成 skill 写入运行时目录');
    console.log('                                   （缺省 ~/.sofagent/skill/custom/）');
    console.log('  train doctor [--gpu]             v1.4.1 块七: 训练环境体检——GPU 显存核对');
    console.log('                                   （无 nvidia-smi 输出 unsupported + 走孤儿检测报告）');
    console.log('  train cleanup <enterpriseId> [--passes <n>] [--data-dir <dir>]');
    console.log('                                   v1.4.1 块七: 清空企业训练数据（覆写→混淆→删除）');
    console.log('  train reproduce --fingerprint <file> --data <dir> [--seed <n>]');
    console.log('                                   v1.4.1 块七: 复现校验——现场 vs 冻结指纹差异报告');
    console.log('  train verify <trainJobId> [--enterprise <id>] [--data-dir <dir>]');
    console.log('                                   v1.4.1 块七: 产物完整性校验（签名+逐文件 hash+指纹关联）');
    process.exit(0);
  }

  switch (subcommand) {
    case 'compose': {
      // v1.1.9: 检测 --run / --variants 等新 flag，委托给 composeTask（单一实现源）
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
        console.error('❌ sofagent 提示：编排引擎未安装，编排功能暂不可用');
        console.error('   如需使用编排，请确认 @langchain/langgraph 已安装（详见 ARCHITECTURE.md）');
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
      const { loadEnvConfig } = await import('@sofagent/core');
      const dataDir = loadEnvConfig().dataDir;
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

      // v1.2.2 P3b：解析 --resolve / --decision / --data-dir
      const resolveIdx = args.indexOf('--resolve');
      const resolveCheckpointId = resolveIdx !== -1 ? args[resolveIdx + 1] : undefined;
      const decisionIdx = args.indexOf('--decision');
      const decisionArg = decisionIdx !== -1 ? args[decisionIdx + 1] : undefined;
      const dataDirIdx = args.indexOf('--data-dir');
      const dataDirArg = dataDirIdx !== -1 ? args[dataDirIdx + 1] : undefined;

      // --resolve 模式：写入 HITL 响应 + 触发 resumeLoopGraph 续跑
      if (resolveCheckpointId) {
        const validDecisions = ['approve', 'reject', 'aborted'] as const;
        type Decision = (typeof validDecisions)[number];
        if (!decisionArg || !(validDecisions as readonly string[]).includes(decisionArg)) {
          console.error(`❌ loop --resolve 需要 --decision <${validDecisions.join('|')}>`);
          process.exit(1);
        }
        const { loadEnvConfig } = await import('@sofagent/core');
        const { writeHITLResponse } = await import('./hitl');
        const { resumeLoopGraph } = await import('./loop/graph');
        const dataDir = dataDirArg ?? loadEnvConfig().dataDir;
        writeHITLResponse(dataDir, {
          checkpointId: resolveCheckpointId,
          decision: decisionArg as Decision,
          resolvedAt: new Date().toISOString(),
        });
        console.log(`📝 HITL 决策已写入: ${decisionArg}（checkpointId=${resolveCheckpointId}）`);
        const result = await resumeLoopGraph({ dataDir });
        if (!result) {
          console.log('ℹ️ 未找到可恢复的 checkpoint');
          process.exit(2);
        }
        console.log('');
        console.log(`终态: ${result.finalStatus}`);
        console.log(`重试次数: ${result.retryCount}`);
        process.exit(result.finalStatus === 'completed' ? 0 : result.finalStatus === 'awaiting_human' ? 3 : 1);
        break;
      }

      // v1.1.3: StateGraph 路径
      if (resumeMode) {
        const { resumeLoopGraph } = await import('./loop/graph');
        const result = await resumeLoopGraph({ dataDir: dataDirArg });
        if (!result) {
          console.log('ℹ️ 未找到可恢复的 checkpoint');
          process.exit(2);
        }
        console.log('');
        console.log(`终态: ${result.finalStatus}`);
        console.log(`重试次数: ${result.retryCount}`);
        process.exit(result.finalStatus === 'completed' ? 0 : result.finalStatus === 'awaiting_human' ? 3 : 1);
        break;
      }

      const taskIdx = args.indexOf('--task');
      const taskDesc = taskIdx !== -1 ? args[taskIdx + 1] : undefined;
      if (!taskDesc) {
        console.error('❌ loop 需要 --task <描述> 参数（追加 --resume 从 checkpoint 恢复）');
        process.exit(1);
      }
      const { runLoopGraph } = await import('./loop/graph');
      const result = await runLoopGraph(taskDesc, { dataDir: dataDirArg });
      console.log('');
      console.log(`终态: ${result.finalStatus}`);
      console.log(`重试次数: ${result.retryCount}`);
      console.log(`checkpointId: ${result.checkpointId}`);
      // v1.2.2 P3b：awaiting_human 挂起态用独立退出码 3 标识，便于 daemon/脚本区分
      process.exit(result.finalStatus === 'completed' ? 0 : result.finalStatus === 'blocked' ? 2 : result.finalStatus === 'awaiting_human' ? 3 : 1);
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
    case 'activate': {
      const dryRun = args.includes('--dry-run');
      const filterIdx = args.indexOf('--node-filter');
      const nodeFilter = filterIdx !== -1
        ? args[filterIdx + 1]?.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;
      const { activateWorkflow } = await import('./activate');
      const { loadEnvConfig } = await import('@sofagent/core');
      const dataDir = loadEnvConfig().dataDir;
      try {
        const result = await activateWorkflow({ dataDir, dryRun, nodeFilter });
        console.log('');
        console.log(dryRun ? '🔍 激活预览（dry-run，未写入文件）' : '✅ 激活完成');
        console.log('');
        console.log(`注册的 Agent (${result.registeredAgents.length}):`);
        for (const name of result.registeredAgents) {
          const hitlTag = result.hitlNodes.includes(name) ? ' [HITL]' : '';
          console.log(`  - ${name}${hitlTag}`);
        }
        if (result.skippedNodes.length > 0) {
          console.log('');
          console.log(`跳过的节点 (${result.skippedNodes.length}):`);
          for (const s of result.skippedNodes) {
            console.log(`  - ${s.name}: ${s.reason}`);
          }
        }
        console.log('');
        console.log('拓扑描述:');
        console.log(result.workflowGraph);
        process.exit(0);
      } catch (err) {
        console.error(`❌ 激活失败: ${(err as Error).message}`);
        process.exit(1);
      }
    }
    case 'run-enterprise': {
      // v1.2.9 功能④：从 workflow.yml 构建图 + 逐节点执行企业 Agent
      const wfIdx = args.indexOf('--workflow');
      const workflowPath = wfIdx !== -1
        ? args[wfIdx + 1]!
        : join(process.cwd(), '.sofagent', 'data', 'workflow.yml');

      const { buildEnterpriseStateGraph } = await import('./enterprise-graph');
      const { executeNode } = await import('./node-executor');
      const { toSubAgentConfigs } = await import('./workflow-parser');
      const { loadEnvConfig } = await import('@sofagent/core');
      const dataDir = loadEnvConfig().dataDir;

      try {
        const composeResult = await buildEnterpriseStateGraph({
          workflowYmlPath: workflowPath,
          dataDir,
        });

        console.log(`📋 workflow「${composeResult.workflow.name}」: ${composeResult.graph.nodes.length} 个节点`);
        console.log('');

        // 检查是否有 HITL 节点 → fail-fast
        const hitlNodes = composeResult.graph.nodes.filter((n) => n.interruptBefore);
        if (hitlNodes.length > 0) {
          console.error(`❌ 发现 ${hitlNodes.length} 个 HITL 节点: ${hitlNodes.map((n) => n.id).join(', ')}`);
          console.error('   HITL 节点执行需 v1.2.9 hitl-handler.ts，当前版本不支持。');
          process.exit(1);
        }

        // 按拓扑顺序逐节点执行
        const subagentMap = new Map(composeResult.subagents.map((s) => [s.name, s]));
        let allSuccess = true;
        const results: Array<{ node: string; success: boolean; durationMs: number; output: string }> = [];

        for (const graphNode of composeResult.graph.nodes) {
          const agentConfig = subagentMap.get(graphNode.agent)
            ?? subagentMap.get(graphNode.id)
            ?? composeResult.subagents[0];

          if (!agentConfig) {
            console.error(`❌ 节点 ${graphNode.id} 的 Agent 配置未找到`);
            allSuccess = false;
            break;
          }

          // 检查依赖是否全部成功
          const depResults = results.filter((r) => graphNode.dependsOn.includes(r.node));
          if (depResults.some((r) => !r.success)) {
            console.error(`❌ 节点 ${graphNode.id} 的上游节点失败，跳过执行`);
            allSuccess = false;
            continue;
          }

          console.log(`▶️  执行节点 ${graphNode.id}（agent: ${graphNode.agent}）...`);
          const result = await executeNode({
            agentName: graphNode.agent,
            agentConfig,
            node: {
              id: graphNode.id,
              agent: graphNode.agent,
              task: graphNode.task,
              depends_on: graphNode.dependsOn,
              type: 'auto',
              hitl: false,
            },
            dataDir,
            projectRoot: process.cwd(),
          });

          results.push({
            node: graphNode.id,
            success: result.success,
            durationMs: result.durationMs,
            output: result.output,
          });

          if (result.success) {
            console.log(`  ✅ ${graphNode.id} 完成 (${result.durationMs}ms)`);
          } else {
            console.error(`  ❌ ${graphNode.id} 失败: ${result.error}`);
            allSuccess = false;
          }
        }

        console.log('');
        console.log(allSuccess ? '✅ 所有节点执行完成' : '❌ 部分节点执行失败');
        for (const r of results) {
          const status = r.success ? '✅' : '❌';
          console.log(`  ${status} ${r.node} (${r.durationMs}ms)`);
        }
        process.exit(allSuccess ? 0 : 1);
      } catch (err) {
        console.error(`❌ run-enterprise 失败: ${(err as Error).message}`);
        process.exit(1);
      }
    }
    case 'evolve': {
      // v1.3.5 交付 3：/evolve 聚合器 CLI 挂载点
      // extractInstincts（think.md + decision-log + 错题本）→ evolveInstincts
      // （置信度达标聚合成 skill 写入运行时 skill 目录）。
      // 🔴 skillDir 必须显式可控——测试/冒烟指向 tmpdir，绝不污染真实
      // ~/.sofagent/skill/custom/（evolver.ts 铁律：只写运行时目录）。
      const evolveDataDirIdx = args.indexOf('--data-dir');
      const evolveSkillDirIdx = args.indexOf('--skill-dir');
      const evolveThresholdIdx = args.indexOf('--threshold');
      const { loadEnvConfig } = await import('@sofagent/core');
      const evolveDataDir = evolveDataDirIdx !== -1 && args[evolveDataDirIdx + 1]
        ? args[evolveDataDirIdx + 1]!
        : loadEnvConfig().dataDir;
      const evolveSkillDir = evolveSkillDirIdx !== -1 ? args[evolveSkillDirIdx + 1] : undefined;
      const evolveThreshold = evolveThresholdIdx !== -1 ? parseFloat(args[evolveThresholdIdx + 1]!) : undefined;
      if (evolveThresholdIdx !== -1 && Number.isNaN(evolveThreshold)) {
        console.error('❌ evolve --threshold 需要数值（如 0.7）');
        process.exit(1);
      }

      const { extractInstincts } = await import('./instinct/extractor');
      const { evolveInstincts } = await import('./instinct/evolver');

      const instincts = extractInstincts({ dataDir: evolveDataDir });
      console.log(`🌱 提取到 ${instincts.length} 条 instinct（来源：think.md + decision-log + 错题本）`);

      if (instincts.length === 0) {
        console.log('ℹ️ 提取到 0 条 instinct，未产生进化产物');
        break;
      }

      const result = evolveInstincts(instincts, {
        skillDir: evolveSkillDir,
        threshold: evolveThreshold,
      });

      if (result.skills.length > 0) {
        console.log('');
        console.log(`✅ 聚合出 ${result.skills.length} 个进化 skill（写入 ${result.skillDir}）：`);
        for (const skill of result.skills) {
          console.log(`  - ${skill.name}（${skill.instinctCount} 条 instinct）`);
          console.log(`    SKILL.md: ${skill.skillMdPath}`);
          console.log(`    overrides: ${skill.overridesPath}`);
        }
      } else {
        console.log('ℹ️ 无 instinct 达到聚合门槛，未产生进化产物');
      }
      if (result.leftover.length > 0) {
        console.log(`   散-instinct（达标未成组，留给下轮）: ${result.leftover.length} 条`);
      }
      break;
    }
    case 'train': {
      // v1.4.1 块七：train 子命令族（doctor 本波实装；cleanup/reproduce/verify 骨架待接线）
      const trainAction = args[1];
      if (!trainAction) {
        console.error('❌ train 需要子动作: doctor | cleanup | reproduce | verify');
        process.exit(1);
      }
      if (trainAction === 'doctor') {
        const wantGpu = args.includes('--gpu');
        const { snapshotGpuMemory } = await import('./train/process-guard');
        const { loadEnvConfig } = await import('@sofagent/core');
        const { listTrainJobRecords } = await import('./train/train-job');
        const { existsSync, readdirSync } = await import('fs');
        const { join } = await import('path');

        const dataDir = loadEnvConfig().dataDir;

        // ① GPU 显存核对（--gpu 或默认都执行——无 nvidia-smi 输出 unsupported）
        if (wantGpu) {
          const gpu = snapshotGpuMemory();
          if (!gpu.supported) {
            console.log(`ℹ️ GPU 显存核对：unsupported（${gpu.note}）`);
          } else {
            const used = gpu.perGpuUsedMiB ?? [];
            const total = used.reduce((a, b) => a + b, 0);
            console.log(`🎮 GPU 显存：${gpu.note}，已用 ${used.join(' / ')} MiB（合计 ${total} MiB）`);
          }
        }

        // ② 孤儿检测报告（state=running 的 job → pid 存活探测 + 无主进程识别）
        const trainRoot = join(dataDir, 'train');
        const activePids: Array<{ pid: number; jobId: string; enterpriseId: string }> = [];
        if (existsSync(trainRoot)) {
          for (const ent of readdirSync(trainRoot, { withFileTypes: true })) {
            if (!ent.isDirectory()) continue;
            for (const rec of listTrainJobRecords(dataDir, ent.name)) {
              if (rec.status !== 'running' && rec.status !== 'checkpointing') continue;
              if (typeof rec.pid !== 'number') continue;
              activePids.push({ pid: rec.pid, jobId: rec.jobId, enterpriseId: rec.enterpriseId });
            }
          }
        }

        // 假活检测（进程探测）
        const probe = (pid: number): boolean => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (err) {
            return (err as NodeJS.ErrnoException).code === 'EPERM';
          }
        };
        const dead = activePids.filter((p) => !probe(p.pid));
        const alive = activePids.length - dead.length;

        console.log(`📋 训练任务体检：运行中 ${activePids.length} 个（子进程存活 ${alive} / 假活 ${dead.length}）`);
        for (const d of dead) {
          console.log(`  ⚠️ ${d.enterpriseId}/${d.jobId}（pid=${d.pid} 已死——建议引擎重启触发 crash-recovery）`);
        }
        if (dead.length > 0) {
          process.exit(1);
        }
        console.log('✅ 训练环境体检通过');
        break;
      }

      // ── v1.4.1 块七挂线：cleanup / reproduce / verify（doctor 已实装）──
      if (trainAction === 'cleanup') {
        // train cleanup <enterpriseId> [--data-dir <dir>] [--passes <n>]
        const enterpriseId = args[2];
        if (!enterpriseId || enterpriseId.startsWith('--')) {
          console.error('❌ 用法: train cleanup <enterpriseId> [--data-dir <dir>] [--passes <n>]');
          console.error('   清空该企业全部训练数据（覆写 → 混淆 → 删除——不可复原）');
          process.exit(1);
        }
        const dataDirIdx = args.indexOf('--data-dir');
        const passesIdx = args.indexOf('--passes');
        const { cleanupEnterpriseTrainData } = await import('./train/cleanup');
        const { EnterpriseAccessDeniedError } = await import('./train/isolation-guard');
        const { loadEnvConfig } = await import('@sofagent/core');
        const cleanupDataDir = dataDirIdx !== -1 && args[dataDirIdx + 1] ? args[dataDirIdx + 1]! : loadEnvConfig().dataDir;
        const passes = passesIdx !== -1 ? parseInt(args[passesIdx + 1]!, 10) : undefined;
        if (passesIdx !== -1 && (!passes || passes < 1)) {
          console.error('❌ train cleanup --passes 需要正整数（如 1）');
          process.exit(1);
        }
        try {
          const report = cleanupEnterpriseTrainData(
            cleanupDataDir,
            enterpriseId,
            passes !== undefined ? { passes } : {},
          );
          console.log(`🧹 企业训练数据清理报告（${report.enterpriseDir}）`);
          console.log(`   覆写删除文件: ${report.wipedFiles} 个（${report.overwrittenBytes} 字节）`);
          console.log(`   混淆删除目录: ${report.removedDirs} 个（含企业分区根: ${report.enterpriseDirRemoved ? '已删' : '未删'}）`);
          if (report.skipped.length > 0) {
            console.error(`⚠️  ${report.skipped.length} 项跳过（失败如实报告）：`);
            for (const s of report.skipped) {
              console.error(`   - [${s.stage}] ${s.path}：${s.reason}`);
            }
          }
          console.log(report.fullyCleaned ? '✅ 全部清理完成' : '❌ 存在未清项（见 skipped）');
          process.exit(report.fullyCleaned ? 0 : 1);
        } catch (err) {
          if (err instanceof EnterpriseAccessDeniedError) {
            console.error(`❌ 企业隔离拒绝：${err.message}`);
          } else {
            console.error(`❌ cleanup 失败: ${(err as Error).message}`);
          }
          process.exit(1);
        }
      }

      if (trainAction === 'reproduce') {
        // train reproduce --fingerprint <file> --data <dir> [--seed <n>] [--data-dir <dir>]
        const fpIdx = args.indexOf('--fingerprint');
        const dataIdx = args.indexOf('--data');
        if (fpIdx === -1 || !args[fpIdx + 1]) {
          console.error('❌ 用法: train reproduce --fingerprint <指纹文件> --data <当前数据目录> [--seed <n>]');
          console.error('   现场数据/环境/超参/种子 与冻结指纹逐项比对，输出差异报告');
          process.exit(1);
        }
        const fingerprintFile = args[fpIdx + 1]!;
        const { readFileSync, existsSync: fpExists } = await import('fs');
        if (!fpExists(fingerprintFile)) {
          console.error(`❌ 指纹文件不存在: ${fingerprintFile}`);
          process.exit(1);
        }
        // 指纹解析（TrainFingerprintSchema 校验——坏文件明确报错）
        const { TrainFingerprintSchema } = await import('./train/train-fingerprint');
        let fingerprint: import('./train/train-fingerprint').TrainFingerprint;
        try {
          const parsed = TrainFingerprintSchema.safeParse(JSON.parse(readFileSync(fingerprintFile, 'utf-8')));
          if (!parsed.success) {
            throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；'));
          }
          fingerprint = parsed.data;
        } catch (err) {
          console.error(`❌ 指纹文件解析失败（schema 校验不过）: ${(err as Error).message}`);
          process.exit(1);
        }
        // 当前上下文采集：数据目录（--data 必填）+ 环境快照（现场探测）+ 超参/种子（指纹回显口径说明）
        const datasetDir = dataIdx !== -1 ? args[dataIdx + 1] : undefined;
        if (!datasetDir) {
          console.error('❌ train reproduce 需要 --data <当前数据目录>（现场重算 hash 的比对对象）');
          process.exit(1);
        }
        const { prepareTrainEnv } = await import('./train/train-env');
        const envReport = await prepareTrainEnv();
        const seedIdx = args.indexOf('--seed');
        const seed = seedIdx !== -1 ? parseInt(args[seedIdx + 1]!, 10) : fingerprint.randomSeed;
        const { reproduceCheck } = await import('./train/train-fingerprint');
        const result = reproduceCheck(fingerprint, {
          datasetDir,
          envSnapshot: {
            branch: envReport.branch,
            gpuName: envReport.gpu?.name ?? null,
            frameworkName: envReport.framework?.name ?? null,
            frameworkVersion: envReport.framework?.version ?? null,
            checkedAt: envReport.checkedAt,
          },
          // CLI 复现口径：超参无现场输入源（job.json 已随 job 归档），缺省按指纹
          // 原值比对（差异只会来自数据/环境/种子三面——如实报告比对口径）
          hyperparams: fingerprint.hyperparams,
          randomSeed: seed,
        });
        console.log(`🔍 复现校验（job=${fingerprint.trainJobId}，数据集版本 ${fingerprint.datasetVersion}）`);
        if (result.reproducible) {
          console.log('✅ 四要素全一致——理论上可复现（数据 hash / 环境 / 超参 / 种子）');
          process.exit(0);
        }
        console.error(`❌ ${result.diffs.length} 处差异（不可复现）：`);
        for (const d of result.diffs) {
          console.error(`   - [${d.field}] ${d.detail}`);
        }
        process.exit(1);
      }

      if (trainAction === 'verify') {
        // train verify <trainJobId> [--enterprise <id>] [--data-dir <dir>]
        const trainJobId = args[2];
        if (!trainJobId || trainJobId.startsWith('--')) {
          console.error('❌ 用法: train verify <trainJobId> [--enterprise <id>] [--data-dir <dir>]');
          console.error('   产物完整性校验（manifest 签名 + 逐文件 hash + 指纹关联）');
          process.exit(1);
        }
        const entIdx = args.indexOf('--enterprise');
        const dataDirIdx = args.indexOf('--data-dir');
        const { loadEnvConfig } = await import('@sofagent/core');
        const verifyDataDir = dataDirIdx !== -1 && args[dataDirIdx + 1] ? args[dataDirIdx + 1]! : loadEnvConfig().dataDir;
        // enterpriseId 定位：显式 --enterprise > 全企业扫描 data/train/*/<jobId>
        // （扫描是只读定位不跨界写——同名 jobId 撞多企业时列出候选要求显式指定）
        const { existsSync, readdirSync } = await import('fs');
        const { join } = await import('path');
        let enterpriseId: string | undefined = entIdx !== -1 ? args[entIdx + 1] : undefined;
        if (!enterpriseId) {
          const trainRoot = join(verifyDataDir, 'train');
          const candidates: string[] = [];
          if (existsSync(trainRoot)) {
            for (const ent of readdirSync(trainRoot, { withFileTypes: true })) {
              if (ent.isDirectory() && existsSync(join(trainRoot, ent.name, trainJobId))) {
                candidates.push(ent.name);
              }
            }
          }
          if (candidates.length === 0) {
            console.error(`❌ 未找到任务 ${trainJobId}（扫描 ${trainRoot}/*/${trainJobId} 无命中）`);
            process.exit(1);
          }
          if (candidates.length > 1) {
            console.error(`❌ 任务 ${trainJobId} 命中多个企业分区（${candidates.join(', ')}）——请用 --enterprise <id> 显式指定`);
            process.exit(1);
          }
          enterpriseId = candidates[0]!;
        }
        const { verifyArtifacts } = await import('./train/artifact-verify');
        const report = await verifyArtifacts({ dataDir: verifyDataDir, enterpriseId, trainJobId });
        console.log(`🔐 产物完整性校验（${report.enterpriseId}/${report.trainJobId}）`);
        console.log(`   manifest 完整性: ${report.manifestIntegrity}`);
        console.log(`   指纹关联: ${report.fingerprintLinked ? '已关联' : '断裂'}`);
        if (report.files.length > 0) {
          for (const f of report.files) {
            const icon = f.status === 'ok' ? '✅' : f.status === 'tampered' ? '🔴' : '⚠️';
            console.log(`   ${icon} ${f.path}（${f.status}）`);
          }
        }
        for (const u of report.unregistered) {
          console.log(`   ⚠️ 未登记文件: ${u}`);
        }
        if (report.ok) {
          console.log(`✅ ${report.detail}——可挂载`);
          process.exit(0);
        }
        console.error(`❌ ${report.rejectionReason ?? report.detail}`);
        process.exit(1);
      }

      console.error(`❌ 不支持的 train 子动作 "${trainAction}"（可用: doctor | cleanup | reproduce | verify）`);
      process.exit(1);
    }
    default:
      console.error(`❌ sofagent 提示：不支持的子命令 "${subcommand}"`);
      console.error('   可用子命令: compose | subagent | loop | compare | activate | run-enterprise | evolve | train');
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
