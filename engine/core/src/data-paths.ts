// ============================================================
// data-paths.ts · 数据目录路径单一事实来源（SSOT）
// v1.4.4 安装路径分离：代码仓库与运行时数据物理分离
// ============================================================
//
// 核心原则：
//   SOFAGENT_HOME (默认 ~/.sofagent/) 是安装根目录
//     ├── data/       = 审计记录 / 知识库 / 反思 / 任务日志 / 编排决策 / Dashboard
//     │                  （用户可见、Dashboard 可消费、备份只需拷贝一个目录）
//     ├── internal/   = checkpoint / shadow git / config（引擎内部状态）
//     ├── bin/        = CLI 入口脚本
//     ├── skill/      = Skill 文件（从仓库复制，单一真相源）
//     ├── VERSION     = 安装版本标记
//     └── REPO_PATH   = 源码仓库路径标记
//
// 所有读写「用户可见运行时数据」的代码都应使用这里的常量，
// 不得各自硬编码 `join(cwd, 'data', ...)`。
//
// 注意：
//   1. 常量基于 SOFAGENT_HOME 在模块加载时解析一次
//   2. 开发模式下可设 SOFAGENT_HOME=. 让 data/ 仍在仓库内
//   3. resolve* 函数保留用于测试隔离——参数语义改为 overrideHome
// ============================================================

import path from 'path';
import os from 'os';
import fs from 'fs';

// v1.2.1 安装路径分离：优先读环境变量，fallback 到 ~/.sofagent
// v1.3.1 #8: 空串陷阱修复——SOFAGENT_HOME="" 会被 || 视为 falsy 而 fallback，
//   但严格来说用户显式设了空串应被尊重。然而空串意味着「数据写到 cwd 相对路径」，
//   几乎肯定是误配（如 SOFAGENT_HOME= 前缀缺失值）。
//   改为：undefined → fallback；空串 "" → 也 fallback（避免误配导致数据写入意外位置）。
// v1.3.2 P0-RC2: path-traversal 防护——SOFAGENT_HOME 必须在允许前缀白名单内，
//   否则回退到 ~/.sofagent 并告警。允许前缀：用户 home 目录 + SOFAGENT_HOME_ALLOWED_PREFIXES
//   （冒号分隔，企业场景可显式扩展）。
function sanitizeSofagentHome(raw: string | undefined): string {
  const userHome = os.homedir();
  const fallback = path.join(userHome, '.sofagent');
  if (raw === undefined || raw === '') return fallback;
  const resolved = path.resolve(raw);
  const allowedPrefixes: string[] = [userHome, '/opt/sofagent', '/var/lib/sofagent'];
  const extra = process.env.SOFAGENT_HOME_ALLOWED_PREFIXES;
  if (extra !== undefined && extra !== '') {
    for (const p of extra.split(':')) {
      const trimmed = p.trim();
      if (trimmed !== '') allowedPrefixes.push(path.resolve(trimmed));
    }
  }
  const inAllowed = allowedPrefixes.some(
    (prefix) => resolved === prefix || resolved.startsWith(prefix + path.sep)
  );
  if (!inAllowed) {
    console.error(`⚠️ SOFAGENT_HOME 越界：${resolved} 不在允许前缀内，回退到 ${fallback}`);
    return fallback;
  }
  return resolved;
}

const SOFAGENT_HOME = sanitizeSofagentHome(process.env.SOFAGENT_HOME);

/** sofagent 安装根目录 */
export const HOME_DIR = SOFAGENT_HOME;

/** 用户可见数据根目录 */
export const DATA_DIR = path.join(SOFAGENT_HOME, 'data');

// ── 审计记录 ──
export const AUDIT_DIR = path.join(DATA_DIR, 'audit');
export const AUDIT_HISTORY = path.join(AUDIT_DIR, 'history.jsonl');
export const AUDIT_SESSION_REPORT = path.join(AUDIT_DIR, 'session-report.json');
// v1.3.0 (交付 6 T01)：决策审计日志——history.jsonl 同级兄弟文件（意图层审计 MVP）
export const AUDIT_DECISION_LOG = path.join(AUDIT_DIR, 'decision-log.jsonl');

// ── 数据主权审计（v1.2.3 P0） ──
// 与 history.jsonl 同在 audit/ 父目录下，Dashboard jq 单目录扫描（架构决策：对齐 dev-prompt L40）
export const SOVEREIGNTY_DIR = path.join(AUDIT_DIR, 'data-sovereignty');

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

// ── eval 质量评估数据 ──
export const EVAL_DIR = path.join(DATA_DIR, 'eval');
export const EVAL_HISTORY = path.join(EVAL_DIR, 'history.jsonl');
export const EVAL_LATEST = path.join(EVAL_DIR, 'latest.json');

// ── ab-test 实验数据（规范化路径） ──
export const AB_TEST_DIR = path.join(DATA_DIR, 'ab-test');
export const AB_TEST_HISTORY = path.join(AB_TEST_DIR, 'scheduler-history.jsonl');
export const AB_TEST_LATEST = path.join(AB_TEST_DIR, 'latest.json');

// ── FORGE 审查运行数据 ──
// 结构：data/forge-runs/<workflow-name>/<YYYY-MM-DD>/run-NN/
// 新 workflow 各自独立子目录，日期拍平（非 YYYY/MM/DD 三级嵌套）
export const FORGE_RUNS_DIR = path.join(DATA_DIR, 'forge-runs');

// ── 引擎内部状态（Q4 决策：internal/，非 .sofagent/，避免双层嵌套） ──
// 注意：保留 SOFAGENT_INTERNAL 作为 INTERNAL_DIR 的别名，
// 供历史调用方在迁移过渡期使用（二者指向同一物理路径）。
export const INTERNAL_DIR = path.join(SOFAGENT_HOME, 'internal');
export const SOFAGENT_INTERNAL = INTERNAL_DIR;
export const CHECKPOINT_DIR = path.join(INTERNAL_DIR, 'checkpoint');
export const SHADOW_GIT_DIR = path.join(INTERNAL_DIR, '.git-shadow');
// CONFIG_FILE 保留为常量（基于 process.cwd()），向后兼容已有调用方。
// 新代码一律用 getConfigFile(cwd)——它已实现向上遍历查找（monorepo 子目录
// 场景下 git commit 时读对项目 config，原 TODO(v1.4.0) 已收口）。
export const CONFIG_FILE = path.join(process.cwd(), '.sofagent', 'config.yml');

// ═══════════════════════════════════════════════════════════
// 函数式路径解析器（⚠️ 必须保留——测试隔离依赖这些函数）
//
// 语义调整说明（v1.2.1 安装路径分离）：
//   上一轮 resolve*(projectRoot) 的 projectRoot 参数，
//   本轮改为 resolveOverrideHome(overrideHome?) —— 允许测试
//   传入自定义 SOFAGENT_HOME 做隔离，而不是覆盖整个 data 根。
//
//   运行时常量基于真实 SOFAGENT_HOME；
//   测试传入临时目录作为 fake home，data/ 挂在其下。
//
//   调用方注意：旧调用方传的 projectRoot 语义不变（仍然是
//   一个目录，data/ 挂在其下），只是参数名和内部语义改为
//   overrideHome。已传 process.cwd() 的调用方无需修改即可工作。
// ═══════════════════════════════════════════════════════════

/**
 * 解析安装根目录（参数化版本，测试隔离用）
 *
 * v1.2.3：每次调用实时读 process.env.SOFAGENT_HOME（而非模块加载时缓存），
 * 使测试可在 beforeEach 中动态设置临时 SOFAGENT_HOME 做隔离。
 * 模块级常量（HOME_DIR / DATA_DIR 等）仍基于加载时快照——那些用于安装时确定的路径。
 */
export function resolveHomeDir(overrideHome?: string): string {
  return overrideHome ?? process.env.SOFAGENT_HOME ?? SOFAGENT_HOME;
}

/**
 * 解析项目级 config.yml 路径（参数化版本，测试隔离用）
 * SSOT for config path——config-loader.ts / doctor.ts 均通过此函数获取路径。
 *
 * 向上遍历查找（收口原 TODO(v1.4.0)，过期两版本）：git commit 在子目录执行时
 * process.cwd() 不是项目根，直接拼 cwd 会读错/漏读配置。查找顺序：
 *   1. 从 startDir（默认 process.cwd()）向上逐级找 .sofagent/config.yml，
 *      至 .git 所在目录为止（含）——找到即用（monorepo 子目录场景）
 *   2. 未找到 → 回退 startDir/.sofagent/config.yml（保持旧行为：
 *      loadConfig 的 tryLoadYaml miss 后 fallback 到 ~/.sofagent/config.yml）
 * @param startDir 起始目录（默认 process.cwd()）
 */
export function getConfigFile(startDir?: string): string {
  const start = startDir || process.cwd();
  const legacy = path.join(start, '.sofagent', 'config.yml');

  let dir = start;
  // 越界保护 64 层（防符号链接环）
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(dir, '.sofagent', 'config.yml'))) {
      return path.join(dir, '.sofagent', 'config.yml');
    }
    if (fs.existsSync(path.join(dir, '.git'))) {
      // 到 git 根仍未命中 → 不再上溯（出仓库后的 .sofagent 不属于本项目）
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // 文件系统根
    dir = parent;
  }
  return legacy;
}

/** 解析用户可见数据根目录（测试可传 fake home 隔离） */
export function resolveDataDir(overrideHome?: string): string {
  return path.join(resolveHomeDir(overrideHome), 'data');
}

/** 解析审计目录 */
export function resolveAuditDir(overrideHome?: string): string {
  return path.join(resolveDataDir(overrideHome), 'audit');
}

/** 解析知识库目录 */
export function resolveKnowledgeDir(overrideHome?: string): string {
  return path.join(resolveDataDir(overrideHome), 'knowledge');
}

/** 解析 daemon 日志路径 */
export function resolveDaemonLog(overrideHome?: string): string {
  return path.join(resolveDataDir(overrideHome), 'daemon.log');
}

/** 解析 daemon 配置路径 */
export function resolveDaemonJson(overrideHome?: string): string {
  return path.join(resolveDataDir(overrideHome), 'daemon.json');
}

/**
 * v1.4.2 G-05: 运行时数据目录解析 SSOT——供各包「读运行时数据」的调用点统一收编。
 * 优先级语义与各处历史硬编码保持一致：显式入参 > SOFAGENT_DATA 环境变量 > SOFAGENT_HOME/data
 * （此前 scheduler/long-tasks/memory-store/cost-audit 各自写死 `join(HOME, '.sofagent', 'data')`
 * 回退，架空 SOFAGENT_HOME 定制——用户设 SOFAGENT_HOME=/custom 后数据落点静默分裂）。
 * 注意：返回值实时读环境变量（与 resolveDataDir 同语义），不缓存。
 */
export function getDataDir(explicitBase?: string): string {
  return explicitBase || process.env.SOFAGENT_DATA || resolveDataDir();
}
