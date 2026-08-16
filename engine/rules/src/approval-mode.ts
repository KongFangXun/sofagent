// ============================================================
// approval-mode.ts · 工具审批四模式（v1.3.5 交付 10）
//
// 设计来源：PenguinHarness CLI --approve 四模式
//（allow-all / deny-all / read-only / always-ask）。
//
// 四种模式行为：
//   allow-with-audit  全部放行 + 写审计日志（默认模式 = v1.3.5 行为，不破坏既有）
//   deny-all          全部拦截（调试/安全演练）
//   read-only         只读工具（permission='r'）自动放行，读写需人工确认（Benchmark 评测）
//   always-ask        每次工具调用都问人（危险操作密集场景）
//
// 保守默认拒绝（安全铁律 #7）：需要人工确认的场景（read-only 遇 rw /
// always-ask）若 SDK 未提供审批回调 → 默认拒绝一切，不是放行。
// ============================================================

/** 工具审批四模式 */
export type ApprovalMode = 'allow-with-audit' | 'deny-all' | 'read-only' | 'always-ask';

/** 审批判定结果 */
export interface ApprovalResult {
  /** 是否放行（false 时调用方应走人工确认或拒绝） */
  allow: boolean;
  /** 人类可读判定理由（写审计日志） */
  reason: string;
  /** 本次判定所用的模式 */
  mode: ApprovalMode;
}

/**
 * 按审批模式 + 工具权限判定是否放行。
 *
 * 注意：本函数只做「模式级」判定——read-only 遇 rw 工具、always-ask 遇任何工具
 * 返回 allow:false + reason='待人工确认'，实际人工确认由 middleware 层
 *（approvalCallback）执行；无回调时由 middleware 按保守默认拒绝处理。
 *
 * @param mode 审批模式
 * @param permission 工具权限标记（'r' 只读 / 'rw' 读写）
 * @returns ApprovalResult
 */
export function shouldApprove(
  mode: ApprovalMode,
  permission: 'r' | 'rw',
): ApprovalResult {
  switch (mode) {
    case 'allow-with-audit':
      return { allow: true, reason: '放行（审计日志已写）', mode };
    case 'deny-all':
      return { allow: false, reason: 'deny-all 模式拦截', mode };
    case 'read-only':
      if (permission === 'r') {
        return { allow: true, reason: 'read-only 放行只读', mode };
      }
      return { allow: false, reason: 'read-only 拦截读写（待人工确认）', mode };
    case 'always-ask':
      // 需人工确认——交给 HITL 回调（middleware 层）
      return { allow: false, reason: 'always-ask 待人工确认', mode };
    default: {
      // 未知模式 → 保守默认拒绝（安全铁律：宁可错杀不可放行）
      const exhaustive: never = mode;
      return { allow: false, reason: `未知审批模式 ${String(exhaustive)} → 保守拒绝`, mode };
    }
  }
}
