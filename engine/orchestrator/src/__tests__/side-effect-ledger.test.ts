// ============================================================
// side-effect-ledger.test.ts · 副作用登记簿测试（v1.3.1 交付 4 L2）
// ============================================================
//
// 覆盖：
// - append-only：record 追加行，落盘文件逐行可读
// - 查重：同 taskId+action 命中；不同 taskId 不命中
// - 幂等键：meta 参与键计算（同任务同动作不同参数不误判）
// - 崩溃容错：坏行跳过（进程崩溃写一半不阻断读取）
// - 持久化：新实例读同一文件 → 索引重建命中
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  SideEffectLedger,
  sideEffectId,
} from '../durable/side-effect-ledger';
import { shouldExecute, markExecuted } from '../durable/idempotency-check';

describe('SideEffectLedger · 副作用登记簿（v1.3.1 交付 4 L2）', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ledger-'));
    ledgerPath = path.join(tmpDir, 'durable', 'side-effect-ledger.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('record 追加一行（append-only），落盘文件逐行可读', () => {
    const ledger = new SideEffectLedger(ledgerPath);
    ledger.record('task-42', 'webhook.send', { url: 'https://example.com/hook' });

    // 文件存在且恰一行 JSON
    expect(fs.existsSync(ledgerPath)).toBe(true);
    const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { taskId: string; action: string; id: string };
    expect(parsed.taskId).toBe('task-42');
    expect(parsed.action).toBe('webhook.send');
    expect(parsed.id).toBe(sideEffectId('task-42', 'webhook.send', { url: 'https://example.com/hook' }));
  });

  it('查重：同 taskId+action 命中；不同 taskId / 不同 action 不命中', () => {
    const ledger = new SideEffectLedger(ledgerPath);
    ledger.record('task-42', 'webhook.send');

    expect(ledger.has('task-42', 'webhook.send')).toBe(true);
    expect(ledger.has('task-43', 'webhook.send')).toBe(false);
    expect(ledger.has('task-42', 'pr.create')).toBe(false);
  });

  it('幂等键：meta 参与键计算——同任务同动作不同参数不误判', () => {
    const ledger = new SideEffectLedger(ledgerPath);
    ledger.record('task-42', 'webhook.send', { url: 'https://a.example.com' });

    expect(ledger.has('task-42', 'webhook.send', { url: 'https://a.example.com' })).toBe(true);
    expect(ledger.has('task-42', 'webhook.send', { url: 'https://b.example.com' })).toBe(false);
  });

  it('sideEffectId 键格式稳定：taskId:action + 排序 meta', () => {
    const id = sideEffectId('t1', 'act', { b: 2, a: 1 });
    expect(id).toBe('t1:act?a=1&b=2');
    // meta 顺序无关
    expect(sideEffectId('t1', 'act', { a: 1, b: 2 })).toBe(id);
  });

  it('持久化：新实例读同一文件 → 索引重建命中', () => {
    const ledger1 = new SideEffectLedger(ledgerPath);
    ledger1.record('task-99', 'feishu.notify');

    // 模拟进程重启：全新实例读同一文件
    const ledger2 = new SideEffectLedger(ledgerPath);
    expect(ledger2.has('task-99', 'feishu.notify')).toBe(true);
    expect(ledger2.size).toBe(1);
  });

  it('崩溃容错：坏行跳过，好行仍可读', () => {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    // 手写两行：一行合法 JSON + 一行半截（崩溃残留）
    const good = JSON.stringify({ ts: 'x', taskId: 't1', action: 'a', id: 't1:a' });
    fs.writeFileSync(ledgerPath, `${good}\n{"ts":"2026-","taskId":"crash`, 'utf-8');

    const ledger = new SideEffectLedger(ledgerPath);
    expect(ledger.has('t1', 'a')).toBe(true);
    expect(ledger.size).toBe(1);
  });

  it('list(taskId) 按任务过滤（审计回放）', () => {
    const ledger = new SideEffectLedger(ledgerPath);
    ledger.record('task-1', 'webhook.send');
    ledger.record('task-2', 'webhook.send');
    ledger.record('task-1', 'pr.create');

    const t1 = ledger.list('task-1');
    expect(t1).toHaveLength(2);
    expect(ledger.list()).toHaveLength(3);
  });
});

describe('idempotency-check · 续跑前查重（v1.3.1 交付 4 L2）', () => {
  let tmpDir: string;
  let ledgerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-idem-'));
    ledgerPath = path.join(tmpDir, 'durable', 'side-effect-ledger.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('未登记 → shouldExecute=true（正常执行）', () => {
    const ledger = new SideEffectLedger(ledgerPath);
    const decision = shouldExecute(ledger, 'task-42', 'webhook.send');
    expect(decision.execute).toBe(true);
    expect(decision.reason).toContain('未登记');
  });

  it('已登记 → shouldExecute=false（续跑跳过，幂等保证）', () => {
    const ledger = new SideEffectLedger(ledgerPath);
    ledger.record('task-42', 'webhook.send');
    const decision = shouldExecute(ledger, 'task-42', 'webhook.send');
    expect(decision.execute).toBe(false);
    expect(decision.reason).toContain('已登记');
    expect(decision.reason).toContain('跳过');
  });

  it('markExecuted：首次登记返回 true（应执行），二次返回 false（应跳过）', () => {
    const ledger = new SideEffectLedger(ledgerPath);
    expect(markExecuted(ledger, 'task-7', 'pr.create')).toBe(true);
    expect(markExecuted(ledger, 'task-7', 'pr.create')).toBe(false);
    // 登记簿只记了一次
    expect(ledger.list('task-7')).toHaveLength(1);
  });
});
