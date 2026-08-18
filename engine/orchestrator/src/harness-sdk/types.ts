// ============================================================
// harness-sdk/types.ts · SubAgent 托管 SDK 类型定义（v1.3.7 交付 ③）
// ============================================================
//
// 一行包装，获得约束层全部能力：
//   const agent = harness.wrap(myLangGraphAgent, { approval, identity, sandbox, trace });
//
// 双形态兼容：① createReactAgent（middleware 链路）② 纯 StateGraph（tools 节点注入）
// ============================================================
import type { AgentIdentity } from '@sofagent/core';

/**
 * 审批模式——v1.3.1 审批语义的 SDK 暴露面。
 *
 * - allow-with-audit（默认·保守）：工具调用直接放行，但全部进审计留痕
 * - require-approval：每次副作用类工具调用前挂起等人审（对齐 promote_ab 强制人审语义）
 * - deny：全部拦截（只读观察模式——适合审计/监控类 agent）
 */
export type ApprovalMode = 'allow-with-audit' | 'require-approval' | 'deny';

/**
 * 托管配置——wrap() 第二参数。
 * 所有字段可选；缺省走保守默认（不破坏既有行为）。
 */
export interface HarnessWrapOptions {
  /**
   * 审批模式（缺省 'allow-with-audit'——放行但留痕）。
   * 副作用类工具（write/delete/git 等）的拦截策略由此控制。
   */
  approval?: ApprovalMode;
  /**
   * 身份码（v1.3.1 身份体系）。
   * - 传字符串：作为 displayName，自动生成完整 AgentIdentity
   * - 传 AgentIdentity：直接使用（外部签发场景）
   * - 缺省：自动生成（agentId = 内部 UUID，displayName = options.name）
   */
  identity?: string | AgentIdentity;
  /**
   * 沙箱开关（v1.3.7 组件 · 本版留空）。
   * 🔴 版本边界：传 true 抛明确错误「v1.3.8 启用」，false/缺省正常。
   */
  sandbox?: boolean;
  /**
   * LLM 调用级 Trace 开关（v1.3.1 trace 体系）。
   * 缺省 true——wrap 的默认价值主张就是全链可观测。
   */
  trace?: boolean;
  /**
   * 被托管 agent 的显示名（registry 注册用；缺省 'wrapped-agent'）。
   */
  name?: string;
  /**
   * 数据目录（decision-log / trace 落盘位置；缺省 process.cwd()/data）。
   */
  dataDir?: string;
  /**
   * 注入的审计钩子（测试/宿主自定义——每次工具调用后回调）。
   * 生产路径不传，走内置 decision-log 留痕。
   */
  onToolCall?: (event: HarnessToolCallEvent) => void;
  /**
   * 注入的审批回调（approval='require-approval' 时调用——返回是否放行）。
   * 生产路径对接 HITL channel；测试注入 mock。
   */
  requestApproval?: (event: HarnessApprovalEvent) => Promise<boolean>;
}

/** 工具调用审计事件（onToolCall 回调载荷） */
export interface HarnessToolCallEvent {
  /** 被托管 agent 的身份标识 */
  agentId: string;
  /** 工具名 */
  toolName: string;
  /** 工具入参 */
  args: Record<string, unknown>;
  /** 执行结果文本（截断保护：超长截断） */
  resultPreview: string;
  /** 执行是否抛错 */
  errored: boolean;
  /** 审批判定（allow-with-audit/require-approval 均有值；deny 不执行） */
  approvalVerdict: ApprovalMode;
  /** 事件时间戳（ISO 8601） */
  ts: string;
}

/** 审批请求事件（requestApproval 回调载荷） */
export interface HarnessApprovalEvent {
  agentId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 请求时间戳 */
  ts: string;
}

/**
 * 被托管 agent 的最小契约面——wrap 不关心 LangGraph 内部结构，
 * 只要求「可 invoke」。createReactAgent 产物与纯 StateGraph 编译产物均满足。
 */
export interface WrappableAgent {
  invoke(input: unknown, options?: Record<string, unknown>): Promise<unknown>;
  [key: string]: unknown;
}

/**
 * wrap 产物——被托管 agent + 治理元数据。
 * 保持 WrappableAgent 可 invoke 性（透传），附加治理面。
 */
export interface WrappedAgent {
  /** 原 agent（invoke 透传——工具调用已在内部被拦截审计） */
  agent: WrappableAgent;
  /** 签发的身份码 */
  identity: AgentIdentity;
  /** 实际生效的审批模式 */
  approval: ApprovalMode;
  /** trace 开关 */
  trace: boolean;
  /** 治理统计（运行时累计） */
  stats: { toolCalls: number; intercepted: number; approvals: number };
  /** registry 注册句柄（被托管 agent 可被 dag-runner 发现） */
  registryName: string;
}

/** 副作用类工具名前缀/全名——require-approval/deny 模式的拦截判据 */
export const SIDE_EFFECT_TOOL_PATTERNS: readonly string[] = [
  'write',
  'delete',
  'rm',
  'edit',
  'git',
  'push',
  'commit',
  'exec',
  'bash',
  'shell',
  'run',
] as const;

/** 判定工具名是否为副作用类（保守匹配：前缀或全名包含即算） */
export function isSideEffectTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return SIDE_EFFECT_TOOL_PATTERNS.some((p) => lower.includes(p));
}
