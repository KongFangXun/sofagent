// ============================================================
// events/should-run.ts · 运行时 should-run 判定链（v1.5.2 第三章新建）
// ============================================================
//
// 节点执行前统一「五问」：健康 → 人审 gate → 证据等待 → 专注等待 → 配额。
// 任一问不通过即**挂起等待**——挂起不是失败：不投递、不进死信，条件满足后
// 自动恢复执行（对齐「只提示不阻断」）。
//
// 与 v1.5.2 事件总线的集成点：`EventBusOptions.shouldRunGate`——在 `publish()`
// 落盘队列之后、投递订阅者之前调用。**未注入时行为与 v1.5.2 完全一致**
// （零行为变化）——本文件是纯新增能力，不改总线既有语义。
//
// 判定顺序**固定且显式**（fail-fast，首个不通过即报告）：顺序本身是契约——
// 「健康」先于「人审」（带病进程不该先问审批）、「人审」先于「证据」（人没批
// 就别谈证据就绪）、「证据」先于「专注」（输入没就绪不该占专注窗口）、
// 「专注」先于「配额」（本地排期先于花钱）。改序 = 改语义，故用常量固化并
// 由测试锁定。
// ============================================================

import type { SofagentEvent } from './types';

// ────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────

/**
 * 五问标识。
 *
 * 各问语义与能力锚点：
 *   · `health`     —— 防「带病派发」：进程/依赖/断路器处于不可执行态时派发
 *                     只会连环失败。锚定既有能力：断路器
 *                     `sandbox/circuit-breaker.ts` 的 `canAcceptTask(agentId)`
 *                     （v1.3.x 超阈值自动隔离、切回人工模式）与 MCP
 *                     `health_check` 工具（环境健康检查）。
 *   · `human-gate` —— 防「绕过人审自动执行」：声明需人工批准的节点不得被事件
 *                     自动派发。锚定既有能力：`node-executor.ts` 的 `checkHITL`
 *                     与 `hitl-handler.ts` 的 `before()`（拦截即挂起等人工，
 *                     非失败——对齐 `awaiting_human` 挂起语义）。
 *   · `evidence`   —— 防「证据未就绪就执行」：上游证据/输入未落定（如依赖产出
 *                     缺失）时等待。语义锚定既有审计证据体系
 *                     （`engine/audit/src/evidence-mode.ts` / evidence 验签）。
 *                     ⚠️ 判定逻辑**是本版新引入的派发判定位**——既有 evidence
 *                     体系提供证据的「写与验」，但**没有**现成的运行时
 *                     「证据是否就绪 → 阻不阻断派发」判定，此处如实说明是新增
 *                     判定位，非蹭既有常量。
 *   · `focus`      —— 防「多任务并发抢专注」：同一专注窗口内不并行派发
 *                     （单线程专注/串行执行纪律）。语义可关联仓库既有的并发写
 *                     纪律（`engine/audit/src/concurrent-git-discipline.ts` 的
 *                     并发写检测），但**判定逻辑是本版新引入的判定位**——仓内
 *                     无现成「专注窗口」运行时常量，如实说明。
 *   · `quota`      —— 防「超预算继续烧钱」：配额耗尽时挂起等配额恢复/人工放行。
 *                     锚定既有能力：决策种类 `DecisionKind='COST'`（v1.4.0 交付
 *                     三 budget 超支 WARN，`queryByKind('COST')` 可追溯）。
 */
export type ShouldRunQuestion = 'health' | 'human-gate' | 'evidence' | 'focus' | 'quota';

/** 单问判定结果（可注入、可独立测） */
export interface ShouldRunCheck {
  /** 该问是否通过（true = 放行） */
  ok: boolean;
  /** 不通过时的详情（落 decision-log 的 why.text 主体） */
  detail?: string;
  /** 恢复提示（条件满足后自动恢复的触发条件；缺省按问取内置文案） */
  resumeHint?: string;
}

/** 五问判定输入（各问可注入、可独立测） */
export interface ShouldRunState {
  health: ShouldRunCheck;
  humanGate: ShouldRunCheck;
  evidence: ShouldRunCheck;
  focus: ShouldRunCheck;
  quota: ShouldRunCheck;
}

/** 挂起详情（不通过的那一问 + 原因 + 恢复提示） */
export interface ShouldRunSuspension {
  /** 未通过的那一问（fail-fast 首个） */
  question: ShouldRunQuestion;
  /** 挂起原因（人类可读） */
  reason: string;
  /** 恢复提示（条件满足后自动恢复的触发条件） */
  resumeHint: string;
}

/** 判定结果（run=false 时必带 suspended） */
export interface ShouldRunResult {
  /** 是否应执行（true = 放行派发） */
  run: boolean;
  /** 挂起详情（run=false 时） */
  suspended?: ShouldRunSuspension;
}

// ────────────────────────────────────────────────────────────
// 固定判定顺序（契约）
// ────────────────────────────────────────────────────────────

/** 五问判定顺序（fail-fast——首个不通过即挂起并如实报告是哪一问） */
export const SHOULD_RUN_ORDER: readonly ShouldRunQuestion[] = [
  'health',
  'human-gate',
  'evidence',
  'focus',
  'quota',
] as const;

/** 问题 → ShouldRunState 字段名映射 */
const STATE_KEY: Record<ShouldRunQuestion, keyof ShouldRunState> = {
  health: 'health',
  'human-gate': 'humanGate',
  evidence: 'evidence',
  focus: 'focus',
  quota: 'quota',
};

/** 各问「在防什么」——挂起原因的内置文案（探针未给 detail 时用） */
const DEFAULT_REASON: Record<ShouldRunQuestion, string> = {
  health: '健康检查未通过（进程/依赖/断路器处于不可执行态）——带病派发只会连环失败',
  'human-gate': '该节点声明需人工批准，人审尚未通过——不得被事件自动派发',
  evidence: '上游证据/输入尚未就绪——证据未落定就执行会产出无据结论',
  focus: '当前专注窗口被占用——并发派发会争抢专注、破坏串行执行纪律',
  quota: '配额/预算已耗尽——继续派发会超支（对齐 COST 超支告警）',
};

/** 各问恢复提示的内置文案（探针未给 resumeHint 时用） */
const DEFAULT_RESUME_HINT: Record<ShouldRunQuestion, string> = {
  health: '健康检查恢复后自动重试派发（断路器 canAcceptTask 转 true）',
  'human-gate': '人工审批通过后自动恢复（HITL awaiting_human → approved）',
  evidence: '上游证据落定后自动恢复',
  focus: '当前专注窗口释放后自动恢复',
  quota: '配额恢复或人工放行后自动恢复',
};

// ────────────────────────────────────────────────────────────
// 判定（纯函数）
// ────────────────────────────────────────────────────────────

/**
 * 五问判定链——固定顺序、fail-fast、纯函数。
 *
 * 遍历 `SHOULD_RUN_ORDER`，首个 `ok=false` 的问答即返回挂起（如实报告是哪一问
 * 未通过）；五问全过则 `run=true`。
 *
 * @param state 五问判定输入
 * @returns 判定结果（run=false 时带 suspended）
 */
export function shouldRun(state: ShouldRunState): ShouldRunResult {
  for (const question of SHOULD_RUN_ORDER) {
    const check = state[STATE_KEY[question]];
    if (!check.ok) {
      return {
        run: false,
        suspended: {
          question,
          reason: check.detail ?? DEFAULT_REASON[question],
          resumeHint: check.resumeHint ?? DEFAULT_RESUME_HINT[question],
        },
      };
    }
  }
  return { run: true };
}

// ────────────────────────────────────────────────────────────
// 可注入探针 → gate 工厂
// ────────────────────────────────────────────────────────────

/**
 * 单问探针——采集该问的当前状态（同步或异步）。
 *
 * 探针由宿主按真实能力接线（health → 断路器 canAcceptTask；human-gate →
 * HITL 待审队列；evidence → 上游证据落点；focus → 专注窗口；quota → 预算余量）。
 */
export type ShouldRunProbe = (event: SofagentEvent) => ShouldRunCheck | Promise<ShouldRunCheck>;

/** 探针集合——**缺省的问按「通过」处理**（未接线的问不阻断，零行为变化） */
export interface ShouldRunProbes {
  health?: ShouldRunProbe;
  'human-gate'?: ShouldRunProbe;
  evidence?: ShouldRunProbe;
  focus?: ShouldRunProbe;
  quota?: ShouldRunProbe;
}

/** 派发前置判定器（EventBusOptions.shouldRunGate 取值） */
export type ShouldRunGate = (event: SofagentEvent) => ShouldRunResult | Promise<ShouldRunResult>;

/**
 * 由探针集合组装派发前置判定器。
 *
 * 语义：按 `SHOULD_RUN_ORDER` 采集五问状态 → `shouldRun()` 判定。
 * 未提供探针的问视为「通过」——宿主只接线关心的问，其余不阻断。
 *
 * @param probes 五问探针（可部分提供）
 * @returns ShouldRunGate（喂给 EventBusOptions.shouldRunGate）
 */
export function createShouldRunGate(probes: ShouldRunProbes = {}): ShouldRunGate {
  return async (event: SofagentEvent): Promise<ShouldRunResult> => {
    const state: ShouldRunState = {
      health: { ok: true },
      humanGate: { ok: true },
      evidence: { ok: true },
      focus: { ok: true },
      quota: { ok: true },
    };
    for (const question of SHOULD_RUN_ORDER) {
      const probe = probes[question];
      if (!probe) continue; // 未接线 → 该问恒通过（零行为变化纪律）
      state[STATE_KEY[question]] = await probe(event);
    }
    return shouldRun(state);
  };
}

// ────────────────────────────────────────────────────────────
// 生产装配：默认 gate（从真实状态源构建）+ EventBus options
// ────────────────────────────────────────────────────────────

/**
 * 默认 gate 的真实状态源依赖。
 *
 * 🔴 **降级铁律**：任一状态源「不可得（未提供）/ 未配置 / 抛错 / 取不到事件标识」
 *    时，该问一律判**通过**（permissive）——**绝不因缺少数据而挂起生产事件**。
 *    这条铁律保证「默认态（干净数据 + 未接新状态源）下生产行为与接线前逐字一致」。
 *
 * 状态源与降级行为：
 *   · `circuitBreaker`（health）——提供时 `canAcceptTask(agentId)===false` 才挂起；
 *     缺省 / 抛错 / 无 agentId → 通过。
 *   · `listAgents`（human-gate）——提供时目标节点 agent 定义 `hitl===true` 才挂起
 *     （对齐 `node-executor.ts` 的 checkHITL 判定依据）；缺省 / 抛错 / 无节点 id → 通过。
 *   · `queryCostDecisions`（quota）——提供时存在 COST 配额告警记录才挂起（对齐
 *     `DecisionKind='COST'` 超支 WARN 可查态）；缺省 / 抛错 → 通过。
 *   · `evidence` / `focus`——**新引入判定位**（仓内无「证据就绪」「专注窗口」运行时
 *     常量，已在 ShouldRunQuestion 注释如实标注），缺省一律恒通过；保留可覆盖接口。
 */
export interface DefaultShouldRunGateDeps {
  /** 数据目录（human-gate / quota 状态源读取用） */
  dataDir: string;
  /**
   * 断路器（health 源）。提供时用 `canAcceptTask(agentId)` 判定该 agent 是否可接新
   * 任务（隔离 / 熔断态 → 不可接受 → 挂起）。缺省 → health 恒通过。
   */
  circuitBreaker?: { canAcceptTask(agentId: string): boolean };
  /**
   * 企业 agent 定义读取（human-gate 源）。提供时按事件目标节点的 agent 定义
   * `hitl === true` 判定「需人审且未审批通过 → 挂起」。缺省 → human-gate 恒通过。
   */
  listAgents?: (dataDir: string) => ReadonlyArray<{ name: string; hitl?: boolean }>;
  /**
   * COST 决策查询（quota 源）。提供时按「存在 COST 配额告警记录」判定配额耗尽。
   * 缺省 → quota 恒通过。
   *
   * ⚠️ 保守近似：本判定只看「是否存在 COST 记录」，不解析其内容；宿主若接入真实
   * 预算源应替换本依赖（接口留出）。存在历史 COST 记录时会持续挂起——这是「配额
   * 告警需人工处置」的保守语义（挂起非失败，事件不丢）。
   */
  queryCostDecisions?: (dataDir: string) => ReadonlyArray<unknown>;
  /** 可选覆盖 evidence 探针（缺省恒通过——新引入判定位，无运行时常量） */
  evidence?: ShouldRunProbe;
  /** 可选覆盖 focus 探针（缺省恒通过——新引入判定位，无运行时常量） */
  focus?: ShouldRunProbe;
}

/** 读事件 metadata 里的字符串字段（空串视为缺省） */
function metaString(event: SofagentEvent, key: string): string | undefined {
  const v = event.metadata?.[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * 包一层「降级铁律」：探针缺省或抛错 → 判通过（绝不因缺数据挂起生产事件）。
 */
function permissiveProbe(probe: ShouldRunProbe | undefined): ShouldRunProbe {
  return async (event: SofagentEvent): Promise<ShouldRunCheck> => {
    if (!probe) return { ok: true };
    try {
      return await probe(event);
    } catch {
      return { ok: true }; // 铁律：状态源异常/不可读 → 放行
    }
  };
}

/**
 * 默认 gate 工厂——从**真实状态源**构建五问探针（生产接线用）。
 *
 * 与 `createShouldRunGate` 的分工：后者面向「纯探针注入」（测试 / 定制），本工厂
 * 面向「真实状态源依赖注入」，并内建降级铁律。宿主只提供拿得到的状态源，其余
 * 各问自动恒通过。
 *
 * @param deps 真实状态源依赖（可部分提供）
 * @returns ShouldRunGate（喂给 EventBusOptions.shouldRunGate）
 */
export function createDefaultShouldRunGate(deps: DefaultShouldRunGateDeps): ShouldRunGate {
  // health ← 断路器 canAcceptTask（隔离/熔断态挂起）
  const health: ShouldRunProbe = (event) => {
    const cb = deps.circuitBreaker;
    if (!cb) return { ok: true };
    const agentId = metaString(event, 'agentId') ?? event.targetNodeId;
    if (agentId === undefined) return { ok: true };
    if (cb.canAcceptTask(agentId)) return { ok: true };
    return {
      ok: false,
      detail: `断路器不可接任务（agent=${agentId}：隔离 / 熔断态）`,
      resumeHint: '断路器 recover() 复位或冷却期满 half-open 后自动恢复',
    };
  };

  // human-gate ← 企业 agent 定义的 hitl 标记（对齐 node-executor checkHITL 判定依据）
  const humanGate: ShouldRunProbe = (event) => {
    const list = deps.listAgents;
    if (!list) return { ok: true };
    const nodeId = event.targetNodeId ?? metaString(event, 'nodeId');
    if (nodeId === undefined) return { ok: true };
    const def = list(deps.dataDir).find((a) => a.name === nodeId);
    if (def?.hitl === true) {
      return {
        ok: false,
        detail: `节点 ${nodeId} 标记 HITL 且尚未审批通过`,
        resumeHint: '人工审批通过（HITL 审批写入）后自动恢复',
      };
    }
    return { ok: true };
  };

  // quota ← COST 决策可查态（存在配额告警 → 挂起）
  const quota: ShouldRunProbe = () => {
    const query = deps.queryCostDecisions;
    if (!query) return { ok: true };
    const hits = query(deps.dataDir);
    if (hits.length > 0) {
      return {
        ok: false,
        detail: `存在未清的 COST 配额告警（${hits.length} 条）——配额可能已耗尽`,
        resumeHint: '配额恢复 / 人工处置并清理 COST 告警后自动恢复',
      };
    }
    return { ok: true };
  };

  return createShouldRunGate({
    health: permissiveProbe(health),
    'human-gate': permissiveProbe(humanGate),
    evidence: permissiveProbe(deps.evidence),
    focus: permissiveProbe(deps.focus),
    quota: permissiveProbe(quota),
  });
}

/** 事件总线 options 组装结果（与 EventBusOptions 结构化兼容） */
export interface EnterpriseEventBusOptions {
  dataDir: string;
  shouldRunGate: ShouldRunGate;
}

/**
 * 组装生产 EventBus options——把五问判定链接入**唯一的生产 EventBus 构造点**
 * （`cli.ts` run-enterprise 路径）。
 *
 * 抽出为纯函数的目的：让「生产装配确实注入了 shouldRunGate」可被测试直接断言
 * （而非只能读 cli.ts 源码）；cli.ts 只负责解析真实依赖后转调本函数。
 *
 * @param deps 真实状态源依赖
 * @returns `{ dataDir, shouldRunGate }`
 */
export function buildEnterpriseEventBusOptions(deps: DefaultShouldRunGateDeps): EnterpriseEventBusOptions {
  return {
    dataDir: deps.dataDir,
    shouldRunGate: createDefaultShouldRunGate(deps),
  };
}
