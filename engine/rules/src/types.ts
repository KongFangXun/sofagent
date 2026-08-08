// ============================================================
// types.ts · P3 编排引擎内嵌——tool call 拦截器类型定义
// v1.2.8：从 audit 规则抽出为纯函数，零 fs/git 依赖
// ============================================================

/** 规则等级——与 audit 的 RuleClass 对齐 */
export type RuleClass = '业务底线' | '质量拐杖' | '效率';

/** 规则状态三态——与 audit 语义同源（铁律 #4 测试 SSOT） */
export type RuleStatus = 'PASS' | 'WARN' | 'FAIL';

/**
 * Tool call 上下文——tool call 粒度的同步上下文
 * 与 audit 的 AuditContext 完全分离（后者是 git diff 粒度的事后审计上下文）
 */
export interface ToolCallContext {
  /** 被调用的 tool 名称 */
  toolName: string;
  /** tool 调用参数 */
  args: Record<string, unknown>;
  /** 发起 tool call 的 Agent 名称 */
  agentName: string;
  /** 当前任务描述 */
  taskDesc: string;
  /** 工作目录 */
  cwd: string;
}

/**
 * 规则判定结果
 */
export interface InterceptVerdict {
  status: RuleStatus;
  /** 规则名称（加 tool- 前缀避免与 audit 同名规则混淆） */
  ruleName: string;
  /** 规则编号（沿用 audit 的 1/2/9） */
  ruleNumber: number;
  /** 详细信息 */
  details: string[];
  /** 修复建议 */
  suggestion: string;
}

/**
 * Tool 视角规则接口
 * 与 audit 的 RuleCheck 结构平行但独立（check 参数不同）
 */
export interface ToolRule {
  /** 规则名称（加 tool- 前缀） */
  name: string;
  /** 规则编号（沿用 audit 编号） */
  number: number;
  /** 规则等级 */
  ruleClass: RuleClass;
  /**
   * 检查 tool call 是否违规
   * @param ctx tool call 上下文
   * @returns 判定结果
   */
  check(ctx: ToolCallContext): InterceptVerdict;
}
