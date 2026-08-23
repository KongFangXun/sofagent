// ============================================================
// types.ts · AST 规则引擎类型定义
// v1.4.0（一）：官方 AST 规则引擎参考实现（sofagent-ruleset-ast）
//
// 设计原则：
// - 规则与引擎解耦——规则只声明 check 钩子，遍历由引擎统一驱动
// - 两种规则形态：AST 规则（解析 TS/JS 语法树）+ 文本规则（markdown/清单类文件）
// - 与 v1.2.9 插件接口同构——plugin-adapter 把 PluginContext 转成本包的扫描入参
// ============================================================
/** 规则严重级别（与审计规则集对齐） */
export type AstSeverity = 'FAIL' | 'WARN';

/** 扫描输入——单个待检文件 */
export interface AstScanInput {
  /** 原始文件路径（用于报告定位） */
  path: string;
  /** 文件内容（完整内容或 diff 重建内容） */
  content: string;
}

/** 扫描产出——单条规则命中 */
export interface AstFinding {
  /** 命中的规则 ID */
  ruleId: string;
  /** 文件路径 */
  file: string;
  /** 行号（1-based） */
  line: number;
  /** 违规描述 */
  message: string;
  /** 严重级别 */
  severity: AstSeverity;
}

/** AST 规则的检查上下文——引擎对每个文件调用一次 */
export interface AstRuleContext {
  /** 文件原始路径 */
  path: string;
  /** 临时文件里的语法树根节点（duck-typed TS RemoteSourceFile） */
  sourceFile: AstNodeHost;
  /** 文件全文 */
  text: string;
  /** SyntaxKind 名字→数字（如 kind('CallExpression')；未加载 TS 时返回 -1 恒不匹配） */
  kind(name: string): number;
  /** 上报一条命中（node 提供 位置信息） */
  report(node: AstNodeHost, message: string): void;
  /** 上报一条命中（无节点，直接给行号） */
  reportLine(line: number, message: string): void;
}

/** 文本规则的检查上下文——引擎对每个文件调用一次 */
export interface AstTextRuleContext {
  /** 文件原始路径 */
  path: string;
  /** 文件全文 */
  text: string;
  /** 上报一条命中 */
  report(line: number, message: string): void;
}

/**
 * TS 语法树节点（duck-typing 最小面）。
 * TypeScript 7 原生端 RemoteNode 的结构：kind 为数字，
 * 子属性（expression/arguments 等）按需惰性解码。
 */
export interface AstNodeHost {
  /** 节点种类（数字，经 SyntaxKind 映射取名） */
  readonly kind: number;
  /** 标识符/字面量文本（Token 类节点有） */
  readonly text?: string;
  /** 语句列表（SourceFile 有） */
  readonly statements?: readonly AstNodeHost[];
  /** 遍历直接子节点 */
  forEachChild(cb: (child: AstNodeHost) => void): void;
  /** 节点起始位置（不含前导 trivia） */
  getStart(): number;
}

/** 一条 AST 规则的声明 */
export interface AstRule {
  /** 规则唯一 ID */
  id: string;
  /** 规则显示名 */
  name: string;
  /** 严重级别 */
  severity: AstSeverity;
  /** 规则说明（写进规则集 JSON） */
  description: string;
  /** 适用文件 glob（简化后缀匹配，如 .ts/.js/.md） */
  filePattern?: RegExp;
  /** AST 检查钩子（TS/JS 文件） */
  checkCode?(ctx: AstRuleContext): void;
  /** 文本检查钩子（markdown/清单文件） */
  checkText?(ctx: AstTextRuleContext): void;
}
