// ============================================================
// train-serve.ts · MCP tool：train_serve（v1.4.5 第一章）
// ============================================================
//
// 推理服务生命周期四操作（start / stop / restart / status）——委托
// @sofagent/orchestrator 的 createTrainServeManager：
//   - start：从权重目录拉起 vLLM / Ollama / OpenAI 兼容端点 +
//     /health 就绪探测 + 指数退避重试（对齐 v1.3.1）
//   - stop：SIGTERM 优雅 → SIGKILL 兜底
//   - restart：stop → start（model_switch 换权重场景）
//   - status：进程视角 + 落盘视角状态合成
//
// 每次启停记 train_serve 审计事件（谁启的/哪个模型/哪个节点在用——
// orchestrator 本地 train-audit，不走 audit/writer）。
// ============================================================

import { getDataDir } from '@sofagent/core';

/** train_serve tool 入参 */
export interface TrainServeArgs {
  /** 🔴 企业标识（serve 状态分区 + train_serve 审计隔离依赖） */
  enterprise_id: string;
  /** 🔴 注册模型名（stop/restart/status 定位服务；start 从参数组装） */
  model_name?: string;
  /** 操作（缺省 status） */
  action?: 'start' | 'stop' | 'restart' | 'status';
  /** 权重目录（action=start/restart 必填——weights-manifest 目录规范） */
  weights_dir?: string;
  /** 拉起后端（缺省 vllm——三后端都暴露 OpenAI 兼容端点） */
  backend?: 'vllm' | 'ollama' | 'openai-compatible';
  /** 监听地址（缺省 127.0.0.1） */
  host?: string;
  /** 端口（缺省 8000） */
  port?: number;
  /** 服务端模型标识（缺省 model_name——Ollama 模型名与注册名可能不同） */
  model_id?: string;
  /** 后端附加参数（透传） */
  extra_args?: string[];
  /** 操作者（审计「谁启的」——缺省 mcp-train-serve） */
  actor?: string;
}

/** train_serve tool 结果 */
export interface TrainServeToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    action?: string;
    state?: string;
    endpoint?: string;
    healthUrl?: string;
    pid?: number;
    node?: string;
    backend?: string;
    attempts?: number;
  };
}

/**
 * train_serve——推理服务生命周期管理（启动/停止/重启/状态）。
 * 校验失败返回结构化错误（不抛出——对齐 train_doctor 模式）。
 */
export async function trainServeTool(args: TrainServeArgs): Promise<TrainServeToolResult> {
  const {
    enterprise_id,
    model_name,
    action = 'status',
    weights_dir,
    backend = 'vllm',
    host,
    port,
    model_id,
    extra_args,
    actor,
  } = args;

  if (typeof enterprise_id !== 'string' || enterprise_id.trim() === '') {
    return {
      text: '[sofagent] train_serve 失败：enterprise_id 必填且非空',
      data: { isError: true, ok: false, issues: ['enterprise_id 必填且非空'] },
    };
  }
  if (typeof model_name !== 'string' || model_name.trim() === '') {
    return {
      text: '[sofagent] train_serve 失败：model_name 必填（定位服务的注册模型名）',
      data: { isError: true, ok: false, issues: ['model_name 必填且非空'] },
    };
  }
  if ((action === 'start' || action === 'restart') && (typeof weights_dir !== 'string' || weights_dir.trim() === '')) {
    return {
      text: `[sofagent] train_serve 失败：action=${action} 需要 weights_dir（权重目录——weights-manifest 目录规范）`,
      data: { isError: true, ok: false, issues: [`action=${action} 时 weights_dir 必填`] },
    };
  }

  try {
    const { createTrainServeManager } = await import('@sofagent/orchestrator');
    const manager = createTrainServeManager({ dataDir: getDataDir() });

    if (action === 'status') {
      const result = manager.status(enterprise_id, model_name);
      const s = result.status!;
      return {
        text:
          s.state === 'running'
            ? `[sofagent] 推理服务运行中 ✅（${model_name}@${s.endpoint}，pid=${s.pid}，节点 ${s.node}）——健康探测 ${s.healthUrl}`
            : `[sofagent] 推理服务未运行（${model_name}）——${result.issues[0] ?? 'start 可拉起'}`,
        data: {
          isError: false,
          ok: true,
          issues: [],
          action,
          state: s.state,
          endpoint: s.endpoint,
          healthUrl: s.healthUrl,
          pid: s.pid,
          node: s.node,
          backend: s.backend,
        },
      };
    }

    if (action === 'stop') {
      const result = manager.stop(enterprise_id, model_name, actor ?? 'mcp-train-serve');
      return {
        text: `[sofagent] 推理服务已停止 ✅（${model_name}——SIGTERM→SIGKILL 兜底，train_serve 审计已记）`,
        data: { isError: false, ok: result.ok, issues: result.issues, action, state: 'stopped' },
      };
    }

    // start / restart（restart = stop → start：换权重场景）
    const target = {
      enterpriseId: enterprise_id,
      weightsDir: weights_dir!,
      modelName: model_name,
      backend,
      ...(host !== undefined ? { host } : {}),
      ...(port !== undefined ? { port } : {}),
      ...(model_id !== undefined ? { modelId: model_id } : {}),
      ...(extra_args !== undefined && extra_args.length > 0 ? { extraArgs: extra_args } : {}),
    };
    const result =
      action === 'restart'
        ? await manager.restart(target, actor ?? 'mcp-train-serve')
        : await manager.start(target, actor ?? 'mcp-train-serve');

    if (!result.ok) {
      return {
        text: `[sofagent] 推理服务 ${action} 失败 ❌：${result.issues.join('；')}`,
        data: { isError: true, ok: false, issues: result.issues, action, attempts: result.attempts },
      };
    }
    const s = result.status!;
    return {
      text:
        `[sofagent] 推理服务已${action === 'restart' ? '重启' : '拉起'} ✅（${model_name}@${s.endpoint}，` +
        `${backend}，pid=${s.pid}，健康探测 ${result.attempts} 次通过，节点 ${s.node}）——train_serve 审计已记`,
      data: {
        isError: false,
        ok: true,
        issues: [],
        action,
        state: s.state,
        endpoint: s.endpoint,
        healthUrl: s.healthUrl,
        pid: s.pid,
        node: s.node,
        backend,
        attempts: result.attempts,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] train_serve 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
