// ============================================================
// load-chain-wiring.test.ts · v1.4.9 P1-1 回归锁
// ============================================================
// 背景：compactIfNeeded 定义在 load-chain/compactor.ts，由 index.ts 以 @public 再导出，
// 但**零生产调用点**（全仓只有 load-chain-compact.test.ts 调它）⇒ 能力声称完毕、
// 运行时无人调用。本批按 env 门控接线进 buildConstrainedSystemPrompt。
//
// 两条锁：
//   ① 设 SOFAGENT_CONTEXT_WINDOW_TOKENS + 超预算 → 触发压缩，且红线段原样保留
//   ② **不设 env → 输出与接线前逐字节一致**（休眠等价锁——防默认行为漂移）
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { buildConstrainedSystemPrompt } from '../index';
import { COMPACT_START_MARKER, COMPACT_END_MARKER } from '../load-chain/compactor';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf-8').digest('hex');

/** 红线行（不可压缩——PRESERVE_LINE_PREFIXES 命中 '🚫'） */
const REDLINE = '🚫 不删生产库（红线，不可丢）';

/** 造一份「长尾可压缩」的 SKILL.md：40 行普通文本 + 红线 + 40 行普通文本 */
function longSkill(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 40; i++) lines.push(`第 ${i} 行普通约束文本（可压缩段）`);
  lines.push(REDLINE);
  for (let i = 41; i <= 80; i++) lines.push(`第 ${i} 行普通约束文本（可压缩段）`);
  return lines.join('\n');
}

describe('v1.4.9 P1-1 · 自动上下文压缩接线（env 门控、缺省关闭）', () => {
  let tmpDir: string;
  let tmpHome: string;
  let prevHome: string | undefined;
  let prevWindow: string | undefined;
  let prevRatio: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-p11-proj-'));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-p11-home-'));
    prevHome = process.env.SOFAGENT_HOME;
    prevWindow = process.env.SOFAGENT_CONTEXT_WINDOW_TOKENS;
    prevRatio = process.env.SOFAGENT_CONTEXT_BUDGET_RATIO;
    // 隔离两处 env：SOFAGENT_HOME（P1-4 的用户级回退）+ 本能力自身的两个开关
    process.env.SOFAGENT_HOME = tmpHome;
    delete process.env.SOFAGENT_CONTEXT_WINDOW_TOKENS;
    delete process.env.SOFAGENT_CONTEXT_BUDGET_RATIO;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const restore = (key: string, prev: string | undefined): void => {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    };
    restore('SOFAGENT_HOME', prevHome);
    restore('SOFAGENT_CONTEXT_WINDOW_TOKENS', prevWindow);
    restore('SOFAGENT_CONTEXT_BUDGET_RATIO', prevRatio);
    for (const d of [tmpDir, tmpHome]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort 清理 */ }
    }
  });

  function writeSkill(content: string): void {
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'SKILL.md'), content, 'utf-8');
  }

  it('① 设 env + 超预算 → 触发压缩（带 start/end 标记）且红线行原样保留', () => {
    const content = longSkill();
    writeSkill(content);
    process.env.SOFAGENT_CONTEXT_WINDOW_TOKENS = '100'; // 100 × 3% = 3 token 预算 ⇒ 必然超

    const prompt = buildConstrainedSystemPrompt(tmpDir);

    expect(prompt).toContain(COMPACT_START_MARKER);
    expect(prompt).toContain(COMPACT_END_MARKER);
    expect(prompt).toContain(REDLINE);                 // 红线整行原样保留
    expect(prompt).toContain('…（压缩：');               // 非保留段被截断
    // 被截断的证据：末段 40 行普通文本不可能全在
    expect(prompt).not.toContain('第 80 行普通约束文本（可压缩段）');
  });

  it('① 压缩后仍保留「压缩：原 N 行，保留前 M 行」的可识别账目', () => {
    writeSkill(longSkill());
    process.env.SOFAGENT_CONTEXT_WINDOW_TOKENS = '100';
    const prompt = buildConstrainedSystemPrompt(tmpDir);
    expect(prompt).toMatch(/…（压缩：原 \d+ 行，保留前 \d+ 行）/);
  });

  it('② 不设 env → 输出与接线前逐字节一致（休眠等价锁）', () => {
    const content = longSkill();
    writeSkill(content);
    // 接线前的实现就是「parts 直接 join」——单层 fixture 下等于「# 宪法约束\n<content>」
    const preWiringOutput = `# 宪法约束\n${content}`;

    const prompt = buildConstrainedSystemPrompt(tmpDir);

    expect(sha256(prompt)).toBe(sha256(preWiringOutput)); // 逐字节等价（哈希级）
    expect(prompt).toBe(preWiringOutput);
    expect(prompt).not.toContain(COMPACT_START_MARKER);
    expect(prompt).not.toContain('…（压缩：');
  });

  it('② 非法 window 值 → 忽略 + 一次性 warn（不启用、不抛错）', () => {
    writeSkill(longSkill());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.SOFAGENT_CONTEXT_WINDOW_TOKENS = 'abc-p11-illegal';

    const prompt = buildConstrainedSystemPrompt(tmpDir);

    expect(prompt).not.toContain(COMPACT_START_MARKER);   // 未启用
    expect(warn).toHaveBeenCalledTimes(1);                 // 一次性
    expect(String(warn.mock.calls[0]?.[0])).toContain('abc-p11-illegal');
  });

  it('② 非法 ratio → 回落缺省 0.03 且仍可触发压缩（warn 非致命）', () => {
    writeSkill(longSkill());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.SOFAGENT_CONTEXT_WINDOW_TOKENS = '100';
    process.env.SOFAGENT_CONTEXT_BUDGET_RATIO = '5-p11-illegal'; // 超上界 0.2

    const prompt = buildConstrainedSystemPrompt(tmpDir);
    expect(prompt).toContain(COMPACT_START_MARKER);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
