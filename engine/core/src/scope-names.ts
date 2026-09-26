// ============================================================
// scope-names.ts · 作用域显名校验（v1.5.3 扩展三）
// ============================================================
// 引擎 API / MCP tool 参数 / 审计记录中的一切对象标识必须带作用域
// （workflowId / nodeId / sessionId / PRId，禁裸 id）——裸 id 在多实体
// 系统必然撞名，审计回放无法定位。三层接入：API 入参 / MCP 参数 /
// 审计记录（本模块提供统一校验纯函数，三层各自调用）。
// ============================================================

/** 作用域类型 */
export type ScopeKind = 'workflowId' | 'nodeId' | 'sessionId' | 'PRId' | 'agentId' | 'runId';

/** 作用域显名形态：<kind>:<id>（如 workflow:order-flow / pr:42） */
export type ScopedName<K extends ScopeKind = ScopeKind> = `${K}:${string}`;

/** 结构化校验结果 */
export interface ScopeVerdict {
  valid: boolean;
  /** 解析出的 kind 与裸 id */
  kind?: ScopeKind;
  bare?: string;
  error?: string;
}

const ALL_KINDS: readonly ScopeKind[] = ['workflowId', 'nodeId', 'sessionId', 'PRId', 'agentId', 'runId'];

/**
 * 校验标识是否带作用域显名。
 * 合法形态：<kind>:<非空 id>（kind 见 ALL_KINDS；`workflow:wf-1` 合法，
 * `wf-1` 裸 id 非法，`unknown:x` 未知 kind 非法）。
 */
export function validateScopedName(name: string, allowedKinds?: ScopeKind[]): ScopeVerdict {
  const kinds = allowedKinds ?? ALL_KINDS;
  const idx = name.indexOf(':');
  if (idx <= 0 || idx === name.length - 1) {
    return { valid: false, error: `标识「${name}」缺作用域显名——合法形态 <kind>:<id>（kind ∈ ${kinds.join('/')}），裸 id 在多实体系统必然撞名` };
  }
  const kind = name.slice(0, idx) as ScopeKind;
  const bare = name.slice(idx + 1);
  if (!(kinds as string[]).includes(kind)) {
    return { valid: false, error: `标识「${name}」的作用域 kind「${kind}」未知——允许值 ${kinds.join('/')}` };
  }
  return { valid: true, kind, bare };
}

/**
 * 断言形态（API/MCP/审计三层接入口）——非法抛结构化错误（带 error.code），
 * 不静默放行。
 */
export function assertScopedName(name: string, allowedKinds?: ScopeKind[]): void {
  const v = validateScopedName(name, allowedKinds);
  if (!v.valid) {
    const err = new Error(v.error) as Error & { code: 'SOFAGENT_SCOPE_REQUIRED'; scopeName: string };
    err.code = 'SOFAGENT_SCOPE_REQUIRED';
    err.scopeName = name;
    throw err;
  }
}
