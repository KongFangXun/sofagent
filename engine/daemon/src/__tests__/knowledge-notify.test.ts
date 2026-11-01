// ============================================================
// knowledge-notify.test.ts · 知识沉淀主动通知测试（T05）
// v1.1.8 新增
//
// 覆盖用例（共 6 case，门禁 ≥5）：
//   1. buildSummary：双素材齐备 → 正文含两节内容
//   2. buildSummary：素材缺失 → 降级"尚无数据"占位
//   3. buildSummary：超长正文截断到 SUMMARY_MAX_CHARS
//   4. pushKnowledgeSummary：双通道推送（daemon:notice + openclaw:im），注入收集器验证
//   5. pushKnowledgeSummary：单通道失败不阻塞另一通道（best-effort）
//   6. pushKnowledgeSummary：推送函数抛错 → 返回 false 不抛异常，且必须打 warn 留痕
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  buildSummary,
  collectSummaryMaterial,
  pushKnowledgeSummary,
  NO_DATA_TEXT,
} from '../notify';

describe('buildSummary · 摘要构建与降级', () => {
  // 用例 1：双素材齐备
  it('log.md + health-report.md 齐备 → 正文含两节内容', () => {
    const out = buildSummary({
      weeklyLog: '本周学 3 个 concept / 7 个 atom',
      healthReport: '孤立 1 / 重复 0',
    });
    expect(out).toContain('本周学习');
    expect(out).toContain('本周学 3 个 concept');
    expect(out).toContain('知识库健康');
    expect(out).toContain('孤立 1');
    expect(out).not.toContain(NO_DATA_TEXT);
  });

  // 用例 2：素材缺失降级
  it('素材缺失 → 对应节降级为"尚无数据"', () => {
    const both = buildSummary({ weeklyLog: null, healthReport: null });
    expect(both.match(new RegExp(NO_DATA_TEXT, 'g'))?.length).toBe(2);
    const one = buildSummary({ weeklyLog: '本周学 1 个 concept', healthReport: null });
    expect(one).toContain('本周学 1 个 concept');
    expect(one).toContain(NO_DATA_TEXT);
  });

  // 用例 3：超长截断
  it('超长素材 → 正文截断到 1500 字符', () => {
    const out = buildSummary({ weeklyLog: 'x'.repeat(5000), healthReport: 'y'.repeat(5000) });
    expect(out.length).toBeLessThanOrEqual(1501); // 1500 + 省略号
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('pushKnowledgeSummary · 双通道推送（best-effort）', () => {
  let tmpDir: string;
  const savedData = process.env.SOFAGENT_DATA;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-notify-'));
    process.env.SOFAGENT_DATA = path.join(tmpDir, '.sofagent');
    fs.mkdirSync(process.env.SOFAGENT_DATA, { recursive: true });
  });

  afterEach(() => {
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  // 用例 4：双通道推送
  it('daemon:notice + openclaw:im 双通道推送，素材来自 log.md/health-report.md', async () => {
    fs.writeFileSync(path.join(process.env.SOFAGENT_DATA!, 'log.md'), '本周学 2 个 concept');
    fs.writeFileSync(path.join(process.env.SOFAGENT_DATA!, 'health-report.md'), '健康：无孤立');
    const pushes: Array<{ target: string; message: string }> = [];
    const ok = await pushKnowledgeSummary(tmpDir, async (opts) => {
      pushes.push({ target: opts.target, message: opts.message });
      return true;
    });
    expect(ok).toBe(true);
    expect(pushes.map((p) => p.target).sort()).toEqual(['daemon:notice', 'openclaw:im']);
    for (const p of pushes) {
      expect(p.message).toContain('本周学 2 个 concept');
      expect(p.message).toContain('健康：无孤立');
    }
    // 素材收集函数自身行为
    const material = collectSummaryMaterial(tmpDir);
    expect(material.weeklyLog).toContain('本周学 2 个 concept');
  });

  // 用例 5：单通道失败不阻塞
  it('openclaw:im 失败 → daemon:notice 仍推送，返回 true', async () => {
    const pushed: string[] = [];
    const ok = await pushKnowledgeSummary(tmpDir, async (opts) => {
      if (opts.target === 'openclaw:im') return false;
      pushed.push(opts.target);
      return true;
    });
    expect(ok).toBe(true);
    expect(pushed).toEqual(['daemon:notice']);
  });

  // 用例 6：推送函数抛错 → 返回 false 不抛异常（返回值语义不变），
  // 但失败必须由 notify() 打 warn 留痕——"静默"不是规格，只是待修的缺陷。
  // 🔴 命名陷阱（v1.7.0 纠）：原名叫「全通道失败」，名不副实——同步抛时
  // `Promise.all([f(a).catch(), f(b).catch()])` 的**数组字面量求值中断**，
  // 第二个通道（openclaw:im）根本没被发起，实际只尝试了 1 个通道。
  // 真正的「全通道失败」是 async 抛（上面 allFail 那段）——但它走 per-channel
  // `.catch(()=>false)`，到不了外层 catch，故不产生 warn。
  it('首个通道同步抛 → 整体失败、返回 false（生产注入为 async，此形态仅测试面）', async () => {
    // ① async 抛（= 生产 pushToTarget 的形态）：两通道都 reject → 被各自
    //    `.catch(()=>false)` 吞成 false → 返回 false，且**不**出现外层 warn
    const allFail = await pushKnowledgeSummary(tmpDir, async () => { throw new Error('通道全挂'); });
    expect(allFail).toBe(false);

    // ② 同步抛（注入方违约形态）：数组字面量求值中断 → 只有首个通道被发起 →
    //    异常落到外层 catch → 必须留下 warn
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(' '));
    });
    let calls = 0;
    const thrower = await pushKnowledgeSummary(tmpDir, () => { calls++; throw new Error('同步炸'); });
    spy.mockRestore();
    expect(thrower).toBe(false);

    // 锁住「只发起 1 个通道」这个事实：改成 2 说明有人给 pushFn 包了
    // Promise.resolve().then(...)（R7 的可选修法）——那是行为变更，必须显式看见。
    expect(calls, '同步抛时第二个通道不应被发起（数组字面量求值中断）').toBe(1);

    const warns = logs.filter((l) => l.includes('知识摘要推送失败'));
    expect(warns, `实际日志：\n${logs.join('\n')}`).toHaveLength(1); // warn 真的打了
    expect(warns[0]).toContain('同步炸'); // 含原始错误文案
  });
});

// ============================================================
// readTail 留痕回归锁（R2 残余）：区分「素材缺失」与「读取失败」
// ------------------------------------------------------------
// 缺陷史：readTail 的 catch 曾与 existsSync 早退同为静默——读失败（EISDIR 等）
// 会静默退化成正文「尚无数据」，与「文件本来就不存在」不可区分。
// 变异可检：删掉该 notify → 本用例 ② 段红。③ 段锁的是「不存在 → 零告警」这一
// 对外行为；existsSync 早退与 catch 内 ENOENT 分支互为冗余，**单独删任一层都不会红**
// （两层同时删才红）——这是刻意的纵深防御，不是漏锁。
// ============================================================
describe('readTail 留痕回归锁 · 无数据不告警 / 读失败必留痕', () => {
  let dataDir: string;
  const savedReadTailData = process.env.SOFAGENT_DATA;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-readtail-'));
    process.env.SOFAGENT_DATA = dataDir;
  });

  afterEach(() => {
    if (savedReadTailData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedReadTailData;
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('素材缺失 → 零告警；读失败（EISDIR）→ 必留痕；ENOENT 早退 → 零告警', () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(' '));
    });

    try {
      // ① 无数据：两份素材都不存在 → 零告警（「无数据不告警」是本次区分的另一半）
      const missing = collectSummaryMaterial(dataDir);
      expect(missing.weeklyLog).toBeNull();
      expect(missing.healthReport).toBeNull();
      expect(logs, `无数据不得告警：\n${logs.join('\n')}`).toHaveLength(0);

      // ② 读失败：log.md 被目录占位 → readFileSync 抛 EISDIR → 必须留痕
      fs.mkdirSync(path.join(dataDir, 'log.md'), { recursive: true });
      const broken = collectSummaryMaterial(dataDir);
      expect(broken.weeklyLog).toBeNull(); // 降级语义不变（仍返回 null）
      const warns = logs.filter((l) => l.includes('读取失败（不视为无数据）'));
      expect(warns, `实际日志：\n${logs.join('\n')}`).toHaveLength(1);
      expect(warns[0]).toContain('log.md'); // 含路径
      expect(warns[0]).toContain('EISDIR'); // 含原始错误文案
      // health-report.md 仍不存在 → 不得因它多打一条
      expect(logs).toHaveLength(1);

      // ③ 早退不误报：悬空软链 → existsSync 为 false → 走早退，零告警
      //    （注意：这锁的是 existsSync 早退本身；catch 内的 ENOENT 分支只能由
      //      「existsSync 与 read 之间被删」的真竞态命中，无 hook 无法确定性构造）
      fs.rmSync(path.join(dataDir, 'log.md'), { recursive: true, force: true });
      fs.symlinkSync(path.join(dataDir, 'gone-target'), path.join(dataDir, 'log.md'));
      logs.length = 0;
      const raced = collectSummaryMaterial(dataDir);
      expect(raced.weeklyLog).toBeNull();
      expect(logs, `ENOENT 不得误报：\n${logs.join('\n')}`).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
