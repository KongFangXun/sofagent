// ============================================================
// node-executor.ts · 企业节点执行器（v1.5.3 功能④ 激活链 Phase 3 前半）
//
// 包装 createReactAgent + 企业 Agent 配置，为 dag-runner 的
// run-enterprise 模式提供逐节点执行能力。
//
// 职责：
//   1. 读取企业 Agent 定义（SubAgentDefinition from registry）
//   2. 构建 constrained system prompt（加载链四层）
//   3. 注入 ENGINEER_TOOLS + 消息注入器
//   4. 执行节点任务 → 收集输出 → 写审计日志
//   5. HITL 标记检测（fail-fast：遇到 hitl=true 的节点报错退出）
// ============================================================

import { join } from 'path';
import { resolveAgent, type SubAgentConfig } from './workflow-parser';
import type { WorkflowNode } from './workflow-parser';
import { listAgents, type SubAgentDefinition } from './registry';
import { writeEntity } from './entity-store';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 节点执行上下文 */
export interface NodeExecutionContext {
  /** 企业 Agent 名称（= workflow 节点的 agent 字段） */
  agentName: string;
  /** v1.2.6 workflow-parser 产出的 SubAgentConfig */
  agentConfig: SubAgentConfig;
  /** workflow 节点定义 */
  node: WorkflowNode;
  /** .sofagent 数据目录 */
  dataDir: string;
  /** 项目根目录 */
  projectRoot: string;
}

/** 节点执行结果 */
export interface NodeExecutionResult {
  /** 执行的 Agent 名称 */
  agentName: string;
  /** Agent 输出文本 */
  output: string;
  /** 该节点是否成功 */
  success: boolean;
  /**
   * v1.4.5 T6：是否降级执行（LLM 不可用时的模拟输出）。
   *
   * 原问题：降级路径返回 success:true 但无 degraded 字段——上层把
   * 「LLM 缺席的模拟成功」当真成功消费，节点级静默降级不可观测。
   * 显式声明后调用方可区分真成功 vs 降级成功（dag-runner / CLI 打 WARN）。
   */
  degraded: boolean;
  /** 错误信息（失败时） */
  error?: string;
  /** 写入的 entity ID 列表（审计用） */
  entitiesWritten: string[];
  /** 执行耗时 ms */
  durationMs: number;
}

// ────────────────────────────────────────────────────────────
// HITL 检查（v1.2.9：fail-fast，不静默跳过）
// ────────────────────────────────────────────────────────────

/**
 * 检查节点是否标记为 HITL。
 *
 * v1.2.9：HITL 节点由 hitl-handler.ts 处理（中断 → 审批 → 执行）。
 * 本函数仅做检测——如果调用方未接入 hitl-handler，仍 fail-fast。
 * 如果调用方已接入 hitl-handler，应在 executeNode 前调用 hitl.before()，
 * 并在通过后传入 hitlCleared=true 跳过此检查。
 *
 * @throws Error 如果节点标记了 HITL 且未传入 hitlCleared
 */
export function checkHITL(node: WorkflowNode, dataDir: string, hitlCleared = false): void {
  if (node.agent !== 'enterprise') return;
  if (hitlCleared) return; // v1.2.9：hitl-handler 已审批，跳过 fail-fast

  const agents = listAgents(dataDir);
  const def = agents.find((a) => a.name === node.id);
  if (def?.hitl) {
    throw new Error(
      `[node-executor] 节点 "${node.id}" 标记了 HITL（Human-in-the-Loop）。` +
      `请使用 hitl-handler.ts 处理 HITL 节点（v1.2.9 已支持）。` +
      `或在调用 executeNode 前先调用 hitl.before(node) 获取审批。`,
    );
  }
}

// ────────────────────────────────────────────────────────────
// 企业 Agent 解析
// ────────────────────────────────────────────────────────────

/**
 * 解析企业 Agent 定义。
 *
 * @param node workflow 节点
 * @param dataDir .sofagent 数据目录
 * @returns SubAgentDefinition 或 throw（未注册时）
 */
export function resolveEnterpriseAgent(
  node: WorkflowNode,
  dataDir: string,
): SubAgentDefinition {
  // 先检查 HITL（fail-fast）
  checkHITL(node, dataDir);

  const { definition } = resolveAgent(node, dataDir);
  return definition;
}

// ────────────────────────────────────────────────────────────
// 节点执行（核心）
// ────────────────────────────────────────────────────────────

/**
 * 执行单个企业 Agent 节点。
 *
 * 使用 createReactAgent 包装企业 Agent，注入约束 system prompt + ENGINEER_TOOLS。
 * 执行后自动写审计日志（通过 writeEntity 写入 execution-log entity）。
 *
 * @param ctx 节点执行上下文
 * @param deps 可注入依赖（测试 mock）
 * @returns NodeExecutionResult
 */
export async function executeNode(
  ctx: NodeExecutionContext,
  deps?: {
    createReactAgent?: (params: { llm: unknown; tools: unknown[]; prompt: string }) => Promise<{
      invoke: (input: { messages: Array<{ role: string; content: string }> }, config?: { recursionLimit?: number }) => Promise<unknown>;
    }>;
    resolveModel?: () => Promise<unknown | null>;
    buildSystemPrompt?: (projectRoot: string, agentConfig: SubAgentConfig) => string;
    /** v1.2.9：hitl-handler 已审批后传入 true，跳过 fail-fast */
    hitlCleared?: boolean;
  },
): Promise<NodeExecutionResult> {
  const startTime = Date.now();
  const entitiesWritten: string[] = [];

  // 1. 检查 HITL（fail-fast，除非 hitl-handler 已审批）
  try {
    checkHITL(ctx.node, ctx.dataDir, deps?.hitlCleared);
  } catch (err) {
    return {
      agentName: ctx.agentName,
      output: '',
      success: false,
      degraded: false,
      error: (err as Error).message,
      entitiesWritten,
      durationMs: Date.now() - startTime,
    };
  }

  // 2. 加载依赖
  let createReactAgent = deps?.createReactAgent;
  if (!createReactAgent) {
    try {
      // v1.3.6 交付⑤：调用点迁移到 ExecutionBackend——经 resolveAgentFactory
      // 解析（LangGraph 直连优先零行为变化；不可用时 DSH 后端 invoke 兼容代理）
      const { resolveAgentFactory } = await import('./agent-factory.js');
      const resolved = await resolveAgentFactory();
      createReactAgent = resolved.factory as unknown as NonNullable<typeof deps>['createReactAgent'];
    } catch {
      // 模块不可用——降级为模拟执行
    }
  }

  let buildPrompt = deps?.buildSystemPrompt;
  if (!buildPrompt) {
    try {
      const harness = (await import('@sofagent/inject')) as { buildConstrainedSystemPrompt?: unknown };
      const harnessFn = harness.buildConstrainedSystemPrompt as ((projectRoot: string) => string) | null;
      if (harnessFn) {
        buildPrompt = (projectRoot: string, agentConfig: SubAgentConfig) => {
          const constrained = harnessFn!(projectRoot);
          return constrained ? `${constrained}\n\n${agentConfig.systemPrompt}` : agentConfig.systemPrompt;
        };
      }
    } catch {
      // harness 不可用——纯 agentConfig.systemPrompt
    }
  }
  if (!buildPrompt) {
    buildPrompt = (_projectRoot: string, agentConfig: SubAgentConfig) => agentConfig.systemPrompt;
  }

  let resolveModel = deps?.resolveModel;
  if (!resolveModel) {
    try {
      const { resolveLLMModel } = await import('./loop/nodes');
      resolveModel = async () => {
        const resolved = await resolveLLMModel(null);
        return resolved?.model ?? null;
      };
    } catch {
      // 模块不可用
    }
  }

  // 4. 加载工具
  let tools: unknown[] = [];
  try {
    const { convertToLangGraphTools, ENGINEER_TOOLS, createToolGate, wrapToolsWithGate } = await import('./tools');
    // v1.3.0 (交付 1)：企业 Agent 路径补 gate 包裹——与 LOOP 路径 nodes.ts 的
    // gateToolsForRole 接线方式对齐，工具调用经 tool-gate 规则拦截 + 审计留证。
    const gate = createToolGate({
      agentName: ctx.agentName,
      taskDesc: ctx.node.task?.slice(0, 500) ?? '',
      cwd: ctx.projectRoot,
    });
    const gatedTools = wrapToolsWithGate(ENGINEER_TOOLS, gate);
    // ── v1.5.4 章三/章七：沙箱 HTTP 出口凭证注入接线（生产路径可达）──
    // 🔴 缺省关（SOFAGENT_SANDBOX_EGRESS ≠ '1'）⇒ 不装配沙箱出口，tools 与接线前
    //    逐字一致（零行为变化）。开启时：装配沙箱出口句柄（**构造 Vault 含轮换器**）
    //    + 经 harness-sdk `wrapTools` 在出口路径注入凭证（层④）。凭证签发处
    //    （issueCredential）产出范围声明并交章七对账——真实 secret 只进 Vault 出站副本。
    let egressTools = gatedTools;
    if (process.env.SOFAGENT_SANDBOX_EGRESS === '1') {
      const { wrapTools, createSandboxHandle } = await import('./harness-sdk');
      // ── v1.5.5 P1-1：对账开闸走**既有配置面**（config.yml `audit.credentialReconcile`）──
      // 🔴 缺省关（配置缺该键 / false）⇒ credentialReconcile=false，保持 L1 语义（零判定、
      //    零记录，行为与接线前一致）。配置不可读（YAML 损坏 / 验签失败等）亦回退 false
      //    —— fail-safe：不因配置缺失把「缺省关」的出口面翻成开档。
      // ⚠️ 不新增独立开关入口（对齐 harness-sdk「既有 options 面」/ mandate-gate 的 enabled
      //    契约）：此处只把既有配置值透传给 createSandboxHandle，读配置仅在出口装配时发生。
      let credentialReconcile = false;
      try {
        const { loadConfig } = await import('@sofagent/core');
        credentialReconcile = loadConfig(ctx.projectRoot).credentialReconcile === true;
      } catch {
        credentialReconcile = false;
      }
      // 装配沙箱出口：Vault（含轮换器）在此构造（createSandboxHandle 内 createCredentialVault
      // / createCredentialRotator）——沙箱 HTTP 出口凭证注入的基座。
      const sandboxHandle = createSandboxHandle({
        dataDir: ctx.dataDir,
        sandbox: true,
        credentialReconcile,
      });
      // 出口凭证来自环境变量（运行时读取——非硬编码；A2 env 引用豁免形态）。
      if (process.env.SOFAGENT_EGRESS_SECRET) {
        // 凭证签发处：登记节点作用域凭证 → 即产出范围声明并交章七台账级对账。
        const virtualKey = `vk-${ctx.agentName}:${ctx.node.id}`;
        sandboxHandle.issueCredential({
          id: `sandbox-egress:${ctx.node.id}`,
          virtualKey,
          mandateId: ctx.agentName,
          scope: { tools: [ctx.agentName] },
          inject: { header: 'Authorization', scheme: 'Bearer' },
          secret: process.env.SOFAGENT_EGRESS_SECRET ?? '',
        });
        egressTools = wrapTools(gatedTools, {
          sandbox: true,
          sandboxHandle,
          credentialVault: sandboxHandle.credentialVault,
          credentialVirtualKey: virtualKey,
        });
      } else {
        // 未配置出口凭证——出口仍装配（白名单 / vfs 生效），凭证明文不入 Vault
        egressTools = wrapTools(gatedTools, { sandbox: true, sandboxHandle });
      }
    }
    tools = convertToLangGraphTools(egressTools);
  } catch {
    // 工具不可用——空数组
  }

  // 5. 构建 system prompt
  const systemPrompt = buildPrompt(ctx.projectRoot, ctx.agentConfig);

  // 6. 执行
  try {
    const model = resolveModel ? await resolveModel() : null;
    if (!model || !createReactAgent) {
      // LLM 或 createReactAgent 不可用——降级为模拟输出
      const output = `[node-executor] Agent "${ctx.agentName}" 降级执行（LLM 不可用）: ${ctx.node.task}`;
      try {
        writeEntity(ctx.dataDir, {
          name: `execution-log.${ctx.node.id}.${Date.now()}`,
          type: 'execution-log',
          description: `Agent ${ctx.agentName} node ${ctx.node.id}`,
          properties: {
            agent: ctx.agentName,
            node: ctx.node.id,
            output,
            degraded: true,
            timestamp: new Date().toISOString(),
          },
        });
        entitiesWritten.push(`execution-log.${ctx.node.id}`);
      } catch {
        // entity 写入失败不阻塞
      }
      // v1.4.5 T6：降级显式声明——success:true + degraded:true（上层可观测）
      return {
        agentName: ctx.agentName,
        output,
        success: true,
        degraded: true,
        entitiesWritten,
        durationMs: Date.now() - startTime,
      };
    }
    const agent = await createReactAgent({ llm: model, tools, prompt: systemPrompt });
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: ctx.node.task }] },
      { recursionLimit: 50 },
    );

    // 提取输出文本
    const output = extractText(result);

    // 写审计 entity
    try {
      writeEntity(ctx.dataDir, {
        name: `execution-log.${ctx.node.id}.${Date.now()}`,
        type: 'execution-log',
        description: `Agent ${ctx.agentName} node ${ctx.node.id}`,
        properties: {
          agent: ctx.agentName,
          node: ctx.node.id,
          output: output.slice(0, 500),
          success: true,
          timestamp: new Date().toISOString(),
        },
      });
      entitiesWritten.push(`execution-log.${ctx.node.id}`);
    } catch {
      // entity 写入失败不阻塞
    }

    return {
      agentName: ctx.agentName,
      output,
      success: true,
      degraded: false,
      entitiesWritten,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      agentName: ctx.agentName,
      output: '',
      success: false,
      degraded: false,
      error: err instanceof Error ? err.message : String(err),
      entitiesWritten,
      durationMs: Date.now() - startTime,
    };
  }
}

// ────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────

/** 从 createReactAgent 结果中提取文本（兼容多种返回格式） */
function extractText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.messages)) {
      for (let i = obj.messages.length - 1; i >= 0; i--) {
        const msg = obj.messages[i] as Record<string, unknown>;
        if ((msg.role === 'assistant' || msg.type === 'ai') && typeof msg.content === 'string') {
          return msg.content;
        }
      }
    }
  }
  return String(result ?? '');
}
