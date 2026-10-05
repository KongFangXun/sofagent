// ============================================================
// io-catch-visibility.test.ts · v1.5.7 F9：daemon 外部 IO 面 catch 吞错修复行为锁
// ============================================================
// 修复面（engine/daemon 中 try 上下文含外部 IO 调用的静默 catch，四分类台账
// tools/check/silent-catch-io-ledger.json）：
//   - inspectors/eval-failures.ts 标记写入失败 → 补 [sofagent] 前缀留痕
//   - webhook/index.ts 健康落盘失败 → 补 [sofagent] 前缀留痕
//
// 断言策略（对齐 companion-error-visibility.test.ts 先例）：
//   捕获 console.error（vi.spyOn）+ 注入失败路径（目录占位 / 只读位置），
//   断言 [sofagent] 前缀 + 降级语义不变。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runEvalFailuresCheck } from '../inspectors/eval-failures';

describe('F9 daemon 外部 IO 面 catch 吞错修复（错误发生时用户可知）', () => {
  let tmpDir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let savedData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-f9-daemon-'));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 数据面隔离：SOFAGENT_DATA 指 tmp（对齐 continuous-training.test.ts 纪律）
    savedData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = path.join(tmpDir, 'data');
  });

  afterEach(() => {
    errSpy.mockRestore();
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('eval-failures：标记写入失败 → console.error 带 [sofagent] 前缀（下轮重读可补偿）', () => {
    const dataDir = process.env.SOFAGENT_DATA!;
    // latest.json 存在且 failures 为空 → 走标记写入分支；
    // 标记路径 .last-think-processed 被目录占位 → writeFileSync 必失败
    fs.mkdirSync(path.join(dataDir, 'eval'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'eval', 'latest.json'), JSON.stringify({ failures: [] }));
    fs.mkdirSync(path.join(dataDir, 'eval', '.last-think-processed'), { recursive: true });
    const r = runEvalFailuresCheck(tmpDir);
    // 降级语义保留：failures 为空 → 仍返回 triggered=false
    expect(r.triggered).toBe(false);
    // 可见性：标记写入失败留痕
    const msgs = errSpy.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.startsWith('[sofagent]') && m.includes('标记写入失败'))).toBe(true);
  });
});
