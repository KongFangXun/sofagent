// ============================================================
// execution-state/protocol.ts · v1.5.7 章一 · SKILL.state 执行协议核心
// ============================================================
// 协议六要素的实现核心（P 恒定 / Σt 唯一记忆 / ot 仅最新 / ΔΣt 代码合并
// 校验 fail-closed / Rt 弃前落审计摘要 / executionMode 双模式）。
//
// 🔴 合并不靠模型自觉，靠代码保证：applyPatch 对每个字段跑 schema validator，
//    校验不过即拒绝该补丁（返回 rejected），连续 N 次拒绝触发节点降级。
// ============================================================
import { getSchema, initialState, type NodeKind } from './schema';

/** JSON Patch 子集——模型每步随动作输出的状态补丁形态 */
export interface StatePatch {
  op: 'add' | 'remove' | 'update';
  path: string; // Σt 顶层字段名（本协议只接受顶层补丁——嵌套合并语义留给领域代码）
  value?: unknown;
}

/** 单步执行的三元输出（模型侧契约——Rt 在验证通过后由执行器丢弃） */
export interface StepOutput {
  /** 推理轨迹 Rt（本步完整保留供推理；验证后不进下一步 prompt） */
  reasoning: string;
  /** 状态补丁 ΔΣt */
  patch: StatePatch[];
  /** 动作 at（工具调用描述——审计摘要用） */
  action: string;
}

/** 补丁应用结果 */
export type PatchResult =
  | { ok: true; state: Record<string, unknown> }
  | { ok: false; reason: string; rejectedPath?: string };

/** 审计摘要（Rt 丢弃前落 wrapToolCall 通道——「轨迹可弃、行为可溯」） */
export interface AuditDigest {
  kind: NodeKind | 'legacy';
  action: string;
  patch: StatePatch[];
  /** 因果边：本步动作 → 状态字段变更 */
  causalEdges: Array<{ action: string; field: string }>;
  /** 步序（0 起） */
  step: number;
  timestamp: string;
}

/** 合并选项 */
export interface MergeOptions {
  /** 连续失败多少次后自动降级 legacy（默认 3） */
  autoDegradeThreshold?: number;
}

/**
 * Σt+1 = Σt ⊕ ΔΣt —— 运行时确定性合并（schema 校验 fail-closed）。
 *
 * 规则：
 *   · add/update：字段值经 schema validator 校验，不过即拒绝**整个补丁**（不部分应用——
 *     部分应用会让 Σt 进入「半更新」脏态，后续步骤基于脏态推理）；
 *   · remove：只允许领域字段移除**条目**（数组 filter 语义），不允许删基础六字段键；
 *   · path 必须是注册表内字段（基础或领域）——未知字段拒绝（防状态面无限膨胀）。
 */
export function applyPatch(
  kind: NodeKind,
  state: Record<string, unknown>,
  patch: StatePatch[],
): PatchResult {
  const schema = getSchema(kind);
  const fields = new Map([...schema.base, ...schema.domain].map((f) => [f.name, f]));
  const next = { ...state };

  for (const p of patch) {
    const spec = fields.get(p.path);
    if (!spec) {
      return { ok: false, reason: `未知状态字段: ${p.path}（合法: ${[...fields.keys()].join(', ')}）`, rejectedPath: p.path };
    }
    if (p.op === 'remove') {
      if (!spec.domain) {
        return { ok: false, reason: `基础字段不可移除: ${p.path}`, rejectedPath: p.path };
      }
      // remove 语义：从数组/记录中剔除 value 指定的条目
      const cur = next[p.path];
      if (Array.isArray(cur) && p.value !== undefined) {
        next[p.path] = cur.filter((x) => x !== p.value);
      } else if (cur && typeof cur === 'object' && typeof p.value === 'string') {
        const { [p.value]: _drop, ...rest } = cur as Record<string, unknown>;
        next[p.path] = rest;
      } else {
        // 两个分支都不命中 = 非法 remove 形态（数组无 value / 对象 value 非 string / 当前值既非数组非对象）
        // 静默跳过会让「模型以为删了」与「实际没删」分叉——fail-closed 拒绝整批
        return { ok: false, reason: 'remove 需合法 value（数组按值剔除/对象按键剔除）', rejectedPath: p.path };
      }
      continue;
    }
    // add / update
    const value = p.op === 'add' && Array.isArray(next[p.path]) && Array.isArray(p.value)
      ? [...(next[p.path] as unknown[]), ...p.value] // add 到数组 = 追加
      : p.value;
    if (spec.validator && !spec.validator(value)) {
      return { ok: false, reason: `字段 ${p.path} 值类型非法（期望 ${spec.type}）`, rejectedPath: p.path };
    }
    next[p.path] = value;
  }
  return { ok: true, state: next };
}

/**
 * 步进：应用一步输出，产出新 Σt + 审计摘要。
 *
 * Rt 的处置在调用方（协议执行器）：本函数只产出 AuditDigest，**不留存 reasoning**
 * ——「轨迹可弃、行为可溯」的代码保证点。
 */
export function step(
  kind: NodeKind,
  state: Record<string, unknown>,
  out: StepOutput,
  stepIndex: number,
): { result: PatchResult; digest: AuditDigest } {
  const result = applyPatch(kind, state, out.patch);
  const causalEdges = result.ok
    ? out.patch.map((p) => ({ action: out.action, field: p.path }))
    : [];
  return {
    result,
    digest: {
      kind,
      action: out.action,
      patch: out.patch,
      causalEdges,
      step: stepIndex,
      timestamp: new Date().toISOString(),
    },
  };
}

export { initialState };

/**
 * 执行模式解析（降级开关语义）：
 *   · SOFAGENT_STATEFUL_EXEC=off ⇒ 全局回退 legacy（一键）；
 *   · kind 级 config 可显式指定；
 *   · 缺省 stateful。
 */
export function resolveExecutionMode(
  kind: NodeKind,
  nodeConfig?: { executionMode?: 'stateful' | 'legacy' },
): 'stateful' | 'legacy' {
  if (process.env.SOFAGENT_STATEFUL_EXEC === 'off') return 'legacy';
  return nodeConfig?.executionMode ?? 'stateful';
}

/**
 * 连续补丁失败自动降级判定。
 * @param consecutiveFailures 已连续拒绝次数
 * @param threshold 阈值（默认 3）
 */
export function shouldAutoDegrade(consecutiveFailures: number, threshold = 3): boolean {
  return consecutiveFailures >= threshold;
}
