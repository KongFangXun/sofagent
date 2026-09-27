// ============================================================
// harness-sdk/types.ts · SubAgent 托管 SDK 类型定义（v1.3.7 交付 ③ · v1.3.8 交付⑥ 沙箱启用）
// ============================================================
//
// 一行包装，获得约束层全部能力：
//   const agent = harness.wrap(myLangGraphAgent, { approval, identity, sandbox, trace });
//
// 双形态兼容：① createReactAgent（middleware 链路）② 纯 StateGraph（tools 节点注入）
// ============================================================
import type { AgentIdentity } from '@sofagent/core';
import type { ToolGate, ToolId, ToolRisk } from '../sandbox/tool-gate';
import type { FilesystemBackend } from '../sandbox/filesystem-backend';
import type { NetworkGateway } from '../sandbox/network-gateway';
import type { CredentialVault, CredentialStoreInput, CredentialView } from '../vault/credential-vault';
import type { CredentialRotator } from '../vault/credential-rotation';

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
   * 沙箱开关（v1.3.7 组件 · v1.3.8 交付⑥ 已启用）。
   * true 时接入沙箱三层（v1.3.7 组件，wrap 侧挂载）：
   *   ① 工具调用经 tool-gate 前置判定（按唯一 ID，未注册 fail-closed deny）
   *   ② 文件写经 filesystem-backend 虚拟层（未审批不落盘）
   *   ③ 网络出站经 network-gateway 白名单（invoke 期间 monkey-patch net/dns）
   * 与 approval 组合可用（sandbox:true + require-approval——沙箱内副作用工具仍挂人审）。
   */
  sandbox?: boolean;
  /**
   * 外部签发的沙箱会话句柄（可选——不传时 sandbox:true 自动创建）。
   * 宿主先 createSandboxHandle() 预注册高危工具/白名单再传入，wrap 与 wrapTools 共享。
   */
  sandboxHandle?: SandboxHandle;
  /** 沙箱网络白名单域名（sandbox:true 生效；缺省 ['.sofagent.local', 'localhost']） */
  sandboxAllowHosts?: string[];
  /** 沙箱工具门风险策略覆盖（risk → allow/deny/human-approval；缺省 high→human-approval） */
  sandboxRiskPolicy?: Partial<Record<ToolRisk, 'allow' | 'deny' | 'human-approval'>>;
  /**
   * 凭证隔离 Vault（v1.5.4 章三 · 可选）。
   * 传入后沙箱 HTTP 出口（fetch/http/request/curl 类工具）在**出站前**经 Vault
   * 动态注入凭证请求头——真实凭证只写入**出站副本**，Agent 原入参（含审计事件
   * 载荷）/ 日志零明文。不传则行为与今日一致（不注入）。
   */
  credentialVault?: CredentialVault;
  /**
   * 本 Agent 沙箱会话持有的虚拟 key（`vk-` 前缀 · 可选）。
   * 身份的**数据面事实**——仅作凭证查找键；控制面判定只认数据面（登记 / 吊销 /
   * 范围），不读任何界面 / 配置开关（v1.5.4 章三设计约束：身份与能力两职拆开）。
   */
  credentialVirtualKey?: string;
  /**
   * 凭证对账面开关（v1.5.4 章七 · 可选，缺省 false = 对账面关 L1）。
   * 凭证签发处（`SandboxHandle.issueCredential`）产出范围声明后是否交章七台账级对账——
   * 关档时零判定、零记录（行为与今日一致）；开档则结论挂 decision-log HMAC 链。
   * ⚠️ 经**既有 options 面**传入，不新增独立开关入口（对齐 mandate-gate 的 enabled 契约）。
   */
  credentialReconcile?: boolean;
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
  /** 沙箱是否启用（v1.3.8 交付⑥——options.sandbox === true 时为 true） */
  sandbox: boolean;
  /** 治理统计（运行时累计） */
  stats: { toolCalls: number; intercepted: number; approvals: number };
  /** registry 注册句柄（被托管 agent 可被 dag-runner 发现） */
  registryName: string;
  /** 沙箱会话句柄（sandbox:true 时存在——审批合并/工具放行/统计从这里操作） */
  sandboxHandle?: SandboxHandle;
}

/**
 * 沙箱会话句柄（v1.3.8 交付⑥）——wrap/wrapTools 共享的沙箱操作面。
 * 三层组件（gate/vfs/net）来自 v1.3.7 sandbox/ 目录；句柄补 wrap 侧注册表与人审入口。
 */
export interface SandboxHandle {
  /** 工具门（v1.3.7 tool-gate——前置 allow/deny/human-approval 判定） */
  gate: ToolGate;
  /** 虚拟文件系统（v1.3.7 filesystem-backend——写入先进虚拟层，审批后落盘） */
  vfs: FilesystemBackend;
  /** 网络网关（v1.3.7 network-gateway——出站白名单判定） */
  net: NetworkGateway;
  /** 注册工具进 gate（返回唯一 ID——wrapTools 自动调用；宿主可预注册高危工具） */
  registerTool(name: string, risk: ToolRisk): ToolId;
  /** 查工具 ID（未注册返回 undefined） */
  getToolId(name: string): ToolId | undefined;
  /** 人审通过——该工具下一次调用放行一次（tool-gate 一次性审批） */
  approveTool(name: string): void;
  /** 人审通过——虚拟写入原子合并到物理磁盘 */
  approveWrite(targetPath: string): { ok: boolean; reason?: string };
  /** 安装进程级网络守卫（net/dns monkey-patch）——返回卸载函数（invoke 代理自动装卸） */
  installNetGuard(): () => void;
  /** 拆除——pending 写入全 deny + 清空工具注册（SubAgent 会话结束） */
  teardown(): void;
  /** 沙箱判定统计（denied / virtualWrites / netDenied） */
  stats(): { denied: number; virtualWrites: number; netDenied: number };
  /**
   * 凭证隔离 Vault（v1.5.4 章三）——沙箱 HTTP 出口凭证注入器的来源。
   * `createSandboxHandle` 装配沙箱出口时构造（宿主经 `options.credentialVault`
   * 注入则复用宿主实例）。沙箱层④（wrapTools 出站注入）经它取真实凭证。
   */
  credentialVault: CredentialVault;
  /**
   * 凭证轮换 / 吊销器（v1.5.4 章三）——定时/事件轮换 + 泄露响应。
   * 与 `credentialVault` 同批构造（同一数据面），随会话生命周期存续。
   */
  credentialRotator: CredentialRotator;
  /**
   * 登记一条凭证（**凭证签发处**）——真实 secret 只进 Vault，登录后即产出范围声明
   * 并交章七台账级对账（结论挂 decision-log HMAC 链，kind=CREDENTIAL_RECONCILE）。
   *
   * @returns 脱敏视图（零 secret）
   */
  issueCredential(input: CredentialStoreInput): CredentialView;
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
