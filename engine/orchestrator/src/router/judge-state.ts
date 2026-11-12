// ============================================================
// judge-state.ts · 判定 state 的**单一构造入口**（v1.9.0 §二 行为锁）
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
// 影子门（J3:144）：`off` 档判定点不启用（路由层归一 local-executor，见 model-router）；
// `shadow` 档下判定照跑、结果只落痕不改行为；未过对账记录不得启用 active。
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
  /** 脱敏层版本锚（v1.8.0 §二——decodeForScreening/findSecrets 规则集代次，随判定落痕可复现） */
  redactionVersion: 'redaction/v1';
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
/** 单趟解码链（①base64→②percent→③QP→④HTML，顺序不变——base64 先解防 `=c2` 误判，实测踩过） */
function decodePass(input: string): { decoded: string; layers: string[] } {
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

/**
 * 迭代解码至不动点（R3-4b）：循环跑单趟链直到一轮内**零层命中**或达上限。
 * 多层编码（base64→percent→base64）在单趟结构下只有最外两层被剥——内层 base64
 * 需要下一轮才会解出。
 *
 * 🔴 超限处置 = fail-closed（R3-4c）：达 5 轮上限仍可继续解 ⇒ 该值视为对抗性构造，
 * **原样放行等于把未检面交给上游**——返回 `exhausted: true` + 深度标记，由调用方
 * （screenStringValue / text 面筛选）按「疑似深编码」处置（fields 值面 ⇒ 整值 REDACTED；
 * text 面 ⇒ 计入 secrets 命中面，见 findSecrets 的 exhausted-depth 形态）。
 */
export function decodeForScreening(input: string): { decoded: string; layers: string[]; exhausted: boolean; rounds: number } {
  const allLayers: string[] = [];
  let current = input;
  let rounds = 0;
  let exhausted = false;
  for (let round = 0; round < 5; round++) {
    const { decoded, layers } = decodePass(current);
    if (layers.length === 0) break; // 不动点：本轮无新层可解
    allLayers.push(...layers);
    current = decoded;
    rounds = round + 1;
  }
  // 第 5 轮解完仍有层可剥（再跑一轮还会命中）⇒ 未收敛即耗尽——不是「恰好 5 层解完」
  const probe = decodePass(current);
  if (rounds === 5 && probe.layers.length > 0) exhausted = true;
  return { decoded: current, layers: [...new Set(allLayers)], exhausted, rounds };
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

/** 值级检测（J3:139「编码后内容先解码再筛」的 fields 值面，R3-4）：
 *  字符串值先过 decodeForScreening（QP/百分号/base64/HTML 实体逐层解码）再 findSecrets，
 *  命中任一密钥形态 ⇒ 整值 REDACTED 并留痕（值本身不上行——粗特征都算多余，秘密就是秘密）。 */
function screenStringValue(value: string, notes: string[], path: string): string {
  const { decoded, exhausted } = decodeForScreening(value);
  // 🔴 超限 fail-closed（R3-4c）：5 轮仍可继续解 = 对抗性深编码——原样放行等于把
  // 未检面交给上游，整值 REDACTED 并带 exhausted 留痕（宁可误伤也不放行未检内容）。
  if (exhausted) {
    notes.push(`value:${path}:exhausted-depth`);
    return '[REDACTED:encoded-exhausted]';
  }
  const hits = findSecrets(decoded);
  if (hits.length > 0) {
    notes.push(`value:${path}:${hits.join('+')}`);
    return `[REDACTED:encoded-redact:${hits.join('+')}]`;
  }
  return value;
}

function stripNoise(value: unknown, notes?: string[], path = ''): unknown {
  if (typeof value === 'string') {
    return notes ? screenStringValue(value, notes, path) : value;
  }
  if (Array.isArray(value)) return value.map((v) => stripNoise(v, notes, path));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const keyPath = path ? `${path}.${k}` : k;
      // 深层键名命中绝不发送名单 ⇒ 就地 REDACTED（嵌套 password/token 等穿透即在此拦截，
      // S2 第 3 轮预阻塞①：顶层 redactFields 挡不住 toolCalls.args.password 这类深层键）
      if ((NEVER_SEND_FIELDS as readonly string[]).includes(k.toLowerCase())) {
        out[k] = '[REDACTED:never-send]';
        notes?.push(`field:${keyPath}`);
        continue;
      }
      if (NOISE_KEYS.has(k.toLowerCase())) continue;
      out[k] = stripNoise((value as Record<string, unknown>)[k], notes, keyPath);
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
    out[key] = stripNoise(fields[key], notes, key);
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
  const { decoded, layers, exhausted } = decodeForScreening(raw.text);
  const secrets = findSecrets(decoded);
  if (exhausted) secrets.push('exhausted-depth'); // 🔴 超限计入命中面：text 同样不放行未检内容（R3-4c）
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
      redactionVersion: 'redaction/v1',
      coarse: coarseOf(decoded),
      truncated: false,
    },
  };
}

// ── 影子运行门（J3:144）─────────────────────────────────────
export type JudgeMode = 'off' | 'shadow' | 'active';

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
 * `active` 档 → 必须有对账记录（reconciled > 0），否则拒绝启用；
 * `off` 档 → 本不该被调用到这里（路由层已归一），抛错即暴露上游漏判。
 */
export function applyWithShadowGate<T extends { grade: string; target: string }>(
  mode: JudgeMode,
  ledger: ShadowLedger,
  outcome: T,
  baseline: { grade: string; target: string },
): { applied: boolean; effective: { grade: string; target: string }; shadow: boolean } {
  if (mode === 'off') {
    throw new ShadowGateError('off 档判定点不启用——本函数不应被调用（路由层应已归一 local-executor），上游漏判');
  }
  if (mode === 'active') {
    if (!(ledger.reconciled > 0)) {
      throw new ShadowGateError('影子期未对账（reconciled=0）——拒绝启用 active 判定');
    }
    return { applied: true, effective: { grade: outcome.grade, target: outcome.target }, shadow: false };
  }
  // shadow：不改变行为，只落痕（effective 恒为 baseline）
  return { applied: false, effective: { grade: baseline.grade, target: baseline.target }, shadow: true };
}


// ══════════════════════════════════════════════════════════
// v1.8.0 §二 · 动作输入三件（J3「动作输入取结构化参数向量」的判定面）
// ══════════════════════════════════════════════════════════

/** 动作输入向量（结构化参数——shell 包装拆分后的逐条底层动作） */
export interface ActionVectorItem {
  /** 执行体（bin——shell 包装拆分后为首 token；basename 回退见 bindExecutable） */
  executable: string;
  /** 参数向量（argv） */
  args: string[];
}

/**
 * shell 包装拆分（§二「可拆分则按底层动作逐条判、拆不动则整串从严」）：
 * **语义边界（review r2 声明）**：拆分只认 && ; || 三种分隔——嵌套引号内的
 * 分隔符、\$(...) 命令替换、| 管道**不在拆分面**（这些形态整体落入
 * strictFromRaw=true 的从严档，调用方按整串判不逐条放行）；管道与命令
 * 替换的展开属 shell 语义，由执行侧沙箱拦截，本函数不模拟 shell。
 * 输入若为 `bash -lc "a && b"` / `sh -c 'a; b'` 形态，解出内层命令串并按
 * && / ; / || 拆为逐条动作；非 shell 包装或拆不动（引号不配对等）→ 整串
 * 作为单条、strictFromRaw=true（从严：调用方按整串判，不做逐条放行）。
 */
export function splitShellAction(raw: string): { items: ActionVectorItem[]; strictFromRaw: boolean } {
  const shellWrap = /^\s*(bash|sh|zsh)\s+(-lc|-c)\s+([\'\"])([\s\S]*)\3\s*$/;
  const m = raw.match(shellWrap);
  if (!m) return { items: [{ executable: raw.trim().split(/\s+/)[0] ?? '', args: raw.trim().split(/\s+/).slice(1) }], strictFromRaw: true };
  const inner = m[4] ?? '';
  if (!inner.trim()) return { items: [{ executable: m[1] ?? 'sh', args: [] }], strictFromRaw: true };
  const parts = inner.split(/\s*(?:&&|;|\|\|)\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { items: [{ executable: m[1] ?? 'sh', args: [] }], strictFromRaw: true };
  return {
    items: parts.map((p) => {
      const toks = p.split(/\s+/);
      return { executable: toks[0] ?? '', args: toks.slice(1) };
    }),
    strictFromRaw: false,
  };
}

/** 执行体白名单（basename 回退的许可面——精确匹配优先，basename 须在此面内） */
const EXECUTABLE_BASENAME_WHITELIST = new Set([
  'node', 'npm', 'npx', 'git', 'bash', 'sh', 'python3', 'python',
  'jq', 'curl', 'mkdir', 'cp', 'mv', 'rm', 'cat', 'grep', 'sed', 'awk', 'echo',
]);

/**
 * 执行体路径绑定（§二「精确匹配优先，basename 回退须在白名单内」）：
 * - 输入与已知执行体**精确相等** → 直接绑定；
 * - 否则取 basename：在白名单内 → 绑定为 basename；不在 → 绑定失败
 *   （返回 undefined，调用方按「未知执行体」从严处置，不放行）。
 */
export function bindExecutable(input: string, knownExecutables: ReadonlySet<string>): string | undefined {
  if (knownExecutables.has(input)) return input;
  const base = input.split('/').pop() ?? input;
  if (EXECUTABLE_BASENAME_WHITELIST.has(base)) return base;
  return undefined;
}
