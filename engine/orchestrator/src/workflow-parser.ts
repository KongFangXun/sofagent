// ============================================================
// workflow-parser.ts · workflow YAML → SubAgent 映射
// v1.3.7 新增
// ============================================================
//
// 把 compose 产出的 workflow YAML 解析为 SubAgent 配置：
//   - 节点抽取：js-yaml 解析（orchestrator 既有依赖），非法 YAML 抛 WorkflowParseError
//   - agent 映射表（架构师定稿）：
//       developer        → ENGINEER_AGENT
//       qa-engineer      → REVIEWER_AGENT
//       researcher       → FDE_AGENT（sustain 模式）
//       technical-writer → 内置 general-purpose（minimal prompt，其余类型未知时同路降级）
//   - DAG 校验：depends_on 必须无环、无悬空引用、无自依赖
//   - 每个 SubAgent 的 systemPrompt 由 dag-runner 统一前置
//     buildConstrainedSystemPrompt 四层加载链（本模块只负责映射）

import * as yaml from 'js-yaml';
import {
  ENGINEER_AGENT,
  REVIEWER_AGENT,
  BUILTIN_AGENTS,
} from './builtin-agents';
import type { SubAgentDefinition } from './registry';
import { listAgents } from './registry';
import { deriveAgentFromRequirement } from './onboard/agent-creator';
import { getGraphBuilder } from './harness-sdk/builder-registry';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** workflow YAML 中的单个节点 */
export interface WorkflowNode {
  id: string;
  agent: string;
  task: string;
  depends_on: string[];
  /**
   * 节点类型——控制执行模块选择（v1.3.3 新增）
   * - 'loop'：循环机制（Onboard/Refine Agent），需迭代收敛
   * - 'auto'：自动执行（默认值），一次性产出
   * - 'manual'：人工节点（HITL 确认）
   *
   * 缺省值 'auto'——向后兼容旧 workflow YAML（无 type 字段时归一化为 auto）。
   */
  type: 'loop' | 'auto' | 'manual';
  /**
   * 是否需要人工确认（HITL）——v1.3.3 新增。
   *
   * type='manual' 时隐含 hitl=true；其余类型可选显式声明 hitl=true 强制卡关。
   * 缺省值 false。
   */
  hitl?: boolean;
  /**
   * 节点级触发器（可选）——trigger.schedule 定时触发周期。
   * 三档糖宏（@daily/@weekly/@monthly）或五段 cron；非 cron 形态视为
   * 自然语言周期由消费端解析。非法 cron 在 schema-gate 校验拒绝。
   */
  trigger?: { schedule: string };
  /**
   * 节点级可见性（可选，缺省 open）：
   * - open：产出与过程公开
   * - private：仅 owner 可审（过程+产出均不进公开上下文）
   * - result-only：完成者不见底层数据（仅产出摘要公开）
   */
  visibility?: 'open' | 'private' | 'result-only';
  /**
   * 节点级模型偏好（可选，v1.4.8 第八章）：provider/model/priority——
   * 同 workflow 不同节点可绑不同模型（默认省钱、复杂节点旗舰）。
   * 解析层只承接字段；执行层经 model-resolver 对 v1.3.6 模型注册表
   * 解析（未注册报错不静默降级）。实际使用模型进审计记录。
   */
  modelPreference?: {
    provider?: string;
    model: string;
    priority?: 'preferred' | 'required';
  };
}

// ────────────────────────────────────────────────────────────
// 审阅协议字段（v1.3.6 新增 · GitHub 式协作底座）
// ────────────────────────────────────────────────────────────

/**
 * merge_criteria 单条验收条件——机器可判定（复用 ⑨ define_acceptance
 * 的 Benchmark 判定结构）。三类可叠加「组织宪法」：
 *   技术验收：test_pass / build_success / grep_absent / schema_valid
 *   业务审批规则：business_approval（如「财务节点产出必须 CFO 批准」）
 *   数据合规规则：data_compliance（如「涉及用户数据必须 DPO 签字」）
 *
 * 语义来源：workflow 从「步骤列表」升级为「变更提案的审阅协议」——
 * 每个 AI 节点 = 一根待审阅的枝条，审计模块（git diff 硬证据）
 * 就是 merge_criteria 的执行器，无需新增审计逻辑。
 */
export interface MergeCriterion {
  /** 验收条件类型 */
  kind:
    | 'test_pass'
    | 'build_success'
    | 'grep_absent'
    | 'schema_valid'
    | 'business_approval'
    | 'data_compliance';
  /** 人类可读描述（可选） */
  detail?: string;
  /** test_pass/build_success：执行命令 */
  command?: string;
  /** grep_absent：不得出现的模式 */
  pattern?: string;
  /** schema_valid：校验目标 Schema 引用 */
  schema_ref?: string;
  /** business_approval/data_compliance：必需审批角色（如 CFO / DPO） */
  approver_role?: string;
}

/**
 * approver 审阅批准者（对齐 v1.3.5 promote_ab 强制人审语义）。
 * 缺省视为强制人审——破坏性变更必须人审。
 */
export interface WorkflowApprover {
  /** 审阅批准者标识（agentId / 角色名 / 用户 ID） */
  id: string;
  /** 审阅者类型（缺省 human） */
  kind?: 'human' | 'role' | 'agent';
  /** 是否强制审阅（缺省 true） */
  required?: boolean;
  /** 审阅说明（可选） */
  note?: string;
}

/** 解析后的 workflow（结构化） */
export interface ParsedWorkflow {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  /** 审阅协议：merge_criteria（可组合验收条件，v1.3.6 新增） */
  mergeCriteria?: MergeCriterion[];
  /** 审阅协议：approver（审阅批准者，v1.3.6 新增） */
  approver?: WorkflowApprover;
  /** 循环声明块（v1.6.0 章十：自循环 workflow 的防护三件套） */
  loop?: LoopBlock;
}

/** 循环声明块（v1.6.0 章十——缺整块 = 非 loop workflow，行为零变化） */
export interface LoopBlock {
  /** 显式声明这是自循环 workflow */
  enabled: boolean;
  /** 退出判据（merge_criteria 同款机器可判定语法——缺失或不可判定即拒载） */
  exitWhen: string;
  /** 迭代硬上限（防死循环） */
  maxIterations: number;
  /** 预算熔断 */
  budget: {
    maxTokensPerCycle: number;
    maxCyclesPerDay: number;
  };
  /** 闲时只读探针（订阅 timer.tick 做只读巡检，产出 PR 提案而非直接改） */
  idle?: { probe: string };
  /** 闲时探针只读 */
  readonly?: boolean;
  /** owner 级并发额度（超限的新循环排队不启动） */
  concurrency?: { maxRunningCyclesPerOwner: number };
}

/** SubAgent 配置（供 dag-runner 封装为 task tool） */
export interface SubAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  /**
   * 工具名列表（来自 SubAgentDefinition.tools）。
   * 注意：此字段为语义标签（'read'/'write'/'bash' 等），用于审计日志和
   * SubAgent 行为约束文档。dag-runner 中每个 SubAgent 封装为 task tool，
   * 内部子 Agent 继承 ENGINEER_TOOLS 默认工具集。
   */
  tools: string[];
  /**
   * Graph 构建器名（v1.3.6 交付 ③ 托管 SDK registry 集成）。
   * 有值时 dag-runner 经 getGraphBuilder(name).build() 按需实例化执行，
   * 不走内置 createReactAgent 封装——registry 存「怎么构建」，
   * dag-runner 管「什么时候构建」。
   */
  graphBuilderName?: string;
}

/** workflow 解析错误（带原因，供 CLI 展示） */
export class WorkflowParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowParseError';
  }
}

// ────────────────────────────────────────────────────────────
// exit_when 可判定性（fresh-eyes run-01 F-03+N-3 收口）
// ────────────────────────────────────────────────────────────

/**
 * exit_when 已知变量白名单（loop 运行时可观测的进度读数）。
 *
 * 口径来源：cli.ts 的 N-1 预算喂数点实际写入事件 metadata 的三个进度读数
 * （`iterationsSoFar` / `cyclesToday` / currentCycleTokens）+ 预算声明块
 * 本身——退出判据只允许引用这些**运行时真实可得**的量，防止「声明了却永不
 * 可判」的静默失效。命名取 camelCase 声明口径（iterations / tokens /
 * cyclesToday）；运行器接真实求值时以本表为绑定面。
 */
export const KNOWN_EXIT_WHEN_VARS: readonly string[] = [
  'iterations',
  'tokens',
  'cyclesToday',
  'exitFlag',
  'lastOutput',
];

/**
 * exit_when 可判定性校验结果。
 *
 * - `ok: true`——表达式满足最小判定契约，可判定
 * - `ok: false`——`reason` 含机器可定位的拒载原因 + 修复指引（可用变量列表）
 */
export interface ExitWhenDecidability {
  ok: boolean;
  reason?: string;
}

/** 标识符词法（字母/下划线开头，后随字母数字下划线） */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 字面量保留字（不参与引用封闭检查——非变量引用） */
const LITERAL_KEYWORDS: readonly string[] = ['true', 'false', 'null', 'and', 'or', 'not'];

/** 裸赋值/自增自减副作用（先剔除合法双字符运算符后匹配） */
const ASSIGNMENT_RE = /(?<![=!<>+\-])(=(?!=)|\+\+|--)/;

/**
 * exit_when 可判定性判定（最小判定契约——不发明 DSL 文法，避免第二权威源）。
 *
 * 三条机械检查（对齐 devlog 章二判据 schema 的「可判定性」硬判据母体）：
 *   ① **引用封闭**——表达式中出现的标识符 ⊆ knownVars（引用运行时不可得的
 *      变量 = 判据永不可判，fail-closed 拒载）
 *   ② **无赋值副作用**——不含裸 `=`（`==` / `!=` / `<=` / `>=` 合法）、
 *      不含 `++` / `--`（判据是断言不是语句，不得有副作用）
 *   ③ **双目平衡**——括号配平 + 比较运算符两侧非空（`>= 10` / `x >=`
 *      形态的残缺表达式拒载）
 *
 * 注意：本函数只做**可判定性**判定，不改变任何求值语义（仓内 exit_when
 * 当前为「提取-存储」态，无求值实现——校验是纯增量）。
 *
 * @param expr exit_when 表达式串
 * @param knownVars 已知变量白名单（生产传 KNOWN_EXIT_WHEN_VARS）
 * @returns { ok, reason? }——ok=false 时 reason 含原因与修复指引
 */
export function isExitWhenDecidable(
  expr: string,
  knownVars: readonly string[] = KNOWN_EXIT_WHEN_VARS,
): ExitWhenDecidability {
  const trimmed = expr.trim();

  // ⓪ 非空（缺失/纯空白由调用方的「缺失」分支先拦，此处兜底）
  if (trimmed.length === 0) {
    return { ok: false, reason: 'exit_when 为空串——退出判据不可判定' };
  }

  // ① 引用封闭：标识符 ⊆ 白名单（数字/布尔字面量、字符串字面量内文不查）
  //    字符串字面量替换为占位 token（后续操作数检查据此识别「该侧非空」）
  const stringStripped = trimmed.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ' __STR__ ');
  const identifiers = stringStripped
    .split(/[^A-Za-z0-9_.]+/)
    .filter((tok) => tok.length > 0 && !/^\d+(\.\d+)?$/.test(tok) && tok !== '__STR__'); // 去数字/占位 token
  const unknown: string[] = [];
  for (const tok of identifiers) {
    if (LITERAL_KEYWORDS.includes(tok)) continue; // true/false/null 等保留字非变量
    // 属性访问形态（a.b）取根标识符参与封闭检查（白名单按根名匹配）
    const root = IDENT_RE.test(tok) ? tok : tok.split('.')[0]!;
    if (root.length > 0 && !knownVars.includes(root)) {
      if (!unknown.includes(tok)) unknown.push(tok);
    }
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      reason:
        `exit_when 引用了未知变量「${unknown.join('、')}」——退出判据必须由运行时可得变量组成（引用封闭 fail-closed）。` +
        `修法：改用已知变量（可用变量：${knownVars.join('、')}）`,
    };
  }

  // ② 无赋值副作用：裸 = / ++ / --（先剔除 ==、!=、<=、>=、+= 等合法双字符形态）
  if (ASSIGNMENT_RE.test(stringStripped)) {
    return {
      ok: false,
      reason:
        'exit_when 含赋值或自增自减副作用（裸 = / ++ / --）——退出判据是断言不是语句。' +
        '修法：改用比较运算（==、!=、<=、>=），可用变量：' + knownVars.join('、'),
    };
  }

  // ③ 双目平衡：括号配平 + 比较运算符两侧非空
  let depth = 0;
  let minDepth = 0;
  for (const ch of stringStripped) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < minDepth) minDepth = depth;
    }
  }
  if (depth !== 0 || minDepth < 0) {
    return {
      ok: false,
      reason:
        'exit_when 括号不配平——残缺表达式不可判定。' +
        '修法：补全左右括号，可用变量：' + knownVars.join('、'),
    };
  }

  // ③b 比较运算符两侧非空：按运算符切分后任一侧为空段即残缺
  //    （split 产生空串段 = 该侧操作数缺失；`>= 10` 左空 / `x >=` 右空 /
  //     `x >= && y` 右侧被逻辑符截断——三者都恰好留下一个空段）
  const parenStripped = stringStripped.replace(/\(|\)/g, ' ');
  const hasComparison = /(?:==|!=|<=|>=|<|>|&&|\|\|)/.test(parenStripped);
  if (hasComparison) {
    const parts = parenStripped.split(/\s*(?:==|!=|<=|>=|<|>|&&|\|\|)\s*/);
    const emptySides = parts.filter((s) => s.trim().length === 0).length;
    if (emptySides > 0 || parts.length < 2) {
      return {
        ok: false,
        reason:
          'exit_when 比较运算符两侧操作数缺失——残缺表达式不可判定。' +
          '修法：补全左右操作数（如 iterations >= 10），可用变量：' + knownVars.join('、'),
      };
    }
    // 操作数须为 ASCII 词法（自然语言操作数如「效果满意 == true」不可判定——
    // CJK 在标识符抽取时被当分隔符，引用封闭查不到，此处补位拦截）
    const nonAscii = parts.filter((s) => !/^[A-Za-z0-9_.\s]*$/.test(s));
    if (nonAscii.length > 0) {
      return {
        ok: false,
        reason:
          `exit_when 操作数含非 ASCII 词法（「${nonAscii.map((s) => s.trim()).join('、')}」）——` +
          '自然语言判据机器不可判定。修法：改用已知变量写断言（如 iterations >= 10），可用变量：' + knownVars.join('、'),
      };
    }
  }
  // 孤立标识符（无任何运算符）：只剩裸变量名，非布尔断言形态，拒载
  if (!hasComparison && !/^(?:true|false)$/.test(parenStripped.replace(/\s+/g, ''))) {
    return {
      ok: false,
      reason:
        'exit_when 缺少比较运算符——单一量不构成布尔断言，不可判定。' +
        '修法：补比较运算（如 iterations >= 10），可用变量：' + knownVars.join('、'),
    };
  }

  return { ok: true };
}

// ────────────────────────────────────────────────────────────
// agent 映射表（架构师定稿 · T04 映射依据）
// ────────────────────────────────────────────────────────────

/** FDE sustain 模式变体（researcher 映射目标）：复用 FDE systemPrompt，mode=sustain */
const FDE_SUSTAIN_AGENT: SubAgentDefinition = {
  ...(BUILTIN_AGENTS.find((a) => a.name === 'fde') as SubAgentDefinition),
  mode: 'sustain',
};

/** technical-writer 内置定义（通用写作 Agent 的 sofagent 化） */
const TECHNICAL_WRITER_AGENT: SubAgentDefinition = {
  name: 'technical-writer',
  type: 'development',
  description: '技术文档撰写——README / changelog / API 文档 / 用户手册',
  tools: ['read', 'write', 'grep', 'glob'],
  systemPrompt:
    '你是技术文档撰写者。职责：把工程师的实现转译为清晰、准确、可维护的文档。' +
    '原则：文档与代码同源更新；先读者后作者；示例必须可运行。',
  modelName: null,
};

/** YAML agent 值 → SubAgentDefinition 映射表 */
const AGENT_MAP: Record<string, SubAgentDefinition> = {
  developer: ENGINEER_AGENT,
  'qa-engineer': REVIEWER_AGENT,
  researcher: FDE_SUSTAIN_AGENT,
  'technical-writer': TECHNICAL_WRITER_AGENT,
};

/**
 * 查询 agent 映射（未知类型降级为 technical-writer 内置定义，不阻塞执行）
 * @param agentType YAML 节点中的 agent 字段
 * @returns { definition, fallback } —— fallback=true 表示走了降级
 */
export function mapAgentType(agentType: string): { definition: SubAgentDefinition; fallback: boolean } {
  const hit = AGENT_MAP[agentType];
  if (hit) return { definition: hit, fallback: false };
  return { definition: TECHNICAL_WRITER_AGENT, fallback: true };
}

/**
 * v1.3.2 交付 5: 解析 agent 类型 → SubAgentDefinition（registry 动态查找 + agent-creation 兜底）
 *
 * 解析链（v1.3.2 升级——移除「未知降级 general-purpose」）：
 *   ① 内置 4 个（developer/qa-engineer/researcher/technical-writer）走 AGENT_MAP
 *   ② registry 动态查找（已注册的 sub-agent 直接复用，不重复生成）
 *   ③ 查不到 → agent-creation 兜底生成（从节点 task 描述推导 Role + 域规则）
 *   ④ 生成后注册进 registry（后续复用）
 *
 * - `enterprise` 类型：调 listAgents(dataDir) 动态查找 YML 中 name 匹配的 Agent
 *   - 找到 → 返回该 Agent 定义
 *   - 未找到 → 抛错提示「enterprise Agent 未注册，请先运行 activate」
 *
 * v1.3.2 变更：未知类型不再降级到 TECHNICAL_WRITER_AGENT——走 agent-creation 推导生成。
 *
 * v1.3.3 变更（T03）：deriveAgentFromRequirement 调用后接入 team-manager 入队 API
 * （协议设计 §6.2 自动入队挂点）。传入 onAgentDerived 回调时，推导生成的 sub-agent
 * 自动入队。回调由调用方注入（team-manager 实例），workflow-parser 不直接依赖 team-manager。
 *
 * @param node workflow 节点
 * @param dataDir .sofagent 数据目录（用于 registry 查找）
 * @param onAgentDerived v1.3.3 新增：agent 推导生成后的入队回调（自动入队挂点）
 * @returns { definition, fallback } —— fallback=true 表示走了 agent-creation 兜底
 * @throws Error 当 enterprise agent 未注册时
 */
export function resolveAgent(
  node: WorkflowNode,
  dataDir?: string,
  onAgentDerived?: (agentId: string) => void,
): { definition: SubAgentDefinition; fallback: boolean } {
  // ① 内置 agent 走 AGENT_MAP
  const hit = AGENT_MAP[node.agent];
  if (hit) return { definition: hit, fallback: false };

  // ①.5 Graph 构建器查找（v1.3.6 交付 ③ 托管 SDK——harness.wrap 产物）
  //     registry 存「怎么构建」，dag-runner 管「什么时候构建」：
  //     命中构建器 → 返回带 graphBuilderName 的代理 definition（按需实例化）
  const builderHit = getGraphBuilder(node.agent) ?? getGraphBuilder(node.id);
  if (builderHit) {
    return {
      definition: {
        name: builderHit.name,
        type: 'harness-wrapped',
        description: `托管 SDK agent（graph 构建器按需实例化）`,
        tools: [],
        systemPrompt: '',
        modelName: null,
        graphBuilderName: builderHit.name,
      },
      fallback: false,
    };
  }

  // ② registry 动态查找（已注册的 sub-agent 直接复用）
  if (dataDir) {
    const agents = listAgents(dataDir);
    const registryHit = agents.find((a) => a.name === node.agent || a.name === node.id);
    if (registryHit) return { definition: registryHit, fallback: false };

    // enterprise agent 专路径
    if (node.agent === 'enterprise') {
      const found = agents.find((a) => a.name === node.id);
      if (!found) {
        throw new Error(
          `enterprise Agent '${node.id}' 未注册，请先运行 activate`,
        );
      }
      return { definition: found, fallback: false };
    }
  }

  // ③ 查不到 → agent-creation 兜底生成（从节点 task 描述推导）
  const creation = deriveAgentFromRequirement(node.task);
  if (creation.status === 'derived' && creation.config) {
    const config = creation.config;
    const generatedDefinition: SubAgentDefinition = {
      name: config.name,
      type: 'enterprise',
      description: config.role,
      tools: ['read', 'write', 'grep', 'glob'],
      systemPrompt: config.thinkMd,
      modelName: null, // 不持久化 provider/model_id（铁律）
      knowledgeDomain: config.domain,
    };

    // v1.3.3 T03：自动入队挂点——推导生成的 sub-agent 自动加入团队（协议设计 §6.2）
    // 回调由调用方注入（team-manager.enqueueSubAgent），workflow-parser 不直接依赖 team-manager
    if (onAgentDerived) {
      try {
        onAgentDerived(config.name);
      } catch (err) {
        // 入队失败不阻断 workflow 解析（best-effort——团队功能是可选增强）
        console.warn(`[workflow-parser] sub-agent 自动入队失败（不阻断）: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { definition: generatedDefinition, fallback: true };
  }

  // agent-creation 也推导不出来（需求太泛）→ 最后降级（向后兼容）
  // 但标注 fallback=true 提示用户补充需求
  return { definition: TECHNICAL_WRITER_AGENT, fallback: true };
}

// ────────────────────────────────────────────────────────────
// YAML 解析 + DAG 校验
// ────────────────────────────────────────────────────────────

/**
 * 解析 workflow YAML 文本为结构化 ParsedWorkflow
 * @param workflowYaml compose 产出的 YAML 文本
 * @returns ParsedWorkflow（nodes 已归一化：depends_on 缺省补 []）
 * @throws WorkflowParseError YAML 非法 / 缺 workflow.nodes / 节点字段缺失 /
 *         depends_on 悬空引用 / 自依赖 / 存在环
 */
export function parseWorkflowYaml(workflowYaml: string): ParsedWorkflow {
  let doc: unknown;
  try {
    doc = yaml.load(workflowYaml);
  } catch (e) {
    throw new WorkflowParseError(`YAML 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof doc !== 'object' || doc === null) {
    throw new WorkflowParseError('YAML 顶层不是对象');
  }
  const root = doc as Record<string, unknown>;
  const wf = root['workflow'];
  if (typeof wf !== 'object' || wf === null) {
    throw new WorkflowParseError('缺少 workflow 根节点');
  }
  const wfObj = wf as Record<string, unknown>;
  const rawNodes = wfObj['nodes'];
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    throw new WorkflowParseError('workflow.nodes 缺失或为空数组');
  }

  // 节点归一化 + 字段校验
  const nodes: WorkflowNode[] = rawNodes.map((raw, idx) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new WorkflowParseError(`nodes[${idx}] 不是对象`);
    }
    const n = raw as Record<string, unknown>;
    if (typeof n.id !== 'string' || n.id.trim() === '') {
      throw new WorkflowParseError(`nodes[${idx}] 缺 id`);
    }
    if (typeof n.agent !== 'string' || n.agent.trim() === '') {
      throw new WorkflowParseError(`节点 ${n.id} 缺 agent`);
    }
    if (typeof n.task !== 'string' || n.task.trim() === '') {
      throw new WorkflowParseError(`节点 ${n.id} 缺 task`);
    }
    const deps = n.depends_on;
    if (deps !== undefined && !Array.isArray(deps)) {
      throw new WorkflowParseError(`节点 ${n.id} 的 depends_on 不是数组`);
    }

    // ── type / hitl 字段解析（v1.3.3 新增）──
    // type：可选，缺省 'auto'；仅接受 'loop' | 'auto' | 'manual'
    const rawType = n.type;
    let nodeType: 'loop' | 'auto' | 'manual' = 'auto';
    if (rawType !== undefined) {
      if (rawType !== 'loop' && rawType !== 'auto' && rawType !== 'manual') {
        throw new WorkflowParseError(
          `节点 ${n.id} 的 type 非法（${String(rawType)}），必须为 loop|auto|manual`,
        );
      }
      nodeType = rawType;
    }

    // hitl：可选布尔；type='manual' 时隐含 true
    let hitl = false;
    if (typeof n.hitl === 'boolean') {
      hitl = n.hitl;
    }
    if (nodeType === 'manual') {
      hitl = true; // manual 节点强制 HITL
    }

    // ── trigger / visibility 字段解析（G14/G6 节点级扩展——原样穿透，语义校验在 schema-gate）──
    // trigger：可选对象 { schedule: string }——结构非法 fail-loud（静默丢弃会让
    // 定时触发悄悄失效）；schedule 内容合法性（cron 语法）在 schema-gate 收口
    let trigger: { schedule: string } | undefined;
    if (n.trigger !== undefined) {
      const t = n.trigger as Record<string, unknown>;
      if (typeof t !== 'object' || t === null || typeof t.schedule !== 'string' || t.schedule.trim() === '') {
        throw new WorkflowParseError(`节点 ${n.id} 的 trigger 非法（必须为 { schedule: 非空字符串 }）`);
      }
      trigger = { schedule: t.schedule.trim() };
    }

    // visibility：可选枚举三态——非法值 fail-loud（拼错静默降级 open 等于越权放开）
    let visibility: WorkflowNode['visibility'];
    if (n.visibility !== undefined) {
      if (n.visibility !== 'open' && n.visibility !== 'private' && n.visibility !== 'result-only') {
        throw new WorkflowParseError(
          `节点 ${n.id} 的 visibility 非法（${String(n.visibility)}），必须为 open|private|result-only`,
        );
      }
      visibility = n.visibility;
    }

    // modelPreference：可选对象（v1.4.8 第八章）——结构非法 fail-loud
    // （拼错静默丢弃会让节点绑定悄悄失效）；解析到注册表的校验在 model-resolver
    let modelPreference: WorkflowNode['modelPreference'];
    if (n.modelPreference !== undefined) {
      const mp = n.modelPreference as Record<string, unknown>;
      if (typeof mp !== 'object' || mp === null || typeof mp.model !== 'string' || mp.model.trim() === '') {
        throw new WorkflowParseError(`节点 ${n.id} 的 modelPreference 非法（必须含非空 model 字段）`);
      }
      if (mp.priority !== undefined && mp.priority !== 'preferred' && mp.priority !== 'required') {
        throw new WorkflowParseError(`节点 ${n.id} 的 modelPreference.priority 非法（${String(mp.priority)}），必须为 preferred|required`);
      }
      modelPreference = {
        ...(typeof mp.provider === 'string' ? { provider: mp.provider } : {}),
        model: mp.model.trim(),
        ...(mp.priority !== undefined ? { priority: mp.priority as 'preferred' | 'required' } : {}),
      };
    }

    return {
      id: n.id.trim(),
      agent: n.agent.trim(),
      task: n.task,
      depends_on: (deps as unknown[] | undefined)?.map((d) => String(d)) ?? [],
      type: nodeType,
      hitl,
      ...(trigger !== undefined ? { trigger } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
      ...(modelPreference !== undefined ? { modelPreference } : {}),
    };
  });

  // 节点总数上限（防资源耗尽）
  const MAX_NODES = 20;
  if (nodes.length > MAX_NODES) {
    throw new WorkflowParseError(`节点数 ${nodes.length} 超过上限 ${MAX_NODES}`);
  }

  // task 字段长度上限（防 prompt 注入）
  const MAX_TASK_LENGTH = 2000;
  for (const n of nodes) {
    if (n.task.length > MAX_TASK_LENGTH) {
      console.warn(`⚠️ [workflow-parser] 节点 ${n.id} 的 task 描述超长（${n.task.length} 字符），截断至 ${MAX_TASK_LENGTH}`);
      n.task = n.task.slice(0, MAX_TASK_LENGTH);
    }
  }

  // id 唯一性
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) throw new WorkflowParseError(`节点 id 重复：${n.id}`);
    ids.add(n.id);
  }

  // depends_on 引用校验（悬空 / 自依赖）
  for (const n of nodes) {
    for (const dep of n.depends_on) {
      if (dep === n.id) throw new WorkflowParseError(`节点 ${n.id} 自依赖`);
      if (!ids.has(dep)) throw new WorkflowParseError(`节点 ${n.id} 依赖悬空节点 ${dep}`);
    }
  }

  // 环检测（DFS 三色标记）——v1.6.0 章十改判：loop.enabled 的自循环 workflow
  // 排除出 DAG 环检查（改查「事件环有退出条件」——exit_when 校验见 loop 块提取）；
  // 非 loop workflow 的 DAG 禁环约束不变（确定性审计依赖）。
  const isLoopWorkflow = typeof wfObj['loop'] === 'object' && (wfObj['loop'] as Record<string, unknown>)['enabled'] === true;
  if (!isLoopWorkflow) {
    assertAcyclic(nodes);
  }

  // ── 审阅协议字段提取（v1.3.6 新增 · GitHub 式协作底座）──
  // merge_criteria / approver 原样透传（schema 结构校验在 container.ts，
  // 语义校验 validateMergeCriteria / validateApprover 同在 container 收口）。
  const mergeCriteria = Array.isArray(wfObj['merge_criteria'])
    ? (wfObj['merge_criteria'] as MergeCriterion[])
    : undefined;
  const approver =
    typeof wfObj['approver'] === 'object' && wfObj['approver'] !== null
      ? (wfObj['approver'] as WorkflowApprover)
      : undefined;

  // ── 循环声明块提取（v1.6.0 章十：loop: 缺整块 = 非 loop workflow）──
  let loop: LoopBlock | undefined;
  const loopRaw = wfObj['loop'];
  if (typeof loopRaw === 'object' && loopRaw !== null) {
    const lb = loopRaw as Record<string, unknown>;
    const enabled = lb['enabled'] === true;
    const exitWhen = typeof lb['exit_when'] === 'string' ? (lb['exit_when'] as string) : undefined;
    const maxIterations = typeof lb['max_iterations'] === 'number' ? (lb['max_iterations'] as number) : undefined;
    const budgetRaw = typeof lb['budget'] === 'object' && lb['budget'] !== null ? (lb['budget'] as Record<string, unknown>) : undefined;
    const maxTokensPerCycle = budgetRaw && typeof budgetRaw['max_tokens_per_cycle'] === 'number' ? (budgetRaw['max_tokens_per_cycle'] as number) : undefined;
    const maxCyclesPerDay = budgetRaw && typeof budgetRaw['max_cycles_per_day'] === 'number' ? (budgetRaw['max_cycles_per_day'] as number) : undefined;
    const idleRaw = typeof lb['idle'] === 'object' && lb['idle'] !== null ? (lb['idle'] as Record<string, unknown>) : undefined;
    const idleProbe = idleRaw && typeof idleRaw['probe'] === 'string' ? (idleRaw['probe'] as string) : undefined;
    const concurrencyRaw = typeof lb['concurrency'] === 'object' && lb['concurrency'] !== null ? (lb['concurrency'] as Record<string, unknown>) : undefined;
    const maxRunning = concurrencyRaw && typeof concurrencyRaw['max_running_cycles_per_owner'] === 'number' ? (concurrencyRaw['max_running_cycles_per_owner'] as number) : undefined;
    if (enabled) {
      // fail-closed：exit_when 缺失或不可判定即拒载（报错含修复指引）
      if (!exitWhen || exitWhen.trim().length === 0) {
        throw new WorkflowParseError('loop.enabled=true 但 exit_when 缺失——自循环 workflow 必须声明退出判据（fail-closed 拒载）。修法：在 loop: 块补 exit_when: "<merge_criteria 同款语法>"');
      }
      // fail-closed 第二道（F-03+N-3 收口）：非空但不可判定的表达式同样拒载
      // （缺失检查只挡「没写」，这里挡「写了但机器判不了」——垃圾串/未知变量/
      // 赋值副作用/残缺表达式均在此拦截）
      const decidability = isExitWhenDecidable(exitWhen);
      if (!decidability.ok) {
        throw new WorkflowParseError(
          `loop.exit_when 不可判定（fail-closed 拒载）：${decidability.reason ?? '未知原因'}`,
        );
      }
      if (maxIterations === undefined || maxIterations < 1) {
        throw new WorkflowParseError('loop.enabled=true 但 max_iterations 缺失或 <1（迭代硬上限——防死循环）');
      }
      if (maxTokensPerCycle === undefined || maxCyclesPerDay === undefined) {
        throw new WorkflowParseError('loop.enabled=true 但 budget.max_tokens_per_cycle / max_cycles_per_day 缺失（预算熔断字段必填）');
      }
      loop = {
        enabled,
        exitWhen,
        maxIterations,
        budget: { maxTokensPerCycle, maxCyclesPerDay },
        ...(idleProbe ? { idle: { probe: idleProbe } } : {}),
        ...(typeof lb['readonly'] === 'boolean' ? { readonly: lb['readonly'] as boolean } : {}),
        ...(maxRunning !== undefined ? { concurrency: { maxRunningCyclesPerOwner: maxRunning } } : { concurrency: { maxRunningCyclesPerOwner: 3 } }),
      };
    }
  }

  return {
    name: typeof wfObj.name === 'string' ? wfObj.name : 'unnamed-workflow',
    description: typeof wfObj.description === 'string' ? wfObj.description : '',
    nodes,
    ...(mergeCriteria !== undefined ? { mergeCriteria } : {}),
    ...(approver !== undefined ? { approver } : {}),
    ...(loop !== undefined ? { loop } : {}),
  };
}

/** DFS 三色环检测：白=未访问，灰=在栈上，黑=已完成 */
function assertAcyclic(nodes: WorkflowNode[]): void {
  const color = new Map<string, 'white' | 'gray' | 'black'>(nodes.map((n) => [n.id, 'white']));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  function visit(id: string, stack: string[]): void {
    color.set(id, 'gray');
    for (const dep of byId.get(id)!.depends_on) {
      if (color.get(dep) === 'gray') {
        throw new WorkflowParseError(`depends_on 存在环：${[...stack, id, dep].join(' → ')}`);
      }
      if (color.get(dep) === 'white') visit(dep, [...stack, id]);
    }
    color.set(id, 'black');
  }

  for (const n of nodes) {
    if (color.get(n.id) === 'white') visit(n.id, []);
  }
}

/**
 * workflow YAML → SubAgent 配置数组
 *
 * 同一 agent 类型出现多次时按节点 id 去重命名（<agent>-<nodeId>），
 * 保证 task tool 的名字唯一。
 *
 * @param parsed 已解析的 workflow
 * @param dataDir .sofagent 数据目录（v1.2.6: 用于 resolveAgent 查找 enterprise Agent）
 * @param onAgentDerived v1.3.3：agent 推导生成后的入队回调（自动入队挂点）
 * @returns SubAgentConfig 数组（每个节点一个 SubAgent）
 */
export function toSubAgentConfigs(
  parsed: ParsedWorkflow,
  dataDir?: string,
  onAgentDerived?: (agentId: string) => void,
): SubAgentConfig[] {
  const seenAgent = new Map<string, number>();
  return parsed.nodes.map((node) => {
    const { definition, fallback } = resolveAgent(node, dataDir, onAgentDerived);
    const count = (seenAgent.get(node.agent) ?? 0) + 1;
    seenAgent.set(node.agent, count);
    // 同类型第二个起加节点 id 后缀保唯一
    const name = count === 1 ? definition.name : `${definition.name}-${node.id}`;
    const description = fallback
      ? `${definition.description}（未知 agent 类型 ${node.agent} 的降级映射）`
      : definition.description;
    return {
      name,
      description,
      systemPrompt: definition.systemPrompt,
      tools: definition.tools,
      // v1.3.6 交付 ③：托管 SDK graph 构建器透传（dag-runner 按需实例化）
      ...(definition.graphBuilderName ? { graphBuilderName: definition.graphBuilderName } : {}),
    };
  });
}

/**
 * 一站式入口：YAML 文本 → SubAgent 配置数组
 * @param workflowYaml compose 产出的 YAML 文本
 * @param dataDir .sofagent 数据目录（v1.2.6: 用于 resolveAgent 查找 enterprise Agent）
 * @param onAgentDerived v1.3.3：agent 推导生成后的入队回调（自动入队挂点）
 */
export function parseWorkflowToSubAgents(
  workflowYaml: string,
  dataDir?: string,
  onAgentDerived?: (agentId: string) => void,
): SubAgentConfig[] {
  return toSubAgentConfigs(parseWorkflowYaml(workflowYaml), dataDir, onAgentDerived);
}
