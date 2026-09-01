// ============================================================
// memory-store.ts · 事实级记忆存储（v1.4.3 功能①）
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
//   1. 事实以 Markdown 单文件存储——审计引擎可逐文件审查
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
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { getDataDir } from './data-paths';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

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
}

/** memory.json 索引结构 */
interface MemoryIndex {
  /** key → factId 映射 */
  [key: string]: string;
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

/** 某条事实的 Markdown 文件路径 */
function getFactPath(memoryRoot: string, userId: string, factId: string): string {
  return join(getBucketDir(memoryRoot, userId), `${factId}.md`);
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

/**
 * 将 MemoryFact 序列化为 Markdown 单文件内容。
 * 用 YAML frontmatter 存元数据，正文存 value。
 */
function factToMarkdown(fact: MemoryFact): string {
  const tags = fact.tags.length > 0 ? `[${fact.tags.join(', ')}]` : '[]';
  return [
    '---',
    `id: ${fact.id}`,
    `key: "${fact.key}"`,
    `source: "${fact.source}"`,
    `confidence: ${fact.confidence}`,
    `createdAt: ${fact.createdAt}`,
    `updatedAt: ${fact.updatedAt}`,
    `tags: ${tags}`,
    '---',
    '',
    fact.value,
    '',
  ].join('\n');
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
  };
}

// ────────────────────────────────────────────────────────────
// 公共 API
// ────────────────────────────────────────────────────────────

/**
 * 创建 MemoryStore 实例。
 *
 * @param dataBase 数据根目录（可选；默认 SOFAGENT_DATA → ~/.sofagent/data）
 */
export function createMemoryStore(dataBase?: string): {
  set: (fact: Omit<MemoryFact, 'id' | 'createdAt' | 'updatedAt'>) => string;
  get: (key: string) => MemoryFact | null;
  list: (prefix?: string) => MemoryFact[];
  delete: (key: string) => boolean;
  search: (query: string) => MemoryFact[];
} {
  const memoryRoot = getMemoryRoot(dataBase);

  return {
    /**
     * 写入或更新一条事实。
     * key 已存在时更新值，否则新建。
     * @returns 事实 ID
     */
    set(fact: Omit<MemoryFact, 'id' | 'createdAt' | 'updatedAt'>): string {
      mkdirSync(memoryRoot, { recursive: true, mode: 0o700 });
      const index = readIndex(memoryRoot);
      const now = new Date().toISOString();

      // 已存在则更新
      let factId = index[fact.key];
      let createdAt = now;
      if (factId) {
        // 读取旧事实的 createdAt
        const { bucket } = extractBucket(fact.key);
        const oldPath = getFactPath(memoryRoot, bucket, factId);
        if (existsSync(oldPath)) {
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
      };

      const { bucket } = extractBucket(fact.key);
      const bucketDir = getBucketDir(memoryRoot, bucket);
      mkdirSync(bucketDir, { recursive: true, mode: 0o700 });

      // 写 Markdown 单文件
      writeFileSync(getFactPath(memoryRoot, bucket, factId), factToMarkdown(full), 'utf-8');

      // 更新索引
      index[fact.key] = factId;
      writeIndex(memoryRoot, index);

      return factId;
    },

    /**
     * 按 key 读取一条事实。
     * @returns MemoryFact 或 null（不存在时）
     */
    get(key: string): MemoryFact | null {
      const index = readIndex(memoryRoot);
      const factId = index[key];
      if (!factId) return null;

      const { bucket } = extractBucket(key);
      const factPath = getFactPath(memoryRoot, bucket, factId);
      if (!existsSync(factPath)) return null;

      return markdownToFact(readFileSync(factPath, 'utf-8'), factId);
    },

    /**
     * 列出所有事实（可按 key 前缀过滤）。
     * @param prefix key 前缀（如 "用户偏好" 匹配 "用户偏好.xxx"）
     */
    list(prefix?: string): MemoryFact[] {
      const index = readIndex(memoryRoot);
      const keys = Object.keys(index).filter((k) => !prefix || k.startsWith(prefix));
      const results: MemoryFact[] = [];
      for (const key of keys) {
        const fact = this.get(key);
        if (fact) results.push(fact);
      }
      return results;
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
      const factPath = getFactPath(memoryRoot, bucket, factId);
      if (existsSync(factPath)) {
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
     * @param query 搜索关键词
     */
    search(query: string): MemoryFact[] {
      const all = this.list();
      const lowerQuery = query.toLowerCase();
      return all.filter((f) => {
        return (
          f.value.toLowerCase().includes(lowerQuery) ||
          f.key.toLowerCase().includes(lowerQuery) ||
          f.tags.some((t) => t.toLowerCase().includes(lowerQuery))
        );
      });
    },
  };
}
