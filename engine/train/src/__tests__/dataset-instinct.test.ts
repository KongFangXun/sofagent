// dataset-instinct.test.ts · 筛选阈值 / 血缘完整性 / 混合构建单测（v1.5.8 章三）
//
// ⚠️ 本测试同时覆盖 exporter（orchestrator 侧）与 instinct-source（train 侧）
// 两半——跨包闭环的行为锁放同文件（train 侧测试目录，import 走包名——红线：
// 跨包消费不得相对路径深引）。

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  exportInstinctRecords,
  buildLineageAnchor,
  appendToPool,
  readPool,
  filterByTenant,
  DEFAULT_CONFIDENCE_THRESHOLD,
  type StoredInstinct,
} from '@sofagent/orchestrator/instinct';
import {
  ingestInstinctSource,
  mergeForDatasetBuild,
  extractLineageAnchor,
  INSTINCT_SOURCE_COLUMNS,
} from '../instinct-source';
import { buildDataset } from '../dataset-builder';
import type { IngestRecord } from '../data-ingest';

function poolItem(over: Partial<StoredInstinct> = {}): StoredInstinct {
  return {
    id: over.id ?? 'inst-1',
    pattern: '提交前先跑 shellcheck',
    source: 'think',
    occurrences: 3,
    passCount: 3,
    failCount: 0,
    lastSeen: '2026-10-09T00:00:00Z',
    verified: 'verified',
    sourceTrace: 'sha256:abc123',
    enterpriseId: 'default',
    traceId: 'trace-1',
    ...over,
  };
}

describe('章三 · instinct 池持久化（store 前置件）', () => {
  it('append-only JSONL 落盘与读回一致；血缘 4 字段随行', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-instinct-pool-'));
    appendToPool(dir, [poolItem(), poolItem({ id: 'inst-2' })]);
    const { items, corruptedLines } = readPool(dir);
    expect(items).toHaveLength(2);
    expect(corruptedLines).toBe(0);
    expect(items[0].verified).toBe('verified');
    expect(items[0].sourceTrace).toBe('sha256:abc123');
    expect(items[0].enterpriseId).toBe('default');
    expect(items[0].traceId).toBe('trace-1');
    rmSync(dir, { recursive: true, force: true });
  });

  it('租户分区读：filterByTenant 只回本租户条目', () => {
    const pool = [poolItem(), poolItem({ id: 'x', enterpriseId: 'acme' })];
    expect(filterByTenant(pool, 'default')).toHaveLength(1);
    expect(filterByTenant(pool, 'acme')[0]?.id).toBe('x');
  });
});

describe('章三 · 导出器三道门', () => {
  it('高置信度 + 已考核 + verified-trace → 可导出（血缘字段齐全）', () => {
    const r = exportInstinctRecords([poolItem()]);
    expect(r.records).toHaveLength(1);
    const rec = r.records[0]!;
    expect(rec.instruction).toBe('提交前先跑 shellcheck');
    expect(rec.sourceTraceId).toBe('sha256:abc123');
    expect(rec.instinctId).toBe('inst-1');
    expect(rec.confidence).toBeGreaterThanOrEqual(DEFAULT_CONFIDENCE_THRESHOLD);
  });

  it('阈值与第四章同源（DEFAULT_CONFIDENCE_THRESHOLD = 0.7）', () => {
    // confidence = coverage × passRate；occurrences=3, pass=2/3 → ≈0.667 < 0.7 应拒
    const r = exportInstinctRecords([poolItem({ passCount: 2, failCount: 1 })]);
    expect(r.records).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('置信门');
  });

  it('真实性门：未标记来源 fail-closed 拒收（防自证污染）', () => {
    const r = exportInstinctRecords([poolItem({ sourceTrace: undefined })]);
    expect(r.records).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain('fail-closed');
  });

  it('考核门：未考核/失败条目拒收', () => {
    const r1 = exportInstinctRecords([poolItem({ verified: 'unexamined' })]);
    expect(r1.rejected[0]!.reason).toContain('考核门');
    const r2 = exportInstinctRecords([poolItem({ verified: 'failed' })]);
    expect(r2.records).toHaveLength(0);
  });

  it('租户门：跨企业导出默认禁止；显式开启留痕', () => {
    const pool = [poolItem({ enterpriseId: 'acme' })];
    const denied = exportInstinctRecords(pool, { enterpriseId: 'other-co' });
    expect(denied.records).toHaveLength(0); // 他租户条目默认不可见
    const allowed = exportInstinctRecords(pool, { enterpriseId: 'other-co', allowCrossTenant: true, now: '2026-10-09T00:00:00Z' });
    expect(allowed.records).toHaveLength(1);
    expect(allowed.crossTenantRecord).toBeDefined();
    expect(allowed.crossTenantRecord!.basis).toContain('数据主权');
  });
});

describe('章三 · instinct 源归一与混合构建', () => {
  const exported = exportInstinctRecords([poolItem(), poolItem({ id: 'inst-2' })]);

  it('instinct 源归一为 IngestRecord（列契约五列）', () => {
    const ing = ingestInstinctSource(exported.records.map((r) => ({ ...r })));
    expect(ing.records).toHaveLength(2);
    expect(ing.columns).toEqual([...INSTINCT_SOURCE_COLUMNS]);
    expect(ing.rejected).toHaveLength(0);
    expect(ing.records[0]!.fields['instinct_id']).toBe('inst-1');
  });

  it('源侧真实性门：空 sourceTraceId 再拒一道（纵深）', () => {
    const ing = ingestInstinctSource([{ instruction: 'a', output: 'b', sourceTraceId: '', instinctId: 'bad', confidence: 0.9 }]);
    expect(ing.records).toHaveLength(0);
    expect(ing.rejected[0]!.reason).toContain('fail-closed');
  });

  it('instinct 源与外部源混合构建数据集（同一 records 数组内混合 + 质量闸门照常）', () => {
    const externalRecords: IngestRecord[] = [
      { id: 'csv#1', source: 'samples.csv', fields: { instruction: '外部指令', output: '外部产出' } },
    ];
    const ing = ingestInstinctSource(exported.records.map((r) => ({ ...r })));
    const merged = mergeForDatasetBuild({ records: externalRecords, columns: ['instruction', 'output'] }, ing);
    // 同一 records 数组内混合断言（不是分别构建）
    expect(merged.records).toHaveLength(externalRecords.length + ing.records.length);
    const built = buildDataset(merged.records, merged.columns, { algorithm: 'sft' });
    expect(built.lines.length).toBeGreaterThanOrEqual(2); // 外部 + instinct 都成行
    // 质量闸门照常：缺必填列的行跳过不抛错（buildDataset 语义零改动）
    const partial = buildDataset([{ id: 'x#1', source: 'x', fields: { instruction: '只有指令' } }], merged.columns, { algorithm: 'sft' });
    expect(partial.skipped).toBe(1);
  });
});

describe('章三 · 血缘锚点（manifest 反向追溯）', () => {
  it('manifest 锚点逐字段值断言（sourceTraceId + instinctId + confidence 三者齐全且值正确）', () => {
    const exported = exportInstinctRecords([poolItem({ sourceTrace: 'sha256:xyz789' })]);
    const anchor = buildLineageAnchor(exported.records, '2026-10-09T00:00:00Z');
    expect(anchor.instinctIds).toEqual(['inst-1']);
    const row = anchor.lineage[0]!;
    expect(row.sourceTraceId).toBe('sha256:xyz789');
    expect(row.instinctId).toBe('inst-1');
    expect(row.confidence).toBe(1); // 3 pass / 3 occurrences → coverage=1 × passRate=1
  });

  it('train 侧 extractLineageAnchor 与归一记录对齐（反向追溯闭环）', () => {
    const exp = exportInstinctRecords([poolItem()]);
    const ing = ingestInstinctSource(exp.records.map((r) => ({ ...r })));
    const anchor = extractLineageAnchor(ing.records);
    expect(anchor.kind).toBe('instinct-lineage');
    expect(anchor.lineage[0]!.instinctId).toBe('inst-1');
    expect(anchor.lineage[0]!.sourceTraceId).toBe('sha256:abc123');
  });
});
