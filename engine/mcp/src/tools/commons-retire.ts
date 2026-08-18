// ============================================================
// commons-retire.ts · MCP tool: commons_retire（v1.3.7 交付 3）
//
// 能力退役 / 恢复——强制 owner 确认（confirmed=true 才执行）。
// 退役只标记（可恢复），不物理删除（保留审计轨迹）。
//
// 复用 @sofagent/orchestrator 的 commons/retire.ts：
//   markRetired / restoreCapability / scanRetireCandidates
// ============================================================
// ============================================================
// 类型定义
// ============================================================

export interface CommonsRetireArgs {
  /** 能力 ID（必填） */
  capability_id: string;
  /** 操作：retire=退役 / restore=恢复 / scan=扫描退役候选 */
  action: 'retire' | 'restore' | 'scan';
  /** 退役原因（action=retire 时填） */
  reason?: 'owner_request' | 'low_invoke' | 'low_rating' | 'manual';
  /** owner 确认标志——action=retire 时必须 true（强制 owner 确认） */
  confirmed?: boolean;
}

export interface CommonsRetireResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    ok: boolean;
    capabilityId?: string;
    action?: string;
    candidates?: Array<{ capabilityId: string; name: string; reason: string; detail: string }>;
    error?: string;
  };
  isError?: boolean;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 能力退役 / 恢复 / 扫描退役候选。
 *
 * @param args 入参
 * @returns 结果
 */
export async function commonsRetire(args: CommonsRetireArgs): Promise<CommonsRetireResult> {
  if (!args.capability_id || !args.action) {
    return {
      text: '[sofagent] commons_retire 错误: capability_id 和 action 必填',
      data: { ok: false, error: 'capability_id 和 action 必填' },
      isError: true,
    };
  }

  try {
    const mod = require('@sofagent/orchestrator') as {
      markRetired: (id: string, reason: string, confirmed: boolean, dataDir?: string) => { ok: boolean; reason?: string };
      restoreCapability: (id: string, dataDir?: string) => { ok: boolean; reason?: string };
      scanRetireCandidates: (dataDir?: string, stats?: Map<string, { invokeCount: number; avgRating: number }>) => Array<{ capabilityId: string; name: string; reason: string; detail: string }>;
    };

    if (args.action === 'retire') {
      if (!args.confirmed) {
        return {
          text: '[sofagent] 退役必须 owner 确认（confirmed=true）',
          data: { ok: false, capabilityId: args.capability_id, action: 'retire', error: '需 owner 确认' },
          isError: true,
        };
      }
      const reason = args.reason ?? 'manual';
      const r = mod.markRetired(args.capability_id, reason, true);
      if (!r.ok) {
        return {
          text: `[sofagent] 退役失败: ${r.reason}`,
          data: { ok: false, capabilityId: args.capability_id, action: 'retire', error: r.reason },
          isError: true,
        };
      }
      return {
        text: `[sofagent] 能力「${args.capability_id}」已退役（${reason}，可恢复）`,
        data: { ok: true, capabilityId: args.capability_id, action: 'retire' },
      };
    }

    if (args.action === 'restore') {
      const r = mod.restoreCapability(args.capability_id);
      if (!r.ok) {
        return {
          text: `[sofagent] 恢复失败: ${r.reason}`,
          data: { ok: false, capabilityId: args.capability_id, action: 'restore', error: r.reason },
          isError: true,
        };
      }
      return {
        text: `[sofagent] 能力「${args.capability_id}」已从退役恢复为 active`,
        data: { ok: true, capabilityId: args.capability_id, action: 'restore' },
      };
    }

    // action === 'scan'
    const candidates = mod.scanRetireCandidates();
    const lines = [`[sofagent] 退役候选扫描：${candidates.length} 个能力待评估`];
    for (const c of candidates) {
      lines.push(`  - ${c.capabilityId} (${c.name}): ${c.reason} — ${c.detail}`);
    }
    return {
      text: lines.join('\n'),
      data: { ok: true, action: 'scan', candidates },
    };
  } catch (err) {
    return {
      text: `[sofagent] commons_retire 失败: ${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, error: err instanceof Error ? err.message : String(err) },
      isError: true,
    };
  }
}
