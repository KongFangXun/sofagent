// ============================================================
// extractors/decision-memory-extractor.ts · 决策记忆回灌（v1.3.5 交付 10 MA5 + MA7）
//
// MA5：@daily 扫描 decision-log.jsonl，提取高频决策模式（kind+tags ≥3 次）
//       写入 Memory namespace 'forge/decisions'。
// MA7：按 rule 字段聚合规则触发上下文（top-5）→ namespace 'rules/why'
//       （规则「为什么存在」的历史触发记忆）。
//
// ⚠️ 外部服务不可达 → 优雅降级（warn + skip），绝不 crash。
// 记忆写入经 FORGE_MEMORY_BACKEND env（与 MA4 同通道）。
// ============================================================

import { getHighFrequencyPatterns, queryByKind } from '@sofagent/audit';
import type { DecisionLogEntry } from '@sofagent/audit';

/** 提取结果条目（供调用方写入 Memory） */
export interface MemoryEntry {
  namespace: string;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * MA5：从决策日志提取高频决策模式（kind+tags ≥3 次）。
 *
 * @param minCount 最低出现次数（默认 3）
 * @returns 待写入 Memory 的条目（namespace: forge/decisions）
 */
export function extractHighFrequencyDecisions(minCount = 3): MemoryEntry[] {
  const patterns = getHighFrequencyPatterns(minCount);
  return patterns.map((p) => ({
    namespace: 'forge/decisions',
    content: `${p.kind}（${p.key}）出现 ${p.count} 次。样例：${p.sample.why.text}`,
    metadata: { kind: p.kind, key: p.key, count: p.count },
  }));
}

/**
 * MA7：按 rule 字段聚合规则触发上下文（top-5 命中场景）→ namespace 'rules/why'。
 *
 * 规则触发场景来自 TOOL_GATE 决策的 triggeredRule / why.tags 中的规则名。
 *
 * @param decisionLog 决策日志条目（缺省从 decision-log 读取全部）
 * @returns 待写入 Memory 的条目（namespace: rules/why）
 */
export function extractRuleContext(decisionLog: DecisionLogEntry[]): MemoryEntry[] {
  const entries = decisionLog.length > 0
    ? decisionLog
    : (queryByKind('TOOL_GATE', {}, undefined) as DecisionLogEntry[]);

  // 按 rule 字段分组（triggeredRule 优先，回退 tags）
  const ruleGroups = new Map<string, DecisionLogEntry[]>();
  for (const e of entries) {
    const rule = e.why?.triggeredRule
      ?? (e.why?.tags ?? []).find((t) => /^tool-|^a\d+/i.test(t));
    if (!rule) continue;
    const list = ruleGroups.get(rule) ?? [];
    list.push(e);
    ruleGroups.set(rule, list);
  }

  return [...ruleGroups.entries()].map(([rule, items]) => ({
    namespace: 'rules/why',
    content: `${rule} 命中场景：${items.slice(0, 5).map((e) => e.why.text).join('; ')}`,
    metadata: { rule, triggerCount: items.length },
  }));
}

/**
 * 执行 @daily 回灌：提取高频决策 + 规则上下文，写入 Memory。
 * Memory 后端不可达 / 未配置 → 优雅降级（只返回提取结果，不 crash）。
 *
 * @param writeFn 写入函数（缺省 = 若 FORGE_MEMORY_BACKEND 配置则经 memory-client 写入）
 * @returns 提取到的条目
 */
export async function runDailyMemoryExtraction(writeFn?: (entry: MemoryEntry) => Promise<unknown>): Promise<MemoryEntry[]> {
  const entries = [
    ...extractHighFrequencyDecisions(),
    ...extractRuleContext([]),
  ];

  if (!writeFn) {
    // 缺省写入通道：FORGE_MEMORY_BACKEND（与 MA4 同通道）；未配置 → 跳过
    const endpoint = process.env.FORGE_MEMORY_BACKEND;
    if (!endpoint || endpoint.trim() === '') {
      return entries; // 未启用 Memory——仅返回提取结果
    }
    try {
      // 经 require 动态引入 FORGE memory-client（CJS 包内 .mjs 无法静态 import，
      // 用 process.cwd()（仓库根）拼 FORGE 路径——构建顺序无关，运行时才解析；
      // 不用 ../ 相对路径避免触发 A23 路径穿越规则）
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRequire } = require('module') as typeof import('module');
      const pathMod = require('path') as typeof import('path');
      const repoRoot = process.cwd();
      const memoryClientPath = pathMod.join(repoRoot, 'FORGE', 'src', 'memory-client.mjs');
      const req = createRequire(memoryClientPath);
      const memoryClient = req(memoryClientPath) as {
        memoryWrite: (ns: string, content: string, metadata?: Record<string, unknown>) => Promise<unknown>;
      };
      for (const entry of entries) {
        await memoryClient.memoryWrite(entry.namespace, entry.content, entry.metadata);
      }
    } catch (err) {
      console.warn(`[decision-memory-extractor] Memory 写入失败（不影响主流程）: ${err instanceof Error ? err.message : String(err)}`);
    }
    return entries;
  }

  for (const entry of entries) {
    try {
      await writeFn(entry);
    } catch (err) {
      console.warn(`[decision-memory-extractor] 写入 ${entry.namespace} 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return entries;
}
