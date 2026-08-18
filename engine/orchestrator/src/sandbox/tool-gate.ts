// ============================================================
// sandbox/tool-gate.ts · SubAgent 沙箱工具调用中介（前置 allow/deny）
// v1.3.7 · v1.3.7 开发① 新增
//
// 设计（changelog §一 + 攻击面声明第 4 条）：
//   前置拦截（非 v1.3.0 middleware 的事后记录）——高危工具调用在执行前
//   判定 allow/deny/human-approval。
//
//   工具调用伪装防御：按工具唯一 ID 判定（名称字符串可伪造，ID 不可——
//   ID 是注册时的 Symbol/数字句柄，SubAgent 无法构造不在注册表里的 ID）。
//
//   与交付② 场景权限的关系：tool-gate 是「执行边界的最后一米」——
//   policy-engine 做场景级判定（谁在什么场景能做什么），tool-gate 做
//   调用级强制（这一次调用放不放行）。守卫先于事件分发：判定发生在
//   工具执行之前。
// ============================================================

/** 工具唯一 ID（Symbol 保证不可伪造——名称字符串可被 SubAgent 篡改） */
export type ToolId = symbol & { readonly __toolId: unique symbol };

/** 工具风险等级 */
export type ToolRisk = 'low' | 'medium' | 'high' | 'critical';

/** 拦截判定 */
export type GateVerdict =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'human-approval'; reason: string };

export interface RegisteredTool {
  /** 唯一 ID（注册时分配，SubAgent 拿不到别的 ID） */
  id: ToolId;
  /** 工具名（展示用——判定不看这个） */
  name: string;
  /** 风险等级 */
  risk: ToolRisk;
  /** 是否需要人工批准（critical 默认 true） */
  requiresApproval?: boolean;
}

export interface ToolCallEvent {
  ts: string;
  toolName: string;
  risk: ToolRisk;
  verdict: 'allow' | 'deny' | 'human-approval';
  reason?: string;
}

export interface ToolGateOptions {
  /** 高危工具拦截规则（risk → 动作）覆盖表 */
  riskPolicy?: Partial<Record<ToolRisk, 'allow' | 'deny' | 'human-approval'>>;
}

export interface ToolGate {
  /** 注册工具——返回唯一 ID（后续调用必须带此 ID） */
  register(name: string, risk: ToolRisk, opts?: { requiresApproval?: boolean }): ToolId;
  /** 前置判定（守卫先于事件分发）——工具执行前调用 */
  check(toolId: ToolId): GateVerdict;
  /** 记录审批结果（human-approval 通过后放行一次） */
  markApproved(toolId: ToolId): void;
  /** 事件导出（审计出口） */
  exportEvents(): ToolCallEvent[];
  /** 按 ID 查注册信息（非法 ID 返回 null——防伪造） */
  lookup(toolId: ToolId): RegisteredTool | null;
}

/**
 * 创建工具中介门禁。
 *
 * 默认策略（可被 riskPolicy 覆盖）：
 *   low → allow / medium → allow / high → human-approval / critical → human-approval
 *   未注册 ID → deny（fail-closed：不认识的调用一律拒）
 */
export function createToolGate(options: ToolGateOptions = {}): ToolGate {
  const registry = new Map<ToolId, RegisteredTool>();
  const approvedOnce = new Set<ToolId>();
  const events: ToolCallEvent[] = [];

  const policy: Record<ToolRisk, 'allow' | 'deny' | 'human-approval'> = {
    low: 'allow',
    medium: 'allow',
    high: 'human-approval',
    critical: 'human-approval',
    ...(options.riskPolicy || {}),
  };

  function record(tool: RegisteredTool, verdict: GateVerdict): void {
    events.push({
      ts: new Date().toISOString(),
      toolName: tool.name,
      risk: tool.risk,
      verdict: verdict.action,
      reason: 'reason' in verdict ? verdict.reason : undefined,
    });
  }

  return {
    register(name, risk, opts) {
      const id = Symbol(name) as ToolId;
      registry.set(id, { id, name, risk, requiresApproval: opts?.requiresApproval ?? (risk === 'critical') });
      return id;
    },

    check(toolId) {
      const tool = registry.get(toolId);
      // fail-closed：未注册 ID（伪造/漂移）一律 deny
      if (!tool) {
        const verdict: GateVerdict = { action: 'deny', reason: '工具 ID 未注册（可能伪造或已注销）' };
        events.push({ ts: new Date().toISOString(), toolName: '<unknown-id>', risk: 'critical', verdict: 'deny', reason: verdict.reason });
        return verdict;
      }

      // 一次性审批已通过 → 放行并消耗
      if (approvedOnce.has(toolId)) {
        approvedOnce.delete(toolId);
        const verdict: GateVerdict = { action: 'allow' };
        record(tool, verdict);
        return verdict;
      }

      const action = tool.requiresApproval ? 'human-approval' : policy[tool.risk];
      const verdict: GateVerdict = action === 'allow'
        ? { action: 'allow' }
        : action === 'deny'
          ? { action: 'deny', reason: `风险等级 ${tool.risk} 按策略拒绝` }
          : { action: 'human-approval', reason: `高危工具（${tool.risk}）需人工批准` };
      record(tool, verdict);
      return verdict;
    },

    markApproved(toolId) {
      if (registry.has(toolId)) approvedOnce.add(toolId);
    },

    exportEvents() {
      return [...events];
    },

    lookup(toolId) {
      return registry.get(toolId) || null;
    },
  };
}

/**
 * 包装工具执行函数——守卫先于执行（前置强制，非事后记录）。
 *
 * 用法：
 *   const wrapped = gateToolExecution(gate, toolId, realFn);
 *   await wrapped(args); // deny 时抛 SOFAGENT_TOOL_DENIED，realFn 不执行
 */
export function gateToolExecution<A extends unknown[], R>(
  gate: ToolGate,
  toolId: ToolId,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R => {
    const verdict = gate.check(toolId);
    if (verdict.action === 'deny') {
      const err = new Error(`[sofagent-sandbox] 工具调用被拒: ${verdict.reason}`) as Error & { code: 'SOFAGENT_TOOL_DENIED' };
      err.code = 'SOFAGENT_TOOL_DENIED';
      throw err;
    }
    if (verdict.action === 'human-approval') {
      const err = new Error(`[sofagent-sandbox] 工具调用待人工批准: ${verdict.reason}`) as Error & { code: 'SOFAGENT_TOOL_PENDING_APPROVAL' };
      err.code = 'SOFAGENT_TOOL_PENDING_APPROVAL';
      throw err;
    }
    return fn(...args);
  };
}
