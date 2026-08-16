// ============================================================
// publisher.ts · 能力发布（v1.3.6 交付 1）
//
// L3 组织能力公地的「发布」环节——Skill / Agent / 流程打包为可发布单元，
// 发布前校验元数据完整性 + SkillScan 安全门（交付 4 接入）。
//
// 复用机制（不重写）：
//   - SkillScan：交付 4 的 skill-scan.ts → scanForPublish()（发布者侧扫描）
//   - 目录生成：catalog.ts（发布成功后写入 commons/manifest.jsonl）
//   - 审计：emitDecision（kind=COMMONS, moment=DEPLOY）
// ============================================================

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import { emitDecision } from '@sofagent/audit';
import { scanForPublish, type ScanResult } from './skill-scan';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 能力类型 */
export type CapabilityKind = 'skill' | 'agent' | 'flow';

/** 能力元数据（frontmatter 形式打包） */
export interface CapabilityMetadata {
  /** 能力唯一标识（slug，如 `finance-report-skill`） */
  id: string;
  /** 能力类型 */
  kind: CapabilityKind;
  /** 人类可读名称 */
  name: string;
  /** 简短描述 */
  description: string;
  /** 版本号（semver，如 `1.0.0`） */
  version: string;
  /** 维护人 agentId（对接 v1.3.1 身份码，强制声明——无 owner 不可发布） */
  owner: string;
  /** 标签（用于检索发现，复用 searchKnowledge 链路） */
  tags: string[];
  /** 源文件/目录路径（Skill 的实际内容位置） */
  sourcePath: string;
}

/** 发布结果 */
export interface PublishResult {
  /** 是否发布成功 */
  ok: boolean;
  /** 能力 ID */
  capabilityId?: string;
  /** SkillScan 扫描结果 */
  scan?: ScanResult;
  /** 拒绝原因（ok=false 时） */
  reason?: string;
  /** 写入的清单路径 */
  manifestPath?: string;
  /** 发布时间 ISO */
  publishedAt: string;
}

// ────────────────────────────────────────────────────────────
// 校验
// ────────────────────────────────────────────────────────────

/** 必填元数据字段 */
const REQUIRED_FIELDS: (keyof CapabilityMetadata)[] = [
  'id', 'kind', 'name', 'description', 'version', 'owner', 'sourcePath',
];

/** 合法能力类型 */
const VALID_KINDS: CapabilityKind[] = ['skill', 'agent', 'flow'];

/**
 * 校验元数据完整性——缺字段 / owner 空 / 非法 kind → 拒绝发布。
 *
 * @param meta 能力元数据
 * @returns 校验通过返回 null，失败返回拒绝原因
 */
export function validateMetadata(meta: CapabilityMetadata): string | null {
  for (const field of REQUIRED_FIELDS) {
    const value = meta[field];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      return `元数据缺字段: ${String(field)}`;
    }
  }
  // owner 强制声明（铁律：无 owner 不可发布）
  if (typeof meta.owner !== 'string' || meta.owner.trim() === '') {
    return 'owner 必填——无 owner 的能力不可发布（防止孤儿能力）';
  }
  // kind 合法性
  if (!VALID_KINDS.includes(meta.kind)) {
    return `非法 kind "${meta.kind}"——必须是 skill / agent / flow`;
  }
  // tags 至少一个（用于检索）
  if (!Array.isArray(meta.tags) || meta.tags.length === 0) {
    return 'tags 必填——至少一个标签（用于检索发现）';
  }
  // sourcePath 安全（禁止路径穿越）
  if (meta.sourcePath.includes('..')) {
    return 'sourcePath 不允许路径穿越（..）';
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// SkillScan 钩子（交付 4 接入）
// ────────────────────────────────────────────────────────────

/**
 * SkillScan 桩（交付 1 占位）。
 *
 * 交付 1 先返回 SAFE 占位，交付 4 完成后替换为真实 scanForPublish()。
 * 保留这个函数是为了让交付 1 的单测能在没有 scanSkillSafety 真实扫描的情况下跑通。
 */
export function scanSkillSafetyStub(): ScanResult {
  // TODO: 交付 4 接 scanSkillSafety
  return {
    verdict: 'SAFE',
    reason: 'stub——交付 4 接入真实扫描',
    details: [],
  };
}

// ────────────────────────────────────────────────────────────
// 发布
// ────────────────────────────────────────────────────────────

/**
 * 发布一个能力到公地。
 *
 * 流程：
 *   1. 校验元数据完整性（必填字段 + owner + kind + tags）
 *   2. SkillScan 安全扫描（DANGEROUS → 拒绝发布）
 *   3. 写入 commons/manifest.jsonl（能力清单——catalog.ts 读取此文件生成目录）
 *   4. 审计（kind=COMMONS, moment=DEPLOY）
 *
 * @param meta 能力元数据
 * @param dataDir 可选的数据目录覆盖（测试用）
 * @returns 发布结果
 */
export function publishCapability(
  meta: CapabilityMetadata,
  dataDir?: string,
): PublishResult {
  const publishedAt = new Date().toISOString();

  // 1. 校验元数据
  const validationError = validateMetadata(meta);
  if (validationError) {
    return { ok: false, reason: validationError, publishedAt };
  }

  // 2. SkillScan 安全扫描——交付 4 已完成，使用真实 scanForPublish()
  //    （交付 1 阶段曾用 scanSkillSafetyStub() 占位，交付 4 完成后替换为真实扫描）
  const scan = scanForPublish(meta.sourcePath);
  if (scan.verdict === 'DANGEROUS') {
    // DANGEROUS → 拦截发布
    try {
      emitDecision({
        agentId: meta.owner,
        sessionId: `commons-publish-${meta.id}`,
        kind: 'COMMONS',
        moment: 'DEPLOY',
        why: {
          text: `能力「${meta.name}」发布被 SkillScan 拦截（DANGEROUS）`,
          tags: ['commons', 'publish', 'blocked', meta.id],
          confidence: 'high',
        },
        artifactRef: meta.sourcePath,
        evidence: [scan.reason, ...(scan.details ?? [])],
      });
    } catch (err) {
      process.stderr.write(
        `[publisher] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return {
      ok: false,
      reason: `SkillScan 拦截: ${scan.reason}`,
      scan,
      publishedAt,
    };
  }

  // 3. 写入公地清单（commons/manifest.jsonl）
  const dir = dataDir ?? loadEnvConfig().dataDir;
  const commonsDir = join(dir, 'commons');
  const manifestPath = join(commonsDir, 'manifest.jsonl');
  const entry = {
    ...meta,
    scanVerdict: scan.verdict,
    scanReason: scan.reason,
    publishedAt,
    status: 'active' as const,
  };

  try {
    if (!existsSync(commonsDir)) {
      mkdirSync(commonsDir, { recursive: true });
    }
    writeFileSync(manifestPath, JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch (err) {
    return {
      ok: false,
      reason: `写入公地清单失败: ${err instanceof Error ? err.message : String(err)}`,
      scan,
      publishedAt,
    };
  }

  // 4. 审计（kind=COMMONS, moment=DEPLOY）
  try {
    emitDecision({
      agentId: meta.owner,
      sessionId: `commons-publish-${meta.id}`,
      kind: 'COMMONS',
      moment: 'DEPLOY',
      why: {
        text: `发布能力「${meta.name}」(${meta.kind}/${meta.id}@${meta.version})`,
        tags: ['commons', 'publish', meta.kind, meta.id],
        confidence: 'high',
      },
      artifactRef: manifestPath,
      evidence: [
        `scan-verdict: ${scan.verdict}`,
        `tags: ${meta.tags.join(', ')}`,
        `owner: ${meta.owner}`,
      ],
    });
  } catch (err) {
    process.stderr.write(
      `[publisher] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return {
    ok: true,
    capabilityId: meta.id,
    scan,
    manifestPath,
    publishedAt,
  };
}
