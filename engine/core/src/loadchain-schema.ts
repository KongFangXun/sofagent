// ============================================================
// loadchain-schema.ts · 加载链四层配置面契约（v1.7.0 章三）
// ============================================================
//
// ── 这一件解决什么 ──
// 加载链四层（SKILL.md / fde.md / think.md / knowledge/）此前**没有配置面 schema**：
// 「哪些字段可配、归哪层管」全靠人读实现，没有任何机器审计。本节把四层各自的配置字段
// 提升为**配置面 SSOT**（归属层 + 类型 + 默认值 + 实现引用锚点），并给出三类所有权断言：
//
//   ① 归属唯一：同一字段名被两层声明 ⇒ 拒绝并具名（LoadChainOwnershipError）
//   ② 未登记拒绝：加载链实现引用的字段未登记 ⇒ 拒绝并具名（LoadChainUnregisteredFieldError）
//      ——「配置面无死角」：schema 是唯一入口，实现不得绕过它私自读配置。
//   ③ 越界检测：配置值写入非本层字段 ⇒ 拒绝并具名（LoadChainBoundaryError）
//      ——对齐 v1.5.8 章五「装配面陷阱机器化」同款思路（那章管能力开关，本章管配置字段）。
//
// ── 字段从哪来（实测提取，非凭空设想）──
// 每个字段的 `implRef` 指名它在**加载链实现**里的真实读取点（文件 + 源码锚点 needle）：
//   · engine/inject/src/index.ts          —— npm API 形态加载链（四层注入主实现）
//   · engine/inject/src/knowledge-index.ts —— L4 知识库索引构建
//   · engine/core/src/memory-contract.ts   —— think.md 路径/层级 SSOT
//   · engine/hooks/sofagent-load-chain/src/handler.ts —— OpenClaw hook 形态加载链
// 文件级「实现引用 vs schema 登记」双向对账由 tools/check/check-loadchain-config.mjs 承担
// （逐字段核对 implRef 锚点仍在，且反向扫实现里的 SOFAGENT_* 配置引用无未登记者）。
//
// ── 单一事实源（SSOT）与门禁的对账机制 ──
// 下面的字段表以一段**标记包裹的 JSON** 承载：本模块在运行期 JSON.parse 它建类型化数组，
// 而零依赖的 check-loadchain-config.mjs 直接从**同一段字节**里取 JSON 对账——两侧读同一源，
// 不存在「TS 一份、脚本一份」的双事实源。改动字段表只改这一处。
//   ⚠️ 标记行 `LOADCHAIN-CONFIG-SSOT:BEGIN` / `:END` 之间必须恰好一个模板字符串（JSON 文本），
//      门禁按此约定提取；改结构必须同步改门禁的提取正则。
//
// ── 字段归属的裁定口径 ──
// 字段归「其加载行为所服务的层」所有。少数跨层开关按「主要受其约束的层」归属并逐条写明
// rationale（例：装配件数上限归 knowledge——知识库是全链唯一多部件层；压缩预算归 SKILL.md
// ——压缩保留的红线/铁律段即宪法层内容）。归属是**显式裁定**，不是默认值。
// ============================================================

/** 加载链四层（顺序即注入顺序：宪法 → 规范 → 反思 → 知识库） */
export const LOAD_CHAIN_LAYERS = ['SKILL.md', 'fde.md', 'think.md', 'knowledge'] as const;

/** 加载链层名 */
export type LoadChainLayer = (typeof LOAD_CHAIN_LAYERS)[number];

/** 配置字段类型 */
export type LoadChainFieldType = 'string' | 'number' | 'boolean' | 'string[]';

/** 字段在加载链实现里的读取锚点（文件路径 + 源码 needle） */
export interface LoadChainImplRef {
  /** 相对仓库根的实现文件路径 */
  file: string;
  /** 该字段在实现中的源码锚点（子串匹配；门禁据此核对实现仍在引用该字段） */
  needle: string;
}

/** 单个配置字段的登记条目 */
export interface LoadChainField {
  /** 字段名（全局唯一身份——同名字段不得两层声明） */
  key: string;
  /** 归属层（LOAD_CHAIN_LAYERS 之一） */
  layer: LoadChainLayer;
  /** 类型 */
  type: LoadChainFieldType;
  /** 默认值（null = 缺省不生效/不注入） */
  default: string | number | boolean | null;
  /** 实现引用锚点（证明该字段真的被加载链读取） */
  implRef: LoadChainImplRef;
  /** 归属裁定理由（为什么归这一层） */
  rationale: string;
}

// ── 配置面 SSOT（单一事实源：本模块与门禁读同一段字节）────────
// LOADCHAIN-CONFIG-SSOT:BEGIN
const LOAD_CHAIN_CONFIG_FIELDS_JSON = `[
  {
    "key": "skillDir",
    "layer": "SKILL.md",
    "type": "string",
    "default": ".sofagent",
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "opts?.skillDir" },
    "rationale": "链根目录——四层文件名均相对此目录解析。宪法层为链首层，链参数随根一起解析，故归宪法层。"
  },
  {
    "key": "skillMdFileName",
    "layer": "SKILL.md",
    "type": "string",
    "default": "SKILL.md",
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "'SKILL.md'" },
    "rationale": "宪法层文件名（四底线 + 九铁律）。"
  },
  {
    "key": "tenantId",
    "layer": "SKILL.md",
    "type": "string",
    "default": null,
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "opts?.tenantId" },
    "rationale": "身份上下文段，先于宪法层注入（Agent 从第一条 prompt 起知道租户边界）——挂在链首层。默认 null = 不注入。"
  },
  {
    "key": "SOFAGENT_HOME",
    "layer": "SKILL.md",
    "type": "string",
    "default": "~/.sofagent",
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "SOFAGENT_HOME" },
    "rationale": "引擎 home：用户级 custom 层读取根与数据根均由它派生——链根归属宪法层。"
  },
  {
    "key": "SOFAGENT_CONTEXT_WINDOW_TOKENS",
    "layer": "SKILL.md",
    "type": "number",
    "default": 0,
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "SOFAGENT_CONTEXT_WINDOW_TOKENS" },
    "rationale": "上下文压缩预算门控（缺省 0 = 不启用压缩）。压缩保留的红线/铁律段即宪法层内容，故归宪法层。"
  },
  {
    "key": "SOFAGENT_CONTEXT_BUDGET_RATIO",
    "layer": "SKILL.md",
    "type": "number",
    "default": 0.03,
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "SOFAGENT_CONTEXT_BUDGET_RATIO" },
    "rationale": "加载链占比上限（合法域 (0,0.2]，缺省 0.03）。同压缩预算，归宪法层。"
  },
  {
    "key": "fdeFileName",
    "layer": "fde.md",
    "type": "string",
    "default": "fde.md",
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "'fde.md'" },
    "rationale": "规范层文件名（企业专属规则）。"
  },
  {
    "key": "thinkFileName",
    "layer": "think.md",
    "type": "string",
    "default": "think.md",
    "implRef": { "file": "engine/core/src/memory-contract.ts", "needle": "THINK_MD_FILENAME = 'think.md'" },
    "rationale": "反思层文件名（think.md 契约：Ledger 层、append-only 单源）。"
  },
  {
    "key": "SOFAGENT_DATA",
    "layer": "think.md",
    "type": "string",
    "default": "~/.sofagent/data",
    "implRef": { "file": "engine/hooks/sofagent-load-chain/src/handler.ts", "needle": "SOFAGENT_DATA" },
    "rationale": "数据目录——think.md 权威落点在其下（THINK_MD 解析根），故归反思层。"
  },
  {
    "key": "thinkSelfEvalWeight",
    "layer": "think.md",
    "type": "number",
    "default": 0.3,
    "implRef": { "file": "engine/hooks/sofagent-load-chain/src/handler.ts", "needle": "权重×0.3" },
    "rationale": "[LLM自评] 条目注入降权系数（未经外部验证，仅供参考）——反思层内的条目治理参数。"
  },
  {
    "key": "knowledgeDirName",
    "layer": "knowledge",
    "type": "string",
    "default": "knowledge",
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "'knowledge'" },
    "rationale": "知识库层目录名（相对链根）。"
  },
  {
    "key": "knowledgeHotEntries",
    "layer": "knowledge",
    "type": "number",
    "default": 2,
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "topKnowledgeByMtime(knowledgeDir, 2)" },
    "rationale": "热点全文注入篇数（mtime 最新 top-N）。"
  },
  {
    "key": "knowledgeHotEntryMaxChars",
    "layer": "knowledge",
    "type": "number",
    "default": 2000,
    "implRef": { "file": "engine/inject/src/index.ts", "needle": ".slice(0, 2000)" },
    "rationale": "热点全文单篇字符上限（防 prompt 膨胀）。"
  },
  {
    "key": "knowledgeIndexMaxEntries",
    "layer": "knowledge",
    "type": "number",
    "default": 9,
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "formatKnowledgeIndex(indexEntries, 9)" },
    "rationale": "知识索引注入条数上限（shared/federation/local 合计 9 条摘要）。"
  },
  {
    "key": "knowledgeIndexEntryMaxChars",
    "layer": "knowledge",
    "type": "number",
    "default": 150,
    "implRef": { "file": "engine/inject/src/knowledge-index.ts", "needle": "INDEX_ENTRY_MAX_CHARS = 150" },
    "rationale": "索引单条摘要字符上限（≤150 字符/条铁律）。"
  },
  {
    "key": "knowledgeSharedDirName",
    "layer": "knowledge",
    "type": "string",
    "default": "shared",
    "implRef": { "file": "engine/inject/src/knowledge-index.ts", "needle": "options.sharedDirName ?? 'shared'" },
    "rationale": "知识库跨设备共享子目录名。"
  },
  {
    "key": "knowledgeFederationDirName",
    "layer": "knowledge",
    "type": "string",
    "default": "federation",
    "implRef": { "file": "engine/inject/src/knowledge-index.ts", "needle": "options.federationDirName ?? 'federation'" },
    "rationale": "知识库联邦来源子目录名（内容强制 <untrusted> 包裹）。"
  },
  {
    "key": "maxParts",
    "layer": "knowledge",
    "type": "number",
    "default": 20,
    "implRef": { "file": "engine/inject/src/index.ts", "needle": "MAX_PARTS = 20" },
    "rationale": "装配件数上限。知识库是全链唯一多部件层（热点全文 + 索引 + 逐篇），上限主要防知识库膨胀，故归知识库层。"
  }
]`;
// LOADCHAIN-CONFIG-SSOT:END

/**
 * 配置面 SSOT：加载链四层全部已登记配置字段。
 *
 * ⚠️ 运行期由上方标记块 JSON 解析而来——与 tools/check/check-loadchain-config.mjs 读同一段字节，
 * 无第二事实源。改动字段表只改标记块。
 */
export const LOAD_CHAIN_CONFIG_FIELDS: readonly LoadChainField[] = JSON.parse(
  LOAD_CHAIN_CONFIG_FIELDS_JSON,
) as readonly LoadChainField[];

// ============================================================
// 三类所有权断言的错误类型
// ============================================================

/** 加载链配置面契约错误基类 */
export class LoadChainSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadChainSchemaError';
  }
}

/** 归属不唯一：同一字段名被两层声明 */
export class LoadChainOwnershipError extends LoadChainSchemaError {
  constructor(message: string) {
    super(message);
    this.name = 'LoadChainOwnershipError';
  }
}

/** 未登记：实现引用的字段不在 schema（配置面死角） */
export class LoadChainUnregisteredFieldError extends LoadChainSchemaError {
  constructor(message: string) {
    super(message);
    this.name = 'LoadChainUnregisteredFieldError';
  }
}

/** 越界：配置值写入非本层字段 */
export class LoadChainBoundaryError extends LoadChainSchemaError {
  constructor(message: string) {
    super(message);
    this.name = 'LoadChainBoundaryError';
  }
}

// ============================================================
// 断言实现
// ============================================================

/** 取某层登记的全部字段 */
export function getFieldsByLayer(
  layer: LoadChainLayer,
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): LoadChainField[] {
  return fields.filter((f) => f.layer === layer);
}

/**
 * ① 归属唯一断言：同一字段名不得被两层（或同层两次）声明。
 * 违规 ⇒ 抛 LoadChainOwnershipError，消息**具名**字段与全部声明层。
 */
export function assertUniqueOwnership(
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): void {
  const byKey = new Map<string, string[]>();
  for (const f of fields) {
    if (!(LOAD_CHAIN_LAYERS as readonly string[]).includes(f.layer)) {
      throw new LoadChainOwnershipError(
        `加载链配置字段「${f.key}」归属层非法：「${f.layer}」不在四层 [${LOAD_CHAIN_LAYERS.join(', ')}] 内`,
      );
    }
    const owners = byKey.get(f.key) ?? [];
    owners.push(f.layer);
    byKey.set(f.key, owners);
  }
  for (const [key, owners] of byKey) {
    if (owners.length > 1) {
      throw new LoadChainOwnershipError(
        `加载链配置字段归属不唯一：「${key}」被 ${owners.length} 处声明，归属层 [${owners.join(', ')}]` +
        `——同一字段只能归一层（归属唯一），请二选一并解释归属理由`,
      );
    }
  }
}

/**
 * ② 未登记拒绝断言：加载链实现引用的字段必须已在 schema 登记。
 * 违规 ⇒ 抛 LoadChainUnregisteredFieldError，消息**具名**全部未登记字段。
 */
export function assertAllRegistered(
  referencedKeys: readonly string[],
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): void {
  const registered = new Set(fields.map((f) => f.key));
  const unregistered = [...new Set(referencedKeys)].filter((k) => !registered.has(k));
  if (unregistered.length > 0) {
    throw new LoadChainUnregisteredFieldError(
      `加载链实现引用了未登记配置字段：${unregistered.map((k) => `「${k}」`).join('、')}` +
      `——配置面无死角：实现引用的字段必须先在 loadchain-schema.ts 登记（归属层 + 类型 + 默认值）`,
    );
  }
}

/** 解析字段归属层；未登记 ⇒ 抛 LoadChainUnregisteredFieldError */
export function resolveOwner(
  key: string,
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): LoadChainLayer {
  const field = fields.find((f) => f.key === key);
  if (!field) {
    throw new LoadChainUnregisteredFieldError(
      `加载链配置字段「${key}」未登记——配置面无死角，实现引用的字段必须先在 schema 登记`,
    );
  }
  return field.layer;
}

/**
 * ③ 越界检测断言：向 `layer` 写入字段 `key` 时，`key` 必须归 `layer` 所有。
 * - 字段未登记 ⇒ LoadChainUnregisteredFieldError（具名字段）
 * - 字段归他层 ⇒ LoadChainBoundaryError（具名字段 + 实际归属层 + 越界写入层）
 */
export function assertLayerWrite(
  layer: LoadChainLayer,
  key: string,
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): void {
  const owner = resolveOwner(key, fields);
  if (owner !== layer) {
    throw new LoadChainBoundaryError(
      `越界写入：配置字段「${key}」归「${owner}」层所有，不得写入「${layer}」层` +
      `——配置值只能写本层字段（越界检测，对齐装配面陷阱机器化）`,
    );
  }
}

/**
 * 按层构建配置：对每个写入键做越界检测（③），返回该层的字段值视图。
 * 任一键越界/未登记 ⇒ 抛出对应错误（fail-closed，不静默丢弃）。
 */
export function buildLayerConfig(
  layer: LoadChainLayer,
  values: Readonly<Record<string, unknown>>,
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    assertLayerWrite(layer, key, fields);
    out[key] = values[key];
  }
  return out;
}

/** 字段默认值视图（缺省配置面，供消费侧兜底） */
export function loadChainDefaults(
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const f of fields) out[f.key] = f.default;
  return out;
}

/**
 * 从环境变量装载加载链配置（env 形字段：key 以 SOFAGENT_ 打头者）。
 * 按字段登记类型做标量转换；非 env 形字段不入结果（它们由调用方参数传入）。
 * 返回 key → { layer, value }（layer 由 schema 裁定，调用方可据此落痕）。
 */
export function loadChainConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): Record<string, { layer: LoadChainLayer; value: string | number | boolean }> {
  const out: Record<string, { layer: LoadChainLayer; value: string | number | boolean }> = {};
  for (const f of fields) {
    if (!f.key.startsWith('SOFAGENT_')) continue;
    const raw = env[f.key];
    if (raw === undefined || raw === '') continue;
    let value: string | number | boolean = raw;
    if (f.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue; // 非法数值按缺省处理（与实现侧「非法即 warn + 回落」一致）
      value = n;
    } else if (f.type === 'boolean') {
      value = raw === '1' || raw.toLowerCase() === 'true';
    }
    out[f.key] = { layer: f.layer, value };
  }
  return out;
}

/**
 * 生成期自检：schema 自身必须通过归属唯一 + 四层全覆盖。
 * 违规即抛（模块顶层调用——schema 不合法时 fail-closed，拒绝带着破损的配置面启动）。
 */
export function validateLoadChainSchema(
  fields: readonly LoadChainField[] = LOAD_CHAIN_CONFIG_FIELDS,
): void {
  assertUniqueOwnership(fields);
  const present = new Set(fields.map((f) => f.layer));
  const missing = LOAD_CHAIN_LAYERS.filter((l) => !present.has(l));
  if (missing.length > 0) {
    throw new LoadChainSchemaError(
      `加载链配置面缺层：${missing.map((l) => `「${l}」`).join('、')}未登记任何字段` +
      `——四层配置字段必须全部登记（schema SSOT 全覆盖）`,
    );
  }
}

// 模块加载即校验（生成期校验；schema 是 SSOT，破损必须显式失败而非静默生效）
validateLoadChainSchema();
