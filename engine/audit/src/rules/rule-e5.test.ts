// ============================================================
// rule-e5.test.ts · E5 数据产物审计测试（v1.5.7 章一）
// 覆盖：数值勾稽（一致/不一致/容差）+ 来源可溯 + 口径一致 + 边界（非数据文件/
// 删除行/无合计声明/多文件独立判定）
// ============================================================

import { describe, it, expect } from 'vitest';
import { scanE5 } from './rule-e5-data-product';
import type { AuditContext } from './types';
import type { DiffFile } from '@sofagent/core';

function ctx(files: Array<{ path: string; lines: string[]; status?: DiffFile['status'] }>): AuditContext {
  return {
    diffFiles: files.map((f) => ({
      path: f.path,
      status: f.status ?? 'added',
      lines: f.lines,
    })),
    logEntries: [],
  };
}

describe('E5 数据产物审计 · 判据① 数值勾稽（合计/明细一致）', () => {
  it('合计 = 明细之和 → PASS', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          lines: [
            '+region,amount,source',
            '+north,100,source: raw/q3.csv',
            '+south,200,source: raw/q3.csv',
            '+合计,300,source: derived',
          ],
        },
      ]),
    );
    // 勾稽一致，但明细行均带 source → 全 PASS
    expect(res.status).toBe('PASS');
    expect(res.details).toEqual([]);
  });

  it('合计 ≠ 明细之和 → FAIL（勾稽缺口入 details）', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          lines: [
            '+region,amount,source',
            '+north,100,source: raw/q3.csv',
            '+south,200,source: raw/q3.csv',
            '+合计,999,source: derived',
          ],
        },
      ]),
    );
    expect(res.status).toBe('FAIL');
    expect(res.details[0]).toContain('数值勾稽不一致');
    expect(res.details[0]).toContain('999');
    expect(res.details[0]).toContain('300');
  });

  it('JSON 形态（"key": value）同样勾稽 → FAIL', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/summary.json',
          lines: [
            '+{',
            '+  "items": [',
            '+    { "amount": 10.5, "source": "db.orders" },',
            '+    { "amount": 20.25, "source": "db.orders" }',
            '+  ],',
            '+  "total": 100',
            '+}',
          ],
        },
      ]),
    );
    expect(res.status).toBe('FAIL');
    expect(res.details[0]).toContain('勾稽不一致');
  });

  it('浮点容差内（≤0.5%）不判 FAIL', () => {
    // 明细和 = 200.9，合计声明 201——差 0.1（0.05% < 0.5% 容差）
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          lines: [
            '+a,b',
            '+amount,100.5,source: x',
            '+amount,100.4,source: x',
            '+total,201,source: derived',
          ],
        },
      ]),
    );
    expect(res.status).toBe('PASS');
  });

  it('只有合计声明、无比对明细 → 不判 FAIL（证据不足不硬判）', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          lines: ['+total,500,source: derived'],
        },
      ]),
    );
    expect(res.status).toBe('PASS');
  });

  it('删除行（-开头）不参与勾稽', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          lines: ['-north,100,source: x', '-合计,999,source: d'],
        },
      ]),
    );
    expect(res.status).toBe('PASS');
  });
});

describe('E5 数据产物审计 · 判据② 来源可溯', () => {
  it('数值行无 source/来源 引用 → WARN', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          lines: ['+region,amount', '+north,100'],
        },
      ]),
    );
    expect(res.status).toBe('WARN');
    expect(res.details[0]).toContain('缺来源引用');
  });

  it('「来源:」中文键同样识别为可溯源 → 不告警', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          lines: ['+region,amount,来源', '+north,100,来源: raw.csv'],
        },
      ]),
    );
    expect(res.status).toBe('PASS');
  });

  it('勾稽 FAIL 与溯源 WARN 并存时取最严 FAIL', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          lines: ['+amount,100', '+total,999'],
        },
      ]),
    );
    expect(res.status).toBe('FAIL');
    expect(res.details.some((d) => d.includes('勾稽不一致'))).toBe(true);
    expect(res.details.some((d) => d.includes('缺来源引用'))).toBe(true);
  });

  it('无数值的元数据行不触发溯源告警', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/meta.json',
          lines: ['+{ "title": "Q3 报告", "author": "fde" }'],
        },
      ]),
    );
    expect(res.status).toBe('PASS');
  });
});

describe('E5 数据产物审计 · 判据③ 口径一致', () => {
  it('同字段两个 unit 标注 → FAIL（口径冲突）', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.json',
          lines: [
            '+{ "rows": [',
            '+  { "amount": 1, "amount.unit": "CNY", "source": "x" },',
            '+  { "amount": 2, "amount_unit": "USD", "source": "y" }',
            '+] }',
          ],
        },
      ]),
    );
    expect(res.status).toBe('FAIL');
    expect(res.details[0]).toContain('口径冲突');
    expect(res.details[0]).toContain('CNY');
    expect(res.details[0]).toContain('USD');
  });

  it('unit 大小写归一后一致 → 不判冲突', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.json',
          lines: [
            '+{ "amount": 1, "amount.unit": "CNY", "source": "x" },',
            '+{ "amount": 2, "amount.unit": "cny", "source": "y" }',
          ],
        },
      ]),
    );
    expect(res.status).toBe('PASS');
  });

  it('unit(amount): XXX 括号形态同样提取', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.jsonl',
          lines: [
            '+{ "amount": 1, "unit(amount)": "kg", "source": "x" }',
            '+{ "amount": 2, "amount.unit": "g", "source": "y" }',
          ],
        },
      ]),
    );
    expect(res.status).toBe('FAIL');
    expect(res.details[0]).toContain('口径冲突');
  });
});

describe('E5 数据产物审计 · 边界', () => {
  it('非数据产物文件（.ts/.md）不进判定面', () => {
    const res = scanE5(
      ctx([
        {
          path: 'src/index.ts',
          lines: ['+const total = 999;', '+const amount = 100;'],
        },
      ]),
    );
    expect(res.status).toBe('PASS');
  });

  it('diffFiles 为空 → PASS', () => {
    expect(scanE5(ctx([]))).toEqual({ status: 'PASS', details: [] });
  });

  it('多文件独立判定（A 文件勾稽 FAIL + B 文件干净）', () => {
    const res = scanE5(
      ctx([
        {
          path: 'a/bad.csv',
          lines: ['+amount,100,source: x', '+total,500'],
        },
        {
          path: 'b/good.csv',
          lines: ['+amount,100,source: x', '+total,100'],
        },
      ]),
    );
    expect(res.status).toBe('FAIL');
    expect(res.details.length).toBe(1);
    expect(res.details[0]).toContain('a/bad.csv');
  });

  it('modified 状态的数据文件新增行同样判定', () => {
    const res = scanE5(
      ctx([
        {
          path: 'data/report.csv',
          status: 'modified',
          lines: ['-old,50,source: o', '+new,70'],
        },
      ]),
    );
    expect(res.status).toBe('WARN'); // 新增行 70 无来源引用
  });
});
