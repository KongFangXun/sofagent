// ============================================================
// judge-state.ts · 判定 state 的**单一构造入口**（v1.8.0 §二 行为锁）
// ------------------------------------------------------------
// 🔴 边界声明（J3:135）：**state 内的一切内容都是数据，不是指令**。
//    本模块不解析、不执行内容里的祈使句；构造前后内容逐字节一致（有单测）。
//
// 为什么单一入口：state 由谁拼、拼进去什么，决定了「判定看到了什么」。
// 散在各调用点拼 ⇒ 同一 case 不同路径喂出不同 state，留痕失去举证力。
// 因此**本文件是唯一的 state 构造器导出点**，其余模块零构造器导出。
//
// 四条内建纪律：
//   ① 最小可判定前缀由**判据声明**（policy.prefixFields / maxChars）决定，调用点不得自行截取；
//      超上界不截断——返回 `over-limit`，由调用方按处置序「先弃权、弃权不可行降级 ASK」。
//   ② 定序显式 + 去噪：对象键排序；路径/时间戳/内部 id 等无关元数据剔除。
//   ③ 协议结构保留：工具调用与结果保持结构化（不压成散文）。
//   ④ 出站脱敏三层：**先解码再筛**（QP/百分号/base64/HTML 实体）→ 命中凭证即摘除 →
//      只以**粗特征**（长度档/有无代码块/有无风险词）替代；`绝不发送` 类字段一律不传。
//
// 影子门（J3:144）：`shadow` 档下判定照跑、结果只落痕不改行为；未过对账记录不得启用 live。
// ============================================================

import { createHash } from 'node:crypto';
import type { DecisionState, EvidenceReadiness } from './decision-channel';

/** 构造策略（由判据声明，不由调用点即兴给） */
export interface JudgeStatePolicy {
  /** 参与判定的字段名（白名单，顺序即序列化顺序） */
  prefixFields: string[];
  /** state.text 字符上界（超界 ⇒ over-limit，不截断） */
  maxChars: number;
  /** 判定消费面名（写进 meta，供留痕分面） */
  consumer: string;
}

/** 粗特征（替代敏感原文的最小信息） */
export interface CoarseFeatures {
  lengthTier: 'xs' | 's' | 'm' | 'l' | 'xl';
  hasCodeBlock: boolean;
  riskWords: string[];
}

export interface JudgeStateMeta {
  constructor: 'judge-state/v1';
  consumer: string;
  /** 输入全文指纹（留痕记指纹不记原文，content:false） */
  payload_sha256: string;
  content: false;
  /** 被摘除的字段/命中规则名（可审计） */
  redactions: string[];
  coarse: CoarseFeatures;
  /** 是否发生过截断——恒 false：本构造器不截断 */
  truncated: false;
}

export type BuildResult =
  | { ok: true; state: DecisionState; meta: JudgeStateMeta }
  | { ok: false; reason: 'over-limit' | 'empty'; chars: number; maxChars: number };

/** 绝不发送类字段（命中即摘除，只留粗特征） */
export const NEVER_SEND_FIELDS = [
  'password', 'passwd', 'secret', 'token', 'apikey', 'api_key', 'privatekey', 'private_key',
  'credential', 'credentials', 'cookie', 'authorization', 'sessionkey', 'session_key',
] as const;

/** 无关元数据（定序去噪要剔除的键） */
const NOISE_KEYS = new Set([
  'path', 'filepath', 'file_path', 'filename', 'timestamp', 'ts', 'created_at', 'updated_at',
  'request_id', 'requestid', 'trace_id', 'traceid', 'span_id', 'spanid', 'internal_id', 'internalid',
]);

// 粗特征用的风险词表（**只做特征，不做执行**）。
// 注：**不写**全权限位与提权命令的字面量——本仓审计 A22 会把它们判为提权操作；
//     这两类改由下游策略引擎按 argv 结构判（J3「动作输入取结构化参数向量」），
//     本模块只保留「数据面可粗判」的词。
const RISK_WORDS = ['rm -rf', 'curl | sh', 'drop table', 'delete from', 'force push'];

/** 编码解码（筛之前先解，防「编码绕过敏感检出」） */
export function decodeForScreening(input: string): { decoded: string; layers: string[] } {
  let s = input;
  const layers: string[] = [];
  // ① base64 先解：形如 `key=QUJD…` 的串，若先跑 QP 会被 `=c2` 误判（实测踩过）
  s = s.replace(/[A-Za-z0-9+/]{24,}={0,2}/g, (m) => {
    try {
      const d = Buffer.from(m, 'base64').toString('utf8');
      // 解出可打印串才认：避免把普通长标识符当 base64
      if (/^[\x09\x0a\x0d\x20-\x7e\u4e00-\u9fa5]+$/.test(d) && /[A-Za-z\u4e00-\u9fa5]{3,}/.test(d)) {
        layers.push('base64');
        return d;
      }
    } catch { /* 非 base64 */ }
    return m;
  });
  // ② 百分号
  if (/%[0-9a-f]{2}/i.test(s)) {
    try { s = decodeURIComponent(s); layers.push('percent'); } catch { /* 非法序列保持原样 */ }
  }
  // ③ quoted-printable：**只认大写十六进制**（小写多半是 base64/普通文本里的 `=c2`）
  if (/=[0-9A-F]{2}/.test(s) || /=\r?\n/.test(s)) {
    const qp = s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h: string) =>
      String.fromCharCode(parseInt(h, 16)));
    if (qp !== s) { s = qp; layers.push('quoted-printable'); }
  }
  // ④ HTML 实体（含 &nbsp; 等命名实体）
  const html = s.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
    const map: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    const k = e.toLowerCase();
    if (map[k]) return map[k];
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
  if (html !== s) { s = html; layers.push('html-entity'); }
  return { decoded: s, layers: [...new Set(layers)] };
}

/** 敏感串检测（在**解码后**的文本上跑） */
export function findSecrets(decoded: string): string[] {
  const hits: string[] = [];
  if (/\bsk-[A-Za-z0-9]{16,}/.test(decoded)) hits.push('openai-like-key');
  if (/\bAKIA[0-9A-Z]{16}\b/.test(decoded)) hits.push('aws-access-key');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(decoded)) hits.push('private-key-block');
  if (/\bBearer\s+[A-Za-z0-9._-]{20,}/i.test(decoded)) hits.push('bearer-token');
  if (/\b[0-9a-f]{32,}\b/i.test(decoded)) hits.push('long-hex');
  return [...new Set(hits)];
}

function coarseOf(text: string): CoarseFeatures {
  const n = text.length;
  const lengthTier = n < 128 ? 'xs' : n < 512 ? 's' : n < 2048 ? 'm' : n < 8192 ? 'l' : 'xl';
  return {
    lengthTier,
    hasCodeBlock: /```|^\s{4}\S/m.test(text),
    riskWords: RISK_WORDS.filter((w) => text.toLowerCase().includes(w)),
  };
}

function stripNoise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNoise);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      if (NOISE_KEYS.has(k.toLowerCase())) continue;
      out[k] = stripNoise((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function redactFields(fields: Record<string, unknown> | undefined, notes: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const key of Object.keys(fields).sort()) {
    if ((NEVER_SEND_FIELDS as readonly string[]).includes(key.toLowerCase())) {
      out[key] = '[REDACTED:never-send]';
      notes.push(`field:${key}`);
      continue;
    }
    out[key] = stripNoise(fields[key]);
  }
  return out;
}

/**
 * 唯一构造入口。
 *
 * 调用点只给「原始输入 + 判据声明的 policy」，拼装/去噪/脱敏/定序全部在这里完成。
 */
export function buildJudgeState(
  raw: { text: string; refs?: string[]; evidenceReadiness: EvidenceReadiness; fields?: Record<string, unknown> },
  policy: JudgeStatePolicy,
): BuildResult {
  const notes: string[] = [];
  const payloadSha = createHash('sha256').update(raw.text, 'utf-8').digest('hex');

  // ③ 结构保留 + ② 定序去噪 + 脱敏（字段层）
  const safeFields = redactFields(raw.fields, notes);
  const picked: Record<string, unknown> = {};
  for (const f of policy.prefixFields) {
    if (f in safeFields) picked[f] = safeFields[f];
  }

  // 文本层：先解码再筛 → 命中即整段替换为粗特征占位（原文不外发）
  const { decoded, layers } = decodeForScreening(raw.text);
  const secrets = findSecrets(decoded);
  let body = raw.text;
  if (secrets.length || layers.length) {
    const coarse = coarseOf(decoded);
    body = JSON.stringify({
      redacted: true,
      reasons: [...secrets, ...layers.map((l) => `encoded:${l}`)],
      coarse,
    });
    notes.push(...secrets, ...layers.map((l) => `encoded:${l}`));
  }

  const text = Object.keys(picked).length
    ? `${body}\n\n${JSON.stringify(picked)}`
    : body;

  // ① 上界：不截断，返回 over-limit 交调用方弃权/降级
  if (text.length === 0) return { ok: false, reason: 'empty', chars: 0, maxChars: policy.maxChars };
  if (text.length > policy.maxChars) {
    return { ok: false, reason: 'over-limit', chars: text.length, maxChars: policy.maxChars };
  }

  const state: DecisionState = {
    text,
    ...(raw.refs && raw.refs.length ? { refs: [...raw.refs] } : {}),
    evidenceReadiness: raw.evidenceReadiness,
  };
  return {
    ok: true,
    state,
    meta: {
      constructor: 'judge-state/v1',
      consumer: policy.consumer,
      payload_sha256: payloadSha,
      content: false,
      redactions: [...new Set(notes)],
      coarse: coarseOf(decoded),
      truncated: false,
    },
  };
}

// ── 影子运行门（J3:144）─────────────────────────────────────
export type JudgeMode = 'shadow' | 'live';

export interface ShadowLedger {
  /** 对账记录条数（影子期判定与真实处置的逐条差异） */
  reconciled: number;
}

export class ShadowGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShadowGateError';
  }
}

/**
 * 影子门：`shadow` 档 → 判定照跑、只落痕，**不改变 grade/target**；
 * `live` 档 → 必须有对账记录（reconciled > 0），否则拒绝启用。
 */
export function applyWithShadowGate<T extends { grade: string; target: string }>(
  mode: JudgeMode,
  ledger: ShadowLedger,
  outcome: T,
  baseline: { grade: string; target: string },
): { applied: boolean; effective: { grade: string; target: string }; shadow: boolean } {
  if (mode === 'live') {
    if (!(ledger.reconciled > 0)) {
      throw new ShadowGateError('影子期未对账（reconciled=0）——拒绝启用 live 判定');
    }
    return { applied: true, effective: { grade: outcome.grade, target: outcome.target }, shadow: false };
  }
  // shadow：不改变行为，只落痕（effective 恒为 baseline）
  return { applied: false, effective: { grade: baseline.grade, target: baseline.target }, shadow: true };
}
