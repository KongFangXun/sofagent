// ============================================================
// intent-channel.ts · 审计输入双通道之「调用意图通道」（v1.5.1 第七章）
// ============================================================
//
// 背景 / Background：
//   第七章之前，审计的输入面只有一条——git diff（**结果文本**）。结果文本能回答
//   「改了什么」，回答不了「想做什么」：`rm -rf` 的 path、写文件落点、外发 host
//   全在**参数级**，而参数在提交时早已消失。本章借 v1.5.0 第十章已交付的宿主事件
//   接线（DSH 插件 seamHandlers：`tools/pre-execute` / `tools/result`）把输入面
//   扩为**双通道**：
//     · 结果通道（result）——既有 git diff / 工具结果文本，**仍是默认通道**；
//     · 意图通道（intent）——本文件：订阅宿主事件 → 脱敏 → 落 `<dataDir>/audit/intent.jsonl`。
//
// 三条硬边界（越界即返工）：
//   ① **零执行权限**——本文件对意图流只有**只读消费 + 落盘留痕**权：
//      · 订阅只用 `ctx.on`（观察面），**绝不**用 `waterfall`；
//      · 监听器**不接收也不调用 `next`**、**不返回任何判定**（不产生 deny/allow 语义）；
//      · 拦截能力在宿主事件位（v1.5.0 第十章已交付），审计不新增拦截权限。
//      机械保证：本文件声明的事件上下文契约（IntentEventContext）**只含 `on`**——
//      契约层面就没有拦截面可用，不是靠注释约束。
//   ② **不新增规则、不改判定逻辑**——本文件只扩输入面，一条规则都不碰。
//   ③ **不改默认行为**——未声明 `inputChannels` 的规则照旧走结果通道（见
//      `resolveInputChannels` 的缺省分支），行为零变化；意图通道 opt-in。
//
// 脱敏（铁律：先脱敏再签名）：
//   参数**先过既有脱敏管线**（`sanitizeFreeText` → core 的 REDACTION_PATTERNS SSOT）
//   才落盘；随后 `appendChained` 内核只签名它收到的记录（内核不做任何后置脱敏）。
//   顺序不可颠倒：嵌套对象**先序列化再整体过管道**，故嵌套里的密钥同样被打码；
//   截断发生在脱敏**之后**（截断只可能截断打码占位符，不可能截出半个明文密钥）。
//
// 链（与既有审计链同内核）：
//   落盘走 `appendChained`（@internal 单一事实源），条目类型经 `entryType` 选项注入，
//   位置在两条哈希输入之内——「把 intent 条目改标成 result」与改业务内容同判据
//   （指纹一致时判 tampered），意图与结果同链留痕且条目类型不可被静默抹改。
//
// 跳失留痕（本文件第二条落盘面 · 与调用证据分离）：
//   通道的**调用证据**（intent.jsonl）只在身份可达时产生；而宿主侧还有一条纪律——
//   「身份不可达 ⇒ 跳过留证，不猜测」（exec 不带 agent/session 时不编造身份）。
//   这条纪律若不落盘，运维就永远分不清「宿主压根没有工具调用」与「每次调用都被
//   身份门挡下了」——两种情况的磁盘状态都是「没有 intent.jsonl」。
//   故跳失单独落 `<dataDir>/audit/intent-skips.jsonl`（reason / event / tool / ts）：
//   · **进盘不进链**——它是「通道活性证据」而非「调用证据」：不被任何规则消费、
//     不参与任何判定，故不占用 intent.jsonl 的链完整性面（那面只承载调用与结果）；
//   · 与调用证据**同目录同解析**（同一 dataDir 口径），只读盘即可回答
//     「这个宿主上意图通道记了几次、跳了几次、为什么跳」（见 summarizeIntentChannel）。
// ============================================================

import { chmodSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { atomicAppendSync, getEnvFingerprint, getHistoryFilePath, getHmacKey } from '@sofagent/core';
import { appendChained, type ChainEntryType, type ChainFields } from './chain-kernel';
import { sanitizeFreeText } from './audit-history';
import { log } from './logger';
import type { AuditInputChannel, IntentEntry } from './rules/types';

// ════════════════════════════════════════
// 常量 / Constants
// ════════════════════════════════════════

/** 意图留痕文件名（与 history.jsonl 同目录——同一 dataDir 解析口径） */
export const INTENT_LOG_FILENAME = 'intent.jsonl';

/** 意图**跳失**留痕文件名（同目录同口径；进盘不进链，见文件头「跳失留痕」） */
export const INTENT_SKIP_LOG_FILENAME = 'intent-skips.jsonl';

/**
 * 订阅的宿主事件域——与 `engine/dsh-plugins/plugins.json` 中 audit 插件的
 * `seamHandlers`（`tools/result` / `tools/pre-execute`）**逐字一致**。
 * 事件名写错 = 订阅了一个永不触发的幽灵缝（本仓 v1.5.0 章十的既有事故形态）。
 */
export const INTENT_EVENTS = ['tools/pre-execute', 'tools/result'] as const;

/** 链条目类型白名单 = 通道枚举（进 `appendChained` 的 kind 门，键名见下） */
const CHAIN_ENTRY_TYPES: readonly ChainEntryType[] = ['intent', 'result'];

/** 承载条目类型的链字段名（= 内核 kindField；也即 intent.jsonl 里可举证的通道字段） */
const ENTRY_TYPE_FIELD = 'entryType';

/** 单个参数摘要值的长度上限（摘要不是原文——长值截断，防落盘爆炸） */
const ARG_VALUE_MAX = 300;

// ════════════════════════════════════════
// 类型 / Types
// ════════════════════════════════════════

/**
 * 宿主事件订阅面（最小契约 · 鸭子类型）。
 *
 * 🔴 本契约**故意只声明 `on`**：没有 `waterfall`、没有 `next`、没有返回值语义——
 * 零执行权限在类型层面成立（审计拿不到否决权，想加也加不上）。
 * 结构上与 DSH Cordis `ctx` 兼容（`on(event, listener) → 取消订阅函数`），
 * 故插件侧可直接把 ctx 传进来，而 audit 包不必依赖 orchestrator / dsh 任何包。
 */
export interface IntentEventContext {
  /** 订阅事件（观察面；返回取消订阅函数） */
  on(event: string, listener: (...args: unknown[]) => void): () => void;
}

/** 意图通道配置 */
export interface IntentChannelOptions {
  /** 数据目录（缺省走 core 的既有解析：显式 > SOFAGENT_DATA > 默认数据目录） */
  dataDir?: string;
  /**
   * HMAC 密钥。**缺省**由 `getHmacKey()` 解析（与 history.jsonl 链同源）；
   * 显式传 `null` = 降级 SHA-256 链（hmacSig 缺省，与内核既有语义一致）。
   */
  key?: string | null;
  /** 环境指纹。缺省由 `getEnvFingerprint(dataDir)` 现算（与 history.jsonl 链同源） */
  fingerprint?: string;
}

/**
 * 意图通道
 */
export interface IntentChannel {
  /**
   * Cordis 插件形态——挂进宿主 ctx 即开始订阅（订阅失败逐事件 try-catch，
   * 丢该路信号但绝不影响宿主执行）。返回值 = 取消订阅函数。
   */
  plugin: (ctx: IntentEventContext) => () => void;
  /**
   * 逐事件入口——宿主 seam handler 场景（handler 已收到 `(exec, next)` /
   * `(exec, result)`）直接调用，无需持有订阅。`args` 为宿主事件原始实参数组。
   */
  handle: (event: string, args: unknown[]) => void;
  /** 留痕文件绝对路径（`<dataDir>/audit/intent.jsonl`） */
  filePath: string;
  /** 已落盘条目（含链字段，按写入序）——举证 / 测试用 */
  entries: Array<IntentEntry & ChainFields>;
}

/**
 * 跳失原因（枚举收窄）。
 *
 * 「为什么跳」必须是**可聚合的枚举**而不是自由文本：运维的问题是
 * 「跳了多少次、都是什么原因」，自由文本只能人肉读，聚合不出结论。
 */
export type IntentSkipReason =
  /** 身份不可达：宿主 exec 未带 agent/session 标识——不猜测身份，故不落调用证据 */
  | 'identity-unreachable'
  /** 工具不可归因：exec 无工具名——无法回答「谁做了什么」，落盘无审计价值 */
  | 'tool-unattributable';

/** 一条跳失记录（进盘不进链——活性证据，不做完整性声明） */
export interface IntentSkipRecord {
  ts: string;
  reason: IntentSkipReason;
  /** 宿主事件域（`tools/pre-execute` / `tools/result`） */
  event: string;
  /** 工具名（可取到时带上——「哪个工具的意图被跳过了」） */
  tool?: string;
}

/**
 * 意图通道活性快照（**纯读盘**——`summarizeIntentChannel` 的返回）。
 *
 * 存在意义 = 运维判据：**只读盘上的东西，就能判断意图通道是否在工作**。
 * 单看 intent.jsonl 是判不出来的：文件不存在既可能是「宿主没有工具调用」，
 * 也可能是「每次调用都被身份门挡下」——`verdict` + `skipped` + `skipReasons`
 * 把这两种情况区分开。
 */
export interface IntentChannelStatus {
  /** 调用证据文件路径 */
  intentLog: string;
  /** 已落盘的调用 / 结果条目数 */
  intentEntries: number;
  /** 跳失证据文件路径 */
  skipLog: string;
  /** 跳失记录总数 */
  skipped: number;
  /** 按原因聚合的跳失计数（键缺省 = 0 次） */
  skipReasons: Partial<Record<IntentSkipReason, number>>;
  /** 最近一条跳失（无跳失则缺省） */
  lastSkip?: IntentSkipRecord;
  /**
   * 通道活性判定：
   * - `recording`——盘上有调用证据（通道在工作）；
   * - `skipped-only`——有跳失无调用证据（**接线在、但每次都被跳过**：按 skipReasons 查宿主身份接线）；
   * - `idle`——两者皆空（尚无工具调用事件，或通道未挂载）。
   */
  verdict: 'recording' | 'skipped-only' | 'idle';
}

// ════════════════════════════════════════
// 路径 / Path
// ════════════════════════════════════════

/**
 * 意图留痕文件路径——与 `history.jsonl` **同目录解析**（复用 core 的
 * `getHistoryFilePath`，只换文件名）：
 * 显式 dataDir > `SOFAGENT_DATA` 环境变量 > 默认数据目录。不另造第二套路径解析。
 */
export function resolveIntentLogPath(dataDir?: string): string {
  return join(dirname(getHistoryFilePath(dataDir)), INTENT_LOG_FILENAME);
}

/** 跳失留痕文件路径——与 intent.jsonl **同目录同解析**（不另造第二套路径解析） */
export function resolveIntentSkipLogPath(dataDir?: string): string {
  return join(dirname(getHistoryFilePath(dataDir)), INTENT_SKIP_LOG_FILENAME);
}

// ════════════════════════════════════════
// 通道声明（规则输入面 · 默认值单源）
// ════════════════════════════════════════

/**
 * 规则输入通道解析（默认值**单源**）。
 *
 * 缺省（未声明 / 空数组）= `['result']`——**结果通道**。所有既有 24 条规则都走
 * 这一支，行为零变化；声明含 `'intent'` 才消费 `AuditContext.intentEntries`（opt-in）。
 * 默认值只在本函数定义一处——勿在各消费点各自 `?? ['result']`（本仓历史高频事故：
 * 同一默认值多处重推，改一处漏一处）。
 */
export function resolveInputChannels(rule: { inputChannels?: AuditInputChannel[] }): AuditInputChannel[] {
  return rule.inputChannels && rule.inputChannels.length > 0 ? [...rule.inputChannels] : ['result'];
}

/** 规则是否声明了某输入通道（双通道判定的机械判据；意图通道 opt-in） */
export function ruleSupportsChannel(
  rule: { inputChannels?: AuditInputChannel[] },
  channel: AuditInputChannel,
): boolean {
  return resolveInputChannels(rule).includes(channel);
}

// ════════════════════════════════════════
// 脱敏 / Redaction（复用既有管线 · 不重造正则）
// ════════════════════════════════════════

/** JSON 安全序列化（循环引用 / BigInt 等不可序列化值不抛——落盘路径不允许因参数形状中断） */
function safeStringify(value: unknown): string {
  try {
    const out = JSON.stringify(value);
    return typeof out === 'string' ? out : String(value);
  } catch {
    return '[unserializable]';
  }
}

/**
 * 参数摘要——**先脱敏再截断**（顺序不可颠倒，见文件头）。
 *
 * - 顶层字符串值直接过管道；对象 / 数组值先 `JSON.stringify` 再整体过管道
 *   （故嵌套结构里的密钥同样被打码，不依赖「逐层知道哪一层是自由文本」）；
 * - 复用 `sanitizeFreeText`（REDACTION_PATTERNS SSOT）——本文件**零脱敏正则副本**。
 *
 * @param args 宿主事件携带的参数对象（非对象 / 数组一律返回空摘要）
 * @returns 键为参数名、值为脱敏后文本的摘要（不返回 undefined 值的键）
 */
export function sanitizeArgsSummary(args: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return out;
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value === undefined) continue;
    const raw = typeof value === 'string' ? value : safeStringify(value);
    const cleaned = sanitizeFreeText(raw) ?? '';
    out[key] = cleaned.length > ARG_VALUE_MAX ? `${cleaned.slice(0, ARG_VALUE_MAX)}…` : cleaned;
  }
  return out;
}

/**
 * 单值脱敏——落盘条目的**非参数**字符串字段（tool 名 / 会话标识 / 调用标识）也过同一管道。
 *
 * 为什么不能只脱参数：工具名是**模型产出**（可被诱导写成含密钥的字符串），会话标识来自
 * 宿主且形状不由本模块保证。内核只签名它收到的记录（先脱敏再签名是调用方责任），
 * 故落盘前所有字符串叶子一律过管道——对正常标识是 no-op，只在真像密钥时才打码。
 */
function sanitizeText(value: string): string {
  return sanitizeFreeText(value) ?? '';
}

// ════════════════════════════════════════
// 宿主载荷取数（防御式——事件源 schema 不一，一律鸭子类型读取）
// ════════════════════════════════════════

/** 工具名（宿主 `exec.name`）；取不到即不落盘（不可归因的条目没有审计价值，不猜测） */
function toolNameOf(exec: unknown): string | null {
  const name = (exec as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

/** 参数对象——宿主不同版本字段名不一（`arguments` / `args` / `params`），逐个兜底 */
function argsOf(exec: unknown): unknown {
  if (exec === null || typeof exec !== 'object') return undefined;
  const e = exec as Record<string, unknown>;
  return e.arguments ?? e.args ?? e.params;
}

/**
 * 身份取数（与 audit 插件 `identityOf` 同形状：`exec.agent.id` /
 * `exec.agent.session.id`（或 `exec.agent.session.header.id`））。
 * 会话标识不可达时显式置 `'unknown'`——**记录「身份未知」这个事实**，而不是
 * 静默丢条目（丢了就永远不知道发生过这次调用）也不是编造一个身份。
 */
function identityOf(exec: unknown): { agentId?: string; sessionId: string } {
  const agent = (exec as { agent?: unknown } | null | undefined)?.agent as
    | { id?: unknown; session?: { id?: unknown; header?: { id?: unknown } } }
    | undefined;
  const agentId = typeof agent?.id === 'string' && agent.id !== '' ? agent.id : undefined;
  const rawSession = agent?.session?.id ?? agent?.session?.header?.id;
  const sessionId = typeof rawSession === 'string' && rawSession !== '' ? rawSession : 'unknown';
  return { agentId, sessionId };
}

/** 调用标识（宿主 `exec.callId`）——同一次调用的意图条目与结果条目据此对照 */
function callIdOf(exec: unknown): string | undefined {
  const callId = (exec as { callId?: unknown } | null | undefined)?.callId;
  return typeof callId === 'string' && callId !== '' ? callId : undefined;
}

/** 结果态（`tools/result` 的 `isError` 标记）；结果载荷缺席时**不判定**（留空，不猜 ok） */
function outcomeOf(result: unknown): 'ok' | 'error' | undefined {
  if (result === null || typeof result !== 'object') return undefined;
  return (result as { isError?: unknown }).isError === true ? 'error' : 'ok';
}

// ════════════════════════════════════════
// 读取面（规则侧消费 · `<dataDir>/audit/intent.jsonl`）
// ════════════════════════════════════════

/**
 * 读意图留痕（供 `AuditContext.intentEntries` 装配）。
 *
 * 容错口径：文件不存在返回空数组；坏行**跳过**（该行已有链完整性判定兜底，
 * 举证路径不因一行损坏而整份不可读）。只收形态合法的条目（channel ∈ 通道枚举且
 * `tool` 为字符串）——非意图条目（若该文件被别的写入方污染）不进规则输入面。
 */
export function readIntentEntries(filePath: string): IntentEntry[] {
  if (!filePath || !existsSync(filePath)) return [];
  const out: IntentEntry[] = [];
  let badLines = 0;
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as IntentEntry;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof parsed.tool === 'string' &&
        (parsed.channel === 'intent' || parsed.channel === 'result')
      ) {
        out.push(parsed);
      }
    } catch {
      // 坏行跳过——不阻断举证（该行的完整性由 verifyChain 独立暴露，不在读侧二次判定）
      badLines++;
    }
  }
  // 降级可见（静默吞错门禁 check-silent-catch 的合规形态）：跳过多少行必须留痕
  if (badLines > 0) {
    log.warn(`[intent-channel] ${filePath} 有 ${badLines} 行无法解析（已跳过，不阻断举证；链完整性请用 verifyChain 复核）`);
  }
  return out;
}

// ════════════════════════════════════════
// 跳失留痕（通道活性证据 · 进盘不进链）
// ════════════════════════════════════════

/** 跳失原因白名单（读侧形态过滤 + 聚合键的单源） */
const SKIP_REASONS: readonly IntentSkipReason[] = ['identity-unreachable', 'tool-unattributable'];

/**
 * 记一条跳失——**跳过必须有据可查**（本函数存在的唯一理由）。
 *
 * 为什么单独一个函数、而不是复用 `appendChained`：
 * 跳失**不是调用证据**（没有工具调用发生过），把它塞进 intent.jsonl 会污染「调用 / 结果」
 * 这条链的语义，且强制它占用链字段。故跳失走独立的 append-only JSONL，
 * **不进链、不做完整性声明**——它回答的是「通道活性」这个运维问题，不是「发生过什么事」
 * 这个审计问题。
 *
 * 写盘纪律与链内核第 5 步一致（同一 dataDir、目录 0o700、`atomicAppendSync` 原子追加、
 * 文件 0o600）——不另造第二套写盘路径。
 *
 * 🔴 失败一律**可见告警 + 返回 null**，绝不抛：留痕故障不得升级为宿主工具调用故障。
 *
 * @param dataDir 数据目录（缺省走 core 既有解析——与 intent.jsonl 同源）
 * @param record 跳失内容（`ts` 由本函数现取，不由调用方提供）
 * @returns 落盘记录；写失败返回 null（已告警）
 */
export function recordIntentSkip(
  dataDir: string | undefined,
  record: Omit<IntentSkipRecord, 'ts'>,
): IntentSkipRecord | null {
  const filePath = resolveIntentSkipLogPath(dataDir);
  const full: IntentSkipRecord = {
    ts: new Date().toISOString(),
    reason: record.reason,
    event: sanitizeText(record.event),
    ...(typeof record.tool === 'string' && record.tool !== '' ? { tool: sanitizeText(record.tool) } : {}),
  };
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicAppendSync(filePath, JSON.stringify(full));
  } catch (err) {
    log.warn(
      `[intent-channel] 跳失留痕写入失败（不阻断宿主；本次跳失 reason=${full.reason} event=${full.event}）：${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  try {
    chmodSync(filePath, 0o600);
  } catch (err) {
    // 权限收紧失败不阻断留痕（与链内核同语义，仅告警）
    log.warn(
      `[intent-channel] 跳失留痕权限设置失败（不影响记录有效性）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return full;
}

/**
 * 读跳失记录（容错口径与 {@link readIntentEntries} 同：文件不存在返回空数组、坏行跳过）。
 * 只收形态合法的记录（reason ∈ 原因枚举且 event 为字符串）。
 */
export function readIntentSkips(filePath: string): IntentSkipRecord[] {
  if (!filePath || !existsSync(filePath)) return [];
  const out: IntentSkipRecord[] = [];
  let badLines = 0;
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as IntentSkipRecord;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        typeof parsed.event === 'string' &&
        SKIP_REASONS.includes(parsed.reason)
      ) {
        out.push(parsed);
      }
    } catch {
      // 坏行跳过——不阻断活性判定（该文件不做完整性声明，读侧不必二次判定）
      badLines++;
    }
  }
  if (badLines > 0) {
    log.warn(`[intent-channel] ${filePath} 有 ${badLines} 行无法解析（已跳过，不阻断通道活性判定）`);
  }
  return out;
}

/**
 * 通道活性快照——**纯读盘**回答运维那个问题：
 * 「这个宿主上意图通道到底记了几次、跳了几次、为什么跳」。
 *
 * 为什么不放进程内计数器：计数器随进程消失，而「通道是否在工作」恰恰是在
 * **事后**（重启过、换过机器、翻旧账时）才要问的问题。故判据必须是盘上的东西。
 */
export function summarizeIntentChannel(dataDir?: string): IntentChannelStatus {
  const intentLog = resolveIntentLogPath(dataDir);
  const skipLog = resolveIntentSkipLogPath(dataDir);
  const intentEntries = readIntentEntries(intentLog).length;
  const skips = readIntentSkips(skipLog);
  const skipReasons: Partial<Record<IntentSkipReason, number>> = {};
  for (const s of skips) skipReasons[s.reason] = (skipReasons[s.reason] ?? 0) + 1;
  const lastSkip = skips.length > 0 ? skips[skips.length - 1] : undefined;
  return {
    intentLog,
    intentEntries,
    skipLog,
    skipped: skips.length,
    skipReasons,
    ...(lastSkip !== undefined ? { lastSkip } : {}),
    verdict: intentEntries > 0 ? 'recording' : skips.length > 0 ? 'skipped-only' : 'idle',
  };
}

// ════════════════════════════════════════
// 通道主体 / createIntentChannel
// ════════════════════════════════════════

/**
 * 创建意图通道（订阅宿主事件 → 脱敏 → 落链式 intent.jsonl）。
 *
 * 🔴 零执行权限：返回的 `plugin` 只注册 `ctx.on` 监听器；监听器**不调用任何 `next`**、
 * **不返回任何判定**——本模块没有拦截能力，也不该有（拦截属宿主事件位）。
 */
export function createIntentChannel(options: IntentChannelOptions = {}): IntentChannel {
  const filePath = resolveIntentLogPath(options.dataDir);
  const entries: Array<IntentEntry & ChainFields> = [];

  // 链参数**惰性解析一次**：显式传入优先（测试用固定密钥 / 固定指纹锚定），
  // 缺省与 history.jsonl 链同源（getHmacKey / getEnvFingerprint）——不另造密钥面。
  let chainParams: { key: string | null; fingerprint: string } | null = null;
  const params = (): { key: string | null; fingerprint: string } => {
    if (chainParams === null) {
      chainParams = {
        key: options.key === undefined ? getHmacKey() : options.key,
        fingerprint: options.fingerprint ?? getEnvFingerprint(options.dataDir),
      };
    }
    return chainParams;
  };

  /** 落盘一条（走既有链内核；失败**可见告警 + 丢该条**，绝不把留痕故障升级为宿主故障） */
  const append = (entry: IntentEntry): void => {
    const { key, fingerprint } = params();
    try {
      entries.push(
        appendChained(entry, {
          filePath,
          validKinds: CHAIN_ENTRY_TYPES,
          kindField: ENTRY_TYPE_FIELD,
          entryType: entry.channel,
          key,
          fingerprint,
          logLabel: '[intent-channel]',
        }),
      );
    } catch (err) {
      console.error(
        `[intent-channel] 意图条目落盘失败（不阻断宿主，本条目丢弃）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handle = (event: string, args: unknown[]): void => {
    if (event !== 'tools/pre-execute' && event !== 'tools/result') return;
    const exec = args[0];
    const tool = toolNameOf(exec);
    if (tool === null) {
      // 第三态（身份可达但**工具名缺失**）：既不能落调用证据（不可归因），
      // 也不能静默跳过——「跳过必须可审计」在这条路径上同样成立。故落跳失记录
      // （reason='tool-unattributable'），运维可据此区分「宿主没调用」与「每次调用都被挡下」。
      recordIntentSkip(options.dataDir, { reason: 'tool-unattributable', event });
      return; // 不落调用证据（不猜测）
    }
    const id = identityOf(exec);
    const callId = callIdOf(exec);
    const argsSummary = sanitizeArgsSummary(argsOf(exec));
    const isIntent = event === 'tools/pre-execute';
    const outcome = isIntent ? undefined : outcomeOf(args[1]);
    const entry: IntentEntry = {
      channel: isIntent ? 'intent' : 'result',
      tool: sanitizeText(tool),
      ...(Object.keys(argsSummary).length > 0 ? { argsSummary } : {}),
      sessionId: sanitizeText(id.sessionId),
      ...(id.agentId !== undefined ? { agentId: sanitizeText(id.agentId) } : {}),
      ...(callId !== undefined ? { callId: sanitizeText(callId) } : {}),
      ...(outcome !== undefined ? { outcome } : {}),
      ts: new Date().toISOString(),
    };
    append(entry);
  };

  const plugin = (ctx: IntentEventContext): (() => void) => {
    const offs: Array<() => void> = [];
    for (const event of INTENT_EVENTS) {
      try {
        // 纯观察订阅（ctx.on）——不取 waterfall 控制权，故不存在「审计拦了工具调用」的可能。
        // 监听器返回值被刻意忽略：本模块不产生任何 allow / deny 语义。
        offs.push(ctx.on(event, (...args: unknown[]) => handle(event, args)));
      } catch (err) {
        // 事件域不存在（宿主版本与事件名有出入）——丢该路信号，**不抛**（不影响宿主执行），
        // 但降级必须可见（静默吞错门禁合规形态）：哪一路没接上要能从日志查出来。
        log.warn(`[intent-channel] 事件域 ${event} 订阅失败（该路意图信号丢失，不影响宿主执行）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return () => {
      for (const off of offs) {
        try {
          off();
        } catch (err) {
          // 取消订阅失败——宿主 dispose 时统一清理（与 trajectory 采集器同纪律）；降级可见
          log.warn(`[intent-channel] 取消订阅失败（宿主 dispose 时统一清理）：${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };
  };

  return { plugin, handle, filePath, entries };
}
