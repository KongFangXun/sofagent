// ============================================================
// attribution.test.ts · ATTRIBUTION 归因引擎测试（P2 · v1.3.9 十）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AttributionEngine } from '../worklog/attribution';

describe('AttributionEngine · 归因引擎', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-attribution-'));
    // 造 decision-log：两个 agent 的决策
    fs.mkdirSync(path.join(dataDir, 'audit'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'audit', 'decision-log.jsonl'), [
      JSON.stringify({ id: 'd-001', agentId: 'audit', kind: 'RULE_TOGGLE', ts: '2026-08-20T10:00:00Z' }),
      JSON.stringify({ id: 'd-002', agentId: 'refine', kind: 'EVOLUTION', ts: '2026-08-20T11:00:00Z' }),
      JSON.stringify({ id: 'd-003', agentId: 'audit', kind: 'KNOWLEDGE_DISTILL', ts: '2026-08-20T12:00:00Z' }),
    ].join('\n') + '\n');
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('因果链定义落盘：link() 追加 attribution.jsonl 且结构符合 {decision_id, business_metric, delta, confidence, timestamp}', () => {
    const engine = new AttributionEngine({ dataDir });
    const entry = engine.link({
      decision_id: 'd-001',
      business_metric: 'manual_review_hours',
      delta: -3.5,
      confidence: 0.9,
    });
    expect(entry.timestamp).toBeTruthy();
    const file = path.join(dataDir, 'dashboard', 'attribution.jsonl');
    expect(fs.existsSync(file)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf-8').trim());
    expect(persisted).toMatchObject({ decision_id: 'd-001', business_metric: 'manual_review_hours', delta: -3.5, confidence: 0.9 });
  });

  it('记录可关联 decisionId + agentId（查询按三维过滤）', () => {
    const engine = new AttributionEngine({ dataDir });
    engine.link({ decision_id: 'd-001', business_metric: 'deploy_success_rate', delta: 0.12, confidence: 1 });
    engine.link({ decision_id: 'd-002', business_metric: 'deploy_success_rate', delta: 0.03, confidence: 0.6 });
    engine.link({ decision_id: 'd-003', business_metric: 'manual_review_hours', delta: -1.0, confidence: 0.8 });

    expect(engine.query({ metric: 'deploy_success_rate' })).toHaveLength(2);
    expect(engine.query({ decisionId: 'd-002' })).toHaveLength(1);
    expect(engine.query({ agentId: 'audit' })).toHaveLength(2);  // d-001 + d-003
    expect(engine.query({ agentId: 'refine' })).toHaveLength(1); // d-002
    expect(engine.query()).toHaveLength(3);
  });

  it('归因接口可用：byAgent 联结面 + 置信度校验', () => {
    const engine = new AttributionEngine({ dataDir });
    engine.link({ decision_id: 'd-001', business_metric: 'm1', delta: 1, confidence: 0.5 });
    expect(engine.byAgent('audit')).toHaveLength(1);
    expect(() => engine.link({ decision_id: 'x', business_metric: 'm', delta: 1, confidence: 1.5 }))
      .toThrow('confidence');
  });

  it('周报 Top 5：高影响（|delta|×confidence 排序）与低效（负 delta 优先复核）', () => {
    const engine = new AttributionEngine({ dataDir });
    engine.link({ decision_id: 'd-001', business_metric: 'uptime', delta: 5, confidence: 0.9 });   // 影响分 4.5
    engine.link({ decision_id: 'd-002', business_metric: 'uptime', delta: -8, confidence: 0.4 });  // 影响分 3.2
    engine.link({ decision_id: 'd-003', business_metric: 'cost', delta: -2, confidence: 1 });      // 影响分 2

    const top = engine.topImpact(2);
    expect(top[0]?.decision_id).toBe('d-001'); // 4.5 最高
    expect(top).toHaveLength(2);

    const inefficient = engine.topInefficient(5);
    expect(inefficient.every((l) => l.delta < 0)).toBe(true);
    expect(inefficient.map((l) => l.decision_id)).toEqual(['d-002', 'd-003']); // -8×0.4 最负 → -2×1
  });

  it('重启回放：既有 attribution.jsonl 读回（跨会话归因可查）', () => {
    const first = new AttributionEngine({ dataDir });
    first.link({ decision_id: 'd-001', business_metric: 'm', delta: 1, confidence: 1 });
    const second = new AttributionEngine({ dataDir }); // 新实例=跨会话
    expect(second.query()).toHaveLength(1);
    expect(second.query()[0]?.decision_id).toBe('d-001');
  });
});
