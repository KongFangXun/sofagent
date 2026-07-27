// ============================================================
// data-paths.ts · 数据目录路径单一事实来源（SSOT）
// v1.2.1 新增：数据目录重构（.sofagent/ → data/）
// ============================================================
//
// 核心原则：
//   data/       = 审计记录 / 知识库 / 反思 / 任务日志 / 编排决策 / Dashboard
//                 （用户可见、Dashboard 可消费、备份只需拷贝一个目录）
//   .sofagent/  = checkpoint / shadow git / config（引擎内部状态，不迁移）
//
// 所有读写「用户可见运行时数据」的代码都应使用这里的常量，
// 不得各自硬编码 `join(cwd, 'data', ...)`。
//
// 注意：常量基于 process.cwd() 在模块加载时解析一次——
// 调用方需要支持自定义数据根（测试 / 便携运行时）时，
// 应保留显式参数与 SOFAGENT_DATA 环境变量覆盖链路。
// ============================================================

import path from 'path';

const PROJECT_ROOT = process.cwd();

/** 用户可见数据根目录（v1.2.1 起，替代 .sofagent/ 中的数据类子目录） */
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');

// ── 审计记录 ──
export const AUDIT_DIR = path.join(DATA_DIR, 'audit');
export const AUDIT_HISTORY = path.join(AUDIT_DIR, 'history.jsonl');
export const AUDIT_SESSION_REPORT = path.join(AUDIT_DIR, 'session-report.json');

// ── 数据主权审计（v1.2.2 预留） ──
export const SOVEREIGNTY_DIR = path.join(DATA_DIR, 'sovereignty');

// ── 任务数据（日志 + 计划） ──
export const TASK_DIR = path.join(DATA_DIR, 'task');
export const TASK_LOGS_DIR = path.join(TASK_DIR, 'logs');
export const TASK_PLANS_DIR = path.join(TASK_DIR, 'plans');

// ── 知识库（Views 派生层） ──
export const KNOWLEDGE_DIR = path.join(DATA_DIR, 'knowledge');

// ── 反思记录（Ledger，append-only） ──
export const THINK_MD = path.join(DATA_DIR, 'think.md');

// ── 编排决策（current/candidate/comparisons/history） ──
export const ORCHESTRATOR_DIR = path.join(DATA_DIR, 'orchestrator');

// ── Dashboard 缓存 ──
export const DASHBOARD_DIR = path.join(DATA_DIR, 'dashboard');

// ── IM 推送队列 ──
export const IM_OUTBOX_DIR = path.join(DATA_DIR, 'im-outbox');

// ── daemon 运行状态 ──
export const DAEMON_JSON = path.join(DATA_DIR, 'daemon.json');
export const DAEMON_LOG = path.join(DATA_DIR, 'daemon.log');

// ── FORGE 审查运行数据 ──
// 结构：data/forge-runs/<workflow-name>/<YYYY-MM-DD>/run-NN/
// 新 workflow 各自独立子目录，日期拍平（非 YYYY/MM/DD 三级嵌套）
export const FORGE_RUNS_DIR = path.join(DATA_DIR, 'forge-runs');

// ── 引擎内部状态（留在 .sofagent/，不迁移） ──
export const SOFAGENT_INTERNAL = path.join(PROJECT_ROOT, '.sofagent');
export const CHECKPOINT_DIR = path.join(SOFAGENT_INTERNAL, 'checkpoint');
export const SHADOW_GIT_DIR = path.join(SOFAGENT_INTERNAL, '.git-shadow');
export const CONFIG_FILE = path.join(SOFAGENT_INTERNAL, 'config.yml');

// ═══════════════════════════════════════════════════════════
// 函数式路径解析器（支持自定义 projectRoot）
//
// 上面的常量基于 process.cwd() 在模块加载时解析一次，
// 适用于「数据根 == 当前工作目录」的运行时场景。
//
// 但测试隔离（writeSessionReport(report, tmpDir)）和
// 便携运行时需要显式传入 projectRoot。以下函数提供
// 与常量一致的路径拼接，但以参数化的 projectRoot 为基准。
//
// 所有「需要自定义数据根」的代码都应调用以下函数，
// 不要自己 join(projectDir, 'data', ...) 硬编码。
// ═══════════════════════════════════════════════════════════

/** 解析用户可见数据根目录（参数化版本） */
export function resolveDataDir(projectRoot: string = PROJECT_ROOT): string {
  return path.join(projectRoot, 'data');
}

/** 解析审计目录（data/audit/） */
export function resolveAuditDir(projectRoot: string = PROJECT_ROOT): string {
  return path.join(resolveDataDir(projectRoot), 'audit');
}

/** 解析知识库目录（data/knowledge/） */
export function resolveKnowledgeDir(projectRoot: string = PROJECT_ROOT): string {
  return path.join(resolveDataDir(projectRoot), 'knowledge');
}

/** 解析 daemon 日志路径（data/daemon.log） */
export function resolveDaemonLog(projectRoot: string = PROJECT_ROOT): string {
  return path.join(resolveDataDir(projectRoot), 'daemon.log');
}

/** 解析 daemon 配置路径（data/daemon.json） */
export function resolveDaemonJson(projectRoot: string = PROJECT_ROOT): string {
  return path.join(resolveDataDir(projectRoot), 'daemon.json');
}
