// db-source.ts · v1.4.3 章一 · DB / API 数据源适配（只读拉取 → 中间格式）
//
// 定位：文件接入之外的第二入口——企业客户的数据常在企业系统里
// （ERP / 数据库 / REST API），不只文件。本文件把 PostgreSQL / MySQL
// / REST API 三类数据源只读拉取后归一到 data-ingest 的 IngestRecord
// 中间格式，与 CSV/Excel 接入同一套下游（dataset-builder）。
//
// 只读纪律：连接串 → 拉取 → 断开，零写入零 DDL（本组件永远不落库）。
// SQL 白名单：只允许 SELECT（大小写不敏感前缀校验）——防写入语句混入。
//
// 商业平台接口预留（G5，2026-08-17 拍板）：本版只做「接入」——企业系统
// 数据经本组件进训练；MCP 连接器注册/发现（connector_list + 第三方连接器
// 注册）挂商业平台 SaaS 再补（devlog §一 G5 注记）。
//
// 依赖注入：查询执行器（QueryFn / FetchFn）全部可注入——单测零真实
// DB 连接、零真实网络（对齐 train-env.ts 的 ExecFn 模式）。
// 默认实现：pg / mysql2 惰性动态 import（未安装时结构化降级提示，
// 不作为硬依赖）；REST 走 node:fetch。

import { normalizeValue, type IngestRecord, type CellValue } from './data-ingest';

// ══════════════════════════════════════
// 依赖注入接口（测试零真实 DB / 零真实网络）
// ══════════════════════════════════════

/** 数据库查询结果（列名 + 行数组——pg/mysql2 统一归一形态） */
export interface DbQueryResult {
  columns: string[];
  /** 行 = 列名 → 值的映射（驱动原始值，经 normalizeValue 归一） */
  rows: Array<Record<string, unknown>>;
}

/**
 * 可注入的数据库查询函数——DB 接入的唯一 IO 出口。
 * (sql, params) → { columns, rows }。默认实现按连接串前缀路由 pg / mysql2。
 */
export type QueryFn = (sql: string, params?: unknown[]) => Promise<DbQueryResult>;

/** REST 拉取结果 */
export interface ApiFetchResult {
  status: number;
  /** 响应体（JSON 已解析则对象数组；否则原文文本） */
  body: unknown;
}

/** 可注入的 HTTP 拉取函数——API 接入的唯一 IO 出口。默认 node:fetch。 */
export type FetchFn = (url: string, init?: { headers?: Record<string, string> }) => Promise<ApiFetchResult>;

// ══════════════════════════════════════
// SQL 只读守卫（纯函数）
// ══════════════════════════════════════

/** 允许的 SQL 起始关键词（只读拉取——写入语句一律拒绝） */
const READONLY_SQL_PREFIXES = ['select', 'with'] as const;

/**
 * SQL 只读校验：去注释/空白后必须以 SELECT 或 WITH 开头（CTE 也是只读）。
 * 含分号多语句 / 写入关键词（INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE）
 * 出现在首语句起始位 → 拒绝。
 */
export function isReadonlySql(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
  if (stripped === '') return false;
  const first = stripped.split(/\s+/)[0]?.toLowerCase() ?? '';
  return (READONLY_SQL_PREFIXES as readonly string[]).includes(first);
}

/** 推断结果集列名（首行键序；空结果 → 空数组） */
export function inferColumns(rows: Array<Record<string, unknown>>): string[] {
  const first = rows[0];
  return first ? Object.keys(first) : [];
}

// ══════════════════════════════════════
// 默认查询实现（pg / mysql2 惰性动态 import——可选依赖）
// ══════════════════════════════════════

/** 连接串类型判定（前缀路由——PGScheme / MySQLScheme / 无驱动支持） */
export type DbFlavor = 'postgres' | 'mysql';

/** 从连接串解析 DB 类型（postgres:// / mysql:// 前缀） */
export function parseDbFlavor(connectionString: string): DbFlavor | null {
  if (/^postgres(ql)?:\/\//i.test(connectionString)) return 'postgres';
  if (/^mysql(2)?:\/\//i.test(connectionString)) return 'mysql';
  return null;
}

/**
 * 默认 QueryFn：pg / mysql2 动态 import（未安装 → 结构化错误提示安装，
 * 不作为 orchestrator 硬依赖——训练机上按需装）。
 * 归一：pg 的 rows: {列:值}[] / mysql2 的 rows 同形态，columns 取首行键序。
 */
export function makeDefaultQueryFn(connectionString: string): QueryFn {
  const flavor = parseDbFlavor(connectionString);
  if (flavor === null) {
    return async () => {
      throw new Error(
        `[db-source] 不支持的连接串（仅 postgres:// 或 mysql:// 前缀）：${connectionString.slice(0, 24)}…`,
      );
    };
  }
  return async (sql: string, params: unknown[] = []): Promise<DbQueryResult> => {
    if (flavor === 'postgres') {
      let pg: unknown;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        pg = require('pg');
      } catch {
        throw new Error('[db-source] PostgreSQL 驱动未安装——训练机上执行 npm i pg 后重试');
      }
      const ClientCtor = (pg as { Client: new (config: string) => { connect(): Promise<void>; query(q: string, p: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>; end(): Promise<void> } }).Client;
      const client = new ClientCtor(connectionString);
      await client.connect();
      try {
        const res = await client.query(sql, params);
        const rows = res.rows ?? [];
        return { columns: inferColumns(rows), rows };
      } finally {
        await client.end();
      }
    }
    let mysql: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mysql = require('mysql2');
    } catch {
      throw new Error('[db-source] MySQL 驱动未安装——训练机上执行 npm i mysql2 后重试');
    }
    const createPool = (mysql as { createPool: (url: string) => { query(q: string, p: unknown[]): Promise<[Array<Record<string, unknown>>]>; end(): Promise<void> } }).createPool;
    const pool = createPool(connectionString);
    try {
      const [rows] = await pool.query(sql, params);
      const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
      return { columns: inferColumns(list), rows: list };
    } finally {
      await pool.end();
    }
  };
}

// ══════════════════════════════════════
// DB 拉取 → 中间格式
// ══════════════════════════════════════

/** DB 拉取结果（记录 + 列名 + 溯源） */
export interface DbIngestResult {
  records: IngestRecord[];
  rowCount: number;
  columns: string[];
  source: string;
}

/** DB 拉取入参 */
export interface PullFromDbInput {
  /** 连接串（postgres:// / mysql://——凭据在串内，绝不落盘不打日志） */
  connectionString: string;
  /** SELECT 语句（只读校验不过 → 结构化拒绝） */
  sql: string;
  /** 绑定参数（占位符防注入） */
  params?: unknown[];
  /** 可注入查询函数（缺省 makeDefaultQueryFn(connectionString)） */
  queryFn?: QueryFn;
}

/**
 * 从 DB 只读拉取 → 中间格式记录。
 *
 * 只读纪律双层：① isReadonlySql 白名单 ② 驱动连接串用只读业务账号是
 * 部署侧责任（代码侧提示写入 defaultQueryFn 文档）。行值经 normalizeValue
 * 归一（Date/Buffer → 字符串/JSON——中间格式只承载 string|number|bool|null）。
 */
export async function pullFromDb(input: PullFromDbInput): Promise<DbIngestResult> {
  const { connectionString, sql, params = [] } = input;
  if (!isReadonlySql(sql)) {
    throw new Error(
      `[db-source] SQL 只读校验未通过（只允许 SELECT / WITH 开头的查询）：${sql.slice(0, 48)}…`,
    );
  }
  const queryFn = input.queryFn ?? makeDefaultQueryFn(connectionString);
  const source = `db:${parseDbFlavor(connectionString) ?? 'unknown'}`;
  const { rows } = await queryFn(sql, params);
  const columns = inferColumns(rows);
  const records: IngestRecord[] = rows.map((row, i) => {
    const fields: Record<string, CellValue> = {};
    for (const [k, v] of Object.entries(row)) {
      fields[k] = normalizeValue(v);
    }
    return { id: `${source}#${i + 1}`, source, fields };
  });
  return { records, rowCount: records.length, columns, source };
}

// ══════════════════════════════════════
// REST API 拉取 → 中间格式
// ══════════════════════════════════════

/** 默认 FetchFn：node:fetch → { status, body }（JSON content-type 自动解析） */
export const defaultFetchFn: FetchFn = async (url, init) => {
  const res = await fetch(url, { headers: init?.headers });
  const text = await res.text();
  let body: unknown = text;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text; // 声称 JSON 但解析失败——保原文，由调用方判定形态
    }
  }
  return { status: res.status, body };
};

/** API 拉取入参 */
export interface PullFromApiInput {
  /** REST API URL */
  url: string;
  /** 认证头（如 { Authorization: 'Bearer …' }——凭据绝不落盘） */
  headers?: Record<string, string>;
  /**
   * 从响应体提取记录数组的取数路径（点路径，如 'data.items'）。
   * 缺省：body 本身是数组 → 直接用；是对象 → 找第一个数组值字段。
   */
  itemsPath?: string;
  /** 可注入拉取函数（缺省 defaultFetchFn） */
  fetchFn?: FetchFn;
}

/** 按点路径取值（'data.items' → body.data.items；路径断 → null） */
export function getPath(body: unknown, path: string): unknown {
  let cur: unknown = body;
  for (const seg of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[seg] ?? null;
  }
  return cur;
}

/** API 响应 → 记录数组（itemsPath 优先；缺省智能探测：body 数组 / 首数组字段） */
export function extractItems(body: unknown, itemsPath?: string): Array<Record<string, unknown>> {
  let candidate: unknown;
  if (itemsPath !== undefined && itemsPath !== '') {
    candidate = getPath(body, itemsPath);
  } else if (Array.isArray(body)) {
    candidate = body;
  } else if (body !== null && typeof body === 'object') {
    // 智能探测两层：顶层首数组字段（{items:[…]}）；次层首数组（{data:{items:[…]}}——
    // 分页包裹的最常见形态）。更深结构请显式指定 itemsPath（不猜三层防误取）。
    const firstArray = Object.values(body as Record<string, unknown>).find((v) => Array.isArray(v));
    if (firstArray !== undefined) {
      candidate = firstArray;
    } else {
      for (const v of Object.values(body as Record<string, unknown>)) {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          const nested = Object.values(v as Record<string, unknown>).find((x) => Array.isArray(x));
          if (nested !== undefined) {
            candidate = nested;
            break;
          }
        }
      }
    }
  } else {
    candidate = null;
  }
  if (!Array.isArray(candidate)) {
    throw new Error(
      `[db-source] API 响应体提取不到记录数组${itemsPath ? `（itemsPath=${itemsPath}）` : `（body 形态：${typeof body}）`}`,
    );
  }
  return candidate.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

/**
 * 从 REST API 拉取 → 中间格式记录（非 2xx 结构化拒绝）。
 */
export async function pullFromApi(input: PullFromApiInput): Promise<DbIngestResult> {
  const { url, headers, itemsPath } = input;
  const fetchFn = input.fetchFn ?? defaultFetchFn;
  const res = await fetchFn(url, headers ? { headers } : undefined);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`[db-source] API 拉取失败：HTTP ${res.status}（${url.slice(0, 64)}）`);
  }
  const items = extractItems(res.body, itemsPath);
  const columns = inferColumns(items);
  const source = `api:${url.slice(0, 48)}`;
  const records: IngestRecord[] = items.map((item, i) => {
    const fields: Record<string, CellValue> = {};
    for (const [k, v] of Object.entries(item)) {
      fields[k] = normalizeValue(v);
    }
    return { id: `${source}#${i + 1}`, source, fields };
  });
  return { records, rowCount: records.length, columns, source };
}
