// ============================================================
// loop-state-extractor.ts · 控制图状态抽取（checkpoint → 可读 JSON）
// v1.1.9 新增
// 安全修复：loopId 消毒防路径穿越（QA 红队发现，v1.1.9）
// ============================================================
//
// 交付三（控制图状态抽取）——不引入新运行时，纯数据层翻译：
//   把 .sofagent/checkpoint/ 下的 LangGraph CheckpointRecord[]
//   翻译成人/前端可读的 ControlGraphState JSON（带 version: 'v1'
//   schema 字段，供 v1.2.x Dashboard 波次拓扑视图直接消费）。
//
// 翻译规则（架构设计 §7.5）：
//   - 波次拆分：按 retryCount 变化 + resumeFrom 非空拆分；
//     trigger 推断——首次=initial / audit FAIL 回 engineer=
//     audit-fail-retry / human 驳回=human-reject / 从 checkpoint
//     续跑=resume
//   - 节点状态：phase='before' → running；phase='after' +
//     auditResult=PASS/WARN → passed；auditResult=FAIL → failed；
//     终态已确定但节点未进入 → skipped；未开始 → pending
//   - 证据链：audit 节点的 auditReport 摘要 + checkpointFile 路径
//     + waveIndex 归属（Reality Anchor 链）
//
// 落盘：writeControlGraphState() 原子写到
//   {SOFAGENT_DATA}/loop-state/<loopId>.json（便携化场景自动指向 U 盘）
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';
import { createHash, randomBytes } from 'crypto';
import { loadEnvConfig } from '@sofagent/core';
import { FileCheckpointer, type CheckpointRecord } from './graph/checkpoint';
import type { LoopNodeName, AuditVerdict, LoopFinalStatus } from './loop/state';

/** schema 版本（字符串字面量，非数字——v1.2.x 按此路由解析） */
export const CONTROL_GRAPH_SCHEMA_VERSION = 'v1' as const;

/** 波次触发原因 */
export type WaveTrigger = 'initial' | 'audit-fail-retry' | 'human-reject' | 'resume';

/** 波次状态（一次 engineer→audit→reviewer→human_confirm 完整或部分链） */
export interface WaveState {
  /** 波次序号（0 起，按时间连续递增） */
  waveIndex: number;
  /** 波次开始时间（首个 checkpoint 的 savedAt） */
  startedAt: string;
  /** 波次结束时间（末个 checkpoint 的 savedAt；未结束缺省） */
  endedAt?: string;
  /** 触发原因 */
  trigger: WaveTrigger;
  /** 本波次经历的节点序列（按 checkpoint 时间序） */
  nodeSequence: string[];
}

/** 节点状态 */
export interface NodeState {
  /** 节点名（LOOP 四节点） */
  name: LoopNodeName;
  /** 状态：pending=未开始 / running=执行中 / passed / failed / skipped=终态已定未进入 */
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  /** 所属波次 */
  waveIndex: number;
  /** guard edge 是否触发（audit 节点 FAIL → retry guard / human 驳回 guard） */
  guardTriggered: boolean;
  /** guard 判定结果描述（如 "auditResult=FAIL retryCount=1<3 → 回 engineer"） */
  guardResult?: string;
  /** 进入时间（phase=before checkpoint 的 savedAt） */
  enteredAt?: string;
  /** 退出时间（phase=after checkpoint 的 savedAt） */
  exitedAt?: string;
}

/** Reality Anchor 证据（audit 节点的 git diff 硬证据引用） */
export interface Evidence {
  /** 固定 'audit'（证据只产自 audit guard 节点） */
  nodeName: 'audit';
  /** 所属波次 */
  waveIndex: number;
  /** 审计判定 */
  auditVerdict: AuditVerdict;
  /** git diff 引用（artifacts 中若有 commit/sha 字段则提取，缺省 undefined） */
  gitDiffRef?: string;
  /** audit 报告摘要（截断前 200 字符） */
  reportSummary: string;
  /** 产生本证据的 checkpoint 文件路径 */
  checkpointFile: string;
}

/** 控制图状态（对外契约——v1.2.x Dashboard 消费） */
export interface ControlGraphState {
  /** schema 版本（第一字段） */
  version: typeof CONTROL_GRAPH_SCHEMA_VERSION;
  /** LOOP 运行标识（= checkpointId） */
  loopId: string;
  /** 抽取时间 */
  extractedAt: string;
  /** LOOP 终态（取自最新 checkpoint 的 state.finalStatus） */
  finalStatus: LoopFinalStatus;
  /** 波次序列（按 waveIndex 升序） */
  waves: WaveState[];
  /** 节点状态（按进入时间升序） */
  nodes: NodeState[];
  /** Reality Anchor 证据链（按波次升序） */
  realityAnchorChain: Evidence[];
}

/** LOOP 四节点全集（终态已定时未出现的节点标 skipped） */
const ALL_NODES: readonly LoopNodeName[] = ['engineer', 'audit', 'reviewer', 'human_confirm'];

/**
 * 从 checkpoint 目录抽取控制图状态（纯函数——只读不写）。
 *
 * @param loopId        LOOP 运行标识（checkpointId）
 * @param checkpointDir checkpoint 目录（缺省 loadEnvConfig().dataDir/checkpoint，
 *                      便携化场景经 SOFAGENT_DATA env 自动指向 U 盘）
 * @returns ControlGraphState（无该 loopId 的 checkpoint 时返回空骨架）
 */
export function extractControlGraphState(loopId: string, checkpointDir?: string): ControlGraphState {
  const dir = checkpointDir ?? join(loadEnvConfig().dataDir, 'checkpoint');
  const safeLoopId = sanitizeLoopId(loopId);
  const records = loadRecordsForLoop(dir, safeLoopId);

  const waves = splitWaves(records);
  const nodes = mapNodeStates(records, waves);
  const realityAnchorChain = buildEvidenceChain(records, waves, dir);
  const finalStatus = resolveFinalStatus(records);

  return {
    version: CONTROL_GRAPH_SCHEMA_VERSION,
    loopId: safeLoopId,
    extractedAt: new Date().toISOString(),
    finalStatus,
    waves,
    nodes,
    realityAnchorChain,
  };
}

/**
 * 抽取并落盘到 {SOFAGENT_DATA}/loop-state/<loopId>.json（原子写）。
 * 安全：loopId 先经 sanitizeLoopId() 消毒（与读取侧同一函数），
 * 再以 resolve + startsWith 断言落盘路径仍在 dir 内（双重防护）。
 *
 * @returns 落盘文件绝对路径
 */
export function writeControlGraphState(loopId: string, checkpointDir?: string, outputDir?: string): string {
  const safeLoopId = sanitizeLoopId(loopId);
  const state = extractControlGraphState(loopId, checkpointDir);
  const dir = outputDir ?? join(loadEnvConfig().dataDir, 'loop-state');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${safeLoopId}.json`);
  assertWithinDir(filePath, dir, loopId);
  atomicWriteJson(filePath, state);
  return filePath;
}

// ============================================================
// 内部实现
// ============================================================

/**
 * loopId 消毒：仅保留字母 / 数字 / 下划线 / 连字符，其余字符（含路径
 * 分隔符、点号）统一替换为 '_'。写入侧与读取侧共用本函数，保证
 * `ab-promote-B-domain-...` 这类含特殊字符的 loopId 读写一致。
 *
 * POC-6 碰撞消除（v1.1.9）：当 loopId 中有字符被替换时（即 sanitized
 * !== loopId），追加 8 位短哈希后缀消除歧义——否则 `a/b`→`a_b` 与
 * 原始 `a_b`→`a_b` 消毒后同名，后者覆盖前者。无特殊字符时不加后缀。
 */
function sanitizeLoopId(loopId: string): string {
  const sanitized = loopId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (sanitized === loopId) {
    return sanitized; // 无特殊字符，无需加后缀
  }
  // 有字符被替换 → 追加 8 位短哈希后缀消除碰撞
  const hash = createHash('sha256').update(loopId).digest('hex').slice(0, 8);
  return `${sanitized}-${hash}`;
}

/** 路径穿越断言：filePath 解析后必须仍位于 dir 内，否则抛错拒绝写入 */
function assertWithinDir(filePath: string, dir: string, originalLoopId: string): void {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(dir) + sep)) {
    throw new Error(`路径穿越检测：${originalLoopId} 消毒后仍越界`);
  }
}

/** 加载某 loopId 的全部 checkpoint（按 savedAt 升序） */
function loadRecordsForLoop(checkpointDir: string, loopId: string): CheckpointRecord[] {
  if (!existsSync(checkpointDir)) return [];
  const checkpointer = new FileCheckpointer(checkpointDir);
  const records: CheckpointRecord[] = [];
  for (const fileName of checkpointer.list()) {
    const record = checkpointer.loadFile(join(checkpointDir, fileName));
    if (record && record.checkpointId === loopId) {
      records.push(record);
    }
  }
  // list() 按文件名排序（含时间戳）已基本有序，再按 savedAt 精确排序兜底
  records.sort((a, b) => (a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : 0));
  return records;
}

/**
 * 波次拆分：
 *   - 首条记录开第一波（trigger=initial；若 resumeFrom 非空则 resume）
 *   - retryCount 增大 → 新波次（trigger 看 auditResult：FAIL→audit-fail-retry，
 *     否则看 humanFeedback：rejected→human-reject）
 *   - resumeFrom 非空（从 checkpoint 续跑）→ 新波次（trigger=resume）
 */
export function splitWaves(records: CheckpointRecord[]): WaveState[] {
  if (records.length === 0) return [];
  const waves: WaveState[] = [];
  let currentWave: WaveState | null = null;
  let lastRetryCount = records[0]!.state.retryCount;

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const { retryCount, resumeFrom, auditResult, artifacts } = record.state;
    const humanFeedback = (artifacts as Record<string, unknown>)['humanFeedback'];

    let needNewWave = false;
    let trigger: WaveTrigger = 'initial';

    if (i === 0) {
      needNewWave = true;
      trigger = resumeFrom ? 'resume' : 'initial';
    } else if (retryCount > lastRetryCount) {
      needNewWave = true;
      if (auditResult === 'FAIL') trigger = 'audit-fail-retry';
      else if (humanFeedback === 'rejected') trigger = 'human-reject';
      else trigger = 'audit-fail-retry'; // retryCount 增大默认归 audit 重试
    } else if (resumeFrom && currentWave !== null && record.phase === 'before') {
      // 续跑场景：resumeFrom 非空且是新链的起点
      needNewWave = true;
      trigger = 'resume';
    }

    if (needNewWave || currentWave === null) {
      if (currentWave !== null) {
        currentWave.endedAt = records[i - 1]!.savedAt;
        waves.push(currentWave);
      }
      currentWave = {
        waveIndex: waves.length,
        startedAt: record.savedAt,
        trigger,
        nodeSequence: [],
      };
    }

    // 节点序列去重追加（同一节点 before/after 两条 checkpoint 只记一次）
    if (currentWave.nodeSequence[currentWave.nodeSequence.length - 1] !== record.node) {
      currentWave.nodeSequence.push(record.node);
    }
    lastRetryCount = retryCount;
  }

  if (currentWave !== null) {
    waves.push(currentWave);
  }
  return waves;
}

/**
 * 节点状态映射：每个 (节点, 波次) 组合一条 NodeState。
 *   - phase='before' → running（已进入未退出）
 *   - phase='after' → 按 auditResult / 节点类型判定 passed / failed
 *   - 终态已确定但节点在任何波次都没出现 → skipped
 */
export function mapNodeStates(records: CheckpointRecord[], waves: WaveState[]): NodeState[] {
  const nodes: NodeState[] = [];
  // (node, waveIndex) → NodeState 累加器
  const byKey = new Map<string, NodeState>();

  // 记录每条 checkpoint 属于哪个波次（按 startedAt 二分归属：
  // savedAt >= wave.startedAt 且（无下一波或 < 下一波.startedAt））
  const waveOf = (savedAt: string): number => {
    let idx = 0;
    for (let i = 0; i < waves.length; i++) {
      if (savedAt >= waves[i]!.startedAt) idx = i;
    }
    return idx;
  };

  for (const record of records) {
    const nodeName = record.node as LoopNodeName;
    if (!ALL_NODES.includes(nodeName)) continue;
    const waveIndex = waveOf(record.savedAt);
    const key = `${nodeName}#${waveIndex}`;
    const existing = byKey.get(key);

    if (record.phase === 'before') {
      const entered: NodeState = {
        name: nodeName,
        status: 'running',
        waveIndex,
        guardTriggered: false,
        enteredAt: record.savedAt,
      };
      byKey.set(key, existing ? { ...entered, ...{ exitedAt: existing.exitedAt, status: existing.status } } : entered);
    } else {
      // phase === 'after' → 判定 passed / failed
      const { status, guardTriggered, guardResult } = judgeAfterStatus(record);
      byKey.set(key, {
        name: nodeName,
        status,
        waveIndex,
        guardTriggered,
        guardResult,
        enteredAt: existing?.enteredAt,
        exitedAt: record.savedAt,
      });
    }
  }

  nodes.push(...byKey.values());

  // 终态已确定（completed/blocked/aborted）时，未出现的节点标 skipped
  const finalStatus = resolveFinalStatus(records);
  if (finalStatus !== 'running' && waves.length > 0) {
    const lastWaveIndex = waves.length - 1;
    for (const nodeName of ALL_NODES) {
      const appeared = nodes.some((n) => n.name === nodeName);
      if (!appeared) {
        nodes.push({
          name: nodeName,
          status: 'skipped',
          waveIndex: lastWaveIndex,
          guardTriggered: false,
        });
      }
    }
  }

  // 按 waveIndex + 节点序排序（确定性输出）
  const order = new Map(ALL_NODES.map((n, i) => [n, i]));
  nodes.sort((a, b) =>
    a.waveIndex !== b.waveIndex
      ? a.waveIndex - b.waveIndex
      : (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0),
  );
  return nodes;
}

/** phase='after' 状态判定（含 guard 触发识别） */
function judgeAfterStatus(record: CheckpointRecord): {
  status: 'passed' | 'failed';
  guardTriggered: boolean;
  guardResult?: string;
} {
  const { auditResult, retryCount } = record.state;
  const nodeName = record.node;

  if (nodeName === 'audit') {
    if (auditResult === 'FAIL') {
      return {
        status: 'failed',
        guardTriggered: true,
        guardResult: `auditResult=FAIL retryCount=${retryCount} → 回 engineer 重试`,
      };
    }
    // PASS / WARN 均放行
    return {
      status: 'passed',
      guardTriggered: true,
      guardResult: `auditResult=${auditResult ?? 'PASS'} → 放行 reviewer`,
    };
  }

  if (nodeName === 'human_confirm') {
    const humanFeedback = (record.state.artifacts as Record<string, unknown>)['humanFeedback'];
    if (humanFeedback === 'rejected') {
      return {
        status: 'failed',
        guardTriggered: true,
        guardResult: 'humanFeedback=rejected → 回 engineer 修复',
      };
    }
    return { status: 'passed', guardTriggered: false };
  }

  // engineer / reviewer：after 即 passed（它们的 guard 在 audit/human 侧）
  return { status: 'passed', guardTriggered: false };
}

/**
 * Reality Anchor 证据链：audit 节点的 after checkpoint → Evidence。
 * 报告摘要截断 200 字符；gitDiffRef 从 artifacts 提取（若有）。
 */
export function buildEvidenceChain(
  records: CheckpointRecord[],
  waves: WaveState[],
  checkpointDir: string,
): Evidence[] {
  const evidence: Evidence[] = [];
  const waveOf = (savedAt: string): number => {
    let idx = 0;
    for (let i = 0; i < waves.length; i++) {
      if (savedAt >= waves[i]!.startedAt) idx = i;
    }
    return idx;
  };

  for (const record of records) {
    if (record.node !== 'audit' || record.phase !== 'after') continue;
    const artifacts = record.state.artifacts as Record<string, unknown>;
    const auditReports = Array.isArray(artifacts['auditReports']) ? (artifacts['auditReports'] as string[]) : [];
    const latestReport = (artifacts['auditReport'] as string) || auditReports[auditReports.length - 1] || '';
    const gitDiffRef =
      (artifacts['gitDiffRef'] as string | undefined) ??
      (artifacts['commitSha'] as string | undefined) ??
      (artifacts['headSha'] as string | undefined);

    evidence.push({
      nodeName: 'audit',
      waveIndex: waveOf(record.savedAt),
      auditVerdict: (record.state.auditResult ?? 'PASS') as AuditVerdict,
      gitDiffRef,
      reportSummary: latestReport.length > 200 ? latestReport.slice(0, 200) + '…' : latestReport,
      checkpointFile: findCheckpointFile(checkpointDir, record),
    });
  }
  return evidence;
}

/** 按 savedAt + checkpointId 反查 checkpoint 文件名（证据引用） */
function findCheckpointFile(checkpointDir: string, record: CheckpointRecord): string {
  // 文件名 = checkpoint-{fileTs}-{rand}.json，fileTs 由 savedAt 派生
  const fileTs = record.savedAt.replace(/[:.]/g, '-');
  const prefix = `checkpoint-${fileTs}`;
  try {
    const checkpointer = new FileCheckpointer(checkpointDir);
    const match = checkpointer.list().find((f) => f.startsWith(prefix));
    if (match) return join(checkpointDir, match);
  } catch {
    // 反查失败降级
  }
  return join(checkpointDir, `${prefix}.json`);
}

/** 终态解析：最新一条 checkpoint 的 state.finalStatus */
function resolveFinalStatus(records: CheckpointRecord[]): LoopFinalStatus {
  if (records.length === 0) return 'running';
  const latest = records[records.length - 1]!;
  const status = latest.state.finalStatus;
  if (status === 'completed' || status === 'blocked' || status === 'aborted') return status;
  return 'running';
}

/** 原子写 JSON（tmp + rename，EXDEV 降级 copy+unlink） */
function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      copyFileSync(tmp, filePath);
      try { unlinkSync(tmp); } catch { /* 清理失败可忽略 */ }
    } else {
      throw err;
    }
  }
}
