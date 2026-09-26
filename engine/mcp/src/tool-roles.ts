// ============================================================
// tool-roles.ts · MCP 工具角色分层（v1.5.2）
//
// 83 个工具按角色打标签，默认全量暴露（通用对话助手形态，
// 对话可跨场景，硬砍会挡模型）。专职 Agent 部署时显式设
// SOFAGENT_MCP_ROLES=fde,audit,agent 等收窄到专用工具箱。
// 未打 roles 的工具（动态工具 memory_backends）始终暴露。
// SOFAGENT_MCP_ROLES 配了值但全部非法 → 回退全量暴露并打 stderr 警告；
// 再设 SOFAGENT_MCP_ROLES_STRICT=1 时改为抛错拒绝启动（fail-closed，专职部署用）。
// ============================================================

/** 全部角色面（7 面） */
export const ROLES = ['audit', 'fde', 'eval', 'agent', 'ops', 'commons'] as const;
export type Role = (typeof ROLES)[number];

/** 环境变量名——逗号分隔角色列表；未配置 / all / * / 空 = 全量暴露 */
export const ROLES_ENV = 'SOFAGENT_MCP_ROLES';

/** 环境变量名——设为 `1`：SOFAGENT_MCP_ROLES 有值但全部非法 → 抛错拒绝启动（fail-closed） */
export const ROLES_STRICT_ENV = 'SOFAGENT_MCP_ROLES_STRICT';

/**
 * 解析当前激活的角色集。
 * - `null` = 全量暴露（未配置 / 空 / `all` / `*` / 全非法值）
 * - 否则 = 只暴露显式指定的面
 */
export function getActiveRoles(env: NodeJS.ProcessEnv = process.env): Role[] | null {
  const raw = (env[ROLES_ENV] ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'all' || raw === '*') return null; // 默认 / 显式全量

  const valid = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => (ROLES as readonly string[]).includes(s)) as Role[];

  if (valid.length === 0) {
    // fix(finding-11): 全非法值不再静默回退——stderr 显著警告，避免运维误以为已收窄。
    if ((env[ROLES_STRICT_ENV] ?? '') === '1') {
      throw new Error(
        `[sofagent] SOFAGENT_MCP_ROLES="${raw}" 未匹配任何已知角色（${ROLES_STRICT_ENV}=1 fail-closed，拒绝启动）。合法角色: ${ROLES.join(', ')}`,
      );
    }
    console.error(`[sofagent] WARNING: SOFAGENT_MCP_ROLES="${raw}" 未匹配任何已知角色，已回退为全量暴露（107 tools）。如需收窄请修正角色名。`);
    return null; // 全非法 → 全量兜底（带警告）
  }
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
