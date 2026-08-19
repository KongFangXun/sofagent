// ============================================================
// gateway/proxy-gateway.ts · SubAgent 代理网关硬边界（唯一出入口）
// v1.3.8 交付一 新增
//
// 设计（changelog v1.3.8 §一）：
//   SubAgent → [代理网关：判定链 + 四防 + WAL + HITL] → 外部服务
//
// 判定链（顺序固定，先廉后贵）：
//   1. 启动完整性自检（防绕过——自检不过网关拒绝服务）
//   2. 请求伪造校验（agentId 必须是注册身份——fail-closed）
//   3. DDoS 限速（token bucket，自实现计数窗口，零依赖）
//   4. 网络白名单（复用 v1.3.7 sandbox/network-gateway——本网关是它的
//      上层包装，不是替代）
//   5. 权限上界（permission-ceiling：首次锁定只减不增，越界 deny）
//   6. 风险分级阈值（低/中放行，高 deny，极高挂 HITL）
//
// 四防：
//   - 防绕过：SubAgent 进程出站全部经 network-gateway 强制（monkey-patch，
//     v1.3.7 已交付）；本层补「网关启动完整性自检」——审计不可写即拒绝服务
//   - 防 DDoS：token bucket 限速（自实现滑动窗口计数，不引依赖）
//   - 防伪造：请求强制带 agentId，网关校验与注册身份一致
//   - 防日志注入：审计写入前 sanitize（控制字符转义 + 密钥打码），append-only
//
// 审计：所有请求 + 判定 + 结果落 {dataDir}/gateway/audit.jsonl
//   （append-only JSONL，写入前密钥脱敏：sk-* / AKIA* / password= 等打码）
//
// HITL：极高风险 → 写 {dataDir}/gateway/pending/{id}.json（请求快照 + reason）
//   → 返回挂起状态；resolve(approve) → 放行；resolve(reject) → deny + 审计。
//   （底层复用 hitl/ 的 pending/resolved 目录范式，但独立目录避免与 LOOP
//   human_confirm 的 checkpoint 冲突——网关 checkpoint 命名 gw- 前缀）
//
// WAL 集成（交付三接线点）：execute() 在执行 executor 前后写 WAL
//   （begin → 执行 → commit/abort）。本版通过 options.wal 注入，
//   durable/wal-writer.ts 交付后由调用方接线。
//
// 零 npm 依赖——Node 内建 fs/crypto + 复用仓库内既有模块。
// ============================================================

import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

import { createNetworkGateway, type NetworkGateway } from '../sandbox/network-gateway';
import { createPermissionCeiling, type PermissionCeiling } from './permission-ceiling';

// ────────────────────────────────
// 类型定义
// ────────────────────────────────

/** 动作类型（与 permission/scenario-router ActionType 对齐） */
export type ProxyAction = 'read' | 'write' | 'delete' | 'export';

/** 风险等级（低=GET 公开 API / 中=POST 业务 / 高=写数据库 / 极高=转账删除外传） */
export type ProxyRisk = 'low' | 'medium' | 'high' | 'critical';

/** 网关请求数据 */
export interface ProxyRequest {
  /** 请求者身份（v1.3.1 身份码派生的 agent ID——防伪造维度） */
  agentId: string;
  /** 所需工具名（权限上界校验维度） */
  tool: string;
  /** 动作类型（风险分级维度） */
  action: ProxyAction;
  /** 外部目标（网络白名单维度） */
  target: { host: string; port: number; protocol: 'http' | 'https' | 'dns' | 'tcp' | 'udp' | 'other' };
  /** 调用参数（审计留痕——写入前脱敏） */
  params: Record<string, unknown>;
}

/** 判定决策 */
export type ProxyDecision = 'allow' | 'deny' | 'hitl-pending';

/** 判定结果 */
export interface ProxyResult {
  decision: ProxyDecision;
  /** 判定依据（deny 时含原因——审计与调用方提示共用） */
  reason?: string;
  /** 风险分级结果 */
  risk?: ProxyRisk;
  /** hitl-pending 时的 checkpoint ID（resolve 用） */
  checkpointId?: string;
  /** approve resolve 后回传的原请求快照 */
  request?: ProxyRequest;
  /** execute() 成功路径的执行结果 */
  result?: unknown;
}

/** HITL 决策 */
export type GatewayHITLDecision = 'approve' | 'reject';

/** 挂起的 HITL checkpoint（listPending 出口） */
export interface GatewayPendingCheckpoint {
  checkpointId: string;
  agentId: string;
  createdAt: string;
  reason: string;
  request: ProxyRequest;
}

/** WAL 接线点（交付三实现——网关 begin→执行→commit/abort） */
export interface GatewayWalHook {
  begin(taskId: string, tool: string, params: Record<string, unknown>): void;
  commit(taskId: string): void;
  abort(taskId: string, reason: string): void;
}

/** 限速配置（token bucket——自实现计数窗口） */
export interface RateLimitConfig {
  /** 计数窗口（ms，默认 60s） */
  windowMs: number;
  /** 窗口内最大请求数（默认 600） */
  maxRequests: number;
}

export interface ProxyGatewayOptions {
  /** 数据目录（审计/挂起 checkpoint 落盘根） */
  dataDir: string;
  /** 网络白名单（透传 network-gateway；默认空——fail-closed） */
  allowHosts?: string[];
  /** 注册的 agent 身份 → 初始授权工具集（权限上界首次锁定来源） */
  agents?: Record<string, string[]>;
  /** 风险阈值：≥ 此风险 deny（默认 'high'——low/medium 放行） */
  denyAboveRisk?: ProxyRisk;
  /** token bucket 限速 */
  rateLimit?: Partial<RateLimitConfig>;
  /** 权限上界（可注入自定义实例；默认新建） */
  ceiling?: PermissionCeiling;
  /** 网络网关（可注入 mock；默认新建） */
  networkGateway?: NetworkGateway;
  /** WAL 钩子（交付三接线；不注入时 execute 不写 WAL） */
  wal?: GatewayWalHook;
}

/** 审计条目（append-only JSONL 每行一条） */
interface AuditEntry {
  ts: string;
  event: 'request' | 'hitl-resolve';
  agentId: string;
  decision?: ProxyDecision;
  reason?: string;
  risk?: ProxyRisk;
  /** hitl-resolve 事件关联的 checkpoint ID */
  checkpointId?: string;
  request?: ProxyRequest;
}

// ────────────────────────────────
// 风险分级
// ────────────────────────────────

/** 动作基线风险：读低 / 写中 / 删与外传极高（高危语义在 TOOL_RISK_OVERRIDES 叠加） */
const ACTION_BASE_RISK: Record<ProxyAction, ProxyRisk> = {
  read: 'low',
  write: 'medium',
  delete: 'critical',
  export: 'critical',
};

/**
 * 工具名风险覆写表——业务语义叠加在动作基线上（只升不降）。
 * - 数据库写：中 → 高（核心资产）
 * - 转账/删除/永久性操作：→ 极高（不可逆资金/数据面）
 */
const TOOL_RISK_OVERRIDES: { match: RegExp; risk: ProxyRisk }[] = [
  { match: /(^|_)(db|sql|database)(_|\.|$)/i, risk: 'high' },
  { match: /transfer|payment|pay\b|转账|打款/i, risk: 'critical' },
  { match: /(^|_)(delete|drop|destroy|purge|wipe|rm)(_|\.|$)/i, risk: 'critical' },
];

const RISK_ORDER: ProxyRisk[] = ['low', 'medium', 'high', 'critical'];

/**
 * 风险分级（纯函数）。
 *
 * 规则：动作基线（读低/写中/删·外传极高）与工具语义覆写取**较高者**。
 * 例：`db_write`（action=write 基线 medium，工具名含 db → high）= high；
 *      `bank_transfer`（action=write 基线 medium，工具名含 transfer → critical）= critical。
 */
export function classifyRequestRisk(req: Pick<ProxyRequest, 'tool' | 'action'>): ProxyRisk {
  let risk = ACTION_BASE_RISK[req.action] ?? 'medium'; // 未知动作按中风险（fail-safe 不放行过低）
  for (const { match, risk: override } of TOOL_RISK_OVERRIDES) {
    if (match.test(req.tool)) {
      if (RISK_ORDER.indexOf(override) > RISK_ORDER.indexOf(risk)) risk = override;
    }
  }
  return risk;
}

// ────────────────────────────────
// 审计脱敏（防日志注入 + 密钥打码）
// ────────────────────────────────

/** 密钥打码正则（简单 regex——sk-* / AKIA* / password= 三族，覆盖常见泄漏面）
 *  ⚠️ 值字符类排除 " 与 \——打码作用于 JSON 序列化后的整行，吞掉结尾引号
 *     会破坏单行 JSON 结构（脱敏不能自己制造注入面——sanitize 的自反性要求）。 */
const SECRET_REDACT_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /sk-[a-zA-Z0-9_\-]{8,}/g, replacement: 'sk-***REDACTED***' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA***REDACTED***' },
  { pattern: /(password|passwd|pwd|secret|token)\s*[=:]\s*[^"\\\s,;]+/gi, replacement: '$1=***REDACTED***' },
];

/**
 * 审计安全序列化——防日志注入 + 密钥脱敏。
 *
 * 1. 先 JSON.stringify 成单行（天然转义 \n \r——注入的换行伪造不出新审计行）
 * 2. 再对整行做密钥打码（regex 替换）——打码发生在字符串层，
 *    序列化后的转义形态（如 \u0041）不逃逸打码
 */
export function sanitizeForAudit(value: unknown): string {
  let line = JSON.stringify(value) ?? 'null';
  for (const { pattern, replacement } of SECRET_REDACT_PATTERNS) {
    line = line.replace(pattern, replacement);
  }
  return line;
}

// ────────────────────────────────
// 网关实现
// ────────────────────────────────

/** 审计文件相对路径：{dataDir}/gateway/audit.jsonl */
export const GATEWAY_AUDIT_REL = 'gateway/audit.jsonl';
/** HITL 挂起目录：{dataDir}/gateway/pending/ */
export const GATEWAY_PENDING_DIR_REL = 'gateway/pending';

export interface ProxyGateway {
  /** 判定一次请求（不执行——守卫先于执行） */
  checkRequest(req: ProxyRequest): ProxyResult;
  /** 判定 + 执行（allow 时执行 executor；WAL begin→执行→commit/abort） */
  execute<T>(req: ProxyRequest, executor: () => Promise<T>): Promise<ProxyResult & { result?: T }>;  /** HITL 决策入口：approve → 原请求放行；reject → deny + 审计 */
  resolve(checkpointId: string, decision: GatewayHITLDecision): ProxyResult;
  /** 列出挂起的 HITL checkpoint */
  listPending(): GatewayPendingCheckpoint[];
  /** 启动完整性自检（防绕过——审计不可写时网关拒绝服务） */
  integrityCheck(): { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] };
  /** 审计路径导出（观测/测试用） */
  auditPath(): string;
}

/**
 * 创建代理网关。
 *
 * @param options 配置（见 ProxyGatewayOptions）
 */
export function createProxyGateway(options: ProxyGatewayOptions): ProxyGateway {
  const dataDir = options.dataDir;
  const auditFilePath = join(dataDir, GATEWAY_AUDIT_REL);
  const pendingDirPath = join(dataDir, GATEWAY_PENDING_DIR_REL);

  const denyAboveRisk: ProxyRisk = options.denyAboveRisk ?? 'high';
  const rateLimit: RateLimitConfig = {
    windowMs: options.rateLimit?.windowMs ?? 60_000,
    maxRequests: options.rateLimit?.maxRequests ?? 600,
  };

  const network: NetworkGateway =
    options.networkGateway ?? createNetworkGateway({ allowHosts: options.allowHosts ?? [] });
  const ceiling: PermissionCeiling = options.ceiling ?? createPermissionCeiling();

  // 注册身份（防伪造——未注册 agentId 一律 deny）+ 初始授权集
  const registeredAgents = new Map<string, string[]>(
    Object.entries(options.agents ?? {}),
  );

  // token bucket（自实现计数窗口）：每 agent 一个滑窗计数器
  const buckets = new Map<string, { windowStart: number; count: number }>();

  // 完整性自检结果（启动时算一次——防绕过的核心：自检不过拒绝服务）
  let integrity: { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] };

  // ── 审计写入（append-only + sanitize）──
  function appendAudit(entry: AuditEntry): void {
    const line = sanitizeForAudit(entry);
    try {
      mkdirSync(dirname(auditFilePath), { recursive: true });
      appendFileSync(auditFilePath, line + '\n', 'utf-8');
    } catch (err) {
      // 审计写失败 = 网关自身完整性受损——拒绝服务（fail-closed），
      // 由 integrityCheck 在下次请求时兜底（auditWritable 标记翻红）
      integrity.ok = false;
      console.error(`[proxy-gateway] 审计写入失败（网关进入拒绝服务态）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 限速（token bucket 计数窗口）──
  function rateLimitPass(agentId: string): boolean {
    const now = Date.now();
    let bucket = buckets.get(agentId);
    if (!bucket || now - bucket.windowStart >= rateLimit.windowMs) {
      bucket = { windowStart: now, count: 0 };
      buckets.set(agentId, bucket);
    }
    bucket.count += 1;
    return bucket.count <= rateLimit.maxRequests;
  }

  // ── HITL checkpoint 读写 ──
  function writePendingCheckpoint(cp: GatewayPendingCheckpoint): string {
    const filePath = join(pendingDirPath, `${cp.checkpointId}.json`);
    mkdirSync(pendingDirPath, { recursive: true });
    // tmp + rename 原子写（沿用仓库既有范式）
    const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
    writeFileSync(tmp, JSON.stringify(cp, null, 2), 'utf-8');
    // 同目录 rename 原子性足够（跨设备场景不存在——同 dataDir 内）
    try {
      const { renameSync } = require('fs') as typeof import('fs');
      renameSync(tmp, filePath);
    } catch {
      const fsMod = require('fs') as typeof import('fs');
      fsMod.copyFileSync(tmp, filePath);
      fsMod.unlinkSync(tmp);
    }
    return filePath;
  }

  function readPendingCheckpoint(checkpointId: string): GatewayPendingCheckpoint | null {
    const filePath = join(pendingDirPath, `${checkpointId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as GatewayPendingCheckpoint;
    } catch {
      return null;
    }
  }

  function removePendingCheckpoint(checkpointId: string): void {
    const filePath = join(pendingDirPath, `${checkpointId}.json`);
    try {
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch {
      /* 删除失败不阻断 resolve——审计已留痕 */
    }
  }

  // ── 启动完整性自检 ──
  function runIntegrityCheck(): { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } {
    const checks: { name: string; ok: boolean; detail?: string }[] = [];
    // ① 审计可写性（防绕过——审计是判定的证据链，不可写即拒绝服务）
    try {
      mkdirSync(dirname(auditFilePath), { recursive: true });
      appendFileSync(auditFilePath, '', 'utf-8'); // append 空串 = 触达性探测（不产生新行）
      checks.push({ name: 'audit-writable', ok: true });
    } catch (err) {
      checks.push({ name: 'audit-writable', ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
    // ② 网络网关就绪（判定链依赖它做白名单兜底）
    try {
      const verdict = network.check({ host: 'localhost', port: 0, protocol: 'tcp' });
      checks.push({ name: 'network-gateway-ready', ok: verdict === 'allow' });
    } catch (err) {
      checks.push({ name: 'network-gateway-ready', ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
    return { ok: checks.every(c => c.ok), checks };
  }

  integrity = runIntegrityCheck();

  return {
    checkRequest(req) {
      const risk = classifyRequestRisk(req);

      // 判 0：完整性自检（防绕过）——网关自身不可信时拒绝服务
      if (!integrity.ok) {
        const res: ProxyResult = { decision: 'deny', risk, reason: '网关启动完整性自检未通过——拒绝服务（防绕过兜底）' };
        appendAudit({ ts: new Date().toISOString(), event: 'request', agentId: req.agentId, ...res });
        return res;
      }

      // 判 1：防伪造——身份校验
      if (!req.agentId || !registeredAgents.has(req.agentId)) {
        const res: ProxyResult = { decision: 'deny', risk, reason: `agentId 未注册（${req.agentId || '空'}）——请求伪造嫌疑，fail-closed` };
        appendAudit({ ts: new Date().toISOString(), event: 'request', agentId: req.agentId, ...res });
        return res;
      }

      // 判 2：防 DDoS——token bucket 限速
      if (!rateLimitPass(req.agentId)) {
        const res: ProxyResult = { decision: 'deny', risk, reason: `限速：窗口 ${rateLimit.windowMs}ms 内超过 ${rateLimit.maxRequests} 次请求（DDoS 防御）` };
        appendAudit({ ts: new Date().toISOString(), event: 'request', agentId: req.agentId, ...res });
        return res;
      }

      // 判 3：网络白名单（network-gateway 兜底）
      const netVerdict = network.check({
        host: req.target.host,
        port: req.target.port,
        protocol: req.target.protocol,
      });
      if (netVerdict === 'deny') {
        const res: ProxyResult = { decision: 'deny', risk, reason: `目标 ${req.target.host} 不在网络白名单（network-gateway deny）` };
        appendAudit({ ts: new Date().toISOString(), event: 'request', agentId: req.agentId, ...res });
        return res;
      }

      // 判 4：权限上界（首次锁定 + 越界 deny）——越界不中断（仅本次 deny）
      const initialTools = registeredAgents.get(req.agentId)!;
      if (ceiling.ceiling(req.agentId) === null) {
        ceiling.lock(req.agentId, initialTools); // 首次请求锁定快照
      }
      const ceilingRes = ceiling.check(req.agentId, [req.tool]);
      if (!ceilingRes.ok) {
        const res: ProxyResult = { decision: 'deny', risk, reason: `权限越界：工具 ${ceilingRes.excess.join(', ')} 不在会话权限上界内（上界只减不增）` };
        appendAudit({ ts: new Date().toISOString(), event: 'request', agentId: req.agentId, ...res });
        return res;
      }

      // 判 5：风险阈值（低/中放行；高 deny；极高挂 HITL）
      if (risk === 'critical') {
        const checkpointId = `gw-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
        const cp: GatewayPendingCheckpoint = {
          checkpointId,
          agentId: req.agentId,
          createdAt: new Date().toISOString(),
          reason: `极高风险（critical）操作需人工批准：${req.tool}（动作 ${req.action}）`,
          request: req,
        };
        writePendingCheckpoint(cp);
        const res: ProxyResult = { decision: 'hitl-pending', risk, checkpointId, reason: cp.reason };
        appendAudit({ ts: new Date().toISOString(), event: 'request', agentId: req.agentId, ...res });
        return res;
      }
      if (RISK_ORDER.indexOf(risk) >= RISK_ORDER.indexOf(denyAboveRisk)) {
        const res: ProxyResult = { decision: 'deny', risk, reason: `风险等级 ${risk} 超过阈值（denyAboveRisk=${denyAboveRisk}）` };
        appendAudit({ ts: new Date().toISOString(), event: 'request', agentId: req.agentId, ...res });
        return res;
      }

      // 放行
      const res: ProxyResult = { decision: 'allow', risk };
      appendAudit({ ts: new Date().toISOString(), event: 'request', agentId: req.agentId, ...res, request: req });
      return res;
    },

    async execute<T>(req: ProxyRequest, executor: () => Promise<T>): Promise<ProxyResult & { result?: T }> {
      const verdict = this.checkRequest(req);
      if (verdict.decision !== 'allow') {
        return verdict as ProxyResult & { result?: T }; // deny / hitl-pending 不执行（守卫先于执行）——result 天然缺省
      }
      const wal = options.wal;
      if (wal) wal.begin(req.agentId, req.tool, req.params);
      try {
        const result = await executor();
        if (wal) wal.commit(req.agentId);
        return { ...verdict, result };
      } catch (err) {
        if (wal) wal.abort(req.agentId, err instanceof Error ? err.message : String(err));
        throw err; // 不吞错误——调用方决定重试/上报
      }
    },

    resolve(checkpointId, decision) {
      const cp = readPendingCheckpoint(checkpointId);
      if (!cp) {
        throw new Error(`HITL checkpoint ${checkpointId} 不存在（已 resolve 或从未挂起）`);
      }
      removePendingCheckpoint(checkpointId);
      if (decision === 'approve') {
        const res: ProxyResult = {
          decision: 'allow',
          risk: 'critical', // approve 放行的原是极高风险请求
          reason: `HITL 人工批准放行（checkpoint ${checkpointId}）`,
          request: cp.request,
        };
        appendAudit({ ts: new Date().toISOString(), event: 'hitl-resolve', agentId: cp.agentId, decision: 'allow', checkpointId, reason: res.reason });
        return res;
      }
      const res: ProxyResult = {
        decision: 'deny',
        risk: 'critical',
        reason: `HITL 人工驳回（checkpoint ${checkpointId}）：${cp.reason}`,
        request: cp.request,
      };
      appendAudit({ ts: new Date().toISOString(), event: 'hitl-resolve', agentId: cp.agentId, decision: 'deny', checkpointId, reason: res.reason });
      return res;
    },

    listPending() {
      if (!existsSync(pendingDirPath)) return [];
      const out: GatewayPendingCheckpoint[] = [];
      for (const name of readdirSync(pendingDirPath)) {
        if (!name.endsWith('.json')) continue;
        const cp = readPendingCheckpoint(name.replace(/\.json$/, ''));
        if (cp) out.push(cp);
      }
      return out;
    },

    integrityCheck() {
      return { ...integrity, checks: [...integrity.checks] };
    },

    auditPath() {
      return auditFilePath;
    },
  };
}
