// ============================================================
// decision-log-source.test.ts · 决策日志输入源单测（v1.5.7 章八）
// ============================================================
// 验收锚四条：
//   ① 类型映射完备——DECISION_KIND_CONSUMPTION 键集 ≡ DecisionKind 18 值
//      （表驱动自检：新增 kind 未登记 ⇒ 本用例红）；
//   ② 只读不改 schema——读侧对落盘文件零写入（mtime/内容前后一致）+
//      DecisionLogEntry 类型与写侧共用单一类型源（无副本）；
//   ③ 可判命题正负样例——E7 决策质量信号（match/notMatch 对齐 v1.5.3 自测 schema）；
//   ④ 容错口径——文件缺席 = 空数组；坏行跳过 + 告警可见。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readDecisionEntries,
  resolveDecisionLogSourcePath,
  loadDecisionEntries,
  filterByKind,
  DECISION_KIND_CONSUMPTION,
  DECISION_LOG_FILENAME,
} from '../inputs/decision-log-source';
import { scanE7, E7_DEGRADE_WARN_THRESHOLD } from '../rules/rule-e7-decision-quality-signal';
import type { DecisionLogEntry, DecisionKind } from '../decision-schema';

// ── DecisionKind 18 值全集（与 decision-schema.ts union 双源对账用——独立抄写以互证） ──
const ALL_18_KINDS: readonly DecisionKind[] = [
  'SPEC_CHANGE', 'ARTIFACT_EDIT', 'TOOL_GATE', 'RULE_TOGGLE',
  'ESCALATE_REPORT', 'FALLBACK_DEGRADE', 'CONFIG_CHANGE',
  'KNOWLEDGE_DISTILL', 'ORCHESTRATION',
  'EVOLUTION', 'TEAM', 'COMMONS',
  'COST', 'COVERAGE', 'INVALIDATION', 'CREDENTIAL_RECONCILE',
  'LEGACY_CLEANUP', 'DATA_PRODUCT',
];

/** 造一条最小合法 decision-log 行（写侧形态的字段子集——只读侧不要求链字段） */
function makeEntry(kind: DecisionKind, overrides: Partial<DecisionLogEntry> = {}): DecisionLogEntry {
  return {
    ts: new Date().toISOString(),
    agentId: 'test-agent',
    sessionId: 'test-session',
    kind,
    moment: 'ACT',
    why: { text: '测试决策' },
    ...(Object.keys(overrides).length > 0 ? overrides : {}),
  } as DecisionLogEntry;
}

describe('decision-log-source · 类型映射完备（验收锚 ①）', () => {
  it('DECISION_KIND_CONSUMPTION 键集 ≡ DecisionKind 18 值全集（新增 kind 未登记即红）', () => {
    const tableKeys = Object.keys(DECISION_KIND_CONSUMPTION).sort();
    const kindSet = [...ALL_18_KINDS].sort();
    expect(tableKeys).toEqual(kindSet);
    expect(tableKeys.length).toBe(18);
  });

  it('每条声明带非空理由（消费 / 不消费都必须说为什么——无静默挂空）', () => {
    for (const [kind, decl] of Object.entries(DECISION_KIND_CONSUMPTION)) {
      expect(decl.reason.length, `${kind} 的 reason 须非空`).toBeGreaterThan(4);
      expect(Array.isArray(decl.consumedBy), `${kind} 的 consumedBy 须为数组（空数组 = 显式登记不消费）`).toBe(true);
    }
  });

  it('FALLBACK_DEGRADE 声明消费方 E7（章八可判命题的登记面）', () => {
    expect(DECISION_KIND_CONSUMPTION['FALLBACK_DEGRADE'].consumedBy).toContain('E7');
  });
});

describe('decision-log-source · 只读不改 schema（验收锚 ②）', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'decision-source-test-'));
    logPath = join(dir, 'audit', DECISION_LOG_FILENAME);
    const { mkdirSync } = require('fs') as typeof import('fs');
    mkdirSync(join(dir, 'audit'), { recursive: true });
    writeFileSync(logPath, JSON.stringify(makeEntry('TOOL_GATE')) + '\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('读取前后文件字节与 mtime 零变化（只读实证）', () => {
    const before = readFileSync(logPath, 'utf-8');
    const beforeStat = statSync(logPath);
    const entries = readDecisionEntries(logPath);
    expect(entries.length).toBe(1);
    expect(readFileSync(logPath, 'utf-8')).toBe(before);
    expect(statSync(logPath).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it('resolveDecisionLogSourcePath 与写侧同源（getDecisionLogPath 的 dataDir 口径）', () => {
    expect(resolveDecisionLogSourcePath(dir)).toBe(join(dir, 'audit', DECISION_LOG_FILENAME));
  });

  it('loadDecisionEntries 缺席文件 = 空数组（无决策可判不是错误）', () => {
    expect(loadDecisionEntries(join(dir, 'no-such-dir'))).toEqual([]);
  });
});

describe('decision-log-source · 容错与过滤', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'decision-source-test-'));
    const { mkdirSync } = require('fs') as typeof import('fs');
    mkdirSync(join(dir, 'audit'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('坏行跳过不阻断 + 合法行照收（混合文件）', () => {
    const logPath = join(dir, 'audit', DECISION_LOG_FILENAME);
    const lines = [
      JSON.stringify(makeEntry('FALLBACK_DEGRADE')),
      '{broken json',
      JSON.stringify(makeEntry('COST')),
      '', // 空行
      JSON.stringify({ ts: 'x', agentId: 'y', sessionId: 'z', kind: 'NOT_A_KIND', moment: 'ACT', why: { text: '' } }), // 非法 kind
    ];
    writeFileSync(logPath, lines.join('\n') + '\n');
    const entries = readDecisionEntries(logPath);
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.kind).sort()).toEqual(['COST', 'FALLBACK_DEGRADE']);
  });

  it('filterByKind 按 kind 过滤（E7 的消费面 helper）', () => {
    const entries = [
      makeEntry('FALLBACK_DEGRADE'),
      makeEntry('FALLBACK_DEGRADE'),
      makeEntry('TOOL_GATE'),
    ];
    expect(filterByKind(entries, 'FALLBACK_DEGRADE').length).toBe(2);
    expect(filterByKind(entries, 'TOOL_GATE').length).toBe(1);
    expect(filterByKind(entries, 'COST').length).toBe(0);
  });
});

describe('E7 决策质量信号 · 可判命题正负样例（验收锚 ③，对齐 v1.5.3 自测 schema）', () => {
  it('match：FALLBACK_DEGRADE 达阈值（5 条）⇒ WARN 且 details 含计数与信号语义', () => {
    const entries = Array.from({ length: E7_DEGRADE_WARN_THRESHOLD }, (_, i) =>
      makeEntry('FALLBACK_DEGRADE', { why: { text: `LLM 不可用降级 #${i + 1}` } }),
    );
    const result = scanE7({ diffFiles: [], logEntries: [], decisionEntries: entries });
    expect(result.status).toBe('WARN');
    expect(result.details[0]).toContain(`${E7_DEGRADE_WARN_THRESHOLD} 次 FALLBACK_DEGRADE`);
    expect(result.details[0]).toContain('决策质量劣化信号');
  });

  it('match：超阈值（6 条）⇒ WARN（高频更劣化）', () => {
    const entries = Array.from({ length: 6 }, () => makeEntry('FALLBACK_DEGRADE'));
    expect(scanE7({ diffFiles: [], logEntries: [], decisionEntries: entries }).status).toBe('WARN');
  });

  it('notMatch：低于阈值（2 条）⇒ PASS（正常偶发降级不告警）', () => {
    const entries = [makeEntry('FALLBACK_DEGRADE'), makeEntry('FALLBACK_DEGRADE')];
    const result = scanE7({ diffFiles: [], logEntries: [], decisionEntries: entries });
    expect(result.status).toBe('PASS');
    expect(result.details[0]).toContain('2 次');
  });

  it('notMatch：零降级 ⇒ PASS', () => {
    const entries = [makeEntry('TOOL_GATE'), makeEntry('COST')];
    expect(scanE7({ diffFiles: [], logEntries: [], decisionEntries: entries }).status).toBe('PASS');
  });

  it('notMatch：其他 kind 再多也不误报（判定面只看 FALLBACK_DEGRADE）', () => {
    const entries = Array.from({ length: 50 }, () => makeEntry('TOOL_GATE'));
    expect(scanE7({ diffFiles: [], logEntries: [], decisionEntries: entries }).status).toBe('PASS');
  });

  it('通道 opt-in：decisionEntries 未装配 ⇒ SKIPPED（不猜测不误报）', () => {
    const result = scanE7({ diffFiles: [], logEntries: [] });
    expect(result.status).toBe('SKIPPED');
    expect(result.details[0]).toContain('未装配');
  });

  it('空数组（文件缺席）⇒ PASS 零降级（缺席 ≠ 劣化）', () => {
    expect(scanE7({ diffFiles: [], logEntries: [], decisionEntries: [] }).status).toBe('PASS');
  });
});
