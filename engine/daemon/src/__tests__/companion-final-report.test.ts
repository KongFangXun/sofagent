// ============================================================
// companion-final-report.test.ts · v1.5.0 章五：陪跑期期满总结报告
// ============================================================
//
// 验收标准（devlog 章五）：
//   1. 陪跑期满自动生成总结报告（执行统计+规则触发+介入汇总）
//   2. fde_deploy 部署后陪跑期状态自动生效（无需手工配置）
//      ——fde-deploy 登记侧由 mcp 包测试覆盖；本文件覆盖 companion
//       侧闭环：deployedAt 显式登记 → 期满 → 报告生成。
//
// 数据源契约：
//   - think.md 统计 `（sofagent-companion）` 标记条目（双向写两条/天）
//   - decision-log.jsonl 统计 agentId=sofagent-companion 条目 +
//     why 中 finalState=XXX 终态分布
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runCompanionDaily,
  generateCompanionReport,
  companionReportPath,
  COMPANION_DAYS,
} from '../companion';

describe('companion 期满总结报告（v1.5.0 章五）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-companion-report-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('test_generateCompanionReport_期满生成报告_含执行统计与终态分布', () => {
    // 部署 20 天前（> 14 天陪跑期）——已期满
    const deployedAt = new Date(Date.now() - (COMPANION_DAYS + 6) * 86_400_000).toISOString();
    fs.mkdirSync(path.join(tmpDir, 'fde'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'fde', 'companion.json'),
      JSON.stringify({ deployedAt }),
      'utf-8',
    );
    // think.md 双向写两条（审计视角 + FDE 视角）
    fs.writeFileSync(
      path.join(tmpDir, 'think.md'),
      '## 2026-01-01 08:00 任务: FDE 陪跑期每日 Refine 巡检\n\n'
      + '- #审计结果(sofagent-companion): INFO — Refine finalState=COMPLETED（2 轮）\n'
      + '## 2026-01-01 08:00 任务: FDE 陪跑反馈（人侧视角）\n\n'
      + '- #审计结果(sofagent-companion): INFO — 面向 FDE 的陪跑记录\n',
      'utf-8',
    );
    // decision-log 两条 companion 记录
    fs.mkdirSync(path.join(tmpDir, 'audit'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'audit', 'decision-log.jsonl'),
      JSON.stringify({ agentId: 'sofagent-companion', why: { text: 'finalState=COMPLETED，共 2 轮' } }) + '\n'
      + JSON.stringify({ agentId: 'other-agent', why: { text: 'finalState=COMPLETED' } }) + '\n'
      + JSON.stringify({ agentId: 'sofagent-companion', why: { text: 'finalState=error: boom，共 1 轮' } }) + '\n',
      'utf-8',
    );

    const result = generateCompanionReport(tmpDir);

    expect(result.generated).toBe(true);
    const report = fs.readFileSync(companionReportPath(tmpDir), 'utf-8');
    // 报告结构：标题 + 执行统计 + 终态分布 + 介入汇总
    expect(report).toContain('# FDE 陪跑期总结报告');
    expect(report).toContain('**2**'); // think.md 两条
    expect(report).toContain('| COMPLETED | 1 |');
    expect(report).toContain('| error: | 1 |');
    expect(report).toContain('共 2 条介入决策');
    // companion.json 落 reportGeneratedAt 标记
    const marker = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fde', 'companion.json'), 'utf-8'));
    expect(typeof marker.reportGeneratedAt).toBe('string');
    expect(marker.deployedAt).toBe(deployedAt);
  });

  it('test_generateCompanionReport_幂等_已生成标记跳过', () => {
    const deployedAt = new Date(Date.now() - 20 * 86_400_000).toISOString();
    fs.mkdirSync(path.join(tmpDir, 'fde'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'fde', 'companion.json'),
      JSON.stringify({ deployedAt, reportGeneratedAt: '2026-01-01T00:00:00.000Z' }),
      'utf-8',
    );

    const result = generateCompanionReport(tmpDir);

    expect(result.generated).toBe(false);
    // 无数据时报告正文也会写「数据缺失」——幂等路径不落盘
    expect(fs.existsSync(companionReportPath(tmpDir))).toBe(false);
  });

  it('test_runCompanionDaily_期满首检自动生成报告', async () => {
    // 部署 15 天前（≥ 14 天 → inactive，但 deployedAt 已知）
    fs.mkdirSync(path.join(tmpDir, 'fde'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'fde', 'companion.json'),
      JSON.stringify({ deployedAt: new Date(Date.now() - 15 * 86_400_000).toISOString() }),
      'utf-8',
    );

    const result = await runCompanionDaily({ dataDir: tmpDir });

    expect(result.ran).toBe(false);
    expect(result.reportPath).toBeDefined();
    expect(fs.existsSync(companionReportPath(tmpDir))).toBe(true);
    expect(result.reason).toContain('期满总结报告已生成');
  });

  it('test_runCompanionDaily_部署时间未知_不生成报告', async () => {
    // 无 companion.json / sessions/current.json → deployedAt null
    const result = await runCompanionDaily({ dataDir: tmpDir });

    expect(result.ran).toBe(false);
    expect(result.reportPath).toBeUndefined();
    expect(fs.existsSync(companionReportPath(tmpDir))).toBe(false);
    expect(result.reason).toContain('部署时间未知');
  });

  it('test_generateCompanionReport_数据缺失_报告仍生成并标注', () => {
    // 部署期满但 think.md / decision-log 均不存在
    fs.mkdirSync(path.join(tmpDir, 'fde'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'fde', 'companion.json'),
      JSON.stringify({ deployedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() }),
      'utf-8',
    );

    const result = generateCompanionReport(tmpDir);

    expect(result.generated).toBe(true);
    const report = fs.readFileSync(companionReportPath(tmpDir), 'utf-8');
    expect(report).toContain('数据缺失');
    expect(report).toContain('无介入决策记录');
  });

  it('test_generateCompanionReport_sessionsCurrent推断deployedAt_保底写入marker', () => {
    // 无 companion.json，但 sessions/current.json 有 startedAt（fallback 链路）
    // ——报告生成时把推断的 deployedAt 保底写入 marker（存量部署闭环）
    const startedAt = new Date(Date.now() - 20 * 86_400_000).toISOString();
    fs.mkdirSync(path.join(tmpDir, 'fde', 'sessions'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'fde', 'sessions', 'current.json'),
      JSON.stringify({ startedAt }),
      'utf-8',
    );

    const result = generateCompanionReport(tmpDir);

    expect(result.generated).toBe(true);
    const marker = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fde', 'companion.json'), 'utf-8'));
    expect(marker.deployedAt).toBe(startedAt);
    expect(typeof marker.reportGeneratedAt).toBe('string');
  });
});
