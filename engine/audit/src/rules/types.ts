// ============================================================
// types.ts · 审计规则统一接口定义
// 所有规则实现 Rule 接口，通过注册表模式被 reporter 调用
// v0.95：铁律与审计分离；新增 ruleClass 分级 + AuditContext.config
// ============================================================

import type { DiffFile } from '@sofagent/core';
import type { LogEntry } from '@sofagent/core';
import type { AuditConfig } from '@sofagent/core';
// v1.5.3 第七章：审计范围语义一等公民化——规则输入面收口为显式 AuditScope 对象，
// 规则从 scope 取输入、不再各自调 git（消灭「规则自己调 git 取错范围」整类 bug）。
import type { AuditScope } from '../scope';
// v1.5.3 第一章：ruleType 由单值字面量扩为共用联合类型（@sofagent/core 单一事实源）——
// 两套规则引擎（tool-level / git-diff）共用同一套规则定义，触发时机类型同源。
import type { RuleType } from '@sofagent/core';

/**
 * 证据模式——规则依赖的输入来源
 * - git-diff: 纯 diff 判定，不依赖 Agent 日志
 * - logs: 纯日志判定（预留）
 * - hybrid: 有日志走精确检查，无日志走 diff 启发式回退
 */
export type EvidenceMode = 'git-diff' | 'logs' | 'hybrid' | 'filesystem';

/**
 * 审计输入通道（v1.5.1 第七章·审计输入双通道）
 *
 * - `result`：结果文本通道（git diff / 工具结果文本）——**既有唯一通道，且仍是默认通道**。
 *   未声明 `inputChannels` 的规则行为零变化。
 * - `intent`：调用意图通道（宿主 `tools/pre-execute` / `tools/result` 事件流留痕：
 *   tool 名 + 参数摘要 + 会话标识 + 时间戳）——opt-in。参数级意图（`rm -rf` 的 path、
 *   写文件落点、外发 host）只在意图通道可见，结果文本通道看不出来。
 *
 * 🔴 通道声明只描述**输入面**，不参与任何判定逻辑——本章不新增规则、不改规则判定。
 */
export type AuditInputChannel = 'result' | 'intent';

/**
 * 意图条目（`<dataDir>/audit/intent.jsonl` 一行 = 一条留痕；v1.5.1 第七章）
 *
 * 写入侧：`intent-channel.ts`——参数**先过既有脱敏管线**（`sanitizeFreeText` 的
 * REDACTION_PATTERNS SSOT）才落盘，原始参数不入盘。
 * 读取侧：规则经 {@link AuditContext.intentEntries} 消费——仅当规则在
 * {@link Rule.inputChannels} 显式声明 `'intent'` 时才应被消费。
 */
export interface IntentEntry {
  /**
   * 条目通道——与 HMAC 链条目类型（`ChainEntryType`）同值，故意图与结果
   * 落在同一条链上且条目类型可区分（举证可对照）。
   * - `intent`：调用前意图（`tools/pre-execute`）
   * - `result`：调用结果（`tools/result`）
   */
  channel: AuditInputChannel;
  /** 工具名（宿主事件 `exec.name`）；**缺名不落盘**——不可归因的条目没有审计价值 */
  tool: string;
  /**
   * 参数摘要——键为参数名，值为**脱敏后**文本（长值截断）。
   * 🔐 脱敏策略：FREE_TEXT——写入前过 `sanitizeFreeText`（REDACTION_PATTERNS SSOT）；
   * 嵌套对象先序列化再整体过管道，故嵌套里的密钥同样被打码。
   */
  argsSummary?: Record<string, string>;
  /** 会话标识（宿主 `exec.agent.session.id`）；身份不可达时显式 `'unknown'`，不猜测 */
  sessionId: string;
  /** agent 标识（宿主 `exec.agent.id`） */
  agentId?: string;
  /** 调用标识（宿主 `exec.callId`）——同一次调用的「意图」与「结果」两条可对照 */
  callId?: string;
  /** 结果态（`channel='result'` 时）：ok / error */
  outcome?: 'ok' | 'error';
  /** 时间戳（ISO 8601） */
  ts: string;
}

/**
 * 规则分级标签
 * - 业务底线：违反即破坏交付完整性（安全 / 边界 / 追溯）
 * - 能力拐杖：帮助 Agent 走完正确流程，违反不一定是事故
 */
export type RuleClass = '业务底线' | '能力拐杖' | '工程规范';

/**
 * Action Governance · 决策溯源组
 *
 * 来源：行业五层骨架 / Palantir Action Type 研读（A4）——每条被审计的「动作」
 * 应结构化带决策溯源组，对应 sofagent Ledger 层的「谁在何时基于哪版数据做了什么决策」。
 *
 * - who: 谁做的决策（人类 / Agent / 系统）
 * - when: 决策时间（ISO 8601）
 * - whichDataVersion: 决策所基于的知识 / 本体数据版本（FDE 知识库版本化后回填）
 * - whichApp: 决策发生的 app / Agent 身份
 */
export interface DecisionProvenance {
  who: string;
  when: string;
  /** 知识 / 本体数据版本；v1.4.0 交付十三：契约已就位（index.ts actionGovernance 回填点），FDE 知识库版本化未就绪时留空不报错 */
  whichDataVersion?: string;
  /** 决策发生的 app / Agent 身份；当前填审计模块标识 */
  whichApp?: string;
}

/**
 * Action Governance · 审计 5 字段 schema
 *
 * 来源：行业五层骨架 / Palantir Action Type 研读（A4）——每条被审计的「动作」
 * 结构化带 5 字段 + 决策溯源组，使审计记录从「结果」升级为「可问责的动作凭证」。
 *
 * - actor: 发起方（谁触发了这次变更）
 * - timestamp: 时间（动作发生时间，ISO 8601）
 * - targetEntity: 目标实体（被变更的对象：文件路径 / 实体 ID / 资源）
 * - beforeAfter: 前后值（变更前 / 后摘要）
 * - context: 上下文（任务 / workflow / session）
 */
export interface ActionGovernance {
  actor: string;
  timestamp: string;
  targetEntity: string;
  /**
   * 变更前后值摘要；v1.4.0 交付十三：index.ts buildBeforeAfterSummary 回填
   * （截断 + 脱敏，diff 原文不进 history.jsonl），按需从 git diff 取。
   * 🔐 脱敏策略：FREE_TEXT——构建侧过 sanitizeFreeText（见 index.ts），
   * appendHistory 深扫层再兜底一道；声明见 S2 写入字段脱敏策略强制声明。
   */
  beforeAfter?: { before?: string; after?: string };
  /**
   * 上下文：任务描述 / commit message / workflow。
   * 🔐 脱敏策略（写入字段强制声明）：FREE_TEXT——用户可输入自由文本，
   * 落盘前必须过 sanitizeFreeText（audit-history appendHistory 深度脱敏，
   * 与顶层 commitMsg/task 同管道；构建侧 buildBeforeAfterSummary 同理）。
   * 新增含自由文本的落盘字段时必须在此注释声明策略，未声明的嵌套
   * 自由文本字段会被 appendHistory 的 REDACTION 深扫守卫打 WARN。
   */
  context?: string;
  /** 决策溯源组（who / when / which-data-version / which-app）；结构化枚举值，非自由文本——SANITIZE_N/A */
  decisionProvenance: DecisionProvenance;
}

/**
 * 规则判定状态（RuleCheck.status / RuleScan.status 共用）
 */
export type RuleStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';

/**
 * 单条规则的检查结果
 */
export interface RuleCheck {
  /**
   * v1.4.8 深模块条目 7：规范编号（装配路径由 assembleCheck 从 Rule.id 带入）。
   * 旧路径（插件/规则集/未迁移规则）不填——消费方以 ruleCode 回退推导。
   */
  id?: string;
  name: string;
  number: number;
  status: RuleStatus;
  details: string[];
  /** 证据模式标注（用于输出显示） */
  evidenceMode?: EvidenceMode;
  /** 规则分级标签（用于 reporter 输出 [底线]/[拐杖] 前缀） */
  ruleClass?: RuleClass;
  /** Action Governance 溯源（可选项；单条 finding 默认不带，由 AuditHistoryEntry 统一承载动作级溯源） */
  actionGovernance?: ActionGovernance;
}

/**
 * 审计上下文——传递给每条规则的统一参数
 * 规则从中按需取用，不再各自声明不同的参数签名
 */
export interface AuditContext {
  /** git diff 解析出的文件变更列表 */
  diffFiles: DiffFile[];
  /** data/task/logs/ 解析出的任务日志条目 */
  logEntries: LogEntry[];
  /** --task 参数传入的任务描述（用于 A3 不改越界） */
  task?: string;
  /** --strict 模式：无日志时 A7 返回 FAIL 而非 WARN */
  strict?: boolean;
  /** --silent 模式：跳过日志依赖规则，走 diff 启发式回退 */
  silent?: boolean;
  /** commit message（用于 E2/A5 规则） */
  commitMsg?: string;
  /**
   * v1.5.3 第七章：审计范围显式对象（AuditScope）——规则**唯一**的 git 输入面。
   *
   * 规则需要「范围 / 作者 / HEAD 基线 / commit message」等需触达 git 的输入时，
   * 一律从本对象取（{@link AuditScope.commitMsg} / {@link AuditScope.actor} /
   * {@link AuditScope.headTreeFiles}），**不得**自行 `execFileSync('git', …)`。
   * 唯一构造**工厂** = `scope.ts` 的 `createAuditScope`（**主构造点**在 runner.ts；
   * 构造点进审计留痕）。
   *
   * 缺省 `undefined`：向后兼容直调 `scanXxx(ctx)` 的旧路径——规则退化为纯 diff 判定
   * （不触 git）。生产路径（runner / assembleCheck）恒附 scope。
   */
  scope?: AuditScope;
  /** .sofagent/config.yml 加载的审计配置（三级 fallback） */
  config?: AuditConfig;
  /** v1.0.9: 窗口内历史审计记录（A17 跨审计聚合用） */
  history?: { timestamp: string; diffFileCount: number }[];
  /**
   * v1.5.1 第七章：意图通道输入面（`<dataDir>/audit/intent.jsonl` 的解析结果）。
   *
   * 缺省 `undefined` = 本规则未接入意图通道（= 未声明通道的规则读不到它，行为零变化）。
   * 消费纪律：仅当规则在 {@link Rule.inputChannels} 显式声明 `'intent'` 时才应读取本字段。
   */
  intentEntries?: IntentEntry[];
  /** v1.3.3 #8: quick 模式标记（cli-quick 零配置审计）——A3 见到跳过越界检查（无任务描述必然误报） */
  quickMode?: boolean;
  /**
   * v1.5.2 A-8：CI 场景标记（--ci flag 经完整引擎传入）——拦截强度与证据形态解耦：
   * 二进制夹带等「本地 WARN 请人工确认」类发现，在无人值守场景升 FAIL（exit 2）。
   * quick 本地交互模式缺省 false，行为零变化。
   */
  ciMode?: boolean;
}

/**
 * 规则 scan 产出（v1.4.8 深模块条目 7）
 *
 * 规则文件只负责「判」——status（PASS/WARN/FAIL）与 details；
 * 前置块（id/name/number/evidenceMode/ruleClass）由 assembleCheck 从注册表 meta 装配。
 * 🔴 不模板化 verdict：各规则的 WARN / FAIL 分支属业务本体，各自保留。
 */
export interface RuleScan {
  status: RuleStatus;
  details: string[];
}

/**
 * 规则统一接口
 * 新增审计项时只需实现此接口并注册到 rules/index.ts
 */
export interface Rule {
  /**
   * v1.4.8 深模块条目 7：规范编号（'A1' / 'E1' …）——注册表声明一次，全工程唯一来源。
   * 由 rules/index.ts 的 `{ name: 'A…` 字面量显式填写；不等价于 number 的区间推导
   * （E1 的 number=201 而 id='E1'）。缺了它，各消费点只能各自重推编号（历史 6 处重复）。
   */
  id: string;
  name: string;
  number: number;
  /** 证据模式标注 */
  evidenceMode: EvidenceMode;
  /**
   * v1.5.1 第七章：规则输入通道声明。
   *
   * 缺省（`undefined`）= 结果通道 `['result']`——**未声明通道的规则行为零变化**；
   * 声明含 `'intent'` 的规则才消费 {@link AuditContext.intentEntries}（意图通道 opt-in）。
   * 默认值单源化在 `intent-channel.ts` 的 `resolveInputChannels`（勿在各消费点各自重推）。
   * 🔴 本字段只描述输入面，不参与判定——本章不新增规则、不改规则判定逻辑。
   */
  inputChannels?: AuditInputChannel[];
  /** 规则分级标签 */
  ruleClass?: RuleClass;
  /** 规则描述（v1.0.9） */
  description?: string;
  /**
   * v1.3.3 #11：审计优先级分组（单源化——不再在 runner.ts 维护独立 AUDIT_PRIORITY）
   * - critical: 安全红线——fast-fail 后续层（A1/A2/A9/A10/A20-A23）
   * - warning:  业务底线（A3/A4/A5/A11/A19）
   * - crutch:   拐杖规则，依赖日志最慢（A6/A7/A8/A18）
   * - extended: 扩展规则（A14-A17/A24/E1/E2/E4）
   * 新增规则只需在此填 priority，runner.ts 自动按组执行，无需双注册。
   */
  priority?: 'critical' | 'warning' | 'crutch' | 'extended';
  /** v1.3.0 (交付 7)：双规则统一——'diff' = 提交时扫 git diff；
   *  v1.5.3 第一章：由单值字面量扩为共用联合类型 {@link RuleType}，
   *  与 tool-level 引擎（engine/rules）同源——两引擎 import 同一套规则定义。 */
  ruleType: RuleType;
  /**
   * v1.4.0 交付四①（规则即测试 · execpolicy 启发）：
   * 命中/放行示例——进 acceptance 自动回归，规则对不对可自动化验证。
   * match = 该拦的样本（含文件名/内容片段），notMatch = 该放行的样本。
   *
   * v1.5.3 第二章（自测 schema）：加载时断言消费本字段（rule-loader.ts）。
   * 字段名与数组形状为 v1.6.0 判据集消费口径（`match[]` / `notMatch[]`）——**钉死，不得改名**。
   */
  examples?: {
    match: string[];
    notMatch: string[];
  };
  /**
   * v1.5.3 第二章：样例豁免标记（字段名与取值钉死，供 v1.6.0 lint 区分 stable/experimental）。
   *
   * - 缺省（`undefined`）= 无豁免：加载时强制 `examples{match,notMatch}` 均为**非空数组**。
   * - `'static-definition'`：静态定义类规则——无「输入样例」概念，显式豁免样例强制。
   *   豁免标记的规则视同缺负侧夹具，`stabilityOf` 归 **experimental**，不得进稳定规则集。
   */
  examplesExempt?: 'static-definition';
  /**
   * v1.5.3 第二章：样例**可执行**标记——该规则的 match/notMatch 是**可执行的触发样例**，
   * 加载时逐条执行断言（match 必命中 / notMatch 必不命中），任一失败 ⇒ 拒载整集（fail-closed）。
   *
   * 缺省 `undefined`（= false）：样例为**描述性训练样本**（如「删除 .sofagent/config.yml」），
   * 非可执行夹具——加载时只做 schema + 矛盾断言，不做执行断言。
   * 现状（v1.5.3 实测）：25 条中 5 条（A1/A2/A9/A20/A23）为**纯函数** scan、样例可执行，故标
   * examplesExecutable；其余为描述性样本。⚠️ 纯度纪律：scan 读 cwd/fs/git（如 A18 调
   * `git ls-tree HEAD`）则**不得**标可执行——加载期断言须确定性，不得随运行目录抖动。
   */
  examplesExecutable?: boolean;
  /** v1.4.0 交付四①：人类可读拦截理由（reporter 输出层渲染，替代笼统「违规」） */
  justification?: string;
  /**
   * v1.4.8 深模块条目 7：规则判定本体——只返回 status/details，前置块由 assembleCheck 装配。
   * 条 7 批四收口后为唯一执行入口（check 旧路径已删除）。
   */
  scan(ctx: AuditContext): RuleScan;
}
