// ============================================================
// agent-identity.ts · Agent 身份码轻量版（v1.2.5 §3.1）
//
// 企业 SubAgent 注册后（activate 写入 subagents/*.yml）即带独立身份码。
// 轻量版方案（完整 Ed25519 签发在 v1.3.2）：
//   - agentId = UUID v4
//   - shortCode = 6 位 Base36（hash 前 6 位）
//   - fingerprint = SHA-256(hostname + agentName + sofagent-key) 前 16 位
//
// 确定性：相同 systemPrompt + tools + constraints → 相同 fingerprint（幂等性）
// ============================================================

import { createHash, randomUUID } from 'crypto';
import { hostname } from 'os';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Agent 身份码 */
export interface AgentIdentity {
  /** 唯一标识（UUID v4） */
  agentId: string;
  /** 显示名（如 customer-intake） */
  displayName: string;
  /** 委托人（企业标识） */
  principal: string;
  /** 约束摘要（从 SubAgentDefinition.systemPrompt 提取关键约束） */
  constraints: string[];
  /** 签发时间（ISO 8601） */
  createdAt: string;
  /** SHA-256(systemPrompt + tools + constraints) 前 16 位 */
  fingerprint: string;
  /** 6 位短码（Base36，hash 前 6 位，便于人类识别） */
  shortCode: string;
}

/**
 * 读取 sofagent-key（HMAC 密钥文件）。
 *
 * 密钥文件位置：~/.sofagent-key（由 init.ts P1-24 生成）。
 * 如果文件不存在，使用 hostname 作为 fallback（不强制依赖密钥文件存在）。
 *
 * @returns 密钥字符串
 */
function readSofagentKey(): string {
  const keyPath = join(process.env.HOME || process.env.USERPROFILE || '~', '.sofagent-key');
  try {
    if (existsSync(keyPath)) {
      return readFileSync(keyPath, 'utf-8').trim();
    }
  } catch {
    // 读取失败——使用 fallback
  }
  // fallback：hostname 作为弱标识（没有密钥文件时）
  return hostname();
}

/**
 * 生成确定性指纹。
 *
 * SHA-256(agentName + systemPrompt + tools + constraints + hostname + sofagent-key) 前 16 位。
 * 相同输入 → 相同指纹（幂等性验证）。
 *
 * @param agentName Agent 名称
 * @param systemPrompt 系统提示
 * @param tools 工具列表
 * @param constraints 约束列表
 * @returns 16 位十六进制指纹
 */
export function computeFingerprint(
  agentName: string,
  systemPrompt: string,
  tools: string[],
  constraints: string[],
): string {
  const host = hostname();
  const key = readSofagentKey();
  const raw = [agentName, systemPrompt, tools.join(','), constraints.join(','), host, key].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * 生成 6 位短码（Base36）。
 *
 * 从 agentName + fingerprint 的 hash 取前 6 位 Base36 编码。
 * 用于人类识别（如 `a3f2k9`），非安全用途。
 *
 * @param agentName Agent 名称
 * @param fingerprint 16 位指纹
 * @returns 6 位 Base36 短码
 */
export function computeShortCode(agentName: string, fingerprint: string): string {
  const hash = createHash('sha256').update(`${agentName}:${fingerprint}`).digest('hex');
  // 取前 8 位 hex → 转 BigInt → 转 Base36 → 取前 6 位
  const num = BigInt('0x' + hash.slice(0, 8));
  const base36 = num.toString(36);
  return base36.padStart(6, '0').slice(0, 6);
}

/**
 * 生成 Agent 身份码。
 *
 * @param agentName Agent 名称（如 customer-intake）
 * @param opts 可选参数
 * @param opts.systemPrompt 系统提示（影响 fingerprint）
 * @param opts.tools 工具列表（影响 fingerprint）
 * @param opts.constraints 约束列表（影响 fingerprint）
 * @param opts.principal 委托人/企业标识（默认 'enterprise'）
 * @returns AgentIdentity 身份码对象
 */
export function generateAgentIdentity(
  agentName: string,
  opts: {
    systemPrompt?: string;
    tools?: string[];
    constraints?: string[];
    principal?: string;
  } = {},
): AgentIdentity {
  const systemPrompt = opts.systemPrompt ?? '';
  const tools = opts.tools ?? [];
  const constraints = opts.constraints ?? [];

  const fingerprint = computeFingerprint(agentName, systemPrompt, tools, constraints);
  const shortCode = computeShortCode(agentName, fingerprint);

  return {
    agentId: randomUUID(),
    displayName: agentName,
    principal: opts.principal ?? 'enterprise',
    constraints,
    createdAt: new Date().toISOString(),
    fingerprint,
    shortCode,
  };
}

/**
 * 从 systemPrompt 中提取关键约束摘要。
 *
 * 提取 ## 知识域约束 段落中的关键条目，
 * 截取前 5 条作为 constraints 摘要。
 *
 * @param systemPrompt 系统提示
 * @param maxLength 最大提取条数（默认 5）
 * @returns 约束摘要列表
 */
export function extractConstraintsFromPrompt(
  systemPrompt: string,
  maxLength: number = 5,
): string[] {
  const constraints: string[] = [];

  // 提取 "## 知识域约束" 段落
  const kdMatch = systemPrompt.match(/##\s*知识域约束\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (kdMatch && kdMatch[1]) {
    const lines = kdMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && (trimmed.includes('允许') || trimmed.includes('禁止'))) {
        constraints.push(trimmed);
        if (constraints.length >= maxLength) break;
      }
    }
  }

  return constraints;
}
