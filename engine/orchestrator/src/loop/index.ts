// ============================================================
// FORGE barrel export
// v1.5.5：StateGraph 单任务 FORGE + Workflow 两类消费入口
//
// 编排智能来自外部平台（WorkBuddy 等），sofagent FORGE 负责执行层。
// checkpoint 保留在 graph/ 下（被 daemon 和 FORGE 共用）。
//
// ── 定位边界（v1.4.8 条目 10）──
// 本域 = LOOP StateGraph 单任务 FORGE：状态机为
// engineer → audit → reviewer → human_confirm 四节点图，判据 = audit
// 对错门禁（PASS/WARN/FAIL）+ reviewer IS_PASS。
// 与 loop-agent/（工程级崩溃判定）、refine-agent/（质量好坏判据）的判据与
// 状态机均不同——三者各自独立，不合并。
// ============================================================

// State（v1.5.5 章五：纯类型 + 纯函数——state.ts 已零 LangGraph 依赖，可静态导出）
export {
  emptyArtifacts,
  type LoopGraphState,
  type LoopArtifacts,
  type LoopNodeName,
  type LoopFinalStatus,
  type AuditVerdict,
} from './state';

// Nodes & Dependencies
export {
  defaultDeps,
  makeEngineerNode,
  makeAuditNode,
  makeReviewerNode,
  makeHumanConfirmNode,
  parseReviewerPass,
  resolveLLMModel,
  resolveMaxTurns,
  DEFAULT_MAX_RETRIES,
  DEFAULT_ENGINEER_MAX_TURNS,
  DEFAULT_REVIEWER_MAX_TURNS,
  type LoopGraphDeps,
  type AuditOutcome,
  type HumanDecision,
} from './nodes';

// Graph & Routing（单任务 FORGE）—— v1.5.5 章五：graph.ts 静态依赖
// @langchain/langgraph（StateGraph/Annotation），为保 dsh-only 裁剪安装态零 LangGraph
// import，运行时函数不再静态 re-export。
// 🔴 v1.5.5 阶段三 F3/F4 注释如实化（实现以本注释为准——此前「惰性 getter /
//    属性访问语义不变」的描述与实现不符）：运行时符号经 `loadLoopGraphRuntime()`
//    **异步解析**（返回 Promise，消费方须 await——如 mcp hitl-resolve 先
//    `await mod.loadLoopGraphRuntime()` 再取 runLoopGraph/resumeLoopGraph）。
//    v1.5.4 的 7 个静态导出形态已变更为异步入口＝**破坏性变更**（见 devlog 章五）。
// 类型经 `import type` 静态导出（编译期擦除，运行时零加载）。
// 缺失时加载面抛 LANGGRAPH_MISSING_GUIDE（含安装/切换指引，非静默）。
export type { LoopGraphResult, LoopGraphOptions } from './graph';

type LoopGraphModule = typeof import('./graph');

let loopGraphPromise: Promise<LoopGraphModule> | null = null;

/** 异步加载面（内部）：缺失时翻译为 LANGGRAPH_MISSING_GUIDE（含安装/切换指引） */
function loadLoopGraphAsync(): Promise<LoopGraphModule> {
  if (!loopGraphPromise) {
    loopGraphPromise = import('./graph').catch((err) => {
      loopGraphPromise = null; // 失败不缓存——下次访问重试
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const guard = require('../execution-state/lazy-langgraph') as
        typeof import('../execution-state/lazy-langgraph');
      if (guard.isModuleMissing(err)) throw new Error(guard.LANGGRAPH_MISSING_GUIDE);
      throw err;
    });
  }
  return loopGraphPromise;
}

export { loadLoopGraphAsync };

/** 对外语义名：解析 loop graph 运行时面（缺失时报 LANGGRAPH_MISSING_GUIDE） */
export function loadLoopGraphRuntime(): Promise<LoopGraphModule> {
  return loadLoopGraphAsync();
}

// v1.2.4 P2b：Checker 节点
export {
  makeFormatCheckerNode,
  makeFactCheckerNode,
  makeSourceValidatorNode,
  makeCheckerNode,
  resolveLoopMode,
  recordCheckerFailures,
  DEFAULT_LOOP_CONTROL,
  type CheckerResult,
  type ControlledLoopMode,
  type LoopControlConfig,
} from './checker-nodes';
