// ============================================================
// ontology/merge-engine.ts · Ontology 合并引擎
// v1.0.5 新增：自动合并 v1.0.1-1.4 的分散定义
// ============================================================
//
// 数据源：
//   1. entities/ 页面的 frontmatter relations 字段 → objects.yml
//   2. Workflow 节点的 actions 声明 → actions.yml
//   3. A15 约束验证的 constraints → constraints.yml
//
// 集成点：
//   - --init 创建 ontology/ 初始骨架
//   - --doctor 新增「Ontology 合并状态」检查项
//   - daemon 检测 knowledge/workflow 变化时触发 mergeOntology()
//   - 加载链新增第 5 层：ontology/objects.yml
// ============================================================

import { existsSync, readFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { load as yamlLoad } from 'js-yaml';
import { atomicWriteSync } from '../shared/atomic-write';
import {
  type OntologyObject,
  type OntologyAction,
  type OntologyConstraint,
  type MergedOntology,
} from './types';

// ============================================================
// 1. 扫描 entities/ 的 frontmatter relations
// ============================================================

/**
 * 解析 Markdown 文件的 YAML frontmatter
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  // 去除 BOM + 统一 CRLF → LF，防止 Windows 创建的文件解析失败
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
 * 扫描 knowledge/entities/ 目录，提取 frontmatter relations
 */
function scanEntityFrontmatter(knowledgeDir: string): OntologyObject[] {
  const objects: OntologyObject[] = [];
  const entitiesDir = join(knowledgeDir, 'entities');

  if (!existsSync(entitiesDir)) return objects;

  let files: string[];
  try {
    files = readdirSync(entitiesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return objects;
  }

  for (const file of files) {
    const filePath = join(entitiesDir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fm = parseFrontmatter(content);
      if (!fm) continue;

      const name = (fm['title'] || fm['name'] || file.replace('.md', '')) as string;
      const type = (fm['type'] || 'entity') as string;
      const relations = (fm['relations'] || {}) as OntologyObject['relations'];

      objects.push({
        name,
        type,
        relations: {
          has_many: Array.isArray(relations.has_many) ? relations.has_many : undefined,
          belongs_to: Array.isArray(relations.belongs_to) ? relations.belongs_to : undefined,
          depends_on: Array.isArray(relations.depends_on) ? relations.depends_on : undefined,
          produces: Array.isArray(relations.produces) ? relations.produces : undefined,
          consumes: Array.isArray(relations.consumes) ? relations.consumes : undefined,
        },
        source: filePath,
      });
    } catch {
      // 跳过无法读取的文件
    }
  }

  return objects;
}

// ============================================================
// 2. 扫描 workflow.yml 的 actions 声明
// ============================================================

/**
 * 扫描 workflow 目录下的 workflow.yml 文件，提取 actions 声明
 */
function scanWorkflowActions(workflowDir: string): OntologyAction[] {
  const actions: OntologyAction[] = [];

  // 尝试多个可能的 workflow 路径
  const candidatePaths = [
    join(workflowDir, 'workflow.yml'),
    join(dirname(workflowDir), 'orchestrator', 'workflows', 'workflow.yml'),
  ];

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) continue;

    try {
      const content = readFileSync(candidatePath, 'utf-8');
      const parsed = yamlLoad(content) as Record<string, unknown> | null;
      if (!parsed || typeof parsed !== 'object') continue;

      const nodesArr = parsed['nodes'] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(nodesArr)) continue;

      for (const node of nodesArr) {
        const nodeId = node['id'] as string | undefined;
        if (!nodeId) continue;

        const nodeActions = node['actions'] as string[] | undefined;
        if (!Array.isArray(nodeActions)) continue;

        for (const actionName of nodeActions) {
          if (typeof actionName !== 'string') continue;
          actions.push({
            name: actionName,
            nodeId,
            description: node[`action_${actionName}_description`] as string | undefined,
            constraints: node['constraints'] as Record<string, unknown> | undefined,
            source: candidatePath,
          });
        }
      }
      // 找到第一个有效 workflow 即停止
      if (actions.length > 0) break;
    } catch {
      // 跳过无法解析的 workflow
    }
  }

  return actions;
}

// ============================================================
// 3. 提取 A15 约束（从现有规则中）
// ============================================================

/**
 * 从 A15 约束验证逻辑中提取已知约束规则
 * 注意：这是静态提取，不运行审计规则
 */
function extractConstraints(configDir: string): OntologyConstraint[] {
  const constraints: OntologyConstraint[] = [];

  // 从 workflow.yml 提取 domain 约束
  const workflowPath = join(dirname(configDir), 'orchestrator', 'workflows', 'workflow.yml');
  if (existsSync(workflowPath)) {
    try {
      const content = readFileSync(workflowPath, 'utf-8');
      const parsed = yamlLoad(content) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') {
        const nodesArr = parsed['nodes'] as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(nodesArr)) {
          for (const node of nodesArr) {
            const nodeId = node['id'] as string | undefined;
            if (!nodeId) continue;

            // 提取 knowledgeDomain 约束
            const domain = node['knowledgeDomain'] as { include?: string[]; exclude?: string[] } | undefined;
            if (domain) {
              if (domain.include) {
                constraints.push({
                  type: 'domain_access',
                  target: nodeId,
                  rule: `include: ${domain.include.join(', ')}`,
                  severity: 'error',
                  source: workflowPath,
                });
              }
              if (domain.exclude) {
                constraints.push({
                  type: 'domain_access',
                  target: nodeId,
                  rule: `exclude: ${domain.exclude.join(', ')}`,
                  severity: 'error',
                  source: workflowPath,
                });
              }
            }

            // 提取 rate_limit 约束
            if (node['rateLimit']) {
              constraints.push({
                type: 'rate_limit',
                target: nodeId,
                rule: String(node['rateLimit']),
                severity: 'warn',
                source: workflowPath,
              });
            }
          }
        }
      }
    } catch {
      // workflow 读取失败，跳过约束提取
    }
  }

  return constraints;
}

// ============================================================
// 4. 合并写入
// ============================================================

/**
 * 将对象/动作/约束序列化为 YAML 列表字符串。
 * 使用 JSON.stringify —— JSON 是 YAML 1.2 的有效子集，自动处理特殊字符转义。
 */
function toYamlList<T extends Record<string, unknown>>(items: T[]): string {
  if (items.length === 0) return '# (empty)\n';
  const lines: string[] = [];
  for (const item of items) {
    // JSON.stringify 自动转义 "、\n、: 等 YAML 特殊字符，输出始终是合法 YAML
    lines.push(`- ${JSON.stringify(item)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * 合并 Ontology——扫描所有数据源并写入 ontology/ 目录
 * @param configDir .sofagent/ 配置目录路径
 * @returns MergedOntology 合并结果
 */
export function mergeOntology(configDir: string): MergedOntology {
  const knowledgeDir = join(dirname(configDir), 'knowledge');
  const workflowDir = join(dirname(configDir), 'workflows');

  // 1. 扫描 entities/ 的 frontmatter
  const objects = scanEntityFrontmatter(knowledgeDir);

  // 2. 扫描 workflow.yml 的 actions 声明
  const actions = scanWorkflowActions(workflowDir);

  // 3. 提取 A15 约束
  const constraints = extractConstraints(configDir);

  // 4. 合并写入 ontology/ 目录
  const ontologyDir = join(dirname(configDir), 'ontology');
  if (!existsSync(ontologyDir)) {
    mkdirSync(ontologyDir, { recursive: true });
  }

  // 写入 objects.yml
  atomicWriteSync(
    join(ontologyDir, 'objects.yml'),
    `# Ontology Objects —— 自动合并自 entities/ frontmatter relations\n` +
    `# 生成时间: ${new Date().toISOString()}\n` +
    `# 来源: v1.0.1 entities/ frontmatter\n\n` +
    toYamlList(objects.map((o) => ({
      name: o.name,
      type: o.type,
      relations: o.relations,
      source: o.source,
    }) as unknown as Record<string, unknown>))
  );

  // 写入 actions.yml
  atomicWriteSync(
    join(ontologyDir, 'actions.yml'),
    `# Ontology Actions —— 自动合并自 Workflow 节点 actions 声明\n` +
    `# 生成时间: ${new Date().toISOString()}\n` +
    `# 来源: v1.0.3 workflow.yml actions\n\n` +
    toYamlList(actions.map((a) => ({
      name: a.name,
      nodeId: a.nodeId,
      description: a.description,
      constraints: a.constraints,
      source: a.source,
    }) as unknown as Record<string, unknown>))
  );

  // 写入 constraints.yml
  atomicWriteSync(
    join(ontologyDir, 'constraints.yml'),
    `# Ontology Constraints —— 自动合并自 A15 约束验证\n` +
    `# 生成时间: ${new Date().toISOString()}\n` +
    `# 来源: v1.0.4 A15 constraints\n\n` +
    toYamlList(constraints.map((c) => ({
      type: c.type,
      target: c.target,
      rule: c.rule,
      severity: c.severity,
      source: c.source,
    }) as unknown as Record<string, unknown>))
  );

  // 5. 返回合并结果
  return {
    mergedAt: new Date().toISOString(),
    version: '1.0.5',
    objects,
    actions,
    constraints,
    stats: {
      totalObjects: objects.length,
      totalActions: actions.length,
      totalConstraints: constraints.length,
      sources: [
        ...new Set([
          ...objects.map((o) => o.source),
          ...actions.map((a) => a.source),
          ...constraints.map((c) => c.source),
        ]),
      ],
    },
  };
}

/**
 * 检查 ontology/ 目录是否存在（用于 --doctor）
 * @param configDir .sofagent/ 配置目录路径
 * @returns 存在且在 24 小时内更新过
 */
export function checkOntologyStatus(configDir: string): { exists: boolean; fresh: boolean; objectCount: number; actionCount: number; constraintCount: number } {
  const ontologyDir = join(dirname(configDir), 'ontology');
  const objectsPath = join(ontologyDir, 'objects.yml');
  const actionsPath = join(ontologyDir, 'actions.yml');
  const constraintsPath = join(ontologyDir, 'constraints.yml');

  const exists = existsSync(objectsPath) && existsSync(actionsPath) && existsSync(constraintsPath);
  if (!exists) {
    return { exists: false, fresh: false, objectCount: 0, actionCount: 0, constraintCount: 0 };
  }

  // 检查 freshness（24 小时内）
  let fresh = false;
  try {
    const stat = require('fs').statSync(objectsPath);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    fresh = ageHours < 24;
  } catch {
    // 无法读取 stat
  }

  // 粗略计数
  let objectCount = 0;
  let actionCount = 0;
  let constraintCount = 0;
  try {
    objectCount = readFileSync(objectsPath, 'utf-8').split('\n').filter((l) => l.trim().startsWith('- ')).length;
    actionCount = readFileSync(actionsPath, 'utf-8').split('\n').filter((l) => l.trim().startsWith('- ')).length;
    constraintCount = readFileSync(constraintsPath, 'utf-8').split('\n').filter((l) => l.trim().startsWith('- ')).length;
  } catch {
    // 读取失败
  }

  return { exists, fresh, objectCount, actionCount, constraintCount };
}
