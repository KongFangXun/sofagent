/**
 * loop-audit-history.test.ts · LOOP audit history 完整性验证（v1.1.5）
 *
 * 验证：
 * 1. v1.1.4 修复的 defaultRunAudit 三态（PASS/WARN/FAIL）都写 history 是否真实生效
 * 2. warn-accumulator 在 LOOP 场景下不误报（WARN 后有 PASS 清理 → 不触发）
 * 3. 文件级追踪（v1.1.5）——涉及文件已删除的 WARN 不计入累积
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { accumulateWarnings } from '@sofagent/daemon';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-loop-history-'));
}

interface HistoryEntry {
  timestamp: string;
  diffRange: string;
  task?: string;
  exitCode: number;
  ruleResults: Array<{ name: string; status: string; details?: string[] }>;
  diffFileCount: number;
  commitMsg?: string;
  engine?: string;
}

function writeHistory(dir: string, entries: HistoryEntry[]): void {
  const auditDir = path.join(dir, '.sofagent', 'audit');
  fs.mkdirSync(auditDir, { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e));
  fs.writeFileSync(path.join(auditDir, 'history.jsonl'), lines.join('\n'));
}

function makeLoopAuditEntry(
  verdict: 'PASS' | 'WARN' | 'FAIL',
  opts: { task?: string; minutesAgo?: number; engine?: string; ruleResults?: HistoryEntry['ruleResults'] } = {},
): HistoryEntry {
  const exitCodeMap = { PASS: 0, WARN: 1, FAIL: 2 };
  const timestamp = new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000).toISOString();
  return {
    timestamp,
    diffRange: 'HEAD',
    task: opts.task ?? 'LOOP task',
    exitCode: exitCodeMap[verdict],
    ruleResults: opts.ruleResults ?? [],
    diffFileCount: 1,
    commitMsg: `[LOOP audit] verdict=${verdict}`,
    engine: opts.engine ?? 'loop-graph',
  };
}

describe('LOOP audit history 完整性（v1.1.5 端到端）', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('三态序列（PASS → WARN → FAIL）都写 history，warn-accumulator 不触发（FAIL 中断连续性）', () => {
    const entries: HistoryEntry[] = [
      makeLoopAuditEntry('PASS', { minutesAgo: 30 }),
      makeLoopAuditEntry('WARN', { minutesAgo: 20 }),
      makeLoopAuditEntry('FAIL', { minutesAgo: 10 }),
    ];
    writeHistory(dir, entries);
    const result = accumulateWarnings(dir, 3);
    // 末尾是 FAIL（exitCode=2）→ 连续性中断 → consecutiveWarn = 0
    expect(result.triggered).toBe(false);
  });

  it('WARN → PASS 序列：PASS 清理后 warn-accumulator 不触发', () => {
    const entries: HistoryEntry[] = [
      makeLoopAuditEntry('WARN', { minutesAgo: 30 }),
      makeLoopAuditEntry('WARN', { minutesAgo: 20 }),
      makeLoopAuditEntry('WARN', { minutesAgo: 15 }),
      makeLoopAuditEntry('PASS', { minutesAgo: 10 }), // 最后一条是 PASS
    ];
    writeHistory(dir, entries);
    const result = accumulateWarnings(dir, 3);
    // PASS 在末尾 → 连续性被 PASS 中断 → consecutiveWarn = 0
    expect(result.triggered).toBe(false);
  });

  it('连续 3 条 WARN 无 PASS 清理 → warn-accumulator 触发（LOOP 场景不误报）', () => {
    const entries: HistoryEntry[] = [
      makeLoopAuditEntry('WARN', { minutesAgo: 30 }),
      makeLoopAuditEntry('WARN', { minutesAgo: 20 }),
      makeLoopAuditEntry('WARN', { minutesAgo: 10 }),
    ];
    writeHistory(dir, entries);
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(true);
    expect(result.message).toMatch(/连续 3 条 WARN/);
  });

  it('engine 字段标记：loop-graph 来源的 WARN 被正确识别', () => {
    const entries: HistoryEntry[] = [
      makeLoopAuditEntry('WARN', { minutesAgo: 10, engine: 'loop-graph' }),
      makeLoopAuditEntry('WARN', { minutesAgo: 8, engine: 'loop-graph' }),
      makeLoopAuditEntry('WARN', { minutesAgo: 5, engine: 'loop-graph-degraded' }),
    ];
    writeHistory(dir, entries);
    const result = accumulateWarnings(dir, 3);
    // 3 条 loop 来源的 WARN → 触发
    expect(result.triggered).toBe(true);
  });

  it('v1.1.5 文件级追踪：WARN 涉及文件已删除 → 该条不计入累积', () => {
    // 创建真实存在的文件
    fs.writeFileSync(path.join(dir, 'alive.ts'), 'export const x = 1;\n');

    const entries: HistoryEntry[] = [
      // 早两条：涉及文件已不存在
      makeLoopAuditEntry('WARN', {
        minutesAgo: 30,
        ruleResults: [
          { name: 'A18 垃圾文件', status: 'WARN', details: ['deleted-1.ts 是垃圾文件'] },
        ],
      }),
      makeLoopAuditEntry('WARN', {
        minutesAgo: 20,
        ruleResults: [
          { name: 'A18 垃圾文件', status: 'WARN', details: ['deleted-2.ts 是垃圾文件'] },
        ],
      }),
      // 最新一条：涉及文件存在
      makeLoopAuditEntry('WARN', {
        minutesAgo: 10,
        ruleResults: [
          { name: 'A18 垃圾文件', status: 'WARN', details: ['alive.ts 是垃圾文件'] },
        ],
      }),
    ];
    writeHistory(dir, entries);
    const result = accumulateWarnings(dir, 3);
    // 前两条涉及文件已删除 → 不计入 → consecutiveWarn = 1 → 不触发
    expect(result.triggered).toBe(false);
  });

  it('v1.1.5 文件级追踪：所有 WARN 涉及文件仍存在 → 全部计入累积', () => {
    fs.writeFileSync(path.join(dir, 'file-a.ts'), '');
    fs.writeFileSync(path.join(dir, 'file-b.ts'), '');
    fs.writeFileSync(path.join(dir, 'file-c.ts'), '');

    const entries: HistoryEntry[] = ['file-a.ts', 'file-b.ts', 'file-c.ts'].map((f, i) =>
      makeLoopAuditEntry('WARN', {
        minutesAgo: 30 - i * 10,
        ruleResults: [
          { name: 'A18 垃圾文件', status: 'WARN', details: [`${f} 是垃圾文件`] },
        ],
      }),
    );
    writeHistory(dir, entries);
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(true);
  });
});
