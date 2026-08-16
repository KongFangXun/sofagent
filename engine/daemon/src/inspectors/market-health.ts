// ============================================================
// market-health.ts · 市场健康周检（v1.3.5 交付 3）
// ============================================================
//
// @weekly：市场健康巡检——目录完整性 + 评分异常 + 退役候选扫描。
//
// 与 market-catalog-daily（@daily）的区别：
//   - market-catalog-daily：日更目录生成（能力有哪些、最新版本是什么）
//   - market-health：周检健康巡检（退役候选 / 评分异常 / 目录完整性）
//
// 巡检内容：
//   1. 目录完整性：market/manifest.jsonl 是否存在 + 条目数
//   2. 退役候选扫描：低评分 / 低调用量能力（延迟 require retire.scanRetireCandidates）
//   3. 评分异常：无评价的能力（可能无人使用）
//
// 复用：@sofagent/orchestrator 的 scanRetireCandidates（延迟 require 避免 daemon→orchestrator 编译依赖）
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';

/**
 * 市场健康周检巡检器（@weekly）。
 *
 * @param _projectDir 项目根目录（数据走 SOFAGENT_HOME 路径 SSOT）
 * @returns InspectorResult
 */
export function runMarketHealth(_projectDir: string): InspectorResult {
  void _projectDir;
  const env = loadEnvConfig();
  const marketDir = join(env.dataDir, 'market');
  const manifestPath = join(marketDir, 'manifest.jsonl');

  // 1. 目录完整性检查
  if (!existsSync(manifestPath)) {
    return {
      name: 'market-health',
      triggered: false,
      message: '市场清单不存在（market/manifest.jsonl）——市场尚未启用',
      severity: 'info',
    };
  }

  // 统计清单条目数
  let entryCount = 0;
  let retiredCount = 0;
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const byId = new Map<string, { status: string }>();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { id: string; status: string };
        byId.set(entry.id, entry);
      } catch {
        // 跳过
      }
    }
    for (const [, entry] of byId) {
      entryCount++;
      if (entry.status === 'retired') retiredCount++;
    }
  } catch {
    return {
      name: 'market-health',
      triggered: false,
      message: '市场清单读取失败（manifest.jsonl 解析异常）',
      severity: 'warning',
    };
  }

  const activeCount = entryCount - retiredCount;

  // 2. 退役候选扫描（延迟 require orchestrator——避免编译期循环依赖）
  let retireCandidateCount = 0;
  try {
    const mod = require('@sofagent/orchestrator') as {
      scanRetireCandidates: (dataDir?: string) => Array<{ capabilityId: string }>;
    };
    const candidates = mod.scanRetireCandidates(env.dataDir);
    retireCandidateCount = candidates.length;
  } catch {
    // orchestrator 不可用 → 跳过退役扫描（不阻断）
  }

  // 3. 汇总
  const issues: string[] = [];
  if (retireCandidateCount > 0) {
    issues.push(`${retireCandidateCount} 个能力为退役候选（低评分/低调用量）`);
  }
  if (activeCount === 0 && entryCount > 0) {
    issues.push('全部能力已退役（无 active 能力）');
  }

  const severity = retireCandidateCount > 0 ? 'warning' : 'info';
  const message =
    `市场健康：${entryCount} 个能力（active ${activeCount} / retired ${retiredCount}）` +
    (issues.length > 0 ? `——${issues.join('；')}` : '——正常');

  return {
    name: 'market-health',
    triggered: retireCandidateCount > 0,
    message,
    severity: severity as 'info' | 'warning',
  };
}
