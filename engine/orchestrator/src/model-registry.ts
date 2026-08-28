// ============================================================
// model-registry.ts · 模型注册表（v1.3.7 交付 ④）
// ============================================================
//
// 模型上线流程闭环：评测（v1.3.1 Benchmark）→ 注册 → 灰度 → 晋升 → 退役。
// 替代「手改 model-router.json」——每次操作原子写 + 事件留痕 + 可回滚。
//
// 边界（changelog 四、定位）：
//   - 本版只处理 endpoint 型模型（云端/可寻址服务）
//   - source: 'local-path' 扩展位预留（本地权重部署 v1.4.2 填充）——
//     字段可存，但 local-path 条目不可切换为活动模型（无可加载权重）
//   - 通用模型路由不自研——endpoint 可以是第三方 router（LiteLLM/OpenRouter）地址
//   - 数据主权路由铁律不受本模块影响（model-router.ts 内部保留）
//
// 人审语义（对齐 v1.3.5 promote_ab）：
//   - 灰度（percent < 100）：可逆运维操作，直接生效
//   - 晋升（percent = 100）与退役/恢复：🔴 强制人审，humanConfirmed ≠ true 挂起
// ============================================================

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { atomicWriteSync } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

/** 模型来源类型 */
export type ModelSource = 'endpoint' | 'local-path';

/**
 * 端点能力画像（v1.3.6 交付⑧ · Profiles 构件）——role-model 启发。
 * model_register 注册时可选填；注册表存储，查询时可按能力筛选。
 * ⚠️ 只记画像不做路由——实际路由仍由第三方 router 做。
 */
export interface EndpointProfile {
  /** 擅长能力标签（如 ['code', 'long-context']） */
  strengths?: string[];
  /** 支持模态（如 ['text', 'image']） */
  modalities?: string[];
  /** 最大上下文 token 数 */
  maxContext?: number;
  /** 每千 token 成本（成本优先策略的决胜依据） */
  costPerKToken?: number;
  /** 延迟 P50（ms，延迟优先策略的决胜依据） */
  latencyP50?: number;
}

/** 模型状态机 */
export type ModelStatus = 'registered' | 'canary' | 'active' | 'retired';

/** 注册表条目（一个模型一条） */
export interface ModelRegistryEntry {
  /** 注册名（唯一标识——model_switch 按此切换） */
  name: string;
  /** 服务地址（endpoint 型必填；local-path 型为权重目录占位） */
  endpoint: string;
  /** 客户端协议（对齐 model-router LocalModelSchema） */
  clientType: 'ollama' | 'openai-compatible';
  /** 模型名（传给服务的 model 字段） */
  model: string;
  /** 来源类型（local-path = v1.4.1 扩展位预留） */
  source: ModelSource;
  /** 元信息（评测分数 / 备注——评测→注册流程的证据位） */
  meta?: { evalScore?: number; notes?: string };
  /** 端点能力画像（v1.3.6 交付⑧——可选填，不填向后兼容） */
  profile?: EndpointProfile;
  /** 当前状态 */
  status: ModelStatus;
  /** 注册时间（ISO 8601） */
  registeredAt: string;
  /** 退役时间（status=retired 时有值） */
  retiredAt?: string;
  /** 灰度比例（status=canary 时有值；1-99） */
  canaryPercent?: number;
}

/** 注册表事件（全程审计——谁操作、从哪版到哪版） */
export interface ModelRegistryEvent {
  /** 事件时间（ISO 8601） */
  ts: string;
  /** 操作类型 */
  op: 'register' | 'switch' | 'promote' | 'rollback' | 'retire' | 'restore';
  /** 操作者标识 */
  actor: string;
  /** 目标模型名 */
  model: string;
  /** 目标档位（switch/promote/rollback 时有值） */
  lane?: 'executor' | 'pipeline';
  /** 灰度比例（switch 时有值） */
  percent?: number;
  /** 变更前活动模型（switch/promote/rollback 时有值——回滚依据） */
  previousModel?: string;
  /** 操作备注 */
  comment?: string;
}

/** 注册表文件结构（data/config/model-registry.json） */
export interface ModelRegistryFile {
  /** schema 版本 */
  version: 1;
  /** 模型条目（name → entry） */
  models: Record<string, ModelRegistryEntry>;
  /** 活动模型（档位 → 注册名；灰度期间指向 canary 模型） */
  active: { executor?: string; pipeline?: string };
  /** 事件历史（全程留痕） */
  events: ModelRegistryEvent[];
}

/** 注册/切换/退役操作通用入参 */
export interface ModelRegistryOpOptions {
  /** 数据根目录 */
  dataDir: string;
  /** 操作者标识（事件留痕） */
  actor?: string;
  /** 🔴 人工确认（晋升/退役/恢复强制——false/缺省挂起） */
  humanConfirmed?: boolean;
  /** 操作备注 */
  comment?: string;
}

/** 操作结果 */
export interface ModelRegistryOpResult {
  ok: boolean;
  /** 是否挂起等人审（ok=true 但 awaitingHuman=true = 未执行） */
  awaitingHuman: boolean;
  message: string;
  /** 事件留痕（执行时非空） */
  event?: ModelRegistryEvent;
  /** 结构化错误（ok=false 时非空） */
  issues: string[];
}

/** 注册表文件缺失/损坏错误 */
export class ModelRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRegistryError';
  }
}

// ============================================================
// 存储（原子写 + 降级）
// ============================================================

/** 注册表文件路径 */
export function resolveModelRegistryPath(dataDir: string): string {
  return join(dataDir, 'config', 'model-registry.json');
}

/** 空注册表 */
function emptyRegistry(): ModelRegistryFile {
  return { version: 1, models: {}, active: {}, events: [] };
}

/**
 * 加载注册表（缺文件 → 空注册表；损坏 → 抛 ModelRegistryError）。
 */
export function loadRegistry(dataDir: string): ModelRegistryFile {
  const filePath = resolveModelRegistryPath(dataDir);
  if (!existsSync(filePath)) return emptyRegistry();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new ModelRegistryError(`model-registry.json 损坏：${err instanceof Error ? err.message : String(err)}`);
  }
  const file = parsed as ModelRegistryFile;
  if (typeof file !== 'object' || file === null || file.version !== 1) {
    throw new ModelRegistryError('model-registry.json schema 版本非法（期望 version=1）');
  }
  return {
    version: 1,
    models: file.models ?? {},
    active: file.active ?? {},
    events: Array.isArray(file.events) ? file.events : [],
  };
}

/** 保存注册表（原子写——tmp + rename，绝不半写；父目录不存在时自动创建） */
export function saveRegistry(dataDir: string, registry: ModelRegistryFile): void {
  const filePath = resolveModelRegistryPath(dataDir);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(filePath, JSON.stringify(registry, null, 2));
}

// ============================================================
// 注册
// ============================================================

/** registerModel 入参 */
export interface RegisterModelInput {
  name: string;
  endpoint: string;
  clientType?: 'ollama' | 'openai-compatible';
  model: string;
  /** 来源类型（缺省 endpoint；local-path = v1.4.1 扩展位） */
  source?: ModelSource;
  meta?: { evalScore?: number; notes?: string };
  /** 端点能力画像（v1.3.6 交付⑧——可选填，不填向后兼容） */
  profile?: EndpointProfile;
}

/**
 * 注册模型——写入注册表（status=registered，不参与路由）。
 * 同名重复注册 = 更新（保留 registeredAt 首次时间）。
 */
export function registerModel(input: RegisterModelInput, options: ModelRegistryOpOptions): ModelRegistryOpResult {
  const issues: string[] = [];
  if (typeof input.name !== 'string' || input.name.trim() === '') issues.push('name 必填且非空');
  if (typeof input.endpoint !== 'string' || input.endpoint.trim() === '') issues.push('endpoint 必填且非空');
  if (typeof input.model !== 'string' || input.model.trim() === '') issues.push('model 必填且非空');
  if (issues.length > 0) return { ok: false, awaitingHuman: false, message: `注册参数非法：${issues.join('；')}`, issues };

  const registry = loadRegistry(options.dataDir);
  const existing = registry.models[input.name];
  const now = new Date().toISOString();
  registry.models[input.name] = {
    name: input.name,
    endpoint: input.endpoint,
    clientType: input.clientType ?? 'ollama',
    model: input.model,
    source: input.source ?? 'endpoint',
    meta: input.meta,
    // v1.3.6 交付⑧：能力画像可选填；未填时保留已有画像（重复注册不擦除）
    profile: input.profile ?? existing?.profile,
    // 重复注册保留原状态（active 模型更新 endpoint 不降级）
    status: existing?.status ?? 'registered',
    registeredAt: existing?.registeredAt ?? now,
    ...(existing?.status === 'retired' ? { retiredAt: existing.retiredAt } : {}),
  };

  const event: ModelRegistryEvent = {
    ts: now,
    op: 'register',
    actor: options.actor ?? 'sofagent-model-registry',
    model: input.name,
    ...(options.comment ? { comment: options.comment } : {}),
  };
  registry.events.push(event);
  saveRegistry(options.dataDir, registry);

  return {
    ok: true,
    awaitingHuman: false,
    message: `模型「${input.name}」已注册（source=${input.source ?? 'endpoint'}${input.source === 'local-path' ? '，本地权重部署 v1.4.1 启用——暂不可切换为活动模型' : ''}）`,
    event,
    issues: [],
  };
}

// ============================================================
// 灰度切换 / 晋升 / 回滚
// ============================================================

/**
 * 切换活动模型（档位 = executor / pipeline）。
 *
 * 灰度语义：
 *   - percent < 100 → canary（灰度验证期，可逆运维操作直接生效）
 *   - percent = 100 / 缺省 → 晋升为全量活动模型 🔴 强制人审
 *
 * local-path 来源模型不可切换（v1.4.1 才有权重加载链路）。
 */
export function switchModel(
  modelName: string,
  lane: 'executor' | 'pipeline',
  percent: number | undefined,
  options: ModelRegistryOpOptions,
): ModelRegistryOpResult {
  const registry = loadRegistry(options.dataDir);
  const entry = registry.models[modelName];
  if (!entry) {
    return { ok: false, awaitingHuman: false, message: `模型「${modelName}」未注册`, issues: [`模型「${modelName}」未注册——先 model_register`] };
  }
  if (entry.status === 'retired') {
    return { ok: false, awaitingHuman: false, message: `模型「${modelName}」已退役`, issues: ['退役模型不参与路由——先 restore 恢复'] };
  }
  if (entry.source === 'local-path') {
    return { ok: false, awaitingHuman: false, message: `模型「${modelName}」为 local-path 来源`, issues: ['本地权重部署链路 v1.4.1 填充——本版不可切换为活动模型'] };
  }

  const pct = percent ?? 100;
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
    return { ok: false, awaitingHuman: false, message: 'percent 必须是 1-100 整数', issues: ['percent 必须是 1-100 整数'] };
  }

  const now = new Date().toISOString();
  const previousModel = registry.active[lane];

  // 🔴 晋升（percent=100）强制人审——对齐 v1.3.5 promote_ab
  if (pct === 100 && options.humanConfirmed !== true) {
    return {
      ok: true,
      awaitingHuman: true,
      message: `晋升「${modelName}」为 ${lane} 全量活动模型需人工确认（human_confirmed=true 才执行）——灰度验证通过了吗？`,
      issues: [],
    };
  }

  registry.active[lane] = modelName;
  if (pct < 100) {
    entry.status = 'canary';
    entry.canaryPercent = pct;
  } else {
    entry.status = 'active';
    entry.canaryPercent = undefined;
    // 被替换的原活动模型降回 registered（退役除外）
    if (previousModel && previousModel !== modelName) {
      const prev = registry.models[previousModel];
      if (prev && prev.status === 'active') prev.status = 'registered';
    }
  }

  const event: ModelRegistryEvent = {
    ts: now,
    op: pct === 100 ? 'promote' : 'switch',
    actor: options.actor ?? 'sofagent-model-registry',
    model: modelName,
    lane,
    percent: pct,
    ...(previousModel && previousModel !== modelName ? { previousModel } : {}),
    ...(options.comment ? { comment: options.comment } : {}),
  };
  registry.events.push(event);
  saveRegistry(options.dataDir, registry);

  return {
    ok: true,
    awaitingHuman: false,
    message: pct === 100
      ? `「${modelName}」已晋升为 ${lane} 全量活动模型${previousModel && previousModel !== modelName ? `（替换 ${previousModel}）` : ''}`
      : `「${modelName}」进入 ${lane} 灰度（${pct}% 流量）`,
    event,
    issues: [],
  };
}

/**
 * 回滚——把档位活动模型恢复为上一个（从事件历史找最近一次 switch/promote 的 previousModel）。
 * 回滚本身是止损操作，直接生效（不要求人审——对齐「异常 → 一键回滚」语义）。
 */
export function rollbackModel(lane: 'executor' | 'pipeline', options: ModelRegistryOpOptions): ModelRegistryOpResult {
  const registry = loadRegistry(options.dataDir);
  const current = registry.active[lane];
  if (!current) {
    return { ok: false, awaitingHuman: false, message: `${lane} 档位无活动模型——无需回滚`, issues: [] };
  }

  // 从事件历史倒序找最近一次带 previousModel 的 switch/promote
  let target: string | undefined;
  for (let i = registry.events.length - 1; i >= 0; i--) {
    const ev = registry.events[i];
    if (ev && (ev.op === 'switch' || ev.op === 'promote') && ev.lane === lane && ev.previousModel) {
      target = ev.previousModel;
      break;
    }
  }
  if (!target) {
    return { ok: false, awaitingHuman: false, message: `${lane} 档位没有可回滚的历史活动模型`, issues: ['事件历史中无 previousModel 记录'] };
  }

  const targetEntry = registry.models[target];
  if (!targetEntry || targetEntry.status === 'retired') {
    return { ok: false, awaitingHuman: false, message: `回滚目标「${target}」不存在或已退役`, issues: [] };
  }

  const now = new Date().toISOString();
  registry.active[lane] = target;
  targetEntry.status = 'active';
  const demoted = registry.models[current];
  if (demoted) {
    demoted.status = 'registered';
    demoted.canaryPercent = undefined;
  }

  const event: ModelRegistryEvent = {
    ts: now,
    op: 'rollback',
    actor: options.actor ?? 'sofagent-model-registry',
    model: target,
    lane,
    previousModel: current,
    ...(options.comment ? { comment: options.comment } : {}),
  };
  registry.events.push(event);
  saveRegistry(options.dataDir, registry);

  return {
    ok: true,
    awaitingHuman: false,
    message: `${lane} 已回滚：${current} → ${target}`,
    event,
    issues: [],
  };
}

// ============================================================
// 退役 / 恢复
// ============================================================

/**
 * 退役模型（🔴 强制人审）——标记退役，不再参与路由；可恢复。
 * 对齐 v1.3.4 L3 养护环「失效退役」语义。
 */
export function retireModel(modelName: string, options: ModelRegistryOpOptions): ModelRegistryOpResult {
  const registry = loadRegistry(options.dataDir);
  const entry = registry.models[modelName];
  if (!entry) {
    return { ok: false, awaitingHuman: false, message: `模型「${modelName}」未注册`, issues: [] };
  }
  if (entry.status === 'retired') {
    return { ok: false, awaitingHuman: false, message: `模型「${modelName}」已退役（无需重复操作）`, issues: [] };
  }

  // 🔴 强制人审——对齐 promote_ab
  if (options.humanConfirmed !== true) {
    return {
      ok: true,
      awaitingHuman: true,
      message: `退役「${modelName}」需人工确认（human_confirmed=true 才执行）——退役后不再参与路由，可用 restore 恢复`,
      issues: [],
    };
  }

  const now = new Date().toISOString();
  entry.status = 'retired';
  entry.retiredAt = now;
  entry.canaryPercent = undefined;
  // 退役的活动模型从档位摘除
  for (const lane of ['executor', 'pipeline'] as const) {
    if (registry.active[lane] === modelName) registry.active[lane] = undefined;
  }

  const event: ModelRegistryEvent = {
    ts: now,
    op: 'retire',
    actor: options.actor ?? 'sofagent-model-registry',
    model: modelName,
    ...(options.comment ? { comment: options.comment } : {}),
  };
  registry.events.push(event);
  saveRegistry(options.dataDir, registry);

  return { ok: true, awaitingHuman: false, message: `模型「${modelName}」已退役（可恢复）`, event, issues: [] };
}

/**
 * 恢复退役模型（🔴 强制人审——与退役对称）。
 */
export function restoreModel(modelName: string, options: ModelRegistryOpOptions): ModelRegistryOpResult {
  const registry = loadRegistry(options.dataDir);
  const entry = registry.models[modelName];
  if (!entry) {
    return { ok: false, awaitingHuman: false, message: `模型「${modelName}」未注册`, issues: [] };
  }
  if (entry.status !== 'retired') {
    return { ok: false, awaitingHuman: false, message: `模型「${modelName}」未退役（status=${entry.status}）`, issues: [] };
  }

  if (options.humanConfirmed !== true) {
    return {
      ok: true,
      awaitingHuman: true,
      message: `恢复「${modelName}」需人工确认（human_confirmed=true 才执行）`,
      issues: [],
    };
  }

  const now = new Date().toISOString();
  entry.status = 'registered';
  entry.retiredAt = undefined;

  const event: ModelRegistryEvent = {
    ts: now,
    op: 'restore',
    actor: options.actor ?? 'sofagent-model-registry',
    model: modelName,
    ...(options.comment ? { comment: options.comment } : {}),
  };
  registry.events.push(event);
  saveRegistry(options.dataDir, registry);

  return { ok: true, awaitingHuman: false, message: `模型「${modelName}」已恢复（status=registered）`, event, issues: [] };
}

// ============================================================
// 活动模型解析（model-router-config 消费面）
// ============================================================

/**
 * 读取各档位的活动模型条目（registry → router 配置覆盖的数据源）。
 * 退役/灰度未满的模型：灰度期 canary 条目同样返回（router 按比例分流由上层决策——
 * 本版 router 只认活动条目，灰度比例透传给调用方）。
 */
export function readActiveEndpoints(dataDir: string): {
  executor?: ModelRegistryEntry;
  pipeline?: ModelRegistryEntry;
} {
  const registry = loadRegistry(dataDir);
  const pick = (lane: 'executor' | 'pipeline'): ModelRegistryEntry | undefined => {
    const name = registry.active[lane];
    if (!name) return undefined;
    const entry = registry.models[name];
    if (!entry || entry.status === 'retired') return undefined;
    return entry;
  };
  return { executor: pick('executor'), pipeline: pick('pipeline') };
}
