// ============================================================
// model-router.ts · 混合模型路由层（v1.5.2 · P1）
// ============================================================
//
// 按 数据敏感度 × 任务复杂度 把任务路由到：
//   cloud-strong / cloud-fast / local-executor / local-pipeline / decision-model
//
// 档位是**抽象槽位**，不是模型规格——具体模型由 data/config/model-router.json
// 或 model_switch 注册表（model-registry）决定：
//   cloud-strong     云端强档，复杂推理
//   cloud-fast       云端快档，简单任务
//   local-executor   本地执行档，多步 workflow（要长上下文、要推理）
//   local-pipeline   本地管道档，固定管道（模板填充 / 字段提取 / 格式转换）
//   decision-model   判定档，决策模型直接出判定结果，不调生成模型
//
// local-executor 与 local-pipeline 的区分是**任务形态**（执行 vs 管道），
// 不是模型规格——同一台一体机上两者可指向同一个本地推理模型，差别在调用
// 参数（执行档给足上下文；管道档走约束解码 + 低 token 预算）。
//
// block 不是模型档，是**拦截目标**：敏感数据本地不可用时的 fail-closed 出口。
//
// 路由硬规则（dev-prompt §3 L1.5\11.5.1111：
//   public      × 任意        → cloud-fast
//   internal    × 简单        → cloud-fast
//   internal    × 复杂        → cloud-strong
//   restricted  × 任意        → local-executor
//   confidential× 管道任务    → local-pipeline
//   confidential× 复杂任务    → local-executor + 审计告警
//   confidential× 超复杂任务  → block + 人工确认
//
// 降级铁律：restricted/confidential 本地模型不可用时绝不 fallback 云端，
//           走 block-and-alert（写 auditResult='FAIL' 的 DataSovereigntyRecord
//           + stderr 告警）。
//
// 与审计层的耦合：单向依赖——ModelRouter 只读消费 DataSovereigntyLogger
// .queryRecent() 辅助敏感度判定；audit 包对 orchestrator 零 import。
// ============================================================

import { DataSovereigntyLogger } from '@sofagent/audit';
import type { DataSovereigntyRecord } from '@sofagent/audit';
import {
  loadModelRouterConfig,
  DEFAULT_ROUTER_CONFIG,
  type ModelRouterConfig,
} from './model-router-config';

// ============================================================
// 类型定义
// ============================================================

export type Sensitivity = 'public' | 'internal' | 'restricted' | 'confidential';
/**
 * 路由目标。
 *
 * - 前四项是**模型档位**（抽象槽位，具体模型由配置 / 注册表决定）
 * - `decision-model` 是**判定档**：由决策模型直接作答（判定 / 分拣类任务），
 *   不经生成模型——产出是类型化答案 + 概率，不是文本。该档由上游显式请求
 *   （判定任务发起时指定），不参与「敏感度 × 复杂度」自动矩阵
 * - `block` **不是模型档**，是敏感数据本地不可用时的拦截出口（fail-closed）
 */
export type RouteTarget =
  | 'cloud-strong'
  | 'cloud-fast'
  | 'local-executor'
  | 'local-pipeline'
  | 'decision-model'
  | 'block';
export type RouteReason =
  | 'complex-reasoning'
  | 'simple-translation'
  | 'workflow-execution'
  | 'fixed-pipeline'
  | 'sensitive-data'
  | 'insufficient-local-capacity'
  | 'typed-decision';

export interface ModelRoute {
  target: RouteTarget;
  reason: RouteReason;
  sensitivity: Sensitivity;
  /** 任务复杂度（内部评估产物，用于测试断言） */
  complexity?: TaskComplexity;
  /** confidential 复杂任务升级到本地执行档时为 true（写审计告警） */
  escalated?: boolean;
  /** target='block' 时的阻断原因（人可读） */
  blockReason?: string;
}

/** 任务上下文（敏感度评估输入） */
export interface TaskContext {
  /** 任务 ID */
  taskId?: string;
  /** 文件路径（用于匹配 *.secret.* / *.confidential.*） */
  filePath?: string;
  /** 内容片段（用于 PII 扫描） */
  contentSnippet?: string;
  /** frontmatter 元数据（sensitivity 字段优先） */
  frontmatter?: Record<string, unknown>;
  /** 用户角色 */
  agentRole?: string;
  /** 用户原始意图（写审计用） */
  userIntent?: string;
}

export type TaskComplexity = 'simple' | 'complex' | 'pipeline' | 'super-complex';

// ============================================================
// 关键词表（决策 5）
// ============================================================

const SIMPLE_KEYWORDS = ['翻译', '摘要', '提取', '格式化', 'translate', 'summarize', 'extract', 'format'];
const COMPLEX_KEYWORDS = ['推理', '规划', '分析', '设计', '多步', 'reasoning', 'planning', 'analyze', 'design', 'multi-step'];
const PIPELINE_KEYWORDS = ['模板', '字段提取', '格式化', '套用', 'template', 'field-extract'];
const SUPER_COMPLEX_SIGNALS = ['跨文件', '多步workflow', '跨模块', '全链路', 'cross-file', 'multi-step workflow'];

/** PII 正则（决策 4：身份证/手机号/银行卡） */
const PII_PATTERNS: RegExp[] = [
  /\b\d{17}[\dXx]\b/,                 // 身份证 18 位
  /\b1[3-9]\d{9}\b/,                  // 中国大陆手机号
  /\b\d{16,19}\b/,                    // 银行卡号 16-19 位
];

/** 告警文案（决策 3） */
export const LOCAL_UNAVAILABLE_MSG =
  '❌ 本地模型不可用（Ollama 未运行）+ 数据敏感度=restricted/confidential，已阻断执行。请安装 Ollama 或将数据敏感度降级';

// ============================================================
// ModelRouter
// ============================================================

export interface ModelRouterDeps {
  /** 配置（缺省加载默认） */
  config?: ModelRouterConfig;
  /** 配置加载路径（测试注入用） */
  configPath?: string;
  /** 项目根（用于解析 data/config/model-router.json） */
  cwd?: string;
  /** 审计 logger（测试可注入 mock；不传则新建） */
  logger?: DataSovereigntyLogger;
  /** 本地模型可达性探针（测试注入 mock；默认 fetch /api/tags） */
  localProbe?: (endpoint: string) => Promise<boolean>;
  /** 告警输出（默认 console.error → stderr） */
  alert?: (msg: string) => void;
}

export class ModelRouter {
  private readonly config: ModelRouterConfig;
  private readonly logger: DataSovereigntyLogger;
  private readonly localProbe: (endpoint: string) => Promise<boolean>;
  private readonly alert: (msg: string) => void;

  constructor(deps: ModelRouterDeps = {}) {
    this.config = deps.config ?? loadModelRouterConfig(deps.cwd, deps.configPath);
    this.logger = deps.logger ?? new DataSovereigntyLogger();
    this.localProbe = deps.localProbe ?? defaultLocalProbe;
    this.alert = deps.alert ?? ((msg) => console.error(msg));
  }

  /**
   * 路由决策（同步评估敏感度 + 复杂度，输出路由目标）
   * 不探测本地模型可达性——可达性在 execute() 阶段处理
   */
  route(prompt: string, context: TaskContext = {}): ModelRoute {
    const sensitivity = this.evaluateSensitivity(prompt, context);
    const complexity = this.evaluateComplexity(prompt, context);
    return this.decideRoute(sensitivity, complexity);
  }

  /**
   * 路由 + 本地可达性检查 + 必要时降级/阻断
   * restricted/confidential 本地不可达 → block-and-alert（写审计 + stderr）
   */
  async routeWithProbe(prompt: string, context: TaskContext = {}): Promise<ModelRoute> {
    const base = this.route(prompt, context);
    if (base.target === 'block') return base;
    if (base.target !== 'local-executor' && base.target !== 'local-pipeline') {
      return base;
    }

    const localConfig = base.target === 'local-pipeline'
      ? this.config.local.pipeline
      : this.config.local.executor;
    const endpoint = localConfig.endpoint;
    const clientType = localConfig.client_type ?? 'ollama';
    const reachable = await this.localProbe(endpoint);
    if (reachable) return base;

    // 本地不可达 → 查 fallback 策略
    const fallback = this.config.policy.fallbackOnLocalFailure[base.sensitivity];
    if (fallback === 'block-and-alert') {
      this.writeBlockAudit(base, context);
      this.alert(LOCAL_UNAVAILABLE_MSG);
      return {
        ...base,
        target: 'block',
        blockReason: LOCAL_UNAVAILABLE_MSG,
      };
    }
    // public/internal → 允许 fallback 云端
    return {
      ...base,
      target: fallback,
      reason: 'workflow-execution',
    };
  }

  // ============================================================
  // 决策 4：敏感度评估
  // ============================================================

  evaluateSensitivity(prompt: string, context: TaskContext): Sensitivity {
    // 1. frontmatter 有 sensitivity 字段 → 直接用
    const fm = context.frontmatter?.sensitivity;
    if (typeof fm === 'string' && isSensitivity(fm)) {
      return fm;
    }

    // 2. 文件路径匹配 *.secret.* / *.confidential.* → confidential
    if (context.filePath && /\.(secret|confidential)\./i.test(context.filePath)) {
      return 'confidential';
    }

    // 3. 内容扫描匹配 PII 正则 → restricted
    const haystack = `${prompt}\n${context.contentSnippet ?? ''}`;
    for (const re of PII_PATTERNS) {
      if (re.test(haystack)) return 'restricted';
    }

    // 4. 消费 audit 历史辅助判定（近 N 条记录中同 filePath 的敏感度）
    const recent = this.safeQueryRecent(20);
    if (context.filePath) {
      for (let i = recent.length - 1; i >= 0; i--) {
        const rec = recent[i]!;
        if (rec.dataFlow.fields.some((f) => f.includes(context.filePath!))) {
          return rec.dataFlow.sensitivity;
        }
      }
    }

    // 5. 默认 → internal
    return 'internal';
  }

  // ============================================================
  // 决策 5：复杂度评估
  // ============================================================

  evaluateComplexity(prompt: string, _context: TaskContext): TaskComplexity {
    const lower = prompt.toLowerCase();
    // 超复杂：跨文件 / 多步 workflow
    for (const sig of SUPER_COMPLEX_SIGNALS) {
      if (lower.includes(sig.toLowerCase())) return 'super-complex';
    }
    // 管道任务：模板/字段提取/格式化（且不含复杂关键词）
    const hasPipelineKw = PIPELINE_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
    const hasComplexKw = COMPLEX_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
    if (hasPipelineKw && !hasComplexKw) return 'pipeline';
    // 复杂任务
    if (hasComplexKw) return 'complex';
    // 简单任务
    if (SIMPLE_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return 'simple';
    // 默认按简单处理（cloud-fast 是性价比首选）
    return 'simple';
  }

  // ============================================================
  // 路由决策矩阵（硬规则实现）
  // ============================================================

  private decideRoute(sensitivity: Sensitivity, complexity: TaskComplexity): ModelRoute {
    if (sensitivity === 'public') {
      return { target: 'cloud-fast', reason: 'simple-translation', sensitivity, complexity };
    }
    if (sensitivity === 'internal') {
      if (complexity === 'complex' || complexity === 'super-complex') {
        return { target: 'cloud-strong', reason: 'complex-reasoning', sensitivity, complexity };
      }
      return { target: 'cloud-fast', reason: 'simple-translation', sensitivity, complexity };
    }
    if (sensitivity === 'restricted') {
      return { target: 'local-executor', reason: 'sensitive-data', sensitivity, complexity };
    }
    // confidential
    if (complexity === 'pipeline') {
      return { target: 'local-pipeline', reason: 'fixed-pipeline', sensitivity, complexity };
    }
    if (complexity === 'super-complex') {
      return {
        target: 'block',
        reason: 'insufficient-local-capacity',
        sensitivity,
        complexity,
        blockReason: 'confidential 超复杂任务超出本地档能力预算，已阻断等待人工确认',
      };
    }
    // complex / simple → 升级到本地执行档 + 审计告警
    return {
      target: 'local-executor',
      reason: 'sensitive-data',
      sensitivity,
      complexity,
      escalated: true,
    };
  }

  // ============================================================
  // 审计辅助
  // ============================================================

  /** 本地不可达 + restricted/confidential → 写 FAIL 审计 */
  private writeBlockAudit(route: ModelRoute, context: TaskContext): void {
    const localConfig = route.target === 'local-pipeline'
      ? this.config.local.pipeline
      : this.config.local.executor;
    const record: DataSovereigntyRecord = {
      cloudCall: {
        timestamp: new Date().toISOString(),
        provider: localConfig.client_type === 'openai-compatible'
          ? `openai-compatible:${localConfig.provider}`
          : 'ollama',
        model: localConfig.model,
        endpoint: localConfig.endpoint,
        tokenCount: { input: 0, output: 0 },
        purpose: 'model-router-block',
      },
      localAction: {
        type: 'model-inference',
        target: 'model-router',
        description: LOCAL_UNAVAILABLE_MSG,
        auditResult: 'FAIL',
      },
      dataFlow: {
        direction: 'local-only',
        sensitivity: route.sensitivity,
        fields: context.filePath ? [context.filePath] : [],
        destination: 'local-model',
        redacted: false,
      },
      taskContext: {
        taskId: context.taskId ?? 'unknown-task',
        userIntent: context.userIntent ?? '(未提供)',
        agentRole: context.agentRole ?? 'unknown',
      },
    };
    try {
      this.logger.append(record);
    } catch {
      // 审计失败静默
    }
  }

  private safeQueryRecent(limit: number): DataSovereigntyRecord[] {
    try {
      return this.logger.queryRecent({ limit });
    } catch {
      return [];
    }
  }
}

// ============================================================
// 辅助
// ============================================================

function isSensitivity(v: string): v is Sensitivity {
  return v === 'public' || v === 'internal' || v === 'restricted' || v === 'confidential';
}

/**
 * 默认本地可达性探针
 * - Ollama 原生：GET /api/tags
 * - openai-compatible：GET /v1/models（标准 OpenAI 兼容端点）
 */
async function defaultLocalProbe(endpoint: string): Promise<boolean> {
  try {
    const base = endpoint.replace(/\/$/, '');
    const url = base + '/api/tags';
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) });
    if (res.ok) return true;
    // /api/tags 失败 → 尝试 openai-compatible 的 /v1/models
    const url2 = base + '/v1/models';
    const res2 = await fetch(url2, { method: 'GET', signal: AbortSignal.timeout(2000) });
    return res2.ok;
  } catch {
    return false;
  }
}

/** 默认配置快速工厂（测试便捷用） */
export function createDefaultRouter(overrides: ModelRouterDeps = {}): ModelRouter {
  return new ModelRouter({ config: DEFAULT_ROUTER_CONFIG, ...overrides });
}
