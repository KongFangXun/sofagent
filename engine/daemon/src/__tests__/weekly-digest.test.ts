// ============================================================
// weekly-digest.test.ts · 理解债务周报巡检（v1.5.1 章二）
// ============================================================
// 覆盖：节点执行统计（复用 worklog 聚合）/ 决策高亮引因果链 / 异常归桶 /
// HITL 介入汇总 / 落盘 dashboard 数据目录（文件名避开 weekly- 前缀）/
// 空数据降级 / 坏 HITL 文件跳过留痕（check-silent-catch 锁）/ 注册表挂载
// （INSPECTORS L2 —— 注册即跑）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDecisionLogPath } from '@sofagent/core';
import { runWeeklyDigest, type WeeklyDigestReport } from '../inspectors/weekly-digest';
import { listInspectors } from '../inspectors/registry';
import { getLayerInspectorNames, runLayeredInspection } from '../inspector-layers';

const ISO_DIR = join(tmpdir(), `sofagent-weekly-digest-${process.pid}`);
process.env.SOFAGENT_DATA = ISO_DIR;

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();

function writeDecisions(entries: Array<Record<string, unknown>>): void {
  mkdirSync(join(ISO_DIR, 'audit'), { recursive: true });
  writeFileSync(
    getDecisionLogPath(ISO_DIR),
    `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`,
    'utf-8',
  );
}

function decision(ts: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts,
    agentId: 'dev-a',
    sessionId: 'sess-1',
    kind: 'ORCHESTRATION',
    moment: 'ACT',
    why: { text: '日常编排' },
    ...overrides,
  };
}

/** 读本次周报落盘文件（digest-* —— 刻意不占 weekly- 前缀） */
function readDigest(): { file: string; report: WeeklyDigestReport } {
  const dir = join(ISO_DIR, 'dashboard');
  const files = readdirSync(dir).filter((f) => f.startsWith('digest-') && f.endsWith('.json'));
  expect(files).toHaveLength(1);
  const file = files[0]!;
  return { file, report: JSON.parse(readFileSync(join(dir, file), 'utf-8')) as WeeklyDigestReport };
}

describe('runWeeklyDigest（@weekly 周报巡检）', () => {
  beforeEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
    mkdirSync(ISO_DIR, { recursive: true });
  });
  afterEach(() => {
    rmSync(ISO_DIR, { recursive: true, force: true });
  });

  it('统计 + 决策高亮 + 异常 + 介入四段齐备，并落盘 dashboard 数据目录', () => {
    const rootTs = minutesAgo(40);
    writeDecisions([
      decision(rootTs, { kind: 'TOOL_GATE', causalType: 'caused', why: { text: '拦截越界写入' } }),
      decision(minutesAgo(30), {
        agentId: 'dev-a',
        sessionId: 'sess-1',
        causalType: 'caused',
        causedBy: [rootTs],
        why: { text: '据拦截结论改派活顺序' },
      }),
      decision(minutesAgo(20), { agentId: 'dev-b', sessionId: 'sess-2', kind: 'FALLBACK_DEGRADE' }),
      decision(minutesAgo(10), {
        agentId: 'dev-b',
        sessionId: 'sess-3',
        kind: 'ESCALATE_REPORT',
        category: 'escalate',
      }),
    ]);
    // HITL：一条已决（本窗口）+ 一条待办
    mkdirSync(join(ISO_DIR, 'hitl', 'resolved'), { recursive: true });
    mkdirSync(join(ISO_DIR, 'hitl', 'pending'), { recursive: true });
    writeFileSync(
      join(ISO_DIR, 'hitl', 'resolved', 'cp-1.json'),
      JSON.stringify({ checkpointId: 'cp-1', decision: 'approve', resolvedAt: minutesAgo(5) }),
      'utf-8',
    );
    writeFileSync(join(ISO_DIR, 'hitl', 'pending', 'cp-2.json'), JSON.stringify({ checkpointId: 'cp-2' }), 'utf-8');

    const result = runWeeklyDigest(ISO_DIR);

    expect(result.name).toBe('weekly-digest');
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('warning'); // 有异常 + 有待办介入

    const { file, report } = readDigest();
    expect(file).toMatch(/^digest-\d{4}-W\d{2}\.json$/);
    expect(report.schemaVersion).toBe('v1');
    expect(report.window.days).toBe(7);

    // ① 节点执行统计（复用 worklog 聚合——两个 agent、三个 session）
    expect(report.nodeStats.totalAgents).toBe(2);
    expect(report.nodeStats.totalTasks).toBe(3);
    expect(report.nodeStats.agents[0]!.firstPassRate).not.toBeNull();

    // ② 决策高亮：引因果链（链深 ≥2），非平铺罗列
    expect(report.decisionHighlights).toHaveLength(1);
    expect(report.decisionHighlights[0]!.depth).toBeGreaterThanOrEqual(2);
    expect(report.decisionHighlights[0]!.chain).toContain('拦截越界写入');
    expect(report.decisionKinds.map((k) => k.kind)).toContain('FALLBACK_DEGRADE');

    // ③ 异常归桶（只读既有 kind 值）
    expect(report.anomalies.degraded).toBe(1);
    expect(report.anomalies.escalated).toBe(1);
    expect(report.anomalies.blocked).toBe(1);
    expect(report.anomalies.total).toBe(3);

    // ④ 介入汇总
    expect(report.interventions.pending).toBe(1);
    expect(report.interventions.resolvedThisWeek).toBe(1);
    expect(report.interventions.resolved[0]!.checkpointId).toBe('cp-1');

    // 数据源均可用 ⇒ 无降级说明
    expect(report.notes).toEqual([]);
  });

  it('窗口外决策/介入不入本周报', () => {
    const oldTs = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    writeDecisions([decision(oldTs, { kind: 'FALLBACK_DEGRADE' })]);
    mkdirSync(join(ISO_DIR, 'hitl', 'resolved'), { recursive: true });
    writeFileSync(
      join(ISO_DIR, 'hitl', 'resolved', 'cp-old.json'),
      JSON.stringify({ checkpointId: 'cp-old', decision: 'reject', resolvedAt: oldTs }),
      'utf-8',
    );

    const result = runWeeklyDigest(ISO_DIR);

    const { report } = readDigest();
    expect(report.anomalies.total).toBe(0);
    expect(report.interventions.resolvedThisWeek).toBe(0);
    expect(report.decisionHighlights).toHaveLength(0);
    expect(result.triggered).toBe(false); // 窗口内无活动
    expect(result.severity).toBe('info');
  });

  it('空数据降级：照常落盘 + 不静默（缺数据源时 notes 留痕）', () => {
    const result = runWeeklyDigest(ISO_DIR);

    const { report } = readDigest();
    expect(report.nodeStats.totalTasks).toBe(0);
    expect(report.decisionHighlights).toEqual([]);
    expect(report.interventions.pending).toBe(0);
    expect(result.name).toBe('weekly-digest');
    expect(existsSync(join(ISO_DIR, 'dashboard'))).toBe(true);
  });

  it('坏 HITL 文件跳过必须留痕（badFiles>0 → notes 一次汇总一行，好文件仍计入）', () => {
    // 静默吞错门禁 check-silent-catch 锁：这条降级可见性不得被重构退回失明
    // （本仓「降级失明」历史形态）——2 个坏 JSON + 1 个本窗口内的好 JSON。
    mkdirSync(join(ISO_DIR, 'hitl', 'resolved'), { recursive: true });
    writeFileSync(join(ISO_DIR, 'hitl', 'resolved', 'bad-1.json'), '{ not json', 'utf-8');
    writeFileSync(join(ISO_DIR, 'hitl', 'resolved', 'bad-2.json'), '{ broken', 'utf-8');
    writeFileSync(
      join(ISO_DIR, 'hitl', 'resolved', 'cp-good.json'),
      JSON.stringify({ checkpointId: 'cp-good', decision: 'approve', resolvedAt: minutesAgo(5) }),
      'utf-8',
    );

    const result = runWeeklyDigest(ISO_DIR);
    const { report } = readDigest();

    // ① 跳过数留痕（一次汇总一行，不逐文件刷屏）
    expect(report.notes).toHaveLength(1);
    expect(report.notes[0]).toContain('有 2 个文件无法解析');
    expect(report.notes[0]).toContain('已跳过');
    // ② 好文件照常计入——坏文件不拖垮聚合
    expect(report.interventions.resolvedThisWeek).toBe(1);
    expect(report.interventions.resolved[0]!.checkpointId).toBe('cp-good');
    // ③ 同一个 notes 通道也透出到巡检结果（双出口可见）
    expect(result.message).toContain('降级 1 项');
  });

  it('注册点：INSPECTORS 的 L2 名单含 weekly-digest，且分层调度真跑到它', () => {
    expect(getLayerInspectorNames('L2')).toContain('weekly-digest');
    expect(listInspectors('L2')).toContain('weekly-digest');

    const layered = runLayeredInspection(ISO_DIR, 'L2');
    expect(layered.results.map((r) => r.name)).toContain('weekly-digest');
  });
});
