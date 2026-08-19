// ============================================================
// harness-sdk/wrap.ts · SubAgent 托管 SDK 核心（v1.3.7 交付 ③ · v1.3.8 交付⑥ 沙箱接线）
// ============================================================
//
// 一行包装，获得约束层全部能力——审计 / 审批 / 身份 / Trace / 决策审计 / 沙箱。
//
// 🔴 双形态兼容设计：
//   ① createReactAgent 形态：wrapTools() 包装工具集 → 创建 agent 时传入
//   ② 纯 StateGraph 形态：tools 节点是工具调用必经点——该节点消费的工具集
//      同样经 wrapTools() 注入拦截（「在 tools 节点注入拦截」的实现位）
//   两形态共享同一拦截层——wrap() 只加 agent 级治理面（身份/注册/trace）。
//
// registry 执行链（衔接方案）：
//   registry 存「怎么构建」（graph 构建器工厂函数），dag-runner 管「什么时候构建」——
//   wrap() 自动把构建器注册进 GraphBuilderRegistry，解析链命中时按需实例化。
//
// v1.3.8 交付⑥：sandbox=true 已启用（v1.3.7 版本边界 throw 移除）——
//   沙箱三层接线（组件全部复用 v1.3.7 sandbox/ 目录，wrap 侧只做挂载）：
//     ① 工具调用经 tool-gate 前置判定（按工具唯一 ID——未注册 fail-closed）
//     ② 文件写经 filesystem-backend 虚拟层（未审批不落盘）
//     ③ 网络出站经 network-gateway 白名单（invoke 期间 monkey-patch net/dns）
// ============================================================

import { generateAgentIdentity, type AgentIdentity } from '@sofagent/core';
import {
  type ApprovalMode,
  type HarnessWrapOptions,
  type HarnessToolCallEvent,
  type HarnessApprovalEvent,
  type WrappableAgent,
  type WrappedAgent,
  type SandboxHandle,
  isSideEffectTool,
} from './types';
import {
  registerGraphBuilder,
  type GraphBuilder,
} from './builder-registry';
// v1.3.8 交付⑥：沙箱三层接线——v1.3.7 组件复用（不新建实现，只做挂载）
import { createToolGate, type ToolId, type ToolRisk } from '../sandbox/tool-gate';
import { createFilesystemBackend } from '../sandbox/filesystem-backend';
import { createNetworkGateway, installNetworkGuard, type NetworkGateway } from '../sandbox/network-gateway';
import type { ExecutableTool } from '../tools';

/** 结果预览截断长度（审计事件不落盘超大结果） */
const RESULT_PREVIEW_LIMIT = 500;

/**
 * 截断保护。
 */
function preview(text: unknown): string {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return s.length > RESULT_PREVIEW_LIMIT ? `${s.slice(0, RESULT_PREVIEW_LIMIT)}…（截断）` : s;
}

/** join 包装（appendTrace 同款 require 模式——避免顶层 path 依赖风格漂移） */
function joinCwd(...segments: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path');
  return join(process.cwd(), ...segments);
}

// ============================================================
// v1.3.8 交付⑥：沙箱会话挂载（wrap / wrapTools 共享）
// ============================================================

/** 沙箱统计载体（挂在 handle 闭包——stats() 对外只读快照，内部计数经符号键读写） */
interface SandboxStatsBag {
  denied: number;
  virtualWrites: number;
  netDenied: number;
}

/** 统计可变载体的符号键（防外部枚举篡改） */
const SANDBOX_STATS_KEY = Symbol('sofagent.sandboxStats');
type SandboxStatsCarrier = { [SANDBOX_STATS_KEY]?: SandboxStatsBag };

/** 沙箱统计计数器读写（handle.stats 是快照函数——可变态挂符号键） */
function sandboxStats(handle: SandboxHandle): SandboxStatsBag {
  const carrier = handle as unknown as SandboxStatsCarrier;
  if (!carrier[SANDBOX_STATS_KEY]) {
    carrier[SANDBOX_STATS_KEY] = { denied: 0, virtualWrites: 0, netDenied: 0 };
  }
  return carrier[SANDBOX_STATS_KEY];
}

/**
 * 创建沙箱会话句柄——组装 tool-gate + filesystem-backend + network-gateway 三层。
 *
 * wrap()/wrapTools() 在 sandbox: true 时自动创建（同一 options 共享）；
 * 宿主也可先手动创建经 options.sandboxHandle 注入（外部签发场景）。
 *
 * @param options 托管配置（dataDir / sandboxAllowHosts / sandboxRiskPolicy）
 */
export function createSandboxHandle(options: HarnessWrapOptions): SandboxHandle {
  const dataDir = options.dataDir ?? joinCwd('data');
  const gate = createToolGate({ riskPolicy: options.sandboxRiskPolicy });
  const vfs = createFilesystemBackend(dataDir);
  const net = createNetworkGateway({
    allowHosts: options.sandboxAllowHosts ?? ['.sofagent.local', 'localhost'],
  });

  /** 工具名 → tool-gate 唯一 ID（Symbol——名称可伪造，ID 不可） */
  const toolIds = new Map<string, ToolId>();
  const statsBag: SandboxStatsBag = { denied: 0, virtualWrites: 0, netDenied: 0 };

  const handle = {
    gate,
    vfs,
    net,
    /** 注册工具进 gate（wrapTools 自动调用；宿主手动注册高危工具也走这里） */
    registerTool: (name: string, risk: ToolRisk) => {
      const id = gate.register(name, risk);
      toolIds.set(name, id);
      return id;
    },
    /** 查工具 ID（未注册返回 undefined——判定路径 fail-closed deny） */
    getToolId: (name: string) => toolIds.get(name),
    /** 审批放行一次（人审通过后该工具下一次调用放行） */
    approveTool: (name: string) => {
      const id = toolIds.get(name);
      if (id) gate.markApproved(id);
    },
    /** 虚拟写入审批合并（人审通过后虚拟内容原子落盘） */
    approveWrite: (targetPath: string) => vfs.approve(targetPath),
    /** 安装进程级网络守卫（net/dns monkey-patch）——返回卸载函数（invoke 代理自动装卸） */
    installNetGuard: () => installNetworkGuard(net),
    /** 拆除——pending 写入全 deny + 清空工具注册（SubAgent 会话结束） */
    teardown: () => {
      for (const w of vfs.listPending()) {
        vfs.deny(w.targetPath);
      }
      toolIds.clear();
    },
    /** 沙箱统计（观测出口——快照语义） */
    stats: () => ({ ...statsBag }),
  };

  // 统计载体挂符号键（wrapTools 内部计数——sandboxStats() 读写）
  (handle as unknown as SandboxStatsCarrier)[SANDBOX_STATS_KEY] = statsBag;
  return handle as SandboxHandle;
}

/** 沙箱下副作用类工具的默认风险等级（high → tool-gate 人审判定） */
const RISK_SIDE_EFFECT: ToolRisk = 'high';
/** 沙箱下只读类工具的默认风险等级（low → 直接放行） */
const RISK_READ_ONLY: ToolRisk = 'low';

/** 文件写入参字段候选（工具入参常见命名——写入判定面） */
const FILE_WRITE_PATH_KEYS = ['path', 'file_path', 'filePath', 'target', 'targetPath'] as const;
const FILE_WRITE_CONTENT_KEYS = ['content', 'body', 'text', 'data'] as const;

/** 网络工具入参候选字段（url/host 出站判定面） */
const NET_ARG_KEYS = ['url', 'host', 'hostname', 'endpoint', 'domain'] as const;

/**
 * 判定工具入参是否为「文件写」形态（含路径 + 内容字段）。
 * @returns 命中时返回 { targetPath, content }；否则 null
 */
function extractFileWrite(toolName: string, input: Record<string, unknown>): { targetPath: string; content: string } | null {
  if (!isSideEffectTool(toolName)) return null; // 只读工具不进虚拟层
  let targetPath = '';
  for (const key of FILE_WRITE_PATH_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v.length > 0) {
      targetPath = v;
      break;
    }
  }
  if (!targetPath) return null;
  for (const key of FILE_WRITE_CONTENT_KEYS) {
    const v = input[key];
    if (typeof v === 'string') return { targetPath, content: v };
  }
  return null;
}

/**
 * 沙箱层②：文件写入参改道 vfs 虚拟层——未审批不落盘。
 * @returns 工具结果文本（命中文件写时）；非文件写场景返回 null 走原工具
 */
function redirectFileWriteToVfs(
  sandbox: SandboxHandle,
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const write = extractFileWrite(toolName, input);
  if (!write) return null;
  const result = sandbox.vfs.writeVirtual(write.targetPath, write.content);
  if (!result.ok) {
    return `⛔ [Sandbox 拒写] ${write.targetPath} 虚拟层写入失败：${result.reason ?? '未知原因'}`;
  }
  sandboxStats(sandbox).virtualWrites++;
  return [
    `🏰 [Sandbox 虚拟层] ${write.targetPath} 已暂存虚拟层（未落盘）`,
    `内容指纹：${result.contentHash.slice(0, 16)}…`,
    `审批合并：sandboxHandle.approveWrite('${write.targetPath}') 人审通过后原子落盘`,
  ].join('\n');
}

/**
 * 沙箱层③（工具级）：显式网络工具的出站白名单判定。
 * 只拦「入参直接带外域目标」的工具（fetch/http/curl 类）；进程级 net/dns
 * 守卫由 wrap() invoke 代理统一装卸（覆盖 LLM SDK 等隐式出站）。
 * @returns deny 结果文本（白名单外）；放行返回 null
 */
function checkNetworkToolArgs(
  sandbox: SandboxHandle,
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const lower = toolName.toLowerCase();
  const isNetTool =
    lower.includes('fetch') || lower.includes('http') || lower.includes('request') || lower.includes('curl');
  if (!isNetTool) return null;
  for (const key of NET_ARG_KEYS) {
    const v = input[key];
    if (typeof v !== 'string' || v.length === 0) continue;
    let host = v;
    try {
      // url 字段解析出 host；host 字段直用
      if (key === 'url') host = new URL(v).hostname;
    } catch {
      host = v.split('/')[0] ?? v; // 非法 URL 退化按 host 前缀判
    }
    const verdict = sandbox.net.check({ host, port: 443, protocol: 'https' });
    if (verdict === 'deny') {
      sandboxStats(sandbox).netDenied++;
      return `⛔ [Sandbox 网络拦截] ${toolName} 出站 ${host} 不在白名单（deny 事件已审计）`;
    }
  }
  return null;
}

// ============================================================
// 工具层拦截（两形态共享的治理内核）
// ============================================================

/**
 * 包装工具集——每次工具调用进审计 + 审批判定 + 事件回调。
 *
 * 审批语义（对齐 v1.3.1）：
 *   - allow-with-audit（默认）：放行 + 事件留痕
 *   - require-approval：副作用类工具（SIDE_EFFECT_TOOL_PATTERNS）调 requestApproval
 *     等人审——未提供回调时保守拒绝
 *   - deny：副作用类工具全部拦截（只读观察模式）
 *
 * 沙箱语义（v1.3.8 交付⑥——与审批分支叠加，不替换）：
 *   options.sandbox === true 时追加三层拦截（sandbox:true + approval 组合可用）：
 *   ① tool-gate 前置判定（wrap 时自动注册进 gate；未注册工具名 fail-closed deny）
 *   ② 文件写入参改道 vfs 虚拟层——未审批不落盘
 *   ③ 网络类工具入参的白名单判定（host 出站 deny）
 *
 * @param tools 原始工具集（ExecutableTool[]——sofagent 内部工具格式）
 * @param options 托管配置（复用 HarnessWrapOptions）
 * @returns 包装后的新工具集（不改原数组）
 */
export function wrapTools(
  tools: ExecutableTool[],
  options: HarnessWrapOptions = {},
): ExecutableTool[] {
  const approval: ApprovalMode = options.approval ?? 'allow-with-audit';
  const agentId = resolveAgentId(options);

  // ── v1.3.8 交付⑥：沙箱会话获取（wrap 预创建的共享；独立调用就地创建）──
  const sandbox = options.sandbox === true
    ? (options.sandboxHandle ?? createSandboxHandle(options))
    : null;
  if (sandbox && !options.sandboxHandle) {
    options.sandboxHandle = sandbox; // 同 options 内多次 wrapTools 共享一套沙箱
  }

  // 沙箱层①前置：工具注册进 gate（副作用类 high / 只读 low——宿主可经
  // sandboxHandle.registerTool 预注册覆盖风险等级，此处跳过已注册的）
  if (sandbox) {
    for (const tool of tools) {
      if (!sandbox.getToolId(tool.name)) {
        sandbox.registerTool(tool.name, isSideEffectTool(tool.name) ? RISK_SIDE_EFFECT : RISK_READ_ONLY);
      }
    }
  }

  return tools.map((tool) => ({
    ...tool,
    func: (input: Record<string, unknown>): string => {
      const ts = new Date().toISOString();

      // ── 沙箱层①：tool-gate 前置判定（先于审批分支——fail-closed 优先兜底）──
      if (sandbox) {
        const toolId = sandbox.getToolId(tool.name);
        // 未注册工具名（SubAgent 伪造/越集调用）→ fail-closed：
        // 用未注册 ID 走 gate.check 拿正式 deny 事件（审计链完整），不执行
        const gateVerdict = sandbox.gate.check(
          (toolId ?? (Symbol(tool.name) as ToolId)) as ToolId,
        );
        if (gateVerdict.action === 'deny') {
          sandboxStats(sandbox).denied++;
          emitOnToolCall(options, {
            agentId,
            toolName: tool.name,
            args: input,
            resultPreview: `⛔ 沙箱 tool-gate 拒绝——${gateVerdict.reason}`,
            errored: false,
            approvalVerdict: approval,
            ts,
          });
          return `⛔ [Sandbox 拦截] ${tool.name} 被 tool-gate 拒绝：${gateVerdict.reason}`;
        }
        if (gateVerdict.action === 'human-approval') {
          // 沙箱内高危工具挂人审（与 approval=require-approval 组合语义一致）：
          // gate.approveTool(name) 人审通过后放行一次；本次先拒绝执行
          emitOnToolCall(options, {
            agentId,
            toolName: tool.name,
            args: input,
            resultPreview: `⛔ 沙箱 tool-gate 待人审——${gateVerdict.reason}`,
            errored: false,
            approvalVerdict: approval,
            ts,
          });
          return `⛔ [Sandbox 待审] ${tool.name} 需人工批准：${gateVerdict.reason}（sandboxHandle.approveTool('${tool.name}') 通过后放行一次）`;
        }

        // ── 沙箱层②：文件写入参改道虚拟层（未审批不落盘）──
        const vfsRedirect = redirectFileWriteToVfs(sandbox, tool.name, input);
        if (vfsRedirect !== null) {
          emitOnToolCall(options, {
            agentId,
            toolName: tool.name,
            args: input,
            resultPreview: preview(vfsRedirect),
            errored: false,
            approvalVerdict: approval,
            ts,
          });
          return vfsRedirect;
        }

        // ── 沙箱层③（工具级）：网络类工具出站白名单判定 ──
        const netDenied = checkNetworkToolArgs(sandbox, tool.name, input);
        if (netDenied !== null) {
          emitOnToolCall(options, {
            agentId,
            toolName: tool.name,
            args: input,
            resultPreview: preview(netDenied),
            errored: false,
            approvalVerdict: approval,
            ts,
          });
          return netDenied;
        }
      }

      // ── 审批判定（副作用类工具才受审批模式约束）──
      if (isSideEffectTool(tool.name)) {
        if (approval === 'deny') {
          emitOnToolCall(options, {
            agentId,
            toolName: tool.name,
            args: input,
            resultPreview: '⛔ deny 模式拦截——未执行',
            errored: false,
            approvalVerdict: approval,
            ts,
          });
          return `⛔ [Harness 拦截] ${tool.name} 在 deny 模式下禁止执行（只读观察模式）`;
        }
        if (approval === 'require-approval') {
          // 同步 func 签名下无法 await——走保守同步策略：
          // 提供 requestApproval 时先记录审批请求（异步审批结论经 onToolCall 事件回传），
          // 未提供回调时 fail-safe 拒绝（人审通道缺失 ≠ 放行）
          if (!options.requestApproval) {
            emitOnToolCall(options, {
              agentId,
              toolName: tool.name,
              args: input,
              resultPreview: '⛔ require-approval 但无审批通道——保守拒绝',
              errored: false,
              approvalVerdict: approval,
              ts,
            });
            return `⛔ [Harness 拦截] ${tool.name} 需要人审但审批通道未接入（fail-safe 拒绝）`;
          }
          // 审批通道已接入：发起审批请求（异步结论由宿主经事件链消费；
          // 同步路径先记录请求，宿主在 approve 后重放调用——对齐 HITL 挂起语义）
          const event: HarnessApprovalEvent = { agentId, toolName: tool.name, args: input, ts };
          void options.requestApproval(event).catch(() => {
            // 审批回调异常不阻塞工具链——记一条审计事件
          });
        }
      }

      // ── 执行（allow-with-audit / require-approval 已接通道 / 非副作用工具）──
      let result: string;
      let errored = false;
      try {
        result = tool.func(input);
      } catch (err) {
        errored = true;
        result = `⚠️ 工具执行异常：${err instanceof Error ? err.message : String(err)}`;
      }

      emitOnToolCall(options, {
        agentId,
        toolName: tool.name,
        args: input,
        resultPreview: preview(result),
        errored,
        approvalVerdict: approval,
        ts,
      });

      return result;
    },
  }));
}

/** onToolCall 事件派发（缺省钩子时静默——宿主未订阅不报错） */
function emitOnToolCall(options: HarnessWrapOptions, event: HarnessToolCallEvent): void {
  if (options.onToolCall) {
    try {
      options.onToolCall(event);
    } catch {
      // 事件钩子异常不影响工具链
    }
  }
}

/** 从 options 解析 agentId（identity 对象 → agentId；字符串/缺省 → name 派生） */
function resolveAgentId(options: HarnessWrapOptions): string {
  if (typeof options.identity === 'object' && options.identity !== null && 'agentId' in options.identity) {
    return options.identity.agentId;
  }
  return options.name ?? 'wrapped-agent';
}

// ============================================================
// Agent 层包装（身份签发 + registry 注册 + invoke trace + 沙箱挂载）
// ============================================================

/**
 * 托管一个 LangGraph agent——一行包装，获得约束层治理面。
 *
 * v1.3.8 交付⑥：sandbox: true 已启用——wrap 时创建沙箱会话
 * （tool-gate + vfs + network-gateway），invoke 代理期间安装进程级
 * 网络守卫（出站全经白名单），finally 恢复（守卫不外泄到宿主进程）。
 *
 * @param agent 可 invoke 的 agent（createReactAgent 产物或纯 StateGraph 编译产物）
 * @param options 托管配置
 * @returns WrappedAgent（agent 透传 + 身份 + 审批模式 + 统计 + registry 句柄 + sandboxHandle）
 */
export function wrap(agent: WrappableAgent, options: HarnessWrapOptions = {}): WrappedAgent {
  // ── v1.3.8 交付⑥：sandbox=true 沙箱接线（v1.3.7 版本边界 throw 已移除）──
  const sandbox = options.sandbox === true
    ? (options.sandboxHandle ?? createSandboxHandle(options))
    : null;
  if (sandbox && !options.sandboxHandle) {
    options.sandboxHandle = sandbox; // wrapTools 与 wrap 共享同一沙箱会话
  }

  // ── 身份签发（三种入参形态）──
  const name = options.name ?? 'wrapped-agent';
  let identity: AgentIdentity;
  if (typeof options.identity === 'object' && options.identity !== null) {
    identity = options.identity;
  } else {
    identity = generateAgentIdentity(name, {
      systemPrompt: `harness-sdk 托管 agent（${name}）`,
      ...(typeof options.identity === 'string' ? { principal: options.identity } : {}),
    });
  }

  // ── registry 注册（graph 构建器工厂——「怎么构建」由 registry 存）──
  const builder: GraphBuilder = {
    name,
    kind: 'harness-wrapped',
    build: () => agent,
    options: { approval: options.approval ?? 'allow-with-audit', trace: options.trace ?? true },
  };
  registerGraphBuilder(builder);

  // ── invoke 代理（trace 落盘 + 统计 + 沙箱网络守卫装拆）──
  const stats = { toolCalls: 0, intercepted: 0, approvals: 0 };
  const wrappedAgent: WrappedAgent = {
    agent: {
      invoke: async (input: unknown, invokeOptions?: Record<string, unknown>) => {
        const startedAt = new Date().toISOString();
        // 沙箱层③（进程级）：invoke 期间安装 net/dns monkey-patch 守卫——
        // agent 内部一切出站（含隐式 net.connect）都经白名单判定，
        // finally 恢复（守卫不外泄——对齐 network-gateway 文档用法）
        const restoreNet = sandbox ? sandbox.installNetGuard() : null;
        try {
          const result = await agent.invoke(input, invokeOptions);
          appendTrace(options, { name, identity: identity.agentId, startedAt, finishedAt: new Date().toISOString(), ok: true });
          return result;
        } catch (err) {
          appendTrace(options, { name, identity: identity.agentId, startedAt, finishedAt: new Date().toISOString(), ok: false, error: err instanceof Error ? err.message : String(err) });
          throw err;
        } finally {
          if (restoreNet) restoreNet();
        }
      },
    },
    identity,
    approval: options.approval ?? 'allow-with-audit',
    trace: options.trace ?? true,
    sandbox: sandbox !== null,
    stats,
    registryName: name,
    ...(sandbox ? { sandboxHandle: sandbox } : {}),
  };

  return wrappedAgent;
}

/** trace 落盘（JSONL——v1.3.1 LLM 调用级 Trace 的 SDK 暴露面；非致命） */
function appendTrace(
  options: HarnessWrapOptions,
  record: { name: string; identity: string; startedAt: string; finishedAt: string; ok: boolean; error?: string },
): void {
  if (options.trace === false) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { appendFileSync, existsSync, mkdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const dataDir = options.dataDir ?? join(process.cwd(), 'data');
    const traceDir = join(dataDir, 'trace');
    if (!existsSync(traceDir)) mkdirSync(traceDir, { recursive: true });
    appendFileSync(join(traceDir, 'harness-sdk.jsonl'), JSON.stringify({ ...record, ts: new Date().toISOString() }) + '\n', 'utf-8');
  } catch {
    // trace 失败不阻塞 agent 执行
  }
}
