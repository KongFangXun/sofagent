// ============================================================
// mandate-gate-mw.ts · v1.5.2 章七 · 事前授权补环（mandate）执行前拦截
// ============================================================
//
// 现有审计是**事后**环（变更 → git diff → 规则 → 留痕可举证）。本 middleware 补
// **事前**环：动作请求与所持授权比对——**越范围 / 超时效 / 无授权 ⇒ 执行前拒绝**
// 并挂链留痕（对齐本版第五章出口治理面的裁决留痕形态，不另立通道）。
//
// 与 should-run 判定链的衔接（复用章三骨架，不新建第二套）：
//   本判定表达为 v1.5.2 第三章 should-run 骨架「人审 gate（human-gate）」一问的
//   自然扩展——授权是「谁批的 + 能碰什么 + 何时失效」的人审前置。判定直接跑
//   `should-run.ts` 的 `shouldRun()`（固定顺序 SHOULD_RUN_ORDER、fail-fast），
//   mandate 结论落在 `ShouldRunState.humanGate` 槽位；导出 `createMandateShouldRunGate`
//   让事件总线宿主也能把同一判定挂进 `EventBusOptions.shouldRunGate`。
//
// 🔒 降级纪律（与 should-run.permissiveProbe 逐字相同）：授权台账不可读 / 探针抛错
//   ⇒ **判通过**（绝不因缺数据拦住生产执行）。should-run.ts 的 permissiveProbe 为
//   **未导出**内部件（章三定稿未开出口，本版不越界改章三），故此处按其同款纪律实现
//   同步孪生 permissiveCheck——只提供降级包装，不构成第二套判定。
//
// 可拔契约（L1）：整环**默认关**——`enabled=false` 时 check() 直通返回 {allow:true}，
//   零留痕、输出逐字不变（与今日一致），**不留半开状态**。
//
// 留痕形态照章五 egress-audit.recordEgressDecision：走 emitDecision（同一
//   decision-log HMAC 链）；kind 恒为既有 TOOL_GATE，**不新增 kind、不改 schema**。
// ⚠️ emitDecision 会写真实数据目录——测试必须传临时 dataDir。
// ============================================================

import { emitDecision } from '@sofagent/audit';
import {
  shouldRun,
  createShouldRunGate,
  type ShouldRunCheck,
  type ShouldRunState,
  type ShouldRunProbe,
  type ShouldRunResult,
  type ShouldRunSuspension,
  type ShouldRunGate,
} from '../events/should-run';
import type { SofagentEvent } from '../events/types';

// ============================================================
// 契约面（consumer-owned port——orchestrator 侧只依赖本结构，不耦合 audit 实现）
// ============================================================

/** 动作请求（与 mandate-store.MandateActionRequest 结构兼容——由宿主适配） */
export interface MandateActionRequest {
  subject: string;
  action: string;
  target?: { path?: string; host?: string };
}

/** 越界判定结论码（与 mandate-store.MandateVerdict 同取值） */
export type MandateVerdict = 'covered' | 'no-mandate' | 'out-of-scope' | 'expired' | 'invalid-grant';

/** 越界判定结果（与 mandate-store.MandateEvaluation 结构兼容） */
export interface MandateCoverageVerdict {
  verdict: MandateVerdict;
  covered: boolean;
  reason: string;
  grantId?: string;
  approver?: string;
}

/**
 * 授权覆盖查询面（**端口契约**——生产注入 mandate-store 的适配）。
 *
 * 宿主适配示例（生产接线）：
 *   { covers: (req, now) => evaluateMandateRequest(req, now, dataDir) }
 */
export interface MandateCoverageQuery {
  covers(request: MandateActionRequest, now: Date): MandateCoverageVerdict;
}

/** 工具调用记录（执行前判定的输入） */
export interface MandateToolCall {
  /** 工具名（= 动作名） */
  toolName: string;
  /** 工具入参（提取路径 / host 做范围判定） */
  args: Record<string, unknown>;
  /** 动作主体（缺省取 options.subject / 'unknown'） */
  subject?: string;
  /** 调用描述（留痕用） */
  description?: string;
}

/** 一次执行前判定的结论 */
export interface MandateDecision {
  /** 是否放行（false ⇒ 执行前拒绝，调用方不得执行 next()） */
  allow: boolean;
  /** 拒绝信息（allow=false 时） */
  message?: string;
  /** 挂起详情（复用章三骨架的 ShouldRunSuspension——align 挂起语义） */
  suspension?: ShouldRunSuspension;
  /** 越界判定结论（enabled 且已判定时有值） */
  evaluation?: MandateCoverageVerdict;
}

/**
 * 工具执行前授权判定契约（tools.ts wrapToolsWithGate 消费面）。
 * 同步方法（工具执行点为同步）——与 wrapToolCall 共用同一判定核心。
 */
export interface MandateToolGate {
  check(call: MandateToolCall): MandateDecision;
}

// ============================================================
// 配置
// ============================================================

/** mandate 执行前拦截配置 */
export interface MandateGateOptions {
  /**
   * 整环开关（可拔契约 · L1）。**默认 false**——关档时 check() 直通
   * （{allow:true}）、零留痕、输出逐字不变（不留半开状态）。
   */
  enabled?: boolean;
  /**
   * 授权覆盖查询面（端口契约）。enabled=true 时由宿主注入 mandate-store 适配；
   * 缺省（未接线）时该判定问按「通过」处理——对齐章三「未接线的问恒通过、
   * 零行为变化」纪律。
   */
  query?: MandateCoverageQuery;
  /** 动作主体缺省值（call.subject 缺省时取之；再缺省为 'unknown'） */
  subject?: string;
  /** 动作请求映射覆盖（缺省按工具名 + 入参提取 path/host） */
  toRequest?: (call: MandateToolCall, now: Date) => MandateActionRequest;
  /** 时刻源覆盖（测试用；缺省当前时间） */
  now?: () => Date;
  /** 审计留痕归属 Agent（缺省 'mandate-gate'） */
  agentId?: string;
  /** 审计留痕会话标识（缺省按时刻构造） */
  sessionId?: string;
  /** 数据目录覆盖（测试用——透传 emitDecision 第二参数） */
  dataDir?: string;
}

// ============================================================
// 从入参提取范围判定目标
// ============================================================

/** 从工具入参提取文件路径（file_path / filePath / path / target） */
function extractPath(args: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'filePath', 'path', 'target']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

/** 从工具入参提取 host（host / url / endpoint——url 取 hostname） */
function extractHost(args: Record<string, unknown>): string | undefined {
  for (const key of ['url', 'endpoint', 'host']) {
    const v = args[key];
    if (typeof v !== 'string' || v.trim() === '') continue;
    try {
      const host = new URL(v).hostname;
      if (host !== '') return host;
    } catch {
      // 非 URL——仅 host 字段接受裸值
      if (key === 'host') return v;
    }
  }
  return undefined;
}

/** 缺省动作请求映射：主体 + 工具名 + 目标（path/host） */
function defaultToRequest(
  call: MandateToolCall,
  subjectDefault: string | undefined,
): MandateActionRequest {
  const subject = call.subject ?? subjectDefault ?? 'unknown';
  const path = extractPath(call.args);
  const host = extractHost(call.args);
  const target: { path?: string; host?: string } = {};
  if (path !== undefined) target.path = path;
  if (host !== undefined) target.host = host;
  return Object.keys(target).length > 0
    ? { subject, action: call.toolName, target }
    : { subject, action: call.toolName };
}

// ============================================================
// 降级纪律（permissiveProbe 的同步孪生）
// ============================================================

/**
 * 降级包装（should-run.permissiveProbe 的**同步孪生**）。
 *
 * should-run.ts 的 permissiveProbe 为未导出内部件，本版不越界改章三；此处按
 * **逐字相同**的纪律实现：探针抛错 ⇒ { ok:true }（判通过）。只提供降级包装，
 * 判定顺序/语义全部由 should-run 骨架承载，非第二套判定。
 */
function permissiveCheck(fn: () => ShouldRunCheck): { check: ShouldRunCheck; degraded: boolean } {
  try {
    return { check: fn(), degraded: false };
  } catch {
    return { check: { ok: true }, degraded: true };
  }
}

/**
 * 把「授权判定」挂进章三骨架的 human-gate 一问，跑完整判定链（固定顺序 + fail-fast）。
 *
 * 其余四问在此为恒通过（本 middleware 只管授权一问——人审 gate 的自然扩展）；
 * 判定链本身（顺序 / fail-fast / 结果形状）全部复用 `shouldRun()`。
 */
function runSkeleton(humanGate: ShouldRunCheck): ShouldRunResult {
  const state: ShouldRunState = {
    health: { ok: true },
    humanGate,
    evidence: { ok: true },
    focus: { ok: true },
    quota: { ok: true },
  };
  return shouldRun(state);
}

// ============================================================
// 骨架集成面：把 mandate 判定暴露为 human-gate 探针 / ShouldRunGate
// ============================================================

/** 授权判定 → ShouldRunCheck（挂 human-gate 槽位的探针体） */
function toHumanGateCheck(evaluation: MandateCoverageVerdict): ShouldRunCheck {
  if (evaluation.covered) return { ok: true };
  return {
    ok: false,
    detail: `授权越界（${evaluation.verdict}）：${evaluation.reason}`,
    resumeHint: '取到覆盖该动作的授权后自动恢复执行',
  };
}

/**
 * 构造 mandate 授权判定探针（可作为 should-run 骨架的 human-gate 探针）。
 *
 * 从事件 metadata 提取动作（toolName / args / agentId）——事件总线宿主若要在
 * 派发前置（publish 前）就跑授权判定，可用本探针。
 */
export function mandateShouldRunProbe(
  query: MandateCoverageQuery,
  options: { subject?: string; now?: () => Date; toRequest?: (call: MandateToolCall, now: Date) => MandateActionRequest } = {},
): ShouldRunProbe {
  return (event: SofagentEvent): ShouldRunCheck => {
    const meta = (event.metadata ?? {}) as Record<string, unknown>;
    const toolName = typeof meta.toolName === 'string' ? meta.toolName : 'unknown';
    const args =
      meta.args && typeof meta.args === 'object' ? (meta.args as Record<string, unknown>) : {};
    const subject = typeof meta.agentId === 'string' ? meta.agentId : event.targetNodeId;
    const call: MandateToolCall = {
      toolName,
      args,
      ...(subject !== undefined ? { subject } : {}),
    };
    const now = options.now ? options.now() : new Date();
    const request = options.toRequest
      ? options.toRequest(call, now)
      : defaultToRequest(call, options.subject);
    return toHumanGateCheck(query.covers(request, now));
  };
}

/**
 * 由授权查询面组装 should-run gate（喂给 EventBusOptions.shouldRunGate）。
 *
 * mandate 判定挂在 human-gate 一问；其余四问未接线恒通过（章三骨架「未接线的问
 * 恒通过」纪律）。探针抛错经 permissiveCheck 降级为通过。
 */
export function createMandateShouldRunGate(
  query: MandateCoverageQuery,
  options: { subject?: string; now?: () => Date; toRequest?: (call: MandateToolCall, now: Date) => MandateActionRequest } = {},
): ShouldRunGate {
  const probe = mandateShouldRunProbe(query, options);
  return createShouldRunGate({
    // mandate 判定为同步（台账读取同步）——probe 恒返回 ShouldRunCheck，非 Promise
    'human-gate': (event: SofagentEvent) => permissiveCheck(() => probe(event) as ShouldRunCheck).check,
  });
}

// ============================================================
// Middleware
// ============================================================

/**
 * 事前授权补环 middleware——执行前越界判定 + 拒绝挂链留痕。
 *
 * 用法（与 DualGateMiddleware 同款 wrap 模式）：
 *   const gate = new MandateGateMiddleware({ enabled: true, query, dataDir });
 *   const result = await gate.wrapToolCall(
 *     { toolName: 'sf_write', args: { path: 'src/a.ts' } },
 *     () => tool.run(...),
 *   );
 *
 * 生命周期（对齐 DualGateMiddleware.wrapToolCall）：
 *   - 关档（默认）：check() ⇒ {allow:true}，不读台账、不落留痕；wrapToolCall 直接 next()。
 *   - 开档：执行 next() **之前**判定；越范围/超时效/无授权 ⇒ **不执行 next()**，
 *     返回明确拒绝信息（不抛未捕获异常）并 emitDecision 留痕。
 */
export class MandateGateMiddleware implements MandateToolGate {
  private readonly enabled: boolean;
  private readonly query?: MandateCoverageQuery;
  private readonly subjectDefault?: string;
  private readonly toRequestOverride?: (call: MandateToolCall, now: Date) => MandateActionRequest;
  private readonly nowFn: () => Date;
  private readonly agentId: string;
  private readonly sessionId?: string;
  private readonly dataDir?: string;
  /** 已判定次数（可观测性 + 测试断言） */
  private evaluatedCount = 0;
  /** 已拒绝次数（可观测性 + 测试断言） */
  private deniedCount = 0;

  constructor(options: MandateGateOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.query = options.query;
    this.subjectDefault = options.subject;
    this.toRequestOverride = options.toRequest;
    this.nowFn = options.now ?? (() => new Date());
    this.agentId = options.agentId ?? 'mandate-gate';
    this.sessionId = options.sessionId;
    this.dataDir = options.dataDir;
  }

  /** 整环是否启用（可拔契约观测点） */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** 已判定次数 */
  getEvaluatedCount(): number {
    return this.evaluatedCount;
  }

  /** 已拒绝次数 */
  getDeniedCount(): number {
    return this.deniedCount;
  }

  /**
   * 执行前判定一次工具调用（同步——工具执行点消费）。
   *
   * 与 {@link wrapToolCall} 共用同一判定核心（`evaluate` + 章三 shouldRun 骨架）。
   * 关档直通；开档时越界即拒绝并 emitDecision 留痕。
   */
  check(call: MandateToolCall): MandateDecision {
    // ── 可拔契约（L1）：关档直通——不读台账、不落留痕、输出逐字不变 ──
    if (!this.enabled) return { allow: true };

    const now = this.nowFn();
    const request = this.buildRequest(call, now);

    // ── 判定表达为章三骨架的 human-gate 一问（探针抛错 ⇒ permissive 判通过）──
    let evaluation: MandateCoverageVerdict | undefined;
    const { check: humanGate } = permissiveCheck(() => {
      const q = this.query;
      if (!q) return { ok: true }; // 未接线的问恒通过（章三纪律）
      evaluation = q.covers(request, now);
      return toHumanGateCheck(evaluation);
    });
    const result = runSkeleton(humanGate);

    // ── 放行：留 allow 裁决（对齐章五「Allow 也留痕」形态）──
    if (result.run) {
      this.evaluatedCount += 1;
      this.recordAudit(call, evaluation, 'allow');
      return evaluation ? { allow: true, evaluation } : { allow: true };
    }

    // ── 拒绝：不执行 next()，返回明确拒绝信息 + 挂链留痕 ──
    this.evaluatedCount += 1;
    this.deniedCount += 1;
    const suspension = result.suspended;
    const message = buildRejectMessage(call, suspension);
    this.recordAudit(call, evaluation, 'deny', suspension);
    return {
      allow: false,
      message,
      ...(suspension ? { suspension } : {}),
      ...(evaluation ? { evaluation } : {}),
    };
  }

  /**
   * 包装一次工具调用——**在执行 next() 之前**判定；越界 ⇒ 不执行 next()。
   *
   * @param call 工具调用记录
   * @param next 实际工具调用
   * @returns 工具结果；越界时返回拒绝信息（不抛未捕获异常，也不执行 next()）
   */
  async wrapToolCall<T>(call: MandateToolCall, next: () => Promise<T>): Promise<T | string> {
    const decision = this.check(call);
    if (!decision.allow) {
      return decision.message ?? `⛔ [mandate 拦截] ${call.toolName} 无有效授权，拒绝执行`;
    }
    return next();
  }

  /** 构造动作请求（覆盖优先，缺省按工具名 + 入参提取 path/host） */
  private buildRequest(call: MandateToolCall, now: Date): MandateActionRequest {
    if (this.toRequestOverride) return this.toRequestOverride(call, now);
    return defaultToRequest(call, this.subjectDefault);
  }

  /**
   * 挂链留痕（对齐章五 egress-audit 形态）——走 emitDecision（decision-log HMAC 链）。
   *
   * kind 恒为既有 TOOL_GATE（不新增 kind）；category：allow → 'select'；
   * deny 中「无授权 / 三元素不全」→ 'escalate'（需人审授权），
   * 「越范围 / 超时效」→ 'skip'（明确不覆盖，跳过）。moment='ACT'。
   * 留痕失败静默降级（不阻断裁决——对齐 dual-gate / egress 哲学）。
   */
  private recordAudit(
    call: MandateToolCall,
    evaluation: MandateCoverageVerdict | undefined,
    verdict: 'allow' | 'deny',
    suspension?: ShouldRunSuspension,
  ): void {
    try {
      const code = evaluation?.verdict ?? 'no-mandate';
      const subject = call.subject ?? this.subjectDefault ?? 'unknown';
      const category =
        verdict === 'allow'
          ? 'select'
          : code === 'no-mandate' || code === 'invalid-grant'
            ? 'escalate'
            : 'skip';
      const detail = evaluation?.reason ?? suspension?.reason ?? '未取得覆盖该动作的授权';
      const evidence: string[] = [
        `subject=${subject}`,
        `action=${call.toolName}`,
        `verdict=${verdict}`,
        `code=${code}`,
      ];
      if (evaluation?.grantId !== undefined) evidence.push(`grantId=${evaluation.grantId}`);
      if (evaluation?.approver !== undefined) evidence.push(`approver=${evaluation.approver}`);
      emitDecision(
        {
          agentId: this.agentId,
          sessionId: this.sessionId ?? `mandate-${Date.now()}`,
          kind: 'TOOL_GATE',
          moment: 'ACT',
          category,
          why: {
            text:
              verdict === 'allow'
                ? `授权覆盖放行：工具 ${call.toolName}（${code}）——${detail}`
                : `授权越界拒绝：工具 ${call.toolName}（${code}）——${detail}`,
            tags: ['mandate', verdict, code],
            confidence: 'high',
          },
          artifactRef: `mandate/${subject}/${call.toolName}`,
          evidence,
        },
        this.dataDir,
      );
    } catch (err) {
      // 留痕失败不阻断裁决（拒绝信息已通过返回值传达）——但**降级必须可见**：
      // 审计链写入失败属安全相关降级，静默吞掉会让「该授权裁决没进链」无人知晓
      // （emitDecision 本身不吞错、失败即抛，故此处是唯一可观测点）。
      console.warn(
        `  ⚠️ mandate 裁决留痕失败（不阻断裁决，但该裁决未进审计链）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** 组装拒绝信息（不抛异常路线——返回明确文本） */
function buildRejectMessage(call: MandateToolCall, suspension: ShouldRunSuspension | undefined): string {
  const reason = suspension?.reason ?? '未取得覆盖该动作的授权';
  const hint = suspension?.resumeHint ?? '取到覆盖该动作的授权后自动恢复执行';
  return `⛔ [mandate 事前授权拦截] 工具 ${call.toolName} 越界，执行前拒绝：${reason}（恢复：${hint}）`;
}
