// ============================================================
// LOOP/workflow.ts · Workflow 执行引擎
// v1.1.4：消费外部编排平台（WorkBuddy 等）产出的 workflow.yml，
// 外层循环逐个执行子任务，每个子任务走完整的 engineer→audit→reviewer 闭环。
//
// 编排智能来自外部平台——WorkBuddy 的 PM+架构师产出任务列表，
// sofagent LOOP 只负责执行层：解析 YAML → 循环执行 → 返回结果。
// ============================================================

import { readFileSync, existsSync } from 'fs';
import * as yaml from 'js-yaml';
import { runLoopGraph, resolveCheckpointDir } from './graph';
import type { LoopGraphDeps } from './nodes';
import type { LoopFinalStatus } from './state';
import type { Workflow, WorkflowOptions, WorkflowResult } from './types';

/**
 * 解析 workflow.yml 文件
 */
export function loadWorkflow(workflowPath: string): Workflow | null {
  try {
    if (!existsSync(workflowPath)) {
      console.error(`[sofagent] workflow 文件不存在: ${workflowPath}`);
      return null;
    }
    const raw = readFileSync(workflowPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || !parsed.workflow) {
      console.error('[sofagent] workflow.yml 缺少顶层 workflow 字段');
      return null;
    }
    const wf = parsed.workflow as Record<string, unknown>;
    if (!wf.nodes || !Array.isArray(wf.nodes)) {
      console.error('[sofagent] workflow.yml 缺少 nodes 数组');
      return null;
    }
    return {
      name: String(wf.name ?? 'unnamed'),
      description: wf.description ? String(wf.description) : undefined,
      nodes: wf.nodes as Workflow['nodes'],
    };
  } catch (err) {
    console.error(`[sofagent] workflow.yml 解析失败: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * 运行 workflow（v1.1.4 主入口）。
 *
 * 解析 workflow.yml → 按 sequential/parallel-safe 策略逐个执行子任务 →
 * 每个子任务走完整的 engineer→audit→reviewer→auto_confirm 闭环。
 *
 * @param workflowPath workflow.yml 文件路径
 * @param options 运行选项
 */
export async function runLoopWorkflow(
  workflowPath: string,
  options: WorkflowOptions = {}
): Promise<WorkflowResult> {
  const workflow = loadWorkflow(workflowPath);
  if (!workflow) {
    return {
      workflowName: 'parse-error',
      strategy: 'sequential',
      nodesTotal: 0,
      nodesCompleted: 0,
      nodesBlocked: 0,
      finalStatus: 'blocked',
      nodeResults: [],
    };
  }

  const strategy = options.strategy ?? 'sequential';
  const stopOnBlocked = options.stopOnBlocked ?? true;
  const silent = options.silent ?? false;

  if (!silent) {
    console.log(`\n🔁 LOOP Workflow 启动 · ${workflow.name} · ${workflow.nodes.length} 子任务 · 策略: ${strategy}`);
  }

  const nodeResults: WorkflowResult['nodeResults'] = [];
  let completed = 0;
  let blocked = 0;

  for (let i = 0; i < workflow.nodes.length; i++) {
    const node = workflow.nodes[i]!;
    const taskLabel = `[${node.id}] ${node.task}`;

    if (!silent) {
      console.log(`\n📋 子任务 ${i + 1}/${workflow.nodes.length}: ${taskLabel}`);
    }

    try {
      const result = await runLoopGraph(taskLabel, {
        silent,
        checkpointDir: resolveCheckpointDir(options.checkpointDir as string | undefined),
        deps: options.deps as Partial<LoopGraphDeps> | undefined,
      });

      nodeResults.push({
        nodeId: node.id,
        task: node.task,
        status: result.finalStatus,
        retryCount: result.retryCount,
        checkpointId: result.checkpointId,
      });

      if (result.finalStatus === 'completed') {
        completed++;
      } else {
        blocked++;
        if (!silent) {
          console.error(`⛔ 子任务 ${node.id} 终态: ${result.finalStatus}`);
        }
        if (stopOnBlocked) {
          if (!silent) {
            console.error(`⛔ stopOnBlocked=true，终止 workflow`);
          }
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ 子任务 ${node.id} 执行异常: ${msg}`);
      nodeResults.push({
        nodeId: node.id,
        task: node.task,
        status: 'blocked',
        retryCount: 0,
        checkpointId: '',
      });
      blocked++;
      if (stopOnBlocked) break;
    }
  }

  const finalStatus: LoopFinalStatus =
    blocked > 0 ? 'blocked' : 'completed';

  if (!silent) {
    console.log(`\n🏁 Workflow 结束 · ${workflow.name} · 完成 ${completed}/${workflow.nodes.length} · 终态: ${finalStatus}`);
  }

  return {
    workflowName: workflow.name,
    strategy,
    nodesTotal: workflow.nodes.length,
    nodesCompleted: completed,
    nodesBlocked: blocked,
    finalStatus,
    nodeResults,
  };
}
