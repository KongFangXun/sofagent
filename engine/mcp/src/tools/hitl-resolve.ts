// ============================================================
// hitl-resolve.ts · MCP tool：HITL 异步决议（v1.2.9 新增）
// ============================================================
//
// 复用 cli.ts --resolve 的实现路径：
// 1. 校验 checkpointId 存在于 pending/ 目录（MCP 层自行校验）
// 2. 调 writeHITLResponse 写入 resolved/{checkpointId}.json
// 3. 调 resumeLoopGraph 续跑挂起的 LOOP
//
// decision 枚举：approve | reject | aborted
//
// 安全约束：MCP 层自行校验 checkpointId——
// 底层 writeHITLResponse 不校验、resumeLoopGraph 只恢复最近 checkpoint，
// 所以 MCP 层必须先确认 pending/ 目录有对应 checkpointId 文件。
// ============================================================

import { existsSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

export interface HitlResolveArgs {
  /** HITL checkpoint ID（必填） */
  checkpoint_id: string;
  /** 人工决策：approve | reject | aborted（必填） */
  decision: 'approve' | 'reject' | 'aborted';
  /** 可选备注（驳回原因等） */
  comment?: string;
}

export interface HitlResolveResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    ok: boolean;
    checkpointId: string;
    decision: string;
    finalStatus?: string;
    retryCount?: number;
    message?: string;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * HITL 异步决议——写入决策文件 + 触发 LOOP 恢复
 *
 * @param args 决议参数
 * @returns 结构化结果（text + data）
 */
export async function hitlResolve(args: HitlResolveArgs): Promise<HitlResolveResult> {
  const checkpointId = args.checkpoint_id;
  const decision = args.decision;
  const comment = args.comment;

  // 参数校验
  if (!checkpointId) {
    return {
      text: '[sofagent] HITL 决议失败：缺少 checkpoint_id 参数',
      data: { ok: false, checkpointId: '', decision: decision ?? '' },
    };
  }

  const validDecisions = ['approve', 'reject', 'aborted'];
  if (!decision || !validDecisions.includes(decision)) {
    return {
      text: `[sofagent] HITL 决议失败：decision 必须为 ${validDecisions.join('|')}`,
      data: { ok: false, checkpointId, decision: decision ?? '' },
    };
  }

  // 延迟导入 orchestrator
  let writeHITLResponse: (dataDir: string, response: {
    checkpointId: string;
    decision: 'approve' | 'reject' | 'aborted';
    resolvedAt: string;
    comment?: string;
  }) => void;
  let resumeLoopGraph: (options: { dataDir?: string }) => Promise<{
    finalStatus: string;
    retryCount: number;
  } | null>;

  try {
    const mod = await import('@sofagent/orchestrator');
    if (typeof mod.writeHITLResponse !== 'function') {
      throw new Error('writeHITLResponse 不可用');
    }
    if (typeof mod.resumeLoopGraph !== 'function') {
      throw new Error('resumeLoopGraph 不可用');
    }
    writeHITLResponse = mod.writeHITLResponse;
    resumeLoopGraph = mod.resumeLoopGraph;
  } catch {
    return {
      text: '[sofagent] HITL 决议失败：@sofagent/orchestrator 未安装或不可用',
      data: { ok: false, checkpointId, decision, message: 'orchestrator 不可用' },
    };
  }

  const dataDir = loadEnvConfig().dataDir;

  // MCP 层校验：checkpointId 必须存在于 pending/ 目录
  const pendingPath = join(dataDir, 'hitl', 'pending', `${checkpointId}.json`);
  if (!existsSync(pendingPath)) {
    return {
      text: `[sofagent] HITL 决议失败：checkpointId=${checkpointId} 在 pending/ 目录中不存在`,
      data: {
        ok: false,
        checkpointId,
        decision,
        message: `checkpoint ${checkpointId} 未找到——可能已处理或从未创建`,
      },
    };
  }

  try {
    // 写入 HITL 响应
    writeHITLResponse(dataDir, {
      checkpointId,
      decision,
      resolvedAt: new Date().toISOString(),
      ...(comment ? { comment } : {}),
    });

    // 触发 LOOP 恢复
    const result = await resumeLoopGraph({ dataDir });

    if (!result) {
      return {
        text: `[sofagent] HITL 决议已写入（${decision}），但未找到可恢复的 checkpoint`,
        data: {
          ok: true,
          checkpointId,
          decision,
          message: '决议已写入，但无可恢复的 checkpoint（可能已被其他进程处理）',
        },
      };
    }

    const lines: string[] = [];
    lines.push(`[sofagent] HITL 决议完成: ${decision}（checkpointId=${checkpointId}）`);
    lines.push(`终态: ${result.finalStatus}`);
    lines.push(`重试次数: ${result.retryCount}`);

    return {
      text: lines.join('\n'),
      data: {
        ok: true,
        checkpointId,
        decision,
        finalStatus: result.finalStatus,
        retryCount: result.retryCount,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] HITL 决议异常: ${err instanceof Error ? err.message : String(err)}`,
      data: {
        ok: false,
        checkpointId,
        decision,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
