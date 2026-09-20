// ============================================================
// builtin-agents.ts · 预装 Agent 定义（v1.5.0）
//
// 4 个内置 Agent 的 systemPrompt 一律来自 SKILL/agents/<name>/SKILL.md
// （Agency Agents 格式）。createReactAgent 启动时读取文件、把 frontmatter
// 字段转成身份标签后连同 body 注入为 system prompt。
//
// 查找顺序（**单一实现** loadAgentMd，四个 Agent 共用）：
//   0. $SOFAGENT_REPO_ROOT/SKILL/agents/<name>/SKILL.md
//   1. $cwd/SKILL/agents/<name>/SKILL.md
//   2. <包相对>/SKILL/agents/<name>/SKILL.md（dist/ 向上三级 = 仓库根）
// 三条全不可达（如 npm 全局安装且未设 SOFAGENT_REPO_ROOT）→ **打印 warn** 后
// 回退到各 Agent 的硬编码精简版（fail-safe + 留痕，不静默降级）。
//
// v1.5.0：迁移至 @sofagent/orchestrator
// v1.5.0 P0-R2: npm 全局安装后 __dirname 不再是仓库内相对位置，
//   包相对路径（多层上级目录拼 SKILL）会失效。新增 SOFAGENT_REPO_ROOT
//   环境变量作为最高优先级解析：git clone 安装场景下显式指定仓库根，
//   即可让 npm 全局安装的 orchestrator 也能加载 SKILL/agents 的 md。
//   优先级：SOFAGENT_REPO_ROOT > cwd 相对路径 > 包相对路径 > fallback。
//
// ⚠️ v1.5.1 K5 · 该逃生门在**安装态结构性不可达**，如实标注（机制保留，口径待裁定）：
//   - `install.sh` / `bootstrap.sh` 对 `SOFAGENT_REPO_ROOT` **零命中**（无导出、无写
//     shell 配置）⇒ 安装后该变量为空；
//   - `engine/orchestrator/package.json` 的 `files` **不含 `SKILL/`** ⇒ 即便设了变量，
//     被安装的包内也没有 `SKILL/agents/` 可读（结构上不可达）。
//   故第 0 级（以及安装态的 1/2 级）实际不生效，安装态恒走 fallback（现已 warn 留痕）。
//   方向待维护者裁定：甲=安装器写入该变量使其可达（属越权写用户 shell 配置，需谨慎）；
//   乙=删除该不可达设计、SKILL 加载统一走包内路径（需与 K2 同批）。**本批不动机制**。
// v1.5.1 K2：此前**同文件两个同职责加载器**（loadAgentMd / loadAgentMdFile）——
//   engineer/reviewer 走 loadAgentMdFile，只查 `FORGE/agents/<name>.md` 与
//   `agents/<name>.md`（两者在本仓**均不存在**），且取不到时直接 `return fallback`
//   无任何 warn ⇒ 这 2 个 Agent 的 systemPrompt **恒走 fallback 且静默**，
//   而真定义 SKILL/agents/<name>/SKILL.md **存在却永远读不到**。
//   现统一到 loadAgentMd 一个实现（FORGE/agents 这条死路径一并删除）。
// ============================================================
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SubAgentDefinition } from './registry';

/**
 * 仓库根目录（SOFAGENT_REPO_ROOT 环境变量，npm 全局安装场景指定源码仓库位置）
 * 未设置时返回 null，回退到 cwd / 包相对路径解析。
 */
function repoRoot(): string | null {
  const root = process.env.SOFAGENT_REPO_ROOT;
  return root !== undefined && root !== '' ? root : null;
}

/**
 * 解析 SKILL.md 为 system prompt
 *
 * 不剥掉 front matter——而是把它的字段转成 Agent 能读懂的身份标签，
 * 和 body 内容一起注入 createReactAgent。
 */
function parseSkillMd(content: string): string {
  const parts = content.split('---');
  if (parts.length < 3) return content.trim();

  const fmRaw = parts[1]!;
  const body = parts.slice(2).join('---').trim();

  // 手工解析 YAML（避免引入 js-yaml 依赖，front matter 格式简单）
  function fmVal(key: string): string {
    const re = new RegExp(`^${key}:\\s*(.*)`, 'm');
    return (fmRaw.match(re) ?? [])[1]?.trim() ?? '';
  }
  // 多行 description 用 `>` 符号
  function fmBlock(key: string): string {
    const re = new RegExp(`^${key}:\\s*>\\n([\\s\\S]*?)(?=^[a-z]|$)`, 'm');
    return ((fmRaw.match(re) ?? [])[1] ?? '').replace(/\n\s+/g, ' ').trim();
  }
  function fmList(key: string): string[] {
    const raw = fmVal(key).replace(/^\[|\]$/g, '');
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  const name = fmVal('name');
  const displayName = fmVal('displayName');
  const desc = fmBlock('description') || fmVal('description');
  const triggers = fmList('triggers');
  const scenarios = fmList('scenarios');
  const notWhen = fmList('not_when');

  // 组装身份标签
  const header = [
    `[Agent: ${name} — ${displayName}]`,
    desc ? `[描述: ${desc}]` : '',
    triggers.length ? `[触发条件: ${triggers.join(', ')}]` : '',
    scenarios.length ? `[适用场景: ${scenarios.join(', ')}]` : '',
    notWhen.length ? `[不适用: ${notWhen.join(', ')}]` : '',
  ].filter(Boolean).join('\n');

  return header + '\n\n' + body;
}

/**
 * 四个内置 Agent **共用的唯一** SKILL 加载器。
 *
 * 查找顺序：SOFAGENT_REPO_ROOT/SKILL/agents/<skillName>/SKILL.md
 *   → cwd/SKILL/agents/<skillName>/SKILL.md
 *   → <包相对>/SKILL/agents/<skillName>/SKILL.md
 *
 * 三条全不可达时**打印 warn 留痕**并返回 fallback（fail-safe，不静默降级）。
 *
 * @param skillName Agent 名（= SKILL/agents/ 下的目录名，如 engineer / reviewer）
 * @param fallback  文件不可达时使用的硬编码精简版 system prompt
 */
function loadAgentMd(skillName: string, fallback: string): string {
  // 路径 0: SOFAGENT_REPO_ROOT/SKILL/agents/<skillName>/SKILL.md（v1.3.2 P0-R2：npm 全局安装场景）
  const root = repoRoot();
  if (root !== null) {
    const repoPath = join(root, 'SKILL', 'agents', skillName, 'SKILL.md');
    if (existsSync(repoPath)) {
      return parseSkillMd(readFileSync(repoPath, 'utf-8'));
    }
  }

  // 路径 1: cwd/SKILL/agents/<skillName>/SKILL.md
  const cwdPath = join(process.cwd(), 'SKILL', 'agents', skillName, 'SKILL.md');
  if (existsSync(cwdPath)) {
    return parseSkillMd(readFileSync(cwdPath, 'utf-8'));
  }

  // 路径 2: 包相对路径/SKILL/agents/<skillName>/SKILL.md
  // 本文件编译后位于 <repo>/engine/orchestrator/dist/，向上三级 = <repo>
  // （此前写四级会上溯到仓库根的父目录，恒不可达且静默回退精简版）
  const pkgPath = join(__dirname, '..', '..', '..', 'SKILL', 'agents', skillName, 'SKILL.md');
  if (existsSync(pkgPath)) {
    return parseSkillMd(readFileSync(pkgPath, 'utf-8'));
  }

  // v1.4.7 批次 I：三条路径全部不可达（npm 全局安装且未设 SOFAGENT_REPO_ROOT 的
  // 安装态大概率如此）——回退精简版显性化，不再静默
  console.warn(
    `[builtin-agents] SKILL/agents 不可达（安装态精简版回退）: ${skillName}——` +
      `已试 ${repoRoot() ?? '(未设 SOFAGENT_REPO_ROOT)'}、${join(process.cwd(), 'SKILL', 'agents')}、${pkgPath}`,
  );
  return fallback;
}

// v1.5.1 K2：原 `loadAgentMdFile`（查 FORGE/agents/<name>.md → agents/<name>.md →
// 包相对路径，取不到时**静默** return fallback）已删除——统一到上方 loadAgentMd。
// 删除理由：① 它查的两条路径在本仓均不存在（`FORGE/agents/`、根 `agents/` 都没有）；
// ② 真定义在 SKILL/agents/<name>/SKILL.md，该加载器**从不查**，导致 engineer/reviewer
// 恒降级且无任何提示；③ 「同职责两个实现」本身就是漂移源（K2 明确要求只留一个）。

// ============================================================
// Agent 定义
// ============================================================

/**
 * FDE 部署工程师
 *
 * systemPrompt 优先加载 `SKILL/agents/fde/SKILL.md`（与实现逐句一致）
 */
const FDE_AGENT: SubAgentDefinition = {
  name: 'fde',
  type: 'development',
  description: '前线部署工程师——梳理企业工作流、识别 AI 节点、构建知识库、交付离场',
  tools: ['read', 'write', 'bash', 'grep', 'glob'],
  mode: 'deploy', // v1.0.8: 默认部署模式，可通过 CLI -mode sustain 切换
  systemPrompt: loadAgentMd(
    'fde',
    // fallback: 精简版（文件找不到时使用）
    `你是部署工程师（FDE），一名精通企业 IT 架构、知识工程和 AI 部署的前线工程师。
你不写应用代码——你的职责是把企业世界的业务规则、组织架构、系统边界，转译成 sofagent 的数据层和约束层。

## 核心使命
离场后，企业留下四样东西：交付手册、在跑的 AI 节点、会自己生长的 AI 知识库、私有化评估体系。

## 四阶段流程
1. 进场阶段——确定场景、盘点平台、建立企业画像
2. 挖掘阶段——梳理工作流（五要素）、构建本体模型、识别 AI 节点
3. 交付阶段——生成配置方案、部署 sofagent 底座、逐节点上线
4. 检查离场——节点全跑通、两周无报错、确认五大能力后离场

## 关键原则
- 先做管理动作，再选 AI 工具——不要上来就聊模型
- 中型客户（专精特新小巨人）是甜点区
- 离场标准不是客户满意，是独立运行
- 对抗性测试必须跑过——大部分企业只测功能不测攻击`
  ),
  modelName: null,
};

/**
 * 合规审计员
 *
 * systemPrompt 优先加载 `SKILL/agents/audit/SKILL.md`（与实现逐句一致）
 */
const AUDIT_AGENT: SubAgentDefinition = {
  name: 'audit',
  type: 'audit',
  description: '系统级合规审计——巡检 Workflow、验证铁律覆盖、检查知识库健康度',
  tools: ['read', 'bash', 'grep'],
  triggerOn: ['on-commit', 'on-schedule'],
  systemPrompt: loadAgentMd(
    'audit',
    // fallback: 精简版
    `你是合规审计员，一名 sofagent 系统级合规审计师。
你不审查代码逻辑（那是 code-reviewer 的事），你审查的是整个 sofagent 部署的系统层面是否合规。

## 审计维度
1. 策略合规——Workflow 节点的 role/rules 完整性 + fde.md 铁律覆盖
2. 访问控制——knowledge-domain 的 include/exclude 配置
3. 变更管理——多仓库 audit 版本一致性
4. 审计日志——history.jsonl 完整性 + think.md 反思规范
5. 数据保护——entity page 死链检测 + index.md 一致性

## 工作方式
- 基于 git diff 的硬证据，不做推测
- 对审计发现分级：P0（安全硬伤）> P1（工程欠债）> P2（改进建议）
- 每条发现附带修复建议和具体文件路径`
  ),
  modelName: null,
};

// ============================================================
// v1.1.3: FORGE 双 Agent（工程师 + 审查员）
// ============================================================

/**
 * 软件工程师（FORGE 代码执行者——最小变更哲学）
 *
 * systemPrompt 优先加载 `SKILL/agents/engineer/SKILL.md`（与实现逐句一致；
 * v1.5.1 K2 前此声明**与代码矛盾**——当时走 loadAgentMdFile，压根不查 SKILL/）
 */
export const ENGINEER_AGENT: SubAgentDefinition = {
  name: 'engineer',
  type: 'development',
  description: '软件工程师——只修复被要求的内容，拒绝范围蔓延，逐行自证差异',
  tools: ['read', 'write', 'bash', 'grep', 'glob'],
  systemPrompt: loadAgentMd(
    'engineer',
    // fallback: 精简版
    `你是最小变更工程师，FORGE 自迭代循环中的代码执行者。
核心原则：只做被要求的事，不多做。价值以"没写的代码行数"来衡量。

## 关键规则
1. 最小可行差异——只修改任务明确要求的内容
2. 拒绝范围蔓延——不改"顺便"看到的问题
3. 宁可三行相似代码，不做过早抽象
4. 逐行自证差异——每次变更都能精确对应到任务要求
5. 先读再改——修改前必须 Read 目标文件`
  ),
  modelName: null,
};

/**
 * 代码审查员（FORGE 审查者）
 *
 * systemPrompt 优先加载 `SKILL/agents/reviewer/SKILL.md`（与实现逐句一致；
 * v1.5.1 K2 前此声明**与代码矛盾**——当时走 loadAgentMdFile，压根不查 SKILL/）
 */
export const REVIEWER_AGENT: SubAgentDefinition = {
  name: 'reviewer',
  type: 'audit',
  description: '代码审查员——提供建设性、可操作的反馈，聚焦正确性、可维护性、安全性和性能',
  tools: ['read', 'bash', 'grep', 'glob'],
  triggerOn: ['on-commit', 'on-review'],
  systemPrompt: loadAgentMd(
    'reviewer',
    // fallback: 精简版
    `你是代码审查员，FORGE 自迭代循环中的审查者。
你不写代码，但你的判定直接影响代码能不能合并。

## 审查维度
1. 正确性——代码是否实现了预期功能？
2. 安全性——是否存在漏洞？输入校验？权限检查？
3. 可维护性——六个月后还能看懂吗？
4. 性能——是否有明显的瓶颈？
5. 测试——关键路径是否有测试覆盖？

## 审查格式
- 🔴 阻塞项（必须修复）——安全漏洞、数据丢失风险、API 契约破坏
- 🟡 建议项（应该修复）——缺少校验、命名不清、重复代码
- 💭 小改进（锦上添花）——风格、文档、替代方案

## 关键规则
- 具体明确——说"第 42 行可能存在 SQL 注入"，而不是"有安全问题"
- 区分意见和事实——标注清楚
- 输出格式：IS_PASS: YES/NO`
  ),
  modelName: null,
};

/** 全部预装 Agent */
export const BUILTIN_AGENTS: SubAgentDefinition[] = [FDE_AGENT, AUDIT_AGENT, ENGINEER_AGENT, REVIEWER_AGENT];
