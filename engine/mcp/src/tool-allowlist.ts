// ============================================================
// tool-allowlist.ts · MCP 工具面显式 allow-list + 默认拒绝（v1.9 §五 · A37）
// ------------------------------------------------------------
// 背景（A37 七条，出处 VERSIONS §8.3）：外部 spec 87 个 operation 只暴露 9 个
// tool，理由是「全量暴露会严重劣化工具选择」；我方 104 个 tool 默认全量暴露。
// 本模块只立**机制**（显式 allow-list + 默认拒绝 + 启动期对账），不追求把
// 104 压到 10 以内——收窄幅度按真实调用分布再调。
//
// 七条对应关系：
//   ① 每项写「何时该用它」        → `whenToUse` 字段（不是「它是什么」）
//   ② 握手主动声明先后顺序        → `buildInstructions()` 按声明序输出
//   ③ 启动期对账（不存在即失败）  → `assertAllowList()`（缺项抛错，不静默跳过）
//   ④ 登记暴露数 / 可用数比值     → `exposureLedger()`
//   ⑤ 禁服务级 token              → `assertNoServiceToken()`（权限取自账户）
//   ⑥ 默认拒绝                    → `isAllowed()`（不在名单即拒，新工具默认不进面）
//   ⑦ 删掉会让人误判就绪的接口    → `MISLEADING_READINESS_TOOLS`（枚举为空 + 判据见下）
// ============================================================

/** allow-list 项（顺序即握手声明顺序） */
export interface AllowListEntry {
  /** 工具名（须与 tool-registry 的 TOOLS[].name 逐字一致） */
  name: string;
  /** 何时该用它——写**触发场景**，不写功能描述 */
  whenToUse: string;
}

/**
 * 缺省 allow-list（判定与审计主路径的十个入口）。
 * 排序纪律：先「查证」后「落痕」再「计量」——模型先看清事实，再动手，最后记账。
 */
export const DEFAULT_MCP_ALLOWLIST: readonly AllowListEntry[] = [
  { name: 'health_check', whenToUse: '装完、升级后或行为异常时，先用它确认环境本身没坏，再怀疑别的' },
  { name: 'search_knowledge', whenToUse: '要引既有知识/经验回答、而不是凭记忆下结论时' },
  { name: 'list_entities', whenToUse: '不确定库里有哪些实体、需要先看目录再决定取哪个时' },
  { name: 'read_entity', whenToUse: '已知实体 id、要取其明细与关系时' },
  { name: 'audit_file', whenToUse: '只想核单个文件是否合规、不需要全仓证据链时' },
  { name: 'run_audit', whenToUse: '改完代码/配置要留一条可回溯的证据链时' },
  { name: 'evaluate_output', whenToUse: '拿到一段产出、要判断它是否达标再决定交付时' },
  { name: 'data_sovereignty_report', whenToUse: '客户要自己复算「数据没出内网」时' },
  { name: 'cost_query', whenToUse: '要报成本或核对计量口径时' },
  { name: 'get_think', whenToUse: '要复用上次的推理中间态、避免重复推导时' },
];

/**
 * ⑦ 会让人误判就绪的接口——**当前为零**。
 *
 * 判定口径：工具描述里出现「就绪 / ready / 健康 / 可用」，但实现**不做实际探测**，
 * 只回固定值或缓存值 ⇒ 属「声称就绪」。据此逐条核 104 个工具：
 *   - `health_check`（tool-registry.ts:506）：实跑环境/配置/数据目录/Hook/依赖检查
 *   - `train_serve`（:1337）：`/health` 实探测 + 指数退避重试
 * 两者都是**探测**不是**声称**，其余 102 个工具不涉及就绪语义 ⇒ 无可删项。
 * 本常量保留为**可枚举空集**：将来若新增「声称就绪」的工具，必须登记在此并
 * 由 `assertNoMisleadingTools()` 挡在 allow-list 之外（先登记再落实现）。
 */
export const MISLEADING_READINESS_TOOLS: readonly string[] = [];

/** 允许名单（解析结果——`source` 便于审计「名单从哪来」） */
export interface ResolvedAllowList {
  entries: readonly AllowListEntry[];
  /** default = 内置清单；env = SOFAGENT_MCP_ALLOWLIST 显式给出 */
  source: 'default' | 'env';
}

/**
 * 解析 allow-list。
 * `SOFAGENT_MCP_ALLOWLIST` 语义：未设或 `0`/空 ⇒ **不启用**（保持既有全量暴露）；
 * `1`/`default` ⇒ 用内置清单；逗号分隔工具名 ⇒ 用显式清单（whenToUse 取内置文案，
 * 未登记文案的工具名视为「新接口」——允许但需在下方 `whenToUse` 表补文案，否则拒）。
 */
export function resolveAllowList(env: NodeJS.ProcessEnv = process.env): ResolvedAllowList | null {
  const raw = (env.SOFAGENT_MCP_ALLOWLIST ?? '').trim();
  if (raw === '' || raw === '0') return null;
  if (raw === '1' || raw === 'default') return { entries: DEFAULT_MCP_ALLOWLIST, source: 'default' };
  const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const entries = names.map((name) => {
    const known = DEFAULT_MCP_ALLOWLIST.find((e) => e.name === name);
    if (!known) {
      throw new Error(`allow-list 项 ${name} 未登记「何时该用它」——新接口进面须先补文案（A37 ①）`);
    }
    return known;
  });
  return { entries, source: 'env' };
}

/**
 * ③ 启动期对账：allow-list 项必须存在于当前工具面。
 * 缺项 ⇒ 抛错（**启动失败**，不静默跳过——静默跳过会让名单常年漂移）。
 */
export function assertAllowList(availableNames: readonly string[], list: readonly AllowListEntry[] = DEFAULT_MCP_ALLOWLIST): void {
  const missing = list.filter((e) => !availableNames.includes(e.name)).map((e) => e.name);
  if (missing.length > 0) {
    throw new Error(`allow-list 对账失败：${missing.join(', ')} 在当前工具面不存在——启动失败（A37 ③）`);
  }
}

/** ⑦ 断言：误导就绪的工具不得进 allow-list（第二参可注入，供单测证明守卫本身有效） */
export function assertNoMisleadingTools(
  list: readonly AllowListEntry[] = DEFAULT_MCP_ALLOWLIST,
  misleading: readonly string[] = MISLEADING_READINESS_TOOLS,
): void {
  const hits = list.filter((e) => misleading.includes(e.name)).map((e) => e.name);
  if (hits.length > 0) {
    throw new Error(`allow-list 含会误判就绪的接口：${hits.join(', ')}——须先删/改（A37 ⑦）`);
  }
}

/** ④ 暴露比台账（如 `104 / 10`） */
export function exposureLedger(availableCount: number, list: readonly AllowListEntry[] = DEFAULT_MCP_ALLOWLIST): string {
  return `暴露 ${list.length} / 可用 ${availableCount}`;
}

/** ⑥ 默认拒绝：不在名单即拒 */
export function isAllowed(name: string, list: readonly AllowListEntry[] = DEFAULT_MCP_ALLOWLIST): boolean {
  return list.some((e) => e.name === name);
}

/**
 * ② 握手 instructions：按 ① 的声明顺序输出「何时该用它」。
 * 顺序与 allow-list 声明序**逐位一致**（同一数组，不另排序）。
 */
export function buildInstructions(list: readonly AllowListEntry[] = DEFAULT_MCP_ALLOWLIST): string {
  const lines = list.map((e, i) => `${i + 1}. ${e.name} —— 何时该用它：${e.whenToUse}`);
  return ['本会话可用工具按以下顺序调用（先查证，再动手，最后记账）：', ...lines].join('\n');
}

/**
 * ⑤ 禁服务级 token：长期服务凭证不得出现在工具进程环境里。
 * 权限取自**账户**（谁在调用），不取自**服务令牌**（一个进程万能钥匙）。
 * 命中即抛错——发现即拒绝启动，避免「带着万能钥匙上线」。
 */
export const FORBIDDEN_SERVICE_TOKEN_KEYS: readonly string[] = [
  'SOFAGENT_SERVICE_TOKEN',
  'SOFAGENT_SERVICE_KEY',
  'SOFAGENT_MCP_SERVICE_TOKEN',
  'MCP_SERVICE_TOKEN',
  'MCP_SERVICE_KEY',
];

export function assertNoServiceToken(env: NodeJS.ProcessEnv = process.env): void {
  const hit = FORBIDDEN_SERVICE_TOKEN_KEYS.filter((k) => (env[k] ?? '').trim() !== '');
  if (hit.length > 0) {
    throw new Error(`环境含服务级长期凭证（${hit.join(', ')}）——权限须取自账户，不取自服务级 token（A37 ⑤）`);
  }
}
