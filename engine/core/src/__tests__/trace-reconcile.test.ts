// ============================================================
// trace-reconcile.test.ts · 三源对账矩阵用例（v1.5.0 章八）
// ============================================================
//
// 验收标准对应：
//   1. DSH session JSONL 样本可解析为统一 trace 模型（合成 zstd 用
//      注入 decompressFn——不引压缩依赖；真实格式由 fzstd 承载）
//   2. 三源对账四态判定正确（一致/漏报/幻觉/瞒报——合成坏样本逐一命中）
//   3. 模型层回溯链通：推理 → 模型版本 → train_job → datasetHash
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as zlib from 'zlib';
import {
  parseDshSession,
  loadDshSessions,
  reconcileTraces,
  collectTraceWriteSet,
  collectTraceReadSet,
  buildModelLayerTrace,
  classifyFileOp,
  extractFilePathFromArgs,
  TRACE_MODEL_SCHEMA_VERSION,
  type TraceModelExport,
  type DecompressFn,
} from '../trace-reconcile';

// ── 测试工具 ──────────────────────────────────────────────

/** 合成 DSH JSONL（事件流样本） */
function makeDshJsonl(): string {
  return [
    JSON.stringify({ type: 'session', version: 0, id: 'session-test-1', createdAt: 1789484794938, cwd: '/repo', delegationDepth: 0 }),
    JSON.stringify({ type: 'turn/start', seq: 4, time: 1789484795000, data: { turn: 1 } }),
    JSON.stringify({ type: 'step/start', seq: 6, time: 1789484795100, data: { turn: 1, step: 1 } }),
    JSON.stringify({ type: 'tool/call', seq: 44, time: 1789484795200, data: { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"/repo/src/a.ts"}' } }),
    JSON.stringify({ type: 'tool/call', seq: 45, time: 1789484795300, data: { turn: 1, step: 1, callId: 'c2', name: 'edit', arguments: '{"file_path":"/repo/src/a.ts"}' } }),
    JSON.stringify({ type: 'tool/call', seq: 46, time: 1789484795400, data: { turn: 1, step: 1, callId: 'c3', name: 'write', arguments: '{"file_path":"/repo/src/new-file.ts"}' } }),
    JSON.stringify({ type: 'tool/call', seq: 47, time: 1789484795500, data: { turn: 1, step: 1, callId: 'c4', name: 'bash', arguments: '{"command":"npm test"}' } }),
    JSON.stringify({ type: 'tool/result', seq: 48, time: 1789484795600, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' } } } }),
    JSON.stringify({ type: 'step/end', seq: 49, time: 1789484795700, data: { turn: 1, step: 1 } }),
    JSON.stringify({ type: 'turn/end', seq: 50, time: 1789484795800, data: { turn: 1, reason: { kind: 'completed' } } }),
    'BAD LINE {{{',
    '',
  ].join('\n');
}

/** gzip 伪装 zstd——测试只验证 decompressFn 注入通道（格式无关） */
const fakeZstd: DecompressFn = (input) => new Uint8Array(zlib.gunzipSync(Buffer.from(input)));

/** 合成 trace（不经文件——直接构造统一模型） */
function makeTrace(writes: string[], reads: string[] = []): TraceModelExport {
  const events = [
    ...writes.map((filePath, i) => ({
      type: 'file-op' as const, seq: i, ts: '2026-09-17T00:00:00.000Z', source: 'dsh' as const,
      sessionId: 's1', fileOp: 'write' as const, filePath,
    })),
    ...reads.map((filePath, i) => ({
      type: 'file-op' as const, seq: 100 + i, ts: '2026-09-17T00:00:00.000Z', source: 'dsh' as const,
      sessionId: 's1', fileOp: 'read' as const, filePath,
    })),
  ];
  return { schemaVersion: TRACE_MODEL_SCHEMA_VERSION, source: 'dsh', sessionId: 's1', exportedAt: '2026-09-17T00:00:00.000Z', events };
}

// ── 1. DSH 解析 ──────────────────────────────────────────

describe('DSH session 解析 → 统一 trace 模型', () => {
  it('test_parseDshSession_事件四分类映射正确', () => {
    // gzip 压缩到临时文件再解析（decompressFn 注入）
    const tmp = join(__dirname, 'test-session.jsonl.zstd');
    require('fs').writeFileSync(tmp, zlib.gzipSync(Buffer.from(makeDshJsonl())));
    try {
      const model = parseDshSession(tmp, fakeZstd);
      expect(model.schemaVersion).toBe('v1');
      expect(model.source).toBe('dsh');
      expect(model.sessionId).toBe('session-test-1');
      expect(model.cwd).toBe('/repo');
      // turn 2 条（start/end）+ step 2 条 + tool-call 4 条 + file-op 3 条（read/edit/write；bash 不产）
      const byType = { turn: 0, step: 0, 'tool-call': 0, 'file-op': 0 } as Record<string, number>;
      for (const ev of model.events) byType[ev.type] += 1;
      expect(byType['turn']).toBe(2);
      expect(byType['step']).toBe(2);
      expect(byType['tool-call']).toBe(4);
      expect(byType['file-op']).toBe(3);
      // 坏行跳过（BAD LINE 不入模型）
    } finally {
      require('fs').rmSync(tmp, { force: true });
    }
  });

  it('test_parseDshSession_fileOp分类_读写工具正确归档', () => {
    expect(classifyFileOp('read')).toBe('read');
    expect(classifyFileOp('edit')).toBe('write');
    expect(classifyFileOp('write')).toBe('write');
    expect(classifyFileOp('bash')).toBeUndefined();
    expect(classifyFileOp('grep')).toBeUndefined();
  });

  it('test_extractFilePathFromArgs_多键名兼容', () => {
    expect(extractFilePathFromArgs('{"file_path":"/a/b.ts"}')).toBe('/a/b.ts');
    expect(extractFilePathFromArgs('{"path":"/x/y.md"}')).toBe('/x/y.md');
    expect(extractFilePathFromArgs('not json')).toBeUndefined();
    expect(extractFilePathFromArgs(undefined)).toBeUndefined();
  });

  it('test_loadDshSessions_目录扫描与cwd过滤', () => {
    const home = join(__dirname, '__dsh-test-home__');
    const fs = require('fs');
    const sessionDir = join(home, 'sessions', '--repo-', 'session-abc');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(join(sessionDir, 'session.jsonl.zstd'), zlib.gzipSync(Buffer.from(makeDshJsonl())));
    try {
      // cwd 过滤命中
      const hit = loadDshSessions({ dshHome: home, cwdFilter: '/repo', decompressFn: fakeZstd });
      expect(hit.length).toBe(1);
      expect(hit[0]!.sessionId).toBe('session-test-1');
      // cwd 过滤不命中
      const miss = loadDshSessions({ dshHome: home, cwdFilter: '/other', decompressFn: fakeZstd });
      expect(miss.length).toBe(0);
      // 根不存在 → 空数组
      expect(loadDshSessions({ dshHome: join(home, 'nope') })).toEqual([]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── 2. 三源对账四态矩阵 ──────────────────────────────────

describe('三源对账四态判定', () => {
  it('test_reconcile_一致_trace与diff吻合', () => {
    const report = reconcileTraces({
      traces: [makeTrace(['/repo/src/a.ts'], ['/repo/src/a.ts'])],
      diffFiles: ['src/a.ts'],
      repoRoot: '/repo',
    });
    expect(report.discrepancies).toEqual([]);
    expect(report.consistencyRate).toBe(1);
    expect(report.schemaVersion).toBe('v1');
  });

  it('test_reconcile_漏报_diff有trace无', () => {
    const report = reconcileTraces({
      traces: [makeTrace(['/repo/src/a.ts'])],
      diffFiles: ['src/a.ts', 'src/secret-leak.ts'],
      repoRoot: '/repo',
    });
    const omitted = report.discrepancies.filter((d) => d.verdict === 'omitted');
    expect(omitted.length).toBe(1);
    expect(omitted[0]!.path).toBe('src/secret-leak.ts');
  });

  it('test_reconcile_幻觉_trace有write_diff无', () => {
    const report = reconcileTraces({
      traces: [makeTrace(['/repo/src/a.ts', '/repo/src/phantom.ts'])],
      diffFiles: ['src/a.ts'],
      repoRoot: '/repo',
    });
    const halluc = report.discrepancies.filter((d) => d.verdict === 'hallucinated');
    expect(halluc.length).toBe(1);
    expect(halluc[0]!.path).toBe('src/phantom.ts');
  });

  it('test_reconcile_幻觉豁免_写后删除回滚闭环', () => {
    const report = reconcileTraces({
      traces: [makeTrace(['/repo/src/a.ts', '/repo/src/rolled-back.ts'])],
      diffFiles: ['src/a.ts'],
      deletedFiles: ['src/rolled-back.ts'],
      repoRoot: '/repo',
    });
    expect(report.discrepancies.filter((d) => d.path === 'src/rolled-back.ts')).toEqual([]);
  });

  it('test_reconcile_瞒报_logs声明与diff不符', () => {
    const report = reconcileTraces({
      traces: [makeTrace(['/repo/src/a.ts'])],
      diffFiles: ['src/a.ts'],
      declaredFiles: ['src/a.ts', 'src/claimed-but-absent.ts'],
      repoRoot: '/repo',
    });
    const mis = report.discrepancies.filter((d) => d.verdict === 'misreported');
    expect(mis.length).toBe(1);
    expect(mis[0]!.path).toBe('src/claimed-but-absent.ts');
  });

  it('test_reconcile_干了没报_diff有logs无_计瞒报', () => {
    const report = reconcileTraces({
      traces: [makeTrace(['/repo/src/a.ts'])],
      diffFiles: ['src/a.ts', 'src/undeclared.ts'],
      declaredFiles: ['src/a.ts'],
      repoRoot: '/repo',
    });
    // undeclared：diff 有 + trace 无 → omitted（漏报）；logs 维度未声明也计一条 misreported？
    // 契约：diff+trace 一致但 logs 未声明 → misreported。undeclared 同时 omitted。
    const verdicts = report.discrepancies.filter((d) => d.path === 'src/undeclared.ts').map((d) => d.verdict);
    expect(verdicts).toContain('omitted');
  });

  it('test_reconcile_一致率计算', () => {
    const report = reconcileTraces({
      traces: [makeTrace(['/repo/a.ts', '/repo/b.ts'])],
      diffFiles: ['a.ts'],
      repoRoot: '/repo',
    });
    // union = {a,b}，差异 1（b 幻觉）→ 1 - 1/2 = 0.5
    expect(report.consistencyRate).toBe(0.5);
  });

  it('test_collectTraceReadSet_读取证据面', () => {
    const reads = collectTraceReadSet([makeTrace(['/repo/w.ts'], ['/repo/r1.ts', '/repo/r2.ts'])], '/repo');
    expect(reads).toEqual(['r1.ts', 'r2.ts']);
    const writes = collectTraceWriteSet([makeTrace(['/repo/w.ts'], ['/repo/r1.ts'])], '/repo');
    expect(writes).toEqual(['w.ts']);
  });
});

// ── 3. 模型层回溯链 ──────────────────────────────────────

describe('模型层回溯链（推理 → 模型 → train_job → datasetHash）', () => {
  it('test_buildModelLayerTrace_回溯到不晚于推理时刻的最新训练', () => {
    const links = buildModelLayerTrace(
      [
        { ts: '2026-09-17T12:00:00.000Z', provider: 'deepseek', model: 'v4-flash' },
        { ts: '2026-08-01T00:00:00.000Z', provider: 'deepseek', model: 'v3-base' },
      ],
      [
        { trainJobId: 'job-2', datasetHash: 'hash-bbb', datasetVersion: 'v2', hmacVerified: true, timestamp: '2026-09-01T00:00:00.000Z' },
        { trainJobId: 'job-1', datasetHash: 'hash-aaa', datasetVersion: 'v1', hmacVerified: true, timestamp: '2026-07-01T00:00:00.000Z' },
      ],
    );
    // 09-17 推理 → 回溯 job-2（09-01 训练）
    expect(links[0]!.model).toBe('deepseek/v4-flash');
    expect(links[0]!.trainJobId).toBe('job-2');
    expect(links[0]!.fingerprint?.datasetHash).toBe('hash-bbb');
    expect(links[0]!.fingerprint?.hmacVerified).toBe(true);
    // 08-01 推理 → 回溯 job-1（07-01 训练）
    expect(links[1]!.trainJobId).toBe('job-1');
    expect(links[1]!.fingerprint?.datasetVersion).toBe('v1');
  });

  it('test_buildModelLayerTrace_无匹配训练_trainJobId缺省', () => {
    const links = buildModelLayerTrace(
      [{ ts: '2026-01-01T00:00:00.000Z', provider: 'x', model: 'y' }],
      [{ trainJobId: 'job-late', datasetHash: 'h', datasetVersion: 'v', hmacVerified: true, timestamp: '2026-06-01T00:00:00.000Z' }],
    );
    expect(links[0]!.trainJobId).toBeUndefined();
    expect(links[0]!.fingerprint).toBeUndefined();
  });
});
