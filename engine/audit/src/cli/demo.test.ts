// ============================================================
// cli/demo.test.ts · `sofagent-audit demo` 三个钉戏单测（v1.5.1 第八章）
// ============================================================
//
// 任务书钉死的三条（防「改引擎忘改 demo」的静默退化）：
//   ① 三类违规必真实命中（断言 exit code 与规则号）
//   ② HMAC 链必可验 + 报告落盘
//   ③ 沙箱退出后 /tmp 清理干净（含「不触碰用户真实文件」）
// 另加一条：固定种子的确定性（报告字节一致）——「跑一万次结果一致」的
//   机械落点（该承诺无测试即空头支票，本仓历史对此类承诺的教训见
//   docs/LIMITATIONS.md 的「声明强度匹配」条目）。
//
// 🔴 本文件不 mock 任何东西：跑的是真的 runDemo → 真的 git commit →
//    真的 hook → 真的引擎。被测对象就是用户敲 `sofagent-audit demo` 时
//    执行的那条链路。「mock 掉的 demo 等于没有 demo」，同理 mock 掉的
//    demo 测试等于没有测试。
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDataDir } from '@sofagent/core';
import {
  runDemo,
  parseDemoArgs,
  parseHitRules,
  resolveEngineEntry,
  resolveHooksTemplateDir,
  type DemoRunResult,
} from './demo';

/** 单次 demo 的实测耗时上限（含 5 次引擎冷启动）——超时视为性能回归 */
const TEST_TIMEOUT_MS = 240_000;

/** 测试用产物目录（绝不写用户 ~/.sofagent/demo —— 测试自身也要守隔离纪律） */
let outDir = '';

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'sofagent-demo-test-out-'));

  // 前置：完整引擎入口必须已构建——缺它时 fail-loud（不静默跳过，
  // 静默跳过会让「测试全绿」失去含义：本文件测的正是引擎的拦截行为）
  const entry = resolveEngineEntry();
  if (entry === null) {
    throw new Error(
      '未找到 dist/index.js（完整引擎入口）——demo 测试需要真实引擎。请先运行：npm run build --workspace=engine/audit',
    );
  }
  const templates = resolveHooksTemplateDir();
  if (!existsSync(join(templates, 'commit-msg'))) {
    throw new Error(`未找到 hook 模板目录：${templates}。请先运行：npm run build --workspace=engine/audit`);
  }
});

afterAll(() => {
  if (outDir !== '') rmSync(outDir, { recursive: true, force: true });
});

// ============================================================
// 钉戏一 · 拦截必发生
// ============================================================

describe('demo · 钉戏一：拦截必发生（三类违规真实命中）', () => {
  let result: DemoRunResult;

  beforeAll(() => {
    result = runDemo({ speed: 'normal', outDir });
  }, TEST_TIMEOUT_MS);

  it('三类违规各跑一次独立提交，三次都拿到引擎判定（无静默跳过）', () => {
    expect(result.verdicts).toHaveLength(3);
    expect(result.verdicts.map((v) => v.ruleId)).toEqual(['A1', 'A2', 'A3']);
    for (const v of result.verdicts) {
      expect(v.hitRules.length, `${v.ruleId} 未命中任何规则——拦截未发生`).toBeGreaterThan(0);
    }
  });

  it('A1（敏感文件 .env）：真实命中 A1，commit 被拒（非零退出）', () => {
    const v1 = result.verdicts.find((v) => v.ruleId === 'A1');
    expect(v1).toBeDefined();
    expect(v1!.hitRules).toContain('A1');
    expect(v1!.rejected).toBe(true);
    expect(v1!.hookExit).not.toBe(0);
    // 证据面：规则名必须来自引擎自己的输出，不是断言里写死的期望
    expect(v1!.raw).toContain('A1 不碰敏感');
    expect(v1!.raw).toContain('commit 已阻止');
  });

  it('A2（硬编码密钥）：真实命中 A2，commit 被拒（非零退出）', () => {
    const v2 = result.verdicts.find((v) => v.ruleId === 'A2');
    expect(v2).toBeDefined();
    expect(v2!.hitRules).toContain('A2');
    expect(v2!.rejected).toBe(true);
    expect(v2!.hookExit).not.toBe(0);
    expect(v2!.raw).toContain('A2 不泄密钥');
  });

  it('A3（越界编辑）：真实命中 A3（拐杖档 WARN 放行——引擎既有语义，demo 不掩饰）', () => {
    const v3 = result.verdicts.find((v) => v.ruleId === 'A3');
    expect(v3).toBeDefined();
    expect(v3!.hitRules).toContain('A3');
    expect(v3!.raw).toContain('A3 不改越界');
    // A3 的 ruleClass='能力拐杖'，runner 明确降为 advisory 不阻断
    // （rules/runner.ts 的 crutch 降级分支）——故此处断言的是**放行**：
    // 这条「漏网」由幕④ 快照回滚兜住。若哪天引擎把这个语义改了，
    // 本断言会红，逼迫改的人显式面对 demo 的叙事一致性。
    expect(v3!.rejected).toBe(false);
    expect(v3!.hookExit).toBe(0);
  });

  it('parseHitRules 只认引擎自己写的行（防伪造证据面）', () => {
    expect(parseHitRules('❌ [sofagent] A1 不碰敏感 [底线]: 检测到敏感文件变更')).toEqual(['A1']);
    expect(parseHitRules('我声称命中了 A20')).toEqual([]);
  });
});

// ============================================================
// 钉戏二 · 链必可验 + 报告落盘
// ============================================================

describe('demo · 钉戏二：HMAC 链必可验且报告落盘', () => {
  let result: DemoRunResult;

  beforeAll(() => {
    result = runDemo({ speed: 'fast', outDir: join(outDir, 'chain') });
  }, TEST_TIMEOUT_MS);

  it('幕⑤ HMAC 链验证通过', () => {
    expect(result.chainOk).toBe(true);
  });

  it('demo-report.md 落盘且含验链结论与三类判定表', () => {
    expect(existsSync(result.reportPath)).toBe(true);
    const report = readFileSync(result.reportPath, 'utf-8');
    expect(report.length).toBeGreaterThan(0);
    expect(report).toContain('HMAC hash chain 完整');
    expect(report).toContain('幕③ 三类违规实测判决');
    expect(report).toContain('A1');
    expect(report).toContain('A2');
    expect(report).toContain('A3');
    // 幕④ 复原前后 diff 必须在报告里可见（验收项「diff 可见」的落点）
    expect(report).toContain('```diff');
  });

  it('五幕原文（CI artifact）落盘', () => {
    expect(existsSync(result.transcriptPath)).toBe(true);
    expect(readFileSync(result.transcriptPath, 'utf-8')).toContain('幕③ · 拦截');
  });

  it('幕④ 快照回滚：复原前后 diff 非空且污染标记已消失', () => {
    const report = readFileSync(result.reportPath, 'utf-8');
    expect(report).toContain('回滚前含污染标记 `idcard`：是');
    expect(report).toContain('回滚后含污染标记 `idcard`：否');
  });
});

// ============================================================
// 钉戏三 · 沙箱必清（含不触碰用户真实文件）
// ============================================================

describe('demo · 钉戏三：沙箱退出后清理干净', () => {
  let result: DemoRunResult;

  beforeAll(() => {
    result = runDemo({ speed: 'fast', outDir: join(outDir, 'sandbox') });
  }, TEST_TIMEOUT_MS);

  it('沙箱目录退出后不存在（回读校验，不是「调了 rm 就算数」）', () => {
    expect(result.sandboxCleaned).toBe(true);
    expect(result.sandboxDir).not.toBe('');
    expect(existsSync(result.sandboxDir)).toBe(false);
  });

  it('沙箱建在 /tmp 下（真实项目目录零接触）', () => {
    expect(result.sandboxDir.startsWith('/tmp/') || result.sandboxDir.startsWith(tmpdir())).toBe(true);
    expect(result.sandboxDir).toContain('sofagent-demo-');
  });

  it('/tmp 下不留本次运行的沙箱残骸', () => {
    const base = existsSync('/tmp') ? '/tmp' : tmpdir();
    const leftovers = readdirSync(base).filter((n) => n.startsWith('sofagent-demo-'));
    // mkdtempSync 的目录名带上本次运行特有的随机后缀——被清掉就不会出现在这里
    expect(leftovers).not.toContain(result.sandboxDir.split('/').pop());
  });

  it('真实用户文件未被触碰：引擎写入全部落在沙箱内（因果证明）', () => {
    // 🔴 为什么断言「因果」而不是比对真实目录指纹：真实目录是全局共享状态，
    //    任何与本 demo 无关的进程（用户自己的审计 / daemon / 另一条 demo）
    //    同期写入都会让指纹变化 —— 拿它当开关会产出假阴性（用户跑 demo 时
    //    恰好有别的审计在写 ⇒ 误报「隔离失败」）。因果证明则直接验证
    //    「本次运行的审计痕迹在不在沙箱里」：SOFAGENT_HOME / SOFAGENT_DATA
    //    重定向一旦失效，痕迹必然落到用户目录、沙箱里必然为空 ⇒ 断言必红。
    //    这既是隔离失效的唯一真实故障形态，又完全不受并发干扰。
    expect(result.isolationOk).toBe(true);
    const report = readFileSync(result.reportPath, 'utf-8');
    expect(report).toContain('因果证明');
    expect(report).toContain('沙箱审计史记录数：4');
    expect(report).toContain('沙箱快照 shadow repo：在位');
    expect(report).toContain('结论：**通过**');
  });

  it('产物落在显式 --out 目录（不散落 cwd 或用户家目录）', () => {
    expect(result.reportPath.startsWith(outDir)).toBe(true);
    expect(result.transcriptPath.startsWith(outDir)).toBe(true);
  });
});

// ============================================================
// 附加 · 确定性（固定种子 ⇒ 报告字节一致）
// ============================================================

describe('demo · 确定性：固定种子下报告跨次运行字节一致', () => {
  it('两次 fast 档运行产出同一份 demo-report.md', () => {
    const a = join(outDir, 'determinism-a');
    const b = join(outDir, 'determinism-b');
    const r1 = runDemo({ speed: 'fast', outDir: a });
    const r2 = runDemo({ speed: 'fast', outDir: b });
    expect(r1.exitCode).toBe(0);
    expect(r2.exitCode).toBe(0);
    // 报告内只归一化了沙箱路径与 ISO 时间戳（报告首部已声明），
    // 其余为引擎原始输出——故此处可做字节级比对。
    expect(readFileSync(r1.reportPath, 'utf-8')).toBe(readFileSync(r2.reportPath, 'utf-8'));
    // 反向锁：报告确实产出了内容（防「两边都是空串」的假绿）
    expect(readFileSync(r1.reportPath, 'utf-8').length).toBeGreaterThan(1000);
  }, TEST_TIMEOUT_MS);
});

// ============================================================
// 附加 · transcript 落盘失败不得打印假路径（「不撒谎」的机械落点）
// ============================================================

describe('demo · 五幕原文落盘失败时不得打印假路径', () => {
  it('写盘失败 ⇒ stderr 可见警告 + 路径行据实打印「未生成」+ 演示判定不因此变红', () => {
    // 构造写盘**必然**失败的现场：用同名目录占住 transcript 目标路径 ⇒ writeFileSync EISDIR。
    // 这不是 mock——真的让 fs 写不进去，走的是产品里那条 catch 分支。
    // （若哪天这段改成「先打印路径再写盘」，下方 ③ 的断言会红：那正是「用户拿到不存在路径」的复现。）
    const blocked = join(outDir, 'transcript-blocked');
    const fakeTarget = join(blocked, 'demo-transcript.txt');
    mkdirSync(fakeTarget, { recursive: true });

    const logs: string[] = [];
    const errs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logs.push(a.join(' '));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errs.push(a.join(' '));
    });
    let result: DemoRunResult;
    try {
      result = runDemo({ speed: 'fast', outDir: blocked });
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }

    // ① 前置：写盘确实失败了——否则本用例没走到目标分支，下面的断言就是假绿
    expect(statSync(fakeTarget).isDirectory()).toBe(true);

    // ② 失败必须可见：stderr 有警告行，且带真实路径与原因
    const warn = errs.find((l) => l.includes('五幕原文落盘失败'));
    expect(warn, '落盘失败被静默吞掉——stderr 无警告行').toBeDefined();
    expect(warn).toContain('demo-transcript.txt');

    // ③ 不得撒谎：真实失败时，路径行不得打印那个不存在的路径
    const pathLine = logs.find((l) => l.includes('五幕原文'));
    expect(pathLine, '收尾未打印「五幕原文」行').toBeDefined();
    expect(pathLine).toContain('（写入失败，未生成）');
    expect(pathLine).not.toContain(fakeTarget);

    // ④ 不因此变红：终端五幕已完整输出，产物副本写不出不该改演示判定
    expect(result!.exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);
});

// ============================================================
// 附加 · 报告不得失真（逐字转载锁）
// ============================================================

describe('demo · 报告不得失真（逐字转载锁）', () => {
  let result: DemoRunResult;
  let report: string;

  beforeAll(() => {
    result = runDemo({ speed: 'fast', outDir: join(outDir, 'verbatim') });
    report = readFileSync(result.reportPath, 'utf-8');
  }, TEST_TIMEOUT_MS);

  it('报告逐字转载引擎原文，且归一化只作用路径/时间戳、不侵蚀引擎正文', () => {
    // 为什么需要这条：报告首部自称「规则号、违规文案、退出码、diff 正文均为引擎原始输出，
    // 逐字未改」——这是一句**承诺**。此前没有任何用例守着它：`normalize()` 若被改成多抹
    // 一类（例如顺手把 `[sofagent]` 前缀也抹掉），报告会失真而其余用例照样全绿
    // （它们断言的是 verdict.raw，那条路径不经 normalize）。本用例就钉这个缺口。
    //
    // 反例验证（已手工做过一次，记录在此以备复现）：把 demo.ts 的 `normalize()` 尾部加一句
    // `.replace(/\[sofagent\]/g, '')` → 本用例 ①③ 变红；还原即绿。

    // ① 引擎正文逐字在报告里——不是转述、不是重排
    //    规则拦截行：引擎自己的 `[sofagent] <规则号> <规则名> [档位]` 形态
    expect(report).toContain('[sofagent] A1 不碰敏感 [底线]');
    expect(report).toContain('[sofagent] A2 不泄密钥 [底线]');
    expect(report).toContain('[sofagent] A3 不改越界 [拐杖]');
    //    判定行：引擎的最终判定前缀
    expect(report).toContain('[sofagent] 判定:');
    //    拒绝语句与违规文案：证明「commit 被拒」也是转载而非演示器自述
    expect(report).toContain('commit 已阻止');
    expect(report).toContain('检测到疑似密钥/令牌泄漏');

    // ② `normalize()` 确实是活的（不是死代码）——`<TIMESTAMP>` 只可能由它产生，
    //    报告里任何地方都没有硬编码过这个占位串
    expect(report).toContain('<TIMESTAMP>');

    // ③ `normalize()` 的作用域没越界：
    //    (a) 引擎正文的标记面仍在（`[sofagent]` 出现次数应覆盖 ≥3 回合 × 多条）
    expect((report.match(/\[sofagent\]/g) ?? []).length).toBeGreaterThanOrEqual(5);
    //    (b) 沙箱绝对路径未被残留——若路径归一化失效，它会原样出现在 diff / 验链输出里
    expect(report).not.toContain(result.sandboxDir);
  }, TEST_TIMEOUT_MS);
});

// ============================================================
// 附加 · 参数解析（纯函数，零成本）
// ============================================================

describe('demo · CLI 参数解析', () => {
  it('--speed fast 透传生效，缺省为 normal', () => {
    expect(parseDemoArgs(['node', 'cli-quick.js', 'demo', '--speed', 'fast']).speed).toBe('fast');
    expect(parseDemoArgs(['node', 'cli-quick.js', 'demo']).speed).toBe('normal');
  });

  it('--out 覆盖产物目录；缺省落在 dataDir 下（不再写用户家目录）', () => {
    expect(parseDemoArgs(['node', 'cli-quick.js', 'demo', '--out', '/tmp/x']).outDir).toBe('/tmp/x');
    // 缺省 = `<dataDir>/demo`——与仓内 dataDir 解析口径一致（显式 > SOFAGENT_DATA > 默认数据目录）；
    // 不再是 `~/.sofagent/demo`（demo 自称沙箱隔离，默认产物不该落用户家目录——v1.5.1 修复批 B5）。
    expect(parseDemoArgs(['node', 'cli-quick.js', 'demo']).outDir).toBe(join(getDataDir(), 'demo'));
  });

  // v1.5.1 修复批 B5 行为锁：默认分支此前无测试覆盖（验收探针恒传显式 outDir）。
  it('缺省 outDir 随 SOFAGENT_DATA 走（默认落在 dataDir 下）', () => {
    const saved = process.env.SOFAGENT_DATA;
    const tmpData = mkdtempSync(join(tmpdir(), 'sofagent-demo-data-'));
    try {
      process.env.SOFAGENT_DATA = tmpData;
      const parsed = parseDemoArgs(['node', 'cli-quick.js', 'demo']);
      expect(parsed.outDir).toBe(join(tmpData, 'demo'));
      expect(parsed.outDir.startsWith(tmpData)).toBe(true);
      // --out 覆盖能力保留（不受 dataDir 影响）
      expect(parseDemoArgs(['node', 'cli-quick.js', 'demo', '--out', '/tmp/y']).outDir).toBe('/tmp/y');
    } finally {
      if (saved === undefined) delete process.env.SOFAGENT_DATA;
      else process.env.SOFAGENT_DATA = saved;
      rmSync(tmpData, { recursive: true, force: true });
    }
  });
});
