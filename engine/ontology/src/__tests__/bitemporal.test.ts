// ============================================================
// bitemporal.test.ts · 双时态时点快照 + 渐进加载三层测试
// v1.5.0 第二章交付
//
// 覆盖验收：
//   1. isValidAt 判定谓词（永久有效 / 有界 / 未生效 / 已失效）
//   2. stateAt 时点快照（含实体集过滤 + 旧数据无字段兼容）
//   3. progressiveLoad 三层（L3 全文 / 超预算降层留痕 / L1 摘要）
//   4. mergeOntology 输出携带 validFrom/validTo（objects.yml 联动）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { stateAt, isValidAt, progressiveLoad, defaultBudget } from '../query';
import { mergeOntology } from '../merge-engine';

// 布局对齐 mergeOntology 契约：configDir 的同级是 knowledge/
// （mergeOntology(configDir) 读 dirname(configDir)/knowledge/entities）
let rootDir: string;
let knowledgeDir: string;
let entitiesDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'sofagent-bitemporal-'));
  knowledgeDir = join(rootDir, 'knowledge');
  entitiesDir = join(knowledgeDir, 'entities');
  mkdirSync(entitiesDir, { recursive: true });
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

function writeEntity(name: string, fm: Record<string, unknown>): void {
  // 标量一律加引号（对齐生产面 renderKnowledgeMd 的 yamlDump 行为——
  // 裸 ISO 时间串在部分 js-yaml 版本会被解析为 Date 对象，双时态判定需字符串）
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(String(v))}`);
  writeFileSync(join(entitiesDir, `${name}.md`), `---\n${lines.join('\n')}\n---\n\n正文 ${name}\n`);
}

describe('isValidAt 判定谓词', () => {
  it('无字段 = 永久有效（旧数据兼容）', () => {
    expect(isValidAt({}, '2026-01-01')).toBe(true);
  });
  it('validFrom 未到 = 无效', () => {
    expect(isValidAt({ validFrom: '2026-06-01T00:00:00Z' }, '2026-01-01T00:00:00Z')).toBe(false);
  });
  it('validFrom 已过 = 有效', () => {
    expect(isValidAt({ validFrom: '2026-01-01T00:00:00Z' }, '2026-06-01T00:00:00Z')).toBe(true);
  });
  it('validTo 已过 = 失效（半开区间）', () => {
    expect(isValidAt({ validTo: '2026-01-01T00:00:00Z' }, '2026-06-01T00:00:00Z')).toBe(false);
    expect(isValidAt({ validTo: '2026-06-01T00:00:00Z' }, '2026-06-01T00:00:00Z')).toBe(false);
  });
  it('区间内 = 有效（validFrom ≤ t < validTo）', () => {
    expect(isValidAt({ validFrom: '2026-01-01T00:00:00Z', validTo: '2026-12-01T00:00:00Z' }, '2026-06-01T00:00:00Z')).toBe(true);
  });
});

describe('stateAt 时点快照', () => {
  it('返回该时点有效实体集', () => {
    writeEntity('always', { type: 'entity' });
    writeEntity('expired', { type: 'entity', validFrom: '2026-01-01T00:00:00Z', validTo: '2026-03-01T00:00:00Z' });
    writeEntity('future', { type: 'entity', validFrom: '2027-01-01T00:00:00Z' });
    const snap = stateAt(knowledgeDir, '2026-06-01T00:00:00Z');
    const names = snap.map((e) => e.name);
    expect(names).toContain('always');  // 无字段 = 永久有效
    expect(names).not.toContain('expired'); // validTo 已过 = 失效
    expect(names).not.toContain('future'); // validFrom 未到 = 未生效
  });
  it('无 entities 目录返回空数组', () => {
    expect(stateAt(join(knowledgeDir, 'nope'), '2026-01-01')).toEqual([]);
  });
});

describe('progressiveLoad 渐进加载三层', () => {
  it('预算充足 → L3 全文加载', () => {
    writeEntity('small', { type: 'entity', description: '小实体' });
    const r = progressiveLoad(knowledgeDir, ['small'], defaultBudget(10_000));
    expect(r.tier).toBe(3);
    expect(r.fullTexts).toHaveLength(1);
    expect(r.downgrades).toHaveLength(0);
  });
  it('超预算 → 降层并留痕（L3→L2→L1）', () => {
    writeEntity('big', { type: 'entity', description: '大实体' });
    // 极小预算：L3 必超 → 降 L2；L2 关系文本若仍超 → 降 L1
    const r = progressiveLoad(knowledgeDir, ['big'], defaultBudget(1));
    expect(r.tier).toBeLessThan(3);
    expect(r.downgrades.length).toBeGreaterThan(0);
    expect(r.downgrades[0]!.reason).toBe('budget-exceeded');
    // 摘要层始终保底（L1 卡片级信息不丢）
    expect(r.digests).toHaveLength(1);
  });
  it('三层内容同源（摘要取自同一 frontmatter）', () => {
    writeEntity('same', { type: 'agent', description: '同一来源' });
    const r = progressiveLoad(knowledgeDir, ['same']);
    expect(r.digests[0]!.type).toBe('agent');
    expect(r.digests[0]!.summary).toBe('同一来源');
  });
});

describe('mergeOntology 双时态联动', () => {
  it('objects.yml 携带 validFrom/validTo', () => {
    writeEntity('timed', { type: 'entity', validFrom: '2026-01-01T00:00:00Z', validTo: '2026-12-31T00:00:00Z' });
    // 布局契约：mergeOntology 读 dirname(configDir)/knowledge——configDir 放 root 下
    const configDir = join(rootDir, '.sofagent');
    mkdirSync(configDir, { recursive: true });
    const merged = mergeOntology(configDir);
    const timed = merged.objects.find((o) => o.name === 'timed');
    expect(timed?.validFrom).toBe('2026-01-01T00:00:00Z');
    expect(timed?.validTo).toBe('2026-12-31T00:00:00Z');
    // 落盘的 objects.yml 同步携带（读侧消费面）——ontology/ 输出在 root 下
    const yml = readFileSync(join(rootDir, 'ontology', 'objects.yml'), 'utf-8');
    expect(yml).toContain('validFrom');
  });
});
