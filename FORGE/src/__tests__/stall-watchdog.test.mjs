#!/usr/bin/env node
/**
 * stall-watchdog.test.mjs · v1.2.4 心跳停顿 watchdog 验证
 *
 * 验证内容：
 * 1. 正常心跳不触发 stall-detected
 * 2. execSync sleep 真实冻结事件循环，触发 stall-detected 事件
 * 3. 累计 stall 达 STALL_MAX 抛出 StallError 中止 handler
 * 4. handler 被中止后 clearInterval 正确清理
 *
 * 关键实现细节：
 * - 环境变量必须在 import 之前设置（ESM 模块缓存问题）
 * - execSync 后需要让事件循环处理 deferred timers（await setTimeout(0)）
 */

// ─── 环境变量必须在 import 之前设置 ───
// ESM 模块的顶层 const 在模块求值时计算，缓存后不再重新求值
process.env.FORGE_STALL_THRESHOLD_MS = '100';  // 100ms 阈值
process.env.FORGE_STALL_MAX = '2';             // 2 次 stall 触发 StallError

import { mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import assert from 'assert';
import { execSync } from 'child_process';
import { createProgressMiddleware, StallError } from '../progress-middleware.mjs';

console.log('\n🧪 stall-watchdog 验证测试\n');

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(`    ${err.stack.split('\n').slice(1, 3).join('\n')}`);
    failCount++;
  }
}

function tmpRoundDir() {
  const dir = join(tmpdir(), `stall-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readEvents(roundDir, role) {
  const file = join(roundDir, `sub-progress-${role}.jsonl`);
  if (!readFileSync(file, 'utf-8')) return [];
  return readFileSync(file, 'utf-8')
    .trim().split('\n').filter(Boolean).map(JSON.parse);
}

// ─── 测试 1：正常心跳不触发 stall ───
await test('正常心跳（间隔 < 阈值）不触发 stall-detected', async () => {
  const roundDir = tmpRoundDir();
  try {
    // heartbeatMs=50, threshold=100: 正常间隔 ~50ms < 100ms，不触发 stall
    const mw = createProgressMiddleware({ roundDir, role: 'A', heartbeatMs: 50 });

    await mw.wrapModelCall({}, async () => {
      await new Promise(r => setTimeout(r, 500));
      return 'ok';
    });

    const events = readEvents(roundDir, 'A');
    const stallEvents = events.filter(e => e.event === 'stall-detected');
    assert.strictEqual(stallEvents.length, 0, `不应有 stall-detected，实际 ${stallEvents.length}`);

    const heartbeats = events.filter(e => e.event === 'llm-chunk');
    assert.ok(heartbeats.length >= 5, `应有 ≥5 条心跳，实际 ${heartbeats.length}`);
  } finally {
    rmSync(roundDir, { recursive: true, force: true });
  }
});

// ─── 测试 2：execSync 真实冻结触发 stall-detected ───
await test('execSync sleep 真实冻结 500ms，触发 stall-detected 事件', async () => {
  const roundDir = tmpRoundDir();
  try {
    // heartbeatMs=50, threshold=100
    // execSync 冻结 500ms → setInterval 无法触发 → 恢复后 catch-up
    // 此时 Date.now() - lastTickTime ≈ 500ms >> 100ms → 检测到 stall
    const mw = createProgressMiddleware({ roundDir, role: 'A', heartbeatMs: 50 });

    await mw.wrapModelCall({}, async () => {
      // 同步阻塞事件循环 500ms（模拟 macOS 节流）
      execSync('sleep 0.5', { stdio: 'ignore' });
      // 让出控制权，让 deferred setInterval 回调触发 catch-up
      await new Promise(r => setTimeout(r, 50));
      return 'recovered';
    });

    const events = readEvents(roundDir, 'A');
    const stallEvents = events.filter(e => e.event === 'stall-detected');
    assert.ok(stallEvents.length >= 1, `应有 ≥1 条 stall-detected，实际 ${stallEvents.length}`);

    const firstStall = stallEvents[0];
    assert.ok(firstStall.gapMs >= 100, `gapMs 应 >= 100，实际 ${firstStall.gapMs}`);
    assert.ok(firstStall.gapMs >= 400, `gapMs 应 >= 400（冻结了 500ms），实际 ${firstStall.gapMs}`);
  } finally {
    rmSync(roundDir, { recursive: true, force: true });
  }
});

// ─── 测试 3：累计 stall 达 STALL_MAX 抛出 StallError ───
await test('累计 stall 达 STALL_MAX=2 后抛出 StallError 中止 handler', async () => {
  const roundDir = tmpRoundDir();
  try {
    // STALL_MAX=2, heartbeatMs=30
    // 两次 execSync 200ms → 两次 stall → 第二次触发 AbortController
    const mw = createProgressMiddleware({ roundDir, role: 'A', heartbeatMs: 30 });

    let caughtError = null;
    try {
      await mw.wrapModelCall({}, async () => {
        // 第一次冻结 200ms
        execSync('sleep 0.2', { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 50)); // 让 setInterval 触发
        // 第二次冻结 200ms → stallCount=2 >= STALL_MAX=2 → abort
        execSync('sleep 0.2', { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 50)); // 让 setInterval 触发 abort
        // 如果没被中止，会继续执行到这里
        return 'should-not-reach';
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, '应捕获错误');
    assert.strictEqual(caughtError.name, 'StallError', `错误名应为 StallError，实际 ${caughtError?.name}`);
    assert.ok(caughtError instanceof StallError, '应为 StallError 实例');
    assert.ok(caughtError.stallCount >= 2, `stallCount 应 >= 2，实际 ${caughtError.stallCount}`);
  } finally {
    rmSync(roundDir, { recursive: true, force: true });
  }
});

// ─── 测试 4：AbortController 正确清理（无内存泄漏）───
await test('StallError 后 wrapModelCall 可再次调用（timer 正确清理）', async () => {
  const roundDir = tmpRoundDir();
  try {
    const mw = createProgressMiddleware({ roundDir, role: 'A', heartbeatMs: 30 });

    // 第一次：触发 StallError
    try {
      await mw.wrapModelCall({}, async () => {
        execSync('sleep 0.2', { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 50));
        execSync('sleep 0.2', { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 50));
        return 'first';
      });
    } catch {
      // expected StallError
    }

    // 第二次：正常完成（验证 timer/AbortController 已清理）
    const result = await mw.wrapModelCall({}, async () => {
      await new Promise(r => setTimeout(r, 200));
      return 'second-ok';
    });

    assert.strictEqual(result, 'second-ok', '第二次调用应正常完成');
  } finally {
    rmSync(roundDir, { recursive: true, force: true });
  }
});

console.log(`\n结果: ${passCount} 通过, ${failCount} 失败\n`);
process.exit(failCount > 0 ? 1 : 0);
