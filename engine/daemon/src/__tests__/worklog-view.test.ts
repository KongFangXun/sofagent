// ============================================================
// worklog-view.test.ts · 终端 ASCII 视图测试（v1.3.9 三 · 可选交付）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { renderWorklogView } from '../dashboard/worklog-view';

describe('renderWorklogView · ASCII 列表视图', () => {
  let tmpDir: string;
  let jsonPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-wlview-'));
    jsonPath = path.join(tmpDir, 'worklog.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('文件不存在返回提示行（不崩）', () => {
    const out = renderWorklogView(path.join(tmpDir, 'nope.json'));
    expect(out).toContain('未找到');
  });

  it('损坏 JSON 返回解析失败提示', () => {
    fs.writeFileSync(jsonPath, '{broken');
    const out = renderWorklogView(jsonPath);
    expect(out).toContain('解析失败');
  });

  it('正常渲染四段：Agent / Workflow / 周趋势 / 进化趋势', () => {
    fs.writeFileSync(jsonPath, JSON.stringify({
      generatedAt: '2026-08-20T12:00:00Z',
      agents: [{
        agentId: 'audit',
        totals: { tasks: 2, llmCalls: 5, tokens: { input: 3000, output: 1300 }, modelCallMs: 3000, durationBasis: 'model-call-only', costUsd: 0.0005, humanInterventions: 1 },
        tasks: [
          { taskId: 'wf-12:node-a', modelCallMs: 3000, nodeTotalMs: 600000, humanInterventions: 1 },
          { taskId: 'wf-12:node-b', modelCallMs: 600, nodeTotalMs: null, humanInterventions: 0 },
        ],
      }],
      workflows: [{ workflowId: 'wf-12', humanInterventions: 1, nodes: [{ taskId: 'n-a', status: 'active' }] }],
      weeklyTrend: [
        { week: '2026-W33', activity: 2, auditPassRate: 0.5, costUsd: 0 },
        { week: '2026-W34', activity: 10, auditPassRate: 1, costUsd: 0.001 },
      ],
      evolution: { auditPassRate: { overall: 0.75 }, failureRecurrence: { rate: null }, firstPassRate: { rate: 0.67 } },
    }));
    const out = renderWorklogView(jsonPath);
    expect(out).toContain('AI 工作明细');
    expect(out).toContain('🔹 audit');
    expect(out).toContain('节点总 600000ms'); // 口径② 渲染
    expect(out).toContain('👤 介入 1');
    expect(out).toContain('🔸 wf-12');
    expect(out).toContain('2026-W34');
    expect(out).toContain('█'); // 柱状
    expect(out).toContain('审计 PASS 率   0.75');
  });

  it('空数据渲染占位提示', () => {
    fs.writeFileSync(jsonPath, JSON.stringify({
      generatedAt: '2026-08-20T12:00:00Z',
      agents: [], workflows: [], weeklyTrend: [],
      evolution: { auditPassRate: { overall: null }, failureRecurrence: { rate: null }, firstPassRate: { rate: null } },
    }));
    const out = renderWorklogView(jsonPath);
    expect(out).toContain('（暂无数据）');
  });
});
