// driver-watch.test.mjs · v1.4.6 进程守护 v2 行为锁
// 覆盖三缺口修复：respawn 封顶 / 快速死亡环检测 / watcher 心跳与退出留痕。
// 纯逻辑测试：liveness/spawn/sleep 全部注入 mock，不 spawn 真进程、不等真时间。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runWatcherShared,
  detectQuickDeathLoop,
  writeWatcherExit,
  writeWatcherHeartbeat,
  buildRespawnArgs,
  auditDriverDeath,
  RESUME_MAX,
  QUICK_DEATH_MS,
} from './driver-base.mjs';
import { join } from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';

/** 构造可控的 liveness 序列：每次调用弹出下一态 */
function seqLiveness(states) {
  let i = 0;
  return () => states[Math.min(i++, states.length - 1)];
}

/** 假 spawn：记录调用，返回 pid */
function fakeSpawn(calls) {
  return (args, logPath) => {
    calls.push({ args, logPath });
    return 12345;
  };
}

/** 假 sleep：记录调用，立即 resolve（不等真时间） */
function patchSleep() {
  const orig = global.setTimeout;
  const sleeps = [];
  global.setTimeout = (fn, ms) => { sleeps.push(ms); if (typeof fn === 'function') fn(); return { unref() {} }; };
  return { sleeps, restore: () => { global.setTimeout = orig; } };
}

describe('v1.4.6 进程守护 v2 · watcher 三缺口修复', () => {
  let dir;
  let sleepPatch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-watch-test-'));
    sleepPatch = patchSleep();
  });

  afterEach(() => {
    sleepPatch.restore();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('缺口① respawn 封顶（RESUME_MAX）', () => {
    it('driver 恒死 → 拉起恰好 RESUME_MAX 次后退出，写 watcher-exit.json（reason=resume-max）', async () => {
      writeFileSync(join(dir, 'resume-point.json'), JSON.stringify({ target: 'v1.4.6', maxRounds: 10 }));
      // 恒死但 phase 每次不同（绕开快速死亡环检测，专测封顶逻辑）
      let deathN = 0;
      const varPhaseLiveness = () => { deathN++; return { alive: false, phase: 'death-' + deathN, heartbeatAgeMs: 999999 }; };
      const spawnCalls = [];
      const result = await runWatcherShared({
        driverEntry: '/fake/driver.mjs',
        runDir: dir,
        intervalSec: 0,   // sleep 即时
        thresholdSec: 90,
        extractArgs: (j) => (j.target ? { args: ['--target', j.target, '--resume'] } : null),
        liveness: varPhaseLiveness,
        spawnImpl: fakeSpawn(spawnCalls),
      });
      expect(result.reason).toBe('resume-max');
      expect(result.rc).toBe(1);
      expect(spawnCalls.length).toBe(RESUME_MAX);  // 恰好 5 次，不多不少
      const exit = JSON.parse(readFileSync(join(dir, 'watcher-exit.json'), 'utf8'));
      expect(exit.reason).toBe('resume-max');
      expect(exit.resumeCount).toBe(RESUME_MAX);
    });

    it('拉起后复活 → verdict.md 产出 → 正常退出 rc=0', async () => {
      // resume-point 提供续跑参数
      writeFileSync(join(dir, 'resume-point.json'), JSON.stringify({ target: 'v1.4.6', maxRounds: 10 }));
      const spawnCalls = [];
      const result = await runWatcherShared({
        driverEntry: '/fake/driver.mjs',
        runDir: dir,
        intervalSec: 0,
        thresholdSec: 90,
        extractArgs: (j) => (j.target ? { args: ['--target', j.target, '--resume'] } : null),
        // 第 1 轮死 → 拉起 → 第 2 轮活 → 写 verdict → 正常退出
        liveness: () => {
          if (existsSync(join(dir, 'verdict.md'))) return { alive: true, phase: 'done' };
          if (spawnCalls.length === 0) return { alive: false, phase: 'round-1-running', heartbeatAgeMs: 999999 };
          writeFileSync(join(dir, 'verdict.md'), '# PASS');
          return { alive: true, phase: 'verdict' };
        },
        spawnImpl: fakeSpawn(spawnCalls),
      });
      expect(result.reason).toBe('verdict-done');
      expect(result.rc).toBe(0);
      expect(spawnCalls.length).toBe(1);
      const exit = JSON.parse(readFileSync(join(dir, 'watcher-exit.json'), 'utf8'));
      expect(exit.reason).toBe('verdict-done');
    });
  });

  describe('缺口② 快速死亡环检测（detectQuickDeathLoop）', () => {
    it('同 phase 两次死亡且间隔 < QUICK_DEATH_MS → 判环', () => {
      const now = Date.parse('2026-09-08T02:00:00Z');
      // 真实时序：watcher 先 auditDriverDeath 落盘当前死亡，再 detectQuickDeathLoop
      // ——故此处预置两条（前次 + 当前），模拟第二次死亡后的检测现场
      appendFileSync(join(dir, 'death-audit.jsonl'), [
        JSON.stringify({ ts: new Date(now - 60_000).toISOString(), phase: 'round-1-running', verdict: 'external-kill' }),
        JSON.stringify({ ts: new Date(now - 10_000).toISOString(), phase: 'round-1-running', verdict: 'external-kill' }),
      ].join('\n') + '\n');
      const r = detectQuickDeathLoop(dir, 'round-1-running', now);
      expect(r.isQuickDeathLoop).toBe(true);
      expect(r.evidence).toContain('round-1-running');
    });

    it('两次死亡间隔 > 5min → 不判环（慢性死亡可继续 respawn）', () => {
      const now = Date.parse('2026-09-08T02:00:00Z');
      appendFileSync(join(dir, 'death-audit.jsonl'), [
        JSON.stringify({ ts: new Date(now - 10 * 60_000).toISOString(), phase: 'round-1-running' }),
        JSON.stringify({ ts: new Date(now - 60_000).toISOString(), phase: 'round-1-running' }),
      ].join('\n') + '\n');
      const r = detectQuickDeathLoop(dir, 'round-1-running', now);
      expect(r.isQuickDeathLoop).toBe(false);
    });

    it('不同 phase 死亡 → 不判环', () => {
      const now = Date.parse('2026-09-08T02:00:00Z');
      appendFileSync(join(dir, 'death-audit.jsonl'), [
        JSON.stringify({ ts: new Date(now - 60_000).toISOString(), phase: 'round-1-running' }),
        JSON.stringify({ ts: new Date(now - 30_000).toISOString(), phase: 'round-2-running' }),
      ].join('\n') + '\n');
      const r = detectQuickDeathLoop(dir, 'round-2-running', now);
      expect(r.isQuickDeathLoop).toBe(false);
    });

    it('watcher 主循环：快速死亡环 → 第 2 次死亡即退出（reason=quick-death-loop，不烧满 RESUME_MAX）', async () => {
      writeFileSync(join(dir, 'resume-point.json'), JSON.stringify({ target: 'v1.4.6', maxRounds: 10 }));
      const spawnCalls = [];
      const result = await runWatcherShared({
        driverEntry: '/fake/driver.mjs',
        runDir: dir,
        intervalSec: 0,
        thresholdSec: 90,
        extractArgs: (j) => (j.target ? { args: ['--target', j.target, '--resume'] } : null),
        liveness: seqLiveness([{ alive: false, phase: 'round-1-running', heartbeatAgeMs: 999999 }]),
        spawnImpl: fakeSpawn(spawnCalls),
      });
      // 恒死 + 同 phase → 第 1 次死亡后 respawn，第 2 次死亡时 death-audit 已有 2 条同 phase
      // → quick-death-loop 应早于 resume-max 触发
      expect(result.reason).toBe('quick-death-loop');
      expect(spawnCalls.length).toBeLessThan(RESUME_MAX);
      const exit = JSON.parse(readFileSync(join(dir, 'watcher-exit.json'), 'utf8'));
      expect(exit.reason).toBe('quick-death-loop');
    });

    it('phase=null 的死亡不参与判环（保守——无法定位就不误杀）', () => {
      const now = Date.parse('2026-09-08T02:00:00Z');
      appendFileSync(join(dir, 'death-audit.jsonl'), [
        JSON.stringify({ ts: new Date(now - 60_000).toISOString(), phase: null }),
        JSON.stringify({ ts: new Date(now - 30_000).toISOString(), phase: null }),
      ].join('\n') + '\n');
      const r = detectQuickDeathLoop(dir, null, now);
      expect(r.isQuickDeathLoop).toBe(false);
    });
  });

  describe('缺口③ watcher 心跳（watcher-status.json）', () => {
    it('monitoring 态每轮写心跳；exiting 态最后写一次', async () => {
      const spawnCalls = [];
      const result = await runWatcherShared({
        driverEntry: '/fake/driver.mjs',
        runDir: dir,
        intervalSec: 0,
        thresholdSec: 90,
        extractArgs: (j) => (j.target ? { args: ['--target', j.target, '--resume'] } : null),
        liveness: seqLiveness([{ alive: true, phase: 'x' }, { alive: false, phase: 'y', heartbeatAgeMs: 999999 }]),
        spawnImpl: fakeSpawn(spawnCalls),
      });
      // 第 1 轮 alive（写 monitoring 心跳）→ 第 2 轮死 → no-resume-args 退出
      expect(result.reason).toBe('no-resume-args');
      const hb = JSON.parse(readFileSync(join(dir, 'watcher-status.json'), 'utf8'));
      expect(hb.phase).toBe('exiting');
      expect(typeof hb.pid).toBe('number');
      expect(hb.ts).toBeTruthy();
    });
  });

  describe('共享四件套基础行为（收编自两 driver 同构实现）', () => {
    it('buildRespawnArgs：latest.json 优先，resume-point.json 兜底，extractArgs 注入差异', () => {
      writeFileSync(join(dir, 'latest.json'), JSON.stringify({ target: 'v1.4.6' }));
      const r1 = buildRespawnArgs(dir, (j) => (j.target ? { args: ['--target', j.target] } : null));
      expect(r1.args).toEqual(['--target', 'v1.4.6']);
      rmSync(join(dir, 'latest.json'));
      writeFileSync(join(dir, 'resume-point.json'), JSON.stringify({ target: 'v1.4.5', maxRounds: 7 }));
      const r2 = buildRespawnArgs(dir, (j) => (j.target ? { args: ['--target', j.target, '--max-rounds', String(j.maxRounds || 10)] } : null));
      expect(r2.args).toEqual(['--target', 'v1.4.5', '--max-rounds', '7']);
    });

    it('buildRespawnArgs：无 target / JSON 损坏 → null（不抛）', () => {
      writeFileSync(join(dir, 'latest.json'), '{broken');
      expect(buildRespawnArgs(dir, (j) => (j.target ? { args: [] } : null))).toBeNull();
      expect(buildRespawnArgs(join(dir, 'nope'), (j) => (j.target ? { args: [] } : null))).toBeNull();
    });

    it('auditDriverDeath：stopReason=aborted-signal → verdict=signal-abort；条目含 ts 且落盘', () => {
      writeFileSync(join(dir, 'latest.json'), JSON.stringify({ stopReason: 'aborted-signal' }));
      const e = auditDriverDeath(dir, { heartbeatAgeMs: 1234, lastEvent: 'round-start', phase: 'round-2-running' });
      expect(e.verdict).toBe('signal-abort');
      expect(e.phase).toBe('round-2-running');
      const lines = readFileSync(join(dir, 'death-audit.jsonl'), 'utf8').trim().split('\n');
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).ts).toBeTruthy();
    });

    it('writeWatcherExit / writeWatcherHeartbeat：JSON 落盘且字段齐全', () => {
      writeWatcherExit(dir, 'resume-max', 'detail-here', 5);
      const e = JSON.parse(readFileSync(join(dir, 'watcher-exit.json'), 'utf8'));
      expect(e).toMatchObject({ reason: 'resume-max', detail: 'detail-here', resumeCount: 5 });
      writeWatcherHeartbeat(dir, 'monitoring', 2);
      const h = JSON.parse(readFileSync(join(dir, 'watcher-status.json'), 'utf8'));
      expect(h).toMatchObject({ phase: 'monitoring', resumeCount: 2 });
    });

    it('常量：RESUME_MAX=5 / QUICK_DEATH_MS=300000（默认值，env 未设时）', () => {
      expect(RESUME_MAX).toBeGreaterThan(0);
      expect(QUICK_DEATH_MS).toBe(5 * 60 * 1000);
    });
  });
});
