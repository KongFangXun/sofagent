// ============================================================
// qa-verify-warn-accumulator.test.ts · WARN 累积报告巡检器验证（v1.1.4）
// 由 QA 工程师编写，验证连续 WARN 累积检测逻辑
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import { accumulateWarnings } from '../warn-accumulator';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-qa-warn-'));
}

function makeHistoryEntry(opts: {
  exitCode: number;
  timestamp?: string;
  task?: string;
  commitMsg?: string;
  diffRange?: string;
}): string {
  return JSON.stringify({
    timestamp: opts.timestamp ?? new Date().toISOString(),
    exitCode: opts.exitCode,
    task: opts.task ?? 'test task',
    commitMsg: opts.commitMsg ?? '',
    diffRange: opts.diffRange ?? 'HEAD~1..HEAD',
  });
}

describe('warn-accumulator QA 验证', () => {
  let dir: string;
  let auditDir: string;

  beforeEach(() => {
    dir = tmpDir();
    auditDir = path.join(dir, '.sofagent', 'audit');
    fs.mkdirSync(auditDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 测试：无 history 文件 → triggered=false
  it('无 audit history → triggered=false', () => {
    const result = accumulateWarnings(dir);
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe('info');
  });

  // 测试：连续 3 条 WARN → triggered=true
  it('连续 3 条 WARN（阈值=3）→ triggered=true', () => {
    const now = Date.now();
    const entries = [0, 1, 2].map((i) =>
      makeHistoryEntry({
        exitCode: 1,
        timestamp: new Date(now - (2 - i) * 3600_000).toISOString(),
        task: `WARN task ${i}`,
      })
    );
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('warning');
  });

  // 测试：2 条 WARN（< 阈值 3）→ triggered=false
  it('2 条 WARN（< 阈值 3）→ triggered=false', () => {
    const now = Date.now();
    const entries = [0, 1].map((i) =>
      makeHistoryEntry({
        exitCode: 1,
        timestamp: new Date(now - (1 - i) * 3600_000).toISOString(),
      })
    );
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(false);
  });

  // 测试：超过 7 天的 WARN 不计入 → triggered=false
  it('8 天前的 WARN 不计入', () => {
    const now = Date.now();
    const old = new Date(now - 8 * 24 * 3600_000).toISOString();
    const entries = [0, 1, 2].map((i) =>
      makeHistoryEntry({
        exitCode: 1,
        timestamp: i === 0 ? old : new Date(now - (2 - i) * 3600_000).toISOString(),
      })
    );
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    // 只有 2 条近 7 天 WARN → 未达阈值
    expect(result.triggered).toBe(false);
  });

  // 测试：PASS（exitCode=0）记录不触发 WARN 累积
  it('全是 PASS（exitCode=0）→ triggered=false', () => {
    const now = Date.now();
    const entries = [0, 1, 2].map((i) =>
      makeHistoryEntry({
        exitCode: 0,
        timestamp: new Date(now - (2 - i) * 3600_000).toISOString(),
      })
    );
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(false);
  });

  // 测试：损坏的 JSON 行应被跳过（不抛异常）
  it('含损坏 JSON 行 → 不抛异常', () => {
    const now = Date.now();
    const valid = makeHistoryEntry({
      exitCode: 1,
      timestamp: new Date(now).toISOString(),
    });
    const content = 'this is not json\n' + valid + '\n{broken';
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), content);
    const result = accumulateWarnings(dir, 1);
    // 1 条有效 WARN → 达到阈值 1
    expect(result.triggered).toBe(true);
  });

  // 测试：triggered=true 时 message 含连续 WARN 数量
  it('triggered=true 时 message 含连续 WARN 提示', () => {
    const now = Date.now();
    const entries = [0, 1, 2].map((i) =>
      makeHistoryEntry({
        exitCode: 1,
        timestamp: new Date(now - (2 - i) * 3600_000).toISOString(),
      })
    );
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    expect(result.message).toMatch(/连续.*WARN/);
  });

  // ────────────────────────────────────────
  // v1.1.4 审查修正：真正的连续性判定
  // ────────────────────────────────────────

  // 测试：WARN 后有 PASS 清理 → 不触发（v1.1.4 核心修正）
  // 场景：WARN, WARN, PASS, WARN, WARN → 末尾只有 2 条连续 WARN，不达阈值 3
  it('WARN 后有 PASS 清理 → 末尾连续数 < 阈值 → 不触发', () => {
    const now = Date.now();
    const entries = [
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 5 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 4 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 0, timestamp: new Date(now - 3 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 2 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 1 * 3600_000).toISOString() }),
    ];
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(false);
    expect(result.message).toMatch(/末尾连续 2/);
  });

  // 测试：PASS 在开头，末尾 3 条连续 WARN → 触发
  it('PASS 在开头，末尾 3 条连续 WARN → 触发', () => {
    const now = Date.now();
    const entries = [
      makeHistoryEntry({ exitCode: 0, timestamp: new Date(now - 4 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 3 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 2 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 1 * 3600_000).toISOString() }),
    ];
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(true);
  });

  // 测试：FAIL 也算"非 WARN"中断连续性
  it('WARN 后有 FAIL → 连续性中断', () => {
    const now = Date.now();
    const entries = [
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 4 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 2, timestamp: new Date(now - 3 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 2 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 1 * 3600_000).toISOString() }),
    ];
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(false);
  });

  // 测试：message 含「近 7 天共 N 条」+「末尾连续 M 条」双数字
  it('triggered=true 时 message 含总 WARN 数 + 末尾连续数', () => {
    const now = Date.now();
    const entries = [
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 5 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 4 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 0, timestamp: new Date(now - 3 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 2 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 1.5 * 3600_000).toISOString() }),
      makeHistoryEntry({ exitCode: 1, timestamp: new Date(now - 1 * 3600_000).toISOString() }),
    ];
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    expect(result.triggered).toBe(true);
    expect(result.message).toMatch(/共 5 条 WARN/);
    expect(result.message).toMatch(/末尾连续 3 条/);
  });

  // ────────────────────────────────────────
  // v1.1.5 文件级追踪：WARN 涉及的文件已被删除/修复时不计入累积
  // ────────────────────────────────────────

  // 测试：WARN(fileA) → 后续 commit 删除 fileA → warn-accumulator 不再触发
  it('WARN 涉及文件已被删除 → 该条 WARN 不计入累积', () => {
    const now = Date.now();
    // 构造 3 条 WARN，前两条涉及的文件已不存在（模拟被删除）
    // 第 3 条涉及的文件存在
    fs.writeFileSync(path.join(dir, 'still-exists.ts'), 'export const x = 1;\n');

    const entries = [
      // 早两条：涉及文件已删除
      JSON.stringify({
        timestamp: new Date(now - 3 * 3600_000).toISOString(),
        exitCode: 1,
        task: 'WARN deleted file',
        diffRange: 'HEAD~1..HEAD',
        ruleResults: [
          { name: 'A18 垃圾文件', status: 'WARN', details: ['deleted-file-1.ts 是垃圾文件'] },
        ],
      }),
      JSON.stringify({
        timestamp: new Date(now - 2 * 3600_000).toISOString(),
        exitCode: 1,
        task: 'WARN deleted file',
        diffRange: 'HEAD~1..HEAD',
        ruleResults: [
          { name: 'A18 垃圾文件', status: 'WARN', details: ['deleted-file-2.ts 是垃圾文件'] },
        ],
      }),
      // 最新一条：涉及文件仍存在
      JSON.stringify({
        timestamp: new Date(now - 1 * 3600_000).toISOString(),
        exitCode: 1,
        task: 'WARN existing file',
        diffRange: 'HEAD~1..HEAD',
        ruleResults: [
          { name: 'A18 垃圾文件', status: 'WARN', details: ['still-exists.ts 是垃圾文件'] },
        ],
      }),
    ];
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    // 前两条涉及的文件已删除 → 不计入 → 末尾连续 = 1（< 阈值 3）→ 不触发
    expect(result.triggered).toBe(false);
  });

  // 测试：WARN(fileA) → 后续无 commit 处理 fileA → warn-accumulator 触发
  it('WARN 涉及文件仍存在 → 计入累积，达阈值触发', () => {
    const now = Date.now();
    // 创建 3 个真实存在的文件
    fs.writeFileSync(path.join(dir, 'file-a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'file-b.ts'), 'export const b = 1;\n');
    fs.writeFileSync(path.join(dir, 'file-c.ts'), 'export const c = 1;\n');

    const entries = ['file-a.ts', 'file-b.ts', 'file-c.ts'].map((f, i) =>
      JSON.stringify({
        timestamp: new Date(now - (3 - i) * 3600_000).toISOString(),
        exitCode: 1,
        task: `WARN ${f}`,
        diffRange: 'HEAD~1..HEAD',
        ruleResults: [
          { name: 'A18 垃圾文件', status: 'WARN', details: [`${f} 是垃圾文件`] },
        ],
      }),
    );
    fs.writeFileSync(path.join(auditDir, 'history.jsonl'), entries.join('\n'));
    const result = accumulateWarnings(dir, 3);
    // 3 条 WARN 涉及文件都存在 → 末尾连续 = 3 → 触发
    expect(result.triggered).toBe(true);
    expect(result.message).toMatch(/连续 3 条 WARN/);
  });
});
