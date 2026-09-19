// ============================================================
// router-session-push.ts · MCP tool：router 过站 session 推送（v1.5.0 T7）
// ============================================================
//
// 伴生 exporter 的引擎侧承接入口（最后一个新 tool：103→1.5\11：
//   schema 校验（fail-closed：格式不合法拒绝入库）→ 会话续接五元组
//   判定 → 脱敏 → 本地落盘（数据主权铁律——记录不出企业边界）→
//   usage 入 cost 台账 → key 维度过站行为 HMAC 挂链（审计）→ 计量。
//
// 落盘布局（data/<enterpriseId>/router-sessions/<sessionId>.jsonl——
// 一会话一文件，多窗记录逐行 append；幂等：同 sessionId 已存在拒绝）。
// ============================================================

import {
  mkdirSync,
  existsSync,
  appendFileSync,
  appendFileSync as appendAudit,
  readdirSync,
  readFileSync,
} from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';
import {
  validateRouterSession,
  expandSessionToRecords,
  usageToCostEntry,
  aggregateByKeyUsage,
  detectKeyAnomalies,
} from '@sofagent/train';
import { getDataDir, redact, loadRedactRules, getHmacKey } from '@sofagent/core';

/** 推送结果（结构化） */
export interface RouterSessionPushResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    reason?: 'invalid-schema' | 'duplicate-session' | 'write-failed' | 'invalid-params';
    message: string;
    /** 展开记录数（切窗后） */
    recordCount?: number;
    /** 会话文件落盘路径 */
    sessionFile?: string;
    /** cost 台账入账行路径 */
    costLedgerFile?: string;
    auditLogged: boolean;
  };
}

/** cost 台账路径：data/<enterpriseId>/cost/router-usage.jsonl（append-only） */
function costLedgerPath(dataDir: string, enterpriseId: string): string {
  return join(dataDir, enterpriseId, 'cost', 'router-usage.jsonl');
}

/** 审计链路径：data/audit/router-session-events.jsonl（key 维度过站行为 HMAC 挂链） */
function auditEventsPath(dataDir: string): string {
  return join(dataDir, 'audit', 'router-session-events.jsonl');
}

/**
 * router session 推送承接（T7 第七章）。
 *
 * @param args.raw exporter 推送 payload（RouterSessionSchema 形态——JSON 对象）
 */
export async function routerSessionPush(args: { raw: unknown }): Promise<RouterSessionPushResult> {
  // ── 参数校验 ──
  if (!args || args.raw === null || typeof args.raw !== 'object') {
    return {
      text: '[sofagent] session 推送失败：参数缺失（raw——exporter payload 对象）',
      data: { isError: true, ok: false, reason: 'invalid-params', message: '参数缺失（raw——exporter payload 对象）', auditLogged: false },
    };
  }

  // ── 1. schema 校验（fail-closed：格式不合法拒绝入库）──
  const validated = validateRouterSession(args.raw);
  if (!validated.valid || !validated.payload) {
    return {
      text: `[sofagent] session 推送拒绝：schema 校验失败（${validated.issues?.join('; ')}）`,
      data: { isError: true, ok: false, reason: 'invalid-schema', message: `schema 校验失败：${validated.issues?.join('; ')}`, auditLogged: false },
    };
  }
  const payload = validated.payload;

  // ── 2. 落盘准备（本地优先——数据主权铁律）──
  const dataDir = getDataDir(undefined);
  const sessionDir = join(dataDir, payload.enterpriseId, 'router-sessions');
  const sessionFile = join(sessionDir, `${payload.sessionId}.jsonl`);
  try {
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  } catch {
    return {
      text: '[sofagent] session 落盘失败：目录创建不可用',
      data: { isError: true, ok: false, reason: 'write-failed', message: '会话目录创建失败', auditLogged: false },
    };
  }
  // 幂等：同 sessionId 已存在拒绝（重复推送不追加）
  if (existsSync(sessionFile)) {
    return {
      text: `[sofagent] session 推送拒绝：会话 ${payload.sessionId} 已承接（幂等——重复推送不追加）`,
      data: { isError: true, ok: false, reason: 'duplicate-session', message: `会话 ${payload.sessionId} 已承接（幂等拒绝）`, auditLogged: false },
    };
  }

  // ── 3. 多轮展开（切窗 + 角色映射）──
  const expanded = expandSessionToRecords(payload);

  // ── 4. 脱敏落盘（每窗记录逐行 append——文本字段过 redact 管线）──
  const rules = loadRedactRules(dataDir);
  try {
    for (const rec of expanded.records) {
      const sanitizedFields: Record<string, string | number | boolean | null> = {};
      for (const [k, v] of Object.entries(rec.fields)) {
        sanitizedFields[k] = typeof v === 'string' ? redact(v, rules).text : v;
      }
      appendFileSync(sessionFile, JSON.stringify({ id: rec.id, source: rec.source, fields: sanitizedFields }) + '\n', 'utf-8');
    }
  } catch {
    return {
      text: '[sofagent] session 落盘失败：写入中断（会话文件可能不完整——同 id 重推将因幂等拒绝，需人工清理后重推）',
      data: { isError: true, ok: false, reason: 'write-failed', message: '会话文件写入失败', auditLogged: false },
    };
  }

  // ── 5. usage 入 cost 台账（按模型/时段聚合口径——append-only 单行）──
  const costEntry = usageToCostEntry(payload);
  const ledger = costLedgerPath(dataDir, payload.enterpriseId);
  let costOk = true;
  try {
    const ledgerDir = join(ledger, '..');
    if (!existsSync(ledgerDir)) mkdirSync(ledgerDir, { recursive: true });
    appendFileSync(ledger, JSON.stringify(costEntry) + '\n', 'utf-8');
  } catch {
    costOk = false; // 台账失败不阻断承接（会话已落盘——主数据优先）；审计登记
  }

  // ── 6. key 维度过站行为 HMAC 挂链（审计留痕）──
  let auditLogged = false;
  try {
    const auditDir = join(dataDir, 'audit');
    if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
    const event = {
      ts: new Date().toISOString(),
      kind: 'router-session-push',
      sessionId: payload.sessionId,
      enterpriseId: payload.enterpriseId,
      source: payload.source,
      key: payload.apiKeyId ?? 'router-anonymous',
      model: payload.usage.model,
      routeTarget: payload.route.targetModel,
      windows: expanded.windows,
      inputTokens: payload.usage.inputTokens,
      outputTokens: payload.usage.outputTokens,
      costUsd: costEntry.costUsd,
      scopeContinuation: expanded.continuation?.mode ?? 'none',
    };
    const hmacKey = getHmacKey();
    const line = hmacKey
      ? JSON.stringify({ ...event, hmacSig: createHmac('sha256', hmacKey).update(JSON.stringify(event)).digest('hex') })
      : JSON.stringify(event); // 无密钥降级明文事件（audit 链同款降级语义——开发/测试环境）
    appendAudit(auditEventsPath(dataDir), line + '\n', 'utf-8');
    auditLogged = true;
  } catch {
    auditLogged = false; // best-effort 显式标注
  }

  return {
    text: `[sofagent] ✅ session 承接入库（${payload.sessionId} · ${expanded.windows} 窗 · ${payload.usage.model} · token ${payload.usage.inputTokens}+${payload.usage.outputTokens}${costOk ? ' · 已入 cost 台账' : ' · ⚠ 台账写入失败（已审计登记）'}）`,
    data: {
      isError: false,
      ok: true,
      message: `承接成功（${expanded.records.length} 条记录 / ${expanded.windows} 窗）`,
      recordCount: expanded.records.length,
      sessionFile,
      ...(costOk ? { costLedgerFile: ledger } : {}),
      auditLogged,
    },
  };
}

/** key 维度 harness 四件查询面（伴生导出——巡检入口消费） */
export function keyHarnessSnapshot(
  dataDir: string,
  thresholds?: Parameters<typeof detectKeyAnomalies>[2],
): {
  aggregates: Array<{ apiKeyId: string; totalTokens: number; totalCalls: number; totalCostUsd: number; byModel: Record<string, number> }>;
  anomalies: ReturnType<typeof detectKeyAnomalies>;
} {
  // 读全企业 cost 台账——简化扫 data/<enterpriseId>/cost/router-usage.jsonl
  const entries: Array<{ apiKeyId: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; ts: string }> = [];
  let enterprises: string[] = [];
  try {
    enterprises = readdirSync(dataDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    enterprises = [];
  }
  for (const ent of enterprises) {
    const p = costLedgerPath(dataDir, ent);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        entries.push(JSON.parse(t) as (typeof entries)[number]);
      } catch {
        /* 为何可静默：JSONL 逐行解析的坏行跳过——单行损坏不阻断其余样本落盘（与 sample-aggregator parseJsonl 同纪律） */
      }
    }
  }
  const aggregates = aggregateByKeyUsage(entries);
  // 异常检测：今日 vs 昨日（ts 简化为全量 vs 空——生产装配按日切片注入）
  return {
    aggregates: [...aggregates.values()],
    anomalies: detectKeyAnomalies(aggregates, new Map(), thresholds),
  };
}
