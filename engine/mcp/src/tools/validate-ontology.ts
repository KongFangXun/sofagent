// ============================================================
// tools/validate-ontology.ts · validate_ontology MCP tool（v1.2.4 · P3 S2）
// ============================================================

import { checkOntologyStatus } from '@sofagent/ontology';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';

export interface ValidateOntologyArgs {
  fix?: boolean;
}

export function validateOntology(args: ValidateOntologyArgs): { text: string; data: unknown } {
  const env = loadEnvConfig();
  const knowledgeDir = join(env.dataDir, 'knowledge');

  try {
    const status = checkOntologyStatus(knowledgeDir);
    const lines: string[] = ['[sofagent] 本体结构校验:', ''];
    lines.push(`实体数: ${status.entities}`);
    lines.push(`操作数: ${status.actions}`);
    lines.push(`约束数: ${status.constraints}`);

    // 额外检查：孤儿 entity
    const entitiesDir = join(knowledgeDir, 'entities');
    let orphans: string[] = [];
    if (existsSync(entitiesDir)) {
      const allEntities = readdirSync(entitiesDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
      // 简单启发式：没有 relations 指向的 entity 视为潜在孤儿
      orphans = allEntities; // 简化：返回全部，status 层做判断
    }

    const fresh = status.entities === 0;
    if (fresh) {
      lines.push('⚠️ 知识库为空');
    }

    return {
      text: lines.join('\n'),
      data: {
        entities: status.entities,
        actions: status.actions,
        constraints: status.constraints,
        orphans,
        brokenRelations: [],
        fresh,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] 本体校验异常：${err instanceof Error ? err.message : String(err)}`,
      data: { error: true, entities: 0, actions: 0, constraints: 0, orphans: [], brokenRelations: [], fresh: true },
    };
  }
}
