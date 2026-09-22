// ── API 分级契约（v1.5.1 四）────────────────────────────
// `/* @public */`：公开 API——semver 锁定，变更必须 bump 版本 + CHANGELOG 记录
//                 （外部依赖方与跨平台适配器只许 import 这一层）
// `/* @internal */`：内部 API——不承诺稳定性，破坏性变更无需 bump
// 未标记的导出视为 @public（保守默认：宁可多承诺不可漏承诺）
// ────────────────────────────────────────────────────────
/**
 * @sofagent/inject — 四层约束加载链
 * 生成 Sub Agent 启动时的 context prompt：SKILL.md → fde.md → think.md → knowledge/
 * v1.2.0 从 sofagent/audit/src/subagents/launcher.ts 迁出
 *
 * ⚠️ 职责分工（v1.3.8 P0-R11）：
 *   本文件是 **npm API 形态**的加载链实现（createReactAgent 构建 system prompt 时
 *   调用 buildConstrainedSystemPrompt）。
 *   OpenClaw 平台 hook 部署形态由 engine/hooks/sofagent-load-chain/src/handler.ts
 *   （.openclaw/hooks/sofagent-load-chain/handler.ts）负责——两份实现职责不同、
 *   服务不同部署形态，**不要合并**。改动加载链逻辑时需两处同步评估。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// v1.3.2 交付 14：L4 经验层渐进加载增强——知识索引构建（文件名 + frontmatter 摘要 + 首行）
import {
  buildKnowledgeIndex,
  formatKnowledgeIndex,
  topKnowledgeByMtime,
  INDEX_ENTRY_MAX_CHARS,
} from './knowledge-index';
// v1.4.9 P1-1：自动上下文压缩接线（compactIfNeeded 此前零生产调用点，见本文件末尾）
import { compactIfNeeded } from './load-chain/compactor';
import type { LoadChainBudget } from './load-chain/budget';

// ============================================================
// 辅助函数
// ============================================================

/**
 * 解析引擎 home 目录（`{SOFAGENT_HOME}`，缺省 `~/.sofagent`）。
 *
 * v1.4.9 P1-4：⚠️ harness 是零依赖纪律的核心包（dependency-direction.yml：
 * harness `allow: []`，全仓唯一不允许 import 任何 @sofagent 包者）——不能
 * import core 的 `resolveHomeDir`。此处是**最小本地重实现**。两侧口径**如实分述**（不假称一致）：
 *   · harness 侧（本函数）：`fromEnv !== undefined && fromEnv !== ''` ⇒ **非空优先**，空串拦下、回落
 *     `$HOME/.sofagent`；
 *   · core 侧（`core/data-paths.ts:166`）：`overrideHome ?? process.env.SOFAGENT_HOME ?? SOFAGENT_HOME`
 *     —— `??` 只拦 null · undefined，**空串原样返回** ⇒ 空串下 core 得 `''`，下游 `path.join('', 'data')`
 *     成相对路径。
 * 两处差异由 `tools/check/check-home-resolution-parity.mjs` 的 `DIFF_REGISTRY.empty` 登记（≥30 字 why）
 * ——**差异消失也判红**：统一必须是显式动作（配套架构裁定），而非某次重构的副产品。收敛方向（core 也
 * 拦空串回落 `$HOME/.sofagent`）列 v1.5.x：本版行为不动（`resolveHomeDir` 有 6 个消费方，改 SSOT 属行为
 * 变更，不在 bugfix 范围；空串属病态输入，收敛需独立设计 pass）。改本函数必须同步评估 core 侧——
 * 两处口径漂移正是 P1-4 的成因。
 */
function resolveEngineHome(): string {
  const fromEnv = process.env.SOFAGENT_HOME;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return path.join(os.homedir(), '.sofagent');
}

/** custom 层最多注入文件数（与 listCustomOverrides 缺省值一致） */
const CUSTOM_OVERRIDES_MAX_FILES = 4;

// ── 加载链预算 + 自动压缩接线（v1.4.9 P1-1）────────────────
/** env 解析告警去重（一次性 warn——不为每次 prompt 构建刷屏） */
const warnedEnvKeys = new Set<string>();

/** 同一消息只告警一次（stderr 可见，但不反复刷） */
function warnOnce(message: string): void {
  if (warnedEnvKeys.has(message)) return;
  warnedEnvKeys.add(message);
  console.warn(`[sofagent/harness] ${message}`);
}

/** 缺省加载链占比上限（与 budget.ts 的 maxRatio 缺省一致） */
const DEFAULT_BUDGET_RATIO = 0.03;

/** 占比合法域上界（>0 且 ≤ 0.2——超过 20% 就不是「约束链」而是「主体内容」了） */
const MAX_BUDGET_RATIO = 0.2;

/**
 * 从环境变量解析加载链 token 预算（v1.4.9 P1-1）。
 *
 * - `SOFAGENT_CONTEXT_WINDOW_TOKENS`：上下文窗口总 token（正整数）。**缺省/非法 ⇒
 *   不启用压缩**——checkBudget 对 `contextWindowTokens<=0` 恒返回 `over:false`，
 *   即零开销直通（休眠等价：未设 env 时 buildConstrainedSystemPrompt 与接线前逐字节相同）。
 * - `SOFAGENT_CONTEXT_BUDGET_RATIO`：加载链占比上限，合法域 `(0, 0.2]`，缺省 0.03。
 *
 * 非法值处置：**忽略并一次性 warn**（既不静默——用户会以为开了却没开；也不抛错——
 * 环境污染不该阻断 Agent 启动，本能力是注入体量优化，不是安全边界）。
 */
function resolveBudgetFromEnv(): LoadChainBudget | undefined {
  const rawWindow = process.env.SOFAGENT_CONTEXT_WINDOW_TOKENS;
  if (rawWindow === undefined || rawWindow === '') return undefined;
  const windowTokens = Number(rawWindow);
  if (!Number.isInteger(windowTokens) || windowTokens <= 0) {
    warnOnce(
      `SOFAGENT_CONTEXT_WINDOW_TOKENS="${rawWindow}" 非法（需正整数）——自动上下文压缩**不启用**`,
    );
    return undefined;
  }
  const rawRatio = process.env.SOFAGENT_CONTEXT_BUDGET_RATIO;
  let maxRatio = DEFAULT_BUDGET_RATIO;
  if (rawRatio !== undefined && rawRatio !== '') {
    const parsed = Number(rawRatio);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_BUDGET_RATIO) {
      maxRatio = parsed;
    } else {
      warnOnce(
        `SOFAGENT_CONTEXT_BUDGET_RATIO="${rawRatio}" 非法（合法域 (0, ${MAX_BUDGET_RATIO}]）——回落缺省 ${DEFAULT_BUDGET_RATIO}`,
      );
    }
  }
  return { contextWindowTokens: windowTokens, maxRatio };
}

/**
 * 尝试读取文件——文件不存在时返回 null（静默跳过）
 */
function tryRead(filePath: string): string | null {
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

/**
 * 扫描 custom/ 用户自定义层，读取全部 *-overrides.md（v1.2.1 新增）
 *
 * 只认 custom/README.md 命名表约定的 *-overrides.md 文件（其余文件名忽略），
 * 按文件名排序保证注入顺序稳定；每篇截取前 2000 字符。
 * 目录不存在/无匹配文件 → 空数组（静默跳过，与知识库行为一致）。
 *
 * @param dir custom/ 目录绝对路径
 * @param maxFiles 最多注入文件数（默认 4，防 prompt 膨胀）
 */
function listCustomOverrides(dir: string, maxFiles = 4): string[] {
  const results: string[] = [];
  try {
    if (!fs.existsSync(dir)) return results;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('-overrides.md'))
      .sort()
      .map(f => path.join(dir, f))
      .filter(f => {
        try { return fs.statSync(f).isFile(); } catch { return false; }
      });

    for (let i = 0; i < Math.min(files.length, maxFiles); i++) {
      const content = tryRead(files[i]!);
      if (content) {
        results.push(content.slice(0, 2000));
      }
    }
  } catch {
    // 目录不存在等异常静默跳过
  }
  return results;
}

// ============================================================
// 四层约束加载链
// ============================================================

/**
 * 构建带约束的 system prompt（四层加载链）
 *
 * 纯文件系统读取，不依赖任何 Agent 平台的 Skill 注入机制。
 * 总注入量控制在 ~4000 token 以内。
 *
 * 加载顺序：
 * 1. 宪法层：SKILL.md（4 底线 + 9 铁律）
 * 2. 规范层：fde.md（企业专属规则）
 * 3. 反思层：think.md（历史踩坑）
 * 3.5 用户层：custom/*-overrides.md（v1.2.1 新增——追加在官方规则之后，不是替换）
 *     v1.4.9 P1-4：项目级 `<projectRoot>/<skillDir>/custom/` 优先，用户级
 *     `{SOFAGENT_HOME}/skill/custom/`（/evolve 产物落点）按余量补足
 * 4. 知识库：knowledge/ top-N（按 mtime 排序，每篇截取前 2000 字符）
 * 5. v1.0.8: persona.md（Agent 记忆，前 500 字符）
 * 6. v1.4.9 P1-1: 自动上下文压缩（env 门控，缺省关闭）——设
 *    `SOFAGENT_CONTEXT_WINDOW_TOKENS` 才启用；超预算时保留红线/铁律段、
 *    截断长非保留段并加 COMPACT_START/END_MARKER
 *
 * @param projectRoot 项目根目录
 * @param opts.skillDir 约束文件子目录名（默认 ".sofagent"），相对于 projectRoot
 * @param opts.tenantId 租户标识（v1.4.7 G7——注入「身份上下文」段，Agent 可感知归属；缺省不注入）。
 *        口径说明：参数已备；生产调用方（openclaw-plugins/cordis 两端注入器）传入随插件
 *        升级接线，当前未传 = 注入未生效（v0 地基语义——字段在位、消费面待接）。
 * @returns 拼接后的 system prompt 字符串
 */
/* @public */ export function buildConstrainedSystemPrompt(
  projectRoot: string,
  opts?: { skillDir?: string; tenantId?: string },
): string {
  const skillDir = path.join(projectRoot, opts?.skillDir ?? '.sofagent');
  const parts: string[] = [];
  const MAX_PARTS = 20;

  // 0. 身份上下文（v1.4.7 G7）：租户归属声明——先于约束层注入，
  //    Agent 从第一条 prompt 起知道自己在哪个租户边界内行动。
  if (opts?.tenantId) {
    parts.push(`# 身份上下文（tenant）\n当前租户：${opts.tenantId}\n行为边界与数据归属以该租户为限——跨租户数据不可见。`);
  }

  // 1. 宪法层：SKILL.md
  const skillContent = tryRead(path.join(skillDir, 'SKILL.md'));
  if (skillContent) parts.push(`# 宪法约束\n${skillContent}`);

  // 2. 规范层：fde.md
  const fdeContent = tryRead(path.join(skillDir, 'fde.md'));
  if (fdeContent) parts.push(`# 企业规则\n${fdeContent}`);

  // 3. 反思层：think.md
  const thinkContent = tryRead(path.join(skillDir, 'think.md'));
  if (thinkContent) parts.push(`# 历史经验\n${thinkContent}`);

  // 3.5 用户自定义层：custom/*-overrides.md（v1.2.1 新增）
  // 加载顺序：约束层（宪法/规范/反思）→ 用户层（custom/ 私有规则）。
  // 后加载 = 优先级更高——custom/ 规则追加在官方规则之后，不是替换。
  //
  // v1.4.9 P1-4（写入根 vs 读取根不一致）：读侧此前**只**扫
  // <projectRoot>/<skillDir>/custom/，而写侧（orchestrator/instinct/evolver.ts:76）
  // 把 /evolve 产物落在 {SOFAGENT_HOME}/skill/custom/ ⇒ evolve 产物落盘后
  // **永远读不到**（evolver.ts 头注「该目录在加载链覆盖范围内」是不变量假设，
  // 没有运行时兜底——本处补上兜底，写侧落点不动：那是 SSOT，改它要动外部数据布局）。
  // 口径：**项目级优先、用户级补足**——项目级条目在前（后加载 ⇒ 优先级更高），
  // 用户级按 maxFiles 余量补足；两级解析到同一目录时跳过用户级（防重复注入）。
  const projectCustomDir = path.join(skillDir, 'custom');
  const userCustomDir = path.join(resolveEngineHome(), 'skill', 'custom');
  const projectRules = listCustomOverrides(projectCustomDir, CUSTOM_OVERRIDES_MAX_FILES);
  const userRules =
    projectRules.length < CUSTOM_OVERRIDES_MAX_FILES && userCustomDir !== projectCustomDir
      ? listCustomOverrides(userCustomDir, CUSTOM_OVERRIDES_MAX_FILES - projectRules.length)
      : [];
  for (const rule of [...projectRules, ...userRules]) {
    parts.push(`# 用户自定义规则（custom/）\n${rule}`);
  }

  // 4. 知识库：knowledge/（v1.3.1 交付 14：渐进加载增强——「热点全文 + 索引」）
  //    热点 2 篇：全文注入（mtime 最新，保持现有注入语义）；
  //    索引 9 条：只注入文件名 + frontmatter 摘要 + 首行（每条 ≤150 字符），
  //    需要完整内容时用 read_file 按文件名拉全文。
  const knowledgeDir = path.join(skillDir, 'knowledge');
  const knowledgeParts: string[] = [];

  // 4a. 热点 2 篇全文（跨 shared/federation/local 按 mtime 最新）
  const hotEntries = topKnowledgeByMtime(knowledgeDir, 2);
  for (const entry of hotEntries) {
    const filePath = path.join(
      entry.kind === 'shared'
        ? path.join(knowledgeDir, 'shared')
        : entry.kind === 'federation'
          ? path.join(knowledgeDir, 'federation')
          : knowledgeDir,
      `${entry.fileName}.md`,
    );
    let content = tryRead(filePath) ?? '';
    content = content.slice(0, 2000); // 每篇截取前 2000 字符（保持现有行为）
    if (!content) continue;
    // 联邦来源强制 <untrusted> 包裹（prompt 注入防线层 1，与 trust 分级联动）
    knowledgeParts.push(
      entry.kind === 'federation'
        ? `<untrusted source="federation">\n${content}\n</untrusted>`
        : content,
    );
  }

  // 4b. 知识索引（shared 3 + federation 3 + local 3 = 9 条摘要）
  const indexEntries = buildKnowledgeIndex(knowledgeDir);
  const indexText = formatKnowledgeIndex(indexEntries, 9);

  // 4c. 组装知识库段——热点全文在前，索引在后（总注入量从 ~4000 降到 ~1500 token）。
  //     无任何知识内容时整个知识库段不注入（保持「无约束目录返回空串」契约）。
  const hasKnowledgeContent = knowledgeParts.length > 0 || indexText.length > 0;
  if (hasKnowledgeContent) {
    const knowledgeSection = [
      '# 知识库（L4 经验层）',
      '## 当前任务热点（全文注入，top-2 by mtime）',
      ...knowledgeParts,
      '## 知识索引（按需读取）',
      indexText
        ? `${indexText}\n\n需要完整内容时用 read_file 读取 knowledge/ 下对应文件。`
        : '（暂无知识索引）',
    ].filter((p) => p.length > 0);
    for (const part of knowledgeSection) {
      if (parts.length < MAX_PARTS) {
        parts.push(part);
      }
    }
  }

  // 5. v1.0.8: persona.md（Agent 记忆，前 500 字符）
  try {
    const personaPath = path.join(skillDir, 'persona.md');
    if (fs.existsSync(personaPath)) {
      const personaContent = fs.readFileSync(personaPath, 'utf-8').slice(0, 500);
      if (personaContent) {
        parts.push(`# 用户画像 (persona)\n${personaContent}`);
      }
    }
  } catch {
    // persona 注入失败不影响主流程
  }

  // 6. 自动上下文压缩（v1.4.9 P1-1：compactIfNeeded 此前零生产调用点）
  //    env 门控、**缺省关闭**——未设 SOFAGENT_CONTEXT_WINDOW_TOKENS 时
  //    checkBudget 恒 over:false，输出与接线前**逐字节一致**（休眠等价锁见测试）。
  //    不传 onCompact：harness 零依赖纪律（本文件不 import @sofagent 包），
  //    压缩事件落审计的出口留给调用方——审计留痕**尚未接线**（回调出口在位，
  //    排期 v1.5.x；口径见 docs/LIMITATIONS.md「自动上下文压缩」节）。
  const joined = parts.join('\n\n---\n\n');
  return compactIfNeeded(joined, resolveBudgetFromEnv()).content;
}

// ============================================================
// v1.4.8 第四章：加载链预算 + 自动压缩（npm API 形态）
// ⚠️ OpenClaw hook 形态（engine/hooks/sofagent-load-chain）本版不消费
// compactor（out of scope 裁定——双实现同步纪律，见开发日志第四章）。
// ============================================================
/* @public */ export { checkBudget, estimateTokens } from './load-chain/budget';
/* @public */ export type { LoadChainBudget, BudgetVerdict } from './load-chain/budget';
/* @public */ export { compactIfNeeded, COMPACT_START_MARKER, COMPACT_END_MARKER } from './load-chain/compactor';
/* @public */ export type { CompactResult, OnCompactCallback } from './load-chain/compactor';
