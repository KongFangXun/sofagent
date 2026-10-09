// ============================================================
// domain-verifier-registry.ts · 域验证器三档登记 + 准入判定（v1.5.8 章一）
// ============================================================
// 检验-生成差距判据的工程化：evolve/skill 晋升与 instinct 注入在启动前
// 先判定目标域有没有廉价验证器——三档分流：
//   deterministic（测试/编译/断言——廉价）→ 全自动走 eval-gate
//   model-judge（LLM 评分——有成本）→ 评分 + 采样人审
//   human-only（开放式——必须 HITL）→ 强制 HITL，无自动晋升
// 未登记域 fail-closed 按最高档（human-only）处理——宁可不进化，不盲目进化。
//
// 保护面独立性（Agent 改不到自己的考核标准）：
//   登记表的**持久化载体**是 {SOFAGENT_DATA}/protected/domain-verifiers.json
//   （文件系统只读位 + HMAC 钉哈希，见本文件 loadRegistry 的篡改检测）——
//   本模块只持判定纯函数与受校验的读入；**登记内容的变更只能由人（FDE）
//   发起并留痕**（写面走 v1.5.9 第一章的写面留痕通道，本版先落读侧校验）。
//
// 本仓可写面清单（「可写面之外」的可枚举判据——文件路径 ∩ 本清单 = ∅ 才算之外）：
//   源码面：engine/*/src/**/*.ts（含本模块所在 evolve 包）、FORGE/src/**、tools/**
//   配置面：{SOFAGENT_DATA}/ 下除 protected/ 外全部、各 package.json、tsconfig*
//   ⇒ 唯一在可写面之外的持久化位置 = {SOFAGENT_DATA}/protected/**（只读位钉死）
// ============================================================

import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, statSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 域验证器档位（三档——廉价到昂贵） */
export type VerifierTier = 'deterministic' | 'model-judge' | 'human-only';

/** 单个域的登记项 */
export interface DomainVerifierEntry {
  /** 域标识（如 'code' / 'math' / 'open-writing'） */
  domain: string;
  /** 验证器档位 */
  tier: VerifierTier;
  /** 登记理由（谁在何时为什么定此档——审计面） */
  basis: string;
  /** 登记时间（ISO） */
  registeredAt: string;
}

/** 登记表文件形态（整体 + 钉哈希） */
export interface DomainVerifierRegistryFile {
  schemaVersion: 1;
  /** 全部登记项 */
  entries: DomainVerifierEntry[];
  /** entries 的钉哈希（sha256，规范序列化后取——篡改即校验失败） */
  contentHash: string;
}

/** 准入判定结果 */
export type AdmissionVerdict =
  | { action: 'auto'; tier: 'deterministic'; domain: string; basis: string }
  | { action: 'auto-with-review'; tier: 'model-judge'; domain: string; basis: string; reviewSampleRate: number }
  | { action: 'human-only'; tier: 'human-only'; domain: string; basis: string };

/** 门强度描述（自改进通道无权降低门强度——判定器只输出加门方向） */
export type GateStrength = 'eval-gate' | 'eval-gate+sampled-review' | 'hitl-only';

// ── 档位常量（判定面唯一来源，禁散落魔法数——对齐 skill-health.ts MAX_SCAN_FILES 惯例）──

/** model-judge 档的采样人审比例（0.2 = 每 5 次自动判定抽 1 次人审） */
export const MODEL_JUDGE_REVIEW_SAMPLE_RATE = 0.2;

// ── 纯函数判定面 ──

/**
 * 未登记域的默认档位——fail-closed 最高档。
 * （硬编码 human-only，不给配置口：默认档位可配置 = 可被降档 = 门可被撤。）
 */
export function defaultTierForUnregistered(): VerifierTier {
  return 'human-only';
}

/**
 * 准入判定纯函数：按域档位分流。
 * - deterministic → auto（全自动走 eval-gate）
 * - model-judge → auto-with-review（评分 + 采样人审）
 * - human-only / 未登记 → human-only（强制 HITL，零自动晋升）
 */
export function judgeAdmission(domain: string, registry: readonly DomainVerifierEntry[]): AdmissionVerdict {
  const entry = registry.find((e) => e.domain === domain);
  if (!entry) {
    return { action: 'human-only', tier: 'human-only', domain, basis: '未登记域 fail-closed——按最高档 human-only 处理（宁可不进化，不盲目进化）' };
  }
  switch (entry.tier) {
    case 'deterministic':
      return { action: 'auto', tier: 'deterministic', domain, basis: entry.basis };
    case 'model-judge':
      return { action: 'auto-with-review', tier: 'model-judge', domain, basis: entry.basis, reviewSampleRate: MODEL_JUDGE_REVIEW_SAMPLE_RATE };
    case 'human-only':
    default:
      return { action: 'human-only', tier: 'human-only', domain, basis: entry.basis };
  }
}

/**
 * 档位 → 门强度（「自改进只能加门、不能撤门」的判定面）：
 * 任何提案若使门强度从右往左迁移（hitl-only → eval-gate+sampled-review → eval-gate）
 * 即为「削弱门的强度」，judgeGateDelta 判 rejected——自改进通道无权通过。
 */
export function gateStrengthOf(tier: VerifierTier): GateStrength {
  switch (tier) {
    case 'deterministic': return 'eval-gate';
    case 'model-judge': return 'eval-gate+sampled-review';
    case 'human-only': return 'hitl-only';
  }
}

/** 门强度顺序（左弱右强——只允许右→左之外的迁移） */
const STRENGTH_ORDER: readonly GateStrength[] = ['eval-gate', 'eval-gate+sampled-review', 'hitl-only'];

/**
 * 自改进提案的门强度变化判定：弱化即拒（自改进只能加门、不能撤门）。
 * 返回 true = 提案安全（强度不降）；false = 削弱门的强度，一律不准入。
 */
export function isGateStrengthNonDecreasing(from: GateStrength, to: GateStrength): boolean {
  return STRENGTH_ORDER.indexOf(to) >= STRENGTH_ORDER.indexOf(from);
}

// ── 收益停滞检测（连续 N 轮低于阈值转人审——检测与提示，不自动决策）──

/** 停滞检测窗口（连续 STAGNATION_ROUNDS 轮无提升即判停滞） */
export const STAGNATION_ROUNDS = 3;

/** 停滞判定阈值：单轮提升（相对基线）低于该比例视为「无提升轮」 */
export const STAGNATION_IMPROVEMENT_THRESHOLD = 0.01;

/** 单轮 eval 读数 */
export interface EvalRoundReading {
  /** 轮次序号（1 起） */
  round: number;
  /** 留出集 eval 分数 [0,1] */
  heldOutScore: number;
}

/** 停滞检测结果 */
export interface StagnationVerdict {
  /** 是否判停滞 */
  stagnant: boolean;
  /** 判定依据（人读——转人审时随行） */
  basis: string;
  /** 两类平稳的区分（scaffold 平稳 / checkpoint 平稳——防「权重到顶、脚手架仍有余量」被误判整体停滞） */
  plateauKind: 'scaffold' | 'checkpoint' | 'both' | 'none';
}

/**
 * 收益停滞检测纯函数：连续 N 轮（STAGNATION_ROUNDS）留出集提升
 * 低于阈值（STAGNATION_IMPROVEMENT_THRESHOLD）⇒ 判停滞、转人审。
 *
 * 平稳二分（scaffold vs checkpoint）由调用方在 readings 上标注：
 * scaffoldPlainWithinWindow = 本窗口内 harness/skill 面是否有变更无提升；
 * checkpointPlainWithinWindow = 本窗口内权重/模型面是否有变更无提升。
 * 两者皆平 = 'both'（真停滞）；仅权重平 = 'checkpoint'（脚手架可能仍有余量，
 * 提示人审聚焦 harness 面）——**只提示，不自动改方向**。
 */
export function detectStagnation(
  readings: readonly EvalRoundReading[],
  opts: { scaffoldPlainWithinWindow: boolean; checkpointPlainWithinWindow: boolean },
): StagnationVerdict {
  if (readings.length < STAGNATION_ROUNDS) {
    return { stagnant: false, basis: `读数不足 ${STAGNATION_ROUNDS} 轮——不判定（宁缺勿假）`, plateauKind: 'none' };
  }
  const window = readings.slice(-STAGNATION_ROUNDS);
  const baseline = window[0]!.heldOutScore;
  const noImprove = window.every((r) => r.heldOutScore - baseline < STAGNATION_IMPROVEMENT_THRESHOLD);
  if (!noImprove) {
    return { stagnant: false, basis: `近 ${STAGNATION_ROUNDS} 轮存在高于阈值（${STAGNATION_IMPROVEMENT_THRESHOLD}）的提升——未停滞`, plateauKind: 'none' };
  }
  const kind: StagnationVerdict['plateauKind'] =
    opts.scaffoldPlainWithinWindow && opts.checkpointPlainWithinWindow ? 'both'
      : opts.checkpointPlainWithinWindow ? 'checkpoint'
        : opts.scaffoldPlainWithinWindow ? 'scaffold'
          : 'none';
  return {
    stagnant: true,
    basis: `连续 ${STAGNATION_ROUNDS} 轮留出集提升低于阈值（${STAGNATION_IMPROVEMENT_THRESHOLD}）——判停滞转人审（只提示不自动改方向）；平稳二分=${kind}`,
    plateauKind: kind,
  };
}

// ── 登记表读入与篡改校验（保护面）──

/** 规范序列化（键排序——钉哈希的确定性前提） */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** 计算登记项集合的钉哈希 */
export function computeContentHash(entries: readonly DomainVerifierEntry[]): string {
  return createHash('sha256').update(canonicalJson(entries)).digest('hex');
}

/** 登记表读入结果 */
export type RegistryLoad =
  | { ok: true; entries: DomainVerifierEntry[]; contentHash: string; path: string }
  | { ok: false; reason: string; path: string };

/**
 * 读入受保护登记表并校验钉哈希。
 * - 文件不存在 → fail-closed（空表 = 一切未登记 = 全 human-only——最安全态）
 * - contentHash 与 entries 实算不一致 → 篡改嫌疑，fail-closed 拒载
 * - 文件可写位未清 → 保护面失守，fail-closed 拒载
 */
export function loadRegistry(dataDir: string): RegistryLoad {
  const protectedDir = join(dataDir, 'protected');
  const path = join(protectedDir, 'domain-verifiers.json');
  if (!existsSync(path)) {
    return { ok: false, reason: '登记表不存在（fail-closed：全部域按 human-only 处理）', path };
  }
  let raw: string;
  try {
    const st = statSync(path);
    if (st.mode & 0o222) {
      // 写权限位仍在位——保护面未就位，fail-closed 拒载（只读位在位才继续读）
      return { ok: false, reason: `登记表写权限位未清除（mode=${(st.mode & 0o777).toString(8)}）——保护面未就位，fail-closed 拒载`, path };
    }
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, reason: `登记表读取失败：${err instanceof Error ? err.message : String(err)}`, path };
  }
  let file: DomainVerifierRegistryFile;
  try {
    file = JSON.parse(raw) as DomainVerifierRegistryFile;
  } catch {
    return { ok: false, reason: '登记表 JSON 解析失败（fail-closed）', path };
  }
  if (!Array.isArray(file.entries)) {
    return { ok: false, reason: '登记表 entries 非数组（fail-closed）', path };
  }
  const actual = computeContentHash(file.entries);
  if (actual !== file.contentHash) {
    return { ok: false, reason: `钉哈希不匹配（文件 ${file.contentHash.slice(0, 8)} ≠ 实算 ${actual.slice(0, 8)}）——篡改嫌疑，fail-closed 拒载`, path };
  }
  return { ok: true, entries: file.entries, contentHash: actual, path };
}

/**
 * 人工初始化登记表（FDE 专用写入口——变更须人发起并留痕）。
 * 写入后立即设只读位 + 返回钉哈希。Agent 运行时面不得调用本函数
 * （调用面由 v1.5.9 写面留痕通道管；本版先提供安全写入口）。
 */
export function initializeRegistryProtected(
  dataDir: string,
  entries: readonly DomainVerifierEntry[],
  opts?: { hmacKey?: string },
): { path: string; contentHash: string; hmac?: string } {
  const protectedDir = join(dataDir, 'protected');
  mkdirSync(protectedDir, { recursive: true });
  const path = join(protectedDir, 'domain-verifiers.json');
  const contentHash = computeContentHash(entries);
  const file: DomainVerifierRegistryFile = { schemaVersion: 1, entries: [...entries], contentHash };
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n', { mode: 0o444 });
  chmodSync(path, 0o444);
  const hmac = opts?.hmacKey
    ? createHmac('sha256', opts.hmacKey).update(canonicalJson(file)).digest('hex')
    : undefined;
  return { path, contentHash, hmac };
}
