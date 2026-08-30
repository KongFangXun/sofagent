// ============================================================
// think-generator.test.ts · generateThinkEntry 行为测试
// v1.4.4 第九章 #73：占位重写——原「空 diff 不抛错」单断言
// 无副作用验证，改为行为级验证（含写入路径与幂等）。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateThinkEntry } from '../think-generator';

describe('generateThinkEntry', () => {
  let tmpDataDir: string;
  const baseResults = {
    exitCode: 0, rules: [], status: 'PASS', details: [], diffFileCount: 0, diffRange: '', ruleResults: [],
  } as const;
  const fakeDiff = [{
    path: 'src/a.ts', before: 'x', after: 'y', beforeLines: 1, afterLines: 1,
    hunks: [],
  }] as never[]; // DiffFile 最小替身——只走条目生成路径，不校验 hunk 细节

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-think-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
  });

  it('空 diff 不写文件（think.md 不被创建）', () => {
    generateThinkEntry([], baseResults, undefined, { dataDir: tmpDataDir });
    // 早退路径：连 think.md 都不该出现
    expect(fs.existsSync(path.join(tmpDataDir, 'think.md'))).toBe(false);
  });

  it('非空 diff 写入 think.md 且含任务名与状态', () => {
    generateThinkEntry(fakeDiff as never, baseResults, '测试任务A', {
      dataDir: tmpDataDir,
      now: new Date('2026-08-31T02:00:00Z'),
    });
    const thinkPath = path.join(tmpDataDir, 'think.md');
    expect(fs.existsSync(thinkPath)).toBe(true);
    const content = fs.readFileSync(thinkPath, 'utf-8');
    expect(content).toContain('测试任务A');
    expect(content).toContain('PASS');
  });

  it('同一任务同一分钟重复调用不重复写入（幂等）', () => {
    const sameMinute = new Date('2026-08-31T02:00:00Z');
    generateThinkEntry(fakeDiff as never, baseResults, '幂等任务', { dataDir: tmpDataDir, now: sameMinute });
    const first = fs.readFileSync(path.join(tmpDataDir, 'think.md'), 'utf-8');
    // 第二次同任务同分钟——幂等检查应跳过
    generateThinkEntry(fakeDiff as never, baseResults, '幂等任务', { dataDir: tmpDataDir, now: sameMinute });
    const second = fs.readFileSync(path.join(tmpDataDir, 'think.md'), 'utf-8');
    expect(second).toBe(first);
  });
});
