// ============================================================
// memory-backend.ts · 外部记忆后端适配器（v1.3.1 交付 10 MA1/MA3/MA6）
//
// Path A：弱依赖外部 MCP connector——不替换 Ledger-Views-Policy，
// 零架构改造。MA1 提供动态工具注册（不污染静态 TOOLS 清单）；
// MA3 提供 sensitivity→ACL 映射 + 代理工具调用；MA6 支持 workbuddy 降级。
//
// ⚠️ 缺省关闭铁律：memory_backends 未配置 / enabled=false / endpoint 不可达
// 均优雅降级（warn + skip），绝不 crash、绝不发起外部请求。
// ============================================================

import { loadConfig, type MemoryBackend } from '@sofagent/core';

// ────────────────────────────────────────────────
// 动态工具注册表（MA1 推荐方案②：不污染静态 TOOLS 清单）
// ────────────────────────────────────────────────

export interface DynamicToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** 工具执行 handler（转发到后端 / 本地降级） */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** 动态工具表——tools/list 时合并到响应，不写入静态 TOOLS */
const dynamicTools = new Map<string, DynamicToolDef>();

/** 注册一个动态工具（幂等——同名覆盖） */
export function registerDynamicTool(def: DynamicToolDef): void {
  dynamicTools.set(def.name, def);
}

/** 获取动态工具清单（tools/list 合并用） */
export function getDynamicTools(): DynamicToolDef[] {
  return [...dynamicTools.values()];
}

/** 按名称查动态工具（tools/call 分发前查） */
export function getDynamicTool(name: string): DynamicToolDef | undefined {
  return dynamicTools.get(name);
}

/** 清空动态工具（测试隔离用） */
export function clearDynamicTools(): void {
  dynamicTools.clear();
}

// ────────────────────────────────────────────────
// MA3：sensitivity → ACL 映射
// ────────────────────────────────────────────────

/**
 * 将 Agent 敏感度映射为后端 ACL。
 *
 * - restricted Agent → restricted（只能拿 restricted 记忆）
 * - internal Agent → team/agent 级（内部可用团队经验）
 * - public → 不走记忆后端（返回 'public' 标记）
 *
 * @param sensitivity Agent 敏感度
 * @param backend 记忆后端配置（含 sensitivity_map）
 * @returns ACL 值
 */
export function mapSensitivityToACL(
  sensitivity: 'public' | 'internal' | 'restricted',
  backend: MemoryBackend,
): string {
  const map = backend.sensitivity_map ?? {};
  switch (sensitivity) {
    case 'restricted':
      return map.restricted ?? 'restricted';
    case 'internal':
      return map.team ?? map.agent ?? 'team';
    case 'public':
      return 'public'; // public 不走记忆后端
  }
}

/**
 * 代理工具调用——转发到后端 endpoint，带 ACL 参数。
 * endpoint 不可达 / 转发失败 → 优雅降级（返回错误标记，不 crash）。
 *
 * @param toolName 工具名
 * @param args 调用参数
 * @param backend 后端配置
 * @param agentSensitivity Agent 敏感度
 */
export async function proxyMemoryToolCall(
  toolName: string,
  args: unknown,
  backend: MemoryBackend,
  agentSensitivity: 'public' | 'internal' | 'restricted' = 'internal',
): Promise<unknown> {
  if (backend.type === 'workbuddy') {
    return proxyWorkBuddyCall(toolName, args, backend);
  }

  if (!backend.endpoint) {
    return { ok: false, error: `memory_backend ${backend.name} 缺少 endpoint` };
  }

  const acl = mapSensitivityToACL(agentSensitivity, backend);
  try {
    // v1.3.1 接口对齐：TencentDB-Agent-Memory 的 /v3/tools/call 契约是
    //   header: x-tdai-service-id（必填，服务标识）
    //   body:   { knowledge_id, tool_name, params }（knowledge_id 定位 wiki/code-graph 资源）
    // 旧实现发 { tool, arguments } 会 400/404——对齐后按后端真实协议转发。
    // 无 knowledge_id 的后端（如自定义 MCP）降级为旧 { tool, arguments } 格式。
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const body = backend.knowledge_id
      ? {
          knowledge_id: backend.knowledge_id,
          tool_name: toolName,
          params: { ...(args as Record<string, unknown>), _acl: acl },
        }
      : { tool: toolName, arguments: { ...(args as Record<string, unknown>), _acl: acl } };
    if (backend.service_id) headers['x-tdai-service-id'] = backend.service_id;

    const resp = await fetch(`${backend.endpoint}/v3/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return { ok: false, error: `memory_backend ${backend.name} 返回 HTTP ${resp.status}` };
    }
    return await resp.json();
  } catch (err) {
    // 优雅降级：endpoint 不可达 / 超时——warn + 返回错误标记，不 crash
    return {
      ok: false,
      error: `memory_backend ${backend.name} 不可达（${err instanceof Error ? err.message : String(err)}）——已降级跳过`,
    };
  }
}

// ────────────────────────────────────────────────
// MA6：workbuddy 类型降级实现
// ────────────────────────────────────────────────

/**
 * workbuddy 后端代理调用（MA6 降级实现）。
 *
 * ⚠️ 实现前提说明：conversation_search 是 WorkBuddy 平台内置工具，sofagent
 * 引擎进程无法直接调用——本机无法验证 WorkBuddy 会话通道。v1.3.0 降级为：
 *   - memory_write → 写 .workbuddy/memory/<name>.md 文件（本地可验证）
 *   - conversation_search → 标注「待 v1.3.1」（返回不可用提示，不 crash）
 *
 * @param toolName 工具名
 * @param args 调用参数
 * @param backend 后端配置
 */
export async function proxyWorkBuddyCall(
  toolName: string,
  args: unknown,
  backend: MemoryBackend,
): Promise<unknown> {
  const name = backend.name ?? 'workbuddy-memory';

  if (toolName === 'memory_write') {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const dir = path.join(os.homedir(), '.workbuddy', 'memory');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${name}.md`);
      const record = typeof args === 'object' && args !== null
        ? (args as Record<string, unknown>)
        : {};
      const line = `- ${new Date().toISOString()} | ${String(record.content ?? record.text ?? '')}`;
      fs.appendFileSync(filePath, line + '\n', 'utf-8');
      return { ok: true, data: { file: filePath } };
    } catch (err) {
      return { ok: false, error: `workbuddy memory_write 失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (toolName === 'conversation_search') {
    return {
      ok: false,
      error: 'conversation_search 依赖 WorkBuddy 平台会话通道，本机无法直接调用——标注待 v1.3.1（MA6 降级）',
    };
  }

  return { ok: false, error: `workbuddy 后端不支持工具 ${toolName}（v1.3.0 仅 memory_write / conversation_search）` };
}

// ────────────────────────────────────────────────
// MA1：registerMemoryBackends——读 config 注册动态工具
// ────────────────────────────────────────────────

/**
 * 从 config.yml 读取 memory_backends 段并注册动态工具（MA1）。
 *
 * 规则：
 *   - config.memory_backends 未定义 → 不加载（行为与 v1.2.9 一致）
 *   - enabled=false（缺省）→ 跳过
 *   - type='mcp'：向 endpoint 发 /v3/tools/list 确认可达；不可达 → warn + skip
 *   - type='workbuddy'：无需网络，直接注册（MA6 降级路径）
 *
 * @param config 可选注入的配置（测试用）；缺省走 loadConfig()
 * @returns 注册的工具名数组（测试断言用）
 */
export async function registerMemoryBackends(config?: ReturnType<typeof loadConfig>): Promise<string[]> {
  const cfg = (config ?? loadConfig()) as (ReturnType<typeof loadConfig> & { memory_backends?: MemoryBackend[] });
  if (!cfg.memory_backends) return [];

  const registered: string[] = [];
  for (const backend of cfg.memory_backends) {
    if (!backend.enabled) continue; // 缺省关闭

    if (backend.type === 'workbuddy') {
      // MA6：本机降级路径——无网络依赖，直接注册
      for (const toolName of backend.tools) {
        registerDynamicTool({
          name: toolName,
          description: `外部记忆后端 ${backend.name}（workbuddy 降级）：memory_write 写 .workbuddy/memory/；conversation_search 待 v1.3.1`,
          inputSchema: { type: 'object', properties: {} },
          handler: async (args) => proxyMemoryToolCall(toolName, args, backend, 'internal'),
        });
        registered.push(toolName);
      }
      continue;
    }

    // type='mcp'：先确认 endpoint 可达
    if (!backend.endpoint) {
      console.warn(`[memory-backend] ${backend.name} 缺少 endpoint，跳过（缺省关闭）`);
      continue;
    }
    // v1.3.1 接口对齐：TencentDB /v3/tools/list 是 POST + knowledge_id + x-tdai-service-id（非 GET）。
    // 无 knowledge_id 时无法做资源定位，跳过（缺省关闭铁律：不注册就不发起外部请求）。
    if (!backend.knowledge_id) {
      console.warn(`[memory-backend] ${backend.name} 缺 knowledge_id（TencentDB 资源 ID），跳过——需配置 knowledge_id 才启用`);
      continue;
    }
    let reachable = false;
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (backend.service_id) headers['x-tdai-service-id'] = backend.service_id;
      const resp = await fetch(`${backend.endpoint}/v3/tools/list`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ knowledge_id: backend.knowledge_id }),
        signal: AbortSignal.timeout(3000),
      });
      reachable = resp.ok;
    } catch {
      reachable = false;
    }
    if (!reachable) {
      console.warn(`[memory-backend] ${backend.name} endpoint 不可达（${backend.endpoint}），跳过——不加载外部依赖`);
      continue;
    }

    for (const toolName of backend.tools) {
      registerDynamicTool({
        name: toolName,
        description: `外部记忆后端 ${backend.name} 工具 ${toolName}（经 MCP 转发）`,
        inputSchema: { type: 'object', properties: {} },
        handler: async (args) => proxyMemoryToolCall(toolName, args, backend, 'internal'),
      });
      registered.push(toolName);
    }
  }
  return registered;
}
