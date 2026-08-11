// ============================================================
// validate-ontology.ts · MCP tool：本体结构完整性校验（v1.3.2 S2 新增）
// ============================================================
//
// 复用 @sofagent/ontology 的 checkOntologyStatus() + mergeOntology()
// 额外检查：entity 间 relations 引用是否存在断裂
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { checkOntologyStatus, mergeOntology } from '@sofagent/ontology';

// ============================================================
// 类型定义
// ============================================================

export interface ValidateOntologyArgs {
  /** 是否自动修复可修复的问题（如孤儿实体标记），默认 false */
  fix?: boolean;
}

export interface ValidateOntologyResult {
  text: string;
  data: {
    exists: boolean;
    entities: number;
    objectCount: number;
    actions: number;
    actionCount: number;
    constraints: number;
    constraintCount: number;
    orphans: string[];
    brokenRelations: string[];
    fresh: boolean;
    fixed: boolean;
  };
}

// ============================================================
// 辅助函数
// ============================================================

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return null;
  try {
    return yamlLoad(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 扫描所有 entity 文件，检查 relations 引用完整性
 */
function checkRelationIntegrity(entitiesDir: string): { orphans: string[]; brokenRelations: string[] } {
  if (!existsSync(entitiesDir)) {
    return { orphans: [], brokenRelations: [] };
  }

  const allEntities = new Set<string>();
  const entityRelations: Array<{ name: string; belongsTo: string[] }> = [];

  let files: string[] = [];
  try {
    files = readdirSync(entitiesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return { orphans: [], brokenRelations: [] };
  }

  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    allEntities.add(name);
    try {
      const content = readFileSync(join(entitiesDir, file), 'utf-8');
      const fm = parseFrontmatter(content);
      if (fm) {
        const relations = fm['relations'] as Record<string, unknown> | undefined;
        const belongsToRaw = relations?.['belongs_to'];
        const belongsTo: string[] = Array.isArray(belongsToRaw)
          ? belongsToRaw.filter((s): s is string => typeof s === 'string')
          : [];
        entityRelations.push({ name, belongsTo });
      } else {
        entityRelations.push({ name, belongsTo: [] });
      }
    } catch {
      entityRelations.push({ name, belongsTo: [] });
    }
  }

  // 检查 belongs_to 引用是否断裂
  const brokenRelations: string[] = [];
  for (const { name, belongsTo } of entityRelations) {
    for (const target of belongsTo) {
      if (!allEntities.has(target)) {
        brokenRelations.push(`entity "${name}" 的 belongs_to 引用 "${target}" 不存在`);
      }
    }
  }

  // 孤儿实体：没有被任何其他 entity 引用，且自己也没有 belongs_to
  const orphans: string[] = [];
  for (const name of allEntities) {
    const isReferenced = entityRelations.some(
      (e) => e.name !== name && e.belongsTo.includes(name),
    );
    const self = entityRelations.find((e) => e.name === name);
    const hasBelongsTo = self && self.belongsTo.length > 0;
    if (!isReferenced && !hasBelongsTo) {
      orphans.push(name);
    }
  }

  return { orphans, brokenRelations };
}

// ============================================================
// 主函数
// ============================================================

export function validateOntology(args: ValidateOntologyArgs): ValidateOntologyResult {
  const fix = args.fix ?? false;
  const dataDir = getSofagentDataDir();
  const entitiesDir = join(dataDir, 'knowledge', 'entities');
  // checkOntologyStatus() expects configDir whose PARENT contains ontology/
  // e.g. checkOntologyStatus('~/.sofagent/config') → looks for '~/.sofagent/ontology'
  const configDir = join(dataDir, 'config');

  let status: { exists: boolean; fresh: boolean; objectCount: number; actionCount: number; constraintCount: number };

  if (fix) {
    try {
      mergeOntology(configDir);
    } catch {
      // 合并失败不阻断
    }
  }

  try {
    status = checkOntologyStatus(configDir);
  } catch {
    status = { exists: false, fresh: false, objectCount: 0, actionCount: 0, constraintCount: 0 };
  }

  // 额外检查：relations 引用完整性
  const { orphans, brokenRelations } = checkRelationIntegrity(entitiesDir);

  const lines: string[] = [];
  lines.push('[sofagent] 本体结构校验');
  lines.push(`实体数: ${status.objectCount} · 动作数: ${status.actionCount} · 约束数: ${status.constraintCount}`);
  lines.push(`数据新鲜度: ${status.fresh ? '✅ 24h 内更新' : '⚠️ 超过 24h 未更新或不存在'}`);

  if (orphans.length > 0) {
    lines.push(`孤儿实体（${orphans.length}）:`);
    for (const o of orphans) {
      lines.push(`  - ${o}`);
    }
  }

  if (brokenRelations.length > 0) {
    lines.push(`断裂关联（${brokenRelations.length}）:`);
    for (const b of brokenRelations) {
      lines.push(`  - ${b}`);
    }
  }

  if (orphans.length === 0 && brokenRelations.length === 0 && status.exists) {
    lines.push('✅ 本体结构完整，无孤儿实体或断裂关联');
  }

  return {
    text: lines.join('\n'),
    data: {
      exists: status.exists,
      entities: status.objectCount,
      objectCount: status.objectCount,
      actions: status.actionCount,
      actionCount: status.actionCount,
      constraints: status.constraintCount,
      constraintCount: status.constraintCount,
      orphans,
      brokenRelations,
      fresh: status.fresh,
      fixed: fix,
    },
  };
}
