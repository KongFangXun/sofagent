// workflow-crud.test.ts · MCP 侧 G14 四 tool 接线测试
// 覆盖：tools/workflow-crud 薄委托全链（真实 orchestrator store）/ registry 登记四段
// （name/roles/description/inputSchema）/ mcp-server 派发 case 存在性
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-mcp-crud-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

const storeDir = join(ISO_DIR, 'workflow-store');

const {
  workflowCreate,
  workflowUpdate,
  workflowNodeAdd,
  workflowDiffPreview,
} = await import('../tools/workflow-crud');
const { TOOLS } = await import('../tool-registry');
const registrySource = readFileSync(new URL('../mcp-server.ts', import.meta.url), 'utf-8');

const baseDoc = {
  name: 'onboard-flow',
  nodes: [
    { id: 'n1', agent: 'developer', task: '实现功能', visibility: 'open' as const },
    {
      id: 'n2',
      agent: 'technical-writer',
      task: '每日文档巡检',
      depends_on: ['n1'],
      trigger: { schedule: '@daily' },
    },
  ],
};

describe('G14 四 tool registry 登记四段（tools/ 实现 + mcp-server 派发 + registry 数组 + roles）', () => {
  const crudNames = ['workflow_create', 'workflow_update', 'workflow_node_add', 'workflow_diff_preview'];

  it.each(crudNames)('%s 在 TOOLS 数组登记且四段齐全', (name) => {
    const def = TOOLS.find((t) => t.name === name);
    expect(def).toBeDefined();
    expect(def!.roles).toContain('agent');
    expect(def!.description.length).toBeGreaterThan(10);
    expect(def!.inputSchema.type).toBe('object');
    expect(Object.keys(def!.inputSchema.properties!).length).toBeGreaterThan(0);
  });

  it.each(crudNames)('%s 在 mcp-server.ts 有派发 case', (name) => {
    expect(registrySource).toContain(`case '${name}'`);
  });

  it('工具数 84→93（G14 四 tool + G2 + 章八 + G13 PR 三 tool 落位）', () => {
    expect(TOOLS.length).toBe(95);
  });
});

describe('G14 MCP tool 薄委托全链（真实 orchestrator store）', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(storeDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('create → update（owner trunk）→ node_add → diff_preview 全链', async () => {
    // create：data_dir 未传走 SOFAGENT_DATA 解析链
    const c = await workflowCreate({ workflow: baseDoc, owner: 'alice' });
    expect(c.data.isError).toBe(false);
    expect(c.data.version).toBe(1);
    expect(existsSync(join(storeDir, 'onboard-flow.json'))).toBe(true);

    // update：owner 直改 trunk v1→v2
    const u = await workflowUpdate({
      workflow_id: 'onboard-flow',
      workflow: { ...baseDoc, description: '加描述' },
      actor: 'alice',
    });
    expect(u.data.isError).toBe(false);
    expect(u.data.version).toBe(2);
    expect(u.data.branched).toBeFalsy();

    // node_add：追加节点（上岗 prompt 产物落点形态）
    const n = await workflowNodeAdd({
      workflow_id: 'onboard-flow',
      node: { id: 'n3', agent: 'fde', task: '上岗培训执行', depends_on: ['n2'] },
      actor: 'alice',
    });
    expect(n.data.isError).toBe(false);
    expect(n.data.version).toBe(3);

    // diff_preview：与 trunk 对比有差异 + 零副作用
    const before = readFileSync(join(storeDir, 'onboard-flow.json'), 'utf-8');
    const d = await workflowDiffPreview({
      workflow_id: 'onboard-flow',
      workflow: { ...baseDoc, description: '又改了' },
      actor: 'alice',
    });
    expect(d.data.isError).toBe(false);
    expect(d.data.added).toBeGreaterThan(0);
    expect(readFileSync(join(storeDir, 'onboard-flow.json'), 'utf-8')).toBe(before);
  });

  it('非 owner 分流开 branch（MCP 层语义穿透）', async () => {
    await workflowCreate({ workflow: baseDoc, owner: 'alice' });
    const r = await workflowUpdate({
      workflow_id: 'onboard-flow',
      workflow: { ...baseDoc, description: 'bob 改动' },
      actor: 'bob',
    });
    expect(r.data.isError).toBe(false);
    expect(r.data.branched).toBe(true);
    expect(existsSync(join(storeDir, 'onboard-flow.branch-bob.json'))).toBe(true);
  });

  it('缺参/校验拒绝返回结构化错误（isError + issues）', async () => {
    // workflow 结构缺 nodes
    const bad = await workflowCreate({ workflow: { name: 'x' }, owner: 'a' });
    expect(bad.data.isError).toBe(true);
    expect(bad.data.issues?.length).toBeGreaterThan(0);
    // 不存在的 workflow_id
    const nf = await workflowNodeAdd({
      workflow_id: 'ghost',
      node: { id: 'n', agent: 'a', task: 't' },
      actor: 'a',
    });
    expect(nf.data.isError).toBe(true);
    expect(nf.data.issues?.[0]).toContain('不存在');
  });
});
