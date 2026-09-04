// ============================================================
// companion-error-visibility.test.ts · v1.4.5 T8：companion.ts 静默吞错修复
// ============================================================
//
// 问题（原 companion.ts:185-216）：
//   1. think.md 写入 catch {} —— 空块静默，写入失败无人知晓
//   2. decision-log 写入 `as unknown as {...}` 双重断言 + 空 catch ——
//      emitDecision 真实抛错（schema/写盘）被吞，decisionLogged=false
//      但无任何日志，审计留痕静默丢失
//
// 修复：
//   1. 两处 catch 加 console.warn（[sofagent] 前缀——与 repo 通知约定一致）
//   2. 删双重断言——@sofagent/audit 动态 import 本身强类型，运行时
//      typeof 窄化校验 emitDecision 存在性
//
// 断言策略：捕获 console.warn 输出（vi.spyOn），注入失败路径
// （thinkPath 指向不可写位置 / audit 模块解析失败由构造场景触发）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCompanionDaily, COMPANION_DAYS } from '../companion';

describe('companion.ts 吞错可见化（v1.4.5 T8）', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-companion-err-'));
    // 陪跑期标记：deployedAt = 现在 → active
    fs.mkdirSync(path.join(tmpDir, 'fde'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'fde', 'companion.json'),
      JSON.stringify({ deployedAt: new Date().toISOString() }),
      'utf-8',
    );
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('test_runCompanionDaily_thinkMd写入失败_consoleWarn带Sofagent前缀', async () => {
    // 构造失败：dataDir 合法（fde/companion.json 可读 → 陪跑期 active），
    // 但 think.md 的落盘位置被同名目录占位——appendFileSync 到目录必失败。
    const dataDir = path.join(tmpDir, 'valid-data');
    fs.mkdirSync(path.join(dataDir, 'fde'), { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, 'fde', 'companion.json'),
      JSON.stringify({ deployedAt: new Date().toISOString() }),
      'utf-8',
    );
    fs.mkdirSync(path.join(dataDir, 'think.md'), { recursive: true });

    const result = await runCompanionDaily({
      dataDir,
      refineFn: async () => ({ finalState: 'COMPLETED', rounds: [] }),
    });

    // Refine 本身成功（ran=true）——think.md 失败只 warn 不阻断
    expect(result.ran).toBe(true);
    // 修复本体：空 catch → console.warn，且带 [sofagent] 前缀（品牌约定）
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('[sofagent]');
    expect(warned).toContain('think.md');
  });

  it('test_runCompanionDaily_thinkMd写入成功_无吞错warn', async () => {
    // 正常路径：合法 dataDir + mock refine → 不该有 think.md 相关 warn
    const result = await runCompanionDaily({
      dataDir: tmpDir,
      refineFn: async () => ({ finalState: 'COMPLETED', rounds: [{}, {}] }),
    });
    expect(result.ran).toBe(true);
    expect(result.finalState).toBe('COMPLETED');
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).not.toContain('think.md');
  });

  it('test_runCompanionDaily_正常执行_decisionLogged可观察', async () => {
    // 合法 dataDir（audit emitDecision 会真实写 decision-log.jsonl）
    const result = await runCompanionDaily({
      dataDir: tmpDir,
      refineFn: async () => ({ finalState: 'COMPLETED', rounds: [] }),
    });
    expect(result.ran).toBe(true);
    // audit 可用 → decisionLogged=true（emitDecision 强类型直调，无断言丢失）
    expect(result.decisionLogged).toBe(true);
    // decision-log.jsonl 落盘且含 companion 记录
    const logPath = path.join(tmpDir, 'audit', 'decision-log.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('sofagent-companion');
  });
});
