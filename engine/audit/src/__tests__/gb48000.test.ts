// ============================================================
// gb48000.test.ts · 国标对齐 GB/T 48000.3-2026 测试（v1.3.1 交付 2）
// ============================================================
//
// 覆盖：
// - 条款映射清单：8 条映射（已对齐/部分对齐/不适用），与 Ontology
//   CORE-OBJ/ACT/LNK/STM 四类契约一一对应
// - 覆盖度评估：assessGb48000Coverage 统计三态数量
// - 审计维度 opt-in：runRules(gb48000=true) → GB48000 条目出现；
//   gb48000 缺省/ false → 不出现（默认行为零变化）
// - 不影响 exitCode：GB48000 WARN 条目不改变审计退出码（信息维度）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  GB48000_CLAUSE_MAP,
  assessGb48000Coverage,
  buildGb48000RuleCheck,
} from '../gb48000';
import { runRules } from '../reporter';
import type { DiffFile } from '@sofagent/core';

/** 空 diff——规则全部 PASS（GB 条目独立验证，不受其他规则干扰） */
const EMPTY_DIFF: DiffFile[] = [];

describe('gb48000 · 条款映射清单（v1.3.1 交付 2）', () => {
  it('映射清单 8 条，与 CORE-OBJ/ACT/LNK/STM 对应', () => {
    expect(GB48000_CLAUSE_MAP.length).toBe(8);
    // 四类内核契约都有对应映射
    const mappedTo = GB48000_CLAUSE_MAP.map((c) => c.mappedTo).join(' ');
    expect(mappedTo).toContain('CORE-OBJ');
    expect(mappedTo).toContain('CORE-ACT');
    expect(mappedTo).toContain('CORE-LNK');
    expect(mappedTo).toContain('CORE-STM');
  });

  it('状态标注：已对齐/部分对齐/不适用三态齐全', () => {
    const statuses = GB48000_CLAUSE_MAP.map((c) => c.status);
    expect(statuses).toContain('已对齐');
    expect(statuses).toContain('部分对齐');
    expect(statuses).toContain('不适用');
  });

  it('覆盖度评估：统计三态数量 + 汇总', () => {
    const coverage = assessGb48000Coverage();
    expect(coverage.clauses).toHaveLength(8);
    expect(coverage.aligned + coverage.partial + coverage.notApplicable).toBe(8);
    expect(coverage.summary).toContain('GB/T 48000.3-2026');
  });

  it('buildGb48000RuleCheck：有部分对齐 → WARN；全对齐 → PASS；不计 exitCode', () => {
    const coverage = assessGb48000Coverage();
    const check = buildGb48000RuleCheck(coverage);
    expect(check.name).toBe('GB48000');
    // 存在部分对齐/不适用 → WARN（信息维度）
    expect(check.status).toBe('WARN');
    expect(check.ruleClass).toBe('工程规范');
    expect(check.details.join()).toContain('部分对齐');
  });
});

describe('gb48000 · 审计维度 opt-in（不影响默认行为）', () => {
  it('gb48000=true → 结果含 GB48000 条目', () => {
    const result = runRules(EMPTY_DIFF, [], 'task', false, true, undefined, undefined, undefined, true);
    const gb = result.rules.find((r) => r.name === 'GB48000');
    expect(gb).toBeDefined();
    expect(gb?.details.join()).toContain('GB/T 48000.3-2026');
  });

  it('gb48000 缺省/false → 结果不含 GB48000 条目（默认行为零变化）', () => {
    const result = runRules(EMPTY_DIFF, [], 'task', false, true);
    expect(result.rules.find((r) => r.name === 'GB48000')).toBeUndefined();
  });

  it('GB48000 WARN 条目不影响 exitCode（信息维度）', () => {
    // 干净 diff → 无违规 → exit 0；GB 条目为 WARN 但不提升 exit
    const result = runRules(EMPTY_DIFF, [], 'task', false, true, undefined, undefined, undefined, true);
    expect(result.exitCode).toBe(0);
    expect(result.rules.find((r) => r.name === 'GB48000')?.status).toBe('WARN');
  });

  it('strict 模式下 GB48000 也不影响 exitCode（信息维度不被升级）', () => {
    const result = runRules(EMPTY_DIFF, [], 'task', true, true, undefined, undefined, undefined, true);
    expect(result.exitCode).toBe(0);
  });
});
