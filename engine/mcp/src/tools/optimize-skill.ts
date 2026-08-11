// ============================================================
// tools/optimize-skill.ts · optimize_skill MCP tool（v1.3.2 · P3 S2）
// ============================================================

import { scanSkillSafety, runSkillOpt, validateCandidate, isSkillOptAvailable } from '@sofagent/skillopt';
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
  if (!isSkillOptAvailable()) {
    // CLI 不可用时降级为安全扫描
    const result = scanSkillSafety(args.skill_path, { mode: 'quiet' });
    return {
      text: `[sofagent] skillopt-sleep CLI 不可用，仅执行安全扫描 · 判定: ${result.verdict}`,
      data: {
        available: false,
        verdict: result.verdict,
        filesScanned: result.filesScanned,
        optimized: false,
      },
    };
  }

  const skillOptResult = runSkillOpt(args.skill_path);
  if (!skillOptResult.success) {
    return {
      text: `[sofagent] SkillOpt 运行失败: ${skillOptResult.error ?? '未知错误'}`,
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
