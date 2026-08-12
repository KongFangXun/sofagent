// ============================================================
// agent-identity.ts · MCP tool：查询 Agent 身份码（v1.3.3 交付 6）
//
// agent_identity tool：
//   - 无参数 → 查自己（当前 Agent，身份来自 SOFAGENT_AGENT_ID 环境变量
//     或 displayName 匹配；找不到时返回本机注册表第一条有效身份）
//   - 传 agentId → 查他人（按身份注册表精确查询）
//
// 返回字段脱敏：不返回 privateKey（绝不出域）。
// ============================================================

import {
  loadEnvConfig,
  getIdentity,
  listIdentities,
  verifyAgentIdentity,
} from '@sofagent/core';
import type { AgentIdentity } from '@sofagent/core';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ============================================================
// 类型定义
// ============================================================

export interface AgentIdentityToolArgs {
  /** 目标 Agent 身份码（缺省 = 查自己） */
  agentId?: string;
}

/** 对外返回的身份摘要——不含 privateKey（安全边界） */
interface IdentityView {
  agentId: string;
  displayName: string;
  principal: string;
  fingerprint: string;
  shortCode: string;
  publicKey?: string;
  signature?: string;
  constraintVersion?: number;
  responsibility?: string;
  revoked: boolean;
  signatureValid: boolean;
}

export interface AgentIdentityToolResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    identities: IdentityView[];
    count: number;
    self: boolean;
  };
}

// ============================================================
// 辅助函数
// ============================================================

/** 数据目录（与其他 MCP 工具一致：SOFAGENT_DATA 环境变量 > cwd/data） */
function getSofagentDataDir(): string {
  try {
    return loadEnvConfig().dataDir;
  } catch {
    return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
  }
}

/** 身份码 → 对外摘要（剥离 privateKey） */
function toView(identity: AgentIdentity, revoked: boolean): IdentityView {
  return {
    agentId: identity.agentId,
    displayName: identity.displayName,
    principal: identity.principal,
    fingerprint: identity.fingerprint,
    shortCode: identity.shortCode,
    ...(identity.publicKey ? { publicKey: identity.publicKey } : {}),
    ...(identity.signature ? { signature: identity.signature } : {}),
    ...(identity.constraintVersion !== undefined ? { constraintVersion: identity.constraintVersion } : {}),
    ...(identity.responsibility ? { responsibility: identity.responsibility } : {}),
    revoked,
    signatureValid: verifyAgentIdentity(identity),
  };
}

/**
 * 解析「自己」的身份：
 *   1. SOFAGENT_AGENT_ID 环境变量精确命中注册表
 *   2. SOFAGENT_AGENT_NAME 与注册表 displayName 匹配
 *   3. subagents/*.yml 中声明的 identity.agent_id（orchestrator activate 写入）
 *   4. 都找不到 → 返回 null（调用方回退到列表第一条）
 */
function resolveSelfIdentity(): AgentIdentity | null {
  const envAgentId = process.env.SOFAGENT_AGENT_ID;
  if (envAgentId) {
    const record = getIdentity(envAgentId);
    if (record) return record.identity;
  }

  const envAgentName = process.env.SOFAGENT_AGENT_NAME;
  const all = listIdentities();
  if (envAgentName) {
    const byName = all.find((r) => r.identity.displayName === envAgentName);
    if (byName) return byName.identity;
  }

  // 从 subagents/*.yml 读 identity.agent_id（yaml 行级解析，避免引入新解析器）
  const dataDir = getSofagentDataDir();
  const subagentsDir = join(dataDir, 'subagents');
  if (existsSync(subagentsDir)) {
    try {
      for (const file of readdirSync(subagentsDir)) {
        if (!file.endsWith('.yml')) continue;
        const content = readFileSync(join(subagentsDir, file), 'utf-8');
        const match = content.match(/agent_id:\s*([0-9a-fA-F-]{36})/);
        if (match && match[1]) {
          const record = getIdentity(match[1]);
          if (record) return record.identity;
        }
      }
    } catch {
      // 读取失败不致命——回退 null
    }
  }

  return null;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 查询 Agent 身份码（查自己 / 查他人）
 *
 * @param args 查询参数（agentId 缺省 = 查自己）
 * @returns 结构化结果（text + data）
 */
export function agentIdentityTool(args: AgentIdentityToolArgs = {}): AgentIdentityToolResult {
  const empty: AgentIdentityToolResult = {
    text: '[sofagent] 未找到匹配的 Agent 身份码',
    data: { identities: [], count: 0, self: !args.agentId },
  };

  try {
    if (args.agentId) {
      // 查他人：按 agentId 精确查询
      const record = getIdentity(args.agentId);
      if (!record) {
        return {
          text: `[sofagent] 身份注册表中未找到 agentId=${args.agentId}`,
          data: { identities: [], count: 0, self: false },
        };
      }
      const view = toView(record.identity, record.revoked);
      return {
        text: formatText([view], false),
        data: { identities: [view], count: 1, self: false },
      };
    }

    // 查自己：先尝试解析自身身份，失败回退注册表第一条
    const self = resolveSelfIdentity();
    if (self) {
      const record = getIdentity(self.agentId);
      const view = toView(self, record?.revoked ?? false);
      return {
        text: formatText([view], true),
        data: { identities: [view], count: 1, self: true },
      };
    }

    const all = listIdentities();
    const first = all[0];
    if (!first) return empty;
    const view = toView(first.identity, first.revoked);
    return {
      text: formatText([view], true),
      data: { identities: [view], count: 1, self: true },
    };
  } catch (err) {
    return {
      text: `[sofagent] 查询 Agent 身份码异常: ${err instanceof Error ? err.message : String(err)}`,
      data: { identities: [], count: 0, self: !args.agentId },
    };
  }
}

/** 格式化输出文本 */
function formatText(views: IdentityView[], self: boolean): string {
  const lines: string[] = [];
  lines.push(`[sofagent] Agent 身份码查询结果（${self ? '自己' : '他人'}，共 ${views.length} 条）`);
  for (const v of views) {
    lines.push(`  - ${v.displayName} (${v.agentId})`);
    lines.push(`    委托人: ${v.principal} · 短码: ${v.shortCode} · 指纹: ${v.fingerprint}`);
    if (v.constraintVersion !== undefined) {
      lines.push(`    约束版本: v${v.constraintVersion}`);
    }
    if (v.responsibility) {
      lines.push(`    责任声明: ${v.responsibility}`);
    }
    lines.push(`    Ed25519 签名${v.publicKey ? '验证' : ''}: ${v.publicKey ? (v.signatureValid ? '有效 ✅' : '无效 ❌') : '无公钥'}`);
    if (v.revoked) {
      lines.push('    ⚠️ 该身份已被撤销');
    }
  }
  return lines.join('\n');
}
