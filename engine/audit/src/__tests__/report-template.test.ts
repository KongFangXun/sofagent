// ============================================================
// report-template.test.ts · 审计报告 Markdown 模板单测
// v1.2.2 P0 — 覆盖 renderReport 6-section 渲染
// ============================================================

import { describe, it, expect } from 'vitest';
import { renderReport, type ReportStats, type ReportKindLabel } from '../report-template';
import type { DataSovereigntyRecord } from '../data-sovereignty';

// ── 测试工具 ──

/** 构造一条合法记录 */
function makeRecord(
  overrides: Partial<DataSovereigntyRecord> = {},
): DataSovereigntyRecord {
  return {
    cloudCall: {
      timestamp: '2026-07-28T10:00:00.000Z',
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com',
      tokenCount: { input: 100, output: 50 },
      purpose: 'code-gen',
    },
    localAction: {
      type: 'model-inference',
      target: 'gpt-4o',
      description: '生成代码',
      auditResult: 'PASS',
    },
    dataFlow: {
      direction: 'outbound',
      sensitivity: 'internal',
      fields: ['code'],
      destination: 'cloud-api',
      redacted: false,
    },
    taskContext: {
      taskId: 't1',
      userIntent: '写函数',
      agentRole: 'engineer',
    },
    ...overrides,
  } as DataSovereigntyRecord;
}

/** 构造一组测试用的统计数据 */
function makeStats(overrides: Partial<ReportStats> = {}): ReportStats {
  return {
    total: 1,
    cloudCallCount: 1,
    localActionCount: 0,
    outboundCount: 1,
    inboundCount: 0,
    localOnlyCount: 0,
    sensitiveLocalRate: 1,
    anomalyCount: 0,
    routeDist: { cloudStrong: 1, cloudFast: 0, local7b: 0, local05b: 0 },
    records: [makeRecord()],
    ...overrides,
  };
}

// ============================================================
// renderReport · 基础结构
// ============================================================

describe('renderReport · 报告结构', () => {
  it('标题包含报告类型（daily → 每日）', () => {
    // 测试：daily 报告标题含「每日」
    const md = renderReport('daily', '2026-07-28', makeStats());
    expect(md).toContain('# 数据主权审计报告（每日）');
  });

  it('标题包含报告类型（weekly → 每周）', () => {
    // 测试：weekly 报告标题含「每周」
    const md = renderReport('weekly', '2026-W30', makeStats());
    expect(md).toContain('# 数据主权审计报告（每周）');
  });

  it('标题包含报告类型（monthly → 每月）', () => {
    // 测试：monthly 报告标题含「每月」
    const md = renderReport('monthly', '2026-07', makeStats());
    expect(md).toContain('# 数据主权审计报告（每月）');
  });

  it('元信息块包含报告周期 label 和记录总数', () => {
    // 测试：报告头部 metadata 含 label 与 total
    const md = renderReport('daily', '2026-07-28', makeStats({ total: 42 }));
    expect(md).toContain('报告周期：2026-07-28');
    expect(md).toContain('记录总数：42 条');
  });

  it('包含全部 6 个 section 标题', () => {
    // 测试：6-section 完整性——概要/云端调用/本地执行/数据流向/模型路由/异常告警
    const md = renderReport('daily', '2026-07-28', makeStats());
    expect(md).toContain('## 1. 概要');
    expect(md).toContain('## 2. 云端调用明细');
    expect(md).toContain('## 3. 本地执行明细');
    expect(md).toContain('## 4. 数据流向分析');
    expect(md).toContain('## 5. 模型路由分布');
    expect(md).toContain('## 6. 异常告警');
  });

  it('报告末尾包含生成引擎签名', () => {
    // 测试：底部含版本签名行
    const md = renderReport('daily', '2026-07-28', makeStats());
    expect(md).toContain('sofagent 数据主权审计引擎');
  });
});

// ============================================================
// Section 1 · 概要
// ============================================================

describe('renderReport · Section 1 概要', () => {
  it('概要表格包含 5 个核心指标', () => {
    // 测试：cloudCallCount / localActionCount / outboundCount / sensitiveLocalRate / anomalyCount
    const md = renderReport('daily', '2026-07-28', makeStats({
      cloudCallCount: 10,
      localActionCount: 5,
      outboundCount: 3,
      sensitiveLocalRate: 0.875,
      anomalyCount: 2,
    }));
    expect(md).toContain('云端调用总数');
    expect(md).toContain('| 10 |');
    expect(md).toContain('本地执行总数');
    expect(md).toContain('| 5 |');
    expect(md).toContain('数据流出次数');
    expect(md).toContain('| 3 |');
    expect(md).toContain('敏感数据本地处理率');
    expect(md).toContain('87.5%');
    expect(md).toContain('审计异常数');
    expect(md).toContain('| 2 |');
  });

  it('敏感数据本地处理率 100% 显示为 100.0%', () => {
    // 测试：sensitiveLocalRate = 1 → "100.0%"
    const md = renderReport('daily', '2026-07-28', makeStats({ sensitiveLocalRate: 1 }));
    expect(md).toContain('100.0%');
  });
});

// ============================================================
// Section 2 · 云端调用明细
// ============================================================

describe('renderReport · Section 2 云端调用明细', () => {
  it('有云端调用记录时渲染明细表', () => {
    // 测试：destination=cloud-api 的记录出现在表中
    const record = makeRecord({
      cloudCall: { timestamp: '2026-07-28T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 200, output: 100 }, purpose: 'reasoning' },
      dataFlow: { direction: 'outbound', sensitivity: 'internal', fields: ['x'], destination: 'cloud-api', redacted: true },
    });
    const md = renderReport('daily', '2026-07-28', makeStats({ records: [record] }));
    expect(md).toContain('gpt-4o');
    expect(md).toContain('reasoning');
    expect(md).toContain('200/100');
    expect(md).toContain('是'); // redacted = 是
  });

  it('无云端调用时显示「本周期无云端调用」', () => {
    // 测试：没有 cloud-api 记录时的空态文案
    const record = makeRecord({
      dataFlow: { direction: 'local-only', sensitivity: 'public', fields: ['x'], destination: 'local-file', redacted: false },
    });
    const md = renderReport('daily', '2026-07-28', makeStats({ records: [record], cloudCallCount: 0 }));
    expect(md).toContain('本周期无云端调用');
  });
});

// ============================================================
// Section 3 · 本地执行明细
// ============================================================

describe('renderReport · Section 3 本地执行明细', () => {
  it('有本地执行记录时渲染明细表', () => {
    // 测试：destination != cloud-api 的记录出现在本地执行表
    const record = makeRecord({
      cloudCall: { timestamp: '2026-07-28T10:00:00.000Z', provider: 'local', model: 'qwen2.5-7b', endpoint: 'x', tokenCount: { input: 0, output: 0 }, purpose: 'infer' },
      localAction: { type: 'file-write', target: 'src/app.ts', description: '写入文件', auditResult: 'WARN' },
      dataFlow: { direction: 'local-only', sensitivity: 'internal', fields: ['x'], destination: 'local-file', redacted: false },
    });
    const md = renderReport('daily', '2026-07-28', makeStats({ records: [record] }));
    expect(md).toContain('file-write');
    expect(md).toContain('src/app.ts');
    expect(md).toContain('WARN');
  });

  it('无本地执行记录时显示空态文案', () => {
    // 测试：全部 cloud-api 时本地执行 section 空态
    const record = makeRecord({
      dataFlow: { direction: 'outbound', sensitivity: 'internal', fields: ['x'], destination: 'cloud-api', redacted: false },
    });
    const md = renderReport('daily', '2026-07-28', makeStats({ records: [record] }));
    expect(md).toContain('本周期无本地执行记录');
  });
});

// ============================================================
// Section 4 · 数据流向分析
// ============================================================

describe('renderReport · Section 4 数据流向', () => {
  it('渲染出站/本地/入站条数', () => {
    // 测试：outboundCount / localOnlyCount / inboundCount 显示在表中
    const md = renderReport('daily', '2026-07-28', makeStats({
      outboundCount: 5,
      localOnlyCount: 3,
      inboundCount: 2,
    }));
    expect(md).toContain('出站（outbound）');
    expect(md).toContain('| 5 |');
    expect(md).toContain('本地（local-only）');
    expect(md).toContain('| 3 |');
    expect(md).toContain('入站（inbound）');
    expect(md).toContain('| 2 |');
  });

  it('有数据流出时显示 ⚠️ 警告', () => {
    // 测试：outboundCount > 0 时出现警告文案
    const md = renderReport('daily', '2026-07-28', makeStats({ outboundCount: 1 }));
    expect(md).toContain('⚠️');
    expect(md).toContain('数据流出');
  });

  it('无数据流出时不显示 ⚠️', () => {
    // 测试：outboundCount = 0 不出现警告
    const md = renderReport('daily', '2026-07-28', makeStats({ outboundCount: 0 }));
    expect(md).not.toContain('⚠️');
  });
});

// ============================================================
// Section 5 · 模型路由分布
// ============================================================

describe('renderReport · Section 5 模型路由', () => {
  it('渲染 4 个路由桶的条数', () => {
    // 测试：cloudStrong / cloudFast / local7b / local05b 均显示
    const md = renderReport('daily', '2026-07-28', makeStats({
      routeDist: { cloudStrong: 3, cloudFast: 2, local7b: 1, local05b: 0 },
    }));
    expect(md).toContain('云端 32B+');
    expect(md).toContain('| 3 |');
    expect(md).toContain('云端快速');
    expect(md).toContain('| 2 |');
    expect(md).toContain('本地 7B');
    expect(md).toContain('| 1 |');
    expect(md).toContain('本地 0.5B');
    expect(md).toContain('| 0 |');
  });
});

// ============================================================
// Section 6 · 异常告警
// ============================================================

describe('renderReport · Section 6 异常告警', () => {
  it('无异常时显示 ✅', () => {
    // 测试：anomalyCount = 0 显示 OK 文案
    const md = renderReport('daily', '2026-07-28', makeStats({
      anomalyCount: 0,
      records: [makeRecord({
        localAction: { type: 'model-inference', target: 'gpt-4o', description: 'x', auditResult: 'PASS' },
        dataFlow: { direction: 'outbound', sensitivity: 'public', fields: ['x'], destination: 'cloud-api', redacted: false },
      })],
    }));
    expect(md).toContain('✅ 本周期无异常');
  });

  it('有 FAIL 审计结果时在异常列表中显示', () => {
    // 测试：auditResult=FAIL 的记录出现在异常告警
    const record = makeRecord({
      localAction: { type: 'file-write', target: 'sensitive.cfg', description: 'x', auditResult: 'FAIL' },
      dataFlow: { direction: 'outbound', sensitivity: 'public', fields: ['x'], destination: 'cloud-api', redacted: false },
    });
    const md = renderReport('daily', '2026-07-28', makeStats({ records: [record], anomalyCount: 1 }));
    expect(md).toContain('sensitive.cfg');
    expect(md).toContain('审计 FAIL');
  });

  it('restricted 数据流向 cloud-api 触发异常', () => {
    // 测试：敏感数据 + 云端 = 异常
    const record = makeRecord({
      localAction: { type: 'model-inference', target: 'gpt-4o', description: 'x', auditResult: 'PASS' },
      dataFlow: { direction: 'outbound', sensitivity: 'restricted', fields: ['x'], destination: 'cloud-api', redacted: false },
    });
    const md = renderReport('daily', '2026-07-28', makeStats({ records: [record], anomalyCount: 1 }));
    expect(md).toContain('restricted');
    expect(md).toContain('数据流向云端');
  });
});
