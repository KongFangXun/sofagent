// route-policy.ts · v1.3.7 交付⑧ · 路由策略配置（Policy 构件）
//
// 读 `.sofagent/route-policy.yml`——企业可配偏好规则 + 决胜规则 + 硬性拒绝扩展。
// role-model 启发补的 Policy「半个」：数据主权路由（restricted→强制本地）是
// 已有硬性拒绝，这里补偏好/预算/决胜规则 + 除数据主权外的业务硬性拒绝扩展。
//
// ⚠️ 边界重申：本文件是「决策可解释性的策略面」，不是路由器——
// 实际路由仍由第三方 model router（LiteLLM/OpenRouter）做。
// 不配 route-policy.yml → 全走 default 策略（向后兼容）。
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

/** 偏好规则类型（决定 routeReason.policy 命中哪类） */
export type RoutePreference = 'cost' | 'latency' | 'capability';

/** 路由策略配置 schema */
export interface RoutePolicy {
  /**
   * 偏好规则——多个同时配时按数组序优先。
   * cost 成本优先 / latency 延迟优先 / capability 能力优先。
   * 不配 = default（无偏好，第三方 router 自决）。
   */
  preferences?: RoutePreference[];
  /**
   * 决胜规则——同分时谁赢（对齐 role-model Policy 决胜）。
   * registered-first 注册序在前者赢 / cheapest 更便宜者赢 / fastest 更快者赢。
   */
  tieBreaker?: 'registered-first' | 'cheapest' | 'fastest';
  /**
   * 硬性拒绝扩展（除数据主权外的业务规则）。
   * 每项是一条 endpoint 黑名单模式（精确名 / 前缀通配 prefix*）——
   * 命中的 endpoint 在 routeReason.rejectedEndpoints 留痕。
   */
  denyEndpoints?: string[];
}

/** 策略解析结果（含来源——审计可追溯「这条理由链依据哪份配置」） */
export interface RoutePolicyResolution {
  policy: RoutePolicy;
  /** 配置来源文件（null = 未配置走 default） */
  sourceFile: string | null;
}

/** 默认空策略（不配 route-policy.yml 时的行为——全走 default） */
export const DEFAULT_ROUTE_POLICY: RoutePolicy = {};

/**
 * 读取 `.sofagent/route-policy.yml`。
 *
 * @param projectRoot 项目根目录（.sofagent/ 所在处）
 * @returns 解析后的策略 + 来源；文件不存在/解析失败 → DEFAULT_ROUTE_POLICY
 *          （解析失败不抛错——配置坏不应阻断路由决策，降级 default + 留痕由调用方做）
 */
export function loadRoutePolicy(projectRoot: string): RoutePolicyResolution {
  const sourceFile = join(projectRoot, '.sofagent', 'route-policy.yml');
  if (!existsSync(sourceFile)) {
    return { policy: DEFAULT_ROUTE_POLICY, sourceFile: null };
  }

  let parsed: unknown;
  try {
    parsed = yamlLoad(readFileSync(sourceFile, 'utf-8'));
  } catch {
    return { policy: DEFAULT_ROUTE_POLICY, sourceFile };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { policy: DEFAULT_ROUTE_POLICY, sourceFile };
  }

  const raw = parsed as Record<string, unknown>;
  const policy: RoutePolicy = {};

  // preferences：只收合法枚举值（坏值静默丢弃——策略面宁可降级不可崩）
  if (Array.isArray(raw.preferences)) {
    const valid = (raw.preferences as unknown[]).filter(
      (p): p is RoutePreference => p === 'cost' || p === 'latency' || p === 'capability',
    );
    if (valid.length > 0) policy.preferences = valid;
  }

  if (raw.tieBreaker === 'registered-first' || raw.tieBreaker === 'cheapest' || raw.tieBreaker === 'fastest') {
    policy.tieBreaker = raw.tieBreaker;
  }

  if (Array.isArray(raw.denyEndpoints)) {
    const patterns = (raw.denyEndpoints as unknown[]).filter(
      (d): d is string => typeof d === 'string' && d.trim() !== '',
    );
    if (patterns.length > 0) policy.denyEndpoints = patterns;
  }

  return { policy, sourceFile };
}

/**
 * 判定 endpoint 是否被硬性拒绝（denyEndpoints 模式匹配）。
 * 精确名匹配 + 前缀通配（`prefix*`）。
 */
export function isEndpointDenied(endpoint: string, policy: RoutePolicy): boolean {
  for (const pattern of policy.denyEndpoints ?? []) {
    if (pattern.endsWith('*')) {
      if (endpoint.startsWith(pattern.slice(0, -1))) return true;
    } else if (endpoint === pattern) {
      return true;
    }
  }
  return false;
}
