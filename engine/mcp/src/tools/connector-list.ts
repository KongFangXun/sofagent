// ============================================================
// connector-list.ts · MCP tools：连接器注册 / 发现（v1.5.1 G5b · T4）
// ============================================================
//
// 第三方连接器（数据库 / REST / SaaS 适配器）的注册与发现入口：
//
//   connector_register  注册（准入复用 plugin-gate 来源白名单——
//                       fail-closed：白名单外来源拒绝）
//   connector_list      发现（按类型 / 主机 / 能力标签过滤 + 租户隔离）
//
// 与 tool-registry 分列铁律（changelog 十一章验收 ③）：
//   连接器清单 ≠ 工具清单。本文件只经 @sofagent/audit 的连接器注册表
//   （engine/audit/src/cli/plugin-gate.ts 连接器段）读写，绝不扫
//   TOOLS 数组；tool-registry 也不含连接器条目。两个目录面各管各的。
//
// 实现归属：注册表与准入判定在 audit 包（plugin-gate.ts G5b 扩展段，
// 与插件白名单同文件同源校验）；本文件是 MCP 薄委托层——text 首行
// [sofagent] 前缀 + data 结构化（形态照抄 device-list.ts）。
//
// 审计：注册成功 / 拒绝均留 decision-log（emitDecision——HMAC 链；
// 拒绝留痕让「谁试图注册什么来源」可回溯，准入面不静默吞事件）。
// ============================================================

/** dataDir 解析（显式入参优先——与 tools/ 既有 tool 同款纪律） */
async function resolveDataDir(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const { getDataDir } = await import('@sofagent/core');
  return getDataDir();
}

/** 连接器注册结果（MCP 面） */
export interface ConnectorRegisterResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    action: 'register';
    reason?: 'invalid-params' | 'source-not-allowed' | 'duplicate-name';
    message: string;
    /** 注册成功的连接器条目（ok 时有值） */
    connector?: {
      name: string;
      kind: string;
      source: string;
      sourceKind: string;
      capabilities: string[];
      tenant: string;
      registeredAt: string;
    };
    auditLogged: boolean;
  };
}

/** 连接器清单结果（MCP 面） */
export interface ConnectorListResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    action: 'list';
    total: number;
    /** 过滤后清单（租户隔离已生效——只含请求租户条目） */
    connectors: Array<{
      name: string;
      kind: string;
      source: string;
      sourceKind: string;
      capabilities: string[];
      tenant: string;
      endpoint?: string;
      registeredAt: string;
    }>;
    /** 声明口径：与 MCP 工具清单（TOOLS）分列——本清单只含连接器 */
    scope: 'connectors-only';
  };
}

/** audit 侧连接器面的懒加载形态（@sofagent/audit 直接依赖——与 audit-file 同面） */
interface AuditConnectorApi {
  registerConnector: (input: {
    name: string;
    kind: 'db' | 'rest' | 'saas';
    source: string;
    capabilities?: string[];
    tenant?: string;
    endpoint?: string;
  }, opts?: { dataDir?: string; policy?: unknown }) => {
    ok: boolean;
    reason?: string;
    message: string;
    connector?: {
      name: string;
      kind: string;
      source: string;
      sourceKind: string;
      capabilities: string[];
      tenant: string;
      registeredAt: string;
    };
  };
  listConnectors: (args: {
    tenant?: string;
    kind?: 'db' | 'rest' | 'saas';
    host?: string;
    capability?: string;
  }, dataDir: string) => {
    total: number;
    connectors: Array<{
      name: string;
      kind: string;
      source: string;
      sourceKind: string;
      capabilities: string[];
      tenant: string;
      endpoint?: string;
      registeredAt: string;
    }>;
  };
}

/** 加载 audit 连接器面（经 @sofagent/audit 公开导出面——public-api @public 段） */
async function loadConnectorApi(): Promise<AuditConnectorApi | null> {
  try {
    const mod = (await import('@sofagent/audit')) as unknown as AuditConnectorApi;
    if (typeof mod.registerConnector !== 'function' || typeof mod.listConnectors !== 'function') {
      return null;
    }
    return mod;
  } catch {
    return null;
  }
}

/** 注册 / 拒绝留痕（decision-log——准入事件不静默） */
async function auditConnectorEvent(
  ok: boolean,
  detail: string,
  evidence: string[],
): Promise<boolean> {
  try {
    const { emitDecision } = await import('@sofagent/audit');
    emitDecision({
      agentId: 'connector-registry',
      sessionId: `connector-${Date.now()}`,
      kind: 'ARTIFACT_EDIT',
      moment: 'ACT',
      category: 'select',
      why: `connector ${ok ? '注册成功' : '注册拒绝'}：${detail}`,
      artifactRef: 'config/connectors.json',
      evidence,
    });
    return true;
  } catch {
    return false; // best-effort 显式标注（同 device-data-query 纪律）
  }
}

/**
 * connector_register——注册第三方连接器（G5b 准入面，验收 ①②）。
 *
 * @param args.name 连接器标识（租户内唯一，1-64 位词法）
 * @param args.kind 类型（db / rest / saas）
 * @param args.source 来源串（Git URL / 主机 / 本地路径——过白名单）
 * @param args.capabilities 能力标签
 * @param args.tenant 归属租户（缺省 default）
 * @param args.endpoint 接入端点回显（不含凭证）
 * @param args.data_dir 数据目录（测试隔离）
 */
export async function connectorRegister(args: {
  name: string;
  kind: 'db' | 'rest' | 'saas';
  source: string;
  capabilities?: string[];
  tenant?: string;
  endpoint?: string;
  data_dir?: string;
}): Promise<ConnectorRegisterResult> {
  const api = await loadConnectorApi();
  if (!api) {
    return {
      text: '[sofagent] connector_register 失败：@sofagent/audit 连接器面不可用（dist 未构建？）',
      data: { isError: true, action: 'register', message: 'audit 连接器面不可用', auditLogged: false },
    };
  }
  const r = api.registerConnector(
    {
      name: args.name,
      kind: args.kind,
      source: args.source,
      ...(Array.isArray(args.capabilities) ? { capabilities: args.capabilities } : {}),
      ...(typeof args.tenant === 'string' && args.tenant ? { tenant: args.tenant } : {}),
      ...(typeof args.endpoint === 'string' && args.endpoint ? { endpoint: args.endpoint } : {}),
    },
    { dataDir: await resolveDataDir(args.data_dir) },
  );
  const auditLogged = await auditConnectorEvent(
    r.ok,
    r.ok ? `${r.connector!.name}（${r.connector!.kind}，租户 ${r.connector!.tenant}）` : r.message,
    [
      `name=${args.name}`,
      `kind=${args.kind}`,
      `source=${args.source}`,
      `tenant=${args.tenant ?? 'default'}`,
      ...(r.ok ? [`capabilities=${r.connector!.capabilities.join(',') || '无'}`] : [`reason=${r.reason}`]),
    ],
  );
  if (!r.ok) {
    return {
      text: `[sofagent] connector_register 拒绝：${r.message}`,
      data: {
        isError: true,
        action: 'register',
        reason: r.reason as ConnectorRegisterResult['data']['reason'],
        message: r.message,
        auditLogged,
      },
    };
  }
  const c = r.connector!;
  return {
    text: `[sofagent] ✅ 连接器「${c.name}」已注册（${c.kind} · 来源 ${c.sourceKind} · 租户 ${c.tenant}${c.capabilities.length > 0 ? ` · 能力 ${c.capabilities.join(',')}` : ''}）`,
    data: {
      isError: false,
      action: 'register',
      message: '注册成功',
      connector: { name: c.name, kind: c.kind, source: c.source, sourceKind: c.sourceKind, capabilities: c.capabilities, tenant: c.tenant, registeredAt: c.registeredAt },
      auditLogged,
    },
  };
}

/**
 * connector_list——连接器发现（G5b 目录面，验收 ③④）。
 *
 * @param args.tenant 租户隔离键（缺省 default——只返回该租户条目）
 * @param args.kind 类型过滤（db / rest / saas）
 * @param args.host 来源过滤（主机名 / 本地路径前缀）
 * @param args.capability 能力标签过滤
 * @param args.data_dir 数据目录（测试隔离）
 */
export async function connectorList(args: {
  tenant?: string;
  kind?: 'db' | 'rest' | 'saas';
  host?: string;
  capability?: string;
  data_dir?: string;
} = {}): Promise<ConnectorListResult> {
  const api = await loadConnectorApi();
  if (!api) {
    return {
      text: '[sofagent] connector_list 失败：@sofagent/audit 连接器面不可用（dist 未构建？）',
      data: { isError: true, action: 'list', total: 0, connectors: [], scope: 'connectors-only' },
    };
  }
  const { total, connectors } = api.listConnectors(
    {
      ...(typeof args.tenant === 'string' && args.tenant ? { tenant: args.tenant } : {}),
      ...(args.kind === 'db' || args.kind === 'rest' || args.kind === 'saas' ? { kind: args.kind } : {}),
      ...(typeof args.host === 'string' && args.host ? { host: args.host } : {}),
      ...(typeof args.capability === 'string' && args.capability ? { capability: args.capability } : {}),
    },
    await resolveDataDir(args.data_dir),
  );
  const lines: string[] = [];
  lines.push(`[sofagent] 连接器清单（租户 ${args.tenant ?? 'default'} · 共 ${total} 个 · 与 MCP 工具清单分列）`);
  if (args.kind) lines.push(`类型过滤: ${args.kind}`);
  if (args.host) lines.push(`来源过滤: ${args.host}`);
  if (args.capability) lines.push(`能力过滤: ${args.capability}`);
  for (const c of connectors) {
    lines.push(
      `  • ${c.name} [${c.kind}] 来源=${c.source}（${c.sourceKind}）` +
        `${c.capabilities.length > 0 ? ` 能力=${c.capabilities.join(',')}` : ''}` +
        `${c.endpoint !== undefined ? ` 端点=${c.endpoint}` : ''} 注册于 ${c.registeredAt}`,
    );
  }
  if (total === 0) lines.push('  （无匹配连接器）');
  return {
    text: lines.join('\n'),
    data: {
      isError: false,
      action: 'list',
      total,
      connectors,
      scope: 'connectors-only',
    },
  };
}
