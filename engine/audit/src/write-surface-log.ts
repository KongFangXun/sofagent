// ============================================================
// write-surface-log.ts · 自进化写面变更留痕（prompt / memory 两契约 · v1.5.9 章一）
// ============================================================
//
// ── 这一件解决什么 —— RSI 治理最大的盲区 ──
// 审计地基是「不信任自我报告，只看硬证据」。但 RSI 的四个可写面里，权重面
// （v1.4.4 manifest + sha256 验签）与 skill 面（eval-gate + 执行时快照）已有覆盖，
// **prompt 面与 memory 面完全在审计视野外**：Agent 改了自己的 system prompt、往记忆里
// 写了一条「经验」，不留任何可举证的变更记录。本节把这两类非代码写面纳入审计：
//
//   ① 两类写面各定义 diff 契约（第三通道，与 git diff 并列）：
//      · prompt 面（SKILL.md / fde.md / overrides 配置变更）——**字段级** before/after
//      · memory 面（think.md / knowledge / 记忆事实写入）——**条目级** 新增 / 修订 / 失效
//   ② 每次变更落一条可举证记录：变更前后值摘要 + 发起人（Agent 实例 id / 人）+
//      触发来源（自我改进 / 人工 / 系统）+ 时间戳
//   ③ HMAC 挂链——**复用 engine/audit 既有链内核 chain-kernel.appendChained**（不自造协议）
//   ④ 写面 diff 作**第三通道**接入既有规则：转换成既有规则的输入面（DiffFile）即可，
//      **规则判定逻辑零改动，只扩输入面**（对齐 v1.5.1 双通道的同款纪律）
//   ⑤ 举证导出——导出 bundle 与 JSONL，第三方无需安装 sofagent 即可独立验签
//      （对齐 v1.5.2 章二 verify-chain.mjs 的独立验签语义）
//
// ── 与 core 侧钩子的接线缝 ──
// core（loadchain-write-hook.ts / memory-store.ts）经 setWriteSurfaceTracer 注入本模块
// 提供的 sink（{@link createWriteSurfaceTracer}）——core 不依赖 audit，留痕的实现留在
// audit 侧（本节），故「保护面看得见写面」而不成环。
//
// ── 举证链协议 SSOT ──
// 链字段（prevHash / hashVersion / envFingerprint / hmacAlgo / hmacSig）与签名算法
// **完全由 chain-kernel 承载**——本模块不重写一行链协议。故 tools/verify/verify-chain.mjs
// （零依赖独立验签器）可直接对本模块导出的 write-surface.jsonl 重算验签。
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  getDecisionLogPath,
  getEnvFingerprint,
  getHmacKey,
  assertTestEnvNotWritingRealData,
  type DiffFile,
} from '@sofagent/core';
import {
  appendChained,
  verifyChain,
  type ChainCheckResult,
  type ChainFields,
} from './chain-kernel';

// ════════════════════════════════════════
// 一、两类写面契约
// ════════════════════════════════════════

/** 写面名（prompt 面 / memory 面） */
export const WRITE_SURFACES = ['prompt', 'memory'] as const;
export type WriteSurface = (typeof WRITE_SURFACES)[number];

/** 触发来源三分类 */
export const WRITE_SURFACE_ORIGINS = ['self-improvement', 'human', 'system'] as const;
export type WriteSurfaceOrigin = (typeof WRITE_SURFACE_ORIGINS)[number];

/** 写面记录 kind（链内核 validKinds——按写面分 kind，便于独立验签器分面统计） */
export const WRITE_SURFACE_KINDS = ['prompt-write', 'memory-write'] as const;
export type WriteSurfaceKind = (typeof WRITE_SURFACE_KINDS)[number];

/** prompt 面单字段变更（字段级 before/after） */
export interface PromptFieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

/**
 * prompt 面 diff 契约——**字段级** before/after。
 * 覆盖 SKILL.md / fde.md / overrides 的配置字段变更（加载链四层配置面）。
 */
export interface PromptFieldDiff {
  mode: 'field-level';
  changes: PromptFieldChange[];
}

/** memory 面条目操作：新增 / 修订 / 失效 */
export const MEMORY_ENTRY_OPS = ['add', 'revise', 'invalidate'] as const;
export type MemoryEntryOp = (typeof MEMORY_ENTRY_OPS)[number];

/**
 * memory 面 diff 契约——**条目级** 新增 / 修订 / 失效。
 * 覆盖 think.md / knowledge / 记忆事实（per-fact Markdown）的条目变更。
 */
export interface MemoryEntryDiff {
  mode: 'entry-level';
  op: MemoryEntryOp;
  entryKey: string;
  before: string | null;
  after: string | null;
}

/** 写面 diff（两类契约的联合） */
export type WriteSurfaceDiff = PromptFieldDiff | MemoryEntryDiff;

// ════════════════════════════════════════
// 二、变更记录与契约校验
// ════════════════════════════════════════

/** 写面变更入参（调用方 → 记录） */
export interface WriteSurfaceChangeInput {
  surface: WriteSurface;
  /** 变更落点（配置面 = 层名/文件名；记忆面 = 事实 key） */
  target: string;
  /** 发起人（Agent 实例 id / 人） */
  actor: string;
  /** 触发来源 */
  origin: WriteSurfaceOrigin;
  /** 写面 diff（须匹配 surface 对应契约） */
  diff: WriteSurfaceDiff;
  /** 触发本次写面的晋级 / 考核记录引用（与改进链绑定） */
  refTrace?: string;
  ts?: string;
  traceId?: string;
}

/** 写面业务记录（不含链字段） */
export interface WriteSurfaceRecord {
  ts: string;
  kind: WriteSurfaceKind;
  surface: WriteSurface;
  target: string;
  actor: string;
  origin: WriteSurfaceOrigin;
  diff: WriteSurfaceDiff;
  /** 变更摘要（人类可读，举证面一眼可读） */
  summary: string;
  /** 本次变更追踪 id */
  traceId: string;
  /** 与改进链绑定（可选） */
  refTrace?: string;
  engine: 'sofagent audit';
}

/** 落盘的写面链条目（业务字段 + 链字段） */
export type WriteSurfaceEntry = WriteSurfaceRecord & ChainFields;

/** 写面契约违规（surface 与 diff 形态不匹配） */
export class WriteSurfaceContractError extends Error {
  constructor(message: string) {
    super(`[write-surface] ${message}`);
    this.name = 'WriteSurfaceContractError';
  }
}

/** 写面记录写入失败（校验 / 挂链失败——向上传播，绝不静默丢弃） */
export class WriteSurfaceWriteError extends Error {
  constructor(message: string, cause?: unknown) {
    super(`[write-surface] 写入失败: ${message}${cause instanceof Error ? `（${cause.message}）` : ''}`);
    this.name = 'WriteSurfaceWriteError';
  }
}

/** surface → kind */
export function kindForSurface(surface: WriteSurface): WriteSurfaceKind {
  return surface === 'prompt' ? 'prompt-write' : 'memory-write';
}

/**
 * 契约校验：diff 形态必须与 surface 匹配（prompt ⇒ 字段级；memory ⇒ 条目级）。
 * 违规 ⇒ 抛 {@link WriteSurfaceContractError}（fail-closed，不落链）。
 */
export function assertDiffContract(surface: WriteSurface, diff: WriteSurfaceDiff): void {
  if (surface === 'prompt') {
    if (diff.mode !== 'field-level') {
      throw new WriteSurfaceContractError(
        `prompt 面 diff 契约要求「字段级」（mode='field-level'），实收 mode='${diff.mode}'——` +
          `配置面按字段级 before/after 记录（SKILL.md / fde.md / overrides 字段）`,
      );
    }
    if (!Array.isArray((diff as PromptFieldDiff).changes)) {
      throw new WriteSurfaceContractError('prompt 面 diff 缺 changes 数组');
    }
  } else if (surface === 'memory') {
    if (diff.mode !== 'entry-level') {
      throw new WriteSurfaceContractError(
        `memory 面 diff 契约要求「条目级」（mode='entry-level'），实收 mode='${diff.mode}'——` +
          `记忆面按条目级 新增/修订/失效 记录（think.md / knowledge / 记忆事实）`,
      );
    }
    const op = (diff as MemoryEntryDiff).op;
    if (!(MEMORY_ENTRY_OPS as readonly string[]).includes(op)) {
      throw new WriteSurfaceContractError(
        `memory 面条目操作非法：「${String(op)}」不在 [${MEMORY_ENTRY_OPS.join(', ')}] 内`,
      );
    }
    if (typeof (diff as MemoryEntryDiff).entryKey !== 'string' || (diff as MemoryEntryDiff).entryKey === '') {
      throw new WriteSurfaceContractError('memory 面 diff 缺 entryKey（条目身份）');
    }
  }
}

/** 生成人类可读的变更摘要（举证面一眼可读） */
export function summarizeDiff(diff: WriteSurfaceDiff): string {
  if (diff.mode === 'field-level') {
    if (diff.changes.length === 0) return '字段级：无字段变化';
    return (
      `字段级 ${diff.changes.length} 处：` +
      diff.changes
        .map((c) => `${c.field}「${c.before ?? '∅'}」→「${c.after ?? '∅'}」`)
        .join('；')
    );
  }
  const b = (diff.before ?? '∅').slice(0, 80);
  const a = (diff.after ?? '∅').slice(0, 80);
  return `条目级 [${diff.op}] ${diff.entryKey}：「${b}」→「${a}」`;
}

/** 归一化 actor / origin 校验（缺发起人或来源 ⇒ 拒绝，证据三要素不可缺） */
function assertEvidenceTriad(input: WriteSurfaceChangeInput): void {
  if (typeof input.actor !== 'string' || input.actor.trim() === '') {
    throw new WriteSurfaceContractError('发起人（actor）必填——证据三要素（发起人 / 来源 / 时间）不可缺');
  }
  if (!(WRITE_SURFACE_ORIGINS as readonly string[]).includes(input.origin)) {
    throw new WriteSurfaceContractError(
      `触发来源非法：「${String(input.origin)}」不在 [${WRITE_SURFACE_ORIGINS.join(', ')}] 内`,
    );
  }
  if (typeof input.target !== 'string' || input.target.trim() === '') {
    throw new WriteSurfaceContractError('变更落点（target）必填');
  }
}

// ════════════════════════════════════════
// 三、路径与链写
// ════════════════════════════════════════

/**
 * 写面链文件路径：与 decision-log.jsonl 同级（<dataDir>/audit/write-surface.jsonl）。
 * 复用 core 的 dataDir 解析（显式 dataDir > SOFAGENT_DATA > 默认数据目录），
 * 不新造路径 SSOT。
 */
export function getWriteSurfaceLogPath(dataDir?: string): string {
  return join(dirname(getDecisionLogPath(dataDir)), 'write-surface.jsonl');
}

/**
 * 追加一条写面变更记录到链（受控写唯一入口）。
 *
 * 链协议完全由 chain-kernel.appendChained 承载（与 decision-log 同密钥 / 同签名算法 /
 * 同环境指纹）——本函数只做「契约校验 + 组装业务字段 + 挂链」。
 *
 * @param input 写面变更入参
 * @param dataDir 数据目录覆盖（测试隔离用）
 * @returns 落盘的完整链条目（含链字段）
 * @throws WriteSurfaceContractError 契约 / 证据三要素校验失败（不写文件）
 * @throws WriteSurfaceWriteError 挂链失败（向上传播）
 */
export function recordWriteSurfaceChange(
  input: WriteSurfaceChangeInput,
  dataDir?: string,
): WriteSurfaceEntry {
  assertEvidenceTriad(input);
  assertDiffContract(input.surface, input.diff);

  const filePath = getWriteSurfaceLogPath(dataDir);
  // 写侧护栏：测试环境解析到真实数据根 → fail-loud 拒绝写入（先于任何 fs 写）
  assertTestEnvNotWritingRealData(filePath, 'recordWriteSurfaceChange');
  const fingerprint = getEnvFingerprint(dataDir);
  const hmacKey = getHmacKey();

  const business: WriteSurfaceRecord = {
    ts: input.ts ?? new Date().toISOString(),
    kind: kindForSurface(input.surface),
    surface: input.surface,
    target: input.target,
    actor: input.actor,
    origin: input.origin,
    diff: input.diff,
    summary: summarizeDiff(input.diff),
    traceId: input.traceId ?? `${input.surface}:${Date.now()}`,
    ...(input.refTrace !== undefined ? { refTrace: input.refTrace } : {}),
    engine: 'sofagent audit',
  };

  return appendChained(business, {
    filePath,
    validKinds: WRITE_SURFACE_KINDS,
    key: hmacKey,
    fingerprint,
    onInvalidKind: (kind) =>
      new WriteSurfaceContractError(`非法 kind 「${String(kind)}」——不在 [${WRITE_SURFACE_KINDS.join(', ')}]`),
    onWriteError: (message, cause) => new WriteSurfaceWriteError(message, cause),
    logLabel: '[write-surface-log]',
  });
}

/** 读取写面链条目（不存在返回空数组；坏行按 fail-loud 跳过并告警，不静默） */
export function loadWriteSurfaceLog(dataDir?: string): WriteSurfaceEntry[] {
  const filePath = getWriteSurfaceLogPath(dataDir);
  if (!existsSync(filePath)) return [];
  const out: WriteSurfaceEntry[] = [];
  let lineNo = 0;
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    lineNo++;
    try {
      out.push(JSON.parse(trimmed) as WriteSurfaceEntry);
    } catch (err) {
      // 为何告警不静默：坏行意味着链完整性存疑——验签侧会黄化，此处必须让人看见而非吞掉
      console.error(
        `[write-surface-log] ⚠️ 写面链第 ${lineNo} 行解析失败（该行不计入返回，链完整性存疑）：` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
}

/**
 * 校验写面链完整性（复用 chain-kernel.verifyChain 四态判定）。
 * 缺省读链文件并按其落盘的指纹复验；可显式传 records 做单元测试。
 */
export function verifyWriteSurfaceChain(
  records?: readonly unknown[],
  dataDir?: string,
): ChainCheckResult {
  const entries = records ?? loadWriteSurfaceLog(dataDir);
  return verifyChain(entries, {
    key: getHmacKey(),
    fingerprint: getEnvFingerprint(dataDir),
    subject: '写面',
  });
}

// ════════════════════════════════════════
// 四、第三通道：写面 diff → 既有规则输入面（判定逻辑零改动）
// ════════════════════════════════════════

/**
 * 把写面链条目转换为既有规则的输入面（{@link DiffFile}）。
 *
 * **这就是「第三通道」的落法**：既有审计规则消费 `DiffFile[]`（git diff 解析产物）；
 * 写面变更只要**合成等价形态的 DiffFile**，即可并入 `runRules(diffFiles)` 的输入面——
 * **规则判定逻辑一行不改，只扩输入面**（对齐 v1.5.1 双通道纪律）。
 *
 * 形态映射：
 *   · prompt 字段级 → status='modified'，lines = ['- <field>: <before>', '+ <field>: <after>']
 *   · memory 新增 → status='added'，lines = ['+ <entryKey>: <after>']（旧值以注释行保留）
 *   · memory 修订 → status='modified'，lines = ['- <entryKey>: <before>', '+ <entryKey>: <after>']
 *   · memory 失效 → status='deleted'，lines = ['- <entryKey>: <before>']
 *
 * @param entries 写面链条目（或仅业务记录）
 * @param prefix 合成 diff 的伪路径前缀（缺省 `.sofagent/write-surface/`，
 *   使规则侧一眼可辨「这是写面变更而非仓库文件」；调用方可按需改写）
 */
export function writeSurfaceToDiffFiles(
  entries: readonly WriteSurfaceRecord[],
  prefix = '.sofagent/write-surface/',
): DiffFile[] {
  const files: DiffFile[] = [];
  for (const e of entries) {
    const path = `${prefix}${e.surface}/${e.target}`;
    if (e.diff.mode === 'field-level') {
      const lines: string[] = [`@@ write-surface ${e.kind} @ ${e.ts} @@`];
      for (const c of e.diff.changes) {
        lines.push(`- ${c.field}: ${c.before ?? ''}`);
        lines.push(`+ ${c.field}: ${c.after ?? ''}`);
      }
      files.push({ path, status: 'modified', lines });
    } else {
      const d = e.diff;
      if (d.op === 'add') {
        files.push({ path, status: 'added', lines: [`+ ${d.entryKey}: ${d.after ?? ''}`] });
      } else if (d.op === 'revise') {
        files.push({
          path,
          status: 'modified',
          lines: [`- ${d.entryKey}: ${d.before ?? ''}`, `+ ${d.entryKey}: ${d.after ?? ''}`],
        });
      } else {
        files.push({ path, status: 'deleted', lines: [`- ${d.entryKey}: ${d.before ?? ''}`] });
      }
    }
  }
  return files;
}

// ════════════════════════════════════════
// 五、举证导出（第三方无需安装 sofagent）
// ════════════════════════════════════════

/** 举证导出 bundle（自描述——第三方按 howto 独立验签） */
export interface WriteSurfaceEvidenceBundle {
  format: 'sofagent.write-surface-evidence';
  version: 1;
  generatedAt: string;
  /** 链路协议描述（重算依据） */
  protocol: 'hmac-sha256-stable-v2';
  /** 链文件绝对路径（源） */
  chainFile: string;
  /** 落盘时记录的环境指纹（第三方复验须显式给出同值） */
  fingerprint: string;
  /** HMAC 密钥是否在场（在场 = 强校验；缺失 = 降级仅验 prevHash 链） */
  hmacKeyPresent: boolean;
  /** 条目数 */
  recordCount: number;
  /** 本机复验结论（第三方应自行重算，此值仅供参考） */
  verdict: ChainCheckResult;
  /** 独立验签指引（第三方无需安装 sofagent） */
  independentVerification: {
    /** 复用仓内零依赖验签器（随包分发：npm 包内 verify/verify-chain.mjs） */
    tool: string;
    command: string;
    howto: string[];
  };
  /** 原始链条目——第三方喂给验签器（或任何独立实现）即可重算 */
  records: WriteSurfaceEntry[];
}

/** 举证导出选项 */
export interface ExportWriteSurfaceEvidenceOptions {
  dataDir?: string;
  /**
   * 若给出，则把原始链条目以 JSONL 落盘到该路径
   * （就是 tools/verify/verify-chain.mjs 直接消费的输入文件形态）。
   */
  outFile?: string;
}

/**
 * 导出写面变更具证（对齐 v1.5.2 章二独立验签语义）。
 *
 * 返回自描述 bundle：含原始链条目 + 环境指纹 + 密钥在场 + 独立验签命令与步骤。
 * 第三方把 `records` 写成 JSONL（或直接用本函数 `outFile` 产出的文件）后，
 * 用 `tools/verify/verify-chain.mjs`（裸 node，零依赖）即可重算 HMAC 链——
 * **无需安装 sofagent、无需加载引擎代码**。
 */
export function exportWriteSurfaceEvidence(
  options: ExportWriteSurfaceEvidenceOptions = {},
): WriteSurfaceEvidenceBundle {
  const { dataDir, outFile } = options;
  const chainFile = getWriteSurfaceLogPath(dataDir);
  const records = loadWriteSurfaceLog(dataDir);
  const key = getHmacKey();
  const fingerprint = getEnvFingerprint(dataDir);
  const verdict = verifyChain(records, { key, fingerprint, subject: '写面' });

  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf-8');
  }

  const command =
    `node tools/verify/verify-chain.mjs --history "${outFile ?? chainFile}" --key <hmac-key-file> --fingerprint ${fingerprint}`;

  return {
    format: 'sofagent.write-surface-evidence',
    version: 1,
    generatedAt: new Date().toISOString(),
    protocol: 'hmac-sha256-stable-v2',
    chainFile,
    fingerprint,
    hmacKeyPresent: key !== null,
    recordCount: records.length,
    verdict,
    independentVerification: {
      tool: 'tools/verify/verify-chain.mjs（单文件零依赖，裸 node 可跑；随 @sofagent/audit 包分发）',
      command,
      howto: [
        '① 取本 bundle 的 records（或 outFile 产出的 JSONL）为输入',
        '② 取本 bundle 的 fingerprint 为 --fingerprint（环境指纹漂移会判「不可复验（黄）」，非篡改）',
        '③ 若持有 HMAC 密钥，经 --key 传入做强校验；无密钥则降级仅验 prevHash 链（hmacKeyPresent=false）',
        '④ 验签器按 chain-kernel 同协议独立重算：prevHash=sha256(JSON.stringify(omitHash)+"/"+fp)[:16]，hmacSig=hmac_sha256(stableStringify(omitSig)+"/"+fp)[:32]',
        '⑤ 篡改任一字段 ⇒ 验签器报断链并定位条目号（防「验签器恒真」）：三态 = 链完整 / 断链（给出条目号与期望值）/ 链头不匹配',
      ],
    },
    records,
  };
}

// ════════════════════════════════════════
// 六、core 侧接线缝：tracer 工厂
// ════════════════════════════════════════

/**
 * 构造 core 侧可注入的写面留痕 sink。
 *
 * 用法（接线方）：
 *   import { setWriteSurfaceTracer } from '@sofagent/core';
 *   import { createWriteSurfaceTracer } from './write-surface-log';
 *   setWriteSurfaceTracer(createWriteSurfaceTracer(dataDir));
 *
 * 注入后，core 侧写面变更（加载链配置 / 记忆写入）经 guardWriteSurface 自动落留痕；
 * 留痕失败即回退 + 告警（fail-closed）。
 *
 * @param dataDir 数据目录覆盖（与调用方写盘同源；测试隔离用）
 * @param sinkOptions.dataDir 同 dataDir（显式命名，供未来扩展）
 */
export function createWriteSurfaceTracer(
  dataDir?: string,
): (trace: {
  surface: 'prompt' | 'memory';
  target: string;
  actor: string;
  origin: WriteSurfaceOrigin;
  diff: unknown;
  ts: string;
  traceId: string;
  refTrace?: string;
}) => void {
  return (trace) => {
    // core 侧 diff 为不透明结构——此处按契约校验（prompt⇒字段级 / memory⇒条目级），
    // 违规即抛（guardWriteSurface 会据此回退 + 告警）。
    const diff = trace.diff as WriteSurfaceDiff;
    recordWriteSurfaceChange(
      {
        surface: trace.surface,
        target: trace.target,
        actor: trace.actor,
        origin: trace.origin,
        diff,
        ...(trace.refTrace !== undefined ? { refTrace: trace.refTrace } : {}),
        ts: trace.ts,
        traceId: trace.traceId,
      },
      dataDir,
    );
  };
}

// ════════════════════════════════════════
// 七、接线说明（跨模块——本文件不落其它模块的编辑，仅登记落点）
// ════════════════════════════════════════
//
// 【core 侧注入（写面留痕接线生效）】
//   setWriteSurfaceTracer(createWriteSurfaceTracer(dataDir))
//   建议在 daemon / 进程引导处注入（与 decision-log 初始化同域）。注入后：
//     · loadchain 配置写入经 core.loadchain-write-hook 的 captureLoadChainWrite + guardWriteSurface；
//     · memory-store 的 set / delete 自动留痕。
//
// 【晋级动作自动留痕（v1.5.8 第二章 · 组②）】
//   落点：engine/evolve/src/promotion-policy.ts:232 `recordPromotionDecision`
//         —— 在 `writer({...})` 调用（同函数体 :240）之后追加：
//         emitWriteSurfaceTrace({
//           surface: 'memory', target: `promotion:${input.itemId}`, actor: 'evolve-loop',
//           origin: 'self-improvement',
//           diff: { mode:'entry-level', op:'revise', entryKey: input.itemId,
//                   before: `layer=${input.currentLayer}`, after: verdict.action },
//           refTrace: entry.ts,
//         })
//   （emitWriteSurfaceTrace 取自 @sofagent/core；判定即留痕，故不需要 apply/revert。）
//   生产调用方：engine/daemon/src/evolution/loop.ts:481 `recordPromotionDecision(...)`
//   —— 在库层落点接线后，该调用方**自动获得留痕，无需改调用点**（不靠调用方自觉）。
//
// 【考核动作自动留痕（v1.5.8 第四章 · 组④）】
//   落点：engine/orchestrator/src/instinct/store.ts:37 `appendToPool`
//         —— 池条目的**唯一写入方**；对其写入的每条 item 落一条写面记录
//         （surface:'memory', op: verified 变更 → 'revise'；新增 → 'add'，
//          actor:'examiner', origin:'self-improvement', refTrace: 对应 ExamResult）。
//   生产调用方：engine/daemon/src/evolution/loop.ts:372 `appendToPool(dataDir, updatedItems)`
//   —— 在 store 层落点接线后，该调用方自动获得留痕。
//
// 【知识面（knowledge/ 目录唯一写操作方）】
//   落点：engine/daemon/src/inspectors/knowledge-health.ts（知识面举证面）
//   —— 不属本文件与 core 钩子范围（daemon 侧），由对应模块按同款
//      emitWriteSurfaceTrace(surface:'memory', ...) 接线。
//
// ⚠️ 上述落点均为**其它模块**，本文件不含对它们的任何编辑——仅登记精确落点供接线。
// ════════════════════════════════════════
