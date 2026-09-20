// ============================================================
// workflow-submit-on.test.ts · workflow_submit 的 `on:` 分支测试（v1.5.1 第一章）
// ============================================================
//
// 覆盖改造保留声明两侧：
//   A. 新增面：`on:` 事件订阅声明的校验（未登记类型 / 悬空 from / 非法形态）
//      与回填（subscriptions）。
//   B. 保留面：不含 `on:` 的 workflow 行为零变化；既有必填字段 / DAG 校验
//      仍由 submitWorkflow 容器原样把关（本文件未替换其任何一段）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { workflowSubmit } from '../tools/workflow-submit';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-wf-on-'));
  process.env.SOFAGENT_DATA = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 带 `on:` 声明的 workflow（字符串简写 + 完整形态各一处） */
const ON_WORKFLOW = `
workflow:
  name: event-flow
  nodes:
    - id: intake
      agent: developer
      task: 接收表单
      on: webhook.form.submitted
    - id: followup
      agent: qa-engineer
      task: 跟进
      on:
        event: workflow.node.completed
        from: intake
`;

/** 不含 `on:` 的既有形态 workflow */
const PLAIN_WORKFLOW = `
workflow:
  name: plain-flow
  nodes:
    - id: a
      agent: developer
      task: 干活
    - id: b
      agent: qa-engineer
      task: 验收
      depends_on: [a]
`;

describe('第一章 · workflow_submit 的 on: 声明（新增分支）', () => {
  it('合法 on: 声明 → 校验通过且回填 subscriptions', async () => {
    const result = await workflowSubmit({ workflow: ON_WORKFLOW });
    expect(result.data.isError).toBe(false);
    expect(result.data.validated).toBe(true);
    expect(result.data.nodeCount).toBe(2);
    expect(result.data.subscriptions).toEqual([
      { node: 'intake', event: 'webhook.form.submitted' },
      { node: 'followup', event: 'workflow.node.completed', from: 'intake' },
    ]);
    expect(result.text).toContain('on: 2 条事件订阅');
  });

  it('未登记事件类型 → 拒绝（拼错的事件名不会静默失效）', async () => {
    const result = await workflowSubmit({
      workflow: `
workflow:
  name: bad
  nodes:
    - id: a
      agent: developer
      task: A
      on: webhook.typo.event
`,
    });
    expect(result.data.isError).toBe(true);
    expect(result.data.validated).toBe(false);
    expect(result.data.issues?.[0]).toContain('未登记的事件类型');
  });

  it('on.from 悬空引用 → 拒绝', async () => {
    const result = await workflowSubmit({
      workflow: `
workflow:
  name: bad-ref
  nodes:
    - id: a
      agent: developer
      task: A
      on:
        event: workflow.node.completed
        from: ghost
`,
    });
    expect(result.data.isError).toBe(true);
    expect(result.data.issues?.[0]).toContain('不存在的节点');
  });

  it('on 形态非法（数组）→ 拒绝', async () => {
    const result = await workflowSubmit({
      workflow: `
workflow:
  name: bad-form
  nodes:
    - id: a
      agent: developer
      task: A
      on: [x, y]
`,
    });
    expect(result.data.isError).toBe(true);
    expect(result.data.issues?.[0]).toContain('形态非法');
  });
});

describe('第一章 · 既有校验路径零变化（改造保留面）', () => {
  it('不含 on: 的 workflow → 结果结构与旧版一致（无 subscriptions 字段）', async () => {
    const result = await workflowSubmit({ workflow: PLAIN_WORKFLOW });
    expect(result.data.isError).toBe(false);
    expect(result.data.validated).toBe(true);
    expect(result.data.name).toBe('plain-flow');
    expect(result.data.nodeCount).toBe(2);
    expect(result.data.subscriptions).toBeUndefined();
    expect(result.data.mergeCriteria).toEqual([]);
    expect(result.data.approver).toBeNull();
  });

  it('既有必填字段校验仍由容器把关（缺 task → 仍是结构化错误清单）', async () => {
    const result = await workflowSubmit({
      workflow: `
workflow:
  name: missing-task
  nodes:
    - id: a
      agent: developer
`,
    });
    expect(result.data.isError).toBe(true);
    expect(result.data.validated).toBe(false);
    expect(result.data.issues!.length).toBeGreaterThan(0);
  });

  it('既有 DAG 校验仍由容器把关（depends_on 悬空 → 仍是结构化错误清单）', async () => {
    const result = await workflowSubmit({
      workflow: `
workflow:
  name: dangling-dep
  nodes:
    - id: a
      agent: developer
      task: A
      depends_on: [ghost]
`,
    });
    expect(result.data.isError).toBe(true);
    expect(result.data.issues!.length).toBeGreaterThan(0);
  });

  it('空 workflow 早退分支行为不变', async () => {
    const result = await workflowSubmit({ workflow: '   ' });
    expect(result.data.isError).toBe(true);
    expect(result.data.issues).toEqual(['workflow 内容为空']);
  });
});
