// ============================================================
// templates.test.ts · 首部署模板库 + 账单聚合单测（G8 · v1.4.7）
// 覆盖：模板查取/清单/建议 schedule 合法性 + billing 月结聚合
// 边界（空数据/跨月/未估算标注/损坏 JSON）
// ============================================================

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SCHEDULER_TEMPLATES,
  getTemplate,
  templateIds,
} from '../templates';
import { buildBillingReport, renderBilling } from '../billing';

describe('G8 模板库（templates.ts）', () => {
  it('两预置模板在位且 id 唯一', () => {
    expect(SCHEDULER_TEMPLATES.length).toBeGreaterThanOrEqual(2);
    const ids = SCHEDULER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('daily-health');
    expect(ids).toContain('weekly-report');
  });

  it('建议 schedule 均为合法糖宏（scheduler.expandCronSugar 可展开）', () => {
    for (const t of SCHEDULER_TEMPLATES) {
      expect(t.defaultSchedule).toMatch(/^@(daily|weekly|monthly)$/);
      expect(t.prompt.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('getTemplate 命中/未命中两态', () => {
    expect(getTemplate('daily-health')?.label).toBe('每日健康巡检');
    expect(getTemplate('no-such-template')).toBeUndefined();
  });

  it('templateIds 以 " / " 连接且含两模板', () => {
    const s = templateIds();
    expect(s).toContain('daily-health');
    expect(s).toContain('weekly-report');
    expect(s).toMatch(/ \/ /);
  });
});

describe('G8 账单周期聚合（billing.ts）', () => {
  it('worklog.json 不存在 → null（调用方降级提示）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-empty-'));
    try {
      expect(buildBillingReport(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('损坏 JSON → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-corrupt-'));
    try {
      const { mkdirSync } = require('fs') as typeof import('fs');
      mkdirSync(join(dir, 'dashboard'), { recursive: true });
      writeFileSync(join(dir, 'dashboard', 'worklog.json'), '{not-json', 'utf-8');
      expect(buildBillingReport(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('空 agents → 空账单条目 + totalUsd null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-noagents-'));
    try {
      const { mkdirSync } = require('fs') as typeof import('fs');
      mkdirSync(join(dir, 'dashboard'), { recursive: true });
      writeFileSync(join(dir, 'dashboard', 'worklog.json'), JSON.stringify({ agents: [] }), 'utf-8');
      const r = buildBillingReport(dir);
      expect(r).not.toBeNull();
      expect(r!.entries).toHaveLength(0);
      expect(r!.totalUsd).toBeNull();
      expect(renderBilling(r!)).toContain('账单为空');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('跨月任务按 lastSeen 自然月分桶 + 成本合计', () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-months-'));
    try {
      const { mkdirSync } = require('fs') as typeof import('fs');
      mkdirSync(join(dir, 'dashboard'), { recursive: true });
      writeFileSync(
        join(dir, 'dashboard', 'worklog.json'),
        JSON.stringify({
          agents: [
            {
              agentId: 'agent-a',
              tasks: [
                { taskId: 't1', costUsd: 0.1, llmCalls: 3, tokens: { input: 100, output: 50 }, lastSeen: '2026-08-15T10:00:00Z' },
                { taskId: 't2', costUsd: 0.2, llmCalls: 2, tokens: { input: 80, output: 40 }, lastSeen: '2026-09-02T10:00:00Z' },
              ],
            },
            {
              agentId: 'agent-b',
              tasks: [
                { taskId: 't3', costUsd: 0.3, llmCalls: 1, tokens: { input: 60, output: 30 }, lastSeen: '2026-08-20T10:00:00Z' },
              ],
            },
          ],
        }),
        'utf-8',
      );
      const r = buildBillingReport(dir);
      expect(r).not.toBeNull();
      expect(r!.entries).toHaveLength(3);
      // 月升序、agent 字典序
      expect(r!.entries[0]).toMatchObject({ month: '2026-08', agentId: 'agent-a', tasks: 1, costUsd: 0.1, estimated: true });
      expect(r!.entries[1]).toMatchObject({ month: '2026-08', agentId: 'agent-b', tasks: 1, costUsd: 0.3 });
      expect(r!.entries[2]).toMatchObject({ month: '2026-09', agentId: 'agent-a', tasks: 1, costUsd: 0.2 });
      expect(r!.totalUsd).toBeCloseTo(0.6, 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('costUsd null（单价未收录）→ estimated=false 标注，不臆造 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-null-'));
    try {
      const { mkdirSync } = require('fs') as typeof import('fs');
      mkdirSync(join(dir, 'dashboard'), { recursive: true });
      writeFileSync(
        join(dir, 'dashboard', 'worklog.json'),
        JSON.stringify({
          agents: [
            {
              agentId: 'agent-x',
              tasks: [
                { taskId: 't1', costUsd: null, llmCalls: 1, tokens: { input: 10, output: 5 }, lastSeen: '2026-09-01T00:00:00Z' },
              ],
            },
          ],
        }),
        'utf-8',
      );
      const r = buildBillingReport(dir);
      expect(r!.entries[0].estimated).toBe(false);
      // costUsd 退化为已知下界 0（无已知成本任务），但 estimated 揭示不完整
      expect(renderBilling(r!)).toContain('未完整估算');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('非法 lastSeen 任务不计入（不臆造归属）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'billing-badts-'));
    try {
      const { mkdirSync } = require('fs') as typeof import('fs');
      mkdirSync(join(dir, 'dashboard'), { recursive: true });
      writeFileSync(
        join(dir, 'dashboard', 'worklog.json'),
        JSON.stringify({
          agents: [
            {
              agentId: 'agent-y',
              tasks: [
                { taskId: 't-bad', costUsd: 1, llmCalls: 1, tokens: { input: 1, output: 1 }, lastSeen: 'not-a-date' },
                { taskId: 't-ok', costUsd: 0.5, llmCalls: 1, tokens: { input: 1, output: 1 }, lastSeen: '2026-09-01T00:00:00Z' },
              ],
            },
          ],
        }),
        'utf-8',
      );
      const r = buildBillingReport(dir);
      expect(r!.entries).toHaveLength(1);
      expect(r!.entries[0].tasks).toBe(1);
      expect(r!.totalUsd).toBeCloseTo(0.5, 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
