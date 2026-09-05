// ============================================================
// evolution/tool-evolution.ts · L4 工具层自进化管线（v1.4.5 第七章三）
//
// 五层谱系（PHILOSOPHY §五）中唯一空白层 L4 的落地：
//   Agent 自写工具 → SkillScan 安全门 → 人审 promote → 注册进工具箱
//
// 管线四步（PHILOSOPHY「L4 必须过安全门」的工程化）：
//   一、候选：高频工具候选来自持续采样统计（evolution-samples.ts 的
//       toolCandidatesFromSamples——复用章八采样，不另起统计面）
//   二、扫描：Agent 自写工具的源码目录过 scanForInstall（复用 v1.3.7
//       SkillScan 集成层——DANGEROUS 拦截 / SUSPICIOUS 人审 / SAFE 放行，
//       不新写扫描逻辑）
//   三、人审：pending → approved 两态审批（最小实现——审批记录落盘
//       data/evolution/tool-evolution.jsonl，append-only；无人审确认不注册）
//   四、注册：批准的候选登记进「进化工具注册表」（pending/approved 全量
//       台账），MCP 层消费 getApprovedEvolvedTools() 注册进动态工具面
//       （getDynamicTools——默认空、运行时注册）
//
// ⚠️ 工具数口径（任务书铁律）：L4 注册工具走动态面，**不进 83 静态计数**
//   （check-version 只数 tool-registry.ts 顶层 name）；tools/list 实际
//   返回数 = 83 + 动态注册数。该口径写在 MCP 层桥接文件，此处只管台账。
//
// 审计：提名/审批/注册三动作全走 emitDecision（kind=EVOLUTION——
// 与 instinct→skill、rule-promote 同类：经验层进化）。
//
// 接口签名（spec-first）：
//   nominateToolCandidate(input, dataDir?): NominateResult        步骤一+二（候选+扫描）
//   reviewToolCandidate(input, dataDir?): ReviewResult            步骤三（人审 pending→approved/rejected）
//   registerApprovedTool(candidateId, dataDir?): RegisterResult   步骤四（批准→注册态）
//   getApprovedEvolvedTools(dataDir?): EvolvedToolRuntime[]       MCP 消费（动态面注册源）
//   listToolEvolutionLedger(dataDir?): ToolEvolutionEntry[]       台账全量（审计/报告用）
//   TOOL_STATUS_FLOW: 常量状态机（pending→scanned→approved→registered / rejected）
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';
import { scanForInstall } from '../commons/skill-scan';
import type { ToolCandidate } from './evolution-samples';

// ────────────────────────────────────────────────────────────
// 状态机与类型
// ────────────────────────────────────────────────────────────

/** 候选生命周期（单向：pending→scanned→approved→registered；任意态→rejected） */
export type ToolCandidateStatus =
  | 'pending' // 已提名（含采样证据），未扫描
  | 'scanned' // SkillScan 已过（SAFE 或 SUSPICIOUS+人审待决），待人审
  | 'approved' // 人审批准，待注册
  | 'registered' // 已注册进工具箱（MCP 动态面可消费）
  | 'rejected'; // 被拒（SkillScan DANGEROUS / 人审驳回——教训保留）

/** 状态机合法流转表（守卫：非法流转拒绝） */
export const TOOL_STATUS_FLOW: Record<ToolCandidateStatus, ToolCandidateStatus[]> = {
  pending: ['scanned', 'rejected'],
  scanned: ['approved', 'rejected'],
  approved: ['registered', 'rejected'],
  registered: ['rejected'], // 注册后仍可下架（rejected 语义=收回）
  rejected: [],
};

/** 台账单条记录（append-only——data/evolution/tool-evolution.jsonl） */
export interface ToolEvolutionEntry {
  /** 候选 ID（slug——提名时生成） */
  candidateId: string;
  /** 工具名（动态注册名——snake_case） */
  toolName: string;
  /** 工具描述（tools/list 展示） */
  description: string;
  /** Agent 自写工具源码目录（SkillScan 目标） */
  sourcePath: string;
  /** 采样证据（高频统计快照——溯源到章八样本） */
  evidence: {
    invokeCount: number;
    heat: number;
    hint?: string;
  };
  /** 当前状态 */
  status: ToolCandidateStatus;
  /** SkillScan 判定（SAFE/SUSPICIOUS/DANGEROUS） */
  scanVerdict?: string;
  /** 人审信息（approved/rejected 时有） */
  review?: {
    reviewer: string;
    verdict: 'approved' | 'rejected';
    comment?: string;
    reviewedAt: string;
  };
  /** 注册信息（registered 时有——动态面 handler 的生成器调用形态） */
  registration?: {
    generatorModule: string;
    generatorExport: string;
    registeredAt: string;
  };
  /** 提名时间 ISO */
  nominatedAt: string;
  /** 最后更新时间 ISO */
  updatedAt: string;
}

/** 注册态工具的运行时形态（MCP 动态面消费） */
export interface EvolvedToolRuntime {
  /** 动态工具名（与 toolName 一致） */
  name: string;
  /** 描述 */
  description: string;
  /** 入参 schema（JSON Schema object 形态——动态面透传） */
  inputSchema: Record<string, unknown>;
  /** 生成器模块路径（require 解析——MCP 层动态加载执行） */
  generatorModule: string;
  /** 生成器导出名（缺省 default） */
  generatorExport: string;
  /** 溯源候选 ID */
  candidateId: string;
}

// ────────────────────────────────────────────────────────────
// 台账持久化（append-only jsonl）
// ────────────────────────────────────────────────────────────

/** 台账路径 */
export function resolveToolEvolutionLedgerPath(dataDir?: string): string {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, 'evolution', 'tool-evolution.jsonl');
}

/**
 * 读台账全量（按 candidateId 聚合取最新态——append-only 的读侧合并语义，
 * 与 commons catalog 读 manifest 同款模式）。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function listToolEvolutionLedger(dataDir?: string): ToolEvolutionEntry[] {
  const path = resolveToolEvolutionLedgerPath(dataDir);
  if (!existsSync(path)) return [];
  let content = '';
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const byId = new Map<string, ToolEvolutionEntry>();
  for (const line of content.trim().split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line) as ToolEvolutionEntry;
      if (typeof entry.candidateId === 'string') byId.set(entry.candidateId, entry);
    } catch {
      // 跳过（append-only 不阻断）
    }
  }
  return Array.from(byId.values());
}

/** 追加一条台账记录 */
function appendLedgerEntry(entry: ToolEvolutionEntry, dataDir?: string): void {
  const path = resolveToolEvolutionLedgerPath(dataDir);
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(entry) + '\n', { flag: 'a' });
}

// ────────────────────────────────────────────────────────────
// 管线一：提名（候选 + SkillScan 安全扫描）
// ────────────────────────────────────────────────────────────

/** 提名入参 */
export interface NominateInput {
  /** 采样统计出的候选（来自 toolCandidatesFromSamples——真实采样数据） */
  candidate: ToolCandidate;
  /** Agent 自写工具源码目录（含 SKILL.md/生成器——SkillScan 目标） */
  sourcePath: string;
  /** 工具描述 */
  description: string;
  /** 提名者 agentId */
  nominatedBy: string;
  /** 候选 ID（缺省按 toolName 生成 slug） */
  candidateId?: string;
}

/** 提名结果 */
export interface NominateResult {
  ok: boolean;
  candidateId?: string;
  /** 扫描后状态：SAFE→scanned / SUSPICIOUS→scanned（人审必经）/ DANGEROUS→rejected */
  status: ToolCandidateStatus;
  scanVerdict?: string;
  scanReason?: string;
  reason?: string;
}

/**
 * 管线步骤一+二：提名候选并过 SkillScan 安全扫描。
 *
 * - SAFE → status=scanned（人审仍必经——L4 铁律：人审 promote 不可跳过）
 * - SUSPICIOUS → status=scanned（人审时附风险提示）
 * - DANGEROUS → status=rejected（直接落账——被拒教训保留）
 *
 * 审计：kind=EVOLUTION（提名即进化动作）。
 *
 * @param input 提名入参
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function nominateToolCandidate(input: NominateInput, dataDir?: string): NominateResult {
  const now = new Date().toISOString();
  const candidateId = input.candidateId ?? `l4-${input.candidate.toolName.replace(/[^a-z0-9-]/g, '')}`;

  if (!input.candidate.toolName || !input.sourcePath || !input.description) {
    return { ok: false, status: 'pending', reason: 'toolName/sourcePath/description 必填' };
  }

  // 步骤二：SkillScan（复用 v1.3.7 集成层——不新写扫描逻辑）
  const scan = scanForInstall(input.sourcePath, candidateId);
  const status: ToolCandidateStatus = scan.verdict === 'DANGEROUS' ? 'rejected' : 'scanned';

  const entry: ToolEvolutionEntry = {
    candidateId,
    toolName: input.candidate.toolName,
    description: input.description,
    sourcePath: input.sourcePath,
    evidence: {
      invokeCount: input.candidate.invokeCount,
      heat: input.candidate.heat,
      ...(input.candidate.hint ? { hint: input.candidate.hint } : {}),
    },
    status,
    scanVerdict: scan.verdict,
    nominatedAt: now,
    updatedAt: now,
  };
  appendLedgerEntry(entry, dataDir);

  // 审计（提名+扫描判定——被拒也是有效进化记录）
  try {
    emitDecision({
      agentId: input.nominatedBy,
      sessionId: `l4-nominate-${candidateId}`,
      kind: 'EVOLUTION',
      moment: 'EVOLVE',
      why: {
        text: `L4 自写工具候选「${input.candidate.toolName}」提名（热度 ${Math.round(input.candidate.heat)}，调用量 ${input.candidate.invokeCount}）→ SkillScan ${scan.verdict}`,
        tags: ['evolution', 'l4-tool', 'nominate', scan.verdict.toLowerCase()],
        confidence: scan.verdict === 'DANGEROUS' ? 'high' : 'med',
      },
      artifactRef: input.sourcePath,
      evidence: [
        `scan: ${scan.verdict}`,
        `invoke-count: ${input.candidate.invokeCount}`,
        `heat: ${Math.round(input.candidate.heat * 100) / 100}`,
        ...(scan.details ?? []).slice(0, 5),
      ],
    }, dataDir);
  } catch (err) {
    process.stderr.write(
      `[tool-evolution] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return {
    ok: status !== 'rejected',
    candidateId,
    status,
    scanVerdict: scan.verdict,
    scanReason: scan.reason,
    ...(status === 'rejected' ? { reason: `SkillScan 拦截: ${scan.reason}` } : {}),
  };
}

// ────────────────────────────────────────────────────────────
// 管线二：人审（pending/scanned → approved / rejected）
// ────────────────────────────────────────────────────────────

/** 人审入参 */
export interface ReviewInput {
  candidateId: string;
  /** 审批人（人审者身份——落审批记录） */
  reviewer: string;
  verdict: 'approved' | 'rejected';
  /** 审批备注 */
  comment?: string;
}

/** 人审结果 */
export interface ReviewResult {
  ok: boolean;
  status: ToolCandidateStatus;
  reason?: string;
}

/**
 * 管线步骤三：人审 promote（pending→approved 两态最小实现）。
 *
 * 合法输入态：pending / scanned（提名后任意未注册态都可人审）；
 * registered 态不可再审（已上线——走 rejected 收回语义）。
 *
 * 审批记录落台账（review 字段——谁批的/何时/批注），被拒候选
 * 教训保留（status=rejected 不删除——与 skill-impact 台账同理）。
 *
 * @param input 人审入参
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function reviewToolCandidate(input: ReviewInput, dataDir?: string): ReviewResult {
  const ledger = listToolEvolutionLedger(dataDir);
  const entry = ledger.find((e) => e.candidateId === input.candidateId);
  if (!entry) {
    return { ok: false, status: 'pending', reason: `候选「${input.candidateId}」不存在（先提名）` };
  }
  if (entry.status === 'registered') {
    return { ok: false, status: 'registered', reason: '已注册候选不可再审（收回走 rejected 流转）' };
  }
  if (entry.status === 'rejected') {
    return { ok: false, status: 'rejected', reason: '已拒绝候选终态（重新提名走新 candidateId）' };
  }

  const now = new Date().toISOString();
  const nextStatus: ToolCandidateStatus = input.verdict === 'approved' ? 'approved' : 'rejected';
  appendLedgerEntry(
    {
      ...entry,
      status: nextStatus,
      review: {
        reviewer: input.reviewer,
        verdict: input.verdict,
        ...(input.comment ? { comment: input.comment } : {}),
        reviewedAt: now,
      },
      updatedAt: now,
    },
    dataDir,
  );

  // 审计（人审是 L4 铁律动作——独立记一笔）
  try {
    emitDecision({
      agentId: input.reviewer,
      sessionId: `l4-review-${input.candidateId}`,
      kind: 'EVOLUTION',
      moment: 'EVOLVE',
      why: {
        text: `L4 自写工具候选「${entry.toolName}」人审 ${input.verdict}${entry.scanVerdict === 'SUSPICIOUS' ? '（SkillScan SUSPICIOUS——人审风险确认）' : ''}`,
        tags: ['evolution', 'l4-tool', 'review', input.verdict],
        confidence: 'high',
      },
      artifactRef: entry.candidateId,
      evidence: [
        `scan: ${entry.scanVerdict ?? 'n/a'}`,
        `reviewer: ${input.reviewer}`,
        ...(input.comment ? [`comment: ${input.comment}`] : []),
      ],
    }, dataDir);
  } catch (err) {
    process.stderr.write(
      `[tool-evolution] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return { ok: true, status: nextStatus };
}

// ────────────────────────────────────────────────────────────
// 管线三：注册（approved → registered）
// ────────────────────────────────────────────────────────────

/** 注册入参 */
export interface RegisterInput {
  candidateId: string;
  /** 生成器模块路径（require 可解析——MCP 动态面执行入口） */
  generatorModule: string;
  /** 生成器导出名（缺省 'default'） */
  generatorExport?: string;
  /** 入参 schema（JSON Schema object——缺省宽松空 schema） */
  inputSchema?: Record<string, unknown>;
}

/** 注册结果 */
export interface RegisterResult {
  ok: boolean;
  status: ToolCandidateStatus;
  reason?: string;
}

/**
 * 管线步骤四：批准候选注册进工具箱（台账置 registered）。
 *
 * 注册态候选由 MCP 层的进化动态桥（getApprovedEvolvedTools 消费方）
 * 在 tools/list 时合并进动态面——**不进 83 静态计数**。
 *
 * @param input 注册入参
 * @param dataDir 可选的数据目录覆盖（测试用）
 */
export function registerApprovedTool(input: RegisterInput, dataDir?: string): RegisterResult {
  const ledger = listToolEvolutionLedger(dataDir);
  const entry = ledger.find((e) => e.candidateId === input.candidateId);
  if (!entry) {
    return { ok: false, status: 'pending', reason: `候选「${input.candidateId}」不存在` };
  }
  if (entry.status !== 'approved') {
    return { ok: false, status: entry.status, reason: `候选状态 ${entry.status} 非 approved（人审先行）` };
  }
  if (!input.generatorModule) {
    return { ok: false, status: entry.status, reason: 'generatorModule 必填（动态面执行入口）' };
  }

  const now = new Date().toISOString();
  appendLedgerEntry(
    {
      ...entry,
      status: 'registered',
      registration: {
        generatorModule: input.generatorModule,
        generatorExport: input.generatorExport ?? 'default',
        registeredAt: now,
      },
      updatedAt: now,
    },
    dataDir,
  );

  // 审计（注册=上线动作）
  try {
    emitDecision({
      agentId: 'l4-tool-register',
      sessionId: `l4-register-${input.candidateId}`,
      kind: 'EVOLUTION',
      moment: 'EVOLVE',
      why: {
        text: `L4 自写工具「${entry.toolName}」注册进工具箱（动态面——不进 83 静态计数）`,
        tags: ['evolution', 'l4-tool', 'register'],
        confidence: 'high',
      },
      artifactRef: entry.candidateId,
      evidence: [
        `generator: ${input.generatorModule}#${input.generatorExport ?? 'default'}`,
        `scan: ${entry.scanVerdict ?? 'n/a'}`,
        `reviewer: ${entry.review?.reviewer ?? 'n/a'}`,
        `invoke-count: ${entry.evidence.invokeCount}`,
      ],
    }, dataDir);
  } catch (err) {
    process.stderr.write(
      `[tool-evolution] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return { ok: true, status: 'registered' };
}

// ────────────────────────────────────────────────────────────
// MCP 消费接口：注册态工具 → 动态面运行时形态
// ────────────────────────────────────────────────────────────

/**
 * 取全部注册态候选（MCP 动态桥消费）。
 *
 * ⚠️ 口径：这里返回的是 L4 运行时注册源——MCP 层将其注册进
 * getDynamicTools() 动态面；**83 静态计数（tool-registry.ts 顶层
 * name）不含这些工具**，tools/list 实际返回数 = 83 + 动态注册数。
 *
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 注册态候选的运行时形态（缺省空数组——动态面默认空）
 */
export function getApprovedEvolvedTools(dataDir?: string): EvolvedToolRuntime[] {
  return listToolEvolutionLedger(dataDir)
    .filter((e) => e.status === 'registered' && e.registration)
    .map((e) => ({
      name: e.toolName,
      description: e.description,
      // 宽松 schema 缺省（无 schema 声明的生成器按任意入参调用）
      inputSchema: {
        type: 'object',
        properties: {},
        ...(e.description ? {} : {}),
      },
      generatorModule: e.registration!.generatorModule,
      generatorExport: e.registration!.generatorExport,
      candidateId: e.candidateId,
    }));
}
