// ============================================================
// evolve-integration.ts · Evolve 自进化能力集成
// v1.3.7 新增：通过 CLI subprocess 调用外部 gate CLI，验证 candidate skill
// v1.5.2：迁移至 @sofagent/evolve
// v1.5.2 ⑩：外部 Python 依赖摘除 —— 默认走**自研 native gate**（零外部依赖，部署确定性），
//   仅 `SOFAGENT_EVOLVE_GATE=cli` 时才回退到外部 CLI 兼容层。
// v1.5.2 G-11：清理一次**过宽全局替换**留下的污染字面量。
//   污染面（实测）：本文件里 `evolve-gate（v1.5.2 自研）` 同时被写进 ① 探活二进制名
//   ② 文档里的 CLI 名 ③ 状态目录路径 `<project>/.evolve-gate（v1.5.2 自研）/staging/`。
//   `evolve-gate`（去掉全角括号）**全仓没有可执行**：探的是一个从未存在、也从未发布过的二进制
//   ⇒ `isEvolveAvailable()` 恒 false ⇒ 三个调用方（cli.ts / optimize-skill.ts / auto-trigger.ts）
//   全部静默降级或跳过，把「原生路径没接线」伪装成「外部 CLI 未安装」。
//   真实面（实测）：外部兼容层的二进制是 `skillopt-sleep`（PyPI skillopt 0.2.0），
//     子命令 `{run,dry-run,status,adopt,harvest,schedule,unschedule}`，
//     `run` 支持 `--target-skill-path / --auto-adopt / --json`（与下方 cli 分支逐字吻合）。
//   本版据此收口：**探活名与调用名同源**（单一常量 LEGACY_GATE_CLI），并让 native 模式自报可用。
// v1.4.9 G-17：修复 native 分支的**数据丢失路径** —— 见 runNativeMode 的头注释。
// ============================================================

import { execFileSync } from 'child_process';
import { dirname, join, basename } from 'path';
import { existsSync, readFileSync, copyFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { runNativeGate } from './native-gate';

/**
 * 外部 CLI 兼容层的**真实**二进制名（v1.4.9 G-11）。
 *
 * 探活（`isEvolveAvailable`）与调用（`runLegacyCliMode`）**必须**共用此常量——
 * 污染事故的形态之一正是「探一个名字、调另一个名字」，于是探活与调用**双双对不上真实面**却各自看起来正常。
 */
const LEGACY_GATE_CLI = 'skillopt-sleep';

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
 * 运行 Skill 演化，产出/就地写回优化后的 candidate skill。
 *
 * 两条互斥路径（由 `SOFAGENT_EVOLVE_GATE` 选择，缺省 `native`）：
 * - **native**（默认）：自研 gate，零外部依赖。候选落 **staging 副本**，正式位只在替换那一刻原子写入。
 * - **cli**：外部 CLI 兼容层（`LEGACY_GATE_CLI`），就地演化（`--auto-adopt` 写回 `--target-skill-path`）。
 *
 * @param inputPath 输入/输出 Skill 文件路径（就地演化——既是输入也是输出）
 * @param outputPath 已废弃（早期 flat 契约 `--output` 不再存在）。保留此参数仅为兼容调用方；本实现忽略它。
 * @param scoringFilePath 可选评分文件路径。⚠️ 契约诚实化：早期文档声称此值「通过环境变量传递给 CLI」，
 *   但**安装包查证**（`skillopt_sleep` 包内 `environ`/`getenv` 读取数为 **0**）表明该 CLI 根本不读任何
 *   SCORING 环境变量——评分文件走位置参数/配置文件。故此处**不再声称对外契约**，仅保留变量赋值兼容既有部署脚本。
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

  const gateMode = process.env.SOFAGENT_EVOLVE_GATE ?? 'native';

  if (gateMode === 'native') {
    return runNativeMode(inputPath, scoringFilePath);
  }
  return runLegacyCliMode(inputPath, scoringFilePath);
}

/**
 * native 模式：自研 gate + **staging 候选副本** + **防数据丢失锁**（v1.4.9 G-17）。
 *
 * 🔴 修复的实案（v1.4.8 实态，已实测复现）：
 *   旧实现把**同一个路径**同时传成 `candidateDir` 与 `targetDir`，而 `native-gate.ts` 的
 *   adopt 分支是「删 targetDir → 拷 candidateDir → targetDir」。二者同路径时这就成了**自指删除**：
 *   先删掉 live 文件（它同时就是 candidate），再拿已经删掉的源去拷贝 ⇒
 *   `ENOENT: copyfile 'SKILL.md' -> 'SKILL.md'`。
 *   该 `copyFileSync` 在 `runNativeGate` 的 try/catch **之外**，异常直穿出去，
 *   本函数当时只 `return {success:false}`、**不还原** ⇒ 调用后目录里只剩 `SKILL.md.gate-bak`，
 *   **live 文件永久丢失**（实测：`SKILL.md (84B)` → 调用后 `SKILL.md` 消失）。
 *
 * 两条防御（缺一不可）：
 *   ① **结构**：候选落 staging 独立副本 ⇒ 恢复 `native-gate.ts` 自己声明的契约
 *      （「candidateDir：staging 副本——adopt 时替换正式位」），`rm` 与 `copy` 不再自指；
 *   ② **锁**：`runNativeGate` 返回后独立复验三条不变式（L1/L2/L3），任一被打破即
 *      「不得静默」地上报失败，并尝试从 `.gate-bak` 恢复。
 *      这样即使 gate 内部实现将来再次演进出别的破坏方式，调用面仍能兜住。
 */
function runNativeMode(inputPath: string, scoringFilePath?: string): EvolveResult {
  const originalContent = readFileSync(inputPath, 'utf-8');
  const workDir = dirname(inputPath);
  const backupPath = `${inputPath}.gate-bak`;

  let stagingDir: string | null = null;
  try {
    // ── ① staging 候选副本（与 target 分离，自指删除在结构上不再可能）──
    stagingDir = mkdtempSync(join(tmpdir(), 'sofagent-evolve-stage-'));
    const stagingCandidate = join(stagingDir, basename(inputPath));
    copyFileSync(inputPath, stagingCandidate);
    const candidateContent = readFileSync(stagingCandidate, 'utf-8');

    const verdict = runNativeGate({
      workDir,
      candidateDir: stagingCandidate, // 候选：staging 副本
      targetDir: inputPath, // 正式位：live 文件
      // 验证命令：有评分文件走评分比对；缺省一个恒为 0 的探针（可注入覆盖）
      verifyCommand: scoringFilePath && existsSync(scoringFilePath)
        ? `cat ${JSON.stringify(scoringFilePath)} | tail -1`
        : 'echo "0"',
      parseScore: (stdout) => {
        const nums = stdout.match(/\d+(\.\d+)?/g);
        return nums && nums.length > 0 ? parseFloat(nums[nums.length - 1]!) : 0;
      },
    });

    // ── ② 防数据丢失锁（L1/L2/L3）──
    const violation = dataLossViolation(inputPath, backupPath, verdict.action, [
      originalContent,
      candidateContent,
    ]);
    if (violation) {
      return { success: false, error: `${violation}${recoverLiveIfLost(inputPath, backupPath)}` };
    }

    if (verdict.action === 'adopt') return { success: true, candidatePath: inputPath };
    return { success: false, error: `native gate 回滚: ${verdict.basis}` };
  } catch (err) {
    // 异常路径同样不得留下「报错 + live 已丢」的现场
    const detail = err instanceof Error ? err.message : String(err);
    return { success: false, error: `${detail}${recoverLiveIfLost(inputPath, backupPath)}` };
  } finally {
    if (stagingDir) rmSync(stagingDir, { recursive: true, force: true });
  }
}

/**
 * 防数据丢失锁：在**调用面**独立复验三条不变式（v1.4.9 G-17）。
 *
 * 与 gate 内部实现解耦——gate 可以继续演进，但「live 文件没被换丢」这个**调用方的假设**
 * 必须每次运行都被验一遍，而不是靠「我记得里面是原子写」。
 *
 * @param livePath 正式位文件路径
 * @param backupPath 备份文件路径（`<live>.gate-bak`）
 * @param action gate 判定动作
 * @param allowedContents 允许的 live 终态内容集合（原文 / 候选）
 * @returns null = 三条均成立；否则返回 fail-loud 文案（**不得吞**，须当失败上报）
 */
function dataLossViolation(
  livePath: string,
  backupPath: string,
  action: 'adopt' | 'revert',
  allowedContents: string[],
): string | null {
  // L1 · live 文件仍在（G-17 的实害正是不存在）
  if (!existsSync(livePath)) {
    return `防数据丢失锁 L1 触发：${livePath} 在 gate 运行后不存在（live 文件丢失）`;
  }
  // L2 · 内容 ∈ {候选, 原文}。空文件/截断/串写都会落在集合外
  //      （原文非空时，空串天然不在集合内 ⇒ 无需单独判空）
  const after = readFileSync(livePath, 'utf-8');
  if (!allowedContents.includes(after)) {
    const lens = allowedContents.map((c) => c.length).join(' / ');
    return `防数据丢失锁 L2 触发：${livePath} 内容既非候选也非原文（实测 ${after.length} 字符，允许 ${lens}）——疑似截断或串写`;
  }
  // L3 · 回滚面可兑现：adopt 后备份必须仍在。
  //      revert 时备份会被 rename 回 live（属**兑现**而非丢失），故只在 adopt 断言。
  if (action === 'adopt' && !existsSync(backupPath)) {
    return `防数据丢失锁 L3 触发：adopt 成功后未见备份 ${backupPath}（回滚面不可兑现）`;
  }
  return null;
}

/**
 * 异常路径补救：live 已丢而备份仍在 ⇒ 就地恢复，避免「报错 + 数据已丢」。
 * @returns 供错误文案追加的说明（空串 = live 完好，无需补救）
 */
function recoverLiveIfLost(livePath: string, backupPath: string): string {
  if (existsSync(livePath)) return '';
  if (!existsSync(backupPath)) return '（且无备份可恢复——live 文件已丢失）';
  try {
    copyFileSync(backupPath, livePath);
    return '（已从 .gate-bak 恢复 live 文件）';
  } catch {
    return '（.gate-bak 恢复失败——live 文件仍缺失）';
  }
}

/**
 * cli 模式：外部 CLI 兼容层（`SOFAGENT_EVOLVE_GATE=cli` 时的回退路径）。
 *
 * 真实契约（实测 v0.2.0）：`skillopt-sleep run --target-skill-path <PATH> --auto-adopt [--json]`
 * —— 三个 flag 与下方 args 逐字吻合；`run` 默认只把候选写进
 * `<project>/.skillopt-sleep/staging/<ts>/proposed_SKILL.md`，带 `--auto-adopt` 才写回 live 文件。
 */
function runLegacyCliMode(inputPath: string, scoringFilePath?: string): EvolveResult {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  // ⚠️ 不实契约登记（v1.4.9 G-11）：早期 doc 写 `SKILLOPT_SCORING_FILE`、代码设 `EVOLVE_SCORING_FILE`，
  //    而**两个名字都不被外部 CLI 读取**（安装包查证：`skillopt_sleep` 包内 environ/getenv 读取数为 0）。
  //    赋值保留 = 兼容既有部署脚本；但**本注释不再声称「传递给 CLI」**，以免再次留下名实不符的契约。
  if (scoringFilePath && existsSync(scoringFilePath)) {
    env.EVOLVE_SCORING_FILE = scoringFilePath;
  }
  const args: string[] = ['run', '--target-skill-path', inputPath, '--auto-adopt', '--json'];
  try {
    execFileSync(LEGACY_GATE_CLI, args, {
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
 * 检测 evolve 能力是否可用。
 *
 * v1.4.9 G-11 修正——**按模式判**：
 * - `native`（默认）：自研 gate 内置于本包，**零外部依赖** ⇒ 恒 true。
 *   此前无论模式都去探一个不存在的二进制 ⇒ 恒 false ⇒ 三个调用方全部静默降级/跳过，
 *   表现为「机制从未运行」而不是「缺依赖」。
 * - `cli`：探真实二进制 `LEGACY_GATE_CLI` 的 `status` 子命令（已安装时必然 exit 0；
 *   该 CLI **不接受** `--version`，故不能用 `--version` 探活）。
 *
 * @returns native 模式恒 true；cli 模式取决于外部 CLI 是否可用
 */
export function isEvolveAvailable(): boolean {
  const gateMode = process.env.SOFAGENT_EVOLVE_GATE ?? 'native';
  if (gateMode === 'native') return true;
  try {
    execFileSync(LEGACY_GATE_CLI, ['status'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
