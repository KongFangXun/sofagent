// ============================================================
// tool-stats.ts · tool 使用率盘点（v1.7.0 章四）
//
// 读 {dataDir}/tool-usage.jsonl（usage-tracker 落盘），产出四视图：
//   ① 被调用清单（去重 tool 名 + 次数 + 最近调用——registry 过滤后）
//   ② 零调用清单（registry 全集 − 已调用 = 冷工具面）
//   ③ 频次分布表（按次数降序的全量直方——与 called 同源同过滤）
//   ④ 外部工具清单（registry 外的遥测工具名 + 次数，升序）
//
// N13 修复：usage-tracker 无差别记录宿主侧工具（如 WorkBuddy 的
// conversation_search）与历史残留名——called 视图曾直接按遥测聚合，
// registry 外名字混入「被调用清单」致计数面污染（实测 11+94=105≠104）。
// 现当 registry 全集可得时 called 仅保留 registry 内工具名；registry 外
// 记录不丢弃不静默，独立呈现在 external 视图（不计入本仓盘点）。
//
// 消费：sofagent stats --tools（core cli）——为工具退役与加码
// 提供数据依据（与 skill-health 使用频率同源消费）。
// 只读——不写任何文件。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from './config-loader';

/**
 * 遥测记录行（与 @sofagent/mcp usage-tracker 的 ToolUsageRecord 同构）。
 * 🔒 不 import mcp 包源码——core(L0) → mcp(L4) 是依赖方向红线
 * （dependency-direction.yml）；此处按结构类型本地声明（jsonl 行的
 * 消费侧形状，字段以 usage-tracker 的 schemaVersion=1 为准）。
 */
interface ToolUsageRecordLike {
  schemaVersion: number;
  tool: string;
  ts: string;
  sessionId: string;
}

/** tool-usage.jsonl 路径（与 usage-tracker 同源：{dataDir}/tool-usage.jsonl） */
export function resolveToolUsagePath(): string {
  return join(loadEnvConfig().dataDir, 'tool-usage.jsonl');
}

/** 读全量使用记录（坏行跳过；文件不存在 = 空） */
export function readToolUsage(): ToolUsageRecordLike[] {
  const p = resolveToolUsagePath();
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      try {
        return JSON.parse(l) as ToolUsageRecordLike;
      } catch {
        /* 为何可静默：坏行跳过——遥测 jsonl 单行损坏不阻断统计（计数面容错，与 skill-debt 台账同族降级） */
        return null;
      }
    })
    .filter((r): r is ToolUsageRecordLike => r !== null);
}

/** 单 tool 聚合行 */
export interface ToolUsageStat {
  tool: string;
  count: number;
  lastUsedAt: string | null;
}

/** 四视图聚合结果 */
export interface ToolStatsReport {
  /** ① 被调用清单（按次数降序；registry 可得时仅含 registry 内工具名） */
  called: ToolUsageStat[];
  /** ② 零调用清单（registry 全集 − 已调用；registry 不可达时为空并标注） */
  neverCalled: string[];
  /** ③ 频次分布（与 called 同源同过滤，降序直方形态） */
  distribution: Array<{ tool: string; count: number; bar: string }>;
  /**
   * ④ 外部工具清单（registry 外的遥测工具名 + 次数，按名字升序）——
   * 宿主侧工具/历史残留/手写错名；不丢弃不静默，不计入本仓盘点。
   * registry 不可达（软降级态）时为空（无全集可滤，原样聚合进 called）。
   */
  external: Array<{ tool: string; count: number }>;
  /** 记录总数（全量——含 external 工具的记录，与 called/external 分面无关） */
  totalRecords: number;
  /** registry 可达性（R2 F5：显式信号——neverCalled 空集不再承载二义语义） */
  registryAvailable: boolean;
}

/**
 * 聚合四视图。
 * @param registryToolNames 已知 tool 全集（零调用清单 = 全集 − 已调用）；
 *                          缺省尝试动态 require tool-registry（软依赖——
 *                          core 包不静态依赖 mcp，registry 不可达时 neverCalled
 *                          置空、called 不过滤原样聚合、external 为空）
 */
export function buildToolStats(registryToolNames?: string[]): ToolStatsReport {
  const records = readToolUsage();

  // 聚合（tool → count + lastUsedAt）——全量聚合，过滤在视图层做（坏账
  // 不丢账：external 视图需要 registry 外记录的完整次数面）
  const agg = new Map<string, ToolUsageStat>();
  for (const r of records) {
    const cur = agg.get(r.tool) ?? { tool: r.tool, count: 0, lastUsedAt: null };
    cur.count++;
    if (cur.lastUsedAt === null || r.ts > cur.lastUsedAt) cur.lastUsedAt = r.ts;
    agg.set(r.tool, cur);
  }

  // registry 全集解析（显式入参 > 动态 require > 软降级 undefined）
  let all: string[] | undefined = registryToolNames;
  if (all === undefined) {
    try {
      // 动态 require 经 mcp 包的 './tool-registry' 子路径导出（避免 core→mcp
      // 静态依赖边——依赖方向门禁红线；子路径入口无副作用——mcp-server.js
      // 主入口 require 即启服，不可用）。dist 未构建时软降级。
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const reg = require('@sofagent/mcp/tool-registry') as { TOOLS: Array<{ name: string }> };
      all = reg.TOOLS.map((t) => t.name);
    } catch {
      /* 为何可静默：mcp registry 动态 require 失败（L0→L4 依赖方向不可静态 import；dist 未构建）——零调用清单软降级为不可用，被调用/频次两视图不受影响 */
      all = undefined;
    }
  }

  // N13：registry 全集可得时按全集分面——called 仅保留 registry 内工具名，
  // registry 外记录独立入 external（不丢弃不静默）；registry 不可达时
  // （软降级态）无全集可滤，行为不变（原样聚合进 called，external 为空）。
  let calledEntries = [...agg.values()];
  const external: Array<{ tool: string; count: number }> = [];
  if (all !== undefined) {
    const registrySet = new Set(all);
    const inRegistry: ToolUsageStat[] = [];
    for (const e of calledEntries) {
      if (registrySet.has(e.tool)) {
        inRegistry.push(e);
      } else {
        external.push({ tool: e.tool, count: e.count });
      }
    }
    calledEntries = inRegistry;
  }
  external.sort((a, b) => a.tool.localeCompare(b.tool));

  const called = calledEntries.sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));

  // 零调用清单：registry 全集 − 已调用（agg 含外部名，但外部名不在全集内，
  // 对 neverCalled 无影响；用 agg 判存在性与用过滤后 called 等价）
  const neverCalled = all ? all.filter((n) => !agg.has(n)).sort() : [];
  // R2（F5 修正）：显式返回 registry 可达性——registry 可达且全部工具已调用时
  // neverCalled 为空但注册表是可达的，用空集推断会误报「不可达」。
  const registryAvailable = all !== undefined;

  const maxCount = called[0]?.count ?? 0;
  const distribution = called.map((c) => ({
    tool: c.tool,
    count: c.count,
    bar: maxCount > 0 ? '█'.repeat(Math.max(1, Math.round((c.count / maxCount) * 30))) : '',
  }));

  return { called, neverCalled, distribution, external, totalRecords: records.length, registryAvailable };
}

/** 四视图渲染为终端文本（CLI 消费） */
export function renderToolStats(report: ToolStatsReport, registryAvailable: boolean): string {
  const lines: string[] = [];
  lines.push(`tool 使用率盘点（遥测记录 ${report.totalRecords} 条 · 源 ${resolveToolUsagePath()}）`);
  lines.push('');

  // ① 被调用清单
  lines.push(`① 被调用清单（${report.called.length} 个）`);
  if (report.called.length === 0) {
    lines.push('  （暂无调用记录——遥测刚启用或 SOFAGENT_USAGE_TRACKING=0）');
  } else {
    for (const c of report.called) {
      lines.push(`  ${c.tool.padEnd(32)} ${String(c.count).padStart(6)} 次   最近 ${c.lastUsedAt ?? '—'}`);
    }
  }
  lines.push('');

  // ② 零调用清单
  lines.push(`② 零调用清单（${report.neverCalled.length} 个）`);
  if (!registryAvailable) {
    lines.push('  （tool registry 不可达——零调用面需 registry 对照，请先构建 mcp 包或检查安装）');
  } else if (report.neverCalled.length === 0) {
    lines.push('  （无零调用工具——全部已调用）');
  } else {
    const head = report.neverCalled.slice(0, 40);
    for (const n of head) lines.push(`  ${n}`);
    if (report.neverCalled.length > 40) lines.push(`  …等 ${report.neverCalled.length} 个`);
  }
  lines.push('');

  // ③ 频次分布
  lines.push(`③ 频次分布（按次数降序）`);
  if (report.distribution.length === 0) {
    lines.push('  （无数据）');
  } else {
    for (const d of report.distribution) {
      lines.push(`  ${d.tool.padEnd(32)} ${String(d.count).padStart(6)}  ${d.bar}`);
    }
  }

  // ④ 外部工具（N13）：registry 外记录不丢弃不静默——末尾一行显式呈现，
  // 让「called + neverCalled 合计 = registry 全集」的口径自洽可核。
  if (report.external.length > 0) {
    const items = report.external.map((e) => `${e.tool} ×${e.count}`).join(', ');
    lines.push('');
    lines.push(`ⓘ registry 外工具 ${report.external.length} 个（宿主侧/历史残留——不计入本仓盘点）：${items}`);
  }
  return lines.join('\n');
}
