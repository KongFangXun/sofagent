// ============================================================
// meta-harness.test.ts · 多 harness 统一编排测试
// v1.3.9（二）：验收——多 harness 统一编排运行（沙箱隔离策略统一）/
// 跨 harness 状态追踪（动作前拦截）/ 审计轨迹跨 harness 聚合可查 /
// L2 协议兼容 / 子代理按需安装 + 多命名实例 / reportDelivery 唤醒
// ============================================================

import { describe, it, expect } from 'vitest';
import { MetaHarness } from '../meta-harness/orchestrator';
import { PolicyLayer, type MetaAction } from '../meta-harness/policy-layer';
import { AuditAggregator } from '../meta-harness/audit-aggregator';

describe('PolicyLayer · 策略强制层', () => {
  it('跨 harness 文件锁互斥——动作前拦截 deny', () => {
    const layer = new PolicyLayer();
    layer.trackHarness('h-a');
    layer.trackHarness('h-b');
    expect(layer.acquireFileLock('h-a', 'src/main.ts')).toBe(true);

    const action: MetaAction = { harnessId: 'h-b', type: 'file_write', detail: 'src/main.ts' };
    const verdict = layer.beforeAction(action);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violated).toContain('meta/file-lock');

    // 持有者自己写不拦
    const own = layer.beforeAction({ harnessId: 'h-a', type: 'file_write', detail: 'src/main.ts' });
    expect(own.allowed).toBe(true);
  });

  it('并发上限——第 5 个并发任务被拒', () => {
    const layer = new PolicyLayer();
    layer.trackHarness('h-x');
    for (let i = 0; i < 4; i++) layer.trackTaskStart('h-x');
    const verdict = layer.beforeAction({ harnessId: 'h-x', type: 'subagent_spawn' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.violated).toContain('meta/concurrency-cap');

    // 结束一个任务后放行
    layer.trackTaskEnd('h-x');
    expect(layer.beforeAction({ harnessId: 'h-x', type: 'subagent_spawn' }).allowed).toBe(true);
  });

  it('Profile 白名单——非 sofagent-*/@scope/* 命名被拒', () => {
    const layer = new PolicyLayer();
    layer.trackHarness('h-y');
    const bad = layer.beforeAction({ harnessId: 'h-y', type: 'profile_install', detail: 'random-malware-pkg' });
    expect(bad.allowed).toBe(false);
    const good = layer.beforeAction({ harnessId: 'h-y', type: 'profile_install', detail: 'sofagent-audit' });
    expect(good.allowed).toBe(true);
    const scoped = layer.beforeAction({ harnessId: 'h-y', type: 'profile_install', detail: '@corp/audit' });
    expect(scoped.allowed).toBe(true);
  });

  it('高危工具 warn 留痕但不拦截', () => {
    const layer = new PolicyLayer();
    layer.trackHarness('h-z');
    const verdict = layer.beforeAction({ harnessId: 'h-z', type: 'tool_call', detail: 'rm -rf /tmp/x' });
    expect(verdict.allowed).toBe(true);
    expect(verdict.violated).toContain('meta/sensitive-tool');
    expect(layer.getInterceptionLog()).toHaveLength(1);
  });

  it('自定义策略可注册且 deny 优先于 warn 汇报', () => {
    const layer = new PolicyLayer(false);
    layer.registerPolicy({
      id: 'custom/no-net',
      description: '测试：禁一切网络请求',
      judge: (a) => (a.type === 'net_request' ? 'deny' : undefined),
    });
    const verdict = layer.beforeAction({ harnessId: 'h', type: 'net_request', detail: 'https://x' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.violated).toEqual(['custom/no-net']);
  });

  it('harness 注销释放其文件锁（防死锁泄漏）', () => {
    const layer = new PolicyLayer();
    layer.trackHarness('h-old');
    layer.acquireFileLock('h-old', 'a.txt');
    layer.untrackHarness('h-old');
    expect(layer.stateView().fileLocks.size).toBe(0);
  });
});

describe('AuditAggregator · 跨 harness 审计聚合', () => {
  it('多 harness 轨迹聚合同视图，可按 harness/agent/kind/时间过滤', () => {
    const agg = new AuditAggregator();
    agg.ingest('h-a', 'tool_call', 'read file', { agentId: 'agent-1' });
    agg.ingest('h-b', 'tool_call', 'write file', { agentId: 'agent-2' });
    agg.ingest('h-a', 'decision', 'task accepted', { agentId: 'agent-1' });

    expect(agg.query()).toHaveLength(3);
    expect(agg.query({ harnessId: 'h-a' })).toHaveLength(2);
    expect(agg.query({ agentId: 'agent-2' })).toHaveLength(1);
    expect(agg.query({ kind: 'tool_call' })).toHaveLength(2);
  });

  it('L2 协作协议事件归一化入轨（v1.3.3 兼容）', () => {
    const agg = new AuditAggregator();
    agg.ingestL2Event({
      harnessId: 'h-a', family: 'feedback', feedbackType: 'correction',
      agentId: 'agent-1', content: 'A3 不改越界——修正',
    });
    agg.ingestL2Event({
      harnessId: 'h-b', family: 'conflict',
      agentId: 'agent-2', content: '文件锁冲突裁决：audit 优先',
    });
    const l2 = agg.query({ kind: 'l2_event' });
    expect(l2).toHaveLength(2);
    expect(l2[0]?.summary).toContain('[L2:feedback]');
    expect(l2[1]?.summary).toContain('[L2:conflict]');
    // payload 保留协议原字段
    expect(l2[0]?.payload?.feedbackType).toBe('correction');
  });

  it('statsByHarness 分组统计（Dashboard 波次渲染输入形态）', () => {
    const agg = new AuditAggregator();
    agg.ingest('h-a', 'tool_call', 'x');
    agg.ingest('h-a', 'decision', 'y');
    agg.ingest('h-b', 'tool_call', 'z');
    const stats = agg.statsByHarness();
    expect(stats).toHaveLength(2);
    expect(stats.find((s) => s.harnessId === 'h-a')?.count).toBe(2);
    expect(stats.find((s) => s.harnessId === 'h-b')?.kinds.tool_call).toBe(1);
  });

  it('exportAll 供 worklog 聚合消费（同一数据源两个消费面）', () => {
    const agg = new AuditAggregator();
    agg.ingest('h-a', 'tool_call', 'x');
    const all = agg.exportAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.harnessId).toBe('h-a');
  });
});

describe('MetaHarness · 统一编排器', () => {
  it('多 harness 注册 + 多命名实例（同 profile 两个实例并行）', async () => {
    const meta = new MetaHarness();
    const regA = await meta.register({ id: 'audit-a', profile: { name: 'sofagent-audit' } });
    const regB = await meta.register({ id: 'audit-b', profile: { name: 'sofagent-audit' } });
    expect(regA.profileInstalled).toBe(true);
    expect(regB.profileInstalled).toBe(true);
    expect(meta.listHarnesses().map((h) => h.id).sort()).toEqual(['audit-a', 'audit-b']);
    // 重复 ID 拒绝
    await expect(meta.register({ id: 'audit-a' })).rejects.toThrow('已存在');
  });

  it('任务提交 → executor 执行 → waitForDelivery 被唤醒（零轮询）', async () => {
    const meta = new MetaHarness();
    await meta.register({ id: 'w-1' });
    const taskId = await meta.submitTask(
      { description: '计算 1+1' },
      async () => 2,
    );
    const result = await meta.waitForDelivery(taskId, 2000);
    expect(result?.status).toBe('completed');
    expect(result?.output).toBe(2);
    expect(result?.harnessId).toBe('w-1');
  });

  it('reportDelivery 主动反馈唤醒父任务（executor 不返回，靠 delivery 推送）', async () => {
    const meta = new MetaHarness();
    await meta.register({ id: 'w-2' });
    const taskId = await meta.submitTask(
      { description: '长任务' },
      async (task, harness) => {
        // 模拟子代理沙箱内完成后的主动汇报（不经 executor 返回值）
        setTimeout(() => {
          meta.reportDelivery(harness.id, task.id!, { status: 'completed', output: 'done-by-delivery' });
        }, 10);
        // executor 挂起不返回——父任务只能被 delivery 唤醒
        await new Promise((r) => setTimeout(r, 5000));
      },
    );
    const result = await meta.waitForDelivery(taskId, 2000);
    expect(result?.status).toBe('completed');
    expect(result?.output).toBe('done-by-delivery');
  });

  it('executor 抛错 → failed 结果交付', async () => {
    const meta = new MetaHarness();
    await meta.register({ id: 'w-3' });
    const taskId = await meta.submitTask(
      { description: 'boom' },
      async () => { throw new Error('boom-error'); },
    );
    const result = await meta.waitForDelivery(taskId, 2000);
    expect(result?.status).toBe('failed');
    expect(result?.error).toContain('boom-error');
  });

  it('策略拒绝的任务返回 denied 而非挂死', async () => {
    const meta = new MetaHarness();
    await meta.register({ id: 'w-4' });
    const policy = meta.getPolicyLayer();
    policy.registerPolicy({
      id: 'test/block-all',
      description: '测试：拒绝一切 spawn',
      judge: (a) => (a.type === 'subagent_spawn' ? 'deny' : undefined),
    });
    const taskId = await meta.submitTask({ description: 'x' }, async () => 'never');
    const result = await meta.waitForDelivery(taskId, 1000);
    expect(result?.status).toBe('denied');
    expect(result?.error).toContain('block-all');
  });

  it('轮转调度：多实例均衡分派', async () => {
    const meta = new MetaHarness();
    await meta.register({ id: 'rr-1' });
    await meta.register({ id: 'rr-2' });
    const assigned: string[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await meta.submitTask({ description: `t${i}` }, async (t, h) => {
        assigned.push(h.id);
        return null;
      }));
    }
    await Promise.all(ids.map((id) => meta.waitForDelivery(id, 1000)));
    expect(assigned.sort()).toEqual(['rr-1', 'rr-1', 'rr-2', 'rr-2']);
  });

  it('Profile Bundle 运行中按需安装（DSH 形态）', async () => {
    const meta = new MetaHarness();
    await meta.register({ id: 'p-1' });
    const installed: string[] = [];
    const ok = await meta.installProfile('p-1', {
      name: 'sofagent-refine',
      version: '1.0.0',
      install: (hid) => { installed.push(`${hid}:sofagent-refine`); },
    });
    expect(ok).toBe(true);
    expect(installed).toEqual(['p-1:sofagent-refine']);
    // 白名单外的 profile 拒装
    const blocked = await meta.installProfile('p-1', { name: 'evil-pkg' });
    expect(blocked).toBe(false);
    expect(meta.getPolicyLayer().stateView().hasProfile('p-1', 'sofagent-refine')).toBe(true);
    expect(meta.getPolicyLayer().stateView().hasProfile('p-1', 'evil-pkg')).toBe(false);
  });

  it('任务过程审计轨迹跨 harness 聚合可查', async () => {
    const meta = new MetaHarness();
    await meta.register({ id: 'a-1', agentId: 'agent-a' });
    await meta.register({ id: 'a-2', agentId: 'agent-b' });
    const t1 = await meta.submitTask({ description: 'task1' }, async () => 1);
    const t2 = await meta.submitTask({ description: 'task2', harnessId: 'a-2' }, async () => 2);
    await meta.waitForDelivery(t1, 1000);
    await meta.waitForDelivery(t2, 1000);

    const agg = meta.getAuditAggregator();
    // 两 harness 都有 decision + reportDelivery 轨迹
    const h1 = agg.query({ harnessId: 'a-1' });
    const h2 = agg.query({ harnessId: 'a-2' });
    expect(h1.length).toBeGreaterThanOrEqual(2);
    expect(h2.length).toBeGreaterThanOrEqual(2);
    expect(agg.query({ kind: 'interception' })).toHaveLength(0); // 本场景无拦截
  });

  it('onDelivery 多消费者订阅（Dashboard 渲染通道）', async () => {
    const meta = new MetaHarness();
    await meta.register({ id: 'sub-1' });
    const seen: string[] = [];
    // 受控 executor：先挂起，等 onDelivery 注册完再交付
    let deliver!: () => void;
    const gate = new Promise<void>((res) => { deliver = res; });
    const taskId = await meta.submitTask({ description: 'watch' }, async () => {
      await gate; // 等 listeners 注册完成
      return 'v';
    });
    meta.onDelivery(taskId, (r) => seen.push(`l1:${r.status}`));
    meta.onDelivery(taskId, (r) => seen.push(`l2:${r.status}`));
    deliver();
    await meta.waitForDelivery(taskId, 1000);
    expect(seen).toContain('l1:completed');
    expect(seen).toContain('l2:completed');
  });
});
