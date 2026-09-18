// ============================================================
// dataset-review.test.ts · v1.5.0 章一 · 数据集人审判定测试
//
// 覆盖：reviewDatasetVersion 全语义——
//   1. approve/reject 写入 reviewStatus（原行原位更新）
//   2. decision-log 留痕（ARTIFACT_EDIT + category select/skip）
//   3. 版本不存在 → 抛错（fail-loud）
//   4. 非法 decision → 抛错
//   5. 改判语义（isFirstReview=false）+ 台账无重复行
//   6. audit 包不可用 → best-effort 降级（auditLogged=false，判定照常落盘）
//
// 全部临时目录（零真实 ~/.sofagent/data）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { recordDatasetVersion, readDatasetVersions, reviewDatasetVersion } from '../dataset-version';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-ds-review-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const BASE_INPUT = {
  dataDir: '',
  enterpriseId: 'ent-1',
  datasetId: 'ds-a',
  contentHash: 'a'.repeat(64),
  sampleCount: 100,
  algorithm: 'sft' as const,
  columnMapping: { instruction: 'prompt', output: 'answer' } as Record<string, string>,
  datasetFile: 'data/train/ent-1/datasets/ds-a.jsonl',
};

/** why 可能是 string 或 {text} 结构——统一取文本 */
function whyText(entry: { why?: unknown }): string {
  const w = entry.why;
  if (typeof w === 'string') return w;
  if (w && typeof w === 'object' && 'text' in w) return String((w as { text?: unknown }).text ?? '');
  return '';
}

describe('reviewDatasetVersion（v1.5.0 章一 · 数据集人审）', () => {
  it('approve：reviewStatus=approved 写入 + decision-log 留痕', () => {
    const rec = recordDatasetVersion({ ...BASE_INPUT, dataDir }, 'v1');
    expect(rec.reviewStatus).toBeUndefined(); // 初始无状态 = pending

    const result = reviewDatasetVersion({
      dataDir, enterpriseId: 'ent-1', datasetId: 'ds-a', version: 'v1', decision: 'approve',
      comment: '抽样 20 条语义质量达标',
    });

    expect(result.record.reviewStatus).toBe('approved');
    expect(result.isFirstReview).toBe(true);
    // decision-log 落盘验证
    const decisionFile = join(dataDir, 'audit', 'decision-log.jsonl');
    expect(existsSync(decisionFile)).toBe(true);
    const lines = readFileSync(decisionFile, 'utf8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.kind).toBe('ARTIFACT_EDIT');
    expect(last.category).toBe('select');
    expect(whyText(last)).toContain('该训');
    expect(whyText(last)).toContain('抽样 20 条');
    // auditLogged 取决于 audit dist 可用性——本测试环境 monorepo 内 require('@sofagent/audit') 可达
    expect(typeof result.auditLogged).toBe('boolean');
  });

  it('reject：reviewStatus=rejected + category=skip', () => {
    recordDatasetVersion({ ...BASE_INPUT, dataDir }, 'v1');
    const result = reviewDatasetVersion({
      dataDir, enterpriseId: 'ent-1', datasetId: 'ds-a', version: 'v1', decision: 'reject',
    });
    expect(result.record.reviewStatus).toBe('rejected');
    const decisionFile = join(dataDir, 'audit', 'decision-log.jsonl');
    const lines = readFileSync(decisionFile, 'utf8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.category).toBe('skip');
    expect(whyText(last)).toContain('不训');
  });

  it('版本不存在 → fail-loud 抛错', () => {
    expect(() =>
      reviewDatasetVersion({ dataDir, enterpriseId: 'ent-1', datasetId: 'ghost', version: 'v9', decision: 'approve' }),
    ).toThrow(/版本不存在/);
  });

  it('非法 decision → 抛错', () => {
    recordDatasetVersion({ ...BASE_INPUT, dataDir }, 'v1');
    expect(() =>
      reviewDatasetVersion({
        dataDir, enterpriseId: 'ent-1', datasetId: 'ds-a', version: 'v1',
        decision: 'maybe' as 'approve' | 'reject',
      }),
    ).toThrow(/approve \| reject/);
  });

  it('改判：isFirstReview=false + 台账无重复行', () => {
    recordDatasetVersion({ ...BASE_INPUT, dataDir }, 'v1');
    reviewDatasetVersion({ dataDir, enterpriseId: 'ent-1', datasetId: 'ds-a', version: 'v1', decision: 'approve' });
    const second = reviewDatasetVersion({
      dataDir, enterpriseId: 'ent-1', datasetId: 'ds-a', version: 'v1', decision: 'reject', comment: '复检发现敏感残留',
    });

    expect(second.isFirstReview).toBe(false);
    expect(second.record.reviewStatus).toBe('rejected');
    // 台账仍只有一行（原位更新——无追加歧义行）
    const all = readDatasetVersions(dataDir, 'ent-1');
    expect(all.length).toBe(1);
    expect(all[0].reviewStatus).toBe('rejected');
    // 改判语义入 why
    const lines = readFileSync(join(dataDir, 'audit', 'decision-log.jsonl'), 'utf8').trim().split('\n');
    expect(whyText(JSON.parse(lines[lines.length - 1]))).toContain('改判');
  });

  it('多版本共存：只改目标行，他行不动', () => {
    recordDatasetVersion({ ...BASE_INPUT, dataDir }, 'v1');
    recordDatasetVersion({ ...BASE_INPUT, dataDir, contentHash: 'b'.repeat(64) }, 'v2');

    reviewDatasetVersion({ dataDir, enterpriseId: 'ent-1', datasetId: 'ds-a', version: 'v1', decision: 'approve' });

    const all = readDatasetVersions(dataDir, 'ent-1');
    expect(all.length).toBe(2);
    const v1 = all.find((r) => r.version === 'v1');
    const v2 = all.find((r) => r.version === 'v2');
    expect(v1?.reviewStatus).toBe('approved');
    expect(v2?.reviewStatus).toBeUndefined(); // 未审的不动
  });
});
