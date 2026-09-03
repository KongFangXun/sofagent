// stats.ts · v1.4.4 第七章 · 审计聚合指标（安全边界触发率——约束层价值量化）
//
// 定位：约束层的价值目前是逐次事件（这次拦了什么），缺聚合度量——
// 「近 30 天 N 次变更中，多少次触发审计边界、拦下多少次注入」这一行数字
// 对企业客户比任何文档都有说服力。本文件把「约束生效」从定性声明变成
// 可汇报的治理 KPI。
//
// 数据地基（纯聚合零新采集）：~/.sofagent/data/audit/history.jsonl 已有
// 全量原始记录（timestamp / exitCode / ruleResults×17 / actionGovernance /
// HMAC 链）。
//
// 三条设计决策（v1.4.3 拍板）：
//   一、纯聚合不加 MCP tool——CLI --stats 足够，企业消费走 --json
//   二、指标口径写进 HANDBOOK——口径单源防漂移（见 docs/HANDBOOK.md 指标口径节）
//   三、只读铁律——聚合层永不写 history.jsonl（HMAC 链完整性是审计信任根基；
//       聚合前后文件字节级一致由调用方校验）
//
// 口径（与 HANDBOOK 同源）：
//   触发率 = (WARN 条数 + FAIL 条数) / 变更总数（exitCode 判定：1=WARN 2=FAIL）
//   阻断率 = FAIL 条数 / 变更总数（exitCode=2 为准）
//   高危规则 Top 5 = ruleResults 中 status=FAIL/WARN 的规则按触发次数降序取前五

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AuditHistoryEntry } from './audit-history';
import type { RuleCheck } from './rules/types';

// ════════════════════════════════════════
// 聚合报告数据模型
// ════════════════════════════════════════

/** 高危规则触发条目 */
export interface RuleTriggerEntry {
  /** 规则码（A2 / A9 / A3 等） */
  rule: string;
  /** 规则名（ruleResults 的 message 摘要——人读） */
  name: string;
  /** 触发次数（WARN+FAIL 合计口径） */
  count: number;
  /** 其中 FAIL（阻断）次数 */
  failCount: number;
}

/** 审计聚合报告（治理 KPI——CLI --stats 输出 / --json 机器可读） */
export interface AuditStatsReport {
  /** 报告 schema 版本 */
  schemaVersion: 'v1';
  /** 统计窗口（天——--days N 可调，缺省 30） */
  windowDays: number;
  /** 窗口起止（ISO 8601——generatedAt 往前推 windowDays） */
  windowStart: string;
  windowEnd: string;
  /** 变更总数（窗口内 history 条目数——分母） */
  totalChanges: number;
  /** 判定分布（exitCode 口径：0=PASS / 1=WARN / 2=FAIL） */
  distribution: { pass: number; warn: number; fail: number };
  /** 安全边界触发率（(WARN+FAIL)/total——保留 4 位小数） */
  triggerRate: number | null;
  /** 阻断率（FAIL/total——HANDBOOK 口径 exitCode=2 为准） */
  blockRate: number | null;
  /** 高危规则触发 Top 5（WARN+FAIL 合计降序） */
  topRules: RuleTriggerEntry[];
  /** 生成时间 */
  generatedAt: string;
}

/** 聚合选项 */
export interface StatsOptions {
  /** 统计窗口天数（缺省 30） */
  days?: number;
  /** 时钟注入（测试） */
  now?: () => number;
  /** 数据目录覆盖（测试——history.jsonl 定位） */
  dataDir?: string;
  /** Top N（缺省 5） */
  topN?: number;
}

// ════════════════════════════════════════
// history.jsonl 只读加载（聚合专用——不走 loadHistory 的告警面）
// ════════════════════════════════════════

/** history.jsonl 路径（与 audit-history 同源约定） */
export function statsHistoryFilePath(dataDir?: string): string {
  const base = dataDir ?? resolveDefaultDataDir();
  return join(base, 'audit', 'history.jsonl');
}

/** 缺省数据目录（~/.sofagent/data——与 audit-history 的 getHistoryFilePath 同源） */
function resolveDefaultDataDir(): string {
  const envDir = process.env.SOFAGENT_DATA;
  if (envDir && envDir.trim() !== '') return envDir;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.sofagent', 'data');
}

/**
 * 只读解析 history.jsonl（坏行容忍——与 loadHistory 同语义但不打告警：
 * 聚合是只读观测面，坏行跳过不构成事件）。
 *
 * ⚠️ 只读铁律：本函数零写入——HMAC 链完整性不受聚合影响（调用方可对
 * 聚合前后文件做字节级比对验证）。
 */
export function readHistoryEntries(dataDir?: string): AuditHistoryEntry[] {
  const filePath = statsHistoryFilePath(dataDir);
  if (!existsSync(filePath)) return [];
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return []; // 读取失败降级空（空历史不崩——验收口径）
  }
  const entries: AuditHistoryEntry[] = [];
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as AuditHistoryEntry;
      // 最小形状校验（timestamp + exitCode 是聚合依赖字段）
      if (
        parsed &&
        typeof parsed.timestamp === 'string' &&
        typeof parsed.exitCode === 'number' &&
        Array.isArray(parsed.ruleResults)
      ) {
        entries.push(parsed);
      }
    } catch {
      /* 坏行跳过（容忍——不中断聚合） */
    }
  }
  return entries;
}

// ════════════════════════════════════════
// 聚合计算
// ════════════════════════════════════════

/**
 * 审计聚合主入口：读 history.jsonl → 窗口过滤 → 指标计算。
 *
 * 空历史降级：totalChanges=0 时 triggerRate/blockRate 为 null（不硬凑 0——
 * 「无数据」与「零触发」语义不同，HANDBOOK 口径）。
 */
export function computeAuditStats(options: StatsOptions = {}): AuditStatsReport {
  const now = options.now ?? Date.now;
  const days = options.days ?? 30;
  const topN = options.topN ?? 5;
  const windowEndMs = now();
  const windowStartMs = windowEndMs - days * 24 * 60 * 60 * 1000;

  const entries = readHistoryEntries(options.dataDir);
  // 窗口过滤（timestamp 解析失败的条目跳过——坏数据不进分母）
  const inWindow = entries.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return !Number.isNaN(ts) && ts >= windowStartMs && ts <= windowEndMs;
  });

  const pass = inWindow.filter((e) => e.exitCode === 0).length;
  const warn = inWindow.filter((e) => e.exitCode === 1).length;
  const fail = inWindow.filter((e) => e.exitCode === 2).length;
  const total = inWindow.length;

  // 高危规则 Top N（WARN+FAIL 合计降序——ruleResults 逐条累计）
  const ruleCounts = new Map<string, { name: string; count: number; failCount: number }>();
  for (const entry of inWindow) {
    for (const rc of entry.ruleResults as RuleCheck[]) {
      if (!rc || rc.status !== 'WARN' && rc.status !== 'FAIL') continue;
      // 规则码：A<n> / E<n>（与 reporter.ts 口径一致——E 系列 number=200+序号，200+ 走 E 前缀）
      const code = rc.number >= 200 ? `E${rc.number - 200}` : `A${rc.number}`;
      const existing = ruleCounts.get(code) ?? { name: '', count: 0, failCount: 0 };
      existing.count += 1;
      if (rc.status === 'FAIL') existing.failCount += 1;
      // name 取规则人读名（name 字段——同码多条时保留首见）
      if (existing.name === '' && typeof rc.name === 'string' && rc.name !== '') {
        existing.name = rc.name;
      }
      ruleCounts.set(code, existing);
    }
  }
  const topRules: RuleTriggerEntry[] = [...ruleCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN)
    .map(([rule, v]) => ({ rule, name: v.name, count: v.count, failCount: v.failCount }));

  const round4 = (x: number): number => Math.round(x * 10000) / 10000;

  return {
    schemaVersion: 'v1',
    windowDays: days,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    totalChanges: total,
    distribution: { pass, warn, fail },
    triggerRate: total > 0 ? round4((warn + fail) / total) : null,
    blockRate: total > 0 ? round4(fail / total) : null,
    topRules,
    generatedAt: new Date(windowEndMs).toISOString(),
  };
}

// ════════════════════════════════════════
// 输出格式化（人类可读 + JSON 纯净）
// ════════════════════════════════════════

/**
 * 人类可读报告（CLI --stats 缺省输出——表格化，治理汇报口径）。
 */
export function formatStatsReport(report: AuditStatsReport): string {
  const pct = (rate: number | null): string =>
    rate === null ? '—（无数据）' : `${(rate * 100).toFixed(2)}%`;
  const lines: string[] = [
    '━━━ sofagent 审计聚合报告（治理 KPI）━━━',
    `统计窗口：近 ${report.windowDays} 天（${report.windowStart.slice(0, 10)} ~ ${report.windowEnd.slice(0, 10)}）`,
    `变更总数：${report.totalChanges}`,
    `判定分布：PASS ${report.distribution.pass} · WARN ${report.distribution.warn} · FAIL ${report.distribution.fail}`,
    `安全边界触发率：(WARN+FAIL)/总数 = ${pct(report.triggerRate)}`,
    `阻断率：FAIL/总数 = ${pct(report.blockRate)}`,
  ];
  if (report.topRules.length > 0) {
    lines.push('高危规则 Top 5（WARN+FAIL 合计）：');
    for (const [i, r] of report.topRules.entries()) {
      lines.push(
        `  ${i + 1}. ${r.rule}${r.name ? `（${r.name}）` : ''}——触发 ${r.count} 次（其中阻断 ${r.failCount} 次）`,
      );
    }
  } else {
    lines.push('高危规则 Top 5：窗口内零触发（干净窗口）');
  }
  return lines.join('\n');
}

/**
 * JSON 纯净输出（--json——机器可读，零人类可读混行）。
 * 企业 SIEM/监控平台消费；JSON.stringify 单出口保证纯净。
 */
export function formatStatsJson(report: AuditStatsReport): string {
  return JSON.stringify(report);
}
