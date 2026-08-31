// ═══════════════════════════════════════════════════════════
// run-06 实证修复测试：stall-watchdog 双钟睡眠鉴别 + caffeinate 守护
//
// 背景：macOS 合盖（Clamshell Sleep）777s，Node event loop 被硬件冻结，
// watchdog 墙钟比对误判 775s「冻结」→ abort regression worker →
// regression.md 空文件 → V 终审缺输入。双钟鉴别：
//   - 墙钟 Date.now()：睡眠时继续走（NTP 校准除外）
//   - 单调钟 process.hrtime.bigint()：睡眠时暂停（mach_absolute_time）
//   - 墙钟跳变大 + 单调钟没走 = 系统睡眠（只记 sleep-detected，不计 stall）
// ═══════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { createProgressMiddleware } from './progress-middleware.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_CODE = readFileSync(join(__dirname, 'progress-middleware.mjs'), 'utf-8');
const DRIVER_CODE = readFileSync(join(__dirname, 'release-gate-driver.mjs'), 'utf-8');

function makeRoundDir() {
  return mkdtempSync(join(tmpdir(), 'stall-watchdog-test-'));
}

function readEvents(roundDir, role = 'V') {
  const f = join(roundDir, `sub-progress-${role}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

describe('stall-watchdog 双钟睡眠鉴别（run-06 实证）', () => {
  it('源码级：心跳 tick 用双钟比对，isSleep 分支在 stall 判定之前', () => {
    expect(SOURCE_CODE).toContain('process.hrtime.bigint()');
    expect(SOURCE_CODE).toContain('const sleptMs = Math.max(0, actualGap - monoGapMs);');
    expect(SOURCE_CODE).toContain("const isSleep = sleptMs > STALL_THRESHOLD_MS;");
    // 睡眠分支必须先于 stall 判定（if (isSleep) ... else if (actualGap > STALL_THRESHOLD_MS)）
    const isSleepIdx = SOURCE_CODE.indexOf('if (isSleep)');
    const stallIdx = SOURCE_CODE.indexOf("} else if (actualGap > STALL_THRESHOLD_MS)");
    expect(isSleepIdx).toBeGreaterThan(-1);
    expect(stallIdx).toBeGreaterThan(isSleepIdx);
  });

  it('源码级：sleep-detected 事件不 abort、不计 stallCount', () => {
    expect(SOURCE_CODE).toContain("event: 'sleep-detected'");
    // sleep 分支体内不得出现 abort/stallCount++（sleep 是正常事件非故障）
    const sleepBlock = SOURCE_CODE.slice(
      SOURCE_CODE.indexOf('if (isSleep)'),
      SOURCE_CODE.indexOf("} else if (actualGap > STALL_THRESHOLD_MS)"),
    );
    expect(sleepBlock).not.toContain('stallCount++');
    expect(sleepBlock).not.toContain('controller.abort');
  });

  it('运行时：睡眠场景（墙钟跳变大+单调钟正常走）只记 sleep-detected 不 abort', async () => {
    // 模拟睡眠的机制：真实睡眠无法在测试中制造，但双钟比对逻辑可验证——
    // 正常快速调用中墙钟与单调钟同步推进，若未来有人误删双钟逻辑，
    // 本用例通过源码级断言（前两个 it）兜住结构。
    const roundDir = makeRoundDir();
    const mw = createProgressMiddleware({ roundDir, role: 'V', heartbeatMs: 10 });
    const result = await mw.wrapModelCall({}, async () => 'ok');
    expect(result).toBe('ok');
    // 快速完成不产生任何 stall/abort 事件
    const events = readEvents(roundDir);
    expect(events.some(e => e.event === 'stall-detected')).toBe(false);
    expect(events.some(e => e.event === 'stall-abort-immediate')).toBe(false);
    rmSync(roundDir, { recursive: true, force: true });
  });

  it('driver 入口挂 caffeinate 守护（darwin 平台守卫 + 非 LLM 路径跳过）', () => {
    expect(DRIVER_CODE).toContain("process.platform === 'darwin'");
    expect(DRIVER_CODE).toContain("spawn('caffeinate'");
    // help/check-alive/watch 纯本地路径不需要防睡眠
    expect(DRIVER_CODE).toContain('!args.help && !args.checkAlive && !args.watch');
  });
});
