// ============================================================
// activate.test.ts · 激活链 Phase 1 单测 (v1.2.8)
// ============================================================
//
// 覆盖（§6.3）：
// - 正常激活（🔄 + ⚡ 混合节点）
// - dry-run 模式（不写文件）
// - node-filter 过滤
// - 👤 节点跳过
// - 缺失字段降级（缺 agent / 缺 actions / 缺 hitl）
// - YML 输出格式校验（loadDefinition 能解析核心字段）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { load as yamlLoad } from 'js-yaml';

import { activateWorkflow } from '../activate';
import { loadDefinition } from '../registry';

// ============================================================
// 测试辅助——创建 FDE 交付物目录结构
// ============================================================

interface TestSetup {
  dataDir: string;
  workflowPath: string;
  skillsDir: string;
  entitiesDir: string;
  subagentsDir: string;
}

/**
 * 创建 FDE 交付物结构：
 *   dataDir/
 *     data/
 *       workflow.yml
 *       skills/<category>/SKILL.md
 *       entities/<category>.md
 *     subagents/           ← activate 输出目录
 */
function createFdeStructure(dataDir: string): TestSetup {
  const dataSubDir = join(dataDir, 'data');
  const skillsDir = join(dataSubDir, 'skills');
  const entitiesDir = join(dataSubDir, 'entities');
  const subagentsDir = join(dataDir, 'subagents');

  mkdirSync(dataSubDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(entitiesDir, { recursive: true });

  return {
    dataDir,
    workflowPath: join(dataSubDir, 'workflow.yml'),
    skillsDir,
    entitiesDir,
    subagentsDir,
  };
}

/** 写入 workflow.yml */
function writeWorkflow(dataDir: string, content: string): void {
  writeFileSync(join(dataDir, 'data', 'workflow.yml'), content, 'utf-8');
}

/** 写入 SKILL.md（含 frontmatter + body） */
function writeSkill(dataDir: string, category: string, body: string): void {
  const skillDir = join(dataDir, 'data', 'skills', category);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${category}\ndisplayName: ${category}技能\ndescription: ${category}岗位技能\n---\n\n${body}`,
    'utf-8',
  );
}

/** 写入 entity.md（含 knowledge_domain frontmatter） */
function writeEntity(dataDir: string, name: string, include: string[], exclude: string[]): void {
  const entityDir = join(dataDir, 'data', 'entities');
  mkdirSync(entityDir, { recursive: true });
  writeFileSync(
    join(entityDir, `${name}.md`),
    `---\nname: ${name}\nknowledge_domain:\n  include: [${include.join(', ')}]\n  exclude: [${exclude.join(', ')}]\n---\n\n${name}实体内容`,
    'utf-8',
  );
}

// ============================================================
// 标准测试 workflow.yml（🔄 + ⚡ 混合）
// ============================================================

const STANDARD_WORKFLOW = `name: 制造企业核心业务流
description: 从接单到回款的完整流程
nodes:
  - id: customer-intake
    name: 客户接单
    type: 🔄
    agent: enterprise
    skill_ref: skills/客户管理/SKILL.md
    entity_ref: entities/客户管理.md
    task: "接收客户订单，校验客户信息，生成内部订单号"
    depends_on: []
    actions: [read, write]
    knowledge_domain:
      include: [客户信息, 订单格式, 客户信用等级]
      exclude: [其他客户数据]
    hitl: false

  - id: production-scheduling
    name: 生产排程
    type: ⚡
    agent: enterprise
    skill_ref: skills/生产排程/SKILL.md
    entity_ref: entities/生产排程.md
    task: "根据订单生成生产排程方案，人工确认后下发车间"
    depends_on: [customer-intake]
    actions: [read, write, bash]
    knowledge_domain:
      include: [产能数据, 工艺路线, 排程规则]
      exclude: [客户隐私数据]
    hitl: true
    hitl_config:
      interrupt_before: true
      prompt: "请确认以下排程方案是否可执行："
`;

// ============================================================
// 测试用例
// ============================================================

describe('activateWorkflow', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sofagent-activate-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // ════════════════════════════════════════
  // 正常激活（🔄 + ⚡ 混合节点）
  // ════════════════════════════════════════

  describe('正常激活', () => {
    it('🔄 + ⚡ 混合节点都能正确激活', async () => {
      const setup = createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '## 客户管理技能\n\n1. 校验客户信息\n2. 生成订单号');
      writeSkill(tmpDir, '生产排程', '## 生产排程技能\n\n1. 分析产能\n2. 生成排程');
      writeEntity(tmpDir, '客户管理', ['客户信息', '订单格式'], ['其他客户数据']);
      writeEntity(tmpDir, '生产排程', ['产能数据', '工艺路线'], ['客户隐私数据']);

      const result = await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      expect(result.registeredAgents).toContain('customer-intake');
      expect(result.registeredAgents).toContain('production-scheduling');
      expect(result.registeredAgents.length).toBe(2);

      // 🔄 = auto + hitl=false
      // ⚡ = assist + hitl=true
      expect(result.hitlNodes).toContain('production-scheduling');
      expect(result.hitlNodes).not.toContain('customer-intake');
    });

    it('🔄 节点 type=auto + hitl=false', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '技能正文');
      writeSkill(tmpDir, '生产排程', '技能正文');
      writeEntity(tmpDir, '客户管理', ['信息'], []);
      writeEntity(tmpDir, '生产排程', ['数据'], []);

      const result = await activateWorkflow({ dataDir: tmpDir, dryRun: true });

      // 检查 YML 文件（dry-run 不写，但 result 内容正确）
      expect(result.hitlNodes).not.toContain('customer-intake');
      expect(result.hitlNodes).toContain('production-scheduling');
    });

    it('写入 subagents/*.yml 到 dataDir/subagents/（非 data/data/subagents/）', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '技能正文');
      writeSkill(tmpDir, '生产排程', '技能正文');
      writeEntity(tmpDir, '客户管理', ['信息'], []);
      writeEntity(tmpDir, '生产排程', ['数据'], []);

      await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      // 输出在 dataDir/subagents/，不在 dataDir/data/subagents/
      expect(existsSync(join(tmpDir, 'subagents', 'customer-intake.yml'))).toBe(true);
      expect(existsSync(join(tmpDir, 'subagents', 'production-scheduling.yml'))).toBe(true);
      expect(existsSync(join(tmpDir, 'data', 'subagents'))).toBe(false);
    });
  });

  // ════════════════════════════════════════
  // dry-run 模式
  // ════════════════════════════════════════

  describe('dry-run 模式', () => {
    it('dryRun=true 不写文件', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '技能正文');
      writeSkill(tmpDir, '生产排程', '技能正文');
      writeEntity(tmpDir, '客户管理', ['信息'], []);
      writeEntity(tmpDir, '生产排程', ['数据'], []);

      const result = await activateWorkflow({ dataDir: tmpDir, dryRun: true });

      // result 仍然返回正确的 registeredAgents
      expect(result.registeredAgents.length).toBe(2);

      // 但没有写文件
      expect(existsSync(join(tmpDir, 'subagents', 'customer-intake.yml'))).toBe(false);
      expect(existsSync(join(tmpDir, 'subagents', 'production-scheduling.yml'))).toBe(false);
      expect(existsSync(join(tmpDir, 'subagents'))).toBe(false);
    });
  });

  // ════════════════════════════════════════
  // node-filter 过滤
  // ════════════════════════════════════════

  describe('node-filter 过滤', () => {
    it('nodeFilter 只激活指定节点', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '技能正文');
      writeSkill(tmpDir, '生产排程', '技能正文');
      writeEntity(tmpDir, '客户管理', ['信息'], []);
      writeEntity(tmpDir, '生产排程', ['数据'], []);

      const result = await activateWorkflow({
        dataDir: tmpDir,
        dryRun: false,
        nodeFilter: ['customer-intake'],
      });

      expect(result.registeredAgents).toContain('customer-intake');
      expect(result.registeredAgents).not.toContain('production-scheduling');
      expect(result.registeredAgents.length).toBe(1);

      expect(existsSync(join(tmpDir, 'subagents', 'customer-intake.yml'))).toBe(true);
      expect(existsSync(join(tmpDir, 'subagents', 'production-scheduling.yml'))).toBe(false);
    });

    it('nodeFilter 多个节点', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '技能正文');
      writeSkill(tmpDir, '生产排程', '技能正文');
      writeEntity(tmpDir, '客户管理', ['信息'], []);
      writeEntity(tmpDir, '生产排程', ['数据'], []);

      const result = await activateWorkflow({
        dataDir: tmpDir,
        dryRun: false,
        nodeFilter: ['customer-intake', 'production-scheduling'],
      });

      expect(result.registeredAgents.length).toBe(2);
    });
  });

  // ════════════════════════════════════════
  // 👤 节点跳过
  // ════════════════════════════════════════

  describe('👤 节点跳过', () => {
    it('type=👤 的节点被跳过并记录原因', async () => {
      const setup = createFdeStructure(tmpDir);
      const workflowWithHuman = `name: 含人工节点的流程
nodes:
  - id: auto-step
    name: 自动步骤
    type: 🔄
    skill_ref: skills/auto/SKILL.md
    entity_ref: entities/auto.md
    task: "自动执行"
    actions: [read]
  - id: human-step
    name: 人工审核
    type: 👤
    task: "人工审核结果"
`;
      writeWorkflow(tmpDir, workflowWithHuman);
      writeSkill(tmpDir, 'auto', '自动技能');
      writeEntity(tmpDir, 'auto', ['数据'], []);

      const result = await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      expect(result.registeredAgents).toContain('auto-step');
      expect(result.registeredAgents).not.toContain('human-step');

      expect(result.skippedNodes.length).toBe(1);
      expect(result.skippedNodes[0]!.name).toBe('human-step');
      expect(result.skippedNodes[0]!.reason).toContain('人工节点');
    });
  });

  // ════════════════════════════════════════
  // 缺失字段降级处理
  // ════════════════════════════════════════

  describe('缺失字段降级', () => {
    it('缺 agent → 默认 enterprise（不影响 type 映射）', async () => {
      createFdeStructure(tmpDir);
      const workflow = `name: 无 agent 字段
nodes:
  - id: no-agent-node
    name: 无 agent 节点
    type: 🔄
    skill_ref: skills/test/SKILL.md
    task: "测试任务"
    actions: [read]
`;
      writeWorkflow(tmpDir, workflow);
      writeSkill(tmpDir, 'test', '技能正文');
      writeEntity(tmpDir, 'test', [], []);

      const result = await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      expect(result.registeredAgents).toContain('no-agent-node');
      // agent 字段不影响激活——type=🔄 正确映射为 auto
      expect(result.skippedNodes.length).toBe(0);
    });

    it('缺 actions → 默认 [read] → tools=[Read,Glob,Grep]', async () => {
      createFdeStructure(tmpDir);
      const workflow = `name: 无 actions 字段
nodes:
  - id: no-actions-node
    name: 无 actions 节点
    type: 🔄
    skill_ref: skills/test/SKILL.md
    task: "测试任务"
`;
      writeWorkflow(tmpDir, workflow);
      writeSkill(tmpDir, 'test', '技能正文');
      writeEntity(tmpDir, 'test', [], []);

      await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      const ymlPath = join(tmpDir, 'subagents', 'no-actions-node.yml');
      expect(existsSync(ymlPath)).toBe(true);
      const content = readFileSync(ymlPath, 'utf-8');
      const parsed = yamlLoad(content) as Record<string, unknown>;
      expect(parsed['tools']).toEqual(['Read', 'Glob', 'Grep']);
    });

    it('缺 hitl → 根据 type 推断（⚡=true, 🔄=false）', async () => {
      createFdeStructure(tmpDir);
      const workflow = `name: 无 hitl 字段
nodes:
  - id: auto-no-hitl
    name: 自动无 hitl
    type: 🔄
    skill_ref: skills/a/SKILL.md
    task: "auto"
    actions: [read]
  - id: assist-no-hitl
    name: 强化无 hitl
    type: ⚡
    skill_ref: skills/b/SKILL.md
    task: "assist"
    actions: [read]
`;
      writeWorkflow(tmpDir, workflow);
      writeSkill(tmpDir, 'a', '技能');
      writeSkill(tmpDir, 'b', '技能');
      writeEntity(tmpDir, 'a', [], []);
      writeEntity(tmpDir, 'b', [], []);

      const result = await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      // 🔄 缺 hitl → false
      expect(result.hitlNodes).not.toContain('auto-no-hitl');
      // ⚡ 缺 hitl → true
      expect(result.hitlNodes).toContain('assist-no-hitl');
    });

    it('缺 knowledge_domain → 空 include/exclude', async () => {
      createFdeStructure(tmpDir);
      const workflow = `name: 无 knowledge_domain
nodes:
  - id: no-kd-node
    name: 无知识域节点
    type: 🔄
    skill_ref: skills/test/SKILL.md
    task: "test"
    actions: [read]
`;
      writeWorkflow(tmpDir, workflow);
      writeSkill(tmpDir, 'test', '技能正文');
      // 不写 entity 文件

      await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      const ymlPath = join(tmpDir, 'subagents', 'no-kd-node.yml');
      const content = readFileSync(ymlPath, 'utf-8');
      const parsed = yamlLoad(content) as Record<string, unknown>;
      const prompt = parsed['systemPrompt'] as string;
      // 空 knowledge_domain → systemPrompt 包含"无限制"
      expect(prompt).toContain('无限制');
    });
  });

  // ════════════════════════════════════════
  // YML 输出格式校验
  // ════════════════════════════════════════

  describe('YML 输出格式校验', () => {
    it('loadDefinition 能正确解析 activate 输出的 YML 核心字段', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '客户管理技能正文');
      writeSkill(tmpDir, '生产排程', '生产排程技能正文');
      writeEntity(tmpDir, '客户管理', ['客户信息'], ['其他客户数据']);
      writeEntity(tmpDir, '生产排程', ['产能数据'], ['客户隐私数据']);

      await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      const ymlPath = join(tmpDir, 'subagents', 'customer-intake.yml');
      const def = loadDefinition(ymlPath);

      expect(def).not.toBeNull();
      expect(def!.name).toBe('customer-intake');
      expect(def!.description).toContain('接收客户订单');
      expect(def!.tools.length).toBeGreaterThan(0);
      expect(def!.systemPrompt.length).toBeGreaterThan(0);
      expect(def!.modelName).toBeNull();
    });

    it('YML 包含 displayName 和 hitl 字段（v1.2.6 预留）', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '技能');
      writeSkill(tmpDir, '生产排程', '技能');
      writeEntity(tmpDir, '客户管理', [], []);
      writeEntity(tmpDir, '生产排程', [], []);

      await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      const ciYml = readFileSync(join(tmpDir, 'subagents', 'customer-intake.yml'), 'utf-8');
      const ciParsed = yamlLoad(ciYml) as Record<string, unknown>;
      expect(ciParsed['displayName']).toBe('客户接单');
      expect(ciParsed['hitl']).toBe(false);
      expect(ciParsed['mode']).toBe('deploy');

      const psYml = readFileSync(join(tmpDir, 'subagents', 'production-scheduling.yml'), 'utf-8');
      const psParsed = yamlLoad(psYml) as Record<string, unknown>;
      expect(psParsed['displayName']).toBe('生产排程');
      expect(psParsed['hitl']).toBe(true);
      expect(psParsed['hitlConfig']).toBeDefined();
    });

    it('tools 映射正确——actions=[read,write,bash] → [Read,Glob,Grep,Write,Edit,Bash]', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '技能');
      writeSkill(tmpDir, '生产排程', '技能');
      writeEntity(tmpDir, '客户管理', [], []);
      writeEntity(tmpDir, '生产排程', [], []);

      await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      const psYml = readFileSync(join(tmpDir, 'subagents', 'production-scheduling.yml'), 'utf-8');
      const psParsed = yamlLoad(psYml) as Record<string, unknown>;
      const tools = psParsed['tools'] as string[];
      expect(tools).toContain('Read');
      expect(tools).toContain('Glob');
      expect(tools).toContain('Grep');
      expect(tools).toContain('Write');
      expect(tools).toContain('Edit');
      expect(tools).toContain('Bash');
    });

    it('systemPrompt 包含 [Agent: ...] 身份标签 + 知识域约束', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '## 客户管理技能\n1. 校验客户');
      writeSkill(tmpDir, '生产排程', '## 排程技能');
      writeEntity(tmpDir, '客户管理', ['客户信息', '订单格式'], ['其他客户数据']);
      writeEntity(tmpDir, '生产排程', ['产能数据'], ['客户隐私数据']);

      await activateWorkflow({ dataDir: tmpDir, dryRun: false });

      const yml = readFileSync(join(tmpDir, 'subagents', 'customer-intake.yml'), 'utf-8');
      const parsed = yamlLoad(yml) as Record<string, unknown>;
      const prompt = parsed['systemPrompt'] as string;

      expect(prompt).toContain('[Agent: customer-intake — 客户接单]');
      expect(prompt).toContain('客户管理技能');
      expect(prompt).toContain('客户信息');
      expect(prompt).toContain('其他客户数据');
    });
  });

  // ════════════════════════════════════════
  // 拓扑描述
  // ════════════════════════════════════════

  describe('拓扑描述', () => {
    it('workflowGraph 包含工作流名称和节点信息', async () => {
      createFdeStructure(tmpDir);
      writeWorkflow(tmpDir, STANDARD_WORKFLOW);
      writeSkill(tmpDir, '客户管理', '技能');
      writeSkill(tmpDir, '生产排程', '技能');
      writeEntity(tmpDir, '客户管理', [], []);
      writeEntity(tmpDir, '生产排程', [], []);

      const result = await activateWorkflow({ dataDir: tmpDir, dryRun: true });

      expect(result.workflowGraph).toContain('制造企业核心业务流');
      expect(result.workflowGraph).toContain('customer-intake');
      expect(result.workflowGraph).toContain('production-scheduling');
    });
  });

  // ════════════════════════════════════════
  // 错误处理
  // ════════════════════════════════════════

  describe('错误处理', () => {
    it('workflow.yml 不存在时抛出错误', async () => {
      createFdeStructure(tmpDir);
      // 不写 workflow.yml

      await expect(
        activateWorkflow({ dataDir: tmpDir, dryRun: false }),
      ).rejects.toThrow('workflow.yml 不存在');
    });

    it('workflow.yml 格式损坏时抛出错误', async () => {
      createFdeStructure(tmpDir);
      writeFileSync(join(tmpDir, 'data', 'workflow.yml'), '{{{invalid yaml', 'utf-8');

      await expect(
        activateWorkflow({ dataDir: tmpDir, dryRun: false }),
      ).rejects.toThrow();
    });
  });
});
