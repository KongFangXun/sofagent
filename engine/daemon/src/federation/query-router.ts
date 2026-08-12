// ============================================================
// query-router.ts · 联邦查询路由（广播 + 并发 fetch + 超时降级）
// v1.3.3 新增
// ============================================================
//
// 核心流程：
//   1. broadcastQuery：向所有在线 peer 并发 fetch（单 peer 5s 超时按离线）
//   2. 帧格式：AES-256-GCM 加密的 JSON（iv‖tag‖ciphertext 拼接）
//   3. sensitivity 双重保护：peer 端过滤（不返回 restricted）+
//      本地端收到后再验一次（防 peer 篡改）——本模块负责本地端校验
//   4. 篡改检测：sensitivity 标签与内容可疑组合（标 public 但内容命中
//      敏感模式）→ 降权不丢弃 + 审计 WARN
//
// 依赖注入：FederationChannel 经参数传入（生产=OpenClaw，测试=内存 channel）。

import {
  encryptPayload,
  decryptPayload,
  isSensitivityVisible,
  resolveTrust,
  TRUST_ORDER,
  type PairedPeer,
  type Sensitivity,
  type Trust,
} from '@sofagent/core';
import type { FederationChannel } from './channel';
import { markPeerAlive, markPeerFailure } from './peers';

/** 单 peer 查询超时（5s，超时按离线处理） */
export const PEER_QUERY_TIMEOUT_MS = 5000;

/** 联邦查询请求 */
export interface KnowledgeQuery {
  /** 查询关键词 */
  text: string;
  /** 请求方可见的最高 sensitivity（默认 internal——restricted 绝不外发） */
  viewerLevel?: Sensitivity;
  /** 返回条数上限（默认 10） */
  limit?: number;
}

/** 单条知识结果（peer 返回 + 本地共用的最小结构） */
export interface KnowledgeQueryResult {
  /** 条目 id（entity/concept 名） */
  id: string;
  /** 标题 */
  title: string;
  /** 内容摘要 */
  content: string;
  /** 敏感度（peer 端声明；本地端会二次校验） */
  sensitivity: Sensitivity;
  /** 可信度（缺省按 internal） */
  trust?: Trust;
  /** 最后修改时间（ISO 或 epoch ms；用于新鲜度排序） */
  mtime?: number;
}

/** 单个 peer 的返回（含来源与审计信息） */
export interface FederationResult {
  peerId: string;
  results: KnowledgeQueryResult[];
  /** 本次 fetch 的 WARN（如篡改降权），无则空数组 */
  warnings: string[];
}

// ────────────────────────────────────────────────────────────
// 帧编解码（AES-256-GCM：iv‖tag‖ciphertext）
// ────────────────────────────────────────────────────────────

/** 加密 JSON payload 为传输帧 */
export function encodeFrame(key: Buffer, payload: unknown): Buffer {
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const { iv, ciphertext, tag } = encryptPayload(key, plaintext);
  return Buffer.concat([iv, tag, ciphertext]);
}

/** 解密传输帧为 JSON payload（篡改 → 抛错） */
export function decodeFrame<T>(key: Buffer, frame: Buffer): T {
  const iv = frame.subarray(0, 12);
  const tag = frame.subarray(12, 28);
  const ciphertext = frame.subarray(28);
  const plaintext = decryptPayload(key, iv, ciphertext, tag);
  return JSON.parse(plaintext.toString('utf-8')) as T;
}

// ────────────────────────────────────────────────────────────
// peer trust 本地白名单——trust 字段不能来自 peer 自报
// ────────────────────────────────────────────────────────────

/** 本地维护的 peer trust 白名单（peerId → trust）。空 = 无白名单记录。 */
const LOCAL_PEER_TRUST = new Map<string, Trust>();

/**
 * 设置 peer 的本地信任等级（本地管理员显式配置，peer 无法自报）。
 * @param peerId peer 标识
 * @param trust 信任等级（official/internal/user/web）
 */
export function setLocalPeerTrust(peerId: string, trust: Trust): void {
  LOCAL_PEER_TRUST.set(peerId, trust);
}

/**
 * 读取 peer 的本地信任等级。
 * 默认 'user'（低可信）——除非本地显式提升，否则远端内容一律按不可信源处理。
 */
export function getLocalPeerTrust(peerId: string): Trust {
  return LOCAL_PEER_TRUST.get(peerId) ?? 'user';
}

// ────────────────────────────────────────────────────────────
// sensitivity 双重保护（本地端校验）
// ────────────────────────────────────────────────────────────

/** 内容敏感模式（标 public 但内容疑似敏感的篡改检测） */
const SENSITIVE_CONTENT_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/,       // API key
  /\bAKIA[A-Z0-9]{16}\b/,           // AWS key
  /\b1[3-9]\d{9}\b/,                // 手机号
  /password|密码|密钥|secret/i,
];

/**
 * 本地端二次校验单条结果：
 *   - restricted 条目 → 丢弃（peer 违约返回）
 *   - 标签可疑（标 public 但内容命中敏感模式）→ trust 降为 web + WARN（不丢弃）
 *   - trust 一律采用本地白名单等级（localTrust ?? getLocalPeerTrust(peerId)），
 *     绝不采信 peer 自报的 trust 字段——peer 自称 'official' 不再能覆盖本地知识。
 *
 * @returns { result, warning } —— result 为 null 表示丢弃
 */
export function validateRemoteResult(
  peerId: string,
  item: KnowledgeQueryResult,
  localTrust?: Trust,
): { result: KnowledgeQueryResult | null; warning: string | null } {
  // 防线一：restricted 不接收（与 peer 端过滤呼应的双重保护）
  if (!isSensitivityVisible(item.sensitivity, 'internal')) {
    return { result: null, warning: null };
  }
  // 防线三：trust 来自本地白名单（默认 user），peer 自报的 trust 被忽略
  const effectiveTrust: Trust = localTrust ?? getLocalPeerTrust(peerId);
  // 防线二：篡改标签降权——标 public 但内容疑似敏感
  if (item.sensitivity === 'public') {
    const hit = SENSITIVE_CONTENT_PATTERNS.some((re) => re.test(item.content));
    if (hit) {
      return {
        result: { ...item, trust: 'web' },
        warning: `peer ${peerId} 返回可疑条目 ${item.id}：标 public 但内容疑似敏感，已降权 trust=web`,
      };
    }
  }
  return { result: { ...item, trust: effectiveTrust }, warning: null };
}

// ────────────────────────────────────────────────────────────
// 单 peer fetch（超时按离线）
// ────────────────────────────────────────────────────────────

/**
 * 向单个 peer 发起查询
 * @returns null = 超时/离线/解密失败（按离线处理，不抛错）
 */
export async function fetchFromPeer(
  peer: PairedPeer,
  query: KnowledgeQuery,
  channel: FederationChannel,
  timeoutMs: number = PEER_QUERY_TIMEOUT_MS,
): Promise<KnowledgeQueryResult[] | null> {
  // 无 sharedKey 的 peer（如路径 C 配对）无法加密通信——跳过
  if (!peer.sharedKey) return null;
  try {
    const frame = encodeFrame(peer.sharedKey, {
      text: query.text,
      viewerLevel: query.viewerLevel ?? 'internal',
      limit: query.limit ?? 10,
    });
    const responseFrame = await withTimeout(channel.send({ peerId: peer.peerId, frame }, timeoutMs), timeoutMs);
    const payload = decodeFrame<{ results?: KnowledgeQueryResult[] }>(peer.sharedKey, responseFrame);
    markPeerAlive(peer.peerId);
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    markPeerFailure(peer.peerId);
    return null;
  }
}

/**
 * 广播查询到全部 peer（并发 fetch），返回各 peer 校验后的结果
 *
 * @param query 查询
 * @param peers 已配对 peer 列表
 * @param channel 传输 channel
 * @param onWarning 审计 WARN 回调（默认 console.warn）
 */
export async function broadcastQuery(
  query: KnowledgeQuery,
  peers: PairedPeer[],
  channel: FederationChannel,
  onWarning: (msg: string) => void = (m) => console.warn(`⚠️ [federation] ${m}`),
): Promise<FederationResult[]> {
  const settled = await Promise.all(
    peers.map(async (peer): Promise<FederationResult | null> => {
      const raw = await fetchFromPeer(peer, query, channel);
      if (raw === null) return null; // 离线/超时——跳过不阻塞
      const warnings: string[] = [];
      const validated: KnowledgeQueryResult[] = [];
      for (const item of raw) {
        // 本地白名单 trust 注入——peer 自报的 trust 一律被本地等级覆盖
        const { result, warning } = validateRemoteResult(peer.peerId, item, getLocalPeerTrust(peer.peerId));
        if (warning) {
          warnings.push(warning);
          onWarning(warning);
        }
        if (result) validated.push(result);
      }
      return { peerId: peer.peerId, results: validated, warnings };
    }),
  );
  return settled.filter((r): r is FederationResult => r !== null);
}

/** 超时包装：Promise 竞速，超时抛错（由调用方按离线捕获） */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`peer 查询超时（>${timeoutMs}ms）`)), timeoutMs);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** trust 排序权重辅助（merge 模块复用） */
export function trustWeightOf(item: KnowledgeQueryResult): number {
  return TRUST_ORDER[item.trust ?? resolveTrust(null)];
}
