// ============================================================
// memory-store.ts · 事实级记忆存储（v1.5.7 功能①）
//
// per-user memory.json 全量索引 + per-fact Markdown 单文件
// 存储布局：
//   data/memory/
//   ├── memory.json          # 全量索引（key → fact ID 映射）
//   ├── __default__/
//   │   └── <fact-id>.md     # 单条事实 Markdown（git diff 友好）
//   └── <user-id>/
//       └── <fact-id>.md
//
// 设计原则：
//   1. 事实以 Markdown 单文件存储——审计模块可逐文件审查
//   2. memory.json 仅作索引（key→id 映射），不含事实正文
//   3. 与 compress-memory.ts 同级——都是基础设施，不是 ontology 专有逻辑
// ============================================================

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from 'fs';
import { dirname, join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { getDataDir } from './data-paths';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/**
 * F5（v1.5.7）：memory 目录文件数黄警阈值——全仓唯一份共享导出。
 * 消费方：doctor 数据目录健康度节（黄警判）+ daemon 巡检 memory 归档步骤
 * （超阈值触发 archive()）。依据（v1.5.6 章二）：实测 17178 个事实文件已达
 * 文件系统性能退化区间，10000 为提前预警线。机械纪律：engine 生产源码不得
 * 出现第二份 10000 字面量的同语义阈值（测试面豁免）。
 */
export const MEMORY_DIR_FILE_WARN = 10000;

/** 单条记忆事实 */
export interface MemoryFact {
  /** UUID */
  id: string;
  /** 事实键（如 "用户偏好.前端框架"） */
  key: string;
  /** 事实值 */
  value: string;
  /** 来源（session ID / agent name） */
  source: string;
  /** 置信度 0-1 */
  confidence: number;
  /** ISO 8601 创建时间 */
  createdAt: string;
  /** ISO 8601 更新时间 */
  updatedAt: string;
  /** 分类标签 */
  tags: string[];
  /**
   * 作用域（v1.5.6 章二 · 沉淀记忆项目作用域）：形如 `project:<8位hash>` 或 `global`。
   * 旧事实（本项落地前写入）无该字段 → 读侧一律视为可见（等价 global），零回归。
   */
  scope?: string;
}

/** memory.json 索引结构 */
interface MemoryIndex {
  /** key → factId 映射 */
  [key: string]: string;
}

/** archive-index.json 索引结构（v1.5.6 章二：归档事实的显式检索面） */
interface ArchiveIndex {
  [key: string]: { factId: string; archivedAt: string };
}

// ────────────────────────────────────────────────────────────
// 路径解析
// ────────────────────────────────────────────────────────────

/**
 * 解析 memory 存储根目录。
 * 优先 SOFAGENT_DATA → DATA_DIR → ~/.sofagent/data/
 * v1.4.2 G-05: 默认回退收编进 data-paths SSOT getDataDir()（消灭 HOME 硬编码）
 */
function getMemoryRoot(dataBase?: string): string {
  const base = getDataDir(dataBase);
  return join(base, 'memory');
}

/** 某个桶（user）的目录路径 */
function getBucketDir(memoryRoot: string, userId: string): string {
  return join(memoryRoot, userId);
}

/** 某条事实的 Markdown 文件路径（v1.5.6 章二：桶内二级分层——按 factId 前 2 字符分片） */
function getFactPath(memoryRoot: string, userId: string, factId: string): string {
  return join(getBucketDir(memoryRoot, userId), factId.slice(0, 2), `${factId}.md`);
}

/** 旧版扁平路径（二级分层前的布局）——读侧兼容用 */
function getLegacyFactPath(memoryRoot: string, userId: string, factId: string): string {
  return join(getBucketDir(memoryRoot, userId), `${factId}.md`);
}

/** 归档区路径（不参与常规检索） */
function getArchiveFactPath(memoryRoot: string, userId: string, factId: string): string {
  return join(getBucketDir(memoryRoot, userId), 'archive', factId.slice(0, 2), `${factId}.md`);
}

/**
 * 读侧路径解析（三态兼容）：二级分层新路径 → 旧扁平路径 → 归档区。
 * 保证二级分层落地前写入的既有事实**零回归可读**。
 */
function resolveFactPath(memoryRoot: string, userId: string, factId: string): string | null {
  const candidates = [
    getFactPath(memoryRoot, userId, factId),
    getLegacyFactPath(memoryRoot, userId, factId),
    getArchiveFactPath(memoryRoot, userId, factId),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

/** 归档索引文件路径（key → { factId, archivedAt }） */
function getArchiveIndexPath(memoryRoot: string): string {
  return join(memoryRoot, 'archive-index.json');
}

/** memory.json 索引文件路径 */
function getIndexPath(memoryRoot: string): string {
  return join(memoryRoot, 'memory.json');
}

// ────────────────────────────────────────────────────────────
// 持久化
// ────────────────────────────────────────────────────────────

/**
 * 从 key 提取桶（user）名。
 * 约定 key 格式：`<bucket>.<path>`，如 `用户偏好.前端框架` → bucket = `用户偏好`。
 * 无点号的 key 归入 `__default__` 桶。
 */
function extractBucket(key: string): { bucket: string; rest: string } {
  const dotIdx = key.indexOf('.');
  if (dotIdx === -1) return { bucket: '__default__', rest: key };
  return { bucket: key.slice(0, dotIdx), rest: key.slice(dotIdx + 1) };
}

/** 读取索引文件（不存在时返回空对象） */
function readIndex(memoryRoot: string): MemoryIndex {
  const indexPath = getIndexPath(memoryRoot);
  if (!existsSync(indexPath)) return {};
  try {
    return JSON.parse(readFileSync(indexPath, 'utf-8')) as MemoryIndex;
  } catch {
    return {};
  }
}

/** 写入索引文件 */
function writeIndex(memoryRoot: string, index: MemoryIndex): void {
  mkdirSync(memoryRoot, { recursive: true, mode: 0o700 });
  writeFileSync(getIndexPath(memoryRoot), JSON.stringify(index, null, 2) + '\n', 'utf-8');
}

/** 读取归档索引（不存在时返回空对象） */
function readArchiveIndex(memoryRoot: string): ArchiveIndex {
  const p = getArchiveIndexPath(memoryRoot);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ArchiveIndex;
  } catch {
    return {};
  }
}

/** 写入归档索引 */
function writeArchiveIndex(memoryRoot: string, index: ArchiveIndex): void {
  mkdirSync(memoryRoot, { recursive: true, mode: 0o700 });
  writeFileSync(getArchiveIndexPath(memoryRoot), JSON.stringify(index, null, 2) + '\n', 'utf-8');
}

/**
 * 将 MemoryFact 序列化为 Markdown 单文件内容。
 * 用 YAML frontmatter 存元数据，正文存 value。
 */
function factToMarkdown(fact: MemoryFact): string {
  const tags = fact.tags.length > 0 ? `[${fact.tags.join(', ')}]` : '[]';
  const lines = [
    '---',
    `id: ${fact.id}`,
    `key: "${fact.key}"`,
    `source: "${fact.source}"`,
    `confidence: ${fact.confidence}`,
    `createdAt: ${fact.createdAt}`,
    `updatedAt: ${fact.updatedAt}`,
    `tags: ${tags}`,
  ];
  // v1.5.6 章二：作用域落盘（缺省不写——旧事实无该字段，读侧按可见处理）
  if (fact.scope !== undefined) lines.push(`scope: ${fact.scope}`);
  lines.push('---', '', fact.value, '');
  return lines.join('\n');
}

/**
 * 从 Markdown 文件内容解析出 MemoryFact。
 * 解析失败返回 null。
 */
function markdownToFact(content: string, expectedId?: string): MemoryFact | null {
  const parts = content.split('---');
  if (parts.length < 3) return null;
  const fm = parts[1] ?? '';
  const body = parts.slice(2).join('---').trim();

  const extract = (key: string): string => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    return (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  };

  const extractArray = (key: string): string[] => {
    const raw = extract(key);
    // 格式 [tag1, tag2] → 拆分
    const inner = raw.replace(/^\[|\]$/g, '').trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  };

  const id = extract('id') || expectedId || '';
  if (!id) return null;

  return {
    id,
    key: extract('key'),
    value: body,
    source: extract('source'),
    confidence: parseFloat(extract('confidence')) || 0,
    createdAt: extract('createdAt'),
    updatedAt: extract('updatedAt'),
    tags: extractArray('tags'),
    // v1.5.6 章二：作用域（缺省 → undefined → 读侧按可见处理，零回归）
    ...(extract('scope') ? { scope: extract('scope') } : {}),
  };
}

// ────────────────────────────────────────────────────────────
// 公共 API
// ────────────────────────────────────────────────────────────

/**
 * 记忆检索作用域选项（v1.5.6 章二）。
 * - 缺省 / `allScopes: false`：只见「当前 scope + global」两条（**不泄漏其它项目**）；
 * - `allScopes: true`：跨项目查询（显式逃生舱）。
 */
interface MemoryQueryOptions {
  allScopes?: boolean;
}

/** 跨项目导出包（{@link MemoryStore.exportFacts} 返回） */
interface MemoryFactExportBundle {
  version: 1;
  /** 导出时刻（ISO 8601） */
  exportedAt: string;
  /** 来源作用域（导出方 store 的 scope） */
  sourceScope: string;
  /** 来源仓标识（导出方 resolveMemoryScope() 原值） */
  sourceRepo: string;
  /** 导出的可见事实 */
  facts: MemoryFact[];
}

/** 跨项目导入选项（{@link MemoryStore.importFacts}） */
interface MemoryImportOptions {
  /** 审批门——**必须显式为 true** 才导入（fail-closed，未批准直接抛错） */
  approve: boolean;
  /** 目标作用域（缺省 = 当前 store 的 scope） */
  targetScope?: string;
}

/** MemoryStore 实例面（createMemoryStore 返回） */
interface MemoryStore {
  set(fact: Omit<MemoryFact, 'id' | 'createdAt' | 'updatedAt'>): string;
  get(key: string, opts?: MemoryQueryOptions): MemoryFact | null;
  list(prefix?: string, opts?: MemoryQueryOptions): MemoryFact[];
  delete(key: string): boolean;
  search(query: string, opts?: MemoryQueryOptions): MemoryFact[];
  archive(options?: { days?: number; now?: Date }): number;
  listArchived(prefix?: string, opts?: MemoryQueryOptions): MemoryFact[];
  /** v1.5.6 章二：索引级统计（**零文件读取**——面板/doctor 用，避免 O(N) 遍历事实文件） */
  stats(): { facts: number; archived: number };
  /** 显式导出（跨项目唯一通道之一）：只导出当前 scope 可见的 keys */
  exportFacts(keys: string[]): MemoryFactExportBundle;
  /** 显式导入（跨项目唯一通道之二）：须 approve=true（审批门） */
  importFacts(
    bundle: MemoryFactExportBundle,
    options: MemoryImportOptions,
  ): { imported: number; rejected: number };
}

/**
 * 解析当前记忆作用域（v1.5.6 章二 · 沉淀记忆项目作用域）。
 *
 * 规则：git 仓内 → `project:<repoRoot 的 sha256 前 8 位 hex>`；非 git 目录 /
 * git 不可用 / 任何异常 → `'global'`（异常兜底也回 global，**绝不抛**）。
 *
 * @param cwd 工作目录（默认 process.cwd()）
 * @returns `project:<8位hex>` 或 `global`
 */
export function resolveMemoryScope(cwd?: string): string {
  try {
    const workDir = cwd ?? process.cwd();
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!repoRoot) return 'global';
    return `project:${createHash('sha256').update(repoRoot).digest('hex').slice(0, 8)}`;
  } catch {
    // 非 git 目录 / git 不可用 / 超时——统一回 global（本函数不可抛）
    return 'global';
  }
}

/**
 * 创建 MemoryStore 实例。
 *
 * v1.5.6 章二：引入项目作用域（scope）——默认 scope = resolveMemoryScope()。
 * get/list/search/listArchived 默认只见「当前 scope + global」两条，显式传
 * `{ allScopes: true }` 可跨项目查；无 scope 字段的旧事实一律视为可见（零回归）。
 *
 * @param dataBase 数据根目录（可选；默认 SOFAGENT_DATA → ~/.sofagent/data）
 * @param options.scope 作用域覆盖（默认 resolveMemoryScope()；测试隔离用）
 */
export function createMemoryStore(
  dataBase?: string,
  options: { scope?: string } = {},
): MemoryStore {
  const memoryRoot = getMemoryRoot(dataBase);
  const scope = options.scope ?? resolveMemoryScope();

  /** 按 key 读取一条事实（**不做作用域过滤**——过滤在 visibleFact） */
  const readFact = (key: string): MemoryFact | null => {
    const index = readIndex(memoryRoot);
    const factId = index[key];
    if (!factId) return null;

    const { bucket } = extractBucket(key);
    const factPath = resolveFactPath(memoryRoot, bucket, factId);
    if (!factPath) return null;

    return markdownToFact(readFileSync(factPath, 'utf-8'), factId);
  };

  /**
   * 写入或更新一条事实（打上给定 scope）。
   * set 用当前 scope；importFacts 用目标 scope。
   * @returns 事实 ID
   */
  const putFact = (
    fact: Omit<MemoryFact, 'id' | 'createdAt' | 'updatedAt'>,
    scopeValue: string,
  ): string => {
    mkdirSync(memoryRoot, { recursive: true, mode: 0o700 });
    const index = readIndex(memoryRoot);
    const now = new Date().toISOString();

    // 已存在则更新
    let factId = index[fact.key];
    let createdAt = now;
    if (factId) {
      // 读取旧事实的 createdAt
      const { bucket } = extractBucket(fact.key);
      const oldPath = resolveFactPath(memoryRoot, bucket, factId);
      if (oldPath) {
        const old = markdownToFact(readFileSync(oldPath, 'utf-8'), factId);
        if (old) createdAt = old.createdAt;
      }
    } else {
      factId = randomUUID();
    }

    const full: MemoryFact = {
      ...fact,
      id: factId,
      createdAt,
      updatedAt: now,
      // v1.5.6 章二：写入时打上作用域
      scope: scopeValue,
    };

    const { bucket } = extractBucket(fact.key);
    const factPath = getFactPath(memoryRoot, bucket, factId);
    mkdirSync(dirname(factPath), { recursive: true, mode: 0o700 });

    // 写 Markdown 单文件
    writeFileSync(factPath, factToMarkdown(full), 'utf-8');

    // 更新索引
    index[fact.key] = factId;
    writeIndex(memoryRoot, index);

    return factId;
  };

  /** 列出事实（按 key 前缀过滤，**不做作用域过滤**） */
  const listRaw = (prefix?: string): MemoryFact[] => {
    const index = readIndex(memoryRoot);
    const keys = Object.keys(index).filter((k) => !prefix || k.startsWith(prefix));
    const results: MemoryFact[] = [];
    for (const key of keys) {
      const fact = readFact(key);
      if (fact) results.push(fact);
    }
    return results;
  };

  /**
   * 作用域可见性过滤：默认只见「当前 scope + global」；无 scope 字段的旧事实一律可见
   * （等价 global，保证作用域落地前的既有数据零回归）。allScopes=true 时不设限。
   */
  const visibleFact = (fact: MemoryFact | null, opts?: MemoryQueryOptions): MemoryFact | null => {
    if (!fact) return null;
    if (opts?.allScopes === true) return fact;
    if (fact.scope === undefined || fact.scope === null) return fact;
    if (fact.scope === scope || fact.scope === 'global') return fact;
    return null;
  };

  return {
    /** 写入或更新一条事实（当前 scope）。@returns 事实 ID */
    set(fact: Omit<MemoryFact, 'id' | 'createdAt' | 'updatedAt'>): string {
      return putFact(fact, scope);
    },


    /** 按 key 读取一条事实（默认只见「当前 scope + global」）。@returns MemoryFact 或 null */
    get(key: string, opts?: MemoryQueryOptions): MemoryFact | null {
      return visibleFact(readFact(key), opts);
    },

    /**
     * 列出所有事实（可按 key 前缀过滤；默认只见「当前 scope + global」）。
     * @param prefix key 前缀（如 "用户偏好" 匹配 "用户偏好.xxx"）
     * @param opts { allScopes: true } 可跨项目查
     */
    list(prefix?: string, opts?: MemoryQueryOptions): MemoryFact[] {
      return listRaw(prefix).filter((f) => visibleFact(f, opts) !== null);
    },

    /**
     * 按 key 删除一条事实。
     * @returns true=删除成功，false=不存在
     */
    delete(key: string): boolean {
      const index = readIndex(memoryRoot);
      const factId = index[key];
      if (!factId) return false;

      const { bucket } = extractBucket(key);
      const factPath = resolveFactPath(memoryRoot, bucket, factId);
      if (factPath) {
        try {
          unlinkSync(factPath);
        } catch {
          // 文件已被删除，继续清理索引
        }
      }

      delete index[key];
      writeIndex(memoryRoot, index);
      return true;
    },

    /**
     * 搜索事实（全文模糊匹配 value + tags + key）。
     * 归档事实不参与（归档不进常规检索）。默认只见「当前 scope + global」。
     * @param query 搜索关键词
     * @param opts { allScopes: true } 可跨项目查
     */
    search(query: string, opts?: MemoryQueryOptions): MemoryFact[] {
      const all = listRaw().filter((f) => visibleFact(f, opts) !== null);
      const lowerQuery = query.toLowerCase();
      return all.filter((f) => {
        return (
          f.value.toLowerCase().includes(lowerQuery) ||
          f.key.toLowerCase().includes(lowerQuery) ||
          f.tags.some((t) => t.toLowerCase().includes(lowerQuery))
        );
      });
    },

    /**
     * v1.5.6 章二 · 归档轮转：把 `days` 天未更新的事实移入归档区。
     * - 归档事实**移出主索引**（不进常规 list / search），文件移入 `<bucket>/archive/<prefix>/`；
     * - 归档索引 `archive-index.json` 记录 key → { factId, archivedAt }，供 `listArchived` 显式查；
     * - 幂等可重跑；返回迁移条数。
     */
    archive(options: { days?: number; now?: Date } = {}): number {
      const days = options.days ?? 30;
      const cutoff = (options.now ?? new Date()).getTime() - days * 24 * 60 * 60 * 1000;
      const index = readIndex(memoryRoot);
      const archiveIndex = readArchiveIndex(memoryRoot);
      let moved = 0;
      for (const key of Object.keys(index)) {
        const factId = index[key];
        if (!factId) continue;
        const { bucket } = extractBucket(key);
        const src = resolveFactPath(memoryRoot, bucket, factId);
        if (!src) continue;
        let fact: MemoryFact | null = null;
        try {
          fact = markdownToFact(readFileSync(src, 'utf-8'), factId);
        } catch {
          continue;
        }
        if (!fact) continue;
        if (new Date(fact.updatedAt).getTime() > cutoff) continue; // 热数据不动
        const dest = getArchiveFactPath(memoryRoot, bucket, factId);
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        try {
          renameSync(src, dest);
        } catch {
          continue;
        }
        archiveIndex[key] = { factId, archivedAt: new Date().toISOString() };
        delete index[key];
        moved++;
      }
      if (moved > 0) {
        writeIndex(memoryRoot, index);
        writeArchiveIndex(memoryRoot, archiveIndex);
      }
      return moved;
    },

    /**
     * v1.5.6 章二 · 显式查归档（生产入口：`sofagent core doctor --archive`，
     * 由 doctor.ts 数据目录健康度节消费；常规 list/search 不见归档）。
     * 默认只见「当前 scope + global」；{ allScopes: true } 可跨项目查。
     */
    listArchived(prefix?: string, opts?: MemoryQueryOptions): MemoryFact[] {
      const archiveIndex = readArchiveIndex(memoryRoot);
      const results: MemoryFact[] = [];
      for (const key of Object.keys(archiveIndex)) {
        if (prefix && !key.startsWith(prefix)) continue;
        const entry = archiveIndex[key];
        if (!entry) continue;
        const factId = entry.factId;
        const { bucket } = extractBucket(key);
        const p = getArchiveFactPath(memoryRoot, bucket, factId);
        if (!existsSync(p)) continue;
        try {
          const f = markdownToFact(readFileSync(p, 'utf-8'), factId);
          if (f && visibleFact(f, opts) !== null) results.push(f);
        } catch {
          // 为何可静默：归档区单条坏文件跳过——listArchived 是显式查询面，单条损坏不应中断整表返回
        }
      }
      return results;
    },

    /**
     * v1.5.6 章二：索引级统计——只读 memory.json + archive-index.json 两个索引文件，
     * **不遍历任何事实文件**（doctor 等只读面板专用；list() 会逐条读文件，大库下 O(N) 不可用）。
     */
    stats(): { facts: number; archived: number } {
      return {
        facts: Object.keys(readIndex(memoryRoot)).length,
        archived: Object.keys(readArchiveIndex(memoryRoot)).length,
      };
    },

    /**
     * 显式导出当前 scope 可见的 keys（跨项目唯一通道之一）。
     * sourceScope = 本 store scope；sourceRepo = resolveMemoryScope() 原值。
     */
    exportFacts(keys: string[]): MemoryFactExportBundle {
      const facts: MemoryFact[] = [];
      for (const key of keys) {
        // 只导出当前 scope 可见（等价 get 默认口径）——不泄漏其它项目
        const f = visibleFact(readFact(key), undefined);
        if (f) facts.push(f);
      }
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        sourceScope: scope,
        sourceRepo: resolveMemoryScope(),
        facts,
      };
    },

    /**
     * 显式导入（跨项目唯一通道之二）。
     * 审批门：`approve !== true` 直接抛错（fail-closed，不得静默导入）；
     * 通过后写入目标 scope（默认当前 scope），血缘记入 tags（必须可查）。
     */
    importFacts(
      bundle: MemoryFactExportBundle,
      importOptions: MemoryImportOptions,
    ): { imported: number; rejected: number } {
      if (importOptions.approve !== true) {
        throw new Error(
          'importFacts: 未批准导入（approve !== true）——跨项目导入须显式审批（fail-closed）',
        );
      }
      const targetScope = importOptions.targetScope ?? scope;
      let imported = 0;
      let rejected = 0;
      for (const fact of bundle.facts ?? []) {
        if (!fact || typeof fact.key !== 'string' || fact.key === '') {
          rejected += 1;
          continue;
        }
        // 血缘留痕（必须可查）：来源 scope / 来源仓 / 导出时刻
        const lineage = [
          `imported-from:${bundle.sourceScope}`,
          `imported-repo:${bundle.sourceRepo}`,
          `imported-at:${bundle.exportedAt}`,
        ];
        putFact(
          {
            key: fact.key,
            value: fact.value,
            source: fact.source,
            confidence: fact.confidence,
            tags: [...(fact.tags ?? []), ...lineage],
          },
          targetScope,
        );
        imported += 1;
      }
      return { imported, rejected };
    },
  };
}
