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
//   6. pushKnowledgeSummary：推送函数抛错 → 返回 false 不抛异常（失败静默）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  // 用例 6：推送函数抛错 → 失败静默
  it('推送函数整体抛错 / 全通道失败 → 返回 false 不抛异常', async () => {
    const allFail = await pushKnowledgeSummary(tmpDir, async () => { throw new Error('通道全挂'); });
    expect(allFail).toBe(false);
    const thrower = await pushKnowledgeSummary(tmpDir, () => { throw new Error('同步炸'); });
    expect(thrower).toBe(false);
  });
});
