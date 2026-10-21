// ============================================================
// baseline-snapshot.ts · 能力基线版本线（四层状态快照 · v1.7.0 章二）
// ============================================================
//
// ── 这一件解决什么 ──
// 审计的可复现要求是「举证要能还原当时条件」。v1.4.9 已有**执行时** skill 快照
// （单次执行级可复现：执行前打包、执行后清理），但缺**跨时间**的能力基线——
// Agent 进化三个月后与当初判若两人，出事故时无人能回答「当时的它是哪个状态」。
// 本节把「单次执行可复现」升级为「跨时间可追溯」：
//
//   · 每次能力变更（**晋级 / 回退 / 写面变更**）前自动打包**四层状态**：
//       ① prompt 配置版本（加载链四层配置字段 SSOT + 当前值视图的摘要版本）
//       ② skill 集合版本（技能清单 + 健康分的摘要版本）
//       ③ memory 事实锚点（事实 key / factId / 更新时间 / 内容摘要）
//       ④ 权重 manifest 引用（版本 id / sha256 引用——**只引用不重算**）
//     四层合为一个**可寻址快照 id**。
//   · 快照按时间**成链（前驱指针 prevId）**——任一时点可回答「当时 Agent 的完整能力状态」。
//   · 按快照 id **回滚四层状态**：**复用既有 snapshot/restore 语义，不新建回退机制**
//     （对齐 promotion-policy.ts 的纪律：本模块只出恢复计划与留痕，实际恢复动作
//      由注入的 restorer 复用 core 的 restoreSnapshot / memory-store 执行）。
//   · 回滚动作本身落 decision-log（经可注入 DecisionWriter——缺省复用同包
//     promotion-policy 的 createCoreDecisionWriter，静态接 core 已 @public 的
//     emitAuditDecision；留痕失败不阻断，缺失由 null 如实暴露）。
//   · 快照 id 可被引证记录引用（「事故发生在基线 X 下」——举证不止于代码版本，
//     而是**能力版本**）。
//
// ── 与 v1.4.9 执行级快照的分工边界（勿混为一谈）──
//   · **执行级快照（v1.4.9）**：管**单次执行可复现**——一次执行前后打包/清理，
//     生命周期与本次执行绑定，回答问题「这一次跑的时候 skill 面是什么」。
//   · **能力基线（本模块）**：管**跨时间可追溯**——能力每次变更即生成一个快照并
//     成链，生命周期与整条能力版本线绑定，回答问题「三个月前的那个它是什么状态」。
//   两者**不同的轴**：一个是「同一次执行的条件」，一个是「能力随时间的演变」。本模块
//   不复制执行级打包逻辑，也不改其语义；需要单次执行条件时仍走既有执行级快照。
//
// ── 四层数据的取数落点（只读既有实现，不改它们）──
//   · prompt 层 → `@sofagent/core` 的 loadchain-schema SSOT（LOAD_CHAIN_CONFIG_FIELDS +
//                 loadChainConfigFromEnv）——四层配置字段与当前 env 值视图。
//   · skill  层 → 本节包的 skill-health.generateHealthReport（skipDebtWrite=true 只读，
//                 不落技术债台账）——技能清单 + 五维健康分。
//   · memory 层 → `@sofagent/core` 的 createMemoryStore（list 只读）——事实锚点。
//   · weights 层 → 运行时软依赖 `globalThis.__sofagentWeightsManifestRef`（权重面
//                 manifest 验签属 orchestrator，evolve 不引入该依赖边；未接线即如实记 null）。
//
// ── 链存储与完整性 ──
// 快照链落 `${dataDir}/evolve/baseline-chain.jsonl`（一行一快照，append-only）。
// 每条快照带 `stateHash`（四层状态的稳定摘要）——读侧重算即知快照是否被篡改
// （fail-closed：被篡改的快照拒绝回滚）。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join, relative } from 'path';
import {
  createMemoryStore,
  loadChainConfigFromEnv,
  loadEnvConfig,
  LOAD_CHAIN_CONFIG_FIELDS,
  restoreSnapshot,
  stableStringify,
} from '@sofagent/core';
import { createCoreDecisionWriter, type DecisionWriter } from './promotion-policy';
import { generateHealthReport, resolveSkillRoot } from './skill-health';

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/** 四层名（与 devlog 章二交付表逐层对齐） */
export const BASELINE_LAYERS = ['prompt', 'skill', 'memory', 'weights'] as const;
export type BaselineLayer = (typeof BASELINE_LAYERS)[number];

/** 能力变更种类（触发快照的三类事件） */
export const CAPABILITY_CHANGE_KINDS = ['promote', 'demote', 'write-surface'] as const;
export type CapabilityChangeKind = (typeof CAPABILITY_CHANGE_KINDS)[number];

/**
 * 能力变更事件（快照触发器）。
 *
 * ── 写面变更事件的对接缝（章一 write-surface 事件源 → 本模块）──
 * 章一（engine/audit/src/write-surface-log.ts · engine/core/src/loadchain-write-hook.ts）
 * 产出的写面留痕载荷 `WriteSurfaceTrace` 形态为
 *   `{ surface, target, actor, origin, diff, ts, traceId, refTrace? }`。
 * 本模块把它**投影**为本事件：`kind='write-surface'`、`actor`←trace.actor、
 * `source`←trace.origin、`at`←trace.ts、`surface`/`target`/`before`/`after`←diff 的摘要、
 * `refTrace`←trace.traceId。**本模块不 import 章一实现**（不引入 audit↔evolve 的编译期
 * 硬依赖）——按上面的结构契约接收事件即可，两侧各自演进不耦合。
 */
export interface CapabilityChangeEvent {
  kind: CapabilityChangeKind;
  /** 发起人（Agent 实例 id / 人） */
  actor: string;
  /** 触发来源（self-improvement / human / system / 具体子系统名） */
  source: string;
  /** 变更时刻（ISO 8601） */
  at: string;
  /** 写面变更的写面名（kind='write-surface' 时） */
  surface?: 'prompt' | 'memory';
  /** 写面变更落点（配置面层名/文件名；记忆面事实 key） */
  target?: string;
  /** 写面变更前值摘要（可空） */
  before?: string | null;
  /** 写面变更后值摘要（可空） */
  after?: string | null;
  /** 与改进链绑定：触发本次变更的晋级 / 考核记录引用 */
  refTrace?: string;
}

/** 变更事件入参（at 可省略——缺省取采集时刻） */
export type CapabilityChangeEventInput = Omit<CapabilityChangeEvent, 'at'> & { at?: string };

/** memory 层单条事实锚点（只存指针与摘要，不复制事实值） */
export interface MemoryAnchor {
  /** 事实键 */
  key: string;
  /** 事实 id（per-fact Markdown 文件名主干） */
  factId: string;
  /** 更新时间（ISO） */
  updatedAt: string;
  /** 事实值的内容摘要（sha256 前 16 位——锚点可核对漂移，不泄漏原文） */
  hash: string;
  /** 作用域（可选） */
  scope?: string;
}

/** prompt 层状态 */
export interface PromptLayerState {
  /** 配置版本（四层配置字段 SSOT + 当前值视图的摘要） */
  version: string;
  /** 已登记字段数 */
  fieldCount: number;
  /** 覆盖的加载链层名 */
  layers: string[];
}

/** skill 层状态 */
export interface SkillLayerState {
  /** 技能集合版本（清单 + 健康分摘要） */
  version: string;
  /** 技能数 */
  count: number;
  /** 技能根目录 */
  root: string;
}

/** weights 层状态 */
export interface WeightsLayerState {
  /** 权重 manifest 引用（版本 id / sha256 引用）；不可得 = null */
  ref: string | null;
  /** 不可得原因（ref 非 null 时省略） */
  reason?: string;
}

/** 四层状态（快照的载荷） */
export interface FourLayerState {
  prompt: PromptLayerState;
  skill: SkillLayerState;
  /** memory 事实锚点（按 key 排序——保证摘要稳定） */
  memoryAnchors: MemoryAnchor[];
  weights: WeightsLayerState;
  /** 采集时刻（ISO） */
  collectedAt: string;
  /**
   * 采集到的仓快照引用（复用既有 git shadow-repo 快照语义的回滚锚点）。
   * 未采集 = null（回滚时 prompt/skill 文件层无仓快照可复原点）。
   */
  repoSnapshotSha: string | null;
}

/** 基线快照（版本线上一节点） */
export interface BaselineSnapshot {
  /** 可寻址快照 id（内容寻址——含前驱与四层状态摘要） */
  id: string;
  /** 生成时刻（ISO） */
  createdAt: string;
  /** 触发本次快照的能力变更事件 */
  trigger: CapabilityChangeEvent;
  /** 四层状态载荷 */
  state: FourLayerState;
  /** 四层状态摘要（sha256——完整性自证） */
  stateHash: string;
  /** 前驱快照 id（链首 = null） */
  prevId: string | null;
  /**
   * v1.6.0 BUG-52：prompt/skill 层实际文件清单（相对路径 + 内容 sha256，按 path 排序）。
  /**
   * v1.6.0 BUG-52：prompt/skill 层实际文件清单（skill 根锚定 + 相对路径 +
   * 内容 sha256，按 path 排序）。可选字段——无此字段的 legacy 快照走兼容
   * 路径（verifySnapshotIntegrity 跳过第二判但提示「legacy 快照无文件
   * 清单」，不判红）。快照 id 不含 manifest 摘要（manifest 是校验面不是
   * 寻址面——同一能力状态的 id 保持稳定）。
   */
  fileManifest?: FileManifest;
}

/** 快照完整性判定 */
export interface SnapshotIntegrity {
  ok: boolean;
  /** 不 ok 时的原因 */
  reason?: string;
  /** legacy 快照（无 fileManifest）通过第一判时的降级提示（不判红） */
  notice?: string;
}

/**
 * v1.6.0 BUG-52：文件清单条目——快照采集时刻 prompt/skill 层实际文件的
 * 相对路径 + 内容哈希（防删除绕过：stateHash 只能发现「快照记录被改」，
 * 发现不了「快照没改而磁盘文件被删/被改」）。
 */
export interface FileManifestEntry {
  /** 相对 skill 根的文件路径（POSIX 分隔符，按 path 排序保证稳定） */
  path: string;
  /** 文件内容 sha256（全量 hex） */
  sha256: string;
}

/**
 * v1.6.0 BUG-52：prompt/skill 层实际文件清单（相对路径 + 内容 sha256，按 path 排序）。
 * skillRoot 为采集时刻的 skill 根绝对路径（校验侧按此拼回绝对路径——环境变量
 * 在校验时可能已指向别处，锚定采集时刻的根才可复算）。
 */
export interface FileManifest {
  /** 采集时刻 skill 根绝对路径 */
  skillRoot: string;
  /** 文件清单（按 path 排序） */
  files: FileManifestEntry[];
}

/** 版本链完整性判定 */
export interface ChainIntegrity {
  ok: boolean;
  /** 逐条失败原因（不 ok 时非空） */
  failures: string[];
}

/** 采集选项 */
export interface FourLayerCollectorOptions {
  /** 数据根目录（缺省 loadEnvConfig().dataDir） */
  dataDir?: string;
  /** 技能根覆盖（缺省 resolveSkillRoot()） */
  skillRoot?: string;
  /** 配置值视图覆盖（缺省从 process.env 装载 SOFAGENT_* 字段） */
  configValues?: Readonly<Record<string, unknown>>;
  /** 权重 manifest 引用覆盖（缺省走运行时软依赖解析） */
  weightsManifestRef?: string | null;
  /** 仓快照引用覆盖（复用既有 snapshot/restore 的回滚锚点） */
  repoSnapshotSha?: string | null;
  /** 时间注入（测试锚定用） */
  now?: () => string;
}

/** 生成快照选项 */
export interface CreateBaselineSnapshotOptions extends FourLayerCollectorOptions {
  /** 显式给定链（缺省从链文件读——用于确定 prevId） */
  chain?: BaselineSnapshot[];
  /** 是否落盘（缺省 true；测试可置 false） */
  persist?: boolean;
}

// ────────────────────────────────────────────────────────────
// 摘要工具
// ────────────────────────────────────────────────────────────

/** sha256 前 N 位 hex（v1.6.0 BUG-76：包内共享导出——validator-health 同款收敛，消灭复制漂移面） */
export function sha256Hex(input: string, len: number): string {
  return createHash('sha256').update(input).digest('hex').slice(0, len);
}

/** 解析数据根目录（显式 > loadEnvConfig().dataDir） */
function resolveDataDir(dataDir?: string): string {
  return dataDir ?? loadEnvConfig().dataDir;
}

/** 快照链文件路径：`${dataDir}/evolve/baseline-chain.jsonl` */
export function resolveBaselineChainPath(dataDir?: string): string {
  return join(resolveDataDir(dataDir), 'evolve', 'baseline-chain.jsonl');
}

// ────────────────────────────────────────────────────────────
// 四层采集
// ────────────────────────────────────────────────────────────

/**
 * 权重 manifest 引用解析（**运行时软依赖**）。
 *
 * 权重面的 manifest 验签属 `@sofagent/orchestrator`；evolve 不在 package.json 引入该
 * 依赖边。故经运行时全局钩子 `globalThis.__sofagentWeightsManifestRef` 取引用：
 * 生产接线方（orchestrator 侧）在进程内挂上当前 manifest 引用即可。未接线 ⇒ 如实记 null
 * + 原因（不假装有值——对齐「先出计划，接线后生效」的纪律）。
 */
export function resolveWeightsManifestRef(): WeightsLayerState {
  const slot = '__sofagentWeightsManifestRef';
  const v = (globalThis as unknown as Record<string, unknown>)[slot];
  if (typeof v === 'string' && v.trim() !== '') return { ref: v };
  return {
    ref: null,
    reason: `权重 manifest 引用未接线（运行时软依赖 globalThis.${slot} 未提供）——权重面回退归 manifest 验签面自身`,
  };
}

/** prompt 层：加载链四层配置字段 SSOT + 当前值视图的摘要版本 */
function collectPromptLayer(configValues?: Readonly<Record<string, unknown>>): PromptLayerState {
  const fields = LOAD_CHAIN_CONFIG_FIELDS;
  const values = configValues ?? loadChainConfigFromEnv(process.env);
  // 字段 SSOT（结构）与当前值视图（env 形字段）共同决定版本——任一变化即 version 变
  const payload =
    fields
      .map((f) => `${f.key}@${f.layer}:${f.type}=${String(f.default)}`)
      .sort()
      .join(';') + '||' + stableStringify(values as Record<string, unknown>);
  const layers = [...new Set(fields.map((f) => f.layer))].sort();
  return { version: `pc-${sha256Hex(payload, 16)}`, fieldCount: fields.length, layers };
}

/** skill 层：技能清单 + 健康分的摘要版本（只读——skipDebtWrite 不落台账） */
function collectSkillLayer(skillRootOverride?: string): SkillLayerState {
  const root = resolveSkillRoot(skillRootOverride);
  const report = generateHealthReport({ skillRoot: root, skipDebtWrite: true });
  const payload = report.skills
    .map((s) => `${s.skillPath}:${s.score.toFixed(4)}`)
    .sort()
    .join(';');
  return { version: `sk-${sha256Hex(payload, 16)}`, count: report.skills.length, root };
}

/** memory 层：事实锚点（key / factId / updatedAt / 值摘要） */
function collectMemoryAnchors(dataDir?: string): MemoryAnchor[] {
  const store = createMemoryStore(resolveDataDir(dataDir));
  const facts = store.list(undefined, { allScopes: true });
  return facts
    .map((f) => {
      const anchor: MemoryAnchor = {
        key: f.key,
        factId: f.id,
        updatedAt: f.updatedAt,
        hash: sha256Hex(f.value, 16),
      };
      if (f.scope !== undefined) anchor.scope = f.scope;
      return anchor;
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * 采集四层状态（只读既有实现取数）。
 * memory 为空的旧事实无 scope 字段 → 锚点省略 scope（零回归）。
 */
export function collectFourLayerState(opts: FourLayerCollectorOptions = {}): FourLayerState {
  const collectedAt = (opts.now ?? (() => new Date().toISOString()))();
  const weights =
    opts.weightsManifestRef !== undefined
      ? opts.weightsManifestRef === null
        ? { ref: null, reason: '调用方显式声明权重 manifest 引用不可得（传入 null）' }
        : { ref: opts.weightsManifestRef }
      : resolveWeightsManifestRef();
  return {
    prompt: collectPromptLayer(opts.configValues),
    skill: collectSkillLayer(opts.skillRoot),
    memoryAnchors: collectMemoryAnchors(opts.dataDir),
    weights,
    collectedAt,
    repoSnapshotSha: opts.repoSnapshotSha ?? null,
  };
}

/** 四层状态摘要（稳定序列化后 sha256，取 32 位 hex） */
export function computeStateHash(state: FourLayerState): string {
  return `sh-${sha256Hex(stableStringify(state as unknown as Record<string, unknown>), 32)}`;
}

// ────────────────────────────────────────────────────────────
// BUG-52：fileManifest 采集与双判
// ────────────────────────────────────────────────────────────

/**
 * 递归收集 skill 根下全部常规文件（.sofagent 文件面——prompt/skill 层实际
 * 落盘处）的相对路径 + 内容 sha256，按 path 排序。符号链接不跟随（防循环
 * 与意图外表态），目录本身不计。返回含根锚定（校验侧复算用）。
 */
export function collectFileManifest(skillRootOverride?: string): FileManifest {
  const root = resolveSkillRoot(skillRootOverride);
  const out: FileManifestEntry[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 根不存在/不可读 = 空清单（skill 层采集同款宽容语义）
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        try {
          const content = readFileSync(full);
          out.push({
            path: relative(root, full).split('\\').join('/'),
            sha256: createHash('sha256').update(content).digest('hex'),
          });
        } catch {
          // 单文件读失败跳过（不因一个坏文件炸整条快照链）
        }
      }
    }
  };
  walk(root);
  return {
    skillRoot: root,
    files: out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

// ────────────────────────────────────────────────────────────
// 版本链：生成 / 读取 / 寻址 / 完整性
// ────────────────────────────────────────────────────────────

/** 读快照链（文件不存在 = 空；坏行告警跳过，不静默） */
export function loadBaselineChain(dataDir?: string): BaselineSnapshot[] {
  const p = resolveBaselineChainPath(dataDir);
  if (!existsSync(p)) return [];
  const out: BaselineSnapshot[] = [];
  let lineNo = 0;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    lineNo++;
    try {
      out.push(JSON.parse(trimmed) as BaselineSnapshot);
    } catch (err) {
      // 留痕可见：坏行意味着链完整性存疑——必须让人看见，不静默吞。
      console.error(
        `[baseline-snapshot] ⚠️ 基线链第 ${lineNo} 行解析失败（该行不计入返回，链完整性存疑）：` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
}

/**
 * 生成一条能力基线快照并（缺省）落链。
 *
 * 步骤：① 读链头确定前驱 prevId；② 采集四层状态；③ 算 stateHash 与内容寻址 id；
 * ④ 落盘 append。
 *
 * id 内容寻址：`bs-<sha256(prevId|stateHash|kind|at|createdAt)[:16]>`——同前驱同状态
 * 同时刻必然同 id（可复算），不同时刻/不同前驱/不同状态必然不同 id（可寻址）。
 */
export function createBaselineSnapshot(
  trigger: CapabilityChangeEventInput,
  opts: CreateBaselineSnapshotOptions = {},
): BaselineSnapshot {
  // 快照生成时刻缺省 = 变更事件时刻（事件驱动——快照在能力变更当刻打点）；
  // 未给事件时刻时退回真实时间。
  const now = opts.now ?? (() => trigger.at ?? new Date().toISOString());
  const createdAt = now();
  const at = trigger.at ?? createdAt;
  const fullTrigger: CapabilityChangeEvent = { ...trigger, at };

  const chain = opts.chain ?? loadBaselineChain(opts.dataDir);
  const prevId = chain.length > 0 ? chain[chain.length - 1]!.id : null;

  const state = collectFourLayerState({ ...opts, now });
  const stateHash = computeStateHash(state);
  const id = `bs-${sha256Hex(
    [prevId ?? '∅', stateHash, fullTrigger.kind, fullTrigger.at, createdAt].join('|'),
    16,
  )}`;

  const snapshot: BaselineSnapshot = { id, createdAt, trigger: fullTrigger, state, stateHash, prevId };

  // BUG-52：快照落链时同步固化文件清单——prompt/skill 层实际文件（skill 根下）
  // 的根锚定+路径+内容哈希。verifySnapshotIntegrity 第二判据此发现「快照记录
  // 未改而磁盘文件被删/被改」的绕过路径。
  snapshot.fileManifest = collectFileManifest(opts.skillRoot);

  if (opts.persist !== false) {
    const p = resolveBaselineChainPath(opts.dataDir);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(snapshot) + '\n', 'utf-8');
  }
  return snapshot;
}

/**
 * 快照完整性自证（BUG-52 起双判）：
 * ① 重算 stateHash 与记录值比对（不一致 = 快照记录被篡改）；
 * ② fileManifest 存在时逐项 existsSync + 哈希重算比对——文件被删除或改动
 *    ⇒ ok:false（此前只改磁盘文件不动快照记录即可绕过第一判）。
 * legacy 快照（无 fileManifest）：跳过第二判，notice 标「legacy 快照无文件
 * 清单」——历史快照按当时语义放行（不判红），新快照一律带清单。
 */
export function verifySnapshotIntegrity(snapshot: BaselineSnapshot): SnapshotIntegrity {
  const recomputed = computeStateHash(snapshot.state);
  if (recomputed !== snapshot.stateHash) {
    return {
      ok: false,
      reason: `四层状态摘要不匹配：记录 ${snapshot.stateHash} / 重算 ${recomputed}——快照可能被篡改`,
    };
  }
  if (snapshot.fileManifest === undefined) {
    return { ok: true, notice: 'legacy 快照无文件清单（fileManifest）——第二判（文件删除/改动检出）不适用，仅第一判（stateHash）通过' };
  }
  const { skillRoot: root, files: manifest } = snapshot.fileManifest;
  if (manifest.length === 0) {
    // 快照时刻 skill 根为空/不存在——与 skill 层采集同款宽容语义，不判红
    return { ok: true, notice: '快照时刻文件清单为空（skill 根无文件）——第二判无对象' };
  }
  for (const entry of manifest) {
    // 路径 sanitize：manifest 里的相对路径拼回采集时刻的 skill 根；路径遍历形态
    // （../ 逃逸出根）按失配处理（清单与磁盘态失配的一类）
    const full = join(root, entry.path);
    if (!full.startsWith(root)) {
      return { ok: false, reason: `文件清单路径越界：${entry.path}（文件被删除或改动——清单与磁盘态失配）` };
    }
    if (!existsSync(full)) {
      return { ok: false, reason: `文件被删除或改动：${entry.path} 不存在（快照记录了 ${manifest.length} 个文件，第二判失配）` };
    }
    let current: string;
    try {
      current = createHash('sha256').update(readFileSync(full)).digest('hex');
    } catch {
      return { ok: false, reason: `文件被删除或改动：${entry.path} 读取失败（第二判失配）` };
    }
    if (current !== entry.sha256) {
      return { ok: false, reason: `文件被删除或改动：${entry.path} 内容哈希失配（记录 ${entry.sha256.slice(0, 12)}… / 磁盘 ${current.slice(0, 12)}…）` };
    }
  }
  return { ok: true };
}

/** 完整性校验失败（回滚被拒） */
export class BaselineIntegrityError extends Error {
  constructor(message: string) {
    super(`[baseline-snapshot] ${message}`);
    this.name = 'BaselineIntegrityError';
  }
}

/** 寻址失败（id 不存在 / 前缀歧义） */
export class BaselineNotFoundError extends Error {
  constructor(message: string) {
    super(`[baseline-snapshot] ${message}`);
    this.name = 'BaselineNotFoundError';
  }
}

/**
 * 按 id 寻址快照（支持短前缀寻址——如 git 短 sha 语义）。
 * 无匹配 ⇒ BaselineNotFoundError；前缀多匹配 ⇒ BaselineNotFoundError（要求更精确前缀）。
 */
export function getBaselineById(chain: readonly BaselineSnapshot[], idOrPrefix: string): BaselineSnapshot {
  const exact = chain.find((s) => s.id === idOrPrefix);
  if (exact) return exact;
  const matches = chain.filter((s) => s.id.startsWith(idOrPrefix));
  if (matches.length === 0) {
    throw new BaselineNotFoundError(`未找到快照：${idOrPrefix}（链内 ${chain.length} 条）`);
  }
  if (matches.length > 1) {
    throw new BaselineNotFoundError(
      `快照前缀「${idOrPrefix}」歧义，匹配 ${matches.length} 条：${matches.map((m) => m.id).join(', ')}——请给更精确的前缀`,
    );
  }
  return matches[0]!;
}

/**
 * 回溯任一时点能力状态：取 createdAt ≤ time 的最后一条快照（时间倒序链上最近的前驱）。
 * 无早于该时刻的快照 ⇒ null。
 */
export function resolveBaselineAt(chain: readonly BaselineSnapshot[], isoTime: string): BaselineSnapshot | null {
  const t = new Date(isoTime).getTime();
  let found: BaselineSnapshot | null = null;
  for (const s of chain) {
    if (new Date(s.createdAt).getTime() <= t) found = s;
  }
  return found;
}

/** 版本链完整性判定：逐条自证 stateHash + 逐条校验前驱指针 */
export function verifyBaselineChain(chain: readonly BaselineSnapshot[]): ChainIntegrity {
  const failures: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const s = chain[i]!;
    const integ = verifySnapshotIntegrity(s);
    if (!integ.ok) failures.push(`#${i} ${s.id}：${integ.reason ?? '完整性未知'}`);
    const expectedPrev = i === 0 ? null : chain[i - 1]!.id;
    if (s.prevId !== expectedPrev) {
      failures.push(`#${i} ${s.id}：前驱指针断裂——记录 prevId=${String(s.prevId)}，期望 ${String(expectedPrev)}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

// ────────────────────────────────────────────────────────────
// 回滚：复用既有 snapshot/restore 语义 + decision-log 留痕
// ────────────────────────────────────────────────────────────

/** 单层恢复指令（复用机制的显式声明——供举证与注入执行） */
export interface BaselineRestoreDirective {
  layer: BaselineLayer;
  /** 复用的既有机制 */
  mechanism: 'snapshot-restore' | 'memory-store' | 'manifest-ref';
  /** 恢复目标（仓快照 sha / 锚点数 / manifest 引用） */
  target: string;
  /** 说明 */
  note: string;
}

/** 恢复计划（四层逐项） */
export interface BaselineRestorePlan {
  snapshotId: string;
  createdAt: string;
  directives: BaselineRestoreDirective[];
}

/** 恢复结果 */
export interface BaselineRestoreOutcome {
  /** 实际执行了恢复的层 */
  restored: BaselineLayer[];
  /** 只引用 / 未执行动作的层 */
  skipped: BaselineLayer[];
  /** 逐层说明（含失败原因——不静默） */
  notes: string[];
}

/** 恢复执行器（注入点——生产接既有 snapshot/restore，测试可注入探针） */
export type BaselineRestorer = (plan: BaselineRestorePlan) => BaselineRestoreOutcome;

/** 判定模式恢复器（默认兜底）：只回传计划，不做副作用——恢复动作交注入方执行 */
export const advisoryBaselineRestorer: BaselineRestorer = (plan) => ({
  restored: [],
  skipped: plan.directives.map((d) => d.layer),
  notes: ['判定模式：恢复动作复用既有 snapshot/restore，由注入的 restorer 执行（默认不出副作用）'],
});

/**
 * 构造一个**真正复用 core 既有 snapshot/restore** 的恢复器。
 *
 * — prompt / skill 层（仓内文件）走 core 的 `restoreSnapshot(projectDir, sha)`
 *   （git shadow-repo 快照语义，与审计后自动快照同一套机制）；
 * — memory 层由锚点核对（`reconcileMemoryAnchors`）确认漂移，值落点复用 memory-store；
 * — weights 层只引用（回退归 manifest 验签面自身）。
 *
 * 任一层失败不抛（如实记入 notes，供 decision-log 举证），使留痕总能落。
 */
export function createCoreSnapshotRestorer(projectDir: string, dataDir?: string): BaselineRestorer {
  return (plan) => {
    const restored: BaselineLayer[] = [];
    const skipped: BaselineLayer[] = [];
    const notes: string[] = [];
    for (const d of plan.directives) {
      if (d.layer === 'prompt' || d.layer === 'skill') {
        if (d.target === '(无仓快照)') {
          skipped.push(d.layer);
          notes.push(`${d.layer}：无仓快照引用（state.repoSnapshotSha=null），跳过文件层恢复`);
        } else {
          try {
            const files = restoreSnapshot(projectDir, d.target);
            restored.push(d.layer);
            notes.push(`${d.layer}：restoreSnapshot 恢复 ${files.length} 个文件（sha=${d.target.slice(0, 8)}）`);
          } catch (err) {
            skipped.push(d.layer);
            notes.push(`${d.layer}：restoreSnapshot 失败——${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } else if (d.layer === 'memory') {
        try {
          const recon = reconcileMemoryAnchors(plan.snapshotId, dataDir);
          restored.push(d.layer);
          notes.push(
            `memory：锚点核对 matched=${recon.matched.length} / drifted=${recon.drifted.length} / missing=${recon.missing.length}`,
          );
        } catch (err) {
          skipped.push(d.layer);
          notes.push(`memory：锚点核对失败——${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        skipped.push(d.layer);
        notes.push(`weights：只引用（${d.target}），回退归 manifest 验签面自身`);
      }
    }
    return { restored, skipped, notes };
  };
}

/** 回滚记录（可举证——引用快照 id + 恢复计划 + 留痕时刻） */
export interface BaselineRollbackRecord {
  /** 被回滚到的快照 id */
  snapshotId: string;
  /** 回滚时刻（ISO） */
  rolledBackAt: string;
  /** 发起人 */
  actor: string;
  /** 四层恢复计划 */
  plan: BaselineRestorePlan;
  /** 恢复结果 */
  outcome: BaselineRestoreOutcome;
  /** decision-log 留痕时刻（writer 返回 null = 留痕缺失，如实暴露） */
  decisionLogTs: string | null;
}

/** 回滚选项 */
export interface RollbackToBaselineOptions {
  /** 显式链（缺省从链文件读） */
  chain?: BaselineSnapshot[];
  dataDir?: string;
  /** 仓工程目录（供 createCoreSnapshotRestorer 复用既有 snapshot/restore） */
  projectDir?: string;
  /** 恢复执行器（缺省：给了 projectDir 走 core snapshot-restore，否则判定模式） */
  restorer?: BaselineRestorer;
  /** decision-log writer（缺省：复用同包 createCoreDecisionWriter——接 core emitAuditDecision） */
  writer?: DecisionWriter;
  /** 发起人（缺省 'baseline-rollback'） */
  actor?: string;
  now?: () => string;
}

// ── decision-log 缺省 writer（收口——不另立第二份包装）──
// core 已 @public 导出 emitAuditDecision（v1.5.9 收口，此前是导出面缺口）；本模块的
// 缺省 writer 直接复用同包 promotion-policy 的 createCoreDecisionWriter（静态 import core，
// 内部已 fail-open：解析不到 / 写入抛错 ⇒ null + stderr），不重复一份软依赖包装。
// 回滚路径的健壮性诉求与晋级路径一致——留痕失败不阻断主路径，缺失由 null 如实暴露。

/** 构造四层恢复计划（prompt/skill 复用仓快照；memory 走 memory-store；weights 只引用） */
export function buildRestorePlan(snapshot: BaselineSnapshot): BaselineRestorePlan {
  const repo = snapshot.state.repoSnapshotSha;
  const repoTarget = repo ?? '(无仓快照)';
  return {
    snapshotId: snapshot.id,
    createdAt: snapshot.createdAt,
    directives: [
      {
        layer: 'prompt',
        mechanism: 'snapshot-restore',
        target: repoTarget,
        note: 'prompt 配置版本（加载链四层）经既有 git shadow-repo 快照恢复',
      },
      {
        layer: 'skill',
        mechanism: 'snapshot-restore',
        target: repoTarget,
        note: 'skill 集合版本经既有 git shadow-repo 快照恢复',
      },
      {
        layer: 'memory',
        mechanism: 'memory-store',
        target: `${snapshot.state.memoryAnchors.length} 个事实锚点`,
        note: 'memory 事实锚点核对（值落点复用 memory-store 既有 per-fact 文件）',
      },
      {
        layer: 'weights',
        mechanism: 'manifest-ref',
        target: snapshot.state.weights.ref ?? '(未接线)',
        note: '权重 manifest 引用只引用（回退归 manifest 验签面自身）',
      },
    ],
  };
}

/**
 * 按快照 id 回滚四层状态（**复用既有 snapshot/restore 语义，不新建回退机制**）。
 *
 * 拒绝回滚被篡改的快照（fail-closed：先自证 stateHash）。
 * 回滚动作本身落 decision-log（kind=EVOLUTION / moment=EVOLVE）——**先恢复、后留痕**，
 * 留痕失败不阻断（writer 返回 null 时如实暴露）。
 */
export function rollbackToBaseline(
  idOrSnapshot: string | BaselineSnapshot,
  opts: RollbackToBaselineOptions = {},
): BaselineRollbackRecord {
  const chain = opts.chain ?? loadBaselineChain(opts.dataDir);
  const snapshot = typeof idOrSnapshot === 'string' ? getBaselineById(chain, idOrSnapshot) : idOrSnapshot;

  const integ = verifySnapshotIntegrity(snapshot);
  if (!integ.ok) {
    throw new BaselineIntegrityError(`拒绝回滚被篡改的快照 ${snapshot.id}：${integ.reason ?? '完整性未知'}`);
  }

  const plan = buildRestorePlan(snapshot);
  const restorer = opts.restorer ?? (opts.projectDir ? createCoreSnapshotRestorer(opts.projectDir, opts.dataDir) : advisoryBaselineRestorer);
  const outcome = restorer(plan);

  const writer = opts.writer ?? createCoreDecisionWriter(opts.dataDir !== undefined ? { dataDir: opts.dataDir } : {});
  const rolledBackAt = (opts.now ?? (() => new Date().toISOString()))();
  const actor = opts.actor ?? 'baseline-rollback';
  const written = writer({
    kind: 'EVOLUTION',
    moment: 'EVOLVE',
    why:
      `能力基线回滚：按快照 ${snapshot.id} 恢复四层状态` +
      `（触发变更 ${snapshot.trigger.kind} · 源 ${snapshot.trigger.source} · 时刻 ${snapshot.trigger.at}）；` +
      `实际恢复 [${outcome.restored.join(', ') || '无'}] / 只引用 [${outcome.skipped.join(', ') || '无'}]——` +
      `举证：事故可归因到该基线`,
    evidence: [
      `snapshotId=${snapshot.id}`,
      `stateHash=${snapshot.stateHash}`,
      `prevId=${String(snapshot.prevId)}`,
      `prompt=${snapshot.state.prompt.version}`,
      `skill=${snapshot.state.skill.version}`,
      `memoryAnchors=${snapshot.state.memoryAnchors.length}`,
      `weightsRef=${String(snapshot.state.weights.ref)}`,
      `actor=${actor}`,
    ],
  });

  return {
    snapshotId: snapshot.id,
    rolledBackAt,
    actor,
    plan,
    outcome,
    decisionLogTs: written ? written.ts : null,
  };
}

// ────────────────────────────────────────────────────────────
// 举证面：快照 id 可被引证记录引用
// ────────────────────────────────────────────────────────────

/** 引证记录（「事故发生在基线 X 下」——能力版本可举） */
export interface BaselineCitation {
  /** 被引证的快照 id */
  snapshotId: string;
  /** 引证时刻（ISO） */
  citedAt: string;
  /** 引证理由（如「事故发生在基线 X 下」） */
  reason: string;
  /** 被引证快照的四层状态摘要（一眼可读） */
  stateSummary: {
    promptVersion: string;
    skillVersion: string;
    memoryAnchorCount: number;
    weightsRef: string | null;
    repoSnapshotSha: string | null;
  };
}

/**
 * 生成一条引证记录：把「某事件发生在某能力基线之下」落成可举证条目。
 * 引证前先自证快照完整性（举证材料不可被篡改）。
 */
export function citeBaseline(
  chain: readonly BaselineSnapshot[],
  idOrPrefix: string,
  reason: string,
  now?: () => string,
): BaselineCitation {
  const snapshot = getBaselineById(chain, idOrPrefix);
  const integ = verifySnapshotIntegrity(snapshot);
  if (!integ.ok) {
    throw new BaselineIntegrityError(`引证的快照 ${snapshot.id} 完整性存疑：${integ.reason ?? '完整性未知'}`);
  }
  return {
    snapshotId: snapshot.id,
    citedAt: (now ?? (() => new Date().toISOString()))(),
    reason,
    stateSummary: {
      promptVersion: snapshot.state.prompt.version,
      skillVersion: snapshot.state.skill.version,
      memoryAnchorCount: snapshot.state.memoryAnchors.length,
      weightsRef: snapshot.state.weights.ref,
      repoSnapshotSha: snapshot.state.repoSnapshotSha,
    },
  };
}

// ────────────────────────────────────────────────────────────
// memory 锚点核对（回滚期确认漂移——复用 memory-store 只读取数）
// ────────────────────────────────────────────────────────────

/** 锚点核对结果 */
export interface MemoryAnchorReconcile {
  /** 与当前一致（factId 与内容摘要均命中） */
  matched: string[];
  /** 存在但内容已变（同 key 漂移） */
  drifted: string[];
  /** 当前已不存在 */
  missing: string[];
}

/**
 * 按快照的 memory 锚点核对当前记忆：
 *   · key 与 factId 命中且值摘要一致 ⇒ matched；
 *   · key 命中但值摘要不一致 ⇒ drifted；
 *   · key 不在当前记忆 ⇒ missing。
 * 只读 memory-store，不改数据。
 */
export function reconcileMemoryAnchors(snapshotId: string, dataDir?: string): MemoryAnchorReconcile {
  const chain = loadBaselineChain(dataDir);
  const snapshot = getBaselineById(chain, snapshotId);
  const current = new Map(
    createMemoryStore(resolveDataDir(dataDir))
      .list(undefined, { allScopes: true })
      .map((f) => [f.key, f] as const),
  );
  const matched: string[] = [];
  const drifted: string[] = [];
  const missing: string[] = [];
  for (const a of snapshot.state.memoryAnchors) {
    const f = current.get(a.key);
    if (!f) {
      missing.push(a.key);
    } else if (f.id === a.factId && sha256Hex(f.value, 16) === a.hash) {
      matched.push(a.key);
    } else {
      drifted.push(a.key);
    }
  }
  return { matched, drifted, missing };
}
