// ============================================================
// instinct/evolver.ts · /evolve 聚合器（v1.3.6 交付 3）
// ============================================================
//
// 相关 instinct 聚合成正式 skill，写入**运行时 skill 目录**：
//   {SOFAGENT_HOME}/skill/custom/<name>/SKILL.md
//   {SOFAGENT_HOME}/skill/custom/<name>/plugin.mjs   ← DSH 插件形态预留
//
// 🔴 铁律（dev-prompt 交付 3 + 发布检查清单）：
//   1. 禁止写仓库的 SKILL/ 目录——那是 npm/ClawHub 发布源，
//      Agent 自动写入 = 每次 evolve 污染发行版。本文件所有路径
//      均从 resolveHomeDir()（SOFAGENT_HOME，默认 ~/.sofagent）出发，
//      物理上不可能触达仓库 SKILL/。
//   2. 写入运行时目录 ~/.sofagent/skill/custom/——该目录在加载链覆盖范围内
//      （harness listCustomOverrides 认 custom/ 下的 *-overrides.md；
//      本模块同时落一份 <name>-overrides.md 供加载链接力，SKILL.md 供人类/进化链审读）。
//   3. DSH 插件形态预留（交付 6 关联项）：同时落 plugin.mjs——
//      export default { apply(ctx) } 包装，v1.3.6 后端接入后可直接挂载。
//      本版只落输出格式与目录约定，不做真实加载验证。
//
// 聚合策略：按 pattern 文本的浅层语义分组（共享 ≥1 个 2-gram 关键词），
// 组内 instinct 数 ≥ minGroupSize 才成 skill——单条弱模式不配成为 skill。
// ============================================================

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveHomeDir } from '@sofagent/core';
import type { ScoredInstinct } from './scorer';
import { DEFAULT_CONFIDENCE_THRESHOLD, scoreInstincts } from './scorer';
import type { InstinctItem } from './extractor';

/** evolve 选项 */
export interface EvolveOptions {
  /**
   * 运行时 skill 根目录（缺省 {SOFAGENT_HOME}/skill/custom）。
   * 测试隔离必传——指向 tmpdir。
   */
  skillDir?: string;
  /** 聚合置信度门槛（缺省 0.7——只有达标 instinct 参与聚合） */
  threshold?: number;
  /** 成组最少 instinct 条数（缺省 2） */
  minGroupSize?: number;
  /** skill 命名前缀（缺省 evolved） */
  prefix?: string;
  /** 生成时间（测试注入） */
  now?: Date;
}

/** 单个聚合产物 */
export interface EvolvedSkill {
  /** skill 目录名（前缀-序号-关键词） */
  name: string;
  /** SKILL.md 绝对路径 */
  skillMdPath: string;
  /** plugin.mjs（DSH 预留）绝对路径 */
  pluginPath: string;
  /** overrides 文件（加载链接力）绝对路径 */
  overridesPath: string;
  /** 聚合的 instinct 数 */
  instinctCount: number;
}

/** evolve 结果 */
export interface EvolveResult {
  /** 聚合出的 skill 列表 */
  skills: EvolvedSkill[];
  /** 达标但未成组的散-instinct（置信度降序，留给下轮） */
  leftover: ScoredInstinct[];
  /** 写入根目录 */
  skillDir: string;
}

/** 运行时 custom skill 目录解析（测试可覆盖） */
export function resolveCustomSkillDir(override?: string): string {
  if (override) return override;
  return join(resolveHomeDir(), 'skill', 'custom');
}

// ────────────────────────────────────────────────────────────
// 浅层语义分组
// ────────────────────────────────────────────────────────────

/** 提取中文 2-gram + 英文单词的关键词集合 */
function keywordsOf(text: string): Set<string> {
  const keys = new Set<string>();
  // 英文/数字词
  for (const word of text.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []) {
    keys.add(word.toLowerCase());
  }
  // 中文 2-gram
  const cjk = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i + 1 < cjk.length; i++) {
    keys.add(cjk.slice(i, i + 2));
  }
  return keys;
}

/**
 * 相关性判定：共享 ≥1 个关键词（2-gram 级浅层语义——不调 LLM）。
 */
function isRelated(a: string, b: string): boolean {
  const ka = keywordsOf(a);
  for (const k of keywordsOf(b)) {
    if (ka.has(k)) return true;
  }
  return false;
}

/**
 * 贪心成组——置信度降序扫描，每条 instinct 归入首个相关组，
 * 无相关组则开新组。
 */
function groupInstincts(items: ScoredInstinct[]): ScoredInstinct[][] {
  const sorted = [...items].sort((a, b) => b.confidence - a.confidence);
  const groups: ScoredInstinct[][] = [];
  for (const item of sorted) {
    let placed = false;
    for (const group of groups) {
      if (group.some((g) => isRelated(g.pattern, item.pattern))) {
        group.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([item]);
  }
  return groups;
}

/** 从组内 instinct 提取 skill 名关键词（最高频 2-gram 或英文词） */
function groupName(group: ScoredInstinct[], prefix: string, index: number): string {
  const freq = new Map<string, number>();
  for (const item of group) {
    for (const k of keywordsOf(item.pattern)) {
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  }
  let best = '';
  let bestCount = 0;
  for (const [k, c] of freq) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  const safe = best.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '') || 'pattern';
  return `${prefix}-${String(index).padStart(2, '0')}-${safe}`;
}

// ────────────────────────────────────────────────────────────
// 产物渲染
// ────────────────────────────────────────────────────────────

/** 渲染 SKILL.md（进化链审读 + 人类可读的正式 skill 文档） */
function renderSkillMd(name: string, group: ScoredInstinct[], now: Date): string {
  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');
  lines.push('> 由 sofagent /evolve 自动聚合生成——来源：think.md + decision-log + 审计 PASS/FAIL 模式。');
  lines.push(`> 生成时间：${now.toISOString()}`);
  lines.push('');
  lines.push('## 习得的判断模式');
  lines.push('');
  for (const s of group) {
    const pct = Math.round(s.confidence * 100);
    lines.push(`- **${s.pattern}**（置信度 ${pct}% · 出现 ${s.occurrences} 次 · 通过率 ${Math.round(s.passRate * 100)}% · 来源 ${s.source}）`);
  }
  lines.push('');
  lines.push('## 行为指引');
  lines.push('');
  lines.push('以下模式已在历史审计中反复验证，执行相关任务时优先遵循：');
  lines.push('');
  for (const s of group) {
    lines.push(`1. ${s.pattern}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** 渲染 plugin.mjs（DSH 插件形态预留——apply(ctx) 包装） */
function renderPluginMjs(name: string, group: ScoredInstinct[], now: Date): string {
  const patterns = group.map((s) => ({
    pattern: s.pattern,
    confidence: Math.round(s.confidence * 100) / 100,
    occurrences: s.occurrences,
    source: s.source,
  }));
  return [
    '// DSH 插件形态预留（v1.3.5 交付 3 · dev-prompt 交付 6 关联项）',
    `// 由 sofagent /evolve 生成：${name} · ${now.toISOString()}`,
    '// v1.3.6 后端接入后，DSH 宿主可通过 ctx.tools.register 挂载本模式集；',
    '// 本版仅约定输出格式与目录约定，不做真实加载验证。',
    `const PATTERNS = ${JSON.stringify(patterns, null, 2)};`,
    '',
    'export default {',
    '  name: ' + JSON.stringify(name) + ',',
    '  patterns: PATTERNS,',
    '  /**',
    '   * DSH 插件挂载入口（预留）——ctx.tools.register 注册只读模式查询 tool。',
    '   * @param {object} ctx DSH 宿主上下文（ctx.tools.register / ctx.log）',
    '   */',
    '  async apply(ctx) {',
    '    await ctx.tools.register({',
    `      name: ${JSON.stringify(name)} + ':patterns',`,
    "      description: 'evolved instinct patterns (read-only)',",
    '      handler: async () => PATTERNS,',
    '    });',
    '    ctx.log?.(`[evolve] ${' + JSON.stringify(name) + '} registered with ${PATTERNS.length} patterns`);',
    '  },',
    '};',
    '',
  ].join('\n');
}

/** 渲染 *-overrides.md（harness 加载链接力——listCustomOverrides 认这个命名） */
function renderOverridesMd(name: string, group: ScoredInstinct[], now: Date): string {
  const lines: string[] = [];
  lines.push(`<!-- evolved skill: ${name} · ${now.toISOString()} -->`);
  lines.push('');
  lines.push(`# 用户自定义规则（custom/）· ${name}`);
  lines.push('');
  lines.push('以下判断模式经历史审计反复验证（instinct 置信度达标后自动聚合）：');
  lines.push('');
  for (const s of group) {
    lines.push(`- ${s.pattern}（${Math.round(s.confidence * 100)}%）`);
  }
  lines.push('');
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
// 主入口
// ────────────────────────────────────────────────────────────

/**
 * /evolve——把相关 instinct 聚合成 skill 写入运行时目录。
 *
 * @param instincts 提取出的 instinct 列表（extractor 产物）
 * @param options evolve 选项
 * @returns 聚合结果（写入的 skill 路径 + 散-instinct）
 */
export function evolveInstincts(
  instincts: InstinctItem[],
  options: EvolveOptions = {},
): EvolveResult {
  const threshold = options.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const minGroupSize = options.minGroupSize ?? 2;
  const prefix = options.prefix ?? 'evolved';
  const now = options.now ?? new Date();
  const skillDir = resolveCustomSkillDir(options.skillDir);

  // 1. 只让达标 instinct 参与聚合
  const qualified = scoreInstincts(instincts).filter((s) => s.confidence >= threshold);

  // 2. 成组
  const groups = groupInstincts(qualified);
  const validGroups = groups.filter((g) => g.length >= minGroupSize);
  const leftover = groups.filter((g) => g.length < minGroupSize).flat();

  // 3. 落盘
  const skills: EvolvedSkill[] = [];
  if (validGroups.length > 0) {
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }
  }
  validGroups.forEach((group, i) => {
    const name = groupName(group, prefix, i + 1);
    const dir = join(skillDir, name);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const skillMdPath = join(dir, 'SKILL.md');
    const pluginPath = join(dir, 'plugin.mjs');
    writeFileSync(skillMdPath, renderSkillMd(name, group, now), 'utf-8');
    writeFileSync(pluginPath, renderPluginMjs(name, group, now), 'utf-8');
    // overrides 落在 custom/ 根（harness listCustomOverrides 扫 custom/ 下 *-overrides.md）
    const overridesPath = join(skillDir, `${name}-overrides.md`);
    writeFileSync(overridesPath, renderOverridesMd(name, group, now), 'utf-8');
    skills.push({ name, skillMdPath, pluginPath, overridesPath, instinctCount: group.length });
  });

  return { skills, leftover, skillDir };
}
