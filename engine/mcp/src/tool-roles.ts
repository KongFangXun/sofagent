// ============================================================
// tool-roles.ts · MCP 工具角色分层（v1.4.0）
//
// 66 个工具按角色打标签，默认只暴露 fde+audit+agent 三面
// （企业部署核心场景），SOFAGENT_MCP_ROLES=all 恢复全量。
// 未打 roles 的工具（动态工具 memory_backends）始终暴露。
// ============================================================

/** 全部角色面（7 面） */
export const ROLES = ['audit', 'fde', 'eval', 'agent', 'ops', 'commons', 'browser'] as const;
export type Role = (typeof ROLES)[number];

/** 默认暴露的角色面——企业部署核心场景（部署 + 审计 + 运行时编排） */
export const DEFAULT_ROLES: Role[] = ['fde', 'audit', 'agent'];

/** 环境变量名——逗号分隔角色列表；all / * / 空 = 全量暴露 */
export const ROLES_ENV = 'SOFAGENT_MCP_ROLES';

/**
 * 解析当前激活的角色集。
 * - `null` = 全量暴露（仅显式 `all` / `*`）
 * - 未配置 / 空 / 全非法 → 默认三面（fde/audit/agent）
 * - 否则 = 只暴露指定面
 */
export function getActiveRoles(env: NodeJS.ProcessEnv = process.env): Role[] | null {
  const raw = (env[ROLES_ENV] ?? '').trim().toLowerCase();
  if (raw === 'all' || raw === '*') return null; // 显式全量
  if (raw === '') return DEFAULT_ROLES; // 未配置 → 默认分层

  const valid = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => (ROLES as readonly string[]).includes(s)) as Role[];

  if (valid.length === 0) return DEFAULT_ROLES;
  return [...new Set(valid)];
}

/** 单个工具是否在当前角色集暴露（无 roles = 动态工具，始终暴露） */
export function isToolExposed(roles: string[] | undefined, active: Role[] | null): boolean {
  if (active === null) return true; // 全量模式
  if (!roles || roles.length === 0) return true; // 未打标（动态工具）→ 始终暴露
  return roles.some((r) => active.includes(r as Role));
}

/** 按角色过滤工具清单（无 roles 的工具保留） */
export function filterToolsByRoles<T extends { roles?: string[] }>(tools: T[], active: Role[] | null): T[] {
  if (active === null) return tools;
  return tools.filter((t) => isToolExposed(t.roles, active));
}
