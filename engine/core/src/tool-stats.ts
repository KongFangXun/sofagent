// ============================================================
// tool-stats.ts · tool 使用率盘点（v1.5.8 章四）
//
// 读 {dataDir}/tool-usage.jsonl（usage-tracker 落盘），产出三视图：
//   ① 被调用清单（去重 tool 名 + 次数 + 最近调用）
//   ② 零调用清单（registry 全集 − 已调用 = 冷工具面）
//   ③ 频次分布表（按次数降序的全量直方）
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

/** 三视图聚合结果 */
export interface ToolStatsReport {
  /** ① 被调用清单（按次数降序） */
  called: ToolUsageStat[];
  /** ② 零调用清单（registry 全集 − 已调用；registry 不可达时为空并标注） */
  neverCalled: string[];
  /** ③ 频次分布（全量降序——与 called 同源，独立呈现直方形态） */
  distribution: Array<{ tool: string; count: number; bar: string }>;
  /** 记录总数 */
  totalRecords: number;
}

/**
 * 聚合三视图。
 * @param registryToolNames 已知 tool 全集（零调用清单 = 全集 − 已调用）；
 *                          缺省尝试动态 require tool-registry（软依赖——
 *                          core 包不静态依赖 mcp，registry 不可达时 neverCalled 置空）
 */
export function buildToolStats(registryToolNames?: string[]): ToolStatsReport {
  const records = readToolUsage();

  // 聚合（tool → count + lastUsedAt）
  const agg = new Map<string, ToolUsageStat>();
  for (const r of records) {
    const cur = agg.get(r.tool) ?? { tool: r.tool, count: 0, lastUsedAt: null };
    cur.count++;
    if (cur.lastUsedAt === null || r.ts > cur.lastUsedAt) cur.lastUsedAt = r.ts;
    agg.set(r.tool, cur);
  }

  const called = [...agg.values()].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));

  // 零调用清单：registry 全集 − 已调用
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
  const neverCalled = all ? all.filter((n) => !agg.has(n)).sort() : [];

  const maxCount = called[0]?.count ?? 0;
  const distribution = called.map((c) => ({
    tool: c.tool,
    count: c.count,
    bar: maxCount > 0 ? '█'.repeat(Math.max(1, Math.round((c.count / maxCount) * 30))) : '',
  }));

  return { called, neverCalled, distribution, totalRecords: records.length };
}

/** 三视图渲染为终端文本（CLI 消费） */
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
  return lines.join('\n');
}
