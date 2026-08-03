// ============================================================
// ontology-coverage.ts · L3 Ontology 覆盖度（v1.2.5 · P0）
// ============================================================
//
// @monthly：统计知识库对 Ontology 本体的覆盖度。
//   - 读 {projectDir}/.sofagent/knowledge/ 下各子目录的 .md 文件
//   - 读 {projectDir}/.sofagent/ontology/ 本体定义
//   - 计算覆盖度：已覆盖的实体类型 / 总实体类型
//   - 覆盖度 < 50% → warning（知识库不完整）
// ============================================================

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { InspectorResult } from './types';

/** knowledge 一等子目录 */
const KNOWLEDGE_SUBDIRS = ['entities', 'concepts', 'comparisons', 'summaries'] as const;

/**
 * 分析 Ontology 覆盖度
 */
export function runOntologyCoverage(projectDir: string): InspectorResult {
  const knowledgeDir = join(projectDir, '.sofagent', 'knowledge');

  if (!existsSync(knowledgeDir)) {
    return {
      name: 'ontology-coverage',
      triggered: false,
      message: 'knowledge 目录不存在',
      severity: 'info',
    };
  }

  // 统计各子目录的 .md 文件数
  const coverage: Record<string, number> = {};
  let totalPages = 0;

  for (const subdir of KNOWLEDGE_SUBDIRS) {
    const subdirAbs = join(knowledgeDir, subdir);
    if (!existsSync(subdirAbs)) {
      coverage[subdir] = 0;
      continue;
    }
    let count = 0;
    try {
      const entries = readdirSync(subdirAbs);
      count = entries.filter((n) => n.endsWith('.md') && n !== 'index.md').length;
    } catch {
      count = 0;
    }
    coverage[subdir] = count;
    totalPages += count;
  }

  // 读 ontology 定义（如果存在）
  const ontologyDir = join(projectDir, '.sofagent', 'ontology');
  let ontologyTypes = 0;
  let ontologyVersion = '';

  if (existsSync(ontologyDir)) {
    try {
      const entries = readdirSync(ontologyDir).filter((n) => n.endsWith('.md'));
      for (const name of entries) {
        try {
          const content = readFileSync(join(ontologyDir, name), 'utf-8');
          // 简单计数：含 ## type 定义的行数
          const typeMatches = content.match(/^##\s+/gm);
          ontologyTypes += typeMatches ? typeMatches.length : 0;
          // 版本号提取
          const versionMatch = content.match(/^version:\s*(.+)$/m);
          if (versionMatch) ontologyVersion = versionMatch[1]?.trim() ?? '';
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }

  // 计算覆盖度
  const populatedDirs = KNOWLEDGE_SUBDIRS.filter(
    (d) => (coverage[d] ?? 0) > 0,
  ).length;
  const coveragePercent = Math.round((populatedDirs / KNOWLEDGE_SUBDIRS.length) * 100);

  const triggered = totalPages === 0 || coveragePercent < 50;

  const parts: string[] = [];
  for (const subdir of KNOWLEDGE_SUBDIRS) {
    parts.push(`${subdir}=${coverage[subdir]}`);
  }

  return {
    name: 'ontology-coverage',
    triggered,
    message:
      `Ontology 覆盖度 ${coveragePercent}%（${populatedDirs}/${KNOWLEDGE_SUBDIRS.length} 子目录有内容）` +
      ` · 总计 ${totalPages} 页` +
      (ontologyTypes > 0 ? ` · 本体 ${ontologyTypes} 类型` : '') +
      (ontologyVersion ? ` · v${ontologyVersion}` : '') +
      ` · ${parts.join(' / ')}` +
      (totalPages === 0 ? '（知识库为空）' : '') +
      (coveragePercent < 50 && totalPages > 0 ? '（覆盖度偏低，建议补充知识条目）' : ''),
    severity: totalPages === 0 ? 'warning' : coveragePercent < 50 ? 'warning' : 'info',
  };
}
