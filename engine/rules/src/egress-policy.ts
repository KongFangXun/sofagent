// ============================================================
// egress-policy.ts · v1.5.2 章五 · 网络出口治理面（host 白名单声明面 + 裁决）
// ============================================================
//
// 数据主权「管出」翼的策略契约层：Agent 能访问哪些 host，由此声明 + 裁决。
// 与 v1.4.9 G10 设备数据面授权读取（「管进」翼）**逐面对称**：
//
//   | 面        | G10（管进，engine/core/device-data-policy.ts） | 本章（管出，本文件）            |
//   |-----------|-----------------------------------------------|---------------------------------|
//   | 声明形态  | config/device-data-policy.json（version+清单） | config/egress-policy.json（同构）|
//   | 默认态    | 清单空/文件缺失 → 全拒（opt-in fail-closed）    | 同款（空 = 全拒）               |
//   | 匹配语义  | 目录前缀 + 边界字符（防 /data-secret 借壳）      | host 精确 / 后缀通配 + 点边界    |
//   | 裁决形态  | { ok, reason, allowedDir, message }            | { verdict, reason, matchedRule, message } |
//   | 留痕形态  | 调用链下游 emitDecision → 决策 HMAC 链           | 同款（egress-audit.ts 调用 emitDecision） |
//
// ⚠️ 马鞍边界（changelog 章五）：本文件只做**策略契约**——不做 egress proxy /
// 网络拦截器。拦截器实现是执行面，实现在外（见 egress-interceptor-api.ts 通道）。
// 本文件零网络请求、零拦截副作用，是纯判定 + 声明配置读写。
//
// 设计决策：
//   - **默认空 = 全拒（opt-in）**：未声明任何 host 时一切出站判 Deny；配置文件
//     缺失 / 损坏 / 结构非法 → 按空策略处理 = 全拒（fail-closed）。放行是显式
//     声明的结果，拒绝是缺省态——与 G10 铁律同源。
//   - **通配必须有明确边界语义，禁止 `*` 全放行**：声明 `api.github.com` 只放行
//     该精确 host；声明 `.github.com` 放行 github.com 本体与其任意子域
//     （api.github.com 命中，evilgithub.com **不**命中——点边界）。裸 `*` /
//     `*.x` 之外的畸形通配一律视为非法条目丢弃（不整表丢弃——同 G10 纪律）。
//   - 裁决结果带**可追溯的理由**（命中了哪条声明 / 为何拒绝），供审计挂链消费。
//   - 协议 / 端口为可选收窄维度（对齐 Codex NetworkApprovalContext{host,protocol}）：
//     声明了 ports/protocols 才校验，未声明 = 不限制该维度。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { getDataDir } from '@sofagent/core';

/** 出站策略声明配置相对路径（<dataDir>/config/egress-policy.json） */
export const EGRESS_POLICY_FILE = 'config/egress-policy.json';

/** 策略 schema 版本（格式演进预留，与 G10 DeviceDataPolicyConfig.version 同义） */
export const EGRESS_POLICY_VERSION = 1;

/** 出站裁决结果（对齐 Codex NetworkApprovalContext 的 Allow/Deny 二值） */
export type EgressVerdict = 'Allow' | 'Deny';

/**
 * 拒绝理由码（fail-closed 语义显式化——审计挂链 + 判定底座消费）。
 * 'no-interceptor' 由通道层（egress-interceptor-api.ts）在「无拦截器注册」时使用，
 * 本文件的 decideEgress 不会产出该码。
 */
export type EgressDenyReason =
  | 'empty-policy'
  | 'malformed-policy'
  | 'invalid-request'
  | 'host-not-allowed'
  | 'port-not-allowed'
  | 'protocol-not-allowed'
  | 'no-interceptor';

/** 放行码——与拒绝理由码同域（消费方查表不必分两套） */
export type EgressReason = 'allowed' | EgressDenyReason;

/** 一次出站请求（host 必填，port/protocol 可选收窄维度） */
export interface EgressRequest {
  /** 目标主机（域名或 IP；含端口会被剥离，见 normalizeEgressHost） */
  host: string;
  /** 目标端口（声明了 ports 的规则才校验） */
  port?: number;
  /** 协议类别，如 http / https / dns / tcp（声明了 protocols 的规则才校验） */
  protocol?: string;
}

/**
 * host 白名单条目。
 * host 形态：
 *   - `api.github.com`  精确 host——只放行该 host
 *   - `.github.com`     后缀通配——放行 github.com 本体 + 任意子域（点边界，防借壳）
 *   - `*.github.com`    同上（写入时归一化为 `.github.com`）
 */
export interface EgressHostRule {
  host: string;
  /** 允许端口集合（声明且非空才校验；请求无 port 时 fail-closed 拒绝） */
  ports?: number[];
  /** 允许协议集合（声明且非空才校验；大小写不敏感） */
  protocols?: string[];
}

/** 出站策略（config/egress-policy.json 顶层结构，对齐 G10 配置形态） */
export interface EgressPolicy {
  /** 配置版本（格式演进预留） */
  version: number;
  /** 策略归属主体（workflow / 节点 / agent 标识——审计追溯用，可选） */
  subject?: string;
  /** 允许出站的 host 清单（空 = 全拒，opt-in） */
  hosts: EgressHostRule[];
}

/** 出站裁决（带可追溯理由——审计挂链消费「依据什么裁决」） */
export interface EgressDecision {
  verdict: EgressVerdict;
  reason: EgressReason;
  /** 人类可读理由文本（审计留痕用） */
  message: string;
  /** 归一化后的目标 host（回显——审计事件记「裁决了什么」） */
  host: string;
  /** 命中的声明（Allow 时 = 命中规则 host；Deny 时缺省无值） */
  matchedRule?: string;
}

/** 常见 scheme 的默认端口（URL 无显式端口时补齐，供端口收窄规则判定） */
const DEFAULT_PORTS: Record<string, number> = {
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
  ftp: 21,
};

/**
 * host 归一化：小写 + 去首尾空白 + 去 FQDN 根点 + 剥 IPv6 方括号。
 *
 * 输入若形如 `host:port` 则剥离端口（策略匹配面只认 host——端口是独立收窄
 * 维度，混入 host 会让「精确 host」匹配失真）。IPv6 字面量（含多个冒号）
 * 不做端口剥离，只剥方括号。
 *
 * 空串 / 非字符串 → 返回空串（调用方按 invalid-request 处理）。
 */
export function normalizeEgressHost(host: string): string {
  if (typeof host !== 'string') return '';
  let out = host.trim().toLowerCase();
  if (out === '') return '';
  if (out.startsWith('[')) {
    // IPv6 字面量：[::1] → ::1
    const end = out.indexOf(']');
    return end > 0 ? out.slice(1, end) : out.slice(1);
  }
  if (out.includes(':') && out.split(':').length === 2) {
    // host:port 形态（单个冒号 = 非 IPv6）——剥离端口
    out = out.slice(0, out.indexOf(':'));
  }
  while (out.length > 1 && out.endsWith('.')) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * 声明条目归一化：`*.x` → `.x`；裸 `*` / 畸形通配 / 空串 → null（非法，丢弃）。
 * 这是「禁止 `*` 全放行」的执行位——通配**必须**带点边界。
 */
export function normalizeHostRule(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '' || trimmed === '*' || trimmed === '.') return null;
  if (trimmed.startsWith('*.')) {
    const bare = normalizeEgressHost(trimmed.slice(2));
    return bare === '' ? null : `.${bare}`;
  }
  if (trimmed.startsWith('*')) {
    // `*x` 之类的畸形通配——一律非法（不做前缀通配，防 `*evil.com` 借壳）
    return null;
  }
  const normalized = normalizeEgressHost(trimmed);
  return normalized === '' ? null : normalized;
}

/**
 * host 是否命中一条声明（纯函数，边界安全）。
 *
 *   hostMatchesEgressRule('api.github.com', '.github.com')  → true（子域）
 *   hostMatchesEgressRule('github.com',     '.github.com')  → true（本体）
 *   hostMatchesEgressRule('evilgithub.com', '.github.com')  → false（点边界防借壳）
 *   hostMatchesEgressRule('api.github.com', 'github.com')   → false（精确 host）
 */
export function hostMatchesEgressRule(host: string, ruleHost: string): boolean {
  const h = normalizeEgressHost(host);
  const r = normalizeHostRule(ruleHost);
  if (h === '' || r === null) return false;
  if (r.startsWith('.')) {
    // 后缀通配：本体相等 或 以「点 + 后缀」结尾（点边界——不命中 evilgithub.com）
    return h === r.slice(1) || h.endsWith(r);
  }
  return h === r;
}

/**
 * 声明面：把 host 清单（字符串或结构化条目）规范化为 EgressPolicy。
 *
 * 使用方式（workflow / 节点声明「允许出站到哪些 host」）：
 *   declareEgressHosts(['api.github.com', '.internal.corp'], { subject: 'wf-42' })
 *
 * 非法条目（裸 `*` / 畸形通配 / 空串）被丢弃（不整表丢弃）；归一化后重复的
 * host 保留首条。默认不传 hosts = 空策略 = 全拒。
 */
export function declareEgressHosts(
  hosts: Array<string | EgressHostRule> = [],
  options: { subject?: string; version?: number } = {},
): EgressPolicy {
  const rules: EgressHostRule[] = [];
  const seen = new Set<string>();
  for (const entry of hosts) {
    const rawHost = typeof entry === 'string' ? entry : entry?.host;
    const normalized = normalizeHostRule(rawHost as string);
    if (normalized === null || seen.has(normalized)) continue;
    seen.add(normalized);
    const rule: EgressHostRule = { host: normalized };
    if (typeof entry === 'object' && entry !== null) {
      if (Array.isArray(entry.ports) && entry.ports.length > 0) {
        rule.ports = entry.ports.filter((p): p is number => Number.isInteger(p) && p > 0 && p <= 65535);
      }
      if (Array.isArray(entry.protocols) && entry.protocols.length > 0) {
        rule.protocols = entry.protocols
          .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
          .map((p) => p.trim().toLowerCase());
      }
    }
    rules.push(rule);
  }
  const policy: EgressPolicy = {
    version: typeof options.version === 'number' ? options.version : EGRESS_POLICY_VERSION,
    hosts: rules,
  };
  if (typeof options.subject === 'string' && options.subject !== '') {
    policy.subject = options.subject;
  }
  return policy;
}

/** 端口维度是否通过（未声明 ports 或空数组 = 不限制） */
function portAllowed(rule: EgressHostRule, port: number | undefined): boolean {
  if (!Array.isArray(rule.ports) || rule.ports.length === 0) return true;
  return typeof port === 'number' && rule.ports.includes(port);
}

/** 协议维度是否通过（未声明 protocols 或空数组 = 不限制，大小写不敏感） */
function protocolAllowed(rule: EgressHostRule, protocol: string | undefined): boolean {
  if (!Array.isArray(rule.protocols) || rule.protocols.length === 0) return true;
  if (typeof protocol !== 'string' || protocol.trim() === '') return false;
  const p = protocol.trim().toLowerCase();
  return rule.protocols.some((x) => x.toLowerCase() === p);
}

/**
 * 出站裁决（核心——验收 ①②）。
 *
 * 判定顺序（fail-closed 逐层收口）：
 *   1. 请求非法（host 缺失/空）→ invalid-request
 *   2. 无策略（null/undefined）→ empty-policy（默认空 = 全拒）
 *   3. 策略结构非法（hosts 非数组）→ malformed-policy
 *   4. 声明清单为空 → empty-policy（默认空 = 全拒，opt-in）
 *   5. 逐条声明匹配 host；host 命中后校验端口/协议收窄维度
 *      → 任一条全维命中 = Allow（matchedRule = 命中声明）
 *   6. 无命中 → Deny（host 命中但端口/协议未过 → 对应理由码；否则 host-not-allowed）
 *
 * 纯函数：零副作用、零网络——审计挂链由调用链下游（egress-audit.ts）承载。
 */
export function decideEgress(
  request: EgressRequest,
  policy: EgressPolicy | null | undefined,
): EgressDecision {
  // ── 1. 请求校验 ──
  const host = request && typeof request.host === 'string' ? normalizeEgressHost(request.host) : '';
  if (host === '') {
    return { verdict: 'Deny', reason: 'invalid-request', host: '', message: '出站请求非法：host 缺失或为空' };
  }

  // ── 2-4. 策略态：无策略 / 结构非法 / 清单空 —— 一律 fail-closed ──
  if (!policy) {
    return {
      verdict: 'Deny',
      reason: 'empty-policy',
      host,
      message: '出站白名单为空（默认全拒，opt-in）——未声明任何 host',
    };
  }
  if (!Array.isArray(policy.hosts)) {
    return {
      verdict: 'Deny',
      reason: 'malformed-policy',
      host,
      message: '出站白名单结构非法（hosts 非数组）——按全拒处理',
    };
  }
  if (policy.hosts.length === 0) {
    return {
      verdict: 'Deny',
      reason: 'empty-policy',
      host,
      message: '出站白名单为空（默认全拒，opt-in）——未声明任何 host',
    };
  }

  // ── 5. 逐条匹配 ──
  let hostMatchedRestricted: 'port-not-allowed' | 'protocol-not-allowed' | undefined;
  for (const rule of policy.hosts) {
    const ruleHost = normalizeHostRule(rule?.host as string);
    if (ruleHost === null) continue;
    if (!hostMatchesEgressRule(host, ruleHost)) continue;
    if (!portAllowed(rule, request.port)) {
      hostMatchedRestricted = hostMatchedRestricted ?? 'port-not-allowed';
      continue;
    }
    if (!protocolAllowed(rule, request.protocol)) {
      hostMatchedRestricted = hostMatchedRestricted ?? 'protocol-not-allowed';
      continue;
    }
    return {
      verdict: 'Allow',
      reason: 'allowed',
      host,
      matchedRule: ruleHost,
      message: `白名单放行：${host} 命中声明「${ruleHost}」`,
    };
  }

  // ── 6. 无命中 ──
  if (hostMatchedRestricted !== undefined) {
    return {
      verdict: 'Deny',
      reason: hostMatchedRestricted,
      host,
      message:
        hostMatchedRestricted === 'port-not-allowed'
          ? `host 在声明内但端口 ${String(request.port)} 不在允许集：${host}`
          : `host 在声明内但协议「${String(request.protocol)}」不在允许集：${host}`,
    };
  }
  return {
    verdict: 'Deny',
    reason: 'host-not-allowed',
    host,
    message: `host 不在出站白名单内：${host}（声明 ${policy.hosts.length} 条）`,
  };
}

/**
 * 从 URL 提取出站请求（便捷入口——复用 v1.3.7 `networkOutboundTargetRule`
 * 的 `new URL(url).hostname` 解析口径，补齐端口/协议两维度）。
 *
 * URL 无法解析 → 返回 null（调用方按 invalid-request 处理——不静默放行）。
 */
export function egressRequestFromUrl(url: string): EgressRequest | null {
  if (typeof url !== 'string' || url.trim() === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const request: EgressRequest = { host: parsed.hostname, protocol: scheme };
  if (parsed.port !== '') {
    const explicit = Number(parsed.port);
    if (Number.isInteger(explicit) && explicit > 0) request.port = explicit;
  } else if (DEFAULT_PORTS[scheme] !== undefined) {
    request.port = DEFAULT_PORTS[scheme];
  }
  return request;
}

/** 策略文件路径（<dataDir>/config/egress-policy.json） */
export function egressPolicyPath(dataDir?: string): string {
  return join(getDataDir(dataDir), EGRESS_POLICY_FILE);
}

/**
 * 读取出站白名单声明（对齐 G10 loadDeviceDataPolicy 的 fail-closed 纪律）。
 *
 * 文件不存在 / JSON 损坏 / 结构非法 → 返回 null（调用方按「无策略 = 全拒」处理）。
 * 损坏时 console.warn 留证（不静默）但不抛异常（策略读取失败只阻断放行，不阻断启动）。
 * 非法 host 条目剔除，不整表丢弃（同 G10 纪律）。
 */
export function loadEgressPolicy(dataDir?: string): EgressPolicy | null {
  const p = egressPolicyPath(dataDir);
  if (!existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf-8'));
  } catch (err) {
    console.warn(
      `[egress-policy] 配置损坏（${p}）：${err instanceof Error ? err.message : String(err)}——按空策略处理（全拒）`,
    );
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const cfg = raw as Partial<EgressPolicy>;
  if (!Array.isArray(cfg.hosts)) return null;
  const policy = declareEgressHosts(cfg.hosts as Array<string | EgressHostRule>, {
    subject: typeof cfg.subject === 'string' ? cfg.subject : undefined,
    version: typeof cfg.version === 'number' ? cfg.version : EGRESS_POLICY_VERSION,
  });
  return policy;
}

/**
 * 写入出站白名单声明（FDE 声明面 / 运维增删，对齐 G10 saveDeviceDataPolicy）。
 * 目录 0o700 / 文件 0o600（白名单本身是安全配置面——权限收紧）。
 */
export function saveEgressPolicy(policy: EgressPolicy, dataDir?: string): void {
  const p = egressPolicyPath(dataDir);
  const dir = join(p, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(p, JSON.stringify(policy, null, 2), 'utf-8');
  try {
    chmodSync(p, 0o600);
  } catch {
    /* 为何可静默：非 POSIX 平台（Windows）无 chmod 语义，权限收紧为尽力而为，失败不阻断写入主流程 */
  }
}
