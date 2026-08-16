// ============================================================
// team-create.ts · MCP tool: team_create（v1.3.6 新增）
//
// 建队 tool——创建团队，写入 data/teams/<team-id>/team.yml。
// 解析 team.yml 格式（dev prompt L77-95）后持久化。
// ============================================================

import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';

/** team_create tool 入参 */
export interface TeamCreateArgs {
  /** team.yml 文本内容（YAML 格式，含 name/team_id/members/shared_state/broadcast_channels） */
  teamYaml: string;
  /** 可选：覆盖数据目录（测试用） */
  dataDir?: string;
}

/** team_create tool 结果 */
export interface TeamCreateResult {
  text: string;
  data: {
    ok: boolean;
    teamId?: string;
    teamName?: string;
    memberCount?: number;
    filePath?: string;
    error?: string;
  };
  isError?: boolean;
}

/**
 * 建队 tool——解析 team.yml 并写入 data/teams/<team-id>/team.yml。
 *
 * team.yml 格式（dev prompt L77-95）：
 *   name / team_id / members[agent_id,role,trust] / shared_state / broadcast_channels
 *
 * 写入路径：<dataDir>/teams/<team-id>/team.yml
 *
 * @param args 建队入参
 * @returns 建队结果
 */
export function teamCreate(args: TeamCreateArgs): TeamCreateResult {
  const { teamYaml, dataDir } = args;

  if (!teamYaml || teamYaml.trim() === '') {
    return {
      text: '[sofagent] 建队失败：teamYaml 为空',
      data: { ok: false, error: 'teamYaml 必填' },
      isError: true,
    };
  }

  // 解析 team.yml 校验格式（延迟导入 orchestrator 的 parseTeamYaml）
  let parseTeamYaml: (text: string) => { team_id: string; name: string; members: unknown[] };
  try {
    // 同步 require——orchestrator 是 mcp 的 dependencies（已声明）
    const mod = require('@sofagent/orchestrator') as {
      parseTeamYaml: (text: string) => { team_id: string; name: string; members: unknown[] };
    };
    parseTeamYaml = mod.parseTeamYaml;
  } catch {
    return {
      text: '[sofagent] 建队失败：@sofagent/orchestrator 不可用',
      data: { ok: false, error: 'orchestrator 不可用' },
      isError: true,
    };
  }

  let parsed: { team_id: string; name: string; members: unknown[] };
  try {
    parsed = parseTeamYaml(teamYaml);
  } catch (err) {
    return {
      text: `[sofagent] 建队失败：team.yml 格式非法：${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, error: err instanceof Error ? err.message : String(err) },
      isError: true,
    };
  }

  // 写入 team.yml
  const dir = dataDir ?? loadEnvConfig().dataDir;
  const teamDir = join(dir, 'teams', parsed.team_id);
  const filePath = join(teamDir, 'team.yml');

  try {
    if (!existsSync(teamDir)) {
      mkdirSync(teamDir, { recursive: true });
    }
    writeFileSync(filePath, teamYaml, 'utf-8');
  } catch (err) {
    return {
      text: `[sofagent] 建队失败：写入 team.yml 失败：${err instanceof Error ? err.message : String(err)}`,
      data: { ok: false, error: err instanceof Error ? err.message : String(err) },
      isError: true,
    };
  }

  // 建队决策记审计（kind=TEAM, moment=ACT）
  try {
    emitDecision({
      agentId: 'mcp-team-create',
      sessionId: `team-${parsed.team_id}`,
      kind: 'TEAM',
      moment: 'ACT',
      why: { text: `创建团队「${parsed.name}」（${parsed.members.length} 名成员）`, tags: ['team', 'create', parsed.team_id] },
    });
  } catch (err) {
    process.stderr.write(
      `[team-create] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return {
    text: `[sofagent] 团队「${parsed.name}」创建成功（${parsed.members.length} 名成员，ID: ${parsed.team_id}）`,
    data: {
      ok: true,
      teamId: parsed.team_id,
      teamName: parsed.name,
      memberCount: parsed.members.length,
      filePath,
    },
  };
}
