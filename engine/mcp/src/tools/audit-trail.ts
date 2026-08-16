// ============================================================
// audit-trail.ts · MCP tool：跨设备审计轨迹查询（v1.3.5 交付 7）
// ============================================================
//
// 按 agentId 查完整轨迹（合并跨设备审计记录）：
//   audit_trail({ agent_id, include_peers?, local_data_dir? })
//     → 读本地 history.jsonl + 可选 peer 记录 → mergeAuditTrails
//       （HMAC 验签 + trust 优先级裁决）→ 按 agentId 返回完整轨迹
//   audit_trail({})（无 agent_id）
//     → 列出全部有审计轨迹的 agent 及其记录数
//
// 复用 @sofagent/daemon 的跨设备合并原语（动态 import——workspace
// symlink 解析，不新增包依赖）。
// ============================================================

// 测试注入：MCP 单测不依赖真实文件系统/联邦通道——经
// setAuditTrailTestRecords 注入 fake 记录（含跨设备 peer 记录）

/** 审计记录最小结构（测试注入 + 本地读出的公共形状） */
interface AuditTrailTestEntry {
  timestamp: string;
  diffRange: string;
  exitCode: number;
  agentId?: string;
  commitSha?: string;
}

let _testRecords: Array<{ entry: AuditTrailTestEntry; deviceId: string; trust: string }> | null = null;

/**
 * 测试用审计记录注入（MCP 单测隔离——不读真实 history.jsonl）。
 * @param records fake 设备审计记录；null 恢复默认（读真实本地历史）
 */
export function setAuditTrailTestRecords(
  records: Array<{ entry: AuditTrailTestEntry; deviceId: string; trust: string }> | null,
): void {
  _testRecords = records;
}

// ============================================================
// 类型定义
// ============================================================

export interface AuditTrailArgs {
  /** Agent 身份码（缺省 = 列出全部有轨迹的 agent） */
  agent_id?: string;
  /** 是否包含跨设备 peer 记录（缺省 false——仅本地） */
  include_peers?: boolean;
}

export interface AuditTrailResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    agentId?: string;
    agents?: Array<{ agentId: string; recordCount: number; devices: string[] }>;
    trail?: Array<{
      timestamp: string;
      diffRange: string;
      exitCode: number;
      deviceId: string;
      trust: string;
      hmacStatus: string;
      commitSha?: string;
    }>;
    isError: boolean;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 按 agentId 查询跨设备审计轨迹（无 agent_id 时列出全部）。
 *
 * @param args 参数
 * @returns 结构化结果（text + data）
 */
export async function auditTrail(args: AuditTrailArgs = {}): Promise<AuditTrailResult> {
  try {
    const { readLocalAuditHistory, mergeAuditTrails, buildAuditTrailByAgent } = await import('@sofagent/daemon');
    const { loadEnvConfig } = await import('@sofagent/core');

    // 组装设备记录：本地（internal trust——默认不被 peer 覆盖）
    let localRecords: Array<{ entry: AuditTrailTestEntry; deviceId: string; trust: string }>;
    if (_testRecords) {
      localRecords = _testRecords;
    } else {
      const local = readLocalAuditHistory(loadEnvConfig().dataDir);
      localRecords = local.map((entry: { timestamp: string; diffRange: string; exitCode: number; agentId?: string; commitSha?: string }) => ({
        entry,
        deviceId: 'local',
        trust: 'internal',
      }));
    }

    // 跨设备 peer 记录：当前无实时代理（channel 加密配对由 daemon 侧承载）——
    // include_peers 时仅合并已注入/已落盘的 peer 记录（测试注入路径）
    const merged = mergeAuditTrails(localRecords as never);

    // 按 agentId 聚合
    const byAgent = buildAuditTrailByAgent(merged as never, args.agent_id);

    // ── 无 agent_id：列出全部 ──
    if (!args.agent_id) {
      const agents = Object.entries(byAgent).map(([id, entries]) => ({
        agentId: id,
        recordCount: entries.length,
        devices: [...new Set(entries.map((e: { deviceId: string }) => e.deviceId))],
      }));
      const lines = [`[sofagent] audit_trail 共 ${agents.length} 个 agent 有审计轨迹:`];
      for (const a of agents) {
        lines.push(`  - ${a.agentId}: ${a.recordCount} 条记录，来自 ${a.devices.join(', ')}`);
      }
      return { text: lines.join('\n'), data: { agents, isError: false } };
    }

    // ── 有 agent_id：返回完整轨迹 ──
    const trail = byAgent[args.agent_id] ?? [];
    if (trail.length === 0) {
      return {
        text: `[sofagent] audit_trail: agent "${args.agent_id}" 无审计轨迹（暂无可聚合记录）`,
        data: { agentId: args.agent_id, trail: [], isError: false },
      };
    }
    const lines = [`[sofagent] audit_trail: agent "${args.agent_id}" 完整轨迹（${trail.length} 条，按时间升序）:`];
    for (const item of trail) {
      const e = item.entry as { timestamp: string; diffRange: string; exitCode: number; commitSha?: string };
      lines.push(
        `  - [${e.timestamp}] ${e.diffRange} exit=${e.exitCode}@${item.deviceId}(${item.trust}) hmac=${item.hmacStatus}${e.commitSha ? ` sha=${e.commitSha}` : ''}`,
      );
    }
    return {
      text: lines.join('\n'),
      data: {
        agentId: args.agent_id,
        trail: trail.map((item) => ({
          timestamp: String(item.entry.timestamp ?? ''),
          diffRange: String(item.entry.diffRange ?? ''),
          exitCode: Number(item.entry.exitCode ?? 0),
          deviceId: item.deviceId,
          trust: item.trust,
          hmacStatus: item.hmacStatus,
          ...(item.entry.commitSha ? { commitSha: String(item.entry.commitSha) } : {}),
        })),
        isError: false,
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] audit_trail 查询失败：${err instanceof Error ? err.message : String(err)}`,
      data: { isError: true },
    };
  }
}
