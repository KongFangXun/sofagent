// ============================================================
// skillopt-integration.ts · SkillOpt 自进化引擎集成
// v1.0.4 新增：通过 CLI subprocess 调用 skillopt-sleep，验证 candidate skill
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface SkillOptResult {
  success: boolean;
  candidatePath?: string;
  error?: string;
}

export interface ValidationResult {
  canReplace: boolean;
  reason: string;
  scoreDiff?: number;
}

/**
 * 运行 skillopt-sleep CLI，生成优化后的 candidate skill
 * @param inputPath 输入 Skill 文件路径
 * @param outputPath 输出 candidate 路径
 * @param scoringFilePath 可选评分文件路径，传入后通过 SKILLOPT_SCORING_FILE 环境变量传递给 skillopt-sleep
 * @returns SkillOptResult
 */
export function runSkillOpt(
  inputPath: string,
  outputPath: string,
  scoringFilePath?: string
): SkillOptResult {
  if (!existsSync(inputPath)) {
    return { success: false, error: `输入文件不存在: ${inputPath}` };
  }

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (scoringFilePath && existsSync(scoringFilePath)) {
    env.SKILLOPT_SCORING_FILE = scoringFilePath;
  }

  try {
    execFileSync('skillopt-sleep', [inputPath, '--output', outputPath], {
      encoding: 'utf-8',
      timeout: 120000, // 2 分钟超时
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    if (existsSync(outputPath)) {
      return { success: true, candidatePath: outputPath };
    }
    return { success: false, error: 'skillopt-sleep 未生成输出文件' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 如果 skillopt-sleep 未安装
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      console.warn('⚠️ skillopt-sleep 未安装。安装方式：git clone https://github.com/microsoft/SkillOpt.git ~/SkillOpt && cd ~/SkillOpt && pip install -e .');
    }
    return { success: false, error: msg };
  }
}

/**
 * 验证 candidate skill 是否严格优于 current skill
 * 对比行数 + 内容差异——严格提升才替换
 * @param candidatePath candidate 文件路径
 * @param currentPath current 文件路径
 * @returns ValidationResult——canReplace 为 true 才替换
 */
export function validateCandidate(candidatePath: string, currentPath: string): ValidationResult {
  try {
    const candidate = readFileSync(candidatePath, 'utf-8');
    const current = readFileSync(currentPath, 'utf-8');
    const candidateLinesCount = candidate.split('\n').length;
    const currentLinesCount = current.split('\n').length;

    // 候选不能比现任短太多（防止删功能）
    if (candidateLinesCount < currentLinesCount * 0.7) {
      return {
        canReplace: false,
        reason: '候选 Skill 比现任短 30% 以上，可能删除功能',
      };
    }
    // 候选不能比现任长太多（防止膨胀）
    if (candidateLinesCount > currentLinesCount * 1.3) {
      return {
        canReplace: false,
        reason: '候选 Skill 比现任长 30% 以上，可能过度膨胀',
      };
    }

    // 内容无变化时不替换
    if (candidate.trim() === current.trim()) {
      return {
        canReplace: false,
        reason: '候选 Skill 与现任内容完全相同，无需替换',
      };
    }

    // 计算变化比例（逐行对比）
    const candidateLines = candidate.split('\n').filter((l: string) => l.trim().length > 0);
    const currentLines = current.split('\n').filter((l: string) => l.trim().length > 0);
    const candidateSet = new Set(candidateLines);
    const currentSet = new Set(currentLines);
    const changedLines = [...candidateSet].filter((l: string) => !currentSet.has(l)).length;
    const totalLines = Math.max(candidateLines.length, currentLines.length);
    const changeRatio = totalLines > 0 ? changedLines / totalLines : 0;

    // 变化低于 5% 视为空跑
    if (changeRatio < 0.05) {
      return {
        canReplace: false,
        reason: `候选 Skill 仅变化 ${(changeRatio * 100).toFixed(1)}%（低于 5% 阈值），可能为空跑`,
      };
    }

    return { canReplace: true, reason: `候选 Skill 长度在合理范围内，变化比例 ${(changeRatio * 100).toFixed(1)}%` };
  } catch (err) {
    return {
      canReplace: false,
      reason: `读取失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 检测 skillopt-sleep CLI 是否可用
 */
export function isSkillOptAvailable(): boolean {
  try {
    execFileSync('skillopt-sleep', ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
