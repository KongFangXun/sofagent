// workflow-crud.test.ts · G14 workflow CRUD 四 tool 全路径测试
// 覆盖：schema-gate 校验拒绝（字段路径）/ cron 语法边界 / create→diff→update→node_add
// 全链（含 owner 分流）/ version+1 账链 / diff 零副作用 / 审计挂链
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ISO_DIR = join(tmpdir(), `sofagent-orch-crud-test-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

// 环境变量设置后再 import 被测模块
const { workflowCreate, workflowUpdate, workflowNodeAdd, workflowDiffPreview } = await import(
  '../crud/workflow-store'
);
const { validateCronSchedule, gateOrThrow, SchemaGateError, workflowCreateSchema } = await import(
  '../crud/schema-gate'
);

const storeDir = join(ISO_DIR, 'workflow-store');

const baseDoc = {
  name: 'release-flow',
  description: '发版流程',
  nodes: [
    { id: 'dev', agent: 'developer', task: '开发实现' },
    { id: 'qa', agent: 'qa-engineer', task: '回归测试', depends_on: ['dev'] },
  ],
};

describe('schema-gate：cron 语法校验', () => {
  it.each([
    ['@daily', null],
    ['@weekly', null],
    ['@monthly', null],
    ['0 0 * * *', null],
    ['*/15 9-18 * * 1-5', null],
    ['30 4 1,15 * *', null],
    ['0 9 * *', '5 段'],        // 4 段 → 拒绝
    ['61 * * * *', '越界'],     // 分 61 → 拒绝
    ['0 25 * * *', '越界'],     // 时 25 → 拒绝
    ['0 0 0 * *', '越界'],      // 日 0 → 拒绝
    ['*/0 * * * *', '步进'],    // 步进 0 → 拒绝
    ['0 0 * * 7', '越界'],      // 周 7 → 拒绝
    ['每天早上九点', null],       // 自然语言 → 放行（消费端解析）
    ['', '为空'],               // 空 → 拒绝
  ])('「%s」→ %s', (schedule, expectedKind) => {
    const err = validateCronSchedule(schedule);
    if (expectedKind === null) expect(err).toBeNull();
    else expect(err).toContain(expectedKind);
  });
});

describe('schema-gate：结构校验含字段路径', () => {
  it('嵌套错误路径可定位（workflow.nodes[1].trigger.schedule）', () => {
    try {
      gateOrThrow(
        workflowCreateSchema,
        {
          workflow: {
            name: 'x',
            nodes: [
              { id: 'a', agent: 'dev', task: 't' },
              { id: 'b', agent: 'dev', task: 't', trigger: {} }, // schedule 缺失
            ],
          },
          owner: 'o',
        },
        'workflow_create',
      );
      expect.unreachable('应抛 SchemaGateError');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaGateError);
      const issues = (err as SchemaGateError).issues;
      expect(issues.join('\n')).toContain('workflow.nodes[1].trigger.schedule');
    }
  });

  it('visibility 非法枚举拒绝', () => {
    try {
      gateOrThrow(
        workflowCreateSchema,
        {
          workflow: {
            name: 'x',
            nodes: [{ id: 'a', agent: 'dev', task: 't', visibility: 'secret' }],
          },
          owner: 'o',
        },
        'workflow_create',
      );
      expect.unreachable('应抛 SchemaGateError');
    } catch (err) {
      expect((err as SchemaGateError).issues.join('\n')).toContain('visibility');
    }
  });
});

describe('G14 四 tool 全链（create → diff → update → node_add）', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(storeDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('create → v1 落库 + owner 记录', async () => {
    const r = await workflowCreate({ workflow: baseDoc, owner: 'alice' }, ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.version).toBe(1);
    const stored = JSON.parse(readFileSync(join(storeDir, 'release-flow.json'), 'utf-8'));
    expect(stored.owner).toBe('alice');
    expect(stored.version).toBe(1);
  });

  it('重复 create 拒绝（不动既有对象）', async () => {
    await workflowCreate({ workflow: baseDoc, owner: 'alice' }, ISO_DIR);
    const r = await workflowCreate({ workflow: baseDoc, owner: 'bob' }, ISO_DIR);
    expect(r.data.isError).toBe(true);
    expect(r.data.issues?.[0]).toContain('已存在');
    // owner 仍是 alice（bob 的重复创建未篡改归属）
    const stored = JSON.parse(readFileSync(join(storeDir, 'release-flow.json'), 'utf-8'));
    expect(stored.owner).toBe('alice');
  });

  it('非法 cron 在 create 拒绝（fail-loud）', async () => {
    const r = await workflowCreate(
      {
        workflow: {
          ...baseDoc,
          nodes: [...baseDoc.nodes, { id: 'cron1', agent: 'developer', task: 't', trigger: { schedule: '0 9 * *' } }],
        },
        owner: 'alice',
      },
      ISO_DIR,
    );
    expect(r.data.isError).toBe(true);
    expect(r.data.issues?.[0]).toContain('trigger.schedule');
    // 未落库
    expect(existsSync(join(storeDir, 'release-flow.json'))).toBe(false);
  });

  it('owner update 直改 trunk version+1', async () => {
    await workflowCreate({ workflow: baseDoc, owner: 'alice' }, ISO_DIR);
    const doc2 = { ...baseDoc, description: '发版流程 v2' };
    const r = await workflowUpdate({ workflow_id: 'release-flow', workflow: doc2, actor: 'alice' }, ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.version).toBe(2);
    expect(r.data.branched).toBeFalsy();
    // trunk 已更新
    const stored = JSON.parse(readFileSync(join(storeDir, 'release-flow.json'), 'utf-8'));
    expect(stored.version).toBe(2);
    expect(stored.workflow.description).toBe('发版流程 v2');
    // 无 branch 文件
    expect(existsSync(join(storeDir, 'release-flow.branch-alice.json'))).toBe(false);
  });

  it('非 owner update 开 branch（trunk 不动）', async () => {
    await workflowCreate({ workflow: baseDoc, owner: 'alice' }, ISO_DIR);
    const doc2 = { ...baseDoc, description: 'bob 的改动' };
    const r = await workflowUpdate({ workflow_id: 'release-flow', workflow: doc2, actor: 'bob' }, ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.branched).toBe(true);
    // trunk 未动
    const trunk = JSON.parse(readFileSync(join(storeDir, 'release-flow.json'), 'utf-8'));
    expect(trunk.version).toBe(1);
    expect(trunk.workflow.description).toBe('发版流程');
    // branch 已写
    const branch = JSON.parse(readFileSync(join(storeDir, 'release-flow.branch-bob.json'), 'utf-8'));
    expect(branch.workflow.description).toBe('bob 的改动');
  });

  it('node_add：owner 追加节点 + depends_on 校验 + id 重复拒绝', async () => {
    await workflowCreate({ workflow: baseDoc, owner: 'alice' }, ISO_DIR);

    // 悬空引用拒绝
    const dangling = await workflowNodeAdd(
      {
        workflow_id: 'release-flow',
        node: { id: 'rel', agent: 'technical-writer', task: '发版说明', depends_on: ['ghost'] },
        actor: 'alice',
      },
      ISO_DIR,
    );
    expect(dangling.data.isError).toBe(true);
    expect(dangling.data.issues?.[0]).toContain('悬空');

    // id 重复拒绝
    const dup = await workflowNodeAdd(
      { workflow_id: 'release-flow', node: { id: 'dev', agent: 'developer', task: 'x' }, actor: 'alice' },
      ISO_DIR,
    );
    expect(dup.data.isError).toBe(true);

    // 正常追加（带 trigger.schedule + visibility）
    const ok = await workflowNodeAdd(
      {
        workflow_id: 'release-flow',
        node: {
          id: 'rel',
          agent: 'technical-writer',
          task: '发版说明',
          depends_on: ['qa'],
          trigger: { schedule: '@daily' },
          visibility: 'result-only',
        },
        actor: 'alice',
      },
      ISO_DIR,
    );
    expect(ok.data.isError).toBe(false);
    expect(ok.data.version).toBe(2);
    const stored = JSON.parse(readFileSync(join(storeDir, 'release-flow.json'), 'utf-8'));
    expect(stored.workflow.nodes).toHaveLength(3);
    expect(stored.workflow.nodes[2]!.trigger).toEqual({ schedule: '@daily' });
    expect(stored.workflow.nodes[2]!.visibility).toBe('result-only');
  });

  it('diff_preview：行级差异 + 零副作用', async () => {
    await workflowCreate({ workflow: baseDoc, owner: 'alice' }, ISO_DIR);
    const before = readFileSync(join(storeDir, 'release-flow.json'), 'utf-8');

    const doc2 = {
      ...baseDoc,
      nodes: [...baseDoc.nodes, { id: 'rel', agent: 'technical-writer', task: '发版说明' }],
    };
    const r = await workflowDiffPreview({ workflow_id: 'release-flow', workflow: doc2, actor: 'alice' }, ISO_DIR);
    expect(r.data.isError).toBe(false);
    expect(r.data.added).toBeGreaterThan(0);
    expect(r.data.diff?.some((l) => l.includes('"rel"'))).toBe(true);

    // 零副作用：trunk 文件字节级不变
    expect(readFileSync(join(storeDir, 'release-flow.json'), 'utf-8')).toBe(before);
  });

  it('不存在的工作流操作返回 notFound', async () => {
    const r = await workflowUpdate(
      { workflow_id: 'ghost-flow', workflow: baseDoc, actor: 'alice' },
      ISO_DIR,
    );
    expect(r.data.isError).toBe(true);
    expect(r.data.issues?.[0]).toContain('不存在');
  });

  it('workflow_id 路径穿越拒绝', async () => {
    try {
      await workflowUpdate(
        { workflow_id: '../../etc/passwd', workflow: baseDoc, actor: 'a' },
        ISO_DIR,
      );
      expect.unreachable('应抛 SchemaGateError');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaGateError);
    }
  });
});
