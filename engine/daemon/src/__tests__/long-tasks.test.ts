// ============================================================
// long-tasks.test.ts · 异步长任务自治测试（v1.3.8 交付四）
//
// 覆盖验收标准：
//   ① cron 三档糖：@daily/@weekly/@monthly 宏展开为底层 5 段表达式
//   ② 依赖图：前任务最近一次 run PASS 才触发后任务；否则 SKIPPED + skipped-reason
//   ③ WAL 续跑联动：onCrashRecovery 回调读 wal.jsonl 未完成条目（不跨包依赖）
//   ④ 注册表：.sofagent/long-tasks.yml 读写（js-yaml——daemon 既有依赖）
//   ⑤ 死循环检测：连续 N 次（默认 6）输出无变化 → daemon-health.json warnings 告警
//   ⑥ backoffOnWait：上次 WAITING → 下轮间隔 ×2，材料变化恢复原间隔
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  expandScheduleMacro,
  isCronMacro,
  loadLongTaskRegistry,
  saveLongTaskRegistry,
  longTasksRegistryPath,
  trackNoProgress,
  appendLongTaskWarning,
  readUnfinishedWalEntries,
  createLongTaskScheduler,
  DEFAULT_MAX_NO_CHANGE_RUNS,
  type LongTaskSpec,
  type LongTaskRegistry,
} from '../long-tasks';
import { expandCronSugar, nextCronTime } from '../scheduler';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-lt-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('long-tasks · cron 三档糖', () => {
  it('@daily → 0 0 * * *（每天 00:00）', () => {
    expect(expandScheduleMacro('@daily')).toBe('0 0 * * *');
    expect(expandCronSugar('@daily')).toBe('0 0 * * *');
  });

  it('@weekly → 0 0 * * 0（每周日 00:00）', () => {
    expect(expandScheduleMacro('@weekly')).toBe('0 0 * * 0');
  });

  it('@monthly → 0 0 1 * *（每月 1 日 00:00）', () => {
    expect(expandScheduleMacro('@monthly')).toBe('0 0 1 * *');
  });

  it('非宏表达式原样透传（5 段解析不受影响）', () => {
    expect(expandScheduleMacro('*/15 * * * *')).toBe('*/15 * * * *');
    expect(expandScheduleMacro('0 9 * * 1-5')).toBe('0 9 * * 1-5');
  });

  it('isCronMacro 判定', () => {
    expect(isCronMacro('@daily')).toBe(true);
    expect(isCronMacro('@weekly')).toBe(true);
    expect(isCronMacro('@monthly')).toBe(true);
    expect(isCronMacro('* * * * *')).toBe(false);
  });

  it('宏直接进 nextCronTime 可解析（展开层透传）', () => {
    // @daily 从 2026-08-19 10:00 起 → 次日 00:00 UTC
    const next = nextCronTime('@daily', new Date('2026-08-19T10:00:00Z'));
    expect(new Date(next).toISOString()).toBe('2026-08-20T00:00:00.000Z');
    // @monthly 从 8/19 起 → 9/1 00:00
    const monthly = nextCronTime('@monthly', new Date('2026-08-19T10:00:00Z'));
    expect(new Date(monthly).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('long-tasks · 注册表（.sofagent/long-tasks.yml）', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* #9 shim */ } });

  it('写入后可读回（YAML 往返——字段完整）', () => {
    const registry: LongTaskRegistry = {
      version: 1,
      tasks: [
        {
          name: 'benchmark-recheck',
          schedule: '@weekly',
          prompt: '每周 Benchmark 复测',
          dependsOn: ['knowledge-health'],
          maxNoChangeRuns: 3,
          backoffOnWait: true,
        },
        { name: 'knowledge-health', schedule: '@daily', prompt: '每日知识健康巡检' },
      ],
    };
    saveLongTaskRegistry(dir, registry);
    expect(existsSync(longTasksRegistryPath(dir))).toBe(true);

    const loaded = loadLongTaskRegistry(dir);
    expect(loaded.tasks.length).toBe(2);
    expect(loaded.tasks[0]!.name).toBe('benchmark-recheck');
    expect(loaded.tasks[0]!.dependsOn).toEqual(['knowledge-health']);
    expect(loaded.tasks[0]!.maxNoChangeRuns).toBe(3);
    expect(loaded.tasks[0]!.backoffOnWait).toBe(true);
    expect(loaded.tasks[1]!.schedule).toBe('@daily');
  });

  it('文件不存在 → 空注册表（不 crash）', () => {
    const loaded = loadLongTaskRegistry(dir);
    expect(loaded.tasks).toEqual([]);
    expect(loaded.version).toBe(1);
  });

  it('坏条目过滤（缺 name/schedule/prompt 的条目丢弃，好条目保留）', () => {
    const bad = join(dir, '.sofagent');
    mkdirSync(bad, { recursive: true });
    writeFileSync(
      join(bad, 'long-tasks.yml'),
      [
        'version: 1',
        'tasks:',
        '  - name: good-task',
        '    schedule: "@daily"',
        '    prompt: ok',
        '  - schedule: "@daily"', // 缺 name+prompt
        '  - name: no-prompt', // 缺 schedule+prompt
        '  - 42', // 非对象
      ].join('\n'),
      'utf-8',
    );
    const loaded = loadLongTaskRegistry(dir);
    expect(loaded.tasks.length).toBe(1);
    expect(loaded.tasks[0]!.name).toBe('good-task');
  });

  it('损坏 YAML → 空注册表兜底', () => {
    const p = join(dir, '.sofagent');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'long-tasks.yml'), '{{{not yaml', 'utf-8');
    expect(loadLongTaskRegistry(dir).tasks).toEqual([]);
  });
});

describe('long-tasks · 死循环检测', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* #9 shim */ } });

  const task: LongTaskSpec = { name: 'audit-verify', schedule: '@daily', prompt: '审计链校验' };

  it('输出有变化 → 计数重置为 0', () => {
    const s1 = trackNoProgress(task, '报告 v1', { lastFingerprint: null, consecutiveNoChange: 0 }, dir);
    expect(s1.consecutiveNoChange).toBe(0);
    // 输出变化（v1 → v2）
    const s2 = trackNoProgress(task, '报告 v2', { lastFingerprint: s1.lastFingerprint, consecutiveNoChange: 3 }, dir);
    expect(s2.consecutiveNoChange).toBe(0);
  });

  it('连续 N 次（默认 6）无变化 → 触发告警写 daemon-health.json warnings', () => {
    let state = { lastFingerprint: null as string | null, consecutiveNoChange: 0 };
    let warned = false;
    // 第 1 次建立基线（consecutiveNoChange=0）
    state = trackNoProgress(task, '不变输出', state, dir);
    // 后续 5 次同输出（累计连续 5 次无变化——未到阈值 6，不告警）
    for (let i = 0; i < 5; i++) {
      state = trackNoProgress(task, '不变输出', state, dir);
    }
    expect(state.consecutiveNoChange).toBe(5);
    expect(existsSync(join(dir, 'daemon-health.json'))).toBe(false);
    // 第 6 次无变化 → 达到默认阈值 6 → 告警
    const final = trackNoProgress(task, '不变输出', state, dir);
    expect(final.consecutiveNoChange).toBe(6);
    expect(final.warned).toBe(true);

    // daemon-health.json 的 warnings 数组有 no-progress 告警（action=replan）
    const health = JSON.parse(readFileSync(join(dir, 'daemon-health.json'), 'utf-8')) as {
      warnings?: Array<{ task: string; kind: string; action: string; consecutiveNoChange: number }>;
    };
    expect(Array.isArray(health.warnings)).toBe(true);
    expect(health.warnings!.length).toBe(1);
    expect(health.warnings![0]!.task).toBe('audit-verify');
    expect(health.warnings![0]!.kind).toBe('no-progress');
    expect(health.warnings![0]!.action).toBe('replan');
    expect(health.warnings![0]!.consecutiveNoChange).toBe(6);
  });

  it('阈值可配（maxNoChangeRuns=3 覆盖默认 6）', () => {
    const custom = { ...task, maxNoChangeRuns: 3 };
    let state = { lastFingerprint: null as string | null, consecutiveNoChange: 0 };
    state = trackNoProgress(custom, 'x', state, dir); // 基线
    state = trackNoProgress(custom, 'x', state, dir); // no-change 1
    state = trackNoProgress(custom, 'x', state, dir); // no-change 2
    expect(state.consecutiveNoChange).toBe(2);
    const final = trackNoProgress(custom, 'x', state, dir); // no-change 3 → 阈值 3 触发
    expect(final.warned).toBe(true);
    expect(final.consecutiveNoChange).toBe(3);
  });

  it('appendLongTaskWarning 保留 daemon-health.json 既有字段 + 同任务告警去重', () => {
    // 预置既有健康文件（模拟 daemon 主循环已写入）
    writeFileSync(
      join(dir, 'daemon-health.json'),
      JSON.stringify({ pid: 123, status: 'running', lastHeartbeat: '2026-08-19T00:00:00Z' }),
      'utf-8',
    );
    appendLongTaskWarning(
      { ts: '2026-08-19T01:00:00Z', task: 't1', kind: 'no-progress', consecutiveNoChange: 6, action: 'replan', outputFingerprint: 'abc' },
      dir,
    );
    appendLongTaskWarning(
      { ts: '2026-08-19T02:00:00Z', task: 't2', kind: 'no-progress', consecutiveNoChange: 6, action: 'replan', outputFingerprint: 'def' },
      dir,
    );
    // 同任务 t1 再告警 → 覆盖（最新一次）
    appendLongTaskWarning(
      { ts: '2026-08-19T03:00:00Z', task: 't1', kind: 'no-progress', consecutiveNoChange: 7, action: 'replan', outputFingerprint: 'abc' },
      dir,
    );
    const health = JSON.parse(readFileSync(join(dir, 'daemon-health.json'), 'utf-8')) as Record<string, unknown>;
    expect(health['pid']).toBe(123); // 既有字段保留
    expect(health['status']).toBe('running');
    const warnings = health['warnings'] as Array<{ task: string; consecutiveNoChange: number }>;
    expect(warnings.length).toBe(2); // t1（最新）+ t2
    expect(warnings.find((w) => w.task === 't1')!.consecutiveNoChange).toBe(7);
  });

  it('DEFAULT_MAX_NO_CHANGE_RUNS = 6（文档口径）', () => {
    expect(DEFAULT_MAX_NO_CHANGE_RUNS).toBe(6);
  });
});

describe('long-tasks · WAL 续跑联动（崩溃恢复钩子）', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* #9 shim */ } });

  it('wal.jsonl 未完成条目（status != done）被读出', () => {
    writeFileSync(
      join(dir, 'wal.jsonl'),
      [
        JSON.stringify({ id: 'txn-1', op: 'write', status: 'done' }),
        JSON.stringify({ id: 'txn-2', op: 'write', status: 'pending' }),
        JSON.stringify({ id: 'txn-3', op: 'commit', status: 'in-flight' }),
        '', // 尾部空行
      ].join('\n'),
      'utf-8',
    );
    const unfinished = readUnfinishedWalEntries(dir);
    expect(unfinished.length).toBe(2);
    expect(unfinished[0]!.id).toBe('txn-2');
    expect(unfinished[1]!.id).toBe('txn-3');
  });

  it('文件不存在 / 全 done → 空数组', () => {
    expect(readUnfinishedWalEntries(dir)).toEqual([]);
    writeFileSync(join(dir, 'wal.jsonl'), JSON.stringify({ id: 'x', status: 'done' }) + '\n', 'utf-8');
    expect(readUnfinishedWalEntries(dir)).toEqual([]);
  });

  it('半行（崩溃写入中断）跳过不炸', () => {
    writeFileSync(
      join(dir, 'wal.jsonl'),
      [JSON.stringify({ id: 'ok', status: 'pending' }), '{"id":"broken","status":"pe'].join('\n'),
      'utf-8',
    );
    const unfinished = readUnfinishedWalEntries(dir);
    expect(unfinished.length).toBe(1);
    expect(unfinished[0]!.id).toBe('ok');
  });

  it('onCrashRecovery 注册即派发未完成条目（宿主接线 durable 续跑）', () => {
    writeFileSync(
      join(dir, 'wal.jsonl'),
      [JSON.stringify({ id: 'r1', op: 'write', status: 'pending' })].join('\n'),
      'utf-8',
    );
    const lt = createLongTaskScheduler({ projectDir: dir, dataBase: dir });
    const received: Array<{ id?: string; suggestion: string }> = [];
    lt.onCrashRecovery((e) => {
      received.push({ id: e.entry.id, suggestion: e.suggestion });
    });
    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('r1');
    expect(received[0]!.suggestion).toBe('resume');
  });
});

describe('long-tasks · 调度器（依赖图 + backoff + 集成）', () => {
  let projectDir: string;
  let dataDir: string;
  beforeEach(() => {
    projectDir = tmpDir();
    dataDir = tmpDir();
  });
  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* #9 shim */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* #9 shim */ }
  });

  it('依赖图阻断：前任务 FAIL → 后任务 SKIPPED + skippedReason', () => {
    saveLongTaskRegistry(projectDir, {
      version: 1,
      tasks: [
        { name: 'upstream', schedule: '@daily', prompt: '上游' },
        { name: 'downstream', schedule: '@daily', prompt: '下游', dependsOn: ['upstream'] },
      ],
    });
    const lt = createLongTaskScheduler({ projectDir, dataBase: dataDir });

    // 第一轮（day 1）：upstream FAIL
    const r1 = lt.runDueTasks(
      (task) => (task.name === 'upstream' ? { exitCode: 1, output: '上游失败' } : { exitCode: 0, output: 'ok' }),
      new Date('2026-08-19T00:01:00Z'),
    );
    const down1 = r1.find((r) => r.taskId === 'downstream')!;
    expect(down1.status).toBe('SKIPPED');
    expect(down1.skippedReason).toContain('upstream');
    expect(down1.skippedReason).toContain('FAIL');

    // 第二轮（day 2——模拟时间推进过 nextRun）：upstream PASS → downstream 放行
    const r2 = lt.runDueTasks(
      (task) => ({ exitCode: 0, output: `${task.name} ok` }),
      new Date('2026-08-20T00:01:00Z'),
    );
    const down2 = r2.find((r) => r.taskId === 'downstream')!;
    expect(down2.status).toBe('PASS');
    expect(down2.skippedReason).toBeUndefined();
  });

  it('依赖图：前任务从未运行 → 后任务同样 SKIPPED（未运行 ≠ PASS）', () => {
    saveLongTaskRegistry(projectDir, {
      version: 1,
      tasks: [
        { name: 'solo', schedule: '@daily', prompt: '独立', dependsOn: ['never-ran'] },
      ],
    });
    const lt = createLongTaskScheduler({ projectDir, dataBase: dataDir });
    const r = lt.runDueTasks(() => ({ exitCode: 0, output: 'x' }));
    expect(r[0]!.status).toBe('SKIPPED');
    expect(r[0]!.skippedReason).toContain('未运行');
  });

  it('waiting backoff：WAITING → 倍率 ×2；材料变化恢复 ×1', () => {
    saveLongTaskRegistry(projectDir, {
      version: 1,
      tasks: [{ name: 'waiter', schedule: '@daily', prompt: '等输入', backoffOnWait: true }],
    });
    const lt = createLongTaskScheduler({ projectDir, dataBase: dataDir });
    expect(lt.backoffOf('waiter')).toBe(1);

    // day 1 第一次 PASS（无等待）→ 倍率不变
    lt.runDueTasks(() => ({ exitCode: 0, output: '材料 A' }), new Date('2026-08-19T00:01:00Z'));
    expect(lt.backoffOf('waiter')).toBe(1);

    // day 2 WAITING 一轮 → ×2
    lt.runDueTasks(() => ({ exitCode: 0, output: '材料 A', waiting: true }), new Date('2026-08-20T00:01:00Z'));
    expect(lt.backoffOf('waiter')).toBe(2);

    // day 3-4 连续 WAITING → ×4（nextRun 已被 ×2 拉长——day 4 才再次到期）
    lt.runDueTasks(() => ({ exitCode: 0, output: '材料 A', waiting: true }), new Date('2026-08-21T00:01:00Z'));
    expect(lt.backoffOf('waiter')).toBe(2); // day 3 未到期（×2 间隔）——不触发
    lt.runDueTasks(() => ({ exitCode: 0, output: '材料 A', waiting: true }), new Date('2026-08-22T00:01:00Z'));
    expect(lt.backoffOf('waiter')).toBe(4); // 到期 → ×4

    // 材料变化（输出变了）→ 恢复 ×1
    lt.runDueTasks(() => ({ exitCode: 0, output: '材料 B（新证据到了）' }), new Date('2026-08-26T00:01:00Z'));
    expect(lt.backoffOf('waiter')).toBe(1);
  });

  it('WAITING 倍率体现在 nextRun 拉长（下轮间隔 ×2）', () => {
    saveLongTaskRegistry(projectDir, {
      version: 1,
      tasks: [{ name: 'backoff-task', schedule: '@daily', prompt: 'p', backoffOnWait: true }],
    });
    const lt = createLongTaskScheduler({ projectDir, dataBase: dataDir });

    // 第一轮 PASS：nextRun = 明日 00:00（约 24h 后）
    const t0 = new Date('2026-08-19T10:00:00Z');
    lt.runDueTasks(() => ({ exitCode: 0, output: 'v1' }), t0);
    const schedTasks = lt._scheduler.list();
    const normal = schedTasks.find((t) => t.name === 'long-task:backoff-task')!;
    expect(new Date(normal.nextRun!).toISOString()).toBe('2026-08-20T00:00:00.000Z');

    // 第二轮 WAITING：nextRun = 明日基础上 ×2（约 48h 后——2026-08-21T10:00 附近）
    const t1 = new Date('2026-08-20T00:01:00Z');
    lt.runDueTasks(() => ({ exitCode: 0, output: 'v1', waiting: true }), t1);
    const afterWait = lt._scheduler.list().find((t) => t.name === 'long-task:backoff-task')!;
    const gapMs = new Date(afterWait.nextRun!).getTime() - t1.getTime();
    // 基础下一跳 ~24h，×2 → ~48h（允许 ±1h 粒度误差）
    expect(gapMs).toBeGreaterThan(46 * 3600_000);
    expect(gapMs).toBeLessThan(50 * 3600_000);
  });

  it('调度器端到端：@daily 任务到期触发 + 历史落盘 + paused 跳过', () => {
    saveLongTaskRegistry(projectDir, {
      version: 1,
      tasks: [
        { name: 'daily-job', schedule: '@daily', prompt: '每日巡检' },
        { name: 'paused-job', schedule: '@daily', prompt: '暂停的', status: 'paused' },
      ],
    });
    const lt = createLongTaskScheduler({ projectDir, dataBase: dataDir });
    const ran: string[] = [];
    const results = lt.runDueTasks((task) => {
      ran.push(task.name);
      return { exitCode: 0, output: `${task.name} 完成` };
    });

    expect(ran).toEqual(['daily-job']); // paused 不触发
    expect(results.length).toBe(1);
    expect(results[0]!.status).toBe('PASS');

    // 历史落盘（scheduler/history/long-task:daily-job/）
    const history = lt.history('daily-job');
    expect(history.length).toBe(1);
    expect(history[0]!.status).toBe('PASS');
    expect(history[0]!.output).toBe('daily-job 完成');

    // 未到期不再触发（nextRun 已滚到明天）
    const again = lt.runDueTasks(() => ({ exitCode: 0, output: 'x' }));
    expect(again.length).toBe(0);
  });

  it('注册表 schedule 宏进 scheduler 展开落盘（5 段表达式持久化）', () => {
    saveLongTaskRegistry(projectDir, {
      version: 1,
      tasks: [{ name: 'macro-job', schedule: '@weekly', prompt: 'p' }],
    });
    const lt = createLongTaskScheduler({ projectDir, dataBase: dataDir });
    lt.runDueTasks(() => ({ exitCode: 0, output: 'x' }));
    const sched = lt._scheduler.list().find((t) => t.name === 'long-task:macro-job')!;
    expect(sched.schedule).toBe('0 0 * * 0'); // 宏已展开为 5 段
    // nextRun 是下周日
    const next = new Date(sched.nextRun!);
    expect(next.getUTCDay()).toBe(0);
    expect(next.getUTCHours()).toBe(0);
  });
});
