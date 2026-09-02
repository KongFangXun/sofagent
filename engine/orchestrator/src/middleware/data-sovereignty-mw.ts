// ============================================================
// data-sovereignty-mw.ts · 数据主权审计 middleware（v1.4.4 · P0）
// ============================================================
//
// LangChain middleware：拦截每次模型调用 / 工具调用 → 写 DataSovereigntyRecord。
// 与 v1.4.4 运行时审计 middleware 无缝衔接（同一 middleware 链，职责分离）。
//
// 设计要点：
//   1. wrapModelCall / wrapToolCall 双拦截——覆盖 LLM 与 tool 两个出口
//   2. 审计是辅助通道：写日志失败静默，绝不 throw 阻断业务
//   3. 上下文（taskId / agentRole / userIntent）经 SovereigntyContext 注入，
//      缺省值保证零侵入接入（未注入也能落盘，只是上下文标记为 unknown）
//   4. 脱敏在 logger 内部完成（先脱敏再签名，对齐 A2/A9 防误报铁律）
// ============================================================

import { DataSovereigntyLogger } from '@sofagent/audit';
import type { DataSovereigntyRecord } from '@sofagent/audit';

// ============================================================
// 上下文（由调用方注入，缺省降级为 unknown）
// ============================================================

export interface SovereigntyContext {
  /** 唯一任务 ID（缺省自动生成） */
  taskId?: string;
  /** 父任务 ID（编排链路） */
  parentTaskId?: string;
  /** 用户原始意图摘要（logger 内脱敏） */
  userIntent?: string;
  /** 关联 workflow */
  workflowId?: string;
  /** Agent 角色 */
  agentRole?: string;
  /** 数据敏感度（缺省 internal——宁严勿宽） */
  sensitivity?: DataSovereigntyRecord['dataFlow']['sensitivity'];
}

/** 默认上下文（零侵入降级） */
const DEFAULT_CONTEXT: Required<Omit<SovereigntyContext, 'parentTaskId' | 'workflowId'>> = {
  taskId: 'unknown-task',
  userIntent: '(未提供)',
  agentRole: 'unknown',
  sensitivity: 'internal',
};

// ============================================================
// Middleware
// ============================================================

/**
 * 数据主权审计 middleware
 *
 * 用法：
 *   const mw = new DataSovereigntyMiddleware();
 *   await mw.wrapModelCall({ provider, model, endpoint, purpose }, () => llm.invoke(...), ctx);
 *   await mw.wrapToolCall({ toolName, target, description }, () => tool.run(...), ctx);
 */
export class DataSovereigntyMiddleware {
  private readonly logger: DataSovereigntyLogger;

  constructor(overrideHome?: string) {
    this.logger = new DataSovereigntyLogger(overrideHome);
  }

  /**
   * 拦截模型调用——写一条 DataSovereigntyRecord（destination 按 provider 推断）
   *
   * @param call 模型调用元数据
   * @param next 实际模型调用
   * @param ctx 任务上下文
   * @returns 模型调用结果（透传）
   */
  async wrapModelCall<T>(
    call: {
      provider: string;
      model: string;
      endpoint: string;
      purpose: string;
      tokenCount?: { input: number; output: number };
    },
    next: () => Promise<T>,
    ctx: SovereigntyContext = {},
  ): Promise<T> {
    const timestamp = new Date().toISOString();
    const isLocal = call.provider === 'ollama' || /localhost|127\.0\.0\.1/.test(call.endpoint);
    const destination: DataSovereigntyRecord['dataFlow']['destination'] = isLocal
      ? 'local-model'
      : 'cloud-api';

    let result: T;
    let auditResult: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    try {
      result = await next();
    } catch (err) {
      auditResult = 'FAIL';
      // 失败也要落审计（记录失败调用），然后原样抛出
      this.appendRecord(call, timestamp, destination, auditResult, ctx, 'model-inference');
      throw err;
    }

    this.appendRecord(call, timestamp, destination, auditResult, ctx, 'model-inference');
    return result;
  }

  /**
   * 拦截工具调用——写一条 DataSovereigntyRecord（destination = local-tool）
   *
   * @param call 工具调用元数据
   * @param next 实际工具调用
   * @param ctx 任务上下文
   * @returns 工具调用结果（透传）
   */
  async wrapToolCall<T>(
    call: {
      toolName: string;
      target: string;
      description: string;
      fields?: string[];
    },
    next: () => Promise<T>,
    ctx: SovereigntyContext = {},
  ): Promise<T> {
    const timestamp = new Date().toISOString();

    let result: T;
    let auditResult: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
    try {
      result = await next();
    } catch (err) {
      auditResult = 'FAIL';
      this.appendToolRecord(call, timestamp, auditResult, ctx);
      throw err;
    }

    this.appendToolRecord(call, timestamp, auditResult, ctx);
    return result;
  }

  // ============================================================
  // 内部：组装记录并落盘
  // ============================================================

  private appendRecord(
    call: {
      provider: string;
      model: string;
      endpoint: string;
      purpose: string;
      tokenCount?: { input: number; output: number };
    },
    timestamp: string,
    destination: DataSovereigntyRecord['dataFlow']['destination'],
    auditResult: 'PASS' | 'WARN' | 'FAIL',
    ctx: SovereigntyContext,
    actionType: DataSovereigntyRecord['localAction']['type'],
  ): void {
    const sensitivity = ctx.sensitivity ?? DEFAULT_CONTEXT.sensitivity;
    const direction: DataSovereigntyRecord['dataFlow']['direction'] =
      destination === 'cloud-api' ? 'outbound' : 'local-only';

    const record: DataSovereigntyRecord = {
      cloudCall: {
        timestamp,
        provider: call.provider,
        model: call.model,
        endpoint: call.endpoint,
        tokenCount: call.tokenCount ?? { input: 0, output: 0 },
        purpose: call.purpose,
      },
      localAction: {
        type: actionType,
        target: call.model,
        description: `模型调用 ${call.provider}/${call.model}（${call.purpose}）`,
        auditResult,
      },
      dataFlow: {
        direction,
        sensitivity,
        fields: [],
        destination,
        redacted: false,
      },
      taskContext: {
        taskId: ctx.taskId ?? DEFAULT_CONTEXT.taskId,
        parentTaskId: ctx.parentTaskId,
        userIntent: ctx.userIntent ?? DEFAULT_CONTEXT.userIntent,
        workflowId: ctx.workflowId,
        agentRole: ctx.agentRole ?? DEFAULT_CONTEXT.agentRole,
      },
    };

    this.logger.append(record);
  }

  private appendToolRecord(
    call: { toolName: string; target: string; description: string; fields?: string[] },
    timestamp: string,
    auditResult: 'PASS' | 'WARN' | 'FAIL',
    ctx: SovereigntyContext,
  ): void {
    const record: DataSovereigntyRecord = {
      cloudCall: {
        timestamp,
        provider: 'local',
        model: 'none',
        endpoint: 'local',
        tokenCount: { input: 0, output: 0 },
        purpose: 'tool-call',
      },
      localAction: {
        type: 'tool-call',
        target: call.target || call.toolName,
        description: call.description || `工具调用 ${call.toolName}`,
        auditResult,
      },
      dataFlow: {
        direction: 'local-only',
        sensitivity: ctx.sensitivity ?? DEFAULT_CONTEXT.sensitivity,
        fields: call.fields ?? [],
        destination: 'local-tool',
        redacted: false,
      },
      taskContext: {
        taskId: ctx.taskId ?? DEFAULT_CONTEXT.taskId,
        parentTaskId: ctx.parentTaskId,
        userIntent: ctx.userIntent ?? DEFAULT_CONTEXT.userIntent,
        workflowId: ctx.workflowId,
        agentRole: ctx.agentRole ?? DEFAULT_CONTEXT.agentRole,
      },
    };

    this.logger.append(record);
  }
}
