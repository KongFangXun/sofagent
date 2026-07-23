// ============================================================
// ab-history.test.ts · A/B 历史指标持久化测试
// v1.1.8 新增
//
// 覆盖：jsonl 读写 / 聚合统计 / 截断保留 K=100 / 重启恢复（读
// 已存在文件）/ 损坏行跳过——对应 T03 验收 ≥5 case。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  appendMetrics,
  readAll,
  aggregateRecent,
  truncateToLastK,
  HISTORY_MAX_ENTRIES,
  type PlanMetrics,
} from '../ab-history';

function makeMetrics(overrides: Partial<PlanMetrics> = {}): PlanMetrics {
  return {
    plan: 'A-step-by-step',
    task: '生成周度巡检报告',
    timestamp: new Date().toISOString(),
    passed: 8,
    failed: 2,
    duration: 12000,
    qualityScore: 80,
    ...overrides,
  };
}

describe('ab-history · jsonl 读写', () => {
  let tmpDir: string;
  let historyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-abhist-'));
    historyPath = path.join(tmpDir, 'ab-history.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('case 1 · appendMetrics 追加后可 readAll 读回（字段完整往返）', () => {
    appendMetrics(historyPath, makeMetrics({ plan: 'B-domain', passed: 9, failed: 1 }));
    appendMetrics(historyPath, makeMetrics({ plan: 'B-domain', passed: 7, failed: 3, failureTag: 'audit-FAIL' }));

    const all = readAll(historyPath);
    expect(all).toHaveLength(2);
    expect(all[0]!.plan).toBe('B-domain');
    expect(all[0]!.passed).toBe(9);
    expect(all[0]!.failed).toBe(1);
    expect(all[1]!.failureTag).toBe('audit-FAIL');
  });

  it('case 2 · 文件不存在时 readAll 返回空数组（首次运行场景）', () => {
    expect(readAll(path.join(tmpDir, 'nonexistent.jsonl'))).toEqual([]);
  });

  it('case 3 · 损坏行跳过不阻塞（best-effort 读取）', () => {
    const good = JSON.stringify(makeMetrics({ plan: 'C-risk' }));
    fs.writeFileSync(historyPath, `${good}\n{broken json\n\n${good}\n`, 'utf-8');
    const all = readAll(historyPath);
    expect(all).toHaveLength(2);
    expect(all.every((m) => m.plan === 'C-risk')).toBe(true);
  });
});

describe('ab-history · aggregateRecent 聚合统计', () => {
  let tmpDir: string;
  let historyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-abhist-agg-'));
    historyPath = path.join(tmpDir, 'ab-history.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('case 4 · 聚合最近 N 次：avgPassRate / avgDuration / failureClusters 正确', () => {
    // A 方案 3 条：通过率 100% / 50% / 75%（平均 75%），耗时 100/200/300（平均 200）
    appendMetrics(historyPath, makeMetrics({ plan: 'A-step-by-step', passed: 10, failed: 0, duration: 100 }));
    appendMetrics(historyPath, makeMetrics({ plan: 'A-step-by-step', passed: 5, failed: 5, duration: 200, failureTag: 'timeout' }));
    appendMetrics(historyPath, makeMetrics({ plan: 'A-step-by-step', passed: 3, failed: 1, duration: 300, failureTag: 'timeout' }));
    // 干扰项：B 方案不应混入 A 的聚合
    appendMetrics(historyPath, makeMetrics({ plan: 'B-domain', passed: 1, failed: 9 }));

    const agg = aggregateRecent(historyPath, 'A-step-by-step', 10);
    expect(agg.plan).toBe('A-step-by-step');
    expect(agg.sampleSize).toBe(3);
    expect(agg.avgPassRate).toBeCloseTo(75, 1);
    expect(agg.avgDuration).toBe(200);
    expect(agg.failureClusters['timeout']).toBe(2);
  });

  it('case 5 · 只取最近 N 条（窗口滑动，旧数据不参与）', () => {
    // 先写 2 条差成绩，再写 2 条好成绩；n=2 只应聚合后两条
    appendMetrics(historyPath, makeMetrics({ plan: 'B-domain', passed: 0, failed: 10, duration: 500 }));
    appendMetrics(historyPath, makeMetrics({ plan: 'B-domain', passed: 0, failed: 10, duration: 500 }));
    appendMetrics(historyPath, makeMetrics({ plan: 'B-domain', passed: 10, failed: 0, duration: 100 }));
    appendMetrics(historyPath, makeMetrics({ plan: 'B-domain', passed: 10, failed: 0, duration: 100 }));

    const agg = aggregateRecent(historyPath, 'B-domain', 2);
    expect(agg.sampleSize).toBe(2);
    expect(agg.avgPassRate).toBe(100);
    expect(agg.avgDuration).toBe(100);
  });

  it('case 6 · 无该方案历史时返回零值骨架（sampleSize=0）', () => {
    appendMetrics(historyPath, makeMetrics({ plan: 'A-step-by-step' }));
    const agg = aggregateRecent(historyPath, 'D-tdd', 10);
    expect(agg).toEqual({ plan: 'D-tdd', sampleSize: 0, avgPassRate: 0, avgDuration: 0, failureClusters: {} });
  });
});

describe('ab-history · 截断与重启恢复', () => {
  let tmpDir: string;
  let historyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-abhist-trunc-'));
    historyPath = path.join(tmpDir, 'ab-history.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('case 7 · truncateToLastK 保留最近 K 条（旧数据被截掉）', () => {
    for (let i = 0; i < 10; i++) {
      appendMetrics(historyPath, makeMetrics({ plan: 'A-step-by-step', task: `task-${i}` }));
    }
    truncateToLastK(historyPath, 3);
    const all = readAll(historyPath);
    expect(all).toHaveLength(3);
    // 保留的是最后 3 条（task-7/8/9）
    expect(all.map((m) => m.task)).toEqual(['task-7', 'task-8', 'task-9']);
  });

  it('case 8 · appendMetrics 超过 K=100 自动截断（jsonl 不无限膨胀）', () => {
    const total = HISTORY_MAX_ENTRIES + 20;
    for (let i = 0; i < total; i++) {
      appendMetrics(historyPath, makeMetrics({ plan: 'A-step-by-step', task: `t-${i}` }));
    }
    const all = readAll(historyPath);
    expect(all).toHaveLength(HISTORY_MAX_ENTRIES);
    // 最近一条仍在（截断保留尾部）
    expect(all[all.length - 1]!.task).toBe(`t-${total - 1}`);
  });

  it('case 9 · 重启恢复：进程重启后读已存在 jsonl 状态完整（无内存态依赖）', () => {
    appendMetrics(historyPath, makeMetrics({ plan: 'C-risk', passed: 6, failed: 4 }));
    // 模拟重启——新一次 readAll（无任何内存缓存参与）
    const recovered = readAll(historyPath);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.plan).toBe('C-risk');
    expect(recovered[0]!.passed).toBe(6);
    // 恢复后可继续追加
    appendMetrics(historyPath, makeMetrics({ plan: 'C-risk', passed: 9, failed: 1 }));
    expect(readAll(historyPath)).toHaveLength(2);
  });
});
