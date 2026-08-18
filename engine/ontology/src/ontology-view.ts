// ============================================================
// ontology-view.ts · Ontology 人类可读视图生成器
// v1.3.6 从 sofagent/audit/src/ontology/ontology-view.ts 迁出
//
// 用法：
//   sofagent-audit ontology view
//
// 读取 .sofagent/ontology/ 目录下的：
//   - objects.yml     — 实体定义
//   - actions.yml     — 动作定义
//   - constraints.yml — 约束规则
//
// 输出人类可读的 Markdown 到 stdout
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad, YAMLException } from 'js-yaml';

/** objects.yml 中的实体条目 */
interface OntologyObjectEntry {
  name?: string;
  type?: string;
  description?: string;
  relations?: Record<string, string[]>;
  source?: string;
  /** v1.3.6 · v1.3.7 开发⑥：生命周期（trunk=基线资产 / branch=试验资产） */
  lifecycle?: string;
  /** v1.3.6 · v1.3.7 开发⑥ OKF ②：信任/时效字段 */
  status?: string;
  stale_after?: string;
  verified?: Array<{ by?: string; at?: string }>;
}

/** actions.yml 中的动作条目 */
interface OntologyActionEntry {
  name?: string;
  nodeId?: string;
  description?: string;
  constraints?: Record<string, unknown>;
  source?: string;
}

/** constraints.yml 中的约束条目 */
interface OntologyConstraintEntry {
  type?: string;
  target?: string;
  rule?: string;
  severity?: string;
  source?: string;
}

/**
 * 生成 ontology 人类可读视图
 *
 * @param projectDir 项目根目录
 * @returns Markdown 格式的视图字符串
 */
export function generateOntologyView(projectDir: string): string {
  const ontologyDir = join(projectDir, '.sofagent', 'ontology');

  // 检查目录是否存在
  if (!existsSync(ontologyDir)) {
    return [
      'Ontology 尚未初始化。',
      '',
      '> 💡 **如何生成 Ontology？**',
      '>',
      '> Ontology 由 FDE 部署流程自动生成——运行 `sofagent-audit --init` 初始化环境后，',
      '> 在你的 Agent 中输入 `@sofagent-fde` 开始 FDE 部署流程，完成后本目录会自动填充：',
      '>   - `objects.yml` — 实体定义',
      '>   - `actions.yml` — 动作定义',
      '>   - `constraints.yml` — 约束规则',
      '>',
      '> 详细指引见 [docs/HANDBOOK.md](HANDBOOK.md)。',
      '',
    ].join('\n');
  }

  const objectsPath = join(ontologyDir, 'objects.yml');
  const actionsPath = join(ontologyDir, 'actions.yml');
  const constraintsPath = join(ontologyDir, 'constraints.yml');

  // 检查至少一个文件存在
  const hasObjects = existsSync(objectsPath);
  const hasActions = existsSync(actionsPath);
  const hasConstraints = existsSync(constraintsPath);

  if (!hasObjects && !hasActions && !hasConstraints) {
    return [
      'Ontology 目录已存在，但尚未填充数据文件。',
      '',
      '> 💡 运行 FDE 部署流程（`@sofagent-fde`）生成 objects.yml / actions.yml / constraints.yml 后重试。',
      '',
    ].join('\n');
  }

  // 加载各文件
  const objects = hasObjects ? loadYamlFile<OntologyObjectEntry[]>(objectsPath) : [];
  const actions = hasActions ? loadYamlFile<OntologyActionEntry[]>(actionsPath) : [];
  const constraints = hasConstraints ? loadYamlFile<OntologyConstraintEntry[]>(constraintsPath) : [];

  // 生成 Markdown
  const lines: string[] = [];

  lines.push('# Ontology 本体视图');
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 数据目录: \`.sofagent/ontology/\``);
  lines.push('');

  // ── 统计摘要 ──
  lines.push('## 📊 统计摘要');
  lines.push('');
  lines.push(`| 类型 | 数量 |`);
  lines.push(`|------|------|`);
  lines.push(`| 实体 (objects) | ${objects.length} |`);
  lines.push(`| 动作 (actions) | ${actions.length} |`);
  lines.push(`| 约束 (constraints) | ${constraints.length} |`);

  // v1.3.6 · v1.3.7 开发⑥：lifecycle 统计——基线/试验资产分层（能力地图可辨）
  const trunkCount = objects.filter((o) => (o?.lifecycle ?? 'branch') === 'trunk').length;
  const branchCount = objects.length - trunkCount;
  lines.push(`| 🌳 基线资产 (trunk) | ${trunkCount} |`);
  lines.push(`| 🌱 试验资产 (branch) | ${branchCount} |`);
  lines.push('');

  // ── 实体 ──
  if (objects.length > 0) {
    // v1.3.6 · v1.3.7 开发⑥：trunk 在前（基线资产一眼可辨），branch 在后（试验资产不误导复用）
    const sorted = [...objects].sort((a, b) => {
      const la = a?.lifecycle ?? 'branch';
      const lb = b?.lifecycle ?? 'branch';
      if (la === lb) return 0;
      return la === 'trunk' ? -1 : 1;
    });
    lines.push('## 🧩 实体定义 (objects)');
    lines.push('');
    lines.push('> 🌳 trunk = 已审阅合并进组织基线（稳定可复用）· 🌱 branch = 试验中（待审阅，慎复用）');
    lines.push('');

    for (let i = 0; i < sorted.length; i++) {
      const obj = sorted[i];
      if (!obj) continue;
      const lcBadge = (obj.lifecycle ?? 'branch') === 'trunk' ? '🌳 trunk' : '🌱 branch';
      lines.push(`### ${i + 1}. ${obj.name || '(未命名)'} ${lcBadge}`);
      lines.push('');
      if (obj.type) lines.push(`- **类型**: \`${obj.type}\``);
      if (obj.description) lines.push(`- **描述**: ${obj.description}`);
      if (obj.source) lines.push(`- **来源**: \`${obj.source}\``);
      // v1.3.6 · v1.3.7 开发⑥ OKF ②：信任/时效展示
      if (obj.status) lines.push(`- **状态**: \`${obj.status}\``);
      if (obj.stale_after) {
        const stale = new Date(obj.stale_after) <= new Date();
        lines.push(`- **时效**: ${stale ? '⚠️ 已过期' : '有效'}（stale_after: ${obj.stale_after}）`);
      }
      if (obj.verified && obj.verified.length > 0) {
        const latest = obj.verified[obj.verified.length - 1];
        lines.push(`- **验证**: ${latest?.by ?? '?'} @ ${latest?.at ?? '?'}`);
      }

      // 关系
      if (obj.relations && Object.keys(obj.relations).length > 0) {
        lines.push(`- **关系**:`);
        for (const [relType, targets] of Object.entries(obj.relations)) {
          if (Array.isArray(targets) && targets.length > 0) {
            lines.push(`  - ${relType}: ${targets.map((t) => `\`${t}\``).join(', ')}`);
          }
        }
      }
      lines.push('');
    }
  }

  // ── 动作 ──
  if (actions.length > 0) {
    lines.push('## ⚡ 动作定义 (actions)');
    lines.push('');

    for (let i = 0; i < actions.length; i++) {
      const act = actions[i];
      if (!act) continue;
      lines.push(`### ${i + 1}. ${act.name || '(未命名)'}`);
      lines.push('');
      if (act.nodeId) lines.push(`- **节点**: \`${act.nodeId}\``);
      if (act.description) lines.push(`- **描述**: ${act.description}`);
      if (act.source) lines.push(`- **来源**: \`${act.source}\``);

      if (act.constraints && Object.keys(act.constraints).length > 0) {
        lines.push(`- **约束**:`);
        for (const [key, value] of Object.entries(act.constraints)) {
          lines.push(`  - \`${key}\`: ${JSON.stringify(value)}`);
        }
      }
      lines.push('');
    }
  }

  // ── 约束 ──
  if (constraints.length > 0) {
    lines.push('## 🔒 约束规则 (constraints)');
    lines.push('');

    // 按严重程度分组
    const bySeverity = new Map<string, OntologyConstraintEntry[]>();
    for (const c of constraints) {
      if (!c) continue;
      const sev = c.severity || 'info';
      if (!bySeverity.has(sev)) bySeverity.set(sev, []);
      bySeverity.get(sev)!.push(c);
    }

    const severityOrder = ['error', 'warn', 'info'];
    for (const sev of severityOrder) {
      const entries = bySeverity.get(sev);
      if (!entries || entries.length === 0) continue;

      const icon = sev === 'error' ? '🔴' : sev === 'warn' ? '🟡' : '💭';
      lines.push(`### ${icon} ${sev.toUpperCase()}`);
      lines.push('');

      for (const c of entries) {
        const typeTag = c.type ? `[${c.type}]` : '';
        const targetTag = c.target ? ` → \`${c.target}\`` : '';
        lines.push(`- **${typeTag}${targetTag}**: ${c.rule || '(无描述)'}`);
        if (c.source) lines.push(`  - 来源: \`${c.source}\``);
      }
      lines.push('');
    }
  }

  // ── 文件清单 ──
  lines.push('## 📁 数据文件');
  lines.push('');
  if (hasObjects) lines.push(`- \`${objectsPath}\` (${objects.length} 条实体)`);
  if (hasActions) lines.push(`- \`${actionsPath}\` (${actions.length} 条动作)`);
  if (hasConstraints) lines.push(`- \`${constraintsPath}\` (${constraints.length} 条约束)`);
  lines.push('');

  return lines.join('\n');
}

/**
 * 加载 YAML 文件并返回解析后的数据
 */
function loadYamlFile<T>(filePath: string): T {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = yamlLoad(content);
    if (Array.isArray(parsed)) {
      return parsed as unknown as T;
    }
    // 如果是对象，尝试提取常见的数组键
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      for (const key of ['objects', 'actions', 'constraints', 'items', 'entries']) {
        if (Array.isArray(obj[key])) {
          return obj[key] as unknown as T;
        }
      }
    }
    return ([] as unknown) as T;
  } catch (err) {
    if (err instanceof YAMLException) {
      console.warn(`⚠️ YAML 解析错误 (${filePath}): ${err.message}`);
    }
    return ([] as unknown) as T;
  }
}
