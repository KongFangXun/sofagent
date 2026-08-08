// ============================================================
// daemon-reliability.test.ts · daemon 可靠性测试（v1.2.8 §8.2-8.5）
//
// 覆盖：
//   §8.2 withRetry — 成功/重试后成功/超过上限抛错/退避计算
//   §8.3 plist 路径校验（集成验证在 init.test.ts 中覆盖）
//   §8.4 daemon-health.json — 写入/读取/健康检查
//   §8.5 im-outbox 生命周期 — 删除/移入failed/清理
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── §8.2 withRetry ──────────────────────────────────────────

import { withRetry, withRetryBestEffort, computeBackoff } from '../with-retry';

describe('§8.2 withRetry', () => {
  describe('computeBackoff', () => {
    it('指数退避递增：attempt 0 → baseDelay, attempt 1 → 2x, attempt 2 → 4x', () => {
      const d0 = computeBackoff(0, 1000, 10000);
      const d1 = computeBackoff(1, 1000, 10000);
      const d2 = computeBackoff(2, 1000, 10000);

      // base 值（去掉 jitter 后的核心值）应为 1000, 2000, 4000
      // jitter ±20%，所以 d0 在 [800,1200], d1 在 [1600,2400], d2 在 [3200,4800]
      expect(d0).toBeGreaterThanOrEqual(800);
      expect(d0).toBeLessThanOrEqual(1200);
      expect(d1).toBeGreaterThanOrEqual(1600);
      expect(d1).toBeLessThanOrEqual(2400);
      expect(d2).toBeGreaterThanOrEqual(3200);
      expect(d2).toBeLessThanOrEqual(4800);
    });

    it('maxDelay 截断：退避值不超过 maxDelay', () => {
      // attempt 10 with baseDelay 1000 → 2^10 * 1000 = 1024000, 应被截断为 maxDelay 5000
      // jitter 后仍然 ≤ 5000 * 1.2 = 6000
      const delay = computeBackoff(10, 1000, 5000);
      expect(delay).toBeLessThanOrEqual(6000);
    });

    it('jitter ±20%：同一 attempt 多次计算结果不完全相同', () => {
      const results = new Set<number>();
      for (let i = 0; i < 20; i++) {
        results.add(computeBackoff(1, 1000, 10000));
      }
      // 20 次随机后应产生多个不同值（极大概率）
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('withRetry — 首次成功', () => {
    it('成功时不重试直接返回', async () => {
      let callCount = 0;
      const result = await withRetry(async () => {
        callCount++;
        return 'ok';
      });
      expect(result).toBe('ok');
      expect(callCount).toBe(1);
    });
  });

  describe('withRetry — 重试后成功', () => {
    it('前 N 次失败后成功', async () => {
      let callCount = 0;
      const result = await withRetry(
        async () => {
          callCount++;
          if (callCount < 3) throw new Error('flaky');
          return 'ok';
        },
        { maxRetries: 3, baseDelay: 10, maxDelay: 50, context: 'test-flaky' },
      );
      expect(result).toBe('ok');
      expect(callCount).toBe(3);
    });
  });

  describe('withRetry — 超过上限抛错', () => {
    it('超过 maxRetries 后抛出最后一个错误', async () => {
      let callCount = 0;
      await expect(
        withRetry(
          async () => {
            callCount++;
            throw new Error('always fails');
          },
          { maxRetries: 3, baseDelay: 10, maxDelay: 50, context: 'test-always-fail' },
        ),
      ).rejects.toThrow('always fails');
      expect(callCount).toBe(3);
    });

    it('超过上限后写 daemon-errors.jsonl', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-retry-'));
      process.env.SOFAGENT_DATA = tmpDir;
      try {
        await expect(
          withRetry(
            async () => {
              throw new Error('persistent error');
            },
            { maxRetries: 2, baseDelay: 10, maxDelay: 50, context: 'test-error-log' },
          ),
        ).rejects.toThrow('persistent error');

        const errorLogPath = path.join(tmpDir, 'daemon-errors.jsonl');
        expect(fs.existsSync(errorLogPath)).toBe(true);
        const lines = fs.readFileSync(errorLogPath, 'utf-8').trim().split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(1);
        const entry = JSON.parse(lines[0]!);
        expect(entry.context).toBe('test-error-log');
        expect(entry.error).toBe('persistent error');
        expect(entry.retries).toBe(2);
      } finally {
        delete process.env.SOFAGENT_DATA;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('withRetryBestEffort', () => {
    it('超过上限后返回 null 不抛错', async () => {
      const result = await withRetryBestEffort(
        async () => {
          throw new Error('nope');
        },
        { maxRetries: 2, baseDelay: 10, maxDelay: 50, context: 'best-effort-test' },
      );
      expect(result).toBeNull();
    });

    it('成功时返回结果', async () => {
      const result = await withRetryBestEffort(async () => 'ok');
      expect(result).toBe('ok');
    });
  });
});

// ── §8.4 daemon-health.json ────────────────────────────────

import {
  writeHealthFile,
  readHealthFile,
  checkDaemonHealth,
  resolveHealthFilePath,
} from '../daemon-health';

describe('§8.4 daemon-health.json', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-health-'));
    process.env.SOFAGENT_DATA = tmpDir;
  });

  afterEach(() => {
    delete process.env.SOFAGENT_DATA;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('writeHealthFile("start") 写入完整健康文件', () => {
    const health = writeHealthFile('start');
    expect(health).not.toBeNull();
    expect(health!.pid).toBe(process.pid);
    expect(health!.status).toBe('running');
    expect(health!.startTime).toBeTruthy();
    expect(health!.lastHeartbeat).toBeTruthy();
    expect(health!.lastPush).toBeNull();
    expect(health!.lastError).toBeNull();

    // 文件实际存在
    const healthPath = resolveHealthFilePath();
    expect(fs.existsSync(healthPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
    expect(raw.pid).toBe(process.pid);
  });

  it('readHealthFile 读回写入的数据', () => {
    writeHealthFile('start', { lastPush: '2026-01-01T00:00:00Z' });
    const health = readHealthFile();
    expect(health).not.toBeNull();
    expect(health!.pid).toBe(process.pid);
    expect(health!.lastPush).toBe('2026-01-01T00:00:00Z');
  });

  it('readHealthFile 文件不存在时返回 null', () => {
    const health = readHealthFile();
    expect(health).toBeNull();
  });

  it('writeHealthFile("push") 更新 lastPush 不重置 startTime', () => {
    writeHealthFile('start');
    const startHealth = readHealthFile();
    const originalStartTime = startHealth!.startTime;

    // 模拟一点时间流逝
    const pushTime = '2026-08-02T12:00:00Z';
    writeHealthFile('push', { lastPush: pushTime });

    const afterPush = readHealthFile();
    expect(afterPush!.startTime).toBe(originalStartTime);
    expect(afterPush!.lastPush).toBe(pushTime);
  });

  it('writeHealthFile("error") 标记 degraded 状态', () => {
    writeHealthFile('start');
    writeHealthFile('error', { lastError: 'connection refused' });
    const health = readHealthFile();
    expect(health!.status).toBe('degraded');
    expect(health!.lastError).toBe('connection refused');
  });

  describe('checkDaemonHealth', () => {
    it('文件不存在 → never-started', () => {
      const result = checkDaemonHealth();
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('never-started');
    });

    it('最近心跳 → running + healthy', () => {
      writeHealthFile('start');
      const result = checkDaemonHealth();
      expect(result.healthy).toBe(true);
      expect(result.status).toBe('running');
    });

    it('心跳超过 10min → stopped', () => {
      writeHealthFile('start');
      // 篡改 lastHeartbeat 为 15min 前
      const healthPath = resolveHealthFilePath();
      const raw = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
      raw.lastHeartbeat = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      fs.writeFileSync(healthPath, JSON.stringify(raw, null, 2));
      const result = checkDaemonHealth();
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('stopped');
    });

    it('degraded 状态 → healthy=false', () => {
      writeHealthFile('start');
      writeHealthFile('error', { lastError: 'push timeout' });
      const result = checkDaemonHealth();
      expect(result.healthy).toBe(false);
      expect(result.status).toBe('degraded');
    });
  });
});

// ── §8.5 im-outbox 生命周期 ────────────────────────────────

import {
  deleteOutboxFile,
  moveOutboxToFailed,
  cleanupFailedOutbox,
} from '../push-target';

describe('§8.5 im-outbox 生命周期', () => {
  let tmpDir: string;
  let outboxDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-outbox-'));
    process.env.SOFAGENT_DATA = tmpDir;
    outboxDir = path.join(tmpDir, 'im-outbox');
    fs.mkdirSync(outboxDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.SOFAGENT_DATA;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  describe('deleteOutboxFile', () => {
    it('推送成功后删除 outbox 文件', () => {
      const filename = 'test-msg.md';
      fs.writeFileSync(path.join(outboxDir, filename), '# test\n');
      expect(fs.existsSync(path.join(outboxDir, filename))).toBe(true);

      const result = deleteOutboxFile(filename);
      expect(result).toBe(true);
      expect(fs.existsSync(path.join(outboxDir, filename))).toBe(false);
    });

    it('文件不存在返回 false', () => {
      const result = deleteOutboxFile('nonexistent.md');
      expect(result).toBe(false);
    });
  });

  describe('moveOutboxToFailed', () => {
    it('推送失败后移入 failed/ 目录', () => {
      const filename = 'failed-msg.md';
      fs.writeFileSync(path.join(outboxDir, filename), '# failed\n');
      expect(fs.existsSync(path.join(outboxDir, filename))).toBe(true);

      const result = moveOutboxToFailed(filename);
      expect(result).toBe(true);

      // 原位置不存在
      expect(fs.existsSync(path.join(outboxDir, filename))).toBe(false);
      // failed/ 中存在
      const failedDir = path.join(outboxDir, 'failed');
      expect(fs.existsSync(path.join(failedDir, filename))).toBe(true);
    });

    it('failed/ 目录自动创建', () => {
      const failedDir = path.join(outboxDir, 'failed');
      expect(fs.existsSync(failedDir)).toBe(false);

      const filename = 'auto-create.md';
      fs.writeFileSync(path.join(outboxDir, filename), '# auto\n');
      moveOutboxToFailed(filename);

      expect(fs.existsSync(failedDir)).toBe(true);
    });

    it('文件不存在返回 false', () => {
      const result = moveOutboxToFailed('nonexistent.md');
      expect(result).toBe(false);
    });
  });

  describe('cleanupFailedOutbox', () => {
    it('清理超过 7 天的 failed/ 文件', () => {
      const failedDir = path.join(outboxDir, 'failed');
      fs.mkdirSync(failedDir, { recursive: true });

      // 创建一个 8 天前的文件
      const oldFile = path.join(failedDir, 'old-msg.md');
      fs.writeFileSync(oldFile, '# old\n');
      const eightDaysAgo = Date.now() - 8 * 24 * 3600 * 1000;
      fs.utimesSync(oldFile, eightDaysAgo / 1000, eightDaysAgo / 1000);

      // 创建一个 3 天前的文件
      const recentFile = path.join(failedDir, 'recent-msg.md');
      fs.writeFileSync(recentFile, '# recent\n');
      const threeDaysAgo = Date.now() - 3 * 24 * 3600 * 1000;
      fs.utimesSync(recentFile, threeDaysAgo / 1000, threeDaysAgo / 1000);

      const cleaned = cleanupFailedOutbox();
      expect(cleaned).toBe(1);
      expect(fs.existsSync(oldFile)).toBe(false);
      expect(fs.existsSync(recentFile)).toBe(true);
    });

    it('failed/ 不存在时返回 0', () => {
      // 不创建 failed/ 目录
      const cleaned = cleanupFailedOutbox();
      expect(cleaned).toBe(0);
    });

    it('无过期文件时返回 0', () => {
      const failedDir = path.join(outboxDir, 'failed');
      fs.mkdirSync(failedDir, { recursive: true });
      const freshFile = path.join(failedDir, 'fresh.md');
      fs.writeFileSync(freshFile, '# fresh\n');

      const cleaned = cleanupFailedOutbox();
      expect(cleaned).toBe(0);
      expect(fs.existsSync(freshFile)).toBe(true);
    });
  });
});
