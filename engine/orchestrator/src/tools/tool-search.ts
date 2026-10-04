// ============================================================
// tools/tool-search.ts · v1.5.6 章二 · Tool search 按需加载
// ============================================================
// OpenAI Agents API 启发：工具定义不全量注入——按任务描述语义检索召回
// top-K + 按节点域过滤注入子集 + 执行中可分步追加加载。
//
// 与 v1.4.8 plugin-gate/ToolGate 的关系：ToolGate 管「能不能用」（权限面），
// 本章管「要不要装进上下文」（供给面）——两者正交，权限判定先于检索。
//
// 静态重叠检测联动：检索索引与 tool-registry 的 name 全局唯一测试守卫同口径——
// 先去重后检索、共用同一索引底座（见 docs/guides/loop-development.md）。
// ============================================================

import type { ExecutableTool } from '../tools';

/** 检索索引条目（工具注册表之上的倒排面） */
export interface ToolIndexEntry {
  name: string;
  description: string;
  /** 检索标签（名称分词 + 描述关键词；中文按 2-gram） */
  tokens: Set<string>;
  /** 原始工具引用（命中后直接取用） */
  tool: ExecutableTool;
}

/** 域过滤约束（节点绑定工具域，域外不进上下文） */
export interface DomainFilter {
  /** 允许的工具名集合（白名单语义；缺省 = 不限域） */
  allowNames?: Set<string>;
}

/** 检索请求 */
export interface SearchRequest {
  /** 任务描述（自然语言） */
  taskDescription: string;
  /** 召回上限 K */
  topK?: number;
  /** 节点域过滤 */
  domain?: DomainFilter;
  /** 手动指定工具名——非空时显式覆盖检索结果（检索让位并记录） */
  explicitTools?: string[];
}

/** 检索结果 */
export interface SearchResult {
  /** 召回的工具（按相关度降序；显式指定时 = 显式集合） */
  tools: ExecutableTool[];
  /** 命中名（度量/留痕用） */
  names: string[];
  /** 显式覆盖是否生效 */
  explicitOverride: boolean;
  /** 让位的检索命中（显式覆盖时记录偏离——「检索结果让位并记录」） */
  cededToExplicit: string[];
  /** 候选池大小（去重后；度量用） */
  poolSize: number;
}

// ── 中文 2-gram + 拉丁分词的统一 tokenizer ──
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const norm = text.toLowerCase();
  // 拉丁词
  for (const m of norm.matchAll(/[a-z_][a-z0-9_]{1,}/g)) out.push(m[0]);
  // 中文 2-gram（单字信息量低，2-gram 兼顾匹配率与区分度）
  const cjk = norm.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i + 1 < cjk.length; i++) out.push(cjk.slice(i, i + 2));
  return out;
}

/**
 * 构建检索索引（工具注册表 → 倒排面）。
 * 去重：同名工具只保留首个（与 tool-registry name 全局唯一守卫同口径——先去重后检索）。
 */
export function buildToolIndex(tools: ExecutableTool[]): ToolIndexEntry[] {
  const seen = new Set<string>();
  const index: ToolIndexEntry[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) continue; // 静态重叠检测联动：去重先行
    seen.add(tool.name);
    index.push({
      name: tool.name,
      description: tool.description,
      tokens: new Set([...tokenize(tool.name), ...tokenize(tool.description)]),
      tool,
    });
  }
  return index;
}

/**
 * 语义检索召回 top-K（词面重叠评分——BM25 简化形态：查询词在工具 token 集的命中数归一）。
 */
export function searchTools(
  index: ToolIndexEntry[],
  req: SearchRequest,
): SearchResult {
  const poolSize = index.length;

  // ① 显式指定优先——检索结果让位并记录（devlog 交付项：手动指定可显式覆盖检索结果）
  // 🔴 v1.5.5 阶段三 F13：显式工具同样过域白名单（显式 ∩ 域内）——此前本分支在
  //    域过滤前 return，显式指定域外工具可绕过节点域约束（域过滤对显式路径失明）。
  //    显式指定了域外工具 → 从结果剔除并计入 cededToExplicit 同款偏离记录
  //    （偏离可查——「显式让位域约束」与「检索让位显式」共用同一留痕面）。
  if (req.explicitTools && req.explicitTools.length > 0) {
    const wanted = new Set(req.explicitTools);
    const inDomain = req.domain?.allowNames
      ? index.filter((e) => wanted.has(e.name) && req.domain!.allowNames!.has(e.name))
      : index.filter((e) => wanted.has(e.name));
    const retrieved = scoreAll(index, req.taskDescription)
      .slice(0, req.topK ?? 5)
      .map((e) => e.name);
    // 显式指定的域外工具 = 偏离记录（含让位语义：被域约束剔除）
    const cededByDomain = req.domain?.allowNames
      ? [...wanted].filter((n) => !req.domain!.allowNames!.has(n))
      : [];
    return {
      tools: inDomain.map((e) => e.tool),
      names: inDomain.map((e) => e.name),
      explicitOverride: true,
      cededToExplicit: [...new Set([
        ...retrieved.filter((n) => !wanted.has(n)),
        ...cededByDomain,
      ])],
      poolSize,
    };
  }

  // ② 域过滤（域外工具不进上下文——硬约束，先于评分）
  const scoped = req.domain?.allowNames
    ? index.filter((e) => req.domain!.allowNames!.has(e.name))
    : index;

  // ③ top-K 评分召回
  const ranked = scoreAll(scoped, req.taskDescription).slice(0, req.topK ?? 5);
  return {
    tools: ranked.map((e) => e.tool),
    names: ranked.map((e) => e.name),
    explicitOverride: false,
    cededToExplicit: [],
    poolSize,
  };
}

/** 全量评分（相关度 = 查询 token 命中数 / sqrt(工具 token 数)——长描述降权防偏置） */
function scoreAll(index: ToolIndexEntry[], query: string): ToolIndexEntry[] {
  const qTokens = tokenize(query);
  const scored = index.map((entry) => {
    let hits = 0;
    for (const t of qTokens) if (entry.tokens.has(t)) hits++;
    return { entry, score: hits / Math.sqrt(entry.tokens.size || 1) };
  });
  scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
  // 零分命中不注入（查询与工具无关时宁缺勿滥）
  return scored.filter((s) => s.score > 0).map((s) => s.entry);
}

// ── 分步按需加载（运行中追加）──

/** 追加加载请求（模型第一步发现缺工具 → 检索加载 → 继续执行） */
export interface AppendRequest {
  /** 已注入的工具名（新召回需剔除重复） */
  alreadyLoaded: string[];
  /** 缺什么能力的自然语言描述 */
  needDescription: string;
  topK?: number;
}

/** 追加加载结果（空命中 = 无可追加，调用方据此告知模型） */
export function appendTools(
  index: ToolIndexEntry[],
  req: AppendRequest,
): { tools: ExecutableTool[]; names: string[] } {
  const have = new Set(req.alreadyLoaded);
  const ranked = scoreAll(
    index.filter((e) => !have.has(e.name)),
    req.needDescription,
  ).slice(0, req.topK ?? 3);
  return { tools: ranked.map((e) => e.tool), names: ranked.map((e) => e.name) };
}

// ── 度量（「按需加载是否值得」的实证数据）──

export interface InjectionMetrics {
  /** 本次按需注入数 */
  injected: number;
  /** 全量注入数（对比基线） */
  fullSet: number;
  /** 按需注入 token 估算（描述串） */
  onDemandTokens: number;
  /** 全量注入 token 估算 */
  fullTokens: number;
  /** 命中被实际调用的比率（事后回填——由执行器统计后 writeMetrics） */
  hitRate?: number;
}

/** 度量落盘（append-only JSONL——data/evolution/tool-search-metrics.jsonl） */
export function recordInjectionMetrics(
  dataDir: string,
  m: InjectionMetrics & { timestamp: string; task: string },
  sink?: (line: string) => void,
): void {
  const line = JSON.stringify(m);
  if (sink) {
    sink(line);
    return;
  }
  try {
    // 动态 import 防硬依赖（orchestrator 内 fs 可用，但保持本模块零副作用可测）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path');
    const dir = path.join(dataDir, 'evolution');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'tool-search-metrics.jsonl'), line + '\n');
  } catch (err) {
    process.stderr.write(
      `[sofagent] tool-search-metrics 落盘失败（不阻塞执行）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/** 工具集 token 估算（描述串拼接——与 estimateTokens 同口径的本地实现，避免循环依赖） */
export function estimateToolsTokens(tools: ExecutableTool[]): number {
  let t = 0;
  for (const tool of tools) {
    const cjk = (tool.description.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const words = (tool.description.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) ?? []).length;
    t += Math.ceil(cjk + words * 1.3);
  }
  return t;
}
