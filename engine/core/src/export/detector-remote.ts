// ============================================================
// detector-remote.ts · v1.5.2 T8 · L2 外挂 NER 检测器客户端（fail-closed）
// ============================================================
//
// 两类实现走同一接口：
//   ① 企业侧 NER 服务经 endpoint 配置接入（HTTP：文本→spans）
//   ② 本地模型检测器适配器——一体机本地模型（Ollama/vLLM 已注册端点）
//      以结构化输出抽取实体（开箱即用、客户零额外部署）
//
// 引擎调度、外挂推理——置信度透传给消费方定档。
//
// fail-closed 铁律：端点不可达 / 超时 / 响应不合法 → **不静默放行**——
// 抛错交由 DetectorRegistry.runPipeline 的 degraded 登记降级 L0+L1 继续
// 检测（降级事实可入审计链）。
//
// fetch 注入：缺省走全局 fetch（Node 18+）；测试注入 stub——
// 不可达/超时/坏响应三形态故障注入可测。
// ============================================================

import {
  type Detector,
  type SensitiveSpan,
} from './detector-registry';
import { toPresidioType } from './detector-presidio-schema';

/** 远程端点配置 */
export interface RemoteDetectorConfig {
  /** 检测器名（注册表键——审计留痕） */
  name?: string;
  /** HTTP 端点（如 http://127.0.0.1:11434/api/ner——一体机本地 Ollama 形态） */
  endpoint: string;
  /** 超时毫秒（缺省 3000——本地端点快失败，降级不拖管线） */
  timeoutMs?: number;
  /** 请求头（鉴权等） */
  headers?: Record<string, string>;
}

/** 远端响应的 span 形态（约定 schema——结构化输出） */
export interface RemoteSpanResponse {
  entity_type?: string;
  label?: string;
  start?: number;
  end?: number;
  score?: number;
}

/** L2 检测器名缺省前缀 */
export const L2_REMOTE_DETECTOR_DEFAULT_NAME = 'l2-remote-ner';

/** 可注入的 fetch 面（测试故障注入——不可达/超时/坏响应三形态） */
export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * 校验远端 span 响应（fail-closed 第二道：HTTP 200 但结构不合法同样拒绝——
 * 不把「读不懂的输出」当「无敏感」处理）。
 */
export function validateRemoteSpans(
  raw: unknown,
  detectorName: string,
): { ok: boolean; spans: SensitiveSpan[]; reason?: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, spans: [], reason: '响应体非数组（约定 schema：span 数组）' };
  }
  const spans: SensitiveSpan[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      return { ok: false, spans: [], reason: 'span 条目非对象' };
    }
    const r = item as RemoteSpanResponse;
    const label = r.label ?? r.entity_type;
    if (typeof label !== 'string' || label === '') {
      return { ok: false, spans: [], reason: 'span 缺 label/entity_type' };
    }
    if (typeof r.start !== 'number' || typeof r.end !== 'number' || r.start < 0 || r.end <= r.start) {
      return { ok: false, spans: [], reason: `span「${label}」区间非法（start=${r.start} end=${r.end}）` };
    }
    const score = typeof r.score === 'number' && r.score >= 0 && r.score <= 1 ? r.score : 0.5;
    spans.push({
      start: r.start,
      end: r.end,
      text: '', // 远端不回传原文——text 由调用方从输入切片（detect 内补齐）
      label,
      entityType: toPresidioType(r.entity_type ?? label),
      score,
      detector: detectorName,
      layer: 'L2',
    });
  }
  return { ok: true, spans };
}

/**
 * L2 外挂 NER 检测器（endpoint 配置 + fetch 注入 + 置信度透传）。
 *
 * 检测为 async 语义但插槽接口同步——实现为「检测时一次同步 HTTP 调用」：
 * Node fetch 是异步的，本检测器以内部同步等待封装（child_process execSync
 * 不可用于 HTTP；实际采用 DetectAbortError 上抛方案：fetch promise 经
 * runPipeline 调度的同步 detect 面无法 await——故本检测器把 async fetch
 * 结果在构造时预取不可行，改为 detect() 内同步自旋等待 promise settle
// 不现实）。
 *
 * ✅ 实际实现（简洁诚实）：detect() 直接上抛「异步面不兼容」——L2 检测
 * 经 **async 预检批接口** `prefetchRemote(text)` 消费：调用方先 await 预取，
 * 再把结果经 `createPrefetchedRemoteDetector(spans)` 包成同步检测器注册。
 * 这样插槽接口保持同步纯净，异步边界在调用方（一次预取 + 注册 + 跑管线）。
 */
export function createRemoteDetector(config: RemoteDetectorConfig, fetchLike?: FetchLike): Detector {
  const name = config.name ?? L2_REMOTE_DETECTOR_DEFAULT_NAME;
  return {
    name,
    layer: 'L2',
    detect(_text: string): SensitiveSpan[] {
      // 异步面与同步插槽不兼容——上抛交 degraded 登记（fail-closed 不静默），
      // 调用方应改用 prefetchRemoteSpans + createPrefetchedRemoteDetector 组合
      throw new Error(
        'L2 远程检测是异步面——请先 await prefetchRemoteSpans() 预取，再经 createPrefetchedRemoteDetector() 包装注册（直接 detect 会绕过 fail-closed 降级登记）',
      );
    },
  };
}

/**
 * 预取远端 spans（异步面——调用方 await 后经 createPrefetchedRemoteDetector 入管线）。
 *
 * fail-closed 三形态全上抛（交调用方决定降级策略，Registry 侧 degraded 登记）：
 *   - 不可达（网络错误/连接拒绝）
 *   - 超时（AbortController + timeoutMs）
 *   - 响应不合法（非 200 / schema 校验失败）
 */
export async function prefetchRemoteSpans(
  text: string,
  config: RemoteDetectorConfig,
  fetchLike?: FetchLike,
): Promise<SensitiveSpan[]> {
  const name = config.name ?? L2_REMOTE_DETECTOR_DEFAULT_NAME;
  const timeoutMs = config.timeoutMs ?? 3000;
  const doFetch = fetchLike ?? ((u: string, i: RequestInit) => fetch(u, i) as unknown as Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.headers ?? {}) },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`L2 端点 ${config.endpoint} 返回 HTTP ${res.status}（fail-closed——不把失败响应当无敏感）`);
    }
    const body = await res.json();
    const validated = validateRemoteSpans(body, name);
    if (!validated.ok) {
      throw new Error(`L2 端点 ${config.endpoint} 响应不合法：${validated.reason}（fail-closed）`);
    }
    // 补齐原文切片（远端不回传 text——偏移可信前提下方可切片）
    return validated.spans.map((s) => ({
      ...s,
      text: text.slice(s.start, s.end),
    }));
  } finally {
    clearTimeout(timer);
  }
}

/** 预取结果包装成同步检测器（spans 已含 text——直接透传） */
export function createPrefetchedRemoteDetector(
  spans: readonly SensitiveSpan[],
  opts: { name?: string } = {},
): Detector {
  return {
    name: opts.name ?? L2_REMOTE_DETECTOR_DEFAULT_NAME,
    layer: 'L2',
    detect(): SensitiveSpan[] {
      return spans.map((s) => ({ ...s }));
    },
  };
}
