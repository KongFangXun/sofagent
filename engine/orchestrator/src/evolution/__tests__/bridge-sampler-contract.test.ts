// ============================================================
// evolution/__tests__/bridge-sampler-contract.test.ts · 采样器↔桥契约测试
// v1.4.5 Phase 4 尾巴新增（跨包对拍回归锁）
//
// 背景：daemon continuous-sampler（D3）落盘 samples-<date>.json 为
// JSONL 行式 DailySample（计数器 + 可选明细四件）；本桥（D4）
// 双格式读侧消费。Phase 4 明细扩展后此契约测试锁定两侧对接面：
//   一、带明细四件的 DailySample 行 → 桥读侧透传（生产链路全通）
// 二、无明细旧格式行（D3 原形态）→ 桥读侧空数组降级（向后兼容）
//   三、单行 JSONL 命中桥的对象分支时 evalPassRate/knowledgeDelta
//       数字字段正确映射（合流时发现的丢分路径回归锁）
//
// 注：明细数据形态与 daemon 侧 continuous-sampler.ts 的
// CorrectionBackflow/LowScoreFeedback/RepeatFailure/ToolUsageStat
// 字段级对齐（两侧独立声明同构类型——daemon→orchestrator 依赖
// 方向不可反向 import）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { readEvolutionSamples, readLatestEvolutionSample } from '../evolution-samples';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-bridge-contract-'));
}

describe('采样器↔桥契约（DailySample JSONL 行 → 桥读侧）', () => {
  let home: string;
  let dataDir: string;

  beforeEach(() => {
    home = tmpHome();
    process.env.SOFAGENT_HOME = home;
    process.env.SOFAGENT_DATA = path.join(home, 'data');
    dataDir = process.env.SOFAGENT_DATA;
    fs.mkdirSync(path.join(dataDir, 'evolution'), { recursive: true });
  });

  afterEach(() => {
    delete process.env.SOFAGENT_HOME;
    delete process.env.SOFAGENT_DATA;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
  });

  // 用例一：带明细四件的行 → 透传
  it('明细四件（correctionBackflow/lowScoreFeedback/repeatFailures/toolUsage）透传', () => {
    const date = '2026-09-05';
    const row = {
      date,
      evalPassRate: 0.7,
      evalCaseCount: 10,
      knowledgeEntities: 5,
      knowledgeDelta: 1,
      correctionReflows: 2,
      dreamCycleComplete: true,
      providerStatus: 'real',
      correctionBackflow: [
        { capabilityId: 'cap-x', correctedBy: 'rater-1', score: 0.3, comment: '应为 JSON', correctedAt: `${date}T10:00:00.000Z` },
      ],
      lowScoreFeedback: [{ capabilityId: 'cap-x', raterId: 'rater-1', score: 0.3 }],
      repeatFailures: [{ capabilityId: 'cap-x', failCount: 2, lastReason: '参数不合法' }],
      toolUsage: [{ toolName: 'cap-x', invokeCount: 3, successRate: 0.333 }],
      sampledAt: `${date}T23:00:00.000Z`,
    };
    fs.writeFileSync(
      path.join(dataDir, 'evolution', `samples-${date}.json`),
      JSON.stringify(row) + '\n',
      'utf-8',
    );
    const samples = readEvolutionSamples(dataDir);
    expect(samples.length).toBe(1);
    const s = samples[0]!;
    expect(s.correctionBackflow.length).toBe(1);
    expect(s.correctionBackflow[0]!.capabilityId).toBe('cap-x');
    expect(s.correctionBackflow[0]!.comment).toContain('JSON');
    expect(s.lowScoreFeedback.length).toBe(1);
    expect(s.repeatFailures[0]!.failCount).toBe(2);
    expect(s.repeatFailures[0]!.lastReason).toBe('参数不合法');
    expect(s.toolUsage[0]!.invokeCount).toBe(3);
    expect(s.toolUsage[0]!.successRate).toBeCloseTo(0.333, 3);
  });

  // 用例二：无明细旧格式行 → 空数组降级（向后兼容）
  it('无明细旧格式行（D3 原形态）→ 空数组降级不破', () => {
    const date = '2026-09-04';
    const row = {
      date,
      evalPassRate: null,
      evalCaseCount: 0,
      knowledgeEntities: 3,
      knowledgeDelta: 3,
      correctionReflows: 0,
      dreamCycleComplete: true,
      providerStatus: 'real',
      sampledAt: `${date}T23:00:00.000Z`,
    };
    fs.writeFileSync(
      path.join(dataDir, 'evolution', `samples-${date}.json`),
      JSON.stringify(row) + '\n',
      'utf-8',
    );
    const samples = readEvolutionSamples(dataDir);
    expect(samples.length).toBe(1);
    expect(samples[0]!.correctionBackflow).toEqual([]);
    expect(samples[0]!.lowScoreFeedback).toEqual([]);
    expect(samples[0]!.repeatFailures).toEqual([]);
    expect(samples[0]!.toolUsage).toEqual([]);
  });

  // 用例三：单行 JSONL 命中对象分支 → 数字字段映射回归锁
  it('单行 JSONL 对象分支：evalPassRate→单点曲线 / knowledgeDelta 数字→concepts', () => {
    const date = '2026-09-03';
    const row = {
      date,
      evalPassRate: 0.85,
      evalCaseCount: 20,
      knowledgeEntities: 8,
      knowledgeDelta: 4,
      correctionReflows: 1,
      dreamCycleComplete: true,
      providerStatus: 'real',
      sampledAt: `${date}T23:00:00.000Z`,
    };
    fs.writeFileSync(
      path.join(dataDir, 'evolution', `samples-${date}.json`),
      JSON.stringify(row) + '\n',
      'utf-8',
    );
    const samples = readEvolutionSamples(dataDir);
    expect(samples.length).toBe(1);
    // Phase 4 合流修复回归锁：此前对象分支静默丢弃这两个数字字段
    expect(samples[0]!.evalCurve).toEqual([{ date, passRate: 0.85 }]);
    expect(samples[0]!.knowledgeDelta).toEqual({ concepts: 4, atoms: 0 });
  });

  // 用例四：多日文件升序 + readLatestEvolutionSample 取最新
  it('多样本文件按日期升序，latest 取最新一日', () => {
    for (const date of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      fs.writeFileSync(
        path.join(dataDir, 'evolution', `samples-${date}.json`),
        JSON.stringify({ date, evalPassRate: 0.5, providerStatus: 'real' }) + '\n',
        'utf-8',
      );
    }
    const samples = readEvolutionSamples(dataDir);
    expect(samples.map((s) => s.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(readLatestEvolutionSample(dataDir)?.date).toBe('2026-09-03');
  });
});
