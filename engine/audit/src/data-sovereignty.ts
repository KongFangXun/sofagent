// ============================================================
// data-sovereignty.ts · 数据主权审计日志（v1.3.2 · P0）
// ============================================================
//
// 每次 LLM 调用 / 工具调用生成一条 DataSovereigntyRecord（4 维），
// 追加写入 data/audit/data-sovereignty/{年}/{月}/YYYY-MM-DD.jsonl（append-only）。
//
// 安全模式复用 audit-history.ts 的 HMAC 哈希链：
//   1. 先脱敏（dataFlow.fields / taskContext.userIntent 中的敏感串不原文落盘）
//   2. 再签名（HMAC-SHA256，密钥来自 ~/.sofagent-key；无密钥降级不写 hmacSig）
//   3. prevHash 链 + 环境指纹（hostname+username+git 路径）防 Agent 重算整链
//
// 写侧/读侧输入一致性铁律（对齐 修复）：HMAC 基于【已脱敏】记录计算，
// 读侧校验的正是脱敏后记录——两侧输入完全一致，避免 A2/A9 防误报回归。
// ============================================================

import { existsSync, mkdirSync, readFileSync, chmodSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHash, createHmac } from 'crypto';
import {
  SOVEREIGNTY_DIR,
  resolveAuditDir,
  getEnvFingerprint,
  getHmacKey,
  stableStringify,
  atomicAppendSync,
} from '@sofagent/core';

// ============================================================
// 核心数据结构（严格对齐 dev-prompt §2 L72-106，字段名一字不差）
// ============================================================

/**
 * 数据主权审计记录（4 维）
 * 每次模型调用 / 工具调用生成一条
 */
export interface DataSovereigntyRecord {
  // 维度 1：云端调用了什么？
  cloudCall: {
    timestamp: string;           // ISO 8601
    provider: string;            // 'openai' | 'anthropic' | 'deepseek' | 'qwen' | ...
    model: string;               // 'gpt-4o' | 'claude-3-5-sonnet' | ...
    endpoint: string;            // API endpoint URL
    tokenCount: { input: number; output: number };
    purpose: string;             // 'planning' | 'translation' | 'reasoning' | 'code-gen'
  };
  // 维度 2：本地到底执行了什么？
  localAction: {
    type: 'file-read' | 'file-write' | 'tool-call' | 'model-inference';
    target: string;              // 文件路径 / 工具名 / 模型名
    description: string;         // 人可读描述
    auditResult: 'PASS' | 'WARN' | 'FAIL';  // Harness 审计结果
  };
  // 维度 3：数据到底有没有走？走了哪儿？
  dataFlow: {
    direction: 'outbound' | 'inbound' | 'local-only';
    sensitivity: 'public' | 'internal' | 'restricted' | 'confidential';
    fields: string[];            // 涉及的数据字段（脱敏后记录）
    destination: 'cloud-api' | 'local-model' | 'local-file' | 'local-tool';
    redacted: boolean;           // 是否已脱敏
  };
  // 维度 4：每一次的任务到底是什么？
  taskContext: {
    taskId: string;              // 唯一任务 ID
    parentTaskId?: string;       // 父任务（编排链路）
    userIntent: string;          // 用户原始意图（脱敏摘要）
    workflowId?: string;         // 关联的 workflow
    agentRole: string;           // 'engineer' | 'reviewer' | 'audit' | 'fde'
  };
}

/** 落盘条目：记录 + 哈希链字段 */
export interface SovereigntyLogEntry extends DataSovereigntyRecord {
  /** 前一条记录的 hash（链完整性验证） */
  prevHash?: string;
  /** hash 算法版本：2 = 环境指纹（对齐 audit-history v1.0.6+） */
  hashVersion?: number;
  /** HMAC-SHA256 签名（有密钥时存在） */
  hmacSig?: string;
  /** 写入侧签名算法标记（stable = stableStringify） */
  hmacAlgo?: 'stable';
}

// ============================================================
// 脱敏（A2/A9 防误报铁律：先脱敏再签名）
// ============================================================

/** 敏感模式：密钥-like 串 / token-like 串（对齐 A2 思路，运行时再匹配） */
const SECRET_PATTERNS: RegExp[] = [
  /[a-zA-Z0-9_-]{32,}/g, // 长随机串（API key / token 形态）
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // IPv4 地址 → [IP]
  /\/Users\/[^/]+\//g, // macOS 用户路径 → [USER_PATH]
  /\/home\/[^/]+\//g, // Linux 用户路径 → [USER_PATH]
];

/**
 * 脱敏单个文本——替换敏感串为占位符。
 * 数据主权日志自身绝不能成为第二泄漏点。
 * v1.2.9 支持自定义正则（sanitizePatterns from config.yml）——企业业务机密（合同名称/客户名单/工资表）
 */
function sanitizeText(text: string, customPatterns?: { pattern: RegExp; replacement: string }[]): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.source === '\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b') {
      out = out.replace(pattern, '[IP]');
    } else if (pattern.source === '\\/Users\\/[^/]+\\/' || pattern.source === '\\/home\\/[^/]+\\/') {
      out = out.replace(pattern, '[USER_PATH]');
    } else {
      out = out.replace(pattern, (m) => `[REDACTED:${m.length}字符]`);
    }
  }
  // v1.2.9 自定义业务机密脱敏
  if (customPatterns) {
    for (const { pattern, replacement } of customPatterns) {
      try {
        out = out.replace(pattern, replacement);
      } catch {
        // 无效正则跳过，不阻断审计
      }
    }
  }
  return out;
}

/**
 * 脱敏整条记录——fields[] 元素与 userIntent 摘要中的敏感串替换为占位符。
 * 返回新对象，不改入参。redacted 标记置 true（只要发生了替换）。
 */
export function sanitizeRecord(record: DataSovereigntyRecord, customPatterns?: { pattern: RegExp; replacement: string }[]): DataSovereigntyRecord {
  const sanitizedFields = record.dataFlow.fields.map((f) => sanitizeText(f, customPatterns));
  const sanitizedIntent = sanitizeText(record.taskContext.userIntent, customPatterns);
  const fieldsChanged = sanitizedFields.some((f, i) => f !== record.dataFlow.fields[i]);
  const intentChanged = sanitizedIntent !== record.taskContext.userIntent;
  return {
    ...record,
    dataFlow: {
      ...record.dataFlow,
      fields: sanitizedFields,
      redacted: record.dataFlow.redacted || fieldsChanged || intentChanged,
    },
    taskContext: {
      ...record.taskContext,
      userIntent: sanitizedIntent,
    },
  };
}

// ============================================================
// 路径解析
// ============================================================

/** 从 ISO 时间戳提取 年/月/日 */
function dateParts(iso: string): { year: string; month: string; day: string } {
  const d = new Date(iso);
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { year, month, day };
}

/**
 * 解析某日的 JSONL 日志文件路径
 * 结构：data/audit/data-sovereignty/{年}/{月}/YYYY-MM-DD.jsonl
 * @param isoDate ISO 日期（如 2026-07-28），或 Date 对象
 * @param overrideHome 测试隔离用 fake home
 */
export function resolveSovereigntyLogPath(
  isoDate: string | Date,
  overrideHome?: string,
): string {
  const d = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const base = overrideHome
    ? join(resolveAuditDir(overrideHome), 'data-sovereignty')
    : SOVEREIGNTY_DIR;
  return join(base, year, month, `${year}-${month}-${day}.jsonl`);
}

// ============================================================
// DataSovereigntyLogger
// ============================================================

/**
 * 数据主权日志写入器
 *
 * 用法：
 *   const logger = new DataSovereigntyLogger();
 *   logger.append(record);              // 写今日文件（按 record.cloudCall.timestamp 分日）
 *   logger.queryRecent({ date: 'today' }); // 读今日记录
 */
export class DataSovereigntyLogger {
  private readonly overrideHome?: string;

  constructor(overrideHome?: string) {
    this.overrideHome = overrideHome;
  }

  /**
   * 追加一条记录（append-only）。
   * 先脱敏 → 算 prevHash → 签名 → 原子追加。
   * 写失败不抛出（审计是辅助通道，绝不阻断业务流程）。
   */
  append(record: DataSovereigntyRecord): void {
    try {
      const filePath = resolveSovereigntyLogPath(record.cloudCall.timestamp, this.overrideHome);
      const dir = dirname(filePath);
      const fileExists = existsSync(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      // 1. 脱敏（铁律：先脱敏再签名）
      const sanitized = sanitizeRecord(record);

      // 2. prevHash（上一行 hash + 环境指纹）
      const fingerprint = getEnvFingerprint(this.overrideHome);
      let prevHash = 'genesis';
      if (existsSync(filePath)) {
        const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
          try {
            const last = JSON.parse(lines[lines.length - 1]!);
            const forHash = { ...last, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
            prevHash = createHash('sha256')
              .update(JSON.stringify(forHash) + '|' + fingerprint)
              .digest('hex')
              .slice(0, 16);
          } catch (err) {
            console.error('[sofagent] data-sovereignty: prevHash 计算失败:', err instanceof Error ? err.message : String(err));
            prevHash = 'unknown';
          }
        }
      }

      // 3. HMAC 签名（基于脱敏后记录；无密钥降级不写）
      const hmacKey = getHmacKey();
      const base = {
        ...sanitized,
        prevHash,
        hashVersion: 2,
        hmacAlgo: hmacKey ? ('stable' as const) : undefined,
      };
      const forSig = { ...base, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
      const hmacSig = hmacKey
        ? createHmac('sha256', hmacKey).update(stableStringify(forSig) + '|' + fingerprint).digest('hex').slice(0, 32)
        : undefined;

      const entry: SovereigntyLogEntry = { ...base, hmacSig: hmacSig ?? undefined };
      atomicAppendSync(filePath, JSON.stringify(entry));

      if (!fileExists) {
        try {
          chmodSync(filePath, 0o600);
        } catch (err) {
          // chmod 失败不影响写入，但记录告警
          console.error('[sofagent] data-sovereignty: chmod 600 失败:', err instanceof Error ? err.message : String(err));
        }
      }
    } catch (err) {
      // 写日志失败不阻断业务，但记录告警供排查
      console.error('[sofagent] data-sovereignty: 审计日志写入失败:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 查询最近记录
   * @param opts.date 'today' | 'yesterday' | 'YYYY-MM-DD'（默认 today）
   * @param opts.limit 返回最近 N 条（默认 100）
   * @returns 按时间正序的记录数组
   */
  queryRecent(opts: { date?: string; limit?: number } = {}): DataSovereigntyRecord[] {
    const limit = opts.limit ?? 100;
    const dateStr = resolveDateArg(opts.date ?? 'today');
    const filePath = resolveSovereigntyLogPath(dateStr, this.overrideHome);
    if (!existsSync(filePath)) return [];

    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      // [sofagent] 审计辅助通道：读取失败不阻断业务，但记录告警
      console.error('[sofagent] data-sovereignty: 读取历史记录失败:', err instanceof Error ? err.message : String(err));
      return [];
    }

    const entries: DataSovereigntyRecord[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as DataSovereigntyRecord);
      } catch (err) {
        console.error('[sofagent] data-sovereignty: 日志行解析失败:', err instanceof Error ? err.message : String(err));
      }
    }
    entries.sort((a, b) => a.cloudCall.timestamp.localeCompare(b.cloudCall.timestamp));
    return entries.slice(-limit);
  }

  /**
   * 查询日期区间内的所有记录（周/月报用）
   * 扫描目录结构，聚合区间内所有日文件。
   * @param startISO 起始日期（含）
   * @param endISO 结束日期（含）
   */
  queryRange(startISO: string, endISO: string): DataSovereigntyRecord[] {
    const base = this.overrideHome
      ? join(resolveAuditDir(this.overrideHome), 'data-sovereignty')
      : SOVEREIGNTY_DIR;
    if (!existsSync(base)) return [];

    const start = new Date(startISO).getTime();
    const end = new Date(endISO).getTime();
    const out: DataSovereigntyRecord[] = [];

    let years: string[] = [];
    try {
      years = readdirSync(base).filter((f) => /^\d{4}$/.test(f));
    } catch (err) {
      console.error('[sofagent] data-sovereignty: 读取年份目录失败:', err instanceof Error ? err.message : String(err));
      return [];
    }

    for (const year of years) {
      const yearDir = join(base, year);
      let months: string[] = [];
      try {
        months = readdirSync(yearDir).filter((f) => /^\d{2}$/.test(f));
      } catch (err) {
        console.error('[sofagent] data-sovereignty: 读取月份目录失败:', err instanceof Error ? err.message : String(err));
        continue;
      }
      for (const month of months) {
        const monthDir = join(yearDir, month);
        let files: string[] = [];
        try {
          files = readdirSync(monthDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
        } catch (err) {
          console.error('[sofagent] data-sovereignty: 读取文件列表失败:', err instanceof Error ? err.message : String(err));
          continue;
        }
        for (const file of files) {
          const dayISO = file.replace(/\.jsonl$/, '');
          const t = new Date(dayISO).getTime();
          if (Number.isNaN(t) || t < start || t > end) continue;
          try {
            const content = readFileSync(join(monthDir, file), 'utf-8');
            for (const line of content.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                out.push(JSON.parse(trimmed) as DataSovereigntyRecord);
              } catch (err) {
                console.error('[sofagent] data-sovereignty: 查询区间日志行解析失败:', err instanceof Error ? err.message : String(err));
              }
            }
          } catch (err) {
            console.error('[sofagent] data-sovereignty: 查询区间日志文件读取失败:', err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    out.sort((a, b) => a.cloudCall.timestamp.localeCompare(b.cloudCall.timestamp));
    return out;
  }
}

// ============================================================
// 辅助
// ============================================================

/**
 * 解析 date 参数为 YYYY-MM-DD
 * 'today' → 今天；'yesterday' → 昨天；其余原样（校验格式）
 */
export function resolveDateArg(date: string): string {
  const now = new Date();
  if (date === 'today') {
    return toISODate(now);
  }
  if (date === 'yesterday') {
    const d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return toISODate(d);
  }
  // 校验 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  // fallback：尝试 Date 解析
  const parsed = new Date(date);
  if (!Number.isNaN(parsed.getTime())) return toISODate(parsed);
  return toISODate(now);
}

function toISODate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
