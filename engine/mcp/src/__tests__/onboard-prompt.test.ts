// onboard-prompt.test.ts · 上岗 prompt 生成器测试（缺参/生成结构/落点闭环）
import { describe, it, expect } from 'vitest';

const { onboardPrompt } = await import('../tools/onboard-prompt');
const { workflowCreate, workflowNodeAdd } = await import('@sofagent/orchestrator');
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-onboard-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

describe('onboard_prompt 生成器', () => {
  it('缺 role_description → 结构化错误', async () => {
    const r = await onboardPrompt({ role_description: '' });
    expect(r.data.isError).toBe(true);
    expect(r.text).toContain('role_description');
  });

  it('正常生成：三段结构齐全 + agent 名推导', async () => {
    const r = await onboardPrompt({ role_description: '负责每日数据报表生成与异常告警' });
    expect(r.data.isError).toBe(false);
    expect(r.data.sections).toEqual(['职责', '边界', '工具面']);
    expect(r.data.prompt).toContain('## 职责');
    expect(r.data.prompt).toContain('## 边界');
    expect(r.data.prompt).toContain('## 工具面');
    expect(r.data.prompt).toContain('每日数据报表');
    expect(r.data.agentName).not.toBe('');
    expect(r.data.nextStep).toContain('workflow_node_add');
  });

  it('英文岗位名推导（data report specialist → data-report）', async () => {
    const r = await onboardPrompt({ role_description: 'data report specialist for daily metrics' });
    expect(r.data.agentName).toBe('data-report-specialist');
  });

  it('显式 agent_name 优先于推导', async () => {
    const r = await onboardPrompt({ role_description: '测试岗位', agent_name: 'custom-name' });
    expect(r.data.agentName).toBe('custom-name');
  });

  it('产物经 workflow_node_add 落进节点配置（与 G14 闭环）', async () => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(join(ISO_DIR, 'workflow-store'), { recursive: true });

    // 建 workflow
    const c = await workflowCreate(
      {
        workflow: { name: 'onboard-wf', nodes: [{ id: 'seed', agent: 'developer', task: '初始化' }] },
        owner: 'alice',
      },
      ISO_DIR,
    );
    expect(c.data.isError).toBe(false);

    // 生成上岗 prompt → 落节点
    const p = await onboardPrompt({ role_description: '每日巡检 agent' });
    const n = await workflowNodeAdd(
      {
        workflow_id: 'onboard-wf',
        node: { id: 'patroller', agent: p.data.agentName || 'patroller', task: p.data.prompt },
        actor: 'alice',
      },
      ISO_DIR,
    );
    expect(n.data.isError).toBe(false);

    // 验证落盘的节点 task 含三段结构
    const stored = JSON.parse(
      require('fs').readFileSync(join(ISO_DIR, 'workflow-store', 'onboard-wf.json'), 'utf-8'),
    );
    const added = stored.workflow.nodes.find((x: { id: string }) => x.id === 'patroller');
    expect(added.task).toContain('## 职责');
    expect(added.task).toContain('## 工具面');

    rmSync(ISO_DIR, { recursive: true, force: true });
  });
});
