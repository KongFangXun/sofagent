// ============================================================
// router-session-push.ts · MCP tool：router 过站 session 推送（v1.5.2 T7）
// ============================================================
//
// 伴生 exporter 的引擎侧承接入口（最后一个新 tool：103→1.5.211：
//   schema 校验（fail-closed：格式不合法拒绝入库）→ 会话续接五元组
//   判定 → 脱敏 → 本地落盘（数据主权铁律——记录不出企业边界）→
//   usage 入 cost 台账 → key 维度过站行为 HMAC 挂链（审计）→ 计量。
//
// 落盘布局（data/<enterpriseId>/router-sessions/<sessionId>.jsonl——
// 一会话一文件，多窗记录逐行 append；幂等：同 sessionId 已存在拒绝）。
//
// v1.5.1 第六章接线：第 4 步「脱敏落盘」升级为**三层敏感检测插槽管线**
// （L0 正则 → L1 词典 → L2 外挂 NER，判定本体零改动）——与设备上行
// （device-data-push）同一份管线实现；分流决策随审计事件入链。既有
// schema 校验、幂等、cost 台账、HMAC 挂链**保持原样**。
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
import { getDataDir, loadRedactRules, getHmacKey, type SensitivityLevel } from '@sofagent/core';
import {
  runUpstreamSensitivityPipeline,
  resolveUpstreamCanaryRoute,
  type GlossaryNarrowing,
  type UpstreamWiringOptions,
} from './device-data-push';

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
 * @param args.wiring 三层检测插槽 / 灰度分流接线选项（缺省从配置面解析——
 *        非必填：MCP 入参面不变，装配侧可注入 L2 端点 / 灰度配置覆盖）
 */
export async function routerSessionPush(args: {
  raw: unknown;
  wiring?: UpstreamWiringOptions;
}): Promise<RouterSessionPushResult> {
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

  // ── 4. 三层敏感检测插槽 + 脱敏落盘（每窗记录逐行 append）──
  // v1.5.1 第六章接线：文本字段逐字段过同一份插槽管线（与设备上行同语义）。
  // 逐字段而非整包的原因：插槽 span 的偏移绑定待检文本，跨字段复用 span
  // 会串位（错位既漏脱敏又串改文本）。
  // 会话级判定 = 各字段判定取最高档（sensitive > internal > public）——
  // 这是**聚合**不是判定：判定本体仍是 classifySensitivity（逐字段调用，
  // 内部实现零改动），聚合只决定审计留痕写哪一条 routeReason。
  const rules = loadRedactRules(dataDir);
  const LEVEL_RANK: Record<SensitivityLevel, number> = { public: 0, internal: 1, sensitive: 2 };
  let sessionLevel: SensitivityLevel = 'public';
  let sessionReason = '';
  let sessionHitCount = 0;
  let sessionRedactHits = 0;
  const sessionDegraded: Array<{ detector: string; reason: string }> = [];
  const sessionL2Errors = new Set<string>();
  const sessionDetectors = new Set<string>();
  // L1 词典窄化统计：配置侧计数逐字段相同（同一份 rules）→ 取首个即可；
  // 缺口命中（missed）逐字段并集——本会话任一字段落入缺口都要上链
  let sessionNarrowed: GlossaryNarrowing | undefined;
  const sessionNarrowedMisses = new Map<string, GlossaryNarrowing['missed'][number]['category']>();
  try {
    for (const rec of expanded.records) {
      const sanitizedFields: Record<string, string | number | boolean | null> = {};
      for (const [k, v] of Object.entries(rec.fields)) {
        if (typeof v !== 'string') {
          sanitizedFields[k] = v;
          continue;
        }
        if (v === '') {
          sanitizedFields[k] = v; // 空字段无内容可检——不空跑管线
          continue;
        }
        const field = await runUpstreamSensitivityPipeline({
          text: v,
          rules,
          dataDir,
          ...(args.wiring ? { opts: args.wiring } : {}),
        });
        sessionRedactHits += field.redactHits;
        sessionHitCount += field.decision.hitCount;
        for (const d of field.degraded) sessionDegraded.push(d);
        if (field.l2PrefetchError) sessionL2Errors.add(field.l2PrefetchError);
        if (!sessionNarrowed) sessionNarrowed = field.glossaryNarrowed;
        for (const m of field.glossaryNarrowed.missed) sessionNarrowedMisses.set(`${m.category}@${m.tag}`, m.category);
        for (const d of field.detectors) sessionDetectors.add(`${d.name}:${d.layer}`);
        if (sessionReason === '' || LEVEL_RANK[field.decision.level] > LEVEL_RANK[sessionLevel]) {
          sessionLevel = field.decision.level;
          sessionReason = field.routeReasonSanitized;
        }
        sanitizedFields[k] = field.text;
      }
      appendFileSync(sessionFile, JSON.stringify({ id: rec.id, source: rec.source, fields: sanitizedFields }) + '\n', 'utf-8');
    }
  } catch {
    return {
      text: '[sofagent] session 落盘失败：写入中断（会话文件可能不完整——同 id 重推将因幂等拒绝，需人工清理后重推）',
      data: { isError: true, ok: false, reason: 'write-failed', message: '会话文件写入失败', auditLogged: false },
    };
  }

  // ── 4b. 灰度分流（上行采样数据经 canary hash 稳定分流——分流键 = sessionId）──
  const canaryRoute = await resolveUpstreamCanaryRoute({
    routeKey: payload.sessionId,
    dataDir,
    ...(args.wiring ? { opts: args.wiring } : {}),
  });

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
      // v1.5.1 第六章接线留痕：三层检测判定 + 灰度分流决策（routeReason 可解释）
      sensitivityLevel: sessionLevel,
      sensitivityRouteReason: sessionReason,
      wiringEvidence: [
        `redactHits=${sessionRedactHits}`,
        `sensitivityLevel=${sessionLevel}`,
        `sensitivityHitCount=${sessionHitCount}`,
        `sensitivityRouteReason=${sessionReason}`,
        `detectors=${[...sessionDetectors].join('|')}`,
        `l2Degraded=${sessionDegraded.length > 0 ? sessionDegraded.map((d) => `${d.detector}：${d.reason}`).join('|') : 'none'}`,
        ...(sessionL2Errors.size > 0 ? [`l2DegradedReason=${[...sessionL2Errors].join('|')}`] : []),
        // L1 词典窄化可见化（口径比配置窄时必须能从链上看出——不默默通过）
        `glossaryNarrowed=${
          sessionNarrowed && (sessionNarrowed.droppedShort > 0 || sessionNarrowed.asciiWordBoundary > 0)
            ? `droppedShort:${sessionNarrowed.droppedShort};asciiWordBoundary:${sessionNarrowed.asciiWordBoundary}`
            : 'none'
        }`,
        `glossaryNarrowedMiss=${sessionNarrowedMisses.size > 0 ? [...sessionNarrowedMisses.keys()].join('|') : 'none'}`,
        ...canaryRoute.evidence,
      ],
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
