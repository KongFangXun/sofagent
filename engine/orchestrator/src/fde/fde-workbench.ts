// ============================================================
// fde/fde-workbench.ts · v1.4.3 章八 · FDE 工作台核心（六引擎数据层 + 审计留痕）
// ============================================================
//
// 定位：FDE 方法论 1173 行在 FDE/GUIDE.md，但引擎层此前只有 fde_compose
// 一个工具真实现——方法论是文字，Agent 读了手册但没有工作台。本文件
// 是六引擎（interview/classify/quantify/derive/distill/deploy）的共享
// 数据层：data/fde/<企业>/ 专属目录 + 独立 fde-audit 事件留痕。
//
// 数据层布局（devlog 拍板新落点）：
//   data/fde/<enterpriseId>/
//     interview.json        访谈结构化（引擎一）
//     nodes.json            节点方案（引擎二）
//     quantification.json   量化四字段（引擎三）
//     ontology-draft.yaml   本体草稿（引擎四——复用 compose-interview 推导）
//     deliverables/         三层交付物（引擎五）
//     deployments/          部署记录（引擎六）
//     fde-audit.jsonl       六引擎调用留痕（append-only + 链字段）
//
// 独立 fde-audit（team-lead 拍板：不污染 TRAIN_JOB 枚举）：
//   事件模型与 train-audit 同构（prevHash/HMAC 链字段、脱敏铁律），
//   但 type 是 fde_* 域（fde_interview/fde_classify/...）——与训练
//   审计物理分文件，互不污染。
//
// 复用来源：
//   - @sofagent/core：getEnvFingerprint/getHmacKey/stableStringify/
//     atomicWriteSync/atomicAppendSync（与 train-audit 同套）
//   - core REDACTION_PATTERNS：reason 脱敏（与 sanitizeWhy 同规则）
//   - fde/compose-interview：FiveElements/ThreeQuestions/NodeInterview
//     数据模型直接复用（引擎一二不另造模型）
// ============================================================

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash, createHmac } from 'crypto';
import {
  getEnvFingerprint,
  getHmacKey,
  stableStringify,
  atomicWriteSync,
  atomicAppendSync,
  REDACTION_PATTERNS,
} from '@sofagent/core';
import { classifyAutomation, type NodeInterview } from './compose-interview';

// ══════════════════════════════════════
// 数据层布局（data/fde/<企业>/）
// ══════════════════════════════════════

/** FDE 工作台企业目录：data/fde/<enterpriseId>/ */
export function fdeWorkbenchDir(dataDir: string, enterpriseId: string): string {
  return join(dataDir, 'fde', enterpriseId);
}

/** 各引擎产物路径（单一出口——engine 读写都走这里） */
export function fdeWorkbenchPaths(dataDir: string, enterpriseId: string): {
  dir: string;
  interview: string;
  nodes: string;
  quantification: string;
  ontologyDraft: string;
  deliverablesDir: string;
  deploymentsDir: string;
  audit: string;
} {
  const dir = fdeWorkbenchDir(dataDir, enterpriseId);
  return {
    dir,
    interview: join(dir, 'interview.json'),
    nodes: join(dir, 'nodes.json'),
    quantification: join(dir, 'quantification.json'),
    ontologyDraft: join(dir, 'ontology-draft.yaml'),
    deliverablesDir: join(dir, 'deliverables'),
    deploymentsDir: join(dir, 'deployments'),
    audit: join(dir, 'fde-audit.jsonl'),
  };
}

// ══════════════════════════════════════
// 独立 fde-audit 事件（六引擎调用留痕）
// ══════════════════════════════════════

/** fde-audit 事件类型（六引擎 + 读取——独立域，不入 TRAIN_JOB 枚举） */
export type FdeAuditEventType =
  | 'fde_interview'
  | 'fde_classify'
  | 'fde_quantify'
  | 'fde_derive'
  | 'fde_distill'
  | 'fde_deploy';

/** fde-audit 审计条目（fde-audit.jsonl 单行——链字段与 train-audit 同构） */
export interface FdeAuditEntry {
  ts: string;
  type: FdeAuditEventType;
  enterpriseId: string;
  /** 引擎产物路径（interview.json / nodes.json 等） */
  artifact: string;
  /** 操作摘要（已脱敏——人读审计） */
  reason?: string;
  // ── 链字段（与 train-audit / decision-log 同构）──
  prevHash: string;
  hashVersion: 2;
  envFingerprint: string;
  hmacAlgo?: 'stable';
  hmacSig?: string;
  engine: string;
}

/** fde-audit 写入入参 */
export interface EmitFdeAuditInput {
  type: FdeAuditEventType;
  enterpriseId: string;
  artifact: string;
  reason?: string;
}

/** 单字符串脱敏（逐条 REDACTION_PATTERNS——与 train-audit.redactString 同规则） */
function redactString(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * 追加一条 fde-audit 事件（append-only + prevHash 链 + HMAC——与
 * emitTrainAudit 同模式但独立文件独立事件域）。
 *
 * enterpriseId 缺失拒绝写入（企业隔离审计规则与训练审计对齐）。
 */
export function emitFdeAudit(input: EmitFdeAuditInput, dataDir: string): FdeAuditEntry {
  const validTypes: readonly FdeAuditEventType[] = [
    'fde_interview',
    'fde_classify',
    'fde_quantify',
    'fde_derive',
    'fde_distill',
    'fde_deploy',
  ];
  if (!validTypes.includes(input.type)) {
    throw new Error(`[fde-audit] 非法事件类型 "${String(input.type)}"——fde_* 域六事件`);
  }
  if (typeof input.enterpriseId !== 'string' || input.enterpriseId.trim() === '') {
    throw new Error('[fde-audit] enterpriseId 必填（缺失拒绝写入——企业隔离审计规则）');
  }

  const { audit, dir } = fdeWorkbenchPaths(dataDir, input.enterpriseId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const fingerprint = getEnvFingerprint(dataDir);

  // prevHash（读末行——与 train-audit 同语义）
  let prevHash = 'genesis';
  if (existsSync(audit)) {
    try {
      const lines = readFileSync(audit, 'utf-8').trim().split('\n').filter(Boolean);
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        const lastEntry = JSON.parse(lastLine) as FdeAuditEntry;
        const recordForHash = { ...lastEntry, prevHash: undefined, hashVersion: undefined };
        prevHash = createHash('sha256')
          .update(JSON.stringify(recordForHash) + '|' + fingerprint)
          .digest('hex')
          .slice(0, 16);
      }
    } catch {
      prevHash = 'unknown';
    }
  }

  const hmacKey = getHmacKey();
  const base: FdeAuditEntry = {
    ts: new Date().toISOString(),
    type: input.type,
    enterpriseId: input.enterpriseId,
    artifact: input.artifact,
    ...(input.reason !== undefined ? { reason: redactString(input.reason) } : {}),
    prevHash,
    hashVersion: 2,
    envFingerprint: fingerprint,
    hmacAlgo: hmacKey ? 'stable' : undefined,
    engine: 'sofagent-fde-workbench',
  };
  const recordForSig = {
    ...base,
    prevHash: undefined,
    hashVersion: undefined,
    hmacSig: undefined,
    hmacAlgo: undefined,
  };
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey)
        .update(stableStringify(recordForSig) + '|' + fingerprint)
        .digest('hex')
        .slice(0, 32)
    : undefined;

  const entry: FdeAuditEntry = { ...base, ...(hmacSig ? { hmacSig } : {}) };
  atomicAppendSync(audit, JSON.stringify(entry));
  return entry;
}

/** 回读 fde-audit 全部条目（坏行跳过） */
export function readFdeAudit(dataDir: string, enterpriseId: string): FdeAuditEntry[] {
  const { audit } = fdeWorkbenchPaths(dataDir, enterpriseId);
  if (!existsSync(audit)) return [];
  const out: FdeAuditEntry[] = [];
  for (const line of readFileSync(audit, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as FdeAuditEntry);
    } catch {
      // 坏行跳过（查询侧容错——与 readTrainAudit 同语义）
    }
  }
  return out;
}

// ══════════════════════════════════════
// 引擎一：fde_interview 访谈结构化落盘
// ══════════════════════════════════════

/** 访谈记录（引擎一产物——interview.json） */
export interface InterviewRecord {
  schemaVersion: 'v1';
  enterpriseId: string;
  /** 访谈轮次（多轮追加——按 nodeId 幂等合并） */
  rounds: Array<{
    interviewedAt: string;
    /** 本轮访谈节点（结构化五要素——NodeInterview 复用） */
    nodes: NodeInterview[];
  }>;
  /** 企业画像（自动生成——节点聚合视角） */
  profile: {
    /** 已梳理节点数 */
    nodeCount: number;
    /** 岗位分布（owner 去重计数） */
    roles: string[];
    /** 总耗时（各节点 duration 原文汇总口径——人读） */
    totalDurationNote: string;
    /** 高频痛点关键词（提取自 bottleneck） */
    painKeywords: string[];
    updatedAt: string;
  };
}

/** 访谈追问话术（GUIDE 第二章 五要素深挖——引导 FDE 问对问题）
 * 五要素之外附第 6 条「实际流程」话术——名义流程 ≠ 实际流程（GUIDE §2.3.2），
 * 关键节点须让执行者打开真实系统走一遍，旁路处才是自动化的真实依据。 */
export function interviewPrompts(): Array<{ field: string; question: string }> {
  return [
    { field: '输入', question: '这一步的输入是什么？从哪来的？（系统导出 / 人工整理 / 邮件附件）' },
    { field: '输出', question: '产出什么？给谁用？（格式 / 频率 / 下游是谁）' },
    { field: '负责人', question: '谁在负责这个环节？什么岗位？大概几个人？' },
    { field: '耗时', question: '每次做要多久？多久做一次？（分钟 / 小时 / 天）' },
    { field: '最卡的地方', question: '这一步最烦最卡的是什么？如果只能自动化一件事，你最想解决哪个？' },
    { field: '实际流程', question: '能不能现场带我走一遍最近一个真实案例？（不听 SOP 口述——看复制粘贴/私人表格/群内确认等真实旁路）' },
  ];
}

/**
 * 引擎一：访谈结构化落盘（多轮追加 + profile 自动重算 + 审计留痕）。
 *
 * 节点按 nodeId 幂等合并（重访谈覆盖旧记录）——同一工作流多轮访谈
 * 不重复计数。
 */
export function recordInterview(
  dataDir: string,
  enterpriseId: string,
  nodes: NodeInterview[],
  options: { now?: () => number } = {},
): InterviewRecord {
  const now = options.now ?? Date.now;
  const paths = fdeWorkbenchPaths(dataDir, enterpriseId);

  // 回读既有记录（多轮追加）
  let record: InterviewRecord;
  if (existsSync(paths.interview)) {
    try {
      record = JSON.parse(readFileSync(paths.interview, 'utf-8')) as InterviewRecord;
    } catch {
      record = emptyInterview(enterpriseId);
    }
  } else {
    record = emptyInterview(enterpriseId);
  }

  // 本轮并入（nodeId 幂等——后到覆盖）
  const merged = new Map<string, NodeInterview>();
  for (const round of record.rounds) {
    for (const n of round.nodes) merged.set(n.nodeId, n);
  }
  for (const n of nodes) merged.set(n.nodeId, n);
  record.rounds.push({ interviewedAt: new Date(now()).toISOString(), nodes });

  // profile 重算（聚合视角）
  const all = [...merged.values()];
  record.profile = {
    nodeCount: all.length,
    roles: [...new Set(all.map((n) => n.elements.owner))],
    totalDurationNote: all.map((n) => `${n.nodeId}:${n.elements.duration}`).join(' + '),
    painKeywords: extractPainKeywords(all),
    updatedAt: new Date(now()).toISOString(),
  };

  mkdirSync(paths.dir, { recursive: true });
  atomicWriteSync(paths.interview, JSON.stringify(record, null, 2));
  emitFdeAudit(
    {
      type: 'fde_interview',
      enterpriseId,
      artifact: paths.interview,
      reason: `访谈落盘：本轮 ${nodes.length} 节点，累计 ${all.length} 节点 / ${record.profile.roles.length} 岗位`,
    },
    dataDir,
  );
  return record;
}

/** 痛点关键词提取（bottleneck 高频词——profile 消费） */
function extractPainKeywords(nodes: readonly NodeInterview[]): string[] {
  const keywords = ['重复', '手工', '等待', '核对', '格式', '汇总', '抄录', '催', '对不上', '漏'];
  const counts = new Map<string, number>();
  for (const n of nodes) {
    for (const kw of keywords) {
      if (n.elements.bottleneck.includes(kw)) counts.set(kw, (counts.get(kw) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([kw]) => kw);
}

function emptyInterview(enterpriseId: string): InterviewRecord {
  return {
    schemaVersion: 'v1',
    enterpriseId,
    rounds: [],
    profile: { nodeCount: 0, roles: [], totalDurationNote: '', painKeywords: [], updatedAt: '' },
  };
}

// ══════════════════════════════════════
// 引擎二：fde_classify 三问判定 → 节点方案
// ══════════════════════════════════════

/** 节点方案条目（引擎二产物——nodes.json） */
export interface NodePlan {
  nodeId: string;
  description: string;
  /** 判定标签（🔄 auto / ⚡ enhance / 👤 manual——classifyAutomation 复算） */
  tag: 'auto' | 'enhance' | 'manual';
  /** 三问答案快照（判定依据——审计可回查为什么是这个标签） */
  questions: { inputAutomatable: boolean; rulesCodifiable: boolean; outputPredictable: boolean };
  /** 最小工作单元切分（六步分解法——GUIDE §3.2：能一句说清的最小单元） */
  minimalUnits: string[];
  /** AI 节点 or Human 节点 */
  executor: 'ai' | 'human';
}

/** 节点方案文件（nodes.json） */
export interface NodesPlanFile {
  schemaVersion: 'v1';
  enterpriseId: string;
  /** 判定时间 */
  classifiedAt: string;
  plans: NodePlan[];
  /** 判定汇总（决策面一眼看全貌） */
  summary: { auto: number; enhance: number; manual: number };
}

/** 六步分解法（GUIDE §3.2——切最小工作单元的引导模板） */
export function sixStepDecomposition(elements: {
  input: string;
  output: string;
  bottleneck: string;
}): string[] {
  return [
    `① 接收输入：${elements.input}`,
    '② 理解/校验输入（格式与完整性）',
    `③ 核心转换：${elements.bottleneck}（最卡处——优先 AI 化候选）`,
    '④ 结果自检（规则可校验的部分）',
    `⑤ 产出：${elements.output}`,
    '⑥ 交付下游（通知/归档/流转）',
  ];
}

/**
 * 引擎二：三问判定 → 节点方案（复用 classifyAutomation 逻辑——不重写
 * 判定规则，SSOT 在 compose-interview）。
 *
 * 入参为访谈节点（NodeInterview）；产物 nodes.json + 审计留痕。
 */
export function classifyNodes(
  dataDir: string,
  enterpriseId: string,
  nodes: readonly NodeInterview[],
  options: { now?: () => number; classifyFn?: (q: NodeInterview['questions']) => 'auto' | 'enhance' | 'manual' } = {},
): NodesPlanFile {
  const now = options.now ?? Date.now;
  const classify = options.classifyFn ?? classifyAutomation;
  const paths = fdeWorkbenchPaths(dataDir, enterpriseId);

  const plans: NodePlan[] = nodes.map((n) => {
    const tag = classify(n.questions);
    return {
      nodeId: n.nodeId,
      description: n.description,
      tag,
      questions: n.questions,
      minimalUnits: sixStepDecomposition(n.elements),
      executor: tag === 'manual' ? 'human' : 'ai',
    };
  });

  const file: NodesPlanFile = {
    schemaVersion: 'v1',
    enterpriseId,
    classifiedAt: new Date(now()).toISOString(),
    plans,
    summary: {
      auto: plans.filter((p) => p.tag === 'auto').length,
      enhance: plans.filter((p) => p.tag === 'enhance').length,
      manual: plans.filter((p) => p.tag === 'manual').length,
    },
  };
  mkdirSync(paths.dir, { recursive: true });
  atomicWriteSync(paths.nodes, JSON.stringify(file, null, 2));
  emitFdeAudit(
    {
      type: 'fde_classify',
      enterpriseId,
      artifact: paths.nodes,
      reason: `判定 ${plans.length} 节点：🔄${file.summary.auto} ⚡${file.summary.enhance} 👤${file.summary.manual}`,
    },
    dataDir,
  );
  return file;
}
