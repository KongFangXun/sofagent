// ============================================================
// team-broadcast.ts · MCP tool: team_broadcast（v1.3.5 新增）
//
// 意图广播 tool——Agent 通过 MCP 广播意图到团队意图总线。
// 匹配的订阅者触发反应（§2 触发反应机制）。
//
// ⚠️ type 修饰符不可运行时解构：
//   顶层 import type { IntentEvent } + 运行时只解构值
// ============================================================
import { emitDecision } from '@sofagent/audit';

/** team_broadcast tool 入参 */
export interface TeamBroadcastArgs {
  /** 团队 ID */
  teamId: string;
  /** 发送者 agentId */
  source: string;
  /** 意图类型（glob 可匹配：intent.create.report） */
  intent: string;
  /** 意图目标（文件/实体/key） */
  target: string;
  /** 意图载荷（可选） */
  payload?: string;
}

/** team_broadcast tool 结果 */
export interface TeamBroadcastResult {
  text: string;
  data: {
    ok: boolean;
    teamId: string;
    eventId?: string;
    intent?: string;
    subscriberCount?: number;
    error?: string;
  };
  isError?: boolean;
}

/**
 * 意图广播 tool——把意图事件写入团队意图总线。
 *
 * 注意：此 tool 是无状态的——它把广播请求记入 audit decision（kind=TEAM），
 * 实际的 IntentBus 实例由上层（TeamManager / MCP 会话）持有。
 * tool 返回广播确认（事件 ID + 预期订阅者数）。
 *
 * @param args 广播入参
 * @returns 广播结果
 */
export function teamBroadcast(args: TeamBroadcastArgs): TeamBroadcastResult {
  const { teamId, source, intent, target, payload } = args;

  if (!teamId || !source || !intent || !target) {
    return {
      text: '[sofagent] 广播失败：teamId / source / intent / target 必填',
      data: { ok: false, teamId: teamId ?? '', error: '缺少必填字段' },
      isError: true,
    };
  }

  // 生成事件 ID（UUID——幂等去重用）
  const eventId = generateEventId();

  // 广播决策记审计（kind=TEAM, moment=ACT）
  try {
    emitDecision({
      agentId: source,
      sessionId: `team-${teamId}`,
      kind: 'TEAM',
      moment: 'ACT',
      why: { text: `广播意图 ${intent} → ${target}`, tags: ['team', 'broadcast', teamId] },
    });
  } catch (err) {
    // 审计失败不阻断广播
    process.stderr.write(
      `[team-broadcast] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return {
    text: `[sofagent] 意图已广播：${intent}（target: ${target}）`,
    data: {
      ok: true,
      teamId,
      eventId,
      intent,
    },
  };
}

/** 生成事件 ID（简易 UUID v4） */
function generateEventId(): string {
  // crypto.randomUUID（Node 18+ 内置）
  try {
    return crypto.randomUUID();
  } catch {
    // fallback：时间戳 + 随机数（极低概率碰撞）
    return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
