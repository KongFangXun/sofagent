// ============================================================
// list-concepts.ts · MCP tool：列出 knowledge/concepts/ 下所有 concept（v1.3.7 新增）
// ============================================================
//
// 照抄 mcp-server.ts toolListEntities 的实现模式，
// 把目录从 knowledge/entities/ 换成 knowledge/concepts/
// ============================================================

import { existsSync, readdirSync } from 'fs';
import { getDataDir } from '@sofagent/core';
import { join } from 'path';

// ============================================================
// 类型定义
// ============================================================

export interface ListConceptsResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    concepts: string[];
    count: number;
  };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取 {SOFAGENT_DATA} 目录——走 core getDataDir SSOT（v1.4.2 收编）
 */
/** knowledge 库根目录（data/knowledge） */
function getKnowledgeDir(): string {
  return join(getDataDir(), 'knowledge');
}

// ============================================================
// 主函数
// ============================================================

/**
 * 列出 knowledge/concepts/ 下所有 concept
 *
 * @returns 结构化结果（text + data）
 */
export function listConcepts(): ListConceptsResult {
  const dir = join(getKnowledgeDir(), 'concepts');

  if (!existsSync(dir)) {
    return {
      text: '[sofagent] knowledge/concepts 目录不存在',
      data: {
        concepts: [],
        count: 0,
      },
    };
  }

  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    files = [];
  }

  const concepts = files.map((f) => f.replace(/\.md$/, ''));

  const lines: string[] = [];
  lines.push(`[sofagent] concepts 共 ${concepts.length} 个:`);
  for (const c of concepts) {
    lines.push(`  - ${c}`);
  }

  return {
    text: lines.join('\n'),
    data: {
      concepts,
      count: concepts.length,
    },
  };
}
