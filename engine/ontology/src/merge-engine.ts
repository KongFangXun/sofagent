// ============================================================
// ontology/merge-engine.ts · Ontology 合并引擎
// v1.3.8 从 sofagent/audit/src/ontology/merge-engine.ts 迁出
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

import { existsSync, readFileSync, mkdirSync, readdirSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { load as yamlLoad } from 'js-yaml';
import {
  type OntologyObject,
  type OntologyAction,
  type OntologyConstraint,
  type MergedOntology,
} from './types';

// ============================================================
// 内联 atomicWriteSync（叶子包不依赖 @sofagent/core）
// ============================================================

/**
 * 原子写入——先写临时文件，再 rename 覆盖目标。
 * rename 在同文件系统上是原子操作，防止并发写脏读。
 */
function atomicWriteSync(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      copyFileSync(tmp, filePath);
      unlinkSync(tmp);
    } else {
      throw err;
    }
  }
}

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

      // v1.3.6 · v1.3.7 开发⑥：生命周期 + OKF ② 信任/时效字段（缺省 branch——新实体默认试验态）
      const lifecycleRaw = fm['lifecycle'];
      const lifecycle: OntologyObject['lifecycle'] =
        lifecycleRaw === 'trunk' || lifecycleRaw === 'branch' ? lifecycleRaw : 'branch';
      const statusRaw = fm['status'];
      const status: OntologyObject['status'] =
        statusRaw === 'draft' || statusRaw === 'stable' || statusRaw === 'deprecated' ? statusRaw : undefined;
      const staleAfter = typeof fm['stale_after'] === 'string' ? fm['stale_after'] : undefined;
      const verifiedRaw = fm['verified'];
      const verified = Array.isArray(verifiedRaw)
        ? verifiedRaw.filter(
            (v): v is { by: string; at: string } =>
              typeof v === 'object' && v !== null && typeof (v as { by?: unknown }).by === 'string' && typeof (v as { at?: unknown }).at === 'string',
          )
        : undefined;

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
        lifecycle,
        status,
        stale_after: staleAfter,
        verified,
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
      // v1.3.6 · v1.3.7 开发⑥：lifecycle + OKF 字段随合并输出（trunk/branch 区分基线/试验资产）
      lifecycle: o.lifecycle ?? 'branch',
      status: o.status,
      stale_after: o.stale_after,
      verified: o.verified,
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
    const { statSync } = require('fs');
    const stat = statSync(objectsPath);
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

// ============================================================
// v1.3.6 · v1.3.7 开发⑥：lifecycle 状态迁移（branch → trunk 审阅门）
// ============================================================

/** 迁移请求 */
export interface LifecycleMigrationRequest {
  /** 实体名（entities/<name>.md 的 name） */
  entityName: string;
  /** 审阅人（对齐 v1.3.6 approver 语义——Ed25519 身份码或人名） */
  approver: string;
  /** 审阅意见（留痕） */
  reviewNote?: string;
}

/** 迁移结果 */
export interface LifecycleMigrationResult {
  ok: boolean;
  reason?: string;
  /** 迁移前后的 lifecycle */
  from?: string;
  to?: string;
}

/**
 * branch → trunk 状态迁移（审阅门）。
 *
 * 审阅门语义（对齐 v1.3.6 workflow approver + 审计引擎硬证据）：
 *   - approver 必填（空审阅人 = 非法迁移）
 *   - 仅 branch 态可迁移（trunk → trunk 幂等拒绝；未知实体拒绝）
 *   - 迁移在 frontmatter 写入 lifecycle: trunk + verified 追加记录
 *     （OKF 三级信任：审阅人审核 = process 级验证留痕）
 *   - trunk 回退走 git snapshot（不在本函数——回滚是物理动作）
 *
 * @param knowledgeDir knowledge/ 目录（entities/ 所在）
 * @param req 迁移请求
 */
export function migrateToTrunk(knowledgeDir: string, req: LifecycleMigrationRequest): LifecycleMigrationResult {
  const { entityName, approver, reviewNote } = req;
  if (!approver || approver.trim() === '') {
    return { ok: false, reason: '非法迁移：审阅人（approver）必填——对齐 v1.3.6 审阅协议' };
  }
  const entityPath = join(knowledgeDir, 'entities', `${entityName}.md`);
  if (!existsSync(entityPath)) {
    return { ok: false, reason: `实体不存在: ${entityPath}` };
  }

  let content: string;
  try {
    content = readFileSync(entityPath, 'utf-8');
  } catch (err) {
    return { ok: false, reason: `读取实体失败: ${(err as Error).message}` };
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    return { ok: false, reason: '实体无 frontmatter——无法判定 lifecycle' };
  }
  const current = fm['lifecycle'];
  const from = current === 'trunk' || current === 'branch' ? current : 'branch';
  if (from === 'trunk') {
    return { ok: false, from, to: 'trunk', reason: '实体已是 trunk（幂等拒绝——trunk 回退走 git snapshot）' };
  }

  // 迁移：frontmatter 更新 lifecycle + 追加 verified 记录（OKF §5.2）
  const now = new Date().toISOString();
  const verifiedEntry = { by: `process:${approver}`, at: now };
  const existingVerified = Array.isArray(fm['verified']) ? (fm['verified'] as unknown[]) : [];
  const newVerified = [...existingVerified, verifiedEntry];

  // 重写 frontmatter（保留原字段 + 更新目标字段）
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { ok: false, reason: 'frontmatter 结构异常' };
  }
  let fmText = fmMatch[1]!;
  // 更新/插入 lifecycle
  if (/^lifecycle:/m.test(fmText)) {
    fmText = fmText.replace(/^lifecycle:.*$/m, 'lifecycle: trunk');
  } else {
    fmText += `\nlifecycle: trunk`;
  }
  // 追加 verified
  const verifiedYaml = newVerified
    .map((v) => `  - by: "${(v as { by?: string }).by ?? ''}"\n    at: "${(v as { at?: string }).at ?? ''}"`)
    .join('\n');
  if (/^verified:/m.test(fmText)) {
    fmText = fmText.replace(/^verified:[\s\S]*?(?=^\S|\n\S)/m, `verified:\n${verifiedYaml}`);
  } else {
    fmText += `\nverified:\n${verifiedYaml}`;
  }
  // 审阅意见留痕（注释行）
  if (reviewNote) {
    fmText += `\n# review-note: ${reviewNote.replace(/\n/g, ' ')} (${now})`;
  }

  const newContent = `---\n${fmText}\n---${normalized.slice(fmMatch[0].length)}`;
  try {
    atomicWriteSync(entityPath, newContent);
  } catch (err) {
    return { ok: false, reason: `写入失败: ${(err as Error).message}` };
  }

  return { ok: true, from: 'branch', to: 'trunk' };
}

/**
 * 与 v1.3.4 能力市场五环状态对齐（验收 4——避免两套状态并存）。
 *
 * 映射：trunk ↔ 已发布+养护中（published/maintained）· branch ↔ 待发布/评价中
 * （pending-review/reviewing）。市场侧消费 lifecycle 时用本表换算。
 */
export const LIFECYCLE_TO_MARKET_RING: Record<string, string> = {
  trunk: 'published+maintained',
  branch: 'pending-review',
};
