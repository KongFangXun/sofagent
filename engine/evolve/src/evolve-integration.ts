// ============================================================
// evolve-integration.ts · Evolve 自进化能力集成
// v1.3.7 新增：通过 CLI subprocess 调用 evolve-gate（v1.4.8 自研），验证 candidate skill
// v1.4.8：迁移至 @sofagent/evolve
//
// v1.4.8 bugfix：对齐真实 evolve-gate（v1.4.8 自研） CLI 契约。
//   真实 CLI（Microsoft Evolve）是子命令式：
//     evolve-gate（v1.4.8 自研） status       -> exit 0（探活）
//     evolve-gate（v1.4.8 自研） run --target-skill-path <PATH> [--auto-adopt] [--json] ...
//   - `run` 默认只把候选写进 <project>/.evolve-gate（v1.4.8 自研）/staging/<ts>/proposed_SKILL.md，
//     不修改原始 SKILL.md（Dreams 安全契约：cycle 永不改 live 文件）。
//   - 仅当带上 --auto-adopt 且 gate 接受时，才会把 proposed_SKILL.md 复制回
//     --target-skill-path 指向的 live 文件（即"就地演化"）。
//   因此本集成统一使用 `run --auto-adopt`，让 --target-skill-path 指向的文件真正
//   就地演化；编排层（index.ts evolve-run）在 run 之前备份、run 之后对比备份
//   验证、不达标则回滚。
// ============================================================

import { execFileSync } from 'child_process';
import { dirname } from 'path';
import { existsSync, readFileSync } from 'fs';

export interface EvolveResult {
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
 * 运行 evolve-gate（v1.4.8 自研） CLI，生成优化后的 candidate skill（就地演化模型）
 *
 * 真实 CLI 契约：`evolve-gate（v1.4.8 自研） run --target-skill-path <inputPath> --auto-adopt [--json] ...`
 * - `--auto-adopt`：gate 接受后把候选就地写回 --target-skill-path 指向的文件。
 * - 因为就地演化，`result.candidatePath` 即 `inputPath`（演化后的文件即 candidate）。
 *
 * @param inputPath 输入/输出 Skill 文件路径（就地演化，既是输入也是输出）
 * @param outputPath 已废弃（早期 flat 契约 `--output` 不再存在）。保留此参数仅为兼容调用方；本实现忽略它。
 * @param scoringFilePath 可选评分文件路径，传入后通过 SKILLOPT_SCORING_FILE 环境变量传递给 evolve-gate（v1.4.8 自研）
 * @returns EvolveResult
 */
export function runEvolve(
  inputPath: string,
  outputPath?: string,
  scoringFilePath?: string,
): EvolveResult {
  if (!existsSync(inputPath)) {
    return { success: false, error: `输入文件不存在: ${inputPath}` };
  }

  // v1.4.8 ⑩：薄适配层——SOFAGENT_EVOLVE_GATE 取值 native（默认，走自研 gate）/
  // cli（回退外部 CLI 兼容层）。自研 gate 零 Python 依赖（部署确定性）。
  const gateMode = process.env.SOFAGENT_EVOLVE_GATE ?? 'native';

  if (gateMode === 'native') {
    try {
      const { runNativeGate } = require('./native-gate') as typeof import('./native-gate');
      const verdict = runNativeGate({
        workDir: dirname(inputPath),
        candidateDir: inputPath,
        targetDir: inputPath,
        // 验证命令：有评分文件走评分比对；缺省用评分文件内容数值（可注入覆盖）
        verifyCommand: scoringFilePath && existsSync(scoringFilePath)
          ? `cat ${JSON.stringify(scoringFilePath)} | tail -1`
          : 'echo "0"',
        parseScore: (stdout) => {
          const nums = stdout.match(/\d+(\.\d+)?/g);
          return nums && nums.length > 0 ? parseFloat(nums[nums.length - 1]!) : 0;
        },
      });
      if (verdict.action === 'adopt') return { success: true, candidatePath: inputPath };
      return { success: false, error: `native gate 回滚: ${verdict.basis}` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // cli 兼容层（向后保留——外部 CLI 形态）
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (scoringFilePath && existsSync(scoringFilePath)) {
    env.EVOLVE_SCORING_FILE = scoringFilePath;
  }
  const args: string[] = ['run', '--target-skill-path', inputPath, '--auto-adopt', '--json'];
  try {
    execFileSync('skillopt-sleep', args, {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    return { success: true, candidatePath: inputPath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 验证 candidate skill 是否严格优于 current skill
 * 对比行数 + 内容差异——严格提升才替换
 * @param candidatePath candidate 文件路径（就地演化模型下即演化后的 live 文件）
 * @param currentPath current 文件路径（就地演化模型下即 run 之前的备份）
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
 * 检测 evolve-gate（v1.4.8 自研） CLI 是否可用
 *
 * 真实 CLI 不接受 `--version`（exit 2），但 `status` 子命令在已安装时必然 exit 0，
 * 故用 `status` 作为探活探针。
 */
export function isEvolveAvailable(): boolean {
  try {
    execFileSync('evolve-gate（v1.4.8 自研）', ['status'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
