// ============================================================
// loop-state-extractor.test.ts · 控制图状态抽取测试
// v1.1.8 新增
//
// 覆盖：正常通过链 / audit guard 触发重跑 / human_confirm 跳过 /
// 波次序号连续 / schema version 字段 / 证据链 git diff 引用齐全
// ——对应 T03 验收 ≥6 case。
//
// 测试手法：直接按 CheckpointRecord 落盘格式手写 fixture
// （schemaVersion='v1' + checkpointId + phase + node + savedAt +
// state），文件名沿用 checkpoint-{ISO安全时间戳}-{rand}.json
// 范式，FileCheckpointer.list() 按文件名升序即时间升序。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractControlGraphState,
  writeControlGraphState,
  splitWaves,
  CONTROL_GRAPH_SCHEMA_VERSION,
} from '../loop-state-extractor';
import type { CheckpointRecord, CheckpointState } from '../graph/checkpoint';
import { emptyArtifacts, type LoopArtifacts } from '../loop/state';

const LOOP_ID = 'loop-test-20260722-abc123';

function makeState(overrides: Partial<CheckpointState> = {}, artifacts: Partial<LoopArtifacts> = {}): CheckpointState {
  return {
    finalStatus: 'running',
    checkpointId: LOOP_ID,
    retryCount: 0,
    currentNode: 'engineer',
    auditResult: null,
    resumeFrom: null,
    artifacts: { ...emptyArtifacts('测试任务'), ...artifacts } as Record<string, unknown>,
    ...overrides,
  };
}

function makeRecord(
  node: string,
  phase: 'before' | 'after',
  savedAt: string,
  stateOverrides: Partial<CheckpointState> = {},
  artifacts: Partial<LoopArtifacts> = {},
): CheckpointRecord {
  return {
    schemaVersion: 'v1',
    checkpointId: LOOP_ID,
    phase,
    node,
    savedAt,
    state: makeState(stateOverrides, artifacts),
  };
}

/** 把 records 按 checkpoint 文件范式写入目录（文件名时间戳保证 list() 有序） */
function writeFixtures(dir: string, records: CheckpointRecord[]): void {
  records.forEach((record, i) => {
    const fileTs = record.savedAt.replace(/[:.]/g, '-');
    const fileName = `checkpoint-${fileTs}-${String(i).padStart(6, '0')}.json`;
    fs.writeFileSync(path.join(dir, fileName), JSON.stringify(record, null, 2), 'utf-8');
  });
}

describe('loop-state-extractor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-loopstate-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('case 1 · 正常通过链：engineer→audit→reviewer→human_confirm 单波次全 passed', () => {
    const records: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z', { currentNode: 'engineer' }),
      makeRecord('audit', 'before', '2026-07-22T10:02:00.000Z', { currentNode: 'audit' }),
      makeRecord('audit', 'after', '2026-07-22T10:03:00.000Z', { currentNode: 'audit', auditResult: 'PASS' }, { auditReport: '审计通过' }),
      makeRecord('reviewer', 'before', '2026-07-22T10:04:00.000Z', { currentNode: 'reviewer' }),
      makeRecord('reviewer', 'after', '2026-07-22T10:05:00.000Z', { currentNode: 'reviewer' }),
      makeRecord('human_confirm', 'before', '2026-07-22T10:06:00.000Z', { currentNode: 'human_confirm' }),
      makeRecord('human_confirm', 'after', '2026-07-22T10:07:00.000Z', { currentNode: 'end', finalStatus: 'completed' }, { humanFeedback: 'approved' }),
    ];
    writeFixtures(tmpDir, records);

    const state = extractControlGraphState(LOOP_ID, tmpDir);
    expect(state.version).toBe(CONTROL_GRAPH_SCHEMA_VERSION);
    expect(state.loopId).toBe(LOOP_ID);
    expect(state.finalStatus).toBe('completed');
    expect(state.waves).toHaveLength(1);
    expect(state.waves[0]!.trigger).toBe('initial');
    expect(state.waves[0]!.nodeSequence).toEqual(['engineer', 'audit', 'reviewer', 'human_confirm']);
    // 四节点全 passed，无 skipped
    const statuses = Object.fromEntries(state.nodes.map((n) => [n.name, n.status]));
    expect(statuses).toEqual({ engineer: 'passed', audit: 'passed', reviewer: 'passed', human_confirm: 'passed' });
  });

  it('case 2 · audit guard 触发重跑：FAIL → retryCount+1 → 新波次 audit-fail-retry', () => {
    const records: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z'),
      makeRecord('audit', 'before', '2026-07-22T10:02:00.000Z'),
      makeRecord('audit', 'after', '2026-07-22T10:03:00.000Z', { auditResult: 'FAIL' }, { auditReport: '铁律违反' }),
      // 重试波次：retryCount 0→1
      makeRecord('engineer', 'before', '2026-07-22T10:04:00.000Z', { retryCount: 1, auditResult: 'FAIL' }),
      makeRecord('engineer', 'after', '2026-07-22T10:05:00.000Z', { retryCount: 1, auditResult: 'FAIL' }),
      makeRecord('audit', 'before', '2026-07-22T10:06:00.000Z', { retryCount: 1, auditResult: 'FAIL' }),
      makeRecord('audit', 'after', '2026-07-22T10:07:00.000Z', { retryCount: 1, auditResult: 'PASS', finalStatus: 'completed' }, { auditReport: '复审通过' }),
    ];
    writeFixtures(tmpDir, records);

    const state = extractControlGraphState(LOOP_ID, tmpDir);
    expect(state.waves).toHaveLength(2);
    expect(state.waves[0]!.trigger).toBe('initial');
    expect(state.waves[1]!.trigger).toBe('audit-fail-retry');
    // 波次序号连续（0,1）
    expect(state.waves.map((w) => w.waveIndex)).toEqual([0, 1]);
    // 第一波 audit failed + guard 触发
    const auditWave0 = state.nodes.find((n) => n.name === 'audit' && n.waveIndex === 0);
    expect(auditWave0!.status).toBe('failed');
    expect(auditWave0!.guardTriggered).toBe(true);
    expect(auditWave0!.guardResult).toContain('FAIL');
    // 第二波 audit passed
    const auditWave1 = state.nodes.find((n) => n.name === 'audit' && n.waveIndex === 1);
    expect(auditWave1!.status).toBe('passed');
  });

  it('case 3 · human_confirm 驳回 → human-reject 波次；未进入节点在终态下标 skipped', () => {
    const records: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z'),
      makeRecord('audit', 'before', '2026-07-22T10:02:00.000Z'),
      makeRecord('audit', 'after', '2026-07-22T10:03:00.000Z', { auditResult: 'PASS' }, { auditReport: 'ok' }),
      makeRecord('human_confirm', 'before', '2026-07-22T10:04:00.000Z'),
      makeRecord('human_confirm', 'after', '2026-07-22T10:05:00.000Z', { auditResult: 'PASS' }, { humanFeedback: 'rejected' }),
      // 驳回后重试：retryCount 0→1，但本轮 aborted 终止（reviewer 从未进入）
      makeRecord('engineer', 'before', '2026-07-22T10:06:00.000Z', { retryCount: 1, auditResult: 'PASS' }, { humanFeedback: 'rejected' }),
      makeRecord('engineer', 'after', '2026-07-22T10:07:00.000Z', { retryCount: 1, auditResult: 'PASS', finalStatus: 'aborted' }, { humanFeedback: 'rejected' }),
    ];
    writeFixtures(tmpDir, records);

    const state = extractControlGraphState(LOOP_ID, tmpDir);
    expect(state.waves).toHaveLength(2);
    expect(state.waves[1]!.trigger).toBe('human-reject');
    expect(state.finalStatus).toBe('aborted');
    // reviewer 从未进入 → 终态已定时标 skipped
    const reviewer = state.nodes.find((n) => n.name === 'reviewer');
    expect(reviewer!.status).toBe('skipped');
    // human_confirm 驳回 → failed + guard
    const human = state.nodes.find((n) => n.name === 'human_confirm' && n.waveIndex === 0);
    expect(human!.status).toBe('failed');
    expect(human!.guardTriggered).toBe(true);
  });

  it('case 4 · schema version 字段为第一字段且等于 v1（v1.2.x 消费契约）', () => {
    const records: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z', { finalStatus: 'completed' }),
    ];
    writeFixtures(tmpDir, records);

    const outDir = path.join(tmpDir, 'loop-state');
    const filePath = writeControlGraphState(LOOP_ID, tmpDir, outDir);
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // version 是 JSON 第一字段
    expect(Object.keys(parsed)[0]).toBe('version');
    expect(parsed['version']).toBe('v1');
    expect(parsed['loopId']).toBe(LOOP_ID);
  });

  it('case 5 · 证据链齐全：audit 证据含 verdict/gitDiffRef/报告摘要/checkpointFile 且按波次升序', () => {
    const records: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z'),
      makeRecord('audit', 'before', '2026-07-22T10:02:00.000Z'),
      makeRecord('audit', 'after', '2026-07-22T10:03:00.000Z', { auditResult: 'FAIL' }, { auditReport: '第一轮：铁律违反', commitSha: 'aaa111' }),
      makeRecord('engineer', 'before', '2026-07-22T10:04:00.000Z', { retryCount: 1, auditResult: 'FAIL' }),
      makeRecord('engineer', 'after', '2026-07-22T10:05:00.000Z', { retryCount: 1, auditResult: 'FAIL' }),
      makeRecord('audit', 'before', '2026-07-22T10:06:00.000Z', { retryCount: 1, auditResult: 'FAIL' }),
      makeRecord('audit', 'after', '2026-07-22T10:07:00.000Z', { retryCount: 1, auditResult: 'PASS', finalStatus: 'completed' }, { auditReport: '第二轮：复审通过', commitSha: 'bbb222' }),
    ];
    writeFixtures(tmpDir, records);

    const state = extractControlGraphState(LOOP_ID, tmpDir);
    expect(state.realityAnchorChain).toHaveLength(2);
    // 按波次升序
    expect(state.realityAnchorChain.map((e) => e.waveIndex)).toEqual([0, 1]);
    const first = state.realityAnchorChain[0]!;
    expect(first.nodeName).toBe('audit');
    expect(first.auditVerdict).toBe('FAIL');
    expect(first.gitDiffRef).toBe('aaa111');
    expect(first.reportSummary).toContain('铁律违反');
    expect(first.checkpointFile).toContain('checkpoint-');
    expect(fs.existsSync(first.checkpointFile)).toBe(true);
    const second = state.realityAnchorChain[1]!;
    expect(second.auditVerdict).toBe('PASS');
    expect(second.gitDiffRef).toBe('bbb222');
  });

  it('case 6 · 无 checkpoint 时返回空骨架（running / 空波次 / 空证据）', () => {
    const state = extractControlGraphState('loop-nonexistent', tmpDir);
    expect(state.version).toBe('v1');
    expect(state.finalStatus).toBe('running');
    expect(state.waves).toEqual([]);
    expect(state.nodes).toEqual([]);
    expect(state.realityAnchorChain).toEqual([]);
  });

  it('case 7 · resume 续跑拆分新波次（trigger=resume）', () => {
    const records: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z'),
      makeRecord('audit', 'before', '2026-07-22T10:02:00.000Z'),
      makeRecord('audit', 'after', '2026-07-22T10:03:00.000Z', { auditResult: 'FAIL' }, { auditReport: 'fail' }),
      // 崩溃后从 checkpoint 续跑：resumeFrom 非空 + before phase
      makeRecord('engineer', 'before', '2026-07-22T11:00:00.000Z', { retryCount: 1, auditResult: 'FAIL', resumeFrom: 'engineer' }),
      makeRecord('engineer', 'after', '2026-07-22T11:01:00.000Z', { retryCount: 1, auditResult: 'FAIL', resumeFrom: 'engineer' }),
    ];
    writeFixtures(tmpDir, records);

    const waves = splitWaves(records);
    expect(waves).toHaveLength(2);
    expect(waves[0]!.trigger).toBe('initial');
    // retryCount 增大优先判 audit-fail-retry（resumeFrom 场景次之）
    expect(['audit-fail-retry', 'resume']).toContain(waves[1]!.trigger);
    expect(waves.map((w) => w.waveIndex)).toEqual([0, 1]);
  });

  it('case 8 · 安全：路径穿越 loopId 被消毒到 dir 内（QA 红队 POC）', () => {
    const records: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z', { finalStatus: 'completed' }),
    ];
    writeFixtures(tmpDir, records);

    const outDir = path.join(tmpDir, 'loop-state');
    // 红队 POC：'../escaped/evil' 中的 '/' 与 '.' 被替换为 '_'
    // 有字符被替换 → 追加 8 位短哈希后缀（POC-6 碰撞消除，v1.1.9）
    const filePath = writeControlGraphState('../escaped/evil', tmpDir, outDir);
    // 断言落盘路径仍在 outDir 内
    const resolvedFile = path.resolve(filePath);
    expect(resolvedFile.startsWith(path.resolve(outDir) + path.sep)).toBe(true);
    // 文件名已被消毒（'/' 与 '.' 均替换为 '_'，不含路径分隔符）+ 8 位哈希后缀
    const crypto = require('crypto');
    const expectedHash = crypto.createHash('sha256').update('../escaped/evil').digest('hex').slice(0, 8);
    expect(path.basename(filePath)).toBe(`___escaped_evil-${expectedHash}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
    // outDir 之外不应出现 escaped/evil.json
    expect(fs.existsSync(path.join(tmpDir, 'escaped', 'evil.json'))).toBe(false);
  });

  it('case 9 · 安全：消毒前后读写一致（写入含特殊字符 loopId，读取侧同逻辑读回）', () => {
    // loopId 含空格/斜杠等特殊字符（模拟 ab-promote-B-domain-... 场景）
    const specialLoopId = 'ab-promote-B-domain 2026/07/22';
    // POC-6 碰撞消除后，有字符被替换 → 追加 8 位哈希后缀
    const crypto = require('crypto');
    const expectedSanitized = 'ab-promote-B-domain_2026_07_22';
    const expectedHash = crypto.createHash('sha256').update(specialLoopId).digest('hex').slice(0, 8);
    const safeLoopId = `${expectedSanitized}-${expectedHash}`;
    const records: CheckpointRecord[] = [
      {
        schemaVersion: 'v1',
        checkpointId: safeLoopId,
        phase: 'before',
        node: 'engineer',
        savedAt: '2026-07-22T10:00:00.000Z',
        state: makeState({ checkpointId: safeLoopId }),
      },
      {
        schemaVersion: 'v1',
        checkpointId: safeLoopId,
        phase: 'after',
        node: 'engineer',
        savedAt: '2026-07-22T10:01:00.000Z',
        state: makeState({
          checkpointId: safeLoopId,
          finalStatus: 'completed',
        }),
      },
    ];
    writeFixtures(tmpDir, records);

    const outDir = path.join(tmpDir, 'loop-state');
    const filePath = writeControlGraphState(specialLoopId, tmpDir, outDir);
    expect(fs.existsSync(filePath)).toBe(true);
    // 落盘文件名使用消毒后的 loopId（含哈希后缀）
    expect(path.basename(filePath)).toBe(`${safeLoopId}.json`);
    // 读取侧用原始 loopId 能读回同一状态（消毒一致）
    const state = extractControlGraphState(specialLoopId, tmpDir);
    expect(state.loopId).toBe(safeLoopId);
    expect(state.finalStatus).toBe('completed');
    // 落盘 JSON 内容与读取侧一致
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    expect(onDisk['loopId']).toBe(safeLoopId);
    expect(onDisk['finalStatus']).toBe('completed');
  });

  it('case 10 · POC-6 碰撞消除：两个不同 loopId 消毒后不碰撞（a/b vs a_b）', () => {
    // POC-6 场景：'a/b' 消毒后 = 'a_b'，原始 'a_b' 消毒后也 = 'a_b'
    // 加哈希后缀后两者文件名不同，不再覆盖
    const outDir = path.join(tmpDir, 'loop-state');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // 写入第一个 loopId（含特殊字符 → 有哈希后缀）
    const records1: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z', { finalStatus: 'completed' }),
    ];
    // 写入第二个 loopId（无特殊字符 → 无哈希后缀）
    const records2: CheckpointRecord[] = [
      makeRecord('engineer', 'before', '2026-07-22T10:00:00.000Z'),
      makeRecord('engineer', 'after', '2026-07-22T10:01:00.000Z', { finalStatus: 'completed' }),
    ];

    // 写入 'a/b' 的 checkpoint（checkpointId 用消毒后值匹配）
    const crypto = require('crypto');
    const hashAb = crypto.createHash('sha256').update('a/b').digest('hex').slice(0, 8);
    const safeAb = `a_b-${hashAb}`;
    const dir1 = path.join(tmpDir, 'ck1');
    fs.mkdirSync(dir1, { recursive: true });
    writeFixtures(dir1, records1.map((r) => ({ ...r, checkpointId: safeAb, state: { ...r.state, checkpointId: safeAb } })));

    // 写入 'a_b' 的 checkpoint（无特殊字符，不加后缀）
    const dir2 = path.join(tmpDir, 'ck2');
    fs.mkdirSync(dir2, { recursive: true });
    writeFixtures(dir2, records2);

    const filePath1 = writeControlGraphState('a/b', dir1, outDir);
    const filePath2 = writeControlGraphState('a_b', dir2, outDir);

    // 两个文件路径不同（不碰撞）
    expect(filePath1).not.toBe(filePath2);
    // 两者都存在
    expect(fs.existsSync(filePath1)).toBe(true);
    expect(fs.existsSync(filePath2)).toBe(true);
    // 'a/b' → a_b-<hash>.json（含哈希后缀）
    expect(path.basename(filePath1)).toBe(`a_b-${hashAb}.json`);
    // 'a_b' → a_b.json（无哈希后缀）
    expect(path.basename(filePath2)).toBe('a_b.json');
  });
});
