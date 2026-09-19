// ============================================================
// model-inventory.ts · 执行侧模型清单扫描（v1.5.0 T10 第三项）
// ============================================================
//
// 设备/引擎侧扫描本机可用模型，随心跳上报（availableModels 字段——
// BYOK 企业 workflow 模型绑定下拉列表的数据源）。
//
// 方向（changelog 十章）：执行侧如实上报、平台只展示不代理——
// 与「平台永不执行业务代码」红线同向。本模块只做**扫描与清单构造**，
// 不做模型代理、不预置密钥。
//
// 扫描两个来源：
//   1. 模型注册表（<dataDir>/config/model-registry.json——
//      @sofagent/orchestrator/model-registry 的 loadRegistry；注册表
//      缺失/损坏 → 返回空清单 + degraded 原因，不抛错——扫描面是
//      观测面，注册表异常不应打断心跳主链）；
//   2. 本地推理端点探测（默认探测 http://localhost:11434/api/tags
//      即 Ollama tags 面；探测失败 → 该来源记 0 且带降级原因——
//      探测是 best-effort，不 fail 心跳）。
//
// 依赖形态：daemon 已依赖 @sofagent/orchestrator（real-provider 先例，
// subpath import '@sofagent/orchestrator/model-registry'）。端点探测用
// Node 内置 fetch（Node 18+，与仓内 cloud-exec 同基线）。
//
// 上报语义（changelog 十章交付表）：
//   - availableModels：去重后的模型清单（name/endpoint/clientType/
//     source/status 五字段——足够平台做展示与绑定，不含密钥）；
//   - runtimeSkillPackages：执行时 skill 快照清单（本模块只定义
//     类型与读侧——快照的打包/清理由 orchestrator 侧 skill-snapshot
//     负责，心跳携带清单落 DeviceRecord）。
// ============================================================

import { loadRegistry } from '@sofagent/orchestrator/model-registry';

/** 单个可用模型的上报条目（五字段——刻意不含 API key） */
export interface AvailableModelEntry {
  /** 注册名（唯一标识——平台下拉列表显示值） */
  name: string;
  /** 服务地址（endpoint 型真实地址；local-path 型为权重目录占位） */
  endpoint: string;
  /** 客户端协议（ollama / openai-compatible） */
  clientType: 'ollama' | 'openai-compatible';
  /** 来源（registry=注册表扫描 / probed=端点探测） */
  source: 'registry' | 'probed';
  /** 状态（registered/canary/active/retired——probed 条目恒 active） */
  status: 'registered' | 'canary' | 'active' | 'retired';
}

/** skill 快照清单条目（执行时快照——orchestrator skill-snapshot 产出） */
export interface RuntimeSkillPackage {
  /** skill 名 */
  name: string;
  /** 版本（无版本化时为快照时间戳） */
  version: string;
  /** 内容 sha256（前 16 位——审计锚点用） */
  sha256: string;
}

/** 扫描结果（心跳携带面 + 降级原因——观测面不抛错） */
export interface ModelInventory {
  /** 可用模型清单（registry + probed 去重——按 name 去重，registry 优先） */
  availableModels: AvailableModelEntry[];
  /** 来源降级说明（注册表读失败 / 探测失败时逐条记录——空数组=全来源正常） */
  degradedReasons: string[];
}

/** 默认探测端点（Ollama tags 面——本地推理最常见的形态） */
export const DEFAULT_PROBE_ENDPOINTS: string[] = ['http://localhost:11434/api/tags'];

/** 探测超时（毫秒）——best-effort，不 fail 心跳 */
export const PROBE_TIMEOUT_MS = 2_000;

/**
 * 从模型注册表扫描（同步——注册表是本地 JSON 文件）。
 *
 * 注册表缺失 / 损坏（ModelRegistryError）→ 返回空清单并记降级原因。
 * 只收录非 retired 条目（retired = 已退役，不进可用清单）。
 */
export function scanRegistryModels(dataDir: string): ModelInventory {
  try {
    const registry = loadRegistry(dataDir);
    const availableModels: AvailableModelEntry[] = [];
    for (const entry of Object.values(registry.models)) {
      if (entry.status === 'retired') continue;
      availableModels.push({
        name: entry.name,
        endpoint: entry.endpoint,
        clientType: entry.clientType,
        source: 'registry',
        status: entry.status,
      });
    }
    return { availableModels, degradedReasons: [] };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      availableModels: [],
      degradedReasons: [`模型注册表不可读（${reason}）——注册表来源记 0`],
    };
  }
}

/**
 * 探测单个本地端点（异步 best-effort）。
 *
 * 探测失败（连接拒绝 / 超时 / 响应非 JSON）→ 返回 { models: [], degraded }，
 * 绝不抛错——探测面是观测面。
 *
 * 响应格式约定：Ollama /api/tags 形态 `{ models: [{ name: string }] }`；
 * 其他形态解析不出 name 数组 → 记降级原因（结构不符）。
 */
export async function probeEndpoint(
  url: string,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ models: AvailableModelEntry[]; degraded?: string }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { signal: controller.signal });
      if (!res.ok) {
        return { models: [], degraded: `端点 ${url} 响应非 2xx（${res.status}）` };
      }
      const body = (await res.json()) as { models?: Array<{ name?: unknown }> };
      if (!body || !Array.isArray(body.models)) {
        return { models: [], degraded: `端点 ${url} 响应结构不符（无 models 数组）` };
      }
      const models: AvailableModelEntry[] = [];
      for (const m of body.models) {
        if (typeof m?.name !== 'string' || m.name.length === 0) continue;
        models.push({
          name: m.name,
          endpoint: url,
          clientType: 'ollama',
          source: 'probed',
          status: 'active',
        });
      }
      return { models };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { models: [], degraded: `端点 ${url} 探测失败（${reason}）` };
  }
}

/**
 * 全量扫描（注册表 + 端点探测，按 name 去重——registry 优先）。
 *
 * 去重规则：探测到的模型与注册表同名 → 保留 registry 条目（注册表条目
 * 带完整画像与状态机，探测条目只有名字）；探测独有 → 收录（probed）。
 */
export async function scanModelInventory(
  dataDir: string,
  opts: { probeEndpoints?: string[]; fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<ModelInventory> {
  const base = scanRegistryModels(dataDir);
  const endpoints = opts.probeEndpoints ?? DEFAULT_PROBE_ENDPOINTS;
  const availableModels = [...base.availableModels];
  const degradedReasons = [...base.degradedReasons];
  const known = new Set(availableModels.map((m) => m.name));
  for (const url of endpoints) {
    const probed = await probeEndpoint(url, { fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs });
    if (probed.degraded) degradedReasons.push(probed.degraded);
    for (const m of probed.models) {
      if (known.has(m.name)) continue; // registry 优先——同名去重
      known.add(m.name);
      availableModels.push(m);
    }
  }
  return { availableModels, degradedReasons };
}
