// ============================================================
// failure-ledger.test.ts · 失败清单管理测试（v1.2.4 · P1）
// ============================================================
//
// 覆盖：
// - recordFailure：JSONL 持久化 + 目录自动创建
// - getFailurePatterns：聚类去重 + count 降序 + lastSeen 取最新
// - getFailurePatternsBySkill：按 skillId 过滤
// - getRepeatedFailures：阈值过滤（默认 3）
// - clearFailureCache：清空进程内缓存
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  recordFailure,
  getFailurePatterns,
  getFailurePatternsBySkill,
  getRepeatedFailures,
  clearFailureCache,
  resolveFailureLedgerPath,
  type FailureRecord,
} from '../failure-ledger';

describe('failure-ledger', () => {
  let tmpDir: string;
  let originalData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-fl-'));
    originalData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    clearFailureCache();
  });

  afterEach(() => {
    vi.stubEnv('SOFAGENT_DATA', originalData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  /** 构造测试用 FailureRecord */
  function makeRecord(
    skillId: string,
    failureMode: string,
    ts?: string,
  ): FailureRecord {
    return {
      timestamp: ts ?? new Date().toISOString(),
      skillId,
      failureMode,
      reason: `${failureMode} detail`,
      source: 'test',
    };
  }

  // ════════════════════════════════════════
  // recordFailure
  // ════════════════════════════════════════

  describe('recordFailure', () => {
    it('单条记录写入 JSONL 文件', () => {
      recordFailure(makeRecord('skill-a', 'format-mismatch'));

      const ledgerPath = resolveFailureLedgerPath();
      expect(fs.existsSync(ledgerPath)).toBe(true);

      const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n');
      expect(lines.length).toBe(1);

      const record = JSON.parse(lines[0]);
      expect(record.skillId).toBe('skill-a');
      expect(record.failureMode).toBe('format-mismatch');
    });

    it('多条记录追加写入（append-only）', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      recordFailure(makeRecord('skill-b', 'mode-2'));
      recordFailure(makeRecord('skill-a', 'mode-1'));

      const lines = fs.readFileSync(resolveFailureLedgerPath(), 'utf-8').trim().split('\n');
      expect(lines.length).toBe(3);
    });

    it('自动创建 skillopt 子目录', () => {
      recordFailure(makeRecord('skill-x', 'mode-x'));
      const dir = path.dirname(resolveFailureLedgerPath());
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('可选字段 correctApproach / ruleTriggered 写入', () => {
      recordFailure({
        ...makeRecord('skill-a', 'mode-1'),
        correctApproach: '应该做 X',
        ruleTriggered: 'R-001',
      });
      const record = JSON.parse(
        fs.readFileSync(resolveFailureLedgerPath(), 'utf-8').trim(),
      );
      expect(record.correctApproach).toBe('应该做 X');
      expect(record.ruleTriggered).toBe('R-001');
    });
  });

  // ════════════════════════════════════════
  // getFailurePatterns
  // ════════════════════════════════════════

  describe('getFailurePatterns', () => {
    it('空 ledger 返回空数组', () => {
      expect(getFailurePatterns()).toEqual([]);
    });

    it('相同 skillId+failureMode 聚类累计 count', () => {
      recordFailure(makeRecord('skill-a', 'mode-1', '2025-01-01T00:00:00Z'));
      recordFailure(makeRecord('skill-a', 'mode-1', '2025-01-02T00:00:00Z'));
      recordFailure(makeRecord('skill-a', 'mode-1', '2025-01-03T00:00:00Z'));
      recordFailure(makeRecord('skill-b', 'mode-2', '2025-01-01T00:00:00Z'));

      const patterns = getFailurePatterns();
      expect(patterns).toHaveLength(2);

      // count 降序：skill-a/mode-1 (3) 排前
      expect(patterns[0].skillId).toBe('skill-a');
      expect(patterns[0].failureMode).toBe('mode-1');
      expect(patterns[0].count).toBe(3);

      expect(patterns[1].skillId).toBe('skill-b');
      expect(patterns[1].count).toBe(1);
    });

    it('不同 failureMode 不聚类（即使 skillId 相同）', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      recordFailure(makeRecord('skill-a', 'mode-2'));
      expect(getFailurePatterns()).toHaveLength(2);
    });

    it('聚类键为 12 字符 md5 前缀', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      const patterns = getFailurePatterns();
      expect(patterns[0].key).toHaveLength(12);
    });

    it('lastSeen 取最近时间戳', () => {
      recordFailure(makeRecord('skill-a', 'mode-1', '2025-01-01T00:00:00Z'));
      recordFailure(makeRecord('skill-a', 'mode-1', '2025-01-05T00:00:00Z'));
      recordFailure(makeRecord('skill-a', 'mode-1', '2025-01-03T00:00:00Z'));

      const patterns = getFailurePatterns();
      expect(patterns[0].lastSeen).toBe('2025-01-05T00:00:00Z');
    });

    it('sample 为最近一条记录', () => {
      recordFailure(makeRecord('skill-a', 'mode-1', '2025-01-01T00:00:00Z'));
      recordFailure(makeRecord('skill-a', 'mode-1', '2025-01-05T00:00:00Z'));

      const patterns = getFailurePatterns();
      expect(patterns[0].sample.timestamp).toBe('2025-01-05T00:00:00Z');
    });
  });

  // ════════════════════════════════════════
  // getFailurePatternsBySkill
  // ════════════════════════════════════════

  describe('getFailurePatternsBySkill', () => {
    it('按 skillId 过滤', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      recordFailure(makeRecord('skill-a', 'mode-2'));
      recordFailure(makeRecord('skill-b', 'mode-3'));

      const patterns = getFailurePatternsBySkill('skill-a');
      expect(patterns).toHaveLength(2);
      expect(patterns.every((p) => p.skillId === 'skill-a')).toBe(true);
    });

    it('不存在的 skillId 返回空数组', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      expect(getFailurePatternsBySkill('nonexistent')).toEqual([]);
    });
  });

  // ════════════════════════════════════════
  // getRepeatedFailures
  // ════════════════════════════════════════

  describe('getRepeatedFailures', () => {
    it('默认阈值 3：只返回 count >= 3 的聚类', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      recordFailure(makeRecord('skill-a', 'mode-1'));
      recordFailure(makeRecord('skill-a', 'mode-1'));
      recordFailure(makeRecord('skill-b', 'mode-2'));
      recordFailure(makeRecord('skill-b', 'mode-2'));

      const repeated = getRepeatedFailures();
      expect(repeated).toHaveLength(1);
      expect(repeated[0].skillId).toBe('skill-a');
      expect(repeated[0].count).toBe(3);
    });

    it('自定义阈值 2', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      recordFailure(makeRecord('skill-b', 'mode-2'));
      recordFailure(makeRecord('skill-b', 'mode-2'));

      const repeated = getRepeatedFailures(2);
      expect(repeated).toHaveLength(1);
      expect(repeated[0].skillId).toBe('skill-b');
    });

    it('阈值为 1 时返回全部聚类', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      recordFailure(makeRecord('skill-b', 'mode-2'));
      expect(getRepeatedFailures(1)).toHaveLength(2);
    });

    it('无任何聚类达阈值时返回空', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      expect(getRepeatedFailures(3)).toEqual([]);
    });
  });

  // ════════════════════════════════════════
  // clearFailureCache
  // ════════════════════════════════════════

  describe('clearFailureCache', () => {
    it('清空缓存后磁盘查询不受影响', () => {
      recordFailure(makeRecord('skill-a', 'mode-1'));
      clearFailureCache();
      // getFailurePatterns 从 JSONL 磁盘读取，不受缓存影响
      expect(getFailurePatterns()).toHaveLength(1);
    });
  });
});
