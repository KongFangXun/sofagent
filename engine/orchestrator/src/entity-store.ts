// ============================================================
// entity-store.ts · ontology entity 读写工具（v1.3.7 新建）
// 功能 ⑥ 激活链 Phase 2 后半——enterprise-graph 数据流三层架构
//
// v1.3.7 代码库 src 中没有现成的 readEntity()/writeEntity() 函数
// （仅在 activate.test.ts 有测试 mock）。ontology entity 读写能力
// 目前散在 activate.ts（写 entity YML）和 builtin-agents.ts。
// 本文件提供统一的 read/write API，供 enterprise-graph 使用。
//
// Entity 存储路径：{dataDir}/ontology/entities/{entityName}.yml
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

/** ontology entity 数据结构 */
export interface OntologyEntity {
  /** 实体名称（唯一标识） */
  name: string;
  /** 实体类型（如 customer/order/product） */
  type: string;
  /** 描述 */
  description?: string;
  /** 属性键值对 */
  properties?: Record<string, unknown>;
  /** 关联实体 */
  relations?: Array<{
    target: string;
    relation: string;
  }>;
  /** 知识域 */
  knowledgeDomain?: string;
}

/**
 * 读取 ontology entity。
 * @param dataDir 数据目录（.sofagent 或 $SOFAGENT_HOME/data）
 * @param entityName 实体名称
 * @returns OntologyEntity 或 null（不存在）
 */
export function readEntity(dataDir: string, entityName: string): OntologyEntity | null {
  // entity YML 存储在 data/ontology/entities/ 下
  // 也可能在 dataDir/ontology/entities/（.sofagent 直接路径）
  const candidates = [
    join(dataDir, 'ontology', 'entities', `${entityName}.yml`),
    join(dataDir, 'data', 'ontology', 'entities', `${entityName}.yml`),
  ];

  for (const entityPath of candidates) {
    if (existsSync(entityPath)) {
      try {
        const content = readFileSync(entityPath, 'utf-8');
        const parsed = yamlLoad(content) as Record<string, unknown> | null;
        if (parsed && typeof parsed === 'object') {
          return {
            name: String(parsed.name ?? entityName),
            type: String(parsed.type ?? 'unknown'),
            description: parsed.description ? String(parsed.description) : undefined,
            properties: parsed.properties as Record<string, unknown> | undefined,
            relations: Array.isArray(parsed.relations) ? parsed.relations as OntologyEntity['relations'] : undefined,
            knowledgeDomain: parsed.knowledgeDomain ? String(parsed.knowledgeDomain) : undefined,
          };
        }
      } catch {
        // YAML 解析失败 → 尝试下一个路径
      }
    }
  }

  return null;
}

/**
 * 写入 ontology entity（同步写入，v1.2.7 简单实现）。
 * @param dataDir 数据目录
 * @param entity 要写入的 entity
 */
export function writeEntity(dataDir: string, entity: OntologyEntity): void {
  // 写入 dataDir/ontology/entities/{name}.yml
  const entityDir = join(dataDir, 'ontology', 'entities');
  if (!existsSync(entityDir)) mkdirSync(entityDir, { recursive: true });

  const entityPath = join(entityDir, `${entity.name}.yml`);
  const ymlContent = yamlDump(entity);
  writeFileSync(entityPath, ymlContent);
}

/**
 * 列出所有 ontology entity 名称。
 * @param dataDir 数据目录
 * @returns entity 名称数组
 */
export function listEntities(dataDir: string): string[] {
  const candidates = [
    join(dataDir, 'ontology', 'entities'),
    join(dataDir, 'data', 'ontology', 'entities'),
  ];

  for (const entityDir of candidates) {
    if (existsSync(entityDir)) {
      try {
        return readdirSync(entityDir)
          .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
          .map((f) => f.replace(/\.ya?ml$/, ''));
      } catch {
        // 读取失败 → 尝试下一个
      }
    }
  }

  return [];
}

/**
 * 删除 ontology entity。
 * @param dataDir 数据目录
 * @param entityName 实体名称
 * @returns 是否删除成功
 */
export function deleteEntity(dataDir: string, entityName: string): boolean {
  const { unlinkSync } = require('fs');
  const candidates = [
    join(dataDir, 'ontology', 'entities', `${entityName}.yml`),
    join(dataDir, 'data', 'ontology', 'entities', `${entityName}.yml`),
  ];

  for (const entityPath of candidates) {
    if (existsSync(entityPath)) {
      try {
        unlinkSync(entityPath);
        return true;
      } catch {
        // 删除失败 → 尝试下一个
      }
    }
  }

  return false;
}
