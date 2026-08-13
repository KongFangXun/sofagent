// ============================================================
// skill-scan.ts · SkillScan 安全门集成层（v1.3.4 交付 4）
//
// L3 组织能力市场的安全门——第三方 Skill 发布/安装前静态扫描。
// 复用 @sofagent/skillopt 的 scanSkillSafety()（核心引擎在 @sofagent/audit
// 的 skill-safety-{engine,rules,reporter}.ts），不新写扫描逻辑。
//
// 双触发（发布者侧 + 调用者侧）：
//   - 发布侧：scanForPublish() —— market_publish 时扫（发布者自己写的 Skill）
//     DANGEROUS → 拦截发布；SUSPICIOUS → 警告但不阻断（发布者自己知道风险）
//   - 安装侧：scanForInstall() —— 挂载调用前扫（调用者侧）
//     DANGEROUS → 拦截安装；SUSPICIOUS → 复用 v1.3.1 HITL 弹人工确认
//
// 关键修正（三轮）：
//   - scanSkillSafety 在文件不存在时默认返回 SUSPICIOUS（不是 SAFE）
//   - 集成层调用前先校验目标存在性：不存在 → 直接返回 DANGEROUS
//     （发布/安装一个不存在的 Skill 目录比 SUSPICIOUS 更严重）
//
// 审计：扫描报告进 decision-log（kind=MARKET）
// ============================================================

import { existsSync } from 'fs';
import { scanSkillSafety } from '@sofagent/skillopt';
import type { SafetyResult } from '@sofagent/skillopt';
import { emitDecision } from '@sofagent/audit';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 三态判定结果 */
export type ScanVerdict = 'SAFE' | 'SUSPICIOUS' | 'DANGEROUS';

/** 集成层扫描结果（对 SafetyResult 的精简映射） */
export interface ScanResult {
  /** 判定结果 */
  verdict: ScanVerdict;
  /** 拒绝/警告原因 */
  reason: string;
  /** 命中详情（规则描述列表） */
  details: string[];
  /** 原始扫描结果（可选，含文件级详情） */
  raw?: SafetyResult;
}

// ────────────────────────────────────────────────────────────
// 核心：三态映射
// ────────────────────────────────────────────────────────────

/**
 * 将 scanSkillSafety 的 SafetyResult 映射为集成层三态结果。
 *
 * 核心修正（三轮发现 2）：
 *   - scanSkillSafety 在目标不存在时返回 verdict=SUSPICIOUS
 *   - 集成层要求：目标不存在 → DANGEROUS（比 SUSPICIOUS 更严重）
 *   - 所以此函数在调用前已做存在性检查，此处 SafetyResult.verdict 已可信
 *
 * @param result scanSkillSafety 的原始结果
 * @param target 扫描目标路径
 * @returns 集成层三态结果
 */
export function mapSafetyResult(
  result: SafetyResult,
  target: string,
): ScanResult {
  const verdict: ScanVerdict = result.verdict as ScanVerdict;

  // 提取命中详情（人类可读）
  const details: string[] = [];
  for (const fileResult of result.results) {
    for (const hit of fileResult.hits) {
      details.push(
        `[${hit.severity}] ${hit.file}:${hit.line} ${hit.description} (${hit.category})`,
      );
    }
  }

  // 构建原因描述
  let reason: string;
  if (verdict === 'SAFE') {
    reason = `扫描通过——${result.filesScanned} 个文件未发现安全威胁`;
  } else if (verdict === 'DANGEROUS') {
    reason = `发现 DANGEROUS 级威胁——${details.length} 条命中`;
  } else {
    reason = `发现可疑模式——${details.length} 条命中（SUSPICIOUS）`;
  }

  return { verdict, reason, details, raw: result };
}

// ────────────────────────────────────────────────────────────
// 发布侧扫描
// ────────────────────────────────────────────────────────────

/**
 * 发布侧扫描——market_publish 时调用（发布者侧）。
 *
 * DANGEROUS → 拦截发布
 * SUSPICIOUS → 警告但不阻断（发布者自己写的 Skill，自己知道风险）
 * SAFE → 放行
 *
 * @param target 扫描目标（文件/目录路径）
 * @returns 扫描结果
 */
export function scanForPublish(target: string): ScanResult {
  // 前置存在性检查——文件不存在直接 DANGEROUS（三轮修正）
  if (!existsSync(target)) {
    return {
      verdict: 'DANGEROUS',
      reason: `目标不存在: ${target}（发布不存在的 Skill 目录 = DANGEROUS）`,
      details: [`target not found: ${target}`],
    };
  }

  // 复用 scanSkillSafety（不重写扫描逻辑）——json 模式静默，不打印终端输出
  const rawResult = scanSkillSafety(target, { mode: 'json' });
  return mapSafetyResult(rawResult, target);
}

// ────────────────────────────────────────────────────────────
// 安装侧扫描
// ────────────────────────────────────────────────────────────

/**
 * 安装侧扫描——挂载调用前调用（调用者侧）。
 *
 * DANGEROUS → 拦截安装
 * SUSPICIOUS → 复用 v1.3.1 HITL 弹人工确认（reason 含风险描述）
 * SAFE → 放行
 *
 * 注意：SUSPICIOUS 的 HITL 确认由调用方（交付 2 的 invoker.ts）处理，
 *       此函数只返回 scan 结果 + needHITL 标记。
 *
 * @param target 扫描目标（文件/目录路径）
 * @param capabilityId 能力 ID（审计用）
 * @returns 扫描结果 + needHITL 标记
 */
export function scanForInstall(
  target: string,
  capabilityId?: string,
): ScanResult & { needHITL: boolean } {
  // 前置存在性检查
  if (!existsSync(target)) {
    return {
      verdict: 'DANGEROUS',
      reason: `目标不存在: ${target}（安装不存在的 Skill = DANGEROUS）`,
      details: [`target not found: ${target}`],
      needHITL: false,
    };
  }

  const rawResult = scanSkillSafety(target, { mode: 'json' });
  const mapped = mapSafetyResult(rawResult, target);

  // SUSPICIOUS → 调用者侧需要 HITL 人工确认
  const needHITL = mapped.verdict === 'SUSPICIOUS';

  // 扫描报告进审计日志
  try {
    emitDecision({
      agentId: 'market-install-scan',
      sessionId: `market-install-${capabilityId ?? 'unknown'}`,
      kind: 'MARKET',
      moment: 'ACT',
      why: {
        text: `安装侧 SkillScan: ${target} → ${mapped.verdict}${needHITL ? '（需人工确认）' : ''}`,
        tags: ['market', 'install', 'skillscan', mapped.verdict.toLowerCase()],
        confidence: mapped.verdict === 'DANGEROUS' ? 'high' : 'med',
      },
      artifactRef: target,
      evidence: [mapped.reason, ...mapped.details.slice(0, 10)],
    });
  } catch (err) {
    process.stderr.write(
      `[skill-scan] 审计写入失败（不阻断）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  return { ...mapped, needHITL };
}
