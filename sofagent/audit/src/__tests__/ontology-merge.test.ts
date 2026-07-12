// ============================================================
// ontology-merge.test.ts · Ontology 合并引擎测试
// v1.0.5 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mergeOntology, checkOntologyStatus } from '../ontology/merge-engine';
import type { MergedOntology } from '../ontology/types';

describe('Ontology Merge Engine', () => {
  let testDir: string;
  let configDir: string;
  let knowledgeDir: string;
  let workflowDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    const testId = `sofagent-onto-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    testDir = join(tmpdir(), testId);
    configDir = join(testDir, '.sofagent');
    knowledgeDir = join(testDir, 'knowledge');
    workflowDir = join(testDir, 'workflows');

    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(knowledgeDir, 'entities'), { recursive: true });
    mkdirSync(workflowDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // ===== 测试 1: 空目录合并 =====
  it('should merge empty directories and return empty result', () => {
    const result = mergeOntology(configDir);

    expect(result).toBeDefined();
    expect(result.objects).toHaveLength(0);
    expect(result.actions).toHaveLength(0);
    expect(result.constraints).toHaveLength(0);
    expect(result.stats.totalObjects).toBe(0);
    expect(result.stats.totalActions).toBe(0);
    expect(result.stats.totalConstraints).toBe(0);

    // 验证三文件均生成
    const ontologyDir = join(testDir, 'ontology');
    expect(existsSync(join(ontologyDir, 'objects.yml'))).toBe(true);
    expect(existsSync(join(ontologyDir, 'actions.yml'))).toBe(true);
    expect(existsSync(join(ontologyDir, 'constraints.yml'))).toBe(true);
  });

  // ===== 测试 2: 提取 entities/ frontmatter relations =====
  it('should extract frontmatter relations from entity files', () => {
    // 创建一个带 frontmatter 的 entity 文件
    const entityContent = `---
title: "FDE Sub Agent"
type: "agent"
relations:
  has_many:
    - "task/logs"
    - "scoring records"
  belongs_to:
    - "FDE deployment"
  depends_on:
    - "DeepAgentsJS"
---

# FDE Sub Agent

This is a test entity page.
`;
    writeFileSync(join(knowledgeDir, 'entities', 'fde-sub-agent.md'), entityContent, 'utf-8');

    // 创建第二个 entity
    const entity2Content = `---
title: "Audit Engine"
type: "engine"
relations:
  produces:
    - "history.jsonl"
    - "think.md"
  consumes:
    - "git diff"
---

# Audit Engine

This is the audit engine entity.
`;
    writeFileSync(join(knowledgeDir, 'entities', 'audit-engine.md'), entity2Content, 'utf-8');

    const result = mergeOntology(configDir);

    expect(result.objects).toHaveLength(2);
    expect(result.stats.totalObjects).toBe(2);

    const fdeAgent = result.objects.find((o) => o.name === 'FDE Sub Agent')!;
    expect(fdeAgent).toBeDefined();
    expect(fdeAgent.type).toBe('agent');
    expect(fdeAgent.relations.has_many).toContain('task/logs');
    expect(fdeAgent.relations.belongs_to).toContain('FDE deployment');
    expect(fdeAgent.relations.depends_on).toContain('DeepAgentsJS');

    const auditEngine = result.objects.find((o) => o.name === 'Audit Engine')!;
    expect(auditEngine.relations.produces).toContain('history.jsonl');
    expect(auditEngine.relations.consumes).toContain('git diff');
  });

  // ===== 测试 3: 提取 workflow actions =====
  it('should extract actions from workflow.yml', () => {
    const workflowContent = `nodes:
  - id: "invoice-receive"
    actions:
      - "scan_invoice"
      - "validate_format"
    constraints:
      maxRetries: 3
  - id: "approval-route"
    actions:
      - "approve"
      - "reject"
      - "escalate"
`;
    writeFileSync(join(workflowDir, 'workflow.yml'), workflowContent, 'utf-8');

    const result = mergeOntology(configDir);

    expect(result.actions).toHaveLength(5);
    expect(result.stats.totalActions).toBe(5);

    const scanInvoice = result.actions.find((a) => a.name === 'scan_invoice')!;
    expect(scanInvoice).toBeDefined();
    expect(scanInvoice.nodeId).toBe('invoice-receive');

    const approve = result.actions.find((a) => a.name === 'approve')!;
    expect(approve.nodeId).toBe('approval-route');
  });

  // ===== 测试 4: 提取 constraints =====
  it('should extract knowledgeDomain constraints from workflow', () => {
    // 需要用 orchestrator/workflows/ 路径（merge-engine 的备选路径）
    const orchWorkflowDir = join(testDir, 'orchestrator', 'workflows');
    mkdirSync(orchWorkflowDir, { recursive: true });

    const workflowContent = `nodes:
  - id: "invoice-receive"
    knowledgeDomain:
      include:
        - "finance"
        - "suppliers"
      exclude:
        - "hr"
    rateLimit: "10/minute"
  - id: "approval-route"
    knowledgeDomain:
      include:
        - "approvals"
`;
    writeFileSync(join(orchWorkflowDir, 'workflow.yml'), workflowContent, 'utf-8');

    const result = mergeOntology(configDir);

    expect(result.constraints.length).toBeGreaterThanOrEqual(3);
    expect(result.stats.totalConstraints).toBeGreaterThanOrEqual(3);

    const includeConstraint = result.constraints.find(
      (c) => c.type === 'domain_access' && c.target === 'invoice-receive' && c.rule.includes('finance')
    );
    expect(includeConstraint).toBeDefined();

    const rateConstraint = result.constraints.find((c) => c.type === 'rate_limit');
    expect(rateConstraint).toBeDefined();
    expect(rateConstraint!.target).toBe('invoice-receive');
    expect(rateConstraint!.rule).toBe('10/minute');
  });

  // ===== 测试 5: checkOntologyStatus =====
  it('should report ontology status correctly', () => {
    // 空目录应该返回不存在
    const statusBefore = checkOntologyStatus(configDir);
    expect(statusBefore.exists).toBe(false);

    // 合并后应该存在
    mergeOntology(configDir);
    const statusAfter = checkOntologyStatus(configDir);
    expect(statusAfter.exists).toBe(true);
    expect(statusAfter.fresh).toBe(true);
  });

  // ===== 测试 6: 处理不带 frontmatter 的 entity 文件 =====
  it('should skip entity files without frontmatter', () => {
    writeFileSync(join(knowledgeDir, 'entities', 'no-fm.md'), '# Just a heading\n\nNo frontmatter here.', 'utf-8');

    const result = mergeOntology(configDir);
    expect(result.objects).toHaveLength(0);
  });

  // ===== 测试 7: 处理没有 actions 的 workflow 节点 =====
  it('should handle workflow nodes without actions', () => {
    const workflowContent = `nodes:
  - id: "node-without-actions"
    prompt: "do something"
  - id: "node-with-actions"
    actions:
      - "deploy"
`;
    writeFileSync(join(workflowDir, 'workflow.yml'), workflowContent, 'utf-8');

    const result = mergeOntology(configDir);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.name).toBe('deploy');
  });
});
