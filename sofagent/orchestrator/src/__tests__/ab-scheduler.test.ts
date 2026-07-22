// ============================================================
// ab-scheduler.test.ts · A/B 自动调度状态机测试
// v1.1.8 新增
//
// 覆盖：状态机四阶段转换 / 阈值判定 / promote 逻辑 / 探索队列
// 管理 / 状态持久化重启恢复——对应 T03 验收 ≥8 case。
//
// 全部经 deps.executePlan 注入 mock（零网络零 LLM）；
// deps.now 注入固定时间戳保证断言确定性。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runABScheduledTask,
  checkThreshold,
  startExploration,
  judgeAndPromote,
  loadState,
  saveState,
  initialState,
  planToVariant,
  DEFAULT_THRESHOLD,
  DEFAULT_PROMOTE_THRESHOLD,
  type ABSchedulerState,
  type RunOutcome,
} from '../ab-scheduler';
import { appendMetrics, readAll, type PlanMetrics } from '../ab-history';

const NOW = '2026-07-22T12:00:00.000Z';

function makeOutcome(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return { passed: 10, failed: 0, duration: 1000, qualityScore: 100, ...overrides };
}

/** 构造处于指定状态的状态机（直接写字段，不走 runABScheduledTask） */
function makeState(overrides: Partial<ABSchedulerState> = {}): ABSchedulerState {
  return { ...initialState({ threshold: 3 }, NOW), ...overrides };
}

describe('ab-scheduler · 状态机纯函数', () => {
  it('case 1 · checkThreshold：currentRunCount 达阈值且队列非空 → 启动探索', () => {
    const state = makeState({ currentRunCount: 3, exploreCandidates: ['B-domain', 'C-risk'] });
    const next = checkThreshold(state, NOW);
    expect(next.candidatePlan).toBe('B-domain');
    expect(next.candidateRunCount).toBe(0);
    expect(next.exploreCandidates).toEqual(['C-risk']);
    expect(next.lastPhase).toBe('explore');
  });

  it('case 2 · checkThreshold 幂等：未达阈值 / 已在探索 / 队列空 → 原状态不动', () => {
    // 未达阈值
    const below = makeState({ currentRunCount: 2 });
    expect(checkThreshold(below, NOW)).toBe(below);
    // 已在探索（candidatePlan 非 null）
    const exploring = makeState({ currentRunCount: 5, candidatePlan: 'B-domain' });
    expect(checkThreshold(exploring, NOW)).toBe(exploring);
    // 队列空
    const emptyQueue = makeState({ currentRunCount: 9, exploreCandidates: [] });
    expect(checkThreshold(emptyQueue, NOW)).toBe(emptyQueue);
  });

  it('case 3 · startExploration：队首出队为候选；空队列返回原状态', () => {
    const state = makeState({ exploreCandidates: ['C-risk', 'D-tdd'] });
    const next = startExploration(state, NOW);
    expect(next.candidatePlan).toBe('C-risk');
    expect(next.exploreCandidates).toEqual(['D-tdd']);
    // 空队列
    const empty = makeState({ exploreCandidates: [] });
    expect(startExploration(empty, NOW)).toBe(empty);
  });

  it('case 4 · planToVariant：方案 ID 首字母映射 ComposeVariant，未知回退 A', () => {
    expect(planToVariant('A-step-by-step')).toBe('A');
    expect(planToVariant('B-domain')).toBe('B');
    expect(planToVariant('C-risk')).toBe('C');
    expect(planToVariant('D-tdd')).toBe('D');
    expect(planToVariant('unknown-plan')).toBe('A');
  });
});

describe('ab-scheduler · judgeAndPromote 判定与 promote', () => {
  let tmpDir: string;
  let historyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-absched-'));
    historyPath = path.join(tmpDir, 'ab-history.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  function seedHistory(plan: string, passRate: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const passed = Math.round(passRate / 10);
      appendMetrics(historyPath, {
        plan,
        task: '真实任务',
        timestamp: NOW,
        passed,
        failed: 10 - passed,
        duration: 1000,
        qualityScore: passRate,
      } satisfies PlanMetrics);
    }
  }

  it('case 5 · 候选胜出但未达 promoteThreshold → 连胜+1，候选保留继续累积', async () => {
    seedHistory('A-step-by-step', 50, 3);
    seedHistory('B-domain', 90, 3);
    const state = makeState({
      candidatePlan: 'B-domain',
      candidateRunCount: 3,
      consecutiveWins: 0,
      promoteThreshold: 2,
    });
    const next = await judgeAndPromote(state, historyPath, { writeGraphState: () => '' });
    expect(next.consecutiveWins).toBe(1);
    expect(next.candidatePlan).toBe('B-domain'); // 同候选继续
    expect(next.currentPlan).toBe('A-step-by-step'); // 未 promote
    expect(next.lastPhase).toBe('judge');
  });

  it('case 6 · 候选连续胜出达阈值 → promote：转正 + 旧方案回队尾 + 触发控制图落盘', async () => {
    seedHistory('A-step-by-step', 50, 3);
    seedHistory('B-domain', 90, 3);
    const graphCalls: string[] = [];
    const state = makeState({
      candidatePlan: 'B-domain',
      candidateRunCount: 3,
      consecutiveWins: 1, // 已胜 1 次，本次再胜即达阈值 2
      promoteThreshold: 2,
      exploreCandidates: ['C-risk'],
    });
    const next = await judgeAndPromote(state, historyPath, {
      writeGraphState: (loopId: string) => { graphCalls.push(loopId); return loopId; },
    });
    expect(next.currentPlan).toBe('B-domain'); // promote 转正
    expect(next.candidatePlan).toBeNull(); // 回利用阶段
    expect(next.consecutiveWins).toBe(0);
    expect(next.currentRunCount).toBe(0);
    // 旧 currentPlan 回探索队尾
    expect(next.exploreCandidates).toEqual(['C-risk', 'A-step-by-step']);
    // 联动交付三：writeControlGraphState 被触发
    expect(graphCalls).toHaveLength(1);
    expect(graphCalls[0]).toContain('ab-promote-B-domain');
  });

  it('case 7 · 候选未胜出 → 连胜清零 + 换下一个候选；队列空回利用并重置计数', async () => {
    seedHistory('A-step-by-step', 90, 3);
    seedHistory('B-domain', 40, 3);
    const state = makeState({
      candidatePlan: 'B-domain',
      candidateRunCount: 3,
      consecutiveWins: 1,
      exploreCandidates: ['C-risk'],
      currentRunCount: 7,
    });
    const next = await judgeAndPromote(state, historyPath, { writeGraphState: () => '' });
    expect(next.consecutiveWins).toBe(0);
    expect(next.candidatePlan).toBe('C-risk'); // 换下一个候选
    expect(next.candidateRunCount).toBe(0);
    expect(next.currentPlan).toBe('A-step-by-step');

    // 队列空场景：回利用并重置 currentRunCount
    seedHistory('D-tdd', 10, 3);
    const exhausted = makeState({
      candidatePlan: 'D-tdd',
      candidateRunCount: 3,
      exploreCandidates: [],
      currentRunCount: 7,
    });
    const back = await judgeAndPromote(exhausted, historyPath, { writeGraphState: () => '' });
    expect(back.candidatePlan).toBeNull();
    expect(back.currentRunCount).toBe(0); // 转正方案重新累积
  });
});

describe('ab-scheduler · runABScheduledTask 主入口（全链路 mock）', () => {
  let tmpDir: string;
  let statePath: string;
  let historyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-abrun-'));
    statePath = path.join(tmpDir, 'ab-scheduler-state.json');
    historyPath = path.join(tmpDir, 'ab-history.jsonl');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('case 8 · 利用阶段：跑当前方案 + 指标入 jsonl + currentRunCount 递增 + 状态落盘', async () => {
    const executed: string[] = [];
    const state = await runABScheduledTask(
      statePath,
      { threshold: 2, task: '生成周报' },
      {
        now: () => NOW,
        executePlan: async (plan) => { executed.push(plan); return makeOutcome(); },
      },
      historyPath,
    );
    expect(executed).toEqual(['A-step-by-step']); // 默认当前方案
    expect(state.currentRunCount).toBe(1);
    expect(state.lastPhase).toBe('exploit');
    // 指标落 jsonl
    const history = readAll(historyPath);
    expect(history).toHaveLength(1);
    expect(history[0]!.plan).toBe('A-step-by-step');
    expect(history[0]!.passed).toBe(10);
    // 状态持久化
    expect(fs.existsSync(statePath)).toBe(true);
    const reloaded = loadState(statePath);
    expect(reloaded.currentRunCount).toBe(1);
  });

  it('case 9 · 利用满阈值 → 自动切探索；候选跑满 → 判定 promote 全链路', async () => {
    // 候选 B 永远满分，当前 A 永远 50 分 → B 两次判定胜出后 promote
    const executePlan = async (plan: string): Promise<RunOutcome> =>
      plan.startsWith('B') ? makeOutcome({ passed: 10, failed: 0 }) : makeOutcome({ passed: 5, failed: 5 });

    const config = { threshold: 1, variants: ['B-domain'], promoteThreshold: 2, task: '真实任务' };
    const deps = { now: () => NOW, executePlan, writeGraphState: () => '' };

    // tick 1：利用 A（1/1 满）→ tick 2 切探索
    let s = await runABScheduledTask(statePath, config, deps, historyPath);
    expect(s.lastPhase).toBe('exploit');
    s = await runABScheduledTask(statePath, config, deps, historyPath);
    expect(s.candidatePlan).toBe('B-domain');
    expect(s.lastPhase).toBe('explore');

    // tick 3：探索 B 跑一轮（1/1 满）→ tick 4 判定：B 胜（连胜 1，未达 2，继续累积）
    s = await runABScheduledTask(statePath, config, deps, historyPath);
    expect(s.lastPhase).toBe('explore');
    expect(s.candidateRunCount).toBe(1);
    s = await runABScheduledTask(statePath, config, deps, historyPath);
    expect(s.lastPhase).toBe('judge');
    expect(s.consecutiveWins).toBe(1);
    expect(s.candidatePlan).toBe('B-domain');

    // tick 5：B 再跑一轮 → tick 6 判定：连胜 2 达阈值 → promote
    s = await runABScheduledTask(statePath, config, deps, historyPath);
    s = await runABScheduledTask(statePath, config, deps, historyPath);
    expect(s.currentPlan).toBe('B-domain'); // 转正
    expect(s.candidatePlan).toBeNull();
    expect(s.consecutiveWins).toBe(0);
    expect(s.exploreCandidates).toContain('A-step-by-step'); // 旧方案回队尾
  });

  it('case 10 · 重启恢复：中途状态从 statePath 读回继续推进（无内存态）', async () => {
    // 预置一个跑到一半的状态（模拟上次 daemon 退出前落盘）
    saveState(statePath, makeState({ currentRunCount: 1, threshold: 3 }));
    const state = await runABScheduledTask(
      statePath,
      { threshold: 3, task: '真实任务' },
      { now: () => NOW, executePlan: async () => makeOutcome() },
      historyPath,
    );
    // 从 1 继续 → 2，不被重置
    expect(state.currentRunCount).toBe(2);
    // 损坏文件回退初始状态（best-effort 不阻塞 cron）
    fs.writeFileSync(statePath, '{corrupted!!!', 'utf-8');
    const recovered = loadState(statePath, { threshold: 5 });
    expect(recovered.currentRunCount).toBe(0);
    expect(recovered.threshold).toBe(5);
  });

  it('case 11 · task 为空串时纯推进状态机不跑任务（调度 tick）', async () => {
    let called = 0;
    const state = await runABScheduledTask(
      statePath,
      { threshold: 2, task: '' },
      { now: () => NOW, executePlan: async () => { called++; return makeOutcome(); } },
      historyPath,
    );
    expect(called).toBe(0); // executePlan 未被调用
    expect(state.currentRunCount).toBe(1); // 计数仍推进
    expect(readAll(historyPath)).toHaveLength(0); // 无指标写入
  });
});

describe('ab-scheduler · 常量对齐', () => {
  it('case 12 · 默认常量对齐设计（threshold=10 / promote=2 对齐 CONSECUTIVE_WINS_REQUIRED）', () => {
    expect(DEFAULT_THRESHOLD).toBe(10);
    expect(DEFAULT_PROMOTE_THRESHOLD).toBe(2);
    const init = initialState({}, NOW);
    expect(init.currentPlan).toBe('A-step-by-step');
    expect(init.exploreCandidates).toEqual(['B-domain', 'C-risk', 'D-tdd']);
    expect(init.lastPhase).toBe('idle');
  });
});
