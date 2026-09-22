// ============================================================
// tools/optimize-skill.ts · optimize_skill MCP tool（v1.5.1 · P3 S2）
// ============================================================

import { scanSkillSafety, runEvolve, validateCandidate, isEvolveAvailable } from '@sofagent/evolve';
import { existsSync } from 'fs';

export interface OptimizeSkillArgs {
  skill_path: string;
  check_only?: boolean;
}

export function optimizeSkill(args: OptimizeSkillArgs): { text: string; data: unknown } {
  if (!args.skill_path || !existsSync(args.skill_path)) {
    return {
      text: `[sofagent] Skill 文件不存在: ${args.skill_path}`,
      data: { error: true, verdict: 'SUSPICIOUS' },
    };
  }

  // check_only 模式：仅安全扫描
  if (args.check_only) {
    const result = scanSkillSafety(args.skill_path, { mode: 'quiet' });
    return {
      text: `[sofagent] 安全扫描完成 · 判定: ${result.verdict}`,
      data: {
        verdict: result.verdict,
        filesScanned: result.filesScanned,
        optimized: false,
      },
    };
  }

  // 完整优化模式
  if (!isEvolveAvailable()) {
    // evolve 能力不可用（仅 SOFAGENT_EVOLVE_GATE=cli 且外部 CLI 不在场时才可能）→ 降级为安全扫描
    // v1.4.9 G-11 文案收口：不再向用户报一个不存在的工具名（旧文案「evolve-gate CLI 不可用」
    //   既名实不符、又让人去找一个从未发布的二进制）。
    const result = scanSkillSafety(args.skill_path, { mode: 'quiet' });
    return {
      text: `[sofagent] evolve 不可用（外部 CLI 兼容层缺位）；已降级为安全扫描 · 判定: ${result.verdict}`,
      data: {
        available: false,
        verdict: result.verdict,
        filesScanned: result.filesScanned,
        optimized: false,
      },
    };
  }

  const skillOptResult = runEvolve(args.skill_path);
  if (!skillOptResult.success) {
    return {
      text: `[sofagent] Evolve 运行失败: ${skillOptResult.error ?? '未知错误'}`,
      data: {
        verdict: 'SUSPICIOUS',
        optimized: false,
        error: skillOptResult.error,
      },
    };
  }

  let scoreDiff: number | undefined;
  if (skillOptResult.candidatePath) {
    const validation = validateCandidate(args.skill_path, skillOptResult.candidatePath);
    scoreDiff = validation.scoreDiff;
  }

  return {
    text: `[sofagent] Skill 优化完成${skillOptResult.candidatePath ? ` · 候选: ${skillOptResult.candidatePath}` : ''}`,
    data: {
      verdict: 'SAFE',
      optimized: true,
      candidatePath: skillOptResult.candidatePath,
      scoreDiff,
    },
  };
}
