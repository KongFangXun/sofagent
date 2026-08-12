// enterprise-graph.test.ts · 企业编排图构建单测
// v1.2.9 新建 · 功能 ⑥

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildEnterpriseStateGraph,
  buildStateGraphConfig,
  type EnterpriseComposeInput,
} from '../enterprise-graph';
import { readEntity, writeEntity, listEntities, type OntologyEntity } from '../entity-store';
import { parseWorkflowYaml } from '../workflow-parser';

// ── 测试用 workflow.yml ──────────────────────────────

const SAMPLE_WORKFLOW_YML = `
workflow:
  name: enterprise-demo
  description: 企业编排示例
  nodes:
    - id: node-a
      agent: developer
      task: 实现功能 A
      depends_on: []
    - id: node-b
      agent: qa-engineer
      task: 测试功能 A
      depends_on: [node-a]
    - id: node-c
      agent: developer
      task: 实现功能 B
      depends_on: [node-a]
    - id: node-d
      agent: qa-engineer
      task: 测试功能 B
      depends_on: [node-c]
`;

describe('enterprise-graph', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'enterprise-graph-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  describe('buildEnterpriseStateGraph', () => {
    it('从 workflow.yml 构建合法 StateGraph 配置', async () => {
      const ymlPath = join(tmpDir, 'workflow.yml');
      writeFileSync(ymlPath, SAMPLE_WORKFLOW_YML);

      const input: EnterpriseComposeInput = {
        workflowYmlPath: ymlPath,
        dataDir: tmpDir,
      };

      const result = await buildEnterpriseStateGraph(input);

      expect(result).not.toBeNull();
      expect(result!.workflow.name).toBe('enterprise-demo');
      expect(result!.workflow.nodes).toHaveLength(4);
      expect(result!.subagents).toHaveLength(4);
      expect(result!.graph.nodes).toHaveLength(4);
    });

    it('不调 LLM 拆任务——直接用 workflow.yml', async () => {
      const ymlPath = join(tmpDir, 'workflow.yml');
      writeFileSync(ymlPath, SAMPLE_WORKFLOW_YML);

      const result = await buildEnterpriseStateGraph({
        workflowYmlPath: ymlPath,
        dataDir: tmpDir,
      });

      // 节点直接来自 YAML，不是 LLM 生成的
      expect(result!.graph.nodes.map((n) => n.id)).toEqual([
        'node-a', 'node-b', 'node-c', 'node-d',
      ]);
    });

    it('DAG 边正确构建（按 depends_on）', async () => {
      const ymlPath = join(tmpDir, 'workflow.yml');
      writeFileSync(ymlPath, SAMPLE_WORKFLOW_YML);

      const result = await buildEnterpriseStateGraph({
        workflowYmlPath: ymlPath,
        dataDir: tmpDir,
      });

      const edges = result!.graph.edges;
      // __START__ → node-a（入口节点）
      expect(edges.some((e) => e.from === '__START__' && e.to === 'node-a')).toBe(true);
      // node-a → node-b
      expect(edges.some((e) => e.from === 'node-a' && e.to === 'node-b')).toBe(true);
      // node-a → node-c
      expect(edges.some((e) => e.from === 'node-a' && e.to === 'node-c')).toBe(true);
      // node-c → node-d
      expect(edges.some((e) => e.from === 'node-c' && e.to === 'node-d')).toBe(true);
    });

    it('数据流映射构建正确', async () => {
      const ymlPath = join(tmpDir, 'workflow.yml');
      writeFileSync(ymlPath, SAMPLE_WORKFLOW_YML);

      const result = await buildEnterpriseStateGraph({
        workflowYmlPath: ymlPath,
        dataDir: tmpDir,
        dataFlow: {
          stateFields: ['task', 'result', 'status'],
          entityMappings: { result: 'workflow-result' },
          dualWrite: true,
        },
      });

      expect(result!.dataFlowMapping.stateToEntity['result']).toBe('workflow-result');
      expect(result!.dataFlowMapping.entityToState['workflow-result']).toBe('result');
      expect(result!.dataFlowMapping.dualWriteFields).toContain('result');
    });

    it('workflow.yml 不存在时抛出错误', async () => {
      await expect(
        buildEnterpriseStateGraph({
          workflowYmlPath: join(tmpDir, 'nonexistent.yml'),
          dataDir: tmpDir,
        }),
      ).rejects.toThrow('读取 workflow.yml 失败');
    });

    it('非法 YAML 抛出错误', async () => {
      const ymlPath = join(tmpDir, 'bad.yml');
      writeFileSync(ymlPath, 'not: valid: yaml: {{{');

      await expect(
        buildEnterpriseStateGraph({
          workflowYmlPath: ymlPath,
          dataDir: tmpDir,
        }),
      ).rejects.toThrow();
    });
  });

  describe('buildStateGraphConfig', () => {
    it('HITL 节点标记 interruptBefore', () => {
      const parsed = parseWorkflowYaml(SAMPLE_WORKFLOW_YML);
      const config = buildStateGraphConfig(parsed, tmpDir);

      // 默认无 HITL 标记
      expect(config.nodes.every((n) => n.interruptBefore === false)).toBe(true);
    });
  });
});

// ── entity-store 单测 ──────────────────────────────

describe('entity-store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'entity-store-'));
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  describe('writeEntity / readEntity', () => {
    it('写入后能读取', () => {
      const entity: OntologyEntity = {
        name: 'test-entity',
        type: 'customer',
        description: '测试实体',
        properties: { id: '123', name: '客户A' },
      };

      writeEntity(tmpDir, entity);

      const read = readEntity(tmpDir, 'test-entity');
      expect(read).not.toBeNull();
      expect(read!.name).toBe('test-entity');
      expect(read!.type).toBe('customer');
      expect(read!.description).toBe('测试实体');
      expect(read!.properties).toEqual({ id: '123', name: '客户A' });
    });

    it('读取不存在的 entity 返回 null', () => {
      expect(readEntity(tmpDir, 'nonexistent')).toBeNull();
    });
  });

  describe('listEntities', () => {
    it('列出所有 entity', () => {
      writeEntity(tmpDir, { name: 'entity-a', type: 'customer' });
      writeEntity(tmpDir, { name: 'entity-b', type: 'order' });

      const list = listEntities(tmpDir);
      expect(list).toHaveLength(2);
      expect(list).toContain('entity-a');
      expect(list).toContain('entity-b');
    });

    it('空目录返回空数组', () => {
      expect(listEntities(tmpDir)).toEqual([]);
    });
  });
});
