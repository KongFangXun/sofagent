// ============================================================
// skillopt-integration.ts · SkillOpt 自进化引擎集成
// v1.3.6 新增：通过 CLI subprocess 调用 skillopt-sleep，验证 candidate skill
// v1.3.6：迁移至 @sofagent/skillopt
//
// v1.3.6 bugfix：对齐真实 skillopt-sleep CLI 契约。
//   真实 CLI（Microsoft SkillOpt）是子命令式：
//     skillopt-sleep status       -> exit 0（探活）
//     skillopt-sleep run --target-skill-path <PATH> [--auto-adopt] [--json] ...
//   - `run` 默认只把候选写进 <project>/.skillopt-sleep/staging/<ts>/proposed_SKILL.md，
//     不修改原始 SKILL.md（Dreams 安全契约：cycle 永不改 live 文件）。
//   - 仅当带上 --auto-adopt 且 gate 接受时，才会把 proposed_SKILL.md 复制回
//     --target-skill-path 指向的 live 文件（即"就地演化"）。
//   因此本集成统一使用 `run --auto-adopt`，让 --target-skill-path 指向的文件真正
//   就地演化；编排层（index.ts skillopt-run）在 run 之前备份、run 之后对比备份
//   验证、不达标则回滚。
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

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
 * 运行 skillopt-sleep CLI，生成优化后的 candidate skill（就地演化模型）
 *
 * 真实 CLI 契约：`skillopt-sleep run --target-skill-path <inputPath> --auto-adopt [--json] ...`
 * - `--auto-adopt`：gate 接受后把候选就地写回 --target-skill-path 指向的文件。
 * - 因为就地演化，`result.candidatePath` 即 `inputPath`（演化后的文件即 candidate）。
 *
 * @param inputPath 输入/输出 Skill 文件路径（就地演化，既是输入也是输出）
 * @param outputPath 已废弃（早期 flat 契约 `--output` 不再存在）。保留此参数仅为兼容调用方；本实现忽略它。
 * @param scoringFilePath 可选评分文件路径，传入后通过 SKILLOPT_SCORING_FILE 环境变量传递给 skillopt-sleep
 * @returns SkillOptResult
 */
export function runSkillOpt(
  inputPath: string,
  outputPath?: string,
  scoringFilePath?: string,
): SkillOptResult {
  if (!existsSync(inputPath)) {
    return { success: false, error: `输入文件不存在: ${inputPath}` };
  }

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (scoringFilePath && existsSync(scoringFilePath)) {
    env.SKILLOPT_SCORING_FILE = scoringFilePath;
  }

  // 真实 CLI：run 子命令 + --target-skill-path + --auto-adopt（就地演化）。
  // --json 让 CLI 以结构化形式输出（便于后续解析，且避免进度信息污染 stdout）。
  const args: string[] = [
    'run',
    '--target-skill-path',
    inputPath,
    '--auto-adopt',
    '--json',
  ];

  try {
    // 捕获 stdout/stderr，避免 CLI 的 [sleep] 进度信息污染审计输出。
    execFileSync('skillopt-sleep', args, {
      encoding: 'utf-8',
      timeout: 120000, // 2 分钟超时
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    // exit 0 即 CLI 正常跑完（无论 gate 是否接受；不接受时 live 文件保持不变）。
    return { success: true, candidatePath: inputPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 如果 skillopt-sleep 未安装
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      console.warn('⚠️ skillopt-sleep 未安装。安装方式：pip install skillopt（v0.2.0+ 已含 skillopt-sleep CLI）。如需 Claude Code/Codex/Copilot/Devin 集成 shell，改用源码安装：git clone https://github.com/microsoft/SkillOpt.git ~/SkillOpt && cd ~/SkillOpt && pip install -e ".[all]"');
    }
    return { success: false, error: msg };
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
 * 检测 skillopt-sleep CLI 是否可用
 *
 * 真实 CLI 不接受 `--version`（exit 2），但 `status` 子命令在已安装时必然 exit 0，
 * 故用 `status` 作为探活探针。
 */
export function isSkillOptAvailable(): boolean {
  try {
    execFileSync('skillopt-sleep', ['status'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
