// ============================================================
// router-slots-adjudicate.test.ts · v1.5.4 第二章 · router_slots adjudicate 生产接线断言
// ============================================================
//
// 目的：证明判定链（IntentTriage L0/L1/L2）在**生产路径**可达——本 tool 的
//   adjudicate 动作在运行时构造 IntentTriage 并注入 PolicyEngine、调用
//   decideByAdjudication（非仅测试调用/类型引用）。
// ============================================================

import { describe, it, expect } from 'vitest';
import { routerSlots } from '../tools/router-slots';

describe('router_slots · adjudicate（判定链生产接线）', () => {
  it('adjudicate：构造 IntentTriage 注入 PolicyEngine，decideByAdjudication 可达并产出判定 + 下达', async () => {
    const res = await routerSlots({
      action: 'adjudicate',
      sensitivity: 'internal',
      text: '把季度报表汇总成 PDF',
    });
    expect(res.data.isError).toBe(false);
    expect(res.data.ok).toBe(true);
    const adj = res.data.adjudication;
    expect(adj).toBeDefined();
    expect(['L0', 'L1', 'L2']).toContain(adj!.layer);
    expect(typeof adj!.triageTarget).toBe('string');
    expect(adj!.triageTarget.length).toBeGreaterThan(0);
    expect(typeof adj!.decisionId).toBe('string');
    expect(adj!.decisionId.length).toBeGreaterThan(0);
    expect(typeof adj!.dispatched).toBe('boolean');
    expect(adj!.sensitivity).toBe('internal');
  });

  it('adjudicate：敏感数据 → 判定链去向映射分级后仍落本地档（数据主权铁律）', async () => {
    const res = await routerSlots({
      action: 'adjudicate',
      sensitivity: 'restricted',
      text: '客户名单导出',
    });
    expect(res.data.ok).toBe(true);
    expect(['local-executor', 'local-pipeline']).toContain(res.data.adjudication!.target);
  });

  it('adjudicate：L0 结构化解引用可先判（refs 透传判定链）', async () => {
    const res = await routerSlots({
      action: 'adjudicate',
      sensitivity: 'internal',
      text: '节点上下文',
      refs: ['node-1'],
      in_domain: true,
    });
    expect(res.data.ok).toBe(true);
    expect(res.data.adjudication).toBeDefined();
  });

  it('adjudicate：缺 sensitivity ⇒ 参数错误（不下达、不构造判定链）', async () => {
    const res = await routerSlots({ action: 'adjudicate', text: 'x' });
    expect(res.data.isError).toBe(true);
    expect(res.data.ok).toBe(false);
    expect(res.data.adjudication).toBeUndefined();
  });

  it('既有动作不受影响：snapshot 仍可用', async () => {
    const res = await routerSlots({ action: 'snapshot', max_slots: 3 });
    expect(res.data.ok).toBe(true);
    expect(res.data.snapshot?.maxSlots).toBe(3);
  });
});
