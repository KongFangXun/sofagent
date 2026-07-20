// ============================================================
// memory-contract.ts · think.md 记忆契约（Ledger-Views-Policy 模型）
// v1.1.7: 将 think.md 的不变量从"文档约定"提升为代码级单一事实来源
// v1.1.7 新增: knowledge entry 的 sensitivity 分级契约（safe-by-default）
// ============================================================
//
// sofagent 记忆三层模型（Ledger-Views-Policy）中，think.md 的契约定义。
//
// ── 不变量（INVARIANTS，代码层强制）──
// 1. think.md 是 **Ledger（原始数据层）**，不是 Views（派生层）。
// 2. think.md 是 **append-only（只追加）**：所有反思写入方只能追加新条目，
//    绝不允许整体覆写 / 截断 / 就地改写历史条目。
// 3. **多写入方（multi-writer）是设计原意**，允许的写入方：
//    - 审计引擎：git diff → 自动反思（generateThinkEntry）
//    - 主 Agent：按模板手动写（write_think 工具）
//    - FDE / loop 陪跑期：人工或陪跑 Agent 写入
// 4. **派生方向严格单向**：think.md（Ledger）→ knowledge/（Views）。
//    knowledge/ 是唯一派生层；任何代码都不得把 knowledge/ 的内容反向写回 think.md。
// 5. 读取方（readers）：编排引擎、daemon（Dream Cycle / lessons-extract）、
//    harness 加载链、人类。读取方只消费，不修改。
//
// 说明：compress-memory 的归档 / 压缩是**授权的生命周期运维操作**
// （迁移旧条目到 think.archive.md），与上面的"反思写入"是两回事，
// 不破坏 append-only 语义——它管理的是 Ledger 的留存，而非改写反思内容。

import { appendFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** think.md 文件名（固定，不得更改） */
export const THINK_MD_FILENAME = 'think.md';

/** 记忆三层枚举 */
export type MemoryLayer = 'ledger' | 'views' | 'policy';

/** think.md 在三层模型中的归属：Ledger（原始数据）。 */
export const THINK_MD_LAYER: MemoryLayer = 'ledger';

/** knowledge/ 在三层模型中的归属：Views（派生层）。 */
export const KNOWLEDGE_DIR_LAYER: MemoryLayer = 'views';

/**
 * 解析 think.md 的绝对路径。
 * 单一事实来源（single source of truth）——所有读写 think.md 的代码都应经此函数，
 * 不得各自硬编码 `path.join(dir, 'think.md')`。
 *
 * @param dataBase 数据目录（默认 SOFAGENT_DATA 环境变量，再退化为 ~/.sofagent）
 */
export function getThinkPath(dataBase?: string): string {
  const base = dataBase || process.env.SOFAGENT_DATA || join(homedir(), '.sofagent');
  return join(base, THINK_MD_FILENAME);
}

/**
 * 向 think.md **追加**一条反思条目（契约强制的只追加写入点）。
 *
 * 所有反思写入方（审计引擎自动反思、主 Agent 手动 write_think、FDE 陪跑）
 * 都应经此函数写入，从代码层面保证 append-only 不变量：
 * 内部使用 appendFileSync，永不 writeFileSync / truncate / 就地改写。
 *
 * @param thinkPath 由 getThinkPath() 解析出的路径
 * @param entry     完整条目文本（调用方负责格式：## 时间戳 标题 + 内容）
 * @returns 追加后的文件字节数（用于上层校验写入是否生效）
 */
export function appendThinkEntry(thinkPath: string, entry: string): number {
  // 防御：绝不调用 writeFileSync / truncate，只追加
  appendFileSync(thinkPath, entry, 'utf-8');
  return statSync(thinkPath).size;
}

// ────────────────────────────────────────────────────────────
// sensitivity 分级契约（v1.1.6 新增）
//
// knowledge entry（entity/concept/comparison/summary）的 frontmatter
// 可声明 `sensitivity: public | internal | restricted`，为后续联邦查询
// 的安全过滤铺路。缺省语义（已定）：缺省/非法值一律按 internal
// （safe-by-default；restricted 绝不默认）。
// ────────────────────────────────────────────────────────────

/** sensitivity 分级（敏感度全序：public ≤ internal ≤ restricted） */
export type Sensitivity = 'public' | 'internal' | 'restricted';

/** sensitivity 缺省级别（safe-by-default，restricted 绝不默认） */
export const DEFAULT_SENSITIVITY: Sensitivity = 'internal';

/** 敏感度全序权重（用于可见性判定） */
const SENSITIVITY_ORDER: Record<Sensitivity, number> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

/**
 * 从 frontmatter 解析 sensitivity，缺省/非法值 → internal。
 *
 * 只识别精确三个枚举值；其他任何值（大小写异常、拼写错误、注入串）
 * 一律回落 DEFAULT_SENSITIVITY（safe-by-default）。
 *
 * @param frontmatter 页面的 frontmatter 键值对（已解析）
 * @returns 解析后的 sensitivity（必为合法枚举值）
 */
export function resolveSensitivity(
  frontmatter: Record<string, unknown> | null | undefined,
): Sensitivity {
  if (!frontmatter) return DEFAULT_SENSITIVITY;
  const raw = frontmatter['sensitivity'];
  if (typeof raw !== 'string') return DEFAULT_SENSITIVITY;
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === 'public' ||
    normalized === 'internal' ||
    normalized === 'restricted'
  ) {
    return normalized;
  }
  return DEFAULT_SENSITIVITY;
}

/**
 * 判定给定 sensitivity 对 viewer 是否可见。
 *
 * 全序：public ≤ internal ≤ restricted。viewer 只能看到 ≤ 自身级别的条目；
 * restricted 对非 restricted viewer 不可见（联邦查询不泄露）。
 *
 * @param entrySensitivity 条目敏感度
 * @param viewer viewer 级别（默认 internal）
 * @returns true = 可见；false = 不可见（过滤掉）
 */
export function isSensitivityVisible(
  entrySensitivity: Sensitivity,
  viewer: Sensitivity = DEFAULT_SENSITIVITY,
): boolean {
  return SENSITIVITY_ORDER[entrySensitivity] <= SENSITIVITY_ORDER[viewer];
}
