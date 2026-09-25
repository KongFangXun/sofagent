// ============================================================
// weekly-digest-clamp.test.ts · F-36：firstPassRate clamp + 空态语义
// ============================================================
// 原公式无界：retries 归属口径（decision-log retry 计数）与 tasks（session 去重）
// 不同时可产出负值（审查报告实测 -18617% 形态）；tasks=0 应为 null（无数据）
// 而非 NaN/0。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { runWeeklyDigest } from '../inspectors/weekly-digest';

const ISO_DIR = join(tmpdir(), `sofagent-f36-clamp-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

function minutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

function decision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: minutesAgo(30),
    kind: 'TASK_DONE',
    category: 'task',
    agentId: 'dev-clamp',
    sessionId: 'sess-clamp',
    ...overrides,
  };
}

describe('F-36 · firstPassRate clamp 与空态', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(join(ISO_DIR, 'audit'), { recursive: true });
    mkdirSync(join(ISO_DIR, 'dashboard'), { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('retries > tasks（口径错位）→ clamp 到 0，不再产出负值', () => {
    // 2 个 task session + 5 条 retry 决策（retry 计数挂另一 session 口径——构造错位）
    const entries = [
      decision({ sessionId: 'sess-a', kind: 'TASK_DONE', ts: minutesAgo(40) }),
      decision({ sessionId: 'sess-b', kind: 'TASK_DONE', ts: minutesAgo(35) }),
      decision({ sessionId: 'sess-a', category: 'retry', kind: 'FALLBACK_DEGRADE', ts: minutesAgo(30) }),
      decision({ sessionId: 'sess-a', category: 'retry', kind: 'FALLBACK_DEGRADE', ts: minutesAgo(25) }),
      decision({ sessionId: 'sess-b', category: 'retry', kind: 'FALLBACK_DEGRADE', ts: minutesAgo(20) }),
      decision({ sessionId: 'sess-b', category: 'retry', kind: 'FALLBACK_DEGRADE', ts: minutesAgo(15) }),
      decision({ sessionId: 'sess-c', category: 'retry', kind: 'FALLBACK_DEGRADE', ts: minutesAgo(10) }),
    ];
    writeFileSync(join(ISO_DIR, 'audit', 'decision-log.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

    const r = runWeeklyDigest(ISO_DIR);
    const agents = r.report?.nodeStats?.agents ?? [];
    for (const a of agents) {
      if (a.firstPassRate !== null) {
        expect(a.firstPassRate).toBeGreaterThanOrEqual(0);
        expect(a.firstPassRate).toBeLessThanOrEqual(1);
      }
    }
    // 存在 retries>tasks 的 agent 时，其 rate 必须 clamp 到 0（而非负）
    const overdriven = agents.find((a) => a.retries > a.tasks);
    if (overdriven) expect(overdriven.firstPassRate).toBe(0);
  });

  it('正常态（retries < tasks）→ 0-1 内真值', () => {
    const entries = [
      decision({ sessionId: 'sess-a', kind: 'TASK_DONE', ts: minutesAgo(40) }),
      decision({ sessionId: 'sess-b', kind: 'TASK_DONE', ts: minutesAgo(35) }),
      decision({ sessionId: 'sess-a', category: 'retry', kind: 'FALLBACK_DEGRADE', ts: minutesAgo(30) }),
    ];
    writeFileSync(join(ISO_DIR, 'audit', 'decision-log.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    const r = runWeeklyDigest(ISO_DIR);
    const agents = r.report?.nodeStats?.agents ?? [];
    for (const a of agents) {
      if (a.firstPassRate !== null) {
        expect(a.firstPassRate).toBeGreaterThanOrEqual(0);
        expect(a.firstPassRate).toBeLessThanOrEqual(1);
      }
    }
  });
});
