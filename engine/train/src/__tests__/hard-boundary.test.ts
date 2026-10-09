// hard-boundary.test.ts · 评估硬边界 spy 断言 + TrainChannel 回流 + 队列落盘（v1.5.8 章三/四补强）
//
// 补齐三处「勾了但缺断言」的验收面：
//   A. 网络层 spy——exporter/examiner 全链零外部调用（dry-run 预览零网络请求）
//   B. TrainChannel 回流——构造的数据集走既有提交通道，训练事件回流审计链
//   E. 考核队列落盘——四类动作 append-only + 人审门消费面

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportInstinctRecords } from '@sofagent/orchestrator/instinct';
import { generateExamQuestion, assessExamination, checkDoNotCapture, checkCorroborationGate } from '@sofagent/orchestrator/instinct';
import { enqueueExamAction, readExamQueue } from '@sofagent/orchestrator/instinct';
import type { StoredInstinct } from '@sofagent/orchestrator/instinct';
import { ingestInstinctSource, mergeForDatasetBuild, extractLineageAnchor } from '../instinct-source';
import { buildDataset } from '../dataset-builder';
import { runDryrun } from '../train-dryrun';

function poolItem(over: Partial<StoredInstinct> = {}): StoredInstinct {
  return {
    id: 'inst-1', pattern: '提交前先跑 shellcheck', source: 'think',
    occurrences: 3, passCount: 3, failCount: 0, lastSeen: '2026-10-09T00:00:00Z',
    verified: 'verified', sourceTrace: 'sha256:abc', enterpriseId: 'default',
    ...over,
  };
}

describe('章三 · 评估硬边界（网络层 spy 断言）', () => {
  it('导出全链零网络请求（dry-run 预览——globalThis.fetch 全程未被调用）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const netSpy = vi.spyOn(require('node:http'), 'request').mockImplementation((() => undefined) as never);
    const netSpy2 = vi.spyOn(require('node:https'), 'request').mockImplementation((() => undefined) as never);

    const exported = exportInstinctRecords([poolItem(), poolItem({ id: 'i2' })]);
    const ing = ingestInstinctSource(exported.records.map((r) => ({ ...r })));
    const merged = mergeForDatasetBuild({ records: [], columns: ['instruction', 'output'] }, ing);
    const built = buildDataset(merged.records, merged.columns, { algorithm: 'sft' });

    expect(built.lines.length).toBeGreaterThanOrEqual(2); // 全链确已执行
    expect(fetchSpy).not.toHaveBeenCalled(); // 零 fetch
    expect(netSpy).not.toHaveBeenCalled(); // 零 http
    expect(netSpy2).not.toHaveBeenCalled(); // 零 https
    fetchSpy.mockRestore(); netSpy.mockRestore(); netSpy2.mockRestore();
  });

  it('捕获/采集层模块零外部评估端点依赖（静态：源码 import 面无判定件/托管端点）', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const orch = path.resolve(__dirname, '../../../orchestrator/src/instinct');
    for (const f of ['exporter.ts', 'examiner.ts', 'store.ts', 'exam-queue.ts']) {
      const src = fs.readFileSync(join(orch, f), 'utf8');
      // 外部 URL import 形态（http(s) 直引）= 端点依赖；合法面仅 相对路径 / @sofagent 包名 / node: 内建
      const urlImports = [...src.matchAll(/from\s+['"](https?:\/\/[^'"]+)['"]/g)].map((x) => x[1]);
      const hasEvalEndpoint = /judge-endpoint|llm-endpoint|api\.openai|anthropic\.com|deepseek/i.test(src);
      expect({ file: f, urlImports, hasEvalEndpoint }).toEqual({ file: f, urlImports: [], hasEvalEndpoint: false });
    }
  });
});

describe('章三 · TrainChannel 回流（构造产物走既有提交通道）', () => {
  it('混合数据集产物形态兼容既有 train 提交面（DatasetResult → manifest + lines 可交付）', () => {
    // 既有 TrainChannel 提交消费的是 DatasetResult（lines + manifest 契约）——
    // instinct 混合构建产物与外部源产物同构（同一 buildDataset 出口），回流通道零改动。
    const exported = exportInstinctRecords([poolItem()]);
    const ing = ingestInstinctSource(exported.records.map((r) => ({ ...r })));
    const merged = mergeForDatasetBuild(
      { records: [{ id: 'csv#1', source: 's.csv', fields: { instruction: 'a', output: 'b' } }], columns: ['instruction', 'output'] },
      ing,
    );
    const built = buildDataset(merged.records, merged.columns, { algorithm: 'sft' });
    // 断言同构性：产物含外部源行与 instinct 行（混合回流——零通道分叉）
    expect(built.lines.length).toBe(2);
    expect(built).toHaveProperty('columnMapping'); // 既有 DatasetResult 契约字段（提交通道消费面）
    const anchor = extractLineageAnchor(ing.records);
    expect(anchor.lineage).toHaveLength(1); // 血缘锚点可从交付物侧提取（manifest 嵌入由提交侧组合）
    // 训练事件回流审计链 = 既有 emitDecision 面（TrainChannel 语义零改动——本测试锁「零改动」：
    // dataset 产物不含任何自有审计写入调用，回流只经既有通道）
    const trainSrc = require('node:fs').readFileSync(join(__dirname, '..', 'instinct-source.ts'), 'utf8');
    expect(trainSrc).not.toMatch(/emitDecision|appendHistory/); // 源适配器零自有审计写——回流唯一通道不变
  });
});

describe('章三 · 生产消费面接线（train-dryrun 旁挂接入点）', () => {
  it('dryrun 传 instinct 记录 → 归一合并进同一个 buildDataset，产物含 instinct 来源行', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-instinct-wiring-'));
    // 外部源 CSV（10 条）——混合构建的另一半
    const rows = ['instruction,output'];
    for (let i = 0; i < 10; i++) rows.push(`问题${i}怎么处理,答案${i}是这样做`);
    const csv = join(dir, 'ext.csv');
    writeFileSync(csv, rows.join('\n'), 'utf8');

    const exported = exportInstinctRecords([poolItem(), poolItem({ id: 'inst-2' })]);
    const r = runDryrun({
      dataPath: csv,
      algorithm: 'sft',
      instinctRecords: exported.records.map((x) => ({ ...x })),
    });

    // 接线检查项在，且不是 fail
    const wiring = r.checks.find((c) => c.name === 'instinct-source-connectivity');
    expect(wiring).toBeDefined();
    expect(wiring!.status).not.toBe('fail');
    expect(wiring!.status).toBe('ok');
    expect(wiring!.detail).toContain('合并');

    // 真合并进buildDataset：合并总数 = 外部 10 + instinct 2，产物 12 行
    expect(r.instinct?.accepted).toBe(2);
    expect(r.instinct?.mergedTotal).toBe(12);
    expect(r.instinct?.totalLines).toBe(12);
    expect(r.instinct?.instinctLines).toBe(2); // 产物中确有 instinct 来源行（非"应该能进"）
    expect(r.instinct?.lineage.instinctIds).toEqual(['inst-1', 'inst-2']);
    expect(r.passed).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('未传 instinct 记录 → 检查项 skip 且外部源构建行为零变化（缺省不扰既有调用方）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sofagent-instinct-noskip-'));
    writeFileSync(dir + '/ext.csv', 'instruction,output\nq1,a1\nq2,a2\n', 'utf8');
    const r = runDryrun({ dataPath: dir + '/ext.csv', algorithm: 'sft' });

    const wiring = r.checks.find((c) => c.name === 'instinct-source-connectivity');
    expect(wiring?.status).toBe('skip');
    expect(r.instinct).toBeUndefined();
    expect(r.passed).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('章四 · 考核队列落盘（人审门消费面）', () => {
  let dir: string;
  it('四类动作 append-only 落盘且可按类型过滤读回', () => {
    dir = mkdtempSync(join(tmpdir(), 'sofagent-exam-queue-'));
    const q = generateExamQuestion(
      { ...poolItem(), confidence: 0.9, coverage: 1, passRate: 1 },
      'deterministic',
    )!;
    enqueueExamAction(dir, { type: 'enqueue-question', question: q });
    enqueueExamAction(dir, {
      type: 'record-result',
      result: {
        instinctId: 'inst-1', questionId: q.id,
        votes: [
          { vote: 'answer-check', pass: true, basis: 'ok' },
          { vote: 'reproduction', pass: true, basis: 'ok' },
        ],
        outcome: 'verified', sedimentVerdict: 'SAVE',
      },
    });
    const rej = checkDoNotCapture({ id: 'bad', pattern: '缺少 credential 二进制依赖' })!;
    enqueueExamAction(dir, { type: 'record-rejection', rejection: rej });
    const gate = checkCorroborationGate({ id: 'weak', occurrences: 1 }, { complexOnly: true });
    enqueueExamAction(dir, { type: 'record-pending', pending: gate.pending! });

    const all = readExamQueue(dir);
    expect(all.entries).toHaveLength(4);
    expect(all.corruptedLines).toBe(0);
    const onlyRej = readExamQueue(dir, { type: 'record-rejection' });
    expect(onlyRej.entries).toHaveLength(1);
    expect(onlyRej.entries[0]!.action.type).toBe('record-rejection');
    rmSync(dir, { recursive: true, force: true });
  });

  it('拒收记录可审计（do-not-capture 命中四类落账——kind 台账化）', () => {
    const d2 = mkdtempSync(join(tmpdir(), 'sofagent-exam-rej-'));
    for (const pat of ['缺少 credential', '不要用 npm', 'ECONNRESET 重试成功', '一次性任务']) {
      const r = checkDoNotCapture({ id: `x-${pat}`, pattern: pat });
      expect(r).not.toBeNull();
      enqueueExamAction(d2, { type: 'record-rejection', rejection: r! });
    }
    const rejs = readExamQueue(d2, { type: 'record-rejection' });
    expect(rejs.entries).toHaveLength(4);
    const kinds = rejs.entries.map((e) => (e.action as { rejection: { kind: string } }).rejection.kind);
    expect(new Set(kinds).size).toBe(4); // 四类各有落账
    rmSync(d2, { recursive: true, force: true });
  });
});
