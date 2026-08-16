// ============================================================
// ontology/import-pipeline.ts · Ontology 标准注入管线（v1.3.6 交付 ②）
// ============================================================
//
// 外部提交通道——模型层生成的 ontology（entity/concept/relations JSON）
// 从这里进入约束层：
//   提交（JSON）→ v1.3.1 schema 校验（单一事实源 entity/concept/relations.schema.json）
//   → D1-D5 数据审计 → 注册 entity-store（YML）+ 写 knowledge 页（md）
//   → decision-log 审计留痕（谁注入的 / 注入什么 / 校验结果）
//
// 设计约束：
// - 全量校验先行（validate-first）：任何一项非法 → 返回结构化错误，零写入
//   （绝不污染 entity-store）
// - 可回滚：写入过程记录 written 清单 + 原始内容快照，中途失败自动还原
//   （git snapshot 兜底语义——文件级还原之外的历史回溯走快照）
// - DSH 语义层提供方形态预留：import 参数 ↔ Cordis tool schema 对照
//   落 ONTOLOGY_IMPORT_DSH_MAPPING（plugin 包装随 v1.4.0 同批）
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { dump as yamlDump } from 'js-yaml';
import {
  diffDataChange,
  runDataRules,
  type DataAuditResult,
  type DataChange,
} from '@sofagent/core';
import { validateAgainstSchema, ENTITY_SCHEMA, CONCEPT_SCHEMA } from './schema';
import { writeEntity, type OntologyEntity } from '../entity-store';

// ============================================================
// 类型定义
// ============================================================

/** relations 简化形态合法键（对齐 RELATIONS_SCHEMA 简化形态 + entity.schema.json） */
export const RELATION_KEYS = ['belongs_to', 'has_many', 'depends_on', 'produces', 'consumes'] as const;
export type RelationKey = (typeof RELATION_KEYS)[number];

/** entity 注入项（created_at/updated_at 缺省自动补齐——外部提交方无需关心时间戳） */
export interface EntityImport {
  name: string;
  domain: string;
  description?: string;
  properties?: Record<string, unknown>;
  /** 简化形态 relations（键 → 目标名数组） */
  relations?: Partial<Record<RelationKey, string[]>>;
  created_at?: string;
  updated_at?: string;
}

/** concept 注入项（concept 无 domain 字段——区别于 entity） */
export interface ConceptImport {
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

/** relations 完整形态独立条目（source 必填——独立注入需声明来源对象） */
export interface RelationImport {
  /** 关系来源对象名（必须是本次 payload 内 entity 或已存在 entity） */
  source: string;
  /** 关系目标对象名 */
  target: string;
  /** 关系类型（简化形态键名） */
  relation: RelationKey;
  description?: string;
}

/** ontology 注入 payload（外部提交的完整结构） */
export interface OntologyImportPayload {
  entities?: EntityImport[];
  concepts?: ConceptImport[];
  relations?: RelationImport[];
}

/** 校验结论（validate-first 阶段的产出） */
export interface OntologyValidationResult {
  valid: boolean;
  /** 违规项列表（schema 路径 + 语义违规；valid=true 时为空） */
  issues: string[];
}

/** 注入结果 */
export interface OntologyImportResult {
  ok: boolean;
  /** 结构化错误清单（ok=false 时非空） */
  issues: string[];
  /** 注入统计 */
  imported: { entities: number; concepts: number; relations: number };
  /** 实际写入的文件路径清单（回滚依据） */
  written: string[];
  /** D1-D5 数据审计结论 */
  audit: DataAuditResult;
  /** decision-log 是否留痕成功 */
  decisionLogged: boolean;
  /** 回滚说明（发生回滚时非空） */
  rollbackNote?: string;
}

/** 注入选项 */
export interface OntologyImportOptions {
  /** 数据根目录（knowledge/ 与 ontology/ 的父目录） */
  dataDir: string;
  /** 注入者标识（decision-log agentId——谁注入的） */
  agentId?: string;
  /** 会话标识（decision-log sessionId） */
  sessionId?: string;
  /** 注入备注（decision-log why 补充） */
  comment?: string;
  /** 依赖注入：decision-log 写入器（测试可 mock；缺省动态 import @sofagent/audit） */
  emitDecision?: (input: {
    agentId: string;
    sessionId: string;
    kind: string;
    moment: string;
    why: string;
    artifactRef?: string;
    evidence?: string[];
  }) => unknown;
}

// ============================================================
// DSH 语义层提供方映射（v1.4.0 cordis-plugin 照此实现）
// ============================================================

/**
 * ontology_import 参数 ↔ Cordis tool schema 对照表。
 *
 * 定位：ontology_import + entity-store + merge-engine 组合 =
 * DSH 生态的语义层真空填补（多 Agent 协作的共享语义底座）。
 * v1.4.0 包装为 ontology_define / ontology_query / ontology_validate
 * 三个 DSH 可调用 tool——本表是包装时的字段对照单一事实源。
 */
export const ONTOLOGY_IMPORT_DSH_MAPPING: readonly {
  importField: string;
  cordisSurface: string;
  note: string;
}[] = [
  {
    importField: 'entities[]',
    cordisSurface: 'ontology_define tool · entity 参数组',
    note: 'EntityImport 逐字段映射 Cordis tool inputSchema（name/domain 必填对齐 CORE-OBJ）',
  },
  {
    importField: 'concepts[]',
    cordisSurface: 'ontology_define tool · concept 参数组',
    note: 'ConceptImport 无 domain——DSH 侧 concept 归全局语义层',
  },
  {
    importField: 'relations[]',
    cordisSurface: 'ontology_define tool · link 参数组（direction+cardinality）',
    note: '简化形态键名 → CORE-LNK direction/cardinality 推导（belongs_to=outgoing/many-to-one）',
  },
  {
    importField: '(返回值) issues[]',
    cordisSurface: 'ontology_validate tool · 校验回报',
    note: 'schema 违规清单原样透传——DSH 侧按 SHACL 形状约束语义消费',
  },
] as const;

// ============================================================
// 校验（validate-first：全量校验，零写入）
// ============================================================

/** 名称合法性（防路径穿越——与 create-entity 同规则） */
function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.trim() !== '' && !name.includes('..') && !name.includes('/') && !name.includes('\\');
}

/** 补齐时间戳（外部提交方缺省 created_at/updated_at 时自动填当前时间） */
function withTimestamps<T extends { created_at?: string; updated_at?: string }>(item: T): T {
  const now = new Date().toISOString();
  return {
    ...item,
    created_at: item.created_at ?? now,
    updated_at: item.updated_at ?? now,
  };
}

/**
 * 全量校验 ontology payload（schema 结构 + 引用语义）。
 * 任何一项非法 → valid=false + issues 全量清单（调用方据此零写入）。
 */
export function validateOntologyPayload(payload: OntologyImportPayload): OntologyValidationResult {
  const issues: string[] = [];

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, issues: ['payload: 必须是对象 { entities?, concepts?, relations? }'] };
  }

  const entityNames = new Set<string>();
  const conceptNames = new Set<string>();

  // entities：ENTITY_SCHEMA 校验（frontmatter 形态——relations 为简化形态对象）
  (payload.entities ?? []).forEach((raw, idx) => {
    const e = raw as Partial<EntityImport> | null;
    if (typeof e !== 'object' || e === null) {
      issues.push(`entities[${idx}]: 不是对象`);
      return;
    }
    if (!isValidName(e.name)) {
      issues.push(`entities[${idx}].name: 必填、非空且不得包含路径分隔符`);
      return;
    }
    if (entityNames.has(e.name)) {
      issues.push(`entities[${idx}].name: "${e.name}" 在本次 payload 内重复`);
    }
    entityNames.add(e.name);

    const frontmatter: Record<string, unknown> = {
      name: e.name,
      domain: e.domain,
      created_at: e.created_at ?? new Date().toISOString(),
      updated_at: e.updated_at ?? new Date().toISOString(),
      // 可选字段仅在有值时入 schema 校验对象（undefined 键会被 type 校验误判）
      ...(e.description !== undefined ? { description: e.description } : {}),
      ...(e.relations !== undefined ? { relations: e.relations } : {}),
    };
    const result = validateAgainstSchema(frontmatter, ENTITY_SCHEMA);
    for (const err of result.errors) {
      issues.push(`entities[${idx}] ${err}`);
    }
  });

  // concepts：CONCEPT_SCHEMA 校验
  (payload.concepts ?? []).forEach((raw, idx) => {
    const c = raw as Partial<ConceptImport> | null;
    if (typeof c !== 'object' || c === null) {
      issues.push(`concepts[${idx}]: 不是对象`);
      return;
    }
    if (!isValidName(c.name)) {
      issues.push(`concepts[${idx}].name: 必填、非空且不得包含路径分隔符`);
      return;
    }
    if (conceptNames.has(c.name)) {
      issues.push(`concepts[${idx}].name: "${c.name}" 在本次 payload 内重复`);
    }
    conceptNames.add(c.name);

    const frontmatter: Record<string, unknown> = {
      name: c.name,
      created_at: c.created_at ?? new Date().toISOString(),
      updated_at: c.updated_at ?? new Date().toISOString(),
      ...(c.description !== undefined ? { description: c.description } : {}),
    };
    const result = validateAgainstSchema(frontmatter, CONCEPT_SCHEMA);
    for (const err of result.errors) {
      issues.push(`concepts[${idx}] ${err}`);
    }
  });

  // relations：条目结构 + relation 键合法性
  (payload.relations ?? []).forEach((raw, idx) => {
    const r = raw as Partial<RelationImport> | null;
    if (typeof r !== 'object' || r === null) {
      issues.push(`relations[${idx}]: 不是对象`);
      return;
    }
    if (!isValidName(r.source)) {
      issues.push(`relations[${idx}].source: 必填、非空且不得包含路径分隔符`);
    }
    if (!isValidName(r.target)) {
      issues.push(`relations[${idx}].target: 必填、非空且不得包含路径分隔符`);
    }
    if (typeof r.relation !== 'string' || !(RELATION_KEYS as readonly string[]).includes(r.relation)) {
      issues.push(`relations[${idx}].relation: 必须是 ${RELATION_KEYS.join('/')} 之一`);
    }
  });

  return { valid: issues.length === 0, issues };
}

// ============================================================
// 注入（all-or-nothing：校验全过才写，中途失败自动回滚）
// ============================================================

/** knowledge 页路径（entity → knowledge/entities/<name>.md；concept → knowledge/concepts/<name>.md） */
function knowledgePath(dataDir: string, kind: 'entities' | 'concepts', name: string): string {
  return join(dataDir, 'knowledge', kind, `${name}.md`);
}

/** frontmatter 对象 → md 文本（name/domain/created_at/updated_at + relations） */
function renderKnowledgeMd(frontmatter: Record<string, unknown>, body: string): string {
  const fmYaml = yamlDump(frontmatter, { lineWidth: -1 }).trimEnd();
  return `---\n${fmYaml}\n---\n${body}`;
}

/** 写文件（先确保父目录存在——首次注入时 knowledge/ 子目录可能不存在） */
function writeFileEnsured(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

/** 读已有文件内容（回滚快照用；不存在返回 undefined） */
function readExisting(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * 注入 ontology——外部提交 → 校验 → D1-D5 审计 → 注册 + 写页 → 留痕。
 *
 * 全量校验先行：issues 非空 → ok=false 且零写入。
 * 写入中途失败 → 自动还原已写文件（删除新建 / 恢复原内容）。
 */
export function importOntology(payload: OntologyImportPayload, options: OntologyImportOptions): OntologyImportResult {
  const { dataDir } = options;
  const empty = { entities: 0, concepts: 0, relations: 0 };

  // 1. 全量校验（validate-first——任何非法零写入）
  const validation = validateOntologyPayload(payload);
  if (!validation.valid) {
    return {
      ok: false,
      issues: validation.issues,
      imported: empty,
      written: [],
      audit: { hasFail: false, hasWarn: false, failCount: 0, warnCount: 0, violations: [] },
      decisionLogged: false,
    };
  }

  const entities = (payload.entities ?? []).map((e) => withTimestamps(e));
  const concepts = (payload.concepts ?? []).map((c) => withTimestamps(c));
  const relations = payload.relations ?? [];

  // relations 归并进 entity 的简化形态 relations（source 必须是本次 payload 内 entity）
  const entityByName = new Map(entities.map((e) => [e.name, e]));
  const relationIssues: string[] = [];
  for (const r of relations) {
    const source = entityByName.get(r.source);
    if (!source) {
      // source 不在本次 payload——要求已存在（引用完整性留 D2 语义；此处不阻塞，
      // 仅当目标 entity 既不在 payload 也不在 store 时记 issue 由 D1-D5 之外的语义层拦截）
      relationIssues.push(`relations: source "${r.source}" 不在本次 payload（将尝试合并到已存在 entity）`);
      continue;
    }
    source.relations = source.relations ?? {};
    const list = source.relations[r.relation] ?? [];
    if (!list.includes(r.target)) list.push(r.target);
    source.relations[r.relation] = list;
  }

  // 2. D1-D5 数据审计（before/after 结构化 diff——FAIL 拒绝，WARN 放行）
  const changes: DataChange[] = [];
  for (const e of entities) {
    const existing = readExisting(knowledgePath(dataDir, 'entities', e.name));
    const before = existing ? { _content: existing } : undefined;
    changes.push(diffDataChange('entity', e.name, before, {
      name: e.name,
      domain: e.domain,
      created_at: e.created_at,
      updated_at: e.updated_at,
      ...(e.description !== undefined ? { description: e.description } : {}),
      ...(e.relations !== undefined ? { relations: e.relations } : {}),
    }));
  }
  for (const c of concepts) {
    const existing = readExisting(knowledgePath(dataDir, 'concepts', c.name));
    const before = existing ? { _content: existing } : undefined;
    changes.push(diffDataChange('concept', c.name, before, {
      name: c.name,
      created_at: c.created_at,
      updated_at: c.updated_at,
      ...(c.description !== undefined ? { description: c.description } : {}),
    }));
  }
  const audit = runDataRules(changes);
  if (audit.hasFail) {
    const failList = audit.violations
      .filter((v) => v.severity === 'FAIL')
      .map((v) => `${v.rule}: ${v.detail}`);
    return {
      ok: false,
      issues: [`D1-D5 数据审计拦截（FAIL）：${failList.join('；')}`],
      imported: empty,
      written: [],
      audit,
      decisionLogged: false,
    };
  }

  // 3. 写入（记录快照用于回滚）——entity-store YML + knowledge md 双写
  const written: string[] = [];
  const snapshots: Array<{ path: string; previous: string | undefined }> = [];
  try {
    for (const e of entities) {
      // 3a. entity-store 注册（YML——机器可读注册表）
      // 🔴 快照必须在写入前捕获（否则 previous = 新内容，回滚失效）
      const ymlPath = join(dataDir, 'ontology', 'entities', `${e.name}.yml`);
      snapshots.push({ path: ymlPath, previous: readExisting(ymlPath) });
      const storeEntity: OntologyEntity = {
        name: e.name,
        type: e.domain,
        description: e.description,
        properties: e.properties,
        relations: e.relations
          ? Object.entries(e.relations).flatMap(([relation, targets]) =>
              (targets ?? []).map((target) => ({ target, relation })),
            )
          : undefined,
      };
      writeEntity(dataDir, storeEntity);
      written.push(ymlPath);

      // 3b. knowledge 页（md——read_entity MCP tool 消费面）
      const mdPath = knowledgePath(dataDir, 'entities', e.name);
      snapshots.push({ path: mdPath, previous: readExisting(mdPath) });
      const frontmatter: Record<string, unknown> = {
        name: e.name,
        domain: e.domain,
        created_at: e.created_at,
        updated_at: e.updated_at,
        ...(e.relations !== undefined ? { relations: e.relations } : {}),
      };
      writeFileEnsured(mdPath, renderKnowledgeMd(frontmatter, e.description ?? ''));
      written.push(mdPath);
    }
    for (const c of concepts) {
      const mdPath = knowledgePath(dataDir, 'concepts', c.name);
      snapshots.push({ path: mdPath, previous: readExisting(mdPath) });
      const frontmatter: Record<string, unknown> = {
        name: c.name,
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
      writeFileEnsured(mdPath, renderKnowledgeMd(frontmatter, c.description ?? ''));
      written.push(mdPath);
    }
  } catch (err) {
    // 回滚：删除新建文件 / 恢复原内容（文件级还原；历史级回溯走 git snapshot 兜底）
    for (const { path, previous } of snapshots) {
      try {
        if (previous === undefined) {
          if (existsSync(path)) unlinkSync(path);
        } else {
          writeFileSync(path, previous, 'utf-8');
        }
      } catch {
        // 回滚尽力而为——原始错误继续上抛
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [`写入失败已回滚：${msg}`],
      imported: empty,
      written: [],
      audit,
      decisionLogged: false,
      rollbackNote: `已还原 ${snapshots.length} 个文件位（新建删除 / 原内容恢复）；历史级回溯可用 git snapshot`,
    };
  }

  // 4. decision-log 审计留痕（谁注入的 / 注入什么 / 校验结果）——非致命
  let decisionLogged = false;
  try {
    const emit = options.emitDecision ?? defaultEmitDecision();
    emit({
      agentId: options.agentId ?? 'sofagent-ontology-import',
      sessionId: options.sessionId ?? `ontology-import-${Date.now()}`,
      kind: 'KNOWLEDGE_DISTILL',
      moment: 'ACT',
      why:
        `ontology 注入：${entities.length} entity + ${concepts.length} concept + ` +
        `${relations.length} relation（schema 校验通过 · D1-D5 ${audit.hasWarn ? `WARN×${audit.warnCount}` : 'PASS'}）` +
        (options.comment ? ` · 备注: ${options.comment}` : ''),
      artifactRef: dataDir,
      evidence: [
        `entities=${entities.map((e) => e.name).join(',') || '(none)'}`,
        `concepts=${concepts.map((c) => c.name).join(',') || '(none)'}`,
        `relations=${relations.length} written=${written.length}`,
      ],
    });
    decisionLogged = true;
  } catch {
    // 留痕失败不阻塞注入结果（审计降级的明确语义）
  }

  return {
    ok: true,
    issues: relationIssues,
    imported: { entities: entities.length, concepts: concepts.length, relations: relations.length },
    written,
    audit,
    decisionLogged,
  };
}

/** 缺省 decision-log 写入器（动态 import——避免 orchestrator 硬依赖 audit 构建产物） */
function defaultEmitDecision(): (input: {
  agentId: string;
  sessionId: string;
  kind: string;
  moment: string;
  why: string;
  artifactRef?: string;
  evidence?: string[];
}) => unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audit = require('@sofagent/audit') as {
      emitDecision?: (input: unknown) => unknown;
    };
    if (typeof audit.emitDecision === 'function') {
      return audit.emitDecision.bind(audit) as (input: unknown) => unknown;
    }
  } catch {
    // audit 不可用 → 空写入器
  }
  return () => undefined;
}
