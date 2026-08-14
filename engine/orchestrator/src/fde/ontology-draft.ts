// ============================================================
// fde/ontology-draft.ts · Ontology 咨询式生成端（v1.3.4 交付 10）
// ============================================================
//
// 五要素 → entity/concept/relations 草稿推导（引导式）。
// ontology 是 FDE Agent 的咨询产物——靠跟用户主动沟通生成，不是模型自动生成。
//
// 推导路径（复用 GUIDE 本体推导路径）：
//   第 0 步：按需判断（多数中小企业不必建全量本体）
//   五要素 → entity → concept → relations → ontology 草稿
//   → 人工确认 → 落盘到 {SOFAGENT_HOME}/data/ontology/drafts/
//
// 落盘铁律：当前版本只落草稿不注册（ontology_import 是 v1.3.6 的事）。
// LLM 只辅助建议，不自动生成。
// ============================================================

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { ComposeSession } from './compose-interview';
import { deriveOntologyDraft, type OntologyDraftResult } from './compose-interview';

/** Ontology 草稿 JSON（对齐 v1.3.1 JSON Schema） */
export interface OntologyDraftJson {
  /** 企业 ID */
  enterpriseId: string;
  /** 生成时间戳 */
  timestamp: string;
  /** 版本（对齐 v1.3.1 Schema） */
  version: string;
  /** 实体列表（CORE-OBJ 字段约束） */
  entities: Array<{
    name: string;
    type: string;
    source: string;
  }>;
  /** 概念列表（CORE-OBJ 字段约束） */
  concepts: Array<{
    name: string;
    type: string;
    source: string;
  }>;
  /** 关系列表（CORE-LNK 字段约束） */
  relations: Array<{
    from: string;
    type: string;
    to: string;
    source: string;
  }>;
  /** 是否需要全量本体（第 0 步判断） */
  needsFullOntology: boolean;
  /** 来源梳理会话的工作流名称 */
  workflowName: string;
}

/**
 * 从梳理会话推导 Ontology 草稿并落盘。
 *
 * @param session FDE 梳理会话（含五要素）
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 * @returns { draft, savedPath }
 */
export function generateOntologyDraft(
  session: ComposeSession,
  overrideHome?: string,
): { draft: OntologyDraftJson; savedPath: string } {
  // 推导 entity/concept/relations（复用 compose-interview 的 deriveOntologyDraft）
  const derived: OntologyDraftResult = deriveOntologyDraft(session);

  // 构造对齐 v1.3.1 Schema 的 JSON
  const timestamp = new Date().toISOString();
  const draft: OntologyDraftJson = {
    enterpriseId: session.enterpriseId,
    timestamp,
    version: '1.3.2',
    entities: derived.entities.map((name) => ({
      name,
      type: 'entity',
      source: `fde-compose:${session.workflowName}`,
    })),
    concepts: derived.concepts.map((name) => ({
      name,
      type: 'concept',
      source: `fde-compose:${session.workflowName}`,
    })),
    relations: derived.relations.map((r) => ({
      from: r.from,
      type: r.type,
      to: r.to,
      source: `fde-compose:${session.workflowName}`,
    })),
    needsFullOntology: derived.needsFullOntology,
    workflowName: session.workflowName,
  };

  // 落盘到 {SOFAGENT_HOME}/data/ontology/drafts/{enterprise-id}-{timestamp}.json
  // 落盘铁律：当前版本只落草稿不注册（ontology_import 是 v1.3.6 的事）
  const savedPath = saveOntologyDraft(draft, overrideHome);

  return { draft, savedPath };
}

/**
 * 落盘 Ontology 草稿到 {SOFAGENT_HOME}/data/ontology/drafts/{enterprise-id}-{timestamp}.json
 *
 * @param draft Ontology 草稿
 * @param overrideHome 测试隔离用 SOFAGENT_HOME 覆盖
 * @returns 落盘文件路径
 */
export function saveOntologyDraft(
  draft: OntologyDraftJson,
  overrideHome?: string,
): string {
  const env = loadEnvConfig();
  const baseDir = overrideHome ?? env.dataDir ?? process.env.SOFAGENT_HOME ?? join(process.env.HOME ?? '/tmp', '.sofagent');
  const draftsDir = join(baseDir, 'data', 'ontology', 'drafts');

  // 创建目录（递归）
  mkdirSync(draftsDir, { recursive: true });

  // 文件名：{enterprise-id}-{timestamp}.json
  const safeTimestamp = draft.timestamp.replace(/[:.]/g, '-');
  const fileName = `${draft.enterpriseId}-${safeTimestamp}.json`;
  const filePath = join(draftsDir, fileName);

  writeFileSync(filePath, JSON.stringify(draft, null, 2) + '\n', 'utf-8');

  return filePath;
}

/**
 * 校验 Ontology 草稿对齐 v1.3.1 JSON Schema（CORE-OBJ/CORE-LNK 字段约束）。
 *
 * @param draft Ontology 草稿
 * @returns 校验结果（errors 为空 = 通过）
 */
export function validateOntologyDraft(draft: OntologyDraftJson): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // CORE-OBJ 约束：entity/concept 必须有 name + type + source
  for (const entity of draft.entities) {
    if (!entity.name || entity.name.trim().length === 0) {
      errors.push(`entity 缺 name 字段`);
    }
    if (!entity.type || entity.type.trim().length === 0) {
      errors.push(`entity "${entity.name}" 缺 type 字段`);
    }
    if (!entity.source || entity.source.trim().length === 0) {
      errors.push(`entity "${entity.name}" 缺 source 字段`);
    }
  }

  for (const concept of draft.concepts) {
    if (!concept.name || concept.name.trim().length === 0) {
      errors.push(`concept 缺 name 字段`);
    }
    if (!concept.type || concept.type.trim().length === 0) {
      errors.push(`concept "${concept.name}" 缺 type 字段`);
    }
  }

  // CORE-LNK 约束：relation 必须有 from + type + to + source
  for (const rel of draft.relations) {
    if (!rel.from || !rel.to || !rel.type) {
      errors.push(`relation 缺 from/type/to 字段: ${JSON.stringify(rel)}`);
    }
  }

  // 必需元字段
  if (!draft.enterpriseId) errors.push('缺 enterpriseId');
  if (!draft.timestamp) errors.push('缺 timestamp');
  if (!draft.version) errors.push('缺 version');

  return {
    valid: errors.length === 0,
    errors,
  };
}
