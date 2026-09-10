// ============================================================
// pr-store.ts · PR 生命周期状态机（G13）
// ============================================================
//
// workflow 变更提案（PR）的写接口动作面——三 MCP tool（pr_submit /
// pr_review / pr_merge）的存储与状态机：
//
//   状态机：open → reviewed → merged
//                └──────→ rejected（终态）
//   （open 可直接 rejected——跳过 reviewed）
//
//   merge_criteria 判定：PR 携带 workflow 的 merge_criteria，merge 时
//   全过自动合并、未过走 HITL（pending 态等人审）。
//
//   triggerBinding 两态（三铁律）：
//     suggested  启发式产生（如 G2 缺口分析推断「该节点该升级」）
//     confirmed  显式动作产生（人/Agent 明确决策）
//   铁律：① 显式决策不被启发式覆盖 ② 后来显式可替换 ③ 同资源 upsert 单条
//
//   审计：submit/review/merge/reject 全动作挂 decision-log（HMAC 链）；
//   拒绝留痕进 decision-log（负样本训练信号）。
//
//   PR 元数据（贡献者/权重）供 G4 contribution_query 消费。
//
// 存储：{dataDir}/pr-store/{prId}.json（单文件单 PR——原子写）
// ============================================================

import { existsSync, readFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import { emitDecision } from './decision-log';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** PR 状态（状态机四态） */
export type PrStatus = 'open' | 'reviewed' | 'merged' | 'rejected';

/** 触发绑定两态（suggested=启发式 / confirmed=显式） */
export type TriggerConfidence = 'suggested' | 'confirmed';

/** triggerBinding 元数据（三铁律载体） */
export interface TriggerBinding {
  /** 触发来源（如 gap-analyzer / human / agent-action） */
  source: string;
  /** 两态置信 */
  confidence: TriggerConfidence;
  /** 绑定时间（ISO 8601） */
  boundAt: string;
}

/** PR 贡献者条目（G4 消费——人/数字员工同标准） */
export interface PrContributor {
  /** 贡献者标识（agentId / userId——同标准） */
  contributor_id: string;
  /** 贡献权重（0-1；创建者 1.0，协作者按声明） */
  weight: number;
}

/** 存储的 PR 对象 */
export interface StoredPr {
  /** PR 标识 */
  id: string;
  /** 目标 workflow */
  workflow_id: string;
  /** 变更描述 */
  title: string;
  /** 提交者（贡献者之一，weight=1） */
  submitter: string;
  /** 状态 */
  status: PrStatus;
  /** 贡献者清单（权重分摊） */
  contributors: PrContributor[];
  /** merge_criteria（从 workflow 继承或 PR 自带） */
  mergeCriteria: Array<{ kind: string; detail?: string }>;
  /** criteria 判定结论（merge 时产出） */
  criteriaResults?: Array<{ kind: string; passed: boolean }>;
  /** triggerBinding（可选——启发式/显式来源绑定） */
  triggerBinding?: TriggerBinding;
  /** 审阅者（review 后记录） */
  reviewer?: string;
  /** 审阅意见 */
  reviewNote?: string;
  /** HITL 挂起标记（criteria 未过等人审） */
  awaitingHuman?: boolean;
  /** branch→trunk 合并后回填的新 trunk 版本（merge 写回联动成功时记录） */
  mergedVersion?: number;
  /** merged→open 回退原因（写回失败回滚时记录，审计留痕） */
  revertReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** PR 操作结果（三 tool 共用形态） */
export interface PrResult {
  text: string;
  data: {
    isError: boolean;
    action: 'submit' | 'review' | 'merge';
    prId: string;
    status?: PrStatus;
    /** merge 后新 trunk 版本（merge 成功时） */
    mergedVersion?: number;
    /** criteria 判定明细（merge 时） */
    criteriaResults?: Array<{ kind: string; passed: boolean }>;
    awaitingHuman?: boolean;
    issues?: string[];
    auditLogged: boolean;
  };
}

// ────────────────────────────────────────────────────────────
// 存储原语
// ────────────────────────────────────────────────────────────

const PR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function prDir(dataDir: string): string {
  return join(dataDir, 'pr-store');
}

function prPath(dataDir: string, id: string): string {
  return join(prDir(dataDir), `${id}.json`);
}

function readPr(dataDir: string, id: string): StoredPr | null {
  const p = prPath(dataDir, id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as StoredPr;
}

function writePr(dataDir: string, pr: StoredPr): void {
  const dir = prDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteSync(prPath(dataDir, pr.id), JSON.stringify(pr, null, 2));
}

/** 列出全部 PR（G4 消费面） */
export function listPrs(dataDir: string): StoredPr[] {
  const dir = prDir(dataDir);
  if (!existsSync(dir)) return [];
  const out: StoredPr[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')) as StoredPr);
    } catch {
      // 损坏跳过（列举面不 crash）
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function auditLog(kind: string, why: string, artifactRef: string, evidence: string[]): boolean {
  try {
    emitDecision({
      agentId: `sofagent-pr-store-${kind}`,
      sessionId: `pr-${Date.now()}`,
      kind: 'ORCHESTRATION',
      moment: 'ACT',
      category: 'select',
      why,
      artifactRef,
      evidence,
    });
    return true;
  } catch {
    return false; // best-effort——状态已写，审计失败显式标注
  }
}

// ────────────────────────────────────────────────────────────
// triggerBinding 三铁律
// ────────────────────────────────────────────────────────────

/**
 * triggerBinding upsert（三铁律执行器）。
 *
 * 铁律一：显式决策不被启发式覆盖——existing.confidence=confirmed 且
 *        新 binding 是 suggested → 拒绝（返回 false 不改）。
 * 铁律二：后来显式可替换——任何态接受 confirmed（更新 source/boundAt）。
 * 铁律三：同资源 upsert 单条——PR 对象上只有一份 triggerBinding（对象字段位）。
 *
 * @returns true=已更新；false=铁律一拦截（未改）
 */
export function upsertTriggerBinding(
  pr: StoredPr,
  source: string,
  confidence: TriggerConfidence,
): boolean {
  const existing = pr.triggerBinding;
  if (existing && existing.confidence === 'confirmed' && confidence === 'suggested') {
    return false; // 铁律一：显式不被启发式覆盖
  }
  pr.triggerBinding = { source, confidence, boundAt: new Date().toISOString() };
  return true;
}

// ────────────────────────────────────────────────────────────
// merge_criteria 真判定器（fail-closed）
// ────────────────────────────────────────────────────────────

/**
 * confidence 两态 → 数值映射。
 *
 * PR 的 triggerBinding.confidence 是两态枚举（无数值），映射口径固定：
 *   confirmed（显式决策）= 1.0
 *   suggested（启发式）  = 0.5
 *   无 triggerBinding    = 0
 */
function confidenceValue(pr: StoredPr): number {
  if (!pr.triggerBinding) return 0;
  return pr.triggerBinding.confidence === 'confirmed' ? 1.0 : 0.5;
}

/** 解析 confidence-min 的 detail（形如 'gte:0.7'）——返回 null 表示畸形/缺失 */
function parseGteThreshold(detail: string | undefined): number | null {
  if (!detail) return null;
  const match = /^gte:([0-9]*\.?[0-9]+)$/.exec(detail);
  if (match === null) return null;
  const threshold = Number(match[1]);
  return Number.isFinite(threshold) ? threshold : null;
}

/**
 * 单条 merge_criterion 判定（fail-closed：宁可多走 HITL 不可静默放行）。
 *
 * 内置 kind 清单：
 *   - 'approver-review'：PR 已被非提交者审阅（reviewer 存在且 ≠ submitter）
 *   - 'confidence-min'：triggerBinding 映射值 ≥ detail 阈值（'gte:0.7'）
 *   - 未知 kind / detail 畸形缺失 → passed:false（走 HITL 人审）
 */
function evaluateCriterion(
  pr: StoredPr,
  criterion: { kind: string; detail?: string },
): boolean {
  switch (criterion.kind) {
    case 'approver-review':
      // reviewer 缺失或等于 submitter → 未过（自审在 prReview 已拒，此处双保险）
      return Boolean(pr.reviewer) && pr.reviewer !== pr.submitter;
    case 'confidence-min': {
      const threshold = parseGteThreshold(criterion.detail);
      if (threshold === null) return false; // detail 缺失/畸形 → fail-closed
      return confidenceValue(pr) >= threshold;
    }
    default:
      return false; // 未知 kind → fail-closed
  }
}

// ────────────────────────────────────────────────────────────
// 三操作实现
// ────────────────────────────────────────────────────────────

export interface PrSubmitInput {
  pr_id: string;
  workflow_id: string;
  title: string;
  submitter: string;
  /** 额外贡献者（可选——submitter 自动 weight=1 计入） */
  contributors?: Array<{ contributor_id: string; weight: number }>;
  merge_criteria?: Array<{ kind: string; detail?: string }>;
  /** triggerBinding（可选——gap-analyzer 启发式= suggested / 显式动作= confirmed） */
  trigger?: { source: string; confidence: TriggerConfidence };
}

/**
 * pr_submit——新建 PR（open 态）。
 */
export function prSubmit(input: PrSubmitInput, dataDir: string): PrResult {
  if (!input.pr_id || !input.workflow_id || !input.title || !input.submitter) {
    return {
      text: '[sofagent] pr_submit 失败：缺必填参数（pr_id/workflow_id/title/submitter）',
      data: { isError: true, action: 'submit', prId: input.pr_id ?? '', issues: ['缺必填参数'], auditLogged: false },
    };
  }
  if (!PR_ID_PATTERN.test(input.pr_id)) {
    return {
      text: `[sofagent] pr_submit 失败：pr_id「${input.pr_id}」非法（字母数字开头，≤128 字符）`,
      data: { isError: true, action: 'submit', prId: input.pr_id, issues: ['pr_id 非法'], auditLogged: false },
    };
  }
  if (readPr(dataDir, input.pr_id) !== null) {
    return {
      text: `[sofagent] pr_submit 失败：PR「${input.pr_id}」已存在`,
      data: { isError: true, action: 'submit', prId: input.pr_id, issues: ['PR 已存在'], auditLogged: false },
    };
  }

  // contributors 根因校验：weight 必须 0-1 数值；声明条数 ≤10（submitter 自动追加不计入上限）
  if (input.contributors !== undefined) {
    const weightIssues: string[] = [];
    for (const c of input.contributors) {
      if (typeof c.weight !== 'number' || !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 1) {
        weightIssues.push(
          `contributor「${c.contributor_id}」weight 须为 0-1 数值（收到 ${String(c.weight)}）`,
        );
      }
    }
    if (input.contributors.length > 10) {
      weightIssues.push(`contributors 声明条数 ${input.contributors.length} 超上限（合法范围 0-10 条，submitter 自动追加不计入）`);
    }
    if (weightIssues.length > 0) {
      return {
        text: `[sofagent] pr_submit 失败：contributors 校验未通过（${weightIssues.length} 项）：${weightIssues[0]}`,
        data: { isError: true, action: 'submit', prId: input.pr_id, issues: weightIssues, auditLogged: false },
      };
    }
  }

  const now = new Date().toISOString();
  const contributors: PrContributor[] = [
    { contributor_id: input.submitter, weight: 1 },
    ...(input.contributors ?? []),
  ];
  const pr: StoredPr = {
    id: input.pr_id,
    workflow_id: input.workflow_id,
    title: input.title,
    submitter: input.submitter,
    status: 'open',
    contributors,
    mergeCriteria: input.merge_criteria ?? [],
    createdAt: now,
    updatedAt: now,
  };
  if (input.trigger) {
    upsertTriggerBinding(pr, input.trigger.source, input.trigger.confidence);
  }
  writePr(dataDir, pr);

  const auditLogged = auditLog(
    'submit',
    `PR submit: ${input.pr_id}「${input.title}」→ workflow ${input.workflow_id}（submitter=${input.submitter}）`,
    `pr-store/${input.pr_id}`,
    [`status=open contributors=${contributors.length}`, ...(input.trigger ? [`trigger=${input.trigger.confidence}(${input.trigger.source})`] : [])],
  );

  return {
    text: `[sofagent] ✅ PR「${input.pr_id}」已提交（open · ${contributors.length} 贡献者 · 目标 workflow=${input.workflow_id}）`,
    data: { isError: false, action: 'submit', prId: input.pr_id, status: 'open', auditLogged },
  };
}

export interface PrReviewInput {
  pr_id: string;
  reviewer: string;
  /** approve=通过（→reviewed）/ reject=拒绝（→rejected 终态） */
  verdict: 'approve' | 'reject';
  note?: string;
}

/**
 * pr_review——审阅（approve → reviewed / reject → rejected 终态 + 负样本留痕）。
 */
export function prReview(input: PrReviewInput, dataDir: string): PrResult {
  const pr = readPr(dataDir, input.pr_id);
  if (pr === null) {
    return {
      text: `[sofagent] pr_review 失败：PR「${input.pr_id}」不存在`,
      data: { isError: true, action: 'review', prId: input.pr_id, issues: ['PR 不存在'], auditLogged: false },
    };
  }
  if (pr.status !== 'open') {
    return {
      text: `[sofagent] pr_review 失败：PR「${input.pr_id}」状态 ${pr.status} 不可审阅（仅 open 可）`,
      data: { isError: true, action: 'review', prId: input.pr_id, status: pr.status, issues: [`状态 ${pr.status} 不可审阅`], auditLogged: false },
    };
  }
  if (!input.reviewer || (input.verdict !== 'approve' && input.verdict !== 'reject')) {
    return {
      text: '[sofagent] pr_review 失败：缺必填参数（reviewer + verdict=approve|reject）',
      data: { isError: true, action: 'review', prId: input.pr_id, issues: ['缺必填参数'], auditLogged: false },
    };
  }
  // 利益冲突守卫：提交者不可自审（与 'approver-review' 判定语义闭环）
  if (input.reviewer === pr.submitter) {
    return {
      text: `[sofagent] pr_review 失败：reviewer「${input.reviewer}」是 PR「${pr.id}」提交者——利益冲突，提交者不可自审（换非 submitter 审阅）`,
      data: { isError: true, action: 'review', prId: pr.id, issues: ['提交者不可自审（利益冲突）'], auditLogged: false },
    };
  }

  pr.reviewer = input.reviewer;
  pr.reviewNote = input.note;
  pr.updatedAt = new Date().toISOString();

  if (input.verdict === 'approve') {
    pr.status = 'reviewed';
    writePr(dataDir, pr);
    const auditLogged = auditLog(
      'review',
      `PR review approve: ${pr.id}（reviewer=${input.reviewer}${input.note ? ` · ${input.note}` : ''}）`,
      `pr-store/${pr.id}`,
      [`status open→reviewed`],
    );
    return {
      text: `[sofagent] ✅ PR「${pr.id}」审阅通过（reviewed · reviewer=${input.reviewer}）——可 pr_merge`,
      data: { isError: false, action: 'review', prId: pr.id, status: 'reviewed', auditLogged },
    };
  }

  // reject：终态 + 负样本留痕（decision-log——训练信号）
  pr.status = 'rejected';
  writePr(dataDir, pr);
  const auditLogged = auditLog(
    'reject',
    `PR review reject: ${pr.id}「${pr.title}」（reviewer=${input.reviewer}${input.note ? ` · 拒因: ${input.note}` : ''}）——负样本训练信号`,
    `pr-store/${pr.id}`,
    [`status open→rejected（终态）`, `submitter=${pr.submitter}`],
  );
  return {
    text: `[sofagent] ✅ PR「${pr.id}」已拒绝（rejected 终态 · 拒因已进 decision-log 负样本）`,
    data: { isError: false, action: 'review', prId: pr.id, status: 'rejected', auditLogged },
  };
}

export interface PrMergeInput {
  pr_id: string;
  actor: string;
  /** HITL 人审确认（criteria 未过时必须显式 true 才合并；缺省走判定） */
  human_confirmed?: boolean;
}

/**
 * pr_merge——合并（merge_criteria 全过自动；未过走 HITL 挂起）。
 *
 * criteria 判定说明（真判定器，fail-closed）：
 *   - 'approver-review'：reviewer 存在且 ≠ submitter → passed
 *   - 'confidence-min'：detail 形如 'gte:0.7'；triggerBinding 两态映射
 *     （confirmed=1.0 / suggested=0.5 / 无=0）≥ 阈值 → passed；
 *     detail 缺失/畸形 → failed
 *   - 未知 kind → failed（宁可多走 HITL 不可静默放行）
 *   - mergeCriteria 空数组 = 无门槛，直接可合（维持现状）
 *   任一 failed → HITL 挂起分支（human_confirmed=true 才强制合并）
 */
export function prMerge(input: PrMergeInput, dataDir: string): PrResult {
  const pr = readPr(dataDir, input.pr_id);
  if (pr === null) {
    return {
      text: `[sofagent] pr_merge 失败：PR「${input.pr_id}」不存在`,
      data: { isError: true, action: 'merge', prId: input.pr_id, issues: ['PR 不存在'], auditLogged: false },
    };
  }
  if (pr.status !== 'reviewed') {
    return {
      text: `[sofagent] pr_merge 失败：PR「${input.pr_id}」状态 ${pr.status} 不可合并（须先 review approve → reviewed）`,
      data: { isError: true, action: 'merge', prId: input.pr_id, status: pr.status, issues: [`状态 ${pr.status} 不可合并`], auditLogged: false },
    };
  }

  // criteria 真判定（fail-closed——未知 kind/畸形 detail 均判 false）
  const criteriaResults = pr.mergeCriteria.map((c) => ({
    kind: c.kind,
    passed: evaluateCriterion(pr, c),
  }));
  const allPassed = criteriaResults.every((r) => r.passed);

  if (!allPassed && input.human_confirmed !== true) {
    // 未过 + 未确认 → HITL 挂起（不写状态——PR 保持 reviewed 等人）
    return {
      text: `[sofagent] ⚠️ PR「${pr.id}」merge_criteria 未全过——HITL 挂起（human_confirmed=true 强制合并或 reject）`,
      data: { isError: false, action: 'merge', prId: pr.id, status: pr.status, criteriaResults, awaitingHuman: true, auditLogged: false },
    };
  }

  pr.status = 'merged';
  pr.criteriaResults = criteriaResults;
  pr.awaitingHuman = !allPassed && input.human_confirmed === true;
  pr.updatedAt = new Date().toISOString();
  writePr(dataDir, pr);

  const auditLogged = auditLog(
    'merge',
    `PR merge: ${pr.id}「${pr.title}」→ workflow ${pr.workflow_id}（actor=${input.actor}${allPassed ? ' · criteria 全过自动' : ' · HITL 人审强制'}）`,
    `pr-store/${pr.id}`,
    [`status reviewed→merged`, `criteria=${criteriaResults.filter((r) => r.passed).length}/${criteriaResults.length} passed`],
  );

  return {
    text: `[sofagent] ✅ PR「${pr.id}」已合并（merged · workflow=${pr.workflow_id} · criteria ${criteriaResults.filter((r) => r.passed).length}/${criteriaResults.length}）`,
    data: { isError: false, action: 'merge', prId: pr.id, status: 'merged', criteriaResults, auditLogged },
  };
}

/**
 * 启发式重跑保护查询——「suggested 被否决后启发式重跑不复活」的判定依据：
 * rejected PR 若曾有 triggerBinding（任意态），启发式重跑时应跳过该资源。
 */
export function isHeuristicallyBlocked(prs: StoredPr[], workflowId: string): boolean {
  return prs.some(
    (p) => p.workflow_id === workflowId && p.status === 'rejected' && p.triggerBinding !== undefined,
  );
}

// ────────────────────────────────────────────────────────────
// branch→trunk 写回联动支撑（MCP pr_merge 编排消费面）
// ────────────────────────────────────────────────────────────

/**
 * 回填 merged→trunk 后的新版本号（pr_merge 编排联动成功时由 MCP 层调用）。
 * 仅接受 status=merged 的 PR（未合并回填无意义）。
 */
export function prRecordMergedVersion(prId: string, version: number, dataDir: string): PrResult {
  const pr = readPr(dataDir, prId);
  if (pr === null) {
    return {
      text: `[sofagent] pr 回填版本失败：PR「${prId}」不存在`,
      data: { isError: true, action: 'merge', prId, issues: ['PR 不存在'], auditLogged: false },
    };
  }
  if (pr.status !== 'merged') {
    return {
      text: `[sofagent] pr 回填版本失败：PR「${prId}」状态 ${pr.status} 不可回填（仅 merged 可）`,
      data: { isError: true, action: 'merge', prId, status: pr.status, issues: [`状态 ${pr.status} 不可回填`], auditLogged: false },
    };
  }
  if (!Number.isFinite(version) || version < 1) {
    return {
      text: `[sofagent] pr 回填版本失败：version「${String(version)}」非法（须 ≥1 数值）`,
      data: { isError: true, action: 'merge', prId, issues: ['version 非法'], auditLogged: false },
    };
  }

  pr.mergedVersion = version;
  pr.updatedAt = new Date().toISOString();
  writePr(dataDir, pr);

  const auditLogged = auditLog(
    'merge-version',
    `PR merge 版本回填: ${pr.id} → workflow ${pr.workflow_id} trunk v${version}（branch→trunk 写回联动）`,
    `pr-store/${pr.id}`,
    [`mergedVersion=${version}`],
  );

  return {
    text: `[sofagent] ✅ PR「${pr.id}」已回填合并版本（mergedVersion=v${version} · workflow=${pr.workflow_id}）`,
    data: { isError: false, action: 'merge', prId: pr.id, status: 'merged', mergedVersion: version, auditLogged },
  };
}

/**
 * merged→open 回退（branch→trunk 写回失败时由 MCP 层调用回滚 PR 状态）。
 * 回退原因写 revertReason 留痕，decision-log 记审计。
 */
export function prRevertToOpen(prId: string, reason: string, dataDir: string): PrResult {
  const pr = readPr(dataDir, prId);
  if (pr === null) {
    return {
      text: `[sofagent] pr 回退失败：PR「${prId}」不存在`,
      data: { isError: true, action: 'merge', prId, issues: ['PR 不存在'], auditLogged: false },
    };
  }
  if (pr.status !== 'merged') {
    return {
      text: `[sofagent] pr 回退失败：PR「${prId}」状态 ${pr.status} 不可回退（仅 merged 可）`,
      data: { isError: true, action: 'merge', prId, status: pr.status, issues: [`状态 ${pr.status} 不可回退`], auditLogged: false },
    };
  }

  pr.status = 'open';
  pr.revertReason = reason;
  pr.awaitingHuman = undefined;
  pr.mergedVersion = undefined;
  // review 证据保留（reviewer/reviewNote 不清——重走 review 可追溯），
  // 但 criteriaResults 是上次 merge 的判定结论，回退后失效须清
  pr.criteriaResults = undefined;
  pr.updatedAt = new Date().toISOString();
  writePr(dataDir, pr);

  const auditLogged = auditLog(
    'merge-revert',
    `PR merge 回退: ${pr.id} merged→open（branch→trunk 写回失败回滚，原因: ${reason}）`,
    `pr-store/${pr.id}`,
    [`status merged→open`, `reason=${reason}`],
  );

  return {
    text: `[sofagent] ⚠️ PR「${pr.id}」已回退 open（branch→trunk 写回失败：${reason}）——请修复后重走 review→merge`,
    data: { isError: false, action: 'merge', prId: pr.id, status: 'open', auditLogged },
  };
}
