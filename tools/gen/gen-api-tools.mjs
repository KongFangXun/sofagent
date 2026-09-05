#!/usr/bin/env node
// ============================================================
// gen-api-tools.mjs · docs/API.md 第二节生成器
// 从 engine/mcp/src/tool-registry.ts 提取全部 tool 的
// name + description，按域分组重写 API.md 的工具清单节。
//
// 用法：node tools/gen/gen-api-tools.mjs
// 门禁：tools/check/check-docs.sh 断言「文档 tool 数 == registry 实数」
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = join(REPO_ROOT, 'engine', 'mcp', 'src', 'tool-registry.ts');
const API_DOC = join(REPO_ROOT, 'docs', 'API.md');

/** 域分组：面向使用者的产品能力域（非内部五模块编制——那是工程视角，API.md 是用户视角）。
 *  分组粗细原则：每组对应一个可独立讲述的产品能力，组数 10 左右，不挤大桶不散碎片。
 *  与五能力叙事的对应关系见 API.md 第二节引言（注入能力走加载链文件，不经 MCP 暴露）。
 *  roles 列保留运行时真值（SOFAGENT_MCP_ROLES 收窄面口径），分组是文档编制判断。
 *  显式映射表：新工具未列出即生成器报错——强制维护者拍板分组。 */
const GROUP_ORDER = ['fde', 'audit', 'workflow', 'org', 'snapshot', 'train', 'eval', 'knowledge', 'commons', 'ops'];
const GROUP_NAMES = {
  fde: 'FDE 进场 · 六引擎（访谈 → 分类 → 量化 → 推导 → 沉淀 → 部署）',
  audit: '审计与合规（代码 / 轨迹 / 数据审计 · 浏览器取证 · 语料导出）',
  workflow: '业务流编排（workflow DAG · 循环执行与优化）',
  org: 'Agent 组织与协作（数字员工 · 团队阵型 · HITL 人工介入）',
  snapshot: '快照与回溯（状态留档 · 回滚恢复）',
  train: '后训练流水线（数据回流 → 训练 → 模型注册晋升）',
  eval: '评估与验收（基准评测 · 验收标准 · A/B 对比）',
  knowledge: '本体数据与知识资产（ontology · 实体概念 · 知识库 · 反思）',
  commons: '组织能力市场（发布 · 检索 · 调用 · 评分 · 退役）',
  ops: '运维与可见性（成本 · 工作明细 · 健康 · 规则 · 能力发现）',
};

/** tool → 能力域显式映射（83 个 · 新增工具必须在此拍板归组，否则生成器 fail） */
const NAME_TO_MODULE = {
  // FDE 六引擎
  fde_interview: 'fde', fde_classify: 'fde', fde_quantify: 'fde',
  fde_derive: 'fde', fde_distill: 'fde', fde_deploy: 'fde',
  // 审计与合规
  run_audit: 'audit', audit_file: 'audit', audit_trail: 'audit', audit_data_change: 'audit',
  corpus_export: 'audit',
  playwright_navigate: 'audit', playwright_click: 'audit',
  playwright_screenshot: 'audit', playwright_assert: 'audit',
  // 业务流编排
  activate_workflow: 'workflow', workflow_submit: 'workflow', route_workflow: 'workflow',
  sofagent_compose: 'workflow', fde_compose: 'workflow', loop_debug: 'workflow',
  refine: 'workflow', optimize_skill: 'workflow',
  // Agent 组织与协作
  create_agent: 'org', list_agents: 'org', agent_identity: 'org',
  team_create: 'org', team_broadcast: 'org',
  hitl_resolve: 'org', notify_session: 'org',
  // 快照与回溯
  snapshot_list: 'snapshot', snapshot_restore: 'snapshot',
  // 后训练流水线
  train_budget: 'train', train_submit: 'train', train_doctor: 'train', train_dryrun: 'train',
  train_report: 'train', train_status: 'train', train_list: 'train', train_diagnose: 'train',
  model_register: 'train', model_switch: 'train', model_unregister: 'train',
  // v1.4.5：推理服务（serve）/ 合规扫描（compliance）/ FDE 交付包（deliverable）
  train_serve: 'train', train_compliance: 'train', train_deliverable: 'train',
  // 评估与验收
  evaluate: 'eval', evaluate_output: 'eval', eval_suite: 'eval',
  define_acceptance: 'eval', check_acceptance: 'eval',
  run_ab_test: 'eval', promote_ab: 'eval',
  // 本体数据与知识资产
  ontology_import: 'knowledge', validate_ontology: 'knowledge',
  create_entity: 'knowledge', read_entity: 'knowledge', update_entity: 'knowledge',
  delete_entity: 'knowledge', list_entities: 'knowledge',
  create_concept: 'knowledge', read_concept: 'knowledge',
  delete_concept: 'knowledge', list_concepts: 'knowledge',
  search_knowledge: 'knowledge', read_lessons: 'knowledge',
  get_think: 'knowledge', write_think: 'knowledge', read_think_md: 'knowledge',
  // 组织能力市场
  commons_publish: 'commons', commons_search: 'commons', commons_invoke: 'commons',
  commons_rate: 'commons', commons_retire: 'commons', commons_harvest_rule: 'commons',
  // 运维与可见性
  stats: 'ops', cost_query: 'ops', worklog_query: 'ops',
  daemon_status: 'ops', health_check: 'ops', list_rules: 'ops',
  data_sovereignty_report: 'ops', list_capabilities: 'ops',
};

const src = readFileSync(REGISTRY, 'utf8');
// 块级提取：name + roles（可选）+ description
const blockRe = /\{\s*(?:\/\/[^\n]*\n\s*)*name: '([^']+)',((?:\s*(?:\/\/[^\n]*\n)?\s*(?:roles: \[[^\]]*\],)?\s*)*?)\s*(?:\/\/[^\n]*\n\s*)*description: '((?:[^'\\]|\\.)*)'/g;
const tools = [];
let m;
while ((m = blockRe.exec(src)) !== null) {
  const rolesMatch = m[2].match(/roles: \[([^\]]*)\]/);
  const roles = rolesMatch ? rolesMatch[1].split(',').map(s => s.trim().replace(/'/g, '')) : [];
  tools.push({ name: m[1], roles, desc: m[3].replace(/\\n/g, ' ').replace(/'/g, '') });
}

if (tools.length === 0) {
  console.error('[gen-api-tools] 提取 0 个 tool——registry 格式变更？中止不写。');
  process.exit(1);
}

// 映射完整性校验：registry 有而映射表没有的 tool → 报错强制拍板
const unmapped = tools.filter(t => !NAME_TO_MODULE[t.name]).map(t => t.name);
if (unmapped.length > 0) {
  console.error('[gen-api-tools] 以下 tool 未在 NAME_TO_MODULE 拍板模块归属：\n  ' + unmapped.join('\n  '));
  console.error('按 ARCHITECTURE「功能编制」五模块归组后重跑。');
  process.exit(1);
}

const grouped = {};
for (const t of tools) {
  const key = NAME_TO_MODULE[t.name];
  (grouped[key] = grouped[key] || []).push(t);
}

let section = '';
for (const g of GROUP_ORDER) {
  const list = grouped[g] || [];
  if (list.length === 0) continue; // 空组不显示（执行模块 v1.5.3 交付后自然出现）
  section += `\n### ${GROUP_NAMES[g]}（${list.length}）\n\n| tool | roles | 说明 |\n|---|---|---|\n`;
  for (const t of list) section += `| \`${t.name}\` | ${t.roles.join(', ') || '—'} | ${t.desc} |\n`;
}

const doc = readFileSync(API_DOC, 'utf8');
const START = '\n## 二、MCP 工具清单';
const END = '\n---\n\n## 三、防漂移机制';
const i = doc.indexOf(START);
const j = doc.indexOf(END);
if (i === -1 || j === -1) {
  console.error('[gen-api-tools] API.md 锚点（二/三节标题）未找到——文档结构变更？中止不写。');
  process.exit(1);
}
const updated =
  doc.slice(0, i) +
  `${START}（${tools.length} · 按产品能力域分组）\n\n> 十个能力域按「一个组 = 一个可独立讲述的产品能力」划分，与五能力叙事的对应：本节工具承载其中的**审计**（审计与合规）、**回溯**（快照与回溯）、**沉淀**（知识资产与能力市场）、**进化**（后训练流水线与 FDE 沉淀）能力面；**注入**能力走加载链文件（SKILL.md/fde.md/think.md/knowledge/），不经 MCP 暴露。**roles 列保留运行时真值**——\`SOFAGENT_MCP_ROLES=audit,ops\` 收窄面以 roles 为准（v1.4.0 工具角色分层），分组是文档编制判断。浏览器四件套（playwright_*）归审计域——主叙事是 UI 层审计取证（v1.5.2 UI 审计的执行底座）。\n` +
  section +
  doc.slice(j);
writeFileSync(API_DOC, updated);
console.log(`[gen-api-tools] OK：${tools.length} tools 写入 docs/API.md 第二节`);
