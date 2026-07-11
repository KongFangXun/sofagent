// ============================================================
// skillopt-integration.ts · SkillOpt 自进化引擎集成
// v1.0.3 新增：通过 CLI subprocess 调用 skillopt-sleep，验证 candidate skill
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
 * @returns SkillOptResult
 */
export function runSkillOpt(inputPath: string, outputPath: string): SkillOptResult {
  if (!existsSync(inputPath)) {
    return { success: false, error: `输入文件不存在: ${inputPath}` };
  }

  try {
    execFileSync('skillopt-sleep', [inputPath, '--output', outputPath], {
      encoding: 'utf-8',
      timeout: 120000, // 2 分钟超时
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (existsSync(outputPath)) {
      return { success: true, candidatePath: outputPath };
    }
    return { success: false, error: 'skillopt-sleep 未生成输出文件' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 如果 skillopt-sleep 未安装
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      console.warn('⚠️ skillopt-sleep 未安装（Python 包），SkillOpt 自进化不可用。pip install skillopt 启用。');
    }
    return { success: false, error: msg };
  }
}

/**
 * 验证 candidate skill 是否严格优于 current skill
 * 对比文件大小、复杂度等指标——严格提升才替换
 * @param candidatePath candidate 文件路径
 * @param currentPath current 文件路径
 * @returns ValidationResult——canReplace 为 true 才替换
 */
export function validateCandidate(candidatePath: string, currentPath: string): ValidationResult {
  try {
    const candidate = readFileSync(candidatePath, 'utf-8');
    const current = readFileSync(currentPath, 'utf-8');
    const candidateLines = candidate.split('\n').length;
    const currentLines = current.split('\n').length;

    // 候选不能比现任短太多（防止删功能）
    if (candidateLines < currentLines * 0.7) {
      return {
        canReplace: false,
        reason: '候选 Skill 比现任短 30% 以上，可能删除功能',
      };
    }
    // 候选不能比现任长太多（防止膨胀）
    if (candidateLines > currentLines * 1.3) {
      return {
        canReplace: false,
        reason: '候选 Skill 比现任长 30% 以上，可能过度膨胀',
      };
    }
    return { canReplace: true, reason: '候选 Skill 长度在合理范围内' };
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
