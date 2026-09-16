// ============================================================
// loop/deps-types.ts · LOOP 节点依赖注入契约（v1.4.9 深模块条目 4）
// ============================================================
// 从 nodes.ts 迁出（原位 234-293 行）：节点依赖接口与结果类型独立成件，
// 让「默认依赖实现」（deps-defaults.ts）与「节点工厂」（nodes.ts）共享
// 同一契约声明而互不反向依赖——避免 nodes ↔ deps-defaults 形成运行时环。
//
// nodes.ts 原样 re-export 本文件符号——loop/index.ts 与测试的既有导入面不变。
// ============================================================
import type { AuditVerdict, LoopArtifacts, LoopGraphState } from './state';
import type { FileCheckpointer } from '../graph/checkpoint';
import type { WorktreeHandle } from '../worktree-isolation';

/** audit 节点产出 */
export interface AuditOutcome {
  verdict: AuditVerdict;
  report: string;
}

/** HITL 确认结果：y=通过 / n=驳回 / abort=中断（stdin 关闭等） */
export type HumanDecision = 'y' | 'n' | 'abort';

/**
 * 节点依赖注入接口——默认实现见 defaultDeps()，测试可整体替换
 */
export interface LoopGraphDeps {
  /** engineer 执行：输入任务 + 上一轮反馈，输出产出摘要（diff/代码） */
  runEngineer: (task: string, feedback: string) => Promise<string>;
  /** audit 执行：输入 engineer 产出，输出 PASS/WARN/FAIL + 报告 */
  runAudit: (artifacts: LoopArtifacts) => Promise<AuditOutcome>;
  /** reviewer 执行：输入 engineer 产出 + audit 报告，输出审查报告 */
  runReviewer: (artifacts: LoopArtifacts) => Promise<string>;
  /** HITL 确认：展示审查报告，等待人工 y/n（不限时） */
  confirmHuman: (reviewReport: string) => Promise<HumanDecision>;
  /** blocked 终态回写 audit history（终态可追溯，不无限循环） */
  recordBlocked: (state: LoopGraphState) => Promise<void>;
  /** checkpoint 存储 */
  checkpointer: FileCheckpointer;
  /** 重试上限（默认 3） */
  maxRetries: number;
  /** 日志输出 */
  log: (msg: string) => void;
  /**
   * 数据目录（v1.2.2 P3b）——HITL 异步模式检测与请求/响应文件读写根路径。
   * 不设置时按 defaultDeps() 注入的 loadEnvConfig().dataDir 解析。
   */
  dataDir?: string;
  /**
   * Dashboard 数据目录（可选，默认 $SOFAGENT_HOME/data，v1.2.3 AD-2 路径修复注点）。
   * graph-state.json 写到 {dashboardDir}/dashboard/——Dashboard bash 实际读取的位置。
   * 未设置时节点兜底使用 dataDir（向后兼容）。
   */
  dashboardDir?: string;
  /**
   * Planner LLM decide 调用（v1.2.2 P4）——plan 节点任务分解。
   * 不设置时 buildLoopGraph 内部 fallback 到 defaultRunPlannerDecide。
   */
  runPlannerDecide?: (task: string) => Promise<string>;
  /**
   * 降级路由链开关（v1.2.2 P4）。
   * true：audit FAIL 按 0→1→2 推进 degradationLevel（降级链语义）；
   * false/缺省：保持 v1.2.1 纯 retry→blocked 语义（老测试/老调用方兼容）。
   * runLoopGraph 默认开启。
   */
  degradationChainEnabled?: boolean;
  /**
   * worktree 隔离工厂（可选，v1.2.3 隔离底座注点，默认不激活）。
   * 未来并行 SubAgent 调度（v1.3.0）通过此工厂为每个 SubAgent 创建
   * 独立 git worktree 实现文件级隔离；当前串行 LOOP 不使用——
   * 缺省 undefined 时行为与 v1.2.2 完全一致。
   */
  worktreeFactory?: () => WorktreeHandle;
}
