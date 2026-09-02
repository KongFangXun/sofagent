// ============================================================
// sample-aggregator.ts · v1.4.4 第一章 · 五源 + 轨迹聚合 + 脱敏 + 标签
//
// 训练语料第三件（最值钱的部分）——带标签审计样本聚合导出。
// 五源落点（changelog 表下注 B，2026-09-01 实测）：
//   1. decision-log   data/audit/decision-log.jsonl（audit 包）
//   2. llm-calls      data/audit/runtime/llm-calls.jsonl（core 包 llm-call-trace.ts 落盘，异名注意）
//   3. evaluation-log data/<project>/benchmarks/<id>/evaluation-log.jsonl（orchestrator 包）
//   4. runtime-audit  data/audit/runtime/<repo-hash>/runtime-audit.jsonl（FORGE 侧产物——引擎侧 v1.4.7 补）
//   5. fde-session    data/fde/sessions/<sessionId>/（context.md + meta.json）
//
// 合规红线（changelog 定）：仅脱敏聚合不落个体级——字段白名单制
// （ruleId/ruleType/severity/token 数/耗时/失败码/脱敏后文本模式），
// 黑名单字段（原始 API 响应体/密钥值/企业专名/用户可识别信息）不导。
// ============================================================

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { redact, loadRedactRules, verifyNoLeak, type RedactRulesConfig } from './redactor';

/** 样本源标识 */
export type SampleSource = 'decision-log' | 'llm-calls' | 'evaluation-log' | 'runtime-audit' | 'fde-session';

/** 单条聚合样本（白名单字段制——黑名单字段不进结构） */
export interface AggregatedSample {
  source: SampleSource;
  /** 源文件相对路径（聚合可溯——不含 dataDir 前缀） */
  origin: string;
  /** 样本标签（PASS/FAIL/HITL/decision/trace——按源形态） */
  label: string;
  /** ruleId（audit 类源有） */
  ruleId?: string;
  /** 严重度（audit 类源有） */
  severity?: string;
  /** token 数（llm-calls/evaluation 源有） */
  tokens?: number;
  /** 耗时毫秒（有时序的源有） */
  durationMs?: number;
  /** 失败码（FAIL 样本有） */
  failureCode?: string;
  /** 脱敏后文本模式（白名单核心字段——已过 redact 管线） */
  textPattern: string;
}

/** 聚合导出结果 */
export interface AggregationResult {
  schemaVersion: 'v1';
  exportedAt: string;
  /** 各源样本数（在位且有数据的源） */
  sourceCounts: Record<string, number>;
  /** 缺席源（路径不存在或空——fde-session 尚无数据属常态） */
  absentSources: SampleSource[];
  samples: AggregatedSample[];
  /** 人工基准样本（FDE 梳理产物——source: 'human-fde' 标记） */
  humanBaselineCount: number;
  /** 脱敏验收（企业专名 0 命中检查——leaked 非空即验收不过） */
  redactionCheck: { clean: boolean; leaked: string[] };
}

/** 安全解析 JSONL（坏行跳过计数） */
function parseJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as Record<string, unknown>); } catch { /* 坏行跳过 */ }
  }
  return out;
}

/** 字符串化防御（未知形态 → 截断字符串） */
function toPattern(v: unknown, maxLen = 400): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? '';
  return s.length > maxLen ? s.slice(0, maxLen) + '…(截断)' : s;
}

/** 数值提取防御（非数值给 undefined） */
function toNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ════════════════════════════════════════
// 五源提取器（每个返回样本数组——字段白名单制）
// ════════════════════════════════════════

function extractDecisionLog(dataDir: string, cfg: RedactRulesConfig): AggregatedSample[] {
  const entries = parseJsonl(join(dataDir, 'audit', 'decision-log.jsonl'));
  return entries.map((e) => {
    const why = toPattern(e.why ?? e.reason ?? '');
    return {
      source: 'decision-log' as const,
      origin: 'audit/decision-log.jsonl',
      label: typeof e.decision === 'string' ? e.decision : 'decision',
      ...(typeof e.ruleId === 'string' ? { ruleId: e.ruleId } : {}),
      ...(typeof e.severity === 'string' ? { severity: e.severity } : {}),
      ...(toNum(e.tokens) !== undefined ? { tokens: toNum(e.tokens) } : {}),
      ...(toNum(e.durationMs) !== undefined ? { durationMs: toNum(e.durationMs) } : {}),
      textPattern: redact(why, cfg).text,
    };
  });
}

function extractLlmCalls(dataDir: string, cfg: RedactRulesConfig): AggregatedSample[] {
  const entries = parseJsonl(join(dataDir, 'audit', 'runtime', 'llm-calls.jsonl'));
  return entries.map((e) => {
    const prompt = toPattern(e.prompt ?? e.input ?? '');
    return {
      source: 'llm-calls' as const,
      origin: 'audit/runtime/llm-calls.jsonl',
      label: typeof e.status === 'string' ? e.status : (typeof e.ok === 'boolean' ? (e.ok ? 'ok' : 'error') : 'trace'),
      ...(toNum(e.totalTokens) !== undefined || toNum(e.tokens) !== undefined
        ? { tokens: toNum(e.totalTokens) ?? toNum(e.tokens) }
        : {}),
      ...(toNum(e.durationMs) !== undefined ? { durationMs: toNum(e.durationMs) } : {}),
      ...(typeof e.errorCode === 'string' ? { failureCode: e.errorCode } : {}),
      textPattern: redact(prompt, cfg).text,
    };
  });
}

function extractEvaluationLogs(dataDir: string, cfg: RedactRulesConfig): AggregatedSample[] {
  const out: AggregatedSample[] = [];
  const benchRoot = join(dataDir, 'benchmarks');
  // evaluation-log 在 data/<project>/benchmarks/<benchmark_id>/ 下——两级扫描
  const projectsRoot = dataDir;
  if (!existsSync(projectsRoot)) return out;
  let projects: string[] = [];
  try { projects = readdirSync(projectsRoot).filter((d) => existsSync(join(projectsRoot, d, 'benchmarks'))); } catch { return out; }
  for (const proj of projects) {
    const benchDir = join(projectsRoot, proj, 'benchmarks');
    let ids: string[] = [];
    try { ids = readdirSync(benchDir); } catch { continue; }
    for (const id of ids) {
      const entries = parseJsonl(join(benchDir, id, 'evaluation-log.jsonl'));
      for (const e of entries) {
        out.push({
          source: 'evaluation-log',
          origin: `${proj}/benchmarks/${id}/evaluation-log.jsonl`,
          label: typeof e.passed === 'boolean' ? (e.passed ? 'PASS' : 'FAIL') : (typeof e.verdict === 'string' ? e.verdict : 'evaluated'),
          ...(typeof e.caseId === 'string' ? { ruleId: e.caseId } : {}),
          ...(toNum(e.tokens) !== undefined ? { tokens: toNum(e.tokens) } : {}),
          ...(toNum(e.durationMs) !== undefined ? { durationMs: toNum(e.durationMs) } : {}),
          ...(typeof e.failureCode === 'string' ? { failureCode: e.failureCode } : {}),
          textPattern: redact(toPattern(e.summary ?? e.output ?? ''), cfg).text,
        });
      }
    }
  }
  void benchRoot;
  return out;
}

function extractRuntimeAudit(dataDir: string, cfg: RedactRulesConfig): AggregatedSample[] {
  // FORGE 侧产物：data/audit/runtime/<repo-hash>/runtime-audit.jsonl
  const out: AggregatedSample[] = [];
  const rtRoot = join(dataDir, 'audit', 'runtime');
  if (!existsSync(rtRoot)) return out;
  let hashes: string[] = [];
  try { hashes = readdirSync(rtRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const h of hashes) {
    const entries = parseJsonl(join(rtRoot, h, 'runtime-audit.jsonl'));
    for (const e of entries) {
      out.push({
        source: 'runtime-audit',
        origin: `audit/runtime/${h}/runtime-audit.jsonl`,
        label: typeof e.verdict === 'string' ? e.verdict : (typeof e.result === 'string' ? e.result : 'audit'),
        ...(typeof e.ruleId === 'string' ? { ruleId: e.ruleId } : {}),
        ...(typeof e.severity === 'string' ? { severity: e.severity } : {}),
        ...(toNum(e.tokens) !== undefined ? { tokens: toNum(e.tokens) } : {}),
        ...(toNum(e.durationMs) !== undefined ? { durationMs: toNum(e.durationMs) } : {}),
        ...(typeof e.failureCode === 'string' ? { failureCode: e.failureCode } : {}),
        textPattern: redact(toPattern(e.detail ?? e.event ?? ''), cfg).text,
      });
    }
  }
  return out;
}

function extractFdeSessions(dataDir: string, cfg: RedactRulesConfig): AggregatedSample[] {
  // 人工基准源（human-fde）：data/fde/sessions/<sessionId>/meta.json + context.md
  const out: AggregatedSample[] = [];
  const root = join(dataDir, 'fde', 'sessions');
  if (!existsSync(root)) return out;
  let sids: string[] = [];
  try { sids = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const sid of sids) {
    const metaPath = join(root, sid, 'meta.json');
    const ctxPath = join(root, sid, 'context.md');
    const meta = existsSync(metaPath) ? (() => { try { return JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, unknown>; } catch { return null; } })() : null;
    const ctx = existsSync(ctxPath) ? readFileSync(ctxPath, 'utf-8') : '';
    out.push({
      source: 'fde-session',
      origin: `fde/sessions/${sid}/`,
      // 人工基准标记（changelog：FDE 梳理 = ground truth）
      label: 'human-fde',
      ...(meta && typeof meta.enterpriseId === 'string' ? { ruleId: meta.enterpriseId } : {}),
      textPattern: redact(toPattern(ctx, 2000), cfg).text,
    });
  }
  return out;
}

// ════════════════════════════════════════
// 主入口
// ════════════════════════════════════════

/**
 * 五源聚合 + 脱敏 + 标签。
 *
 * @param dataDir 数据根（缺省 SOFAGENT_DATA 或 'data'）
 * @param cfg 脱敏配置（缺省读 <dataDir>/config/redact-rules.json）
 */
export function aggregateSamples(dataDir?: string, cfg?: RedactRulesConfig): AggregationResult {
  const base = dataDir ?? process.env.SOFAGENT_DATA ?? 'data';
  const config = cfg ?? loadRedactRules(base);

  const extractors: Array<[SampleSource, () => AggregatedSample[]]> = [
    ['decision-log', () => extractDecisionLog(base, config)],
    ['llm-calls', () => extractLlmCalls(base, config)],
    ['evaluation-log', () => extractEvaluationLogs(base, config)],
    ['runtime-audit', () => extractRuntimeAudit(base, config)],
    ['fde-session', () => extractFdeSessions(base, config)],
  ];

  const sourceCounts: Record<string, number> = {};
  const absentSources: SampleSource[] = [];
  let samples: AggregatedSample[] = [];
  for (const [src, fn] of extractors) {
    let got: AggregatedSample[] = [];
    try { got = fn(); } catch { got = []; }
    if (got.length === 0) absentSources.push(src);
    else sourceCounts[src] = got.length;
    samples = samples.concat(got);
  }

  // 人工基准计数（fde-session 源全量标记 human-fde）
  const humanBaselineCount = samples.filter((s) => s.label === 'human-fde').length;

  // 脱敏验收：企业专名（语义类实体库）对全量 textPattern 0 命中
  const entityNames = (config.entities ?? []).map((e) => e.pattern).filter(Boolean);
  const joined = samples.map((s) => s.textPattern).join('\n');
  const check = entityNames.length > 0 ? verifyNoLeak(joined, entityNames) : { clean: true, leaked: [] };

  return {
    schemaVersion: 'v1',
    exportedAt: new Date().toISOString(),
    sourceCounts,
    absentSources,
    samples,
    humanBaselineCount,
    redactionCheck: check,
  };
}
