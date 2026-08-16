// ============================================================
// commons-publish.ts · MCP tool: commons_publish（v1.3.6 交付 1）
//
// 能力发布 tool——校验元数据完整性 + SkillScan 安全门 + 写入公地清单 + 审计。
// 延迟导入 @sofagent/orchestrator 的 publishCapability（与 team-create 同模式）。
// ============================================================

import { loadEnvConfig } from '@sofagent/core';

/** commons_publish tool 入参 */
export interface CommonsPublishArgs {
  /** 能力元数据（JSON 对象） */
  metadata: {
    id: string;
    kind: 'skill' | 'agent' | 'flow';
    name: string;
    description: string;
    version: string;
    owner: string;
    tags: string[];
    sourcePath: string;
  };
  /** 可选：覆盖数据目录（测试用） */
  dataDir?: string;
}

/** commons_publish tool 结果 */
export interface CommonsPublishResult {
  text: string;
  data: {
    ok: boolean;
    capabilityId?: string;
    scanVerdict?: string;
    reason?: string;
    manifestPath?: string;
  };
  isError?: boolean;
}

/**
 * 发布能力到公地——延迟导入 orchestrator 的 publishCapability。
 *
 * @param args 发布入参
 * @returns 发布结果
 */
export function commonsPublish(args: CommonsPublishArgs): CommonsPublishResult {
  const { metadata, dataDir } = args;

  if (!metadata || typeof metadata !== 'object') {
    return {
      text: '[sofagent] 发布失败：metadata 必填',
      data: { ok: false, reason: 'metadata 必填' },
      isError: true,
    };
  }

  // 延迟导入 orchestrator（与 team-create 同模式）
  let publishCapability: (
    meta: CommonsPublishArgs['metadata'],
    dataDir?: string,
  ) => {
    ok: boolean;
    capabilityId?: string;
    scan?: { verdict: string; reason: string };
    reason?: string;
    manifestPath?: string;
    publishedAt: string;
  };
  try {
    const mod = require('@sofagent/orchestrator') as {
      publishCapability: typeof publishCapability;
    };
    publishCapability = mod.publishCapability;
  } catch {
    return {
      text: '[sofagent] 发布失败：@sofagent/orchestrator 不可用',
      data: { ok: false, reason: 'orchestrator 不可用' },
      isError: true,
    };
  }

  const dir = dataDir ?? loadEnvConfig().dataDir;
  const result = publishCapability(metadata, dir);

  if (!result.ok) {
    return {
      text: `[sofagent] 发布失败：${result.reason ?? '未知原因'}`,
      data: {
        ok: false,
        reason: result.reason,
        ...(result.scan ? { scanVerdict: result.scan.verdict } : {}),
      },
      isError: true,
    };
  }

  return {
    text: `[sofagent] 能力「${metadata.name}」发布成功（${metadata.kind}/${metadata.id}@${metadata.version}，扫描判定: ${result.scan?.verdict ?? 'N/A'}）`,
    data: {
      ok: true,
      capabilityId: result.capabilityId,
      scanVerdict: result.scan?.verdict,
      manifestPath: result.manifestPath,
    },
  };
}
