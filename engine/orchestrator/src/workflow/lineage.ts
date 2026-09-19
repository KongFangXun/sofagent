// ============================================================
// workflow/lineage.ts · workflow 模板血缘记录（v1.5.0 G1 · T5）
// ============================================================
//
// 跨企业 fork 的引擎侧载体（changelog 十二章）：模板离开本企业后
// 血缘仍可追溯——「谁从谁 fork、源版本是几、改了哪几处」。
//
// 与 G13 PR 元数据 / G4 绩效导出同构消费：JSON 机器可读清单，
// 挂 decision-log 审计链（import/export 动作 emitDecision）。
//
// 存储：{dataDir}/workflow-store/lineage.jsonl（append-only 事件流——
//   export / import / fork 各一行事件，与 workflow-store 同目录惯例，
//   独立文件不占 trunk/branch 命名空间）。
//
// 事件形态（WorkflowLineageEvent）：
//   - export：{workflowId, sourceEnterprise, sourceVersion, lineage} 离开企业
//   - import：{workflowId, importedAs, from.enterprise/version/lineageId} 进入企业
//   - fork：  {workflowId, forkedFrom{...}, changedFields} 本地派生
//
// 跨租户可见性联动（验收 ④，G6）：import 事件携带入包（bundle）的
// 节点可见性清单快照——private / result-only 节点在「跨租户导出」
// 时即被剥离（exportBundle 的 redactForCrossTenant），血缘侧只存
// 剥离计数（strippedPrivate / strippedResultOnly），不存节点本体
// （被剥离的节点名也不落 export 包——清单只记数量防枚举）。
//
// 包边界：本文件在 orchestrator 包内；mcp 侧 workflow-export /
// workflow-import tools 只经 @sofagent/orchestrator/workflow 导出面
// 调用，禁反向依赖（mcp 不直接读 lineage.jsonl 文件）。
// ============================================================

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/** 血缘事件类型 */
export type LineageEventType = 'export' | 'import' | 'fork';

/** fork 谱系链节点（一条从源头到当前的 fork 链） */
export interface LineageAncestor {
  /** 源 workflow 标识（源企业内的 id） */
  workflowId: string;
  /** 源企业标识（企业间分发时声明） */
  enterprise: string;
  /** 源版本号（fork 时刻的 trunk version） */
  version: number;
  /** 本层 fork 时间（ISO 8601） */
  forkedAt: string;
}

/** 血缘事件（lineage.jsonl 单行形态） */
export interface WorkflowLineageEvent {
  /** 事件类型 */
  type: LineageEventType;
  /** 事件唯一标识（lineage-<epoch>-<rand4>） */
  eventId: string;
  /** 本地 workflow 标识（import 后的新 id / export 的源 id） */
  workflowId: string;
  /** 事件时间（ISO 8601） */
  occurredAt: string;
  /** 执行者（审计留痕——fork 谁） */
  actor: string;
  /** export：源企业标识 / import：来源企业 / fork：源 workflow 企业 */
  enterprise: string;
  /** export：源版本 / import：来源版本 / fork：源版本 */
  version: number;
  /** import：导入落地的新 workflow id */
  importedAs?: string;
  /** fork / import：祖先链（新在前——最近的 fork 是链头） */
  ancestors?: LineageAncestor[];
  /** fork：相对源版本改动的字段路径清单 */
  changedFields?: string[];
  /** export：跨租户剥离统计（G6 可见性联动——只记数量不记节点名） */
  strippedPrivate?: number;
  strippedResultOnly?: number;
}

/** lineage 存储路径（{dataDir}/workflow-store/lineage.jsonl） */
export function lineagePath(dataDir: string): string {
  return join(dataDir, 'workflow-store', 'lineage.jsonl');
}

/** 生成事件 id（时间戳 + 随机段——append-only 流的幂等键） */
function newEventId(): string {
  return `lineage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 追加血缘事件（append-only——JSONL 单行，损坏行跳过不阻断读取）。
 * 写失败抛错（fail-loud——血缘是 fork 追溯的法定记录，静默丢失不可接受）。
 */
export function appendLineageEvent(event: Omit<WorkflowLineageEvent, 'eventId' | 'occurredAt'>, dataDir: string): WorkflowLineageEvent {
  const full: WorkflowLineageEvent = {
    ...event,
    eventId: newEventId(),
    occurredAt: new Date().toISOString(),
  };
  const dir = join(dataDir, 'workflow-store');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(lineagePath(dataDir), JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

/**
 * 读取全部血缘事件（坏行剔除计数返回——同 WAL JSONL 纪律）。
 */
export function readLineageEvents(dataDir: string): { events: WorkflowLineageEvent[]; corruptLines: number } {
  const p = lineagePath(dataDir);
  if (!existsSync(p)) return { events: [], corruptLines: 0 };
  const raw = readFileSync(p, 'utf-8');
  const events: WorkflowLineageEvent[] = [];
  let corrupt = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as WorkflowLineageEvent;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string' || typeof parsed.eventId !== 'string') {
        corrupt++;
        continue;
      }
      events.push(parsed);
    } catch {
      corrupt++;
    }
  }
  return { events, corruptLines: corrupt };
}

/**
 * 查询单个 workflow 的完整血缘谱系（验收 ③——fork 谱系可查）。
 *
 * 追溯算法：以 workflowId 为起点，沿 import / fork 事件的 ancestors 链
 * 向上回溯（本地 fork 链逐层展开），直到无更早祖先。跨企业链头的
 * enterprise / version 即「源企业 / 源版本」。
 *
 * @returns 谱系链（时间升序——最早源在前）；无血缘记录返回空数组
 */
export function traceLineage(workflowId: string, dataDir: string): LineageAncestor[] {
  const { events } = readLineageEvents(dataDir);
  const chain: LineageAncestor[] = [];
  let cursor: string | null = workflowId;
  // 环防护 + 去重统一键：workflowId@enterprise 复合键（fork 分支的源与
  // import 分支的链头同键去重；同名不同企业的层不丢——恶意/损坏事件
  // 造环也不死循环）
  const seen = new Set<string>([`${workflowId}@*`]);
  while (cursor !== null) {
    // 找「导入 / 派生出 cursor」的最近事件（同 id 多次 fork 取最新一条）
    const birth = events
      .filter((e) => (e.type === 'import' && e.importedAs === cursor) || (e.type === 'fork' && e.workflowId === cursor))
      .pop();
    if (!birth) break;
    if (birth.type === 'fork') {
      // fork：源 = 祖先链头（本层 fork 的直接源）
      const src = birth.ancestors?.[0];
      if (!src) break;
      const key = `${src.workflowId}@${src.enterprise}`;
      if (seen.has(key)) break;
      chain.push(src);
      seen.add(key);
      cursor = src.workflowId;
    } else {
      // import：ancestors 链（新在前）整段接入。链头与 importedAs 同名是
      // 正常形态（chainFromBundle 头插 importedAs 作链头）——它携带的是
      // 「源企业视角的 fork 快照」这一层谱系，与本地 fork 已记的层同键
      // 去重（复合键），不同企业的层保留。
      for (const a of birth.ancestors ?? []) {
        const key = `${a.workflowId}@${a.enterprise}`;
        if (seen.has(key)) continue;
        chain.push(a);
        seen.add(key);
      }
      break; // 链头祖先已含跨企业完整谱系（export 包内置），向上无本地记录
    }
  }
  // 时间升序输出（最早源在前——读谱系从上往下即 fork 演进史）
  return chain.sort((a, b) => a.forkedAt.localeCompare(b.forkedAt));
}

// ────────────────────────────────────────────────────────────
// 导出包血缘元数据（export bundle 内嵌段——跨企业分发的随身档案）
// ────────────────────────────────────────────────────────────

/** 导出包血缘元数据（bundle.manifest 的 lineage 段） */
export interface BundleLineage {
  /** 导出时间（ISO 8601） */
  exportedAt: string;
  /** 源企业标识（导入方据此回溯——验收 ③） */
  sourceEnterprise: string;
  /** 源 workflow 标识 */
  sourceWorkflowId: string;
  /** 源版本（导出时刻的 trunk version） */
  sourceVersion: number;
  /** 祖先链（本企业内此模板的完整谱系——随包携带，导入方续链） */
  ancestors: LineageAncestor[];
  /** fork 层级（祖先链深度——0 = 企业原生模板，1 = 一次 fork，…） */
  forkDepth: number;
}

/**
 * 构造导出包血缘元数据。
 *
 * @param workflowId 源 workflow 标识
 * @param trunkVersion 源版本（trunk 当前 version）
 * @param sourceEnterprise 源企业标识
 * @param dataDir 数据目录（读既有谱系续链）
 */
export function buildBundleLineage(
  workflowId: string,
  trunkVersion: number,
  sourceEnterprise: string,
  dataDir: string,
): BundleLineage {
  const ancestors = traceLineage(workflowId, dataDir);
  // 本层 fork 记录：本企业原生（无祖先）时链头即自身
  const self: LineageAncestor = {
    workflowId,
    enterprise: sourceEnterprise,
    version: trunkVersion,
    forkedAt: new Date().toISOString(),
  };
  return {
    exportedAt: self.forkedAt,
    sourceEnterprise,
    sourceWorkflowId: workflowId,
    sourceVersion: trunkVersion,
    ancestors: [...ancestors, self],
    forkDepth: ancestors.length,
  };
}

/**
 * 导入侧续链：把 bundle 携带的祖先链接到导入方本地谱系。
 *
 * 返回值即 import 事件的 ancestors 段（新在前——导入落地的新 id 是
 * 链头，其后是包内祖先链，链头指向源企业源版本）。
 *
 * @param bundle 包内血缘元数据
 * @param importedAs 导入落地的新 workflow id
 */
export function chainFromBundle(bundle: BundleLineage, importedAs: string): LineageAncestor[] {
  const head: LineageAncestor = {
    workflowId: importedAs,
    enterprise: bundle.sourceEnterprise,
    version: bundle.sourceVersion,
    forkedAt: new Date().toISOString(),
  };
  // 包内链去重（防循环构造的 bundle 把同一节点塞多遍）
  const seen = new Set<string>([importedAs]);
  const tail = bundle.ancestors.filter((a) => !seen.has(a.workflowId) && seen.add(a.workflowId));
  return [head, ...tail];
}
