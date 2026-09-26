#!/usr/bin/env node
// doctor.ts · sofagent 健康检查
// v1.3.7 新增：从 sofagent-audit --doctor 迁移至 @sofagent/core
// v1.3.7 维护：新增 post-commit hook 存在性检查
// v1.3.7 新增：每项 fail/warn 附修复命令 + --repair 自动修复模式
//
// 检查项：
//   1. 环境检查（Node / git / npm / disk / bash）
//   2. 配置检查（.sofagent/config.yml 是否存在且有效）
//   3. 数据目录结构（v1.5.3：data/ 用户可见数据 + .sofagent/ 引擎内部状态）
//   4. Hook 状态（commit-msg 是否安装含 sofagent 标识 + post-commit 是否存在）
//   5. 包完整性（node_modules 依赖）
//   8. Ontology 完整性（v1.4.3 十三：knowledge/entities/ frontmatter 三查 + skip-log 对账）
//
// 注意：post-commit 仅检查存在性——不检查内容是否引用 sofagent

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { checkEnv } from './env-check';
import { VERSION } from './shared/constants';
import { load as yamlLoad, YAMLException } from 'js-yaml';
import { checkHistoryChainDetailed, validateHmacKey, getHistoryFilePath } from './audit-history';
// F-11：静态 import（vitest ESM 下 require 相对路径不可用）
import { isInitialized as _f11IsInit, loadDataKey as _f11LoadKey, keysDirPath as _f11KeysDir } from './crypto/key-manager';
const _f11KeyMod = { isInitialized: _f11IsInit, loadDataKey: _f11LoadKey, keysDirPath: _f11KeysDir };
import { DATA_DIR, getConfigFile, resolveDataDir, resolveHomeDir, resolveKnowledgeDir } from './data-paths';
// v1.5.3 章四：refresh 重置段的默认配置 SSOT（--init 同源模板，勿另造第二份）
import { CONFIG_TEMPLATE } from './config-template';

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); _warnCount++; }
function fail(msg: string) { console.log(`  ❌ ${msg}`); _failCount++; }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }

// v1.2.9: — 计数器，用于结尾诚实汇总
let _warnCount = 0;
let _failCount = 0;

/** v1.2.7: 修复提示输出 */
function repairHint(cmd: string) { console.log(`     修复：${cmd}`); }

// ============================================================
// v1.4.9 P1-13 · 版本检查修复提示按**安装形态**分流
// ------------------------------------------------------------
// 缺陷：`:115` / `:125` 两条版本修复提示都把 `bash install.sh` 当唯一修法，
//   而 npm 形态下该脚本**根本不在用户机器上**——提示是死路，用户按提示操作必然失败。
// 实测依据（非推测）：
//   ① `npm pack --dry-run`（@sofagent/audit v1.4.8）共 188 个文件，`install.sh`
//      **0 命中**——package.json 的 files 字段只有 `dist/` · `hooks/` · `README.md`。
//   ② 全仓 `~/.sofagent/VERSION` 的**唯一写入点**是 `install.sh:403`
//      （`echo "${VERSION}" > "$SOFAGENT_HOME/VERSION"`），而 install.sh 不在 tarball 内
//      ⇒ npm 形态下该文件恒缺失。故 `:125` 的「**重新**运行 install.sh」双重不成立：
//      脚本不存在 + 从未运行过。
// 边界：本项只分流**提示文案**，不动检查判据本身（npm 形态仍报该 warn——
//   它是「引擎版本与全局安装标记不一致」的真实信号，只是修法不同）。
// ============================================================

/**
 * 安装形态（v1.4.9 P1-13）：
 *   `'repo'` = 仓库克隆 / install.sh 安装（install.sh 在安装根可见）
 *   `'npm'`  = 纯 npm 安装（`npm i -g @sofagent/audit` 等，tarball 内无 install.sh）
 */
export type InstallShape = 'repo' | 'npm';

/**
 * 判定当前引擎的安装形态（v1.4.9 P1-13）。
 *
 * 判据：模块所在目录路径的路径段里是否含 `node_modules`。
 *   - 仓库克隆：`<root>/engine/core/{src,dist}`                → `'repo'`
 *   - npm 安装：`<global>/node_modules/@sofagent/core/dist`     → `'npm'`
 * 选它而非「向上找 install.sh」的理由：路径段判定**确定**（不依赖安装根里有/没有
 * 同名脚本），且 npm 与仓库两种布局的差别正是这一层 node_modules。
 *
 * @param moduleDir 本模块所在目录（默认 `__dirname`；测试可注入以覆盖 npm 布局）
 * @returns 安装形态
 */
export function detectInstallShape(moduleDir: string = __dirname): InstallShape {
  return moduleDir.split(/[\\/]+/).includes('node_modules') ? 'npm' : 'repo';
}

/**
 * 生成版本一致性检查的修复提示（v1.4.9 P1-13）。
 *
 * 四条文案（`shape` × `situation`）都**必须**带上 `homeVersionFile` 绝对路径——
 * 否则用户不知道要改哪个文件（`:125` 原先只说「创建 VERSION 文件」）。
 * `repo + mismatch` 一条与 v1.4.9 之前的原文**逐字一致**，属纯保持。
 *
 * @param shape           安装形态（`detectInstallShape` 的结果）
 * @param situation       `'mismatch'` = VERSION 存在但版本不符；`'missing'` = VERSION 不存在
 * @param homeVersionFile VERSION 文件绝对路径
 * @param version         当前引擎版本（升级/写入的目标版本）
 * @returns 修复提示文案
 */
export function formatVersionRepairHint(
  shape: InstallShape,
  situation: 'mismatch' | 'missing',
  homeVersionFile: string,
  version: string,
): string {
  if (shape === 'npm') {
    // npm 形态无 install.sh：修法是升级 npm 包（或直接改该文件）。
    // 括号里保留「无 install.sh」这句解释是刻意的——用户若看过旧提示会疑惑脚本去哪了；
    // 但**不得出现 `bash install.sh` 这个可执行修法**（npm 机器上没有该脚本）。
    return situation === 'mismatch'
      ? `npm 全局安装形态无 install.sh——升级到匹配版本：npm i -g @sofagent/audit@${version}（或手动更新 ${homeVersionFile}）`
      : `npm 全局安装形态无 install.sh——该文件由安装器生成，npm 安装不产生它；手动创建 ${homeVersionFile} 并写入当前引擎版本：echo ${version} > ${homeVersionFile}`;
  }
  return situation === 'mismatch'
    ? `重新安装以同步版本：bash install.sh（或手动更新 ${homeVersionFile}）`
    : `重新运行 install.sh 创建 VERSION 文件（${homeVersionFile}）`;
}

/**
 * v1.2.7: doctor 检查结果（结构化，含修复命令）
 */
export interface DoctorCheckResult {
  /** 检查项名称 */
  check: string;
  /** 是否通过 */
  passed: boolean;
  /** 严重程度 */
  severity: 'ok' | 'warn' | 'fail';
  /** 检查消息 */
  message: string;
  /** 修复命令（v1.2.7 新增，fail/warn 时提供） */
  repairCommand?: string;
}

export interface DoctorReport {
  env: boolean;
  config: boolean;
  dataDirs: boolean;
  hook: boolean;
  deps: boolean;
  auditLog: boolean;
  allOk: boolean;
  /** v1.3.0 (F-23): warning 条数——调用方据此区分「仅警告（EXIT=0）」与「有错误（EXIT≠0）」 */
  warnCount: number;
  /** v1.3.0 (F-23): error 条数 */
  failCount: number;
}

/**
 * 运行 doctor 健康检查
 * @param projectDir 项目根目录
 * @param options v1.3.5：resetBaseline——为 true 时无条件重算当前 dist SHA-256
 *   并覆写 ~/.sofagent/internal/audit-hash.txt（rebuild dist 后一键重置基线，
 *   bugfix #18 执行遗留）。覆写后继续正常比对输出 ✅。
 * @returns DoctorReport
 */
export function runDoctor(projectDir: string = process.cwd(), options: { resetBaseline?: boolean } = {}): DoctorReport {
  // v1.2.9: — 每次调用重置计数器
  _warnCount = 0;
  _failCount = 0;

  console.log(`\n  sofagent doctor v${VERSION}\n`);
  console.log(`  检查目录: ${projectDir}\n`);

  // 1. 环境检查
  console.log('── 环境检查 ──');
  const env = checkEnv();
  if (env.allOk) {
    ok('环境检查通过');
  } else {
    if (!env.node.ok) { fail(`Node.js ${env.node.version} (需要 ≥18)`); repairHint('升级 Node.js 到 ≥18（macOS: brew install node@18 / Linux: nvm install 18 / Windows: https://nodejs.org/）'); }
    else ok(`Node.js ${env.node.version}`);
    if (!env.git.available) { fail('git 不可用'); repairHint('安装 git（macOS: xcode-select --install / Linux: sudo apt install git / Windows: https://git-scm.com/）'); }
    else ok('git 可用');
    // 移除凑数检查项——npm 可用/磁盘空间与 sofagent 健康无因果（npm 装过即可，
    // 磁盘 342GB ✅ 只是噪音）。npm/disk 仍在 checkEnv() 内部计算，只是不再作为健康信号展示。
    if (!env.openclaw.exists) { warn('~/.openclaw 不存在'); repairHint('运行 sofagent-audit --init 初始化（或安装 OpenClaw 平台）'); }
    if (!env.sofagent.exists) { warn('~/.sofagent 不存在（将自动创建）'); repairHint('运行 sofagent-audit --init 初始化'); }
  }

  // v1.2.9 版本一致性检查（~/.sofagent/VERSION vs 当前引擎版本）
  // v1.3.5 #4: 段标题加 [全局] 标注——该检查读全局 SOFAGENT_HOME，与被检查仓库无关；
  //   多仓库用户会把全局安装状态误读为「本仓库健康」，来源必须显式
  console.log('\n── 版本一致性 [全局安装，非当前仓库] ──');
  try {
    // run-07 verdict P1-3：改走 data-paths SSOT（resolveHomeDir 内经 sanitizeSofagentHome
    // 白名单防护），不再直读 process.env.SOFAGENT_HOME——v1.3.2 P0-RC2 path-traversal
    // 防护对 doctor 三处全局路径读取同样生效。
    const homeVersionFile = join(resolveHomeDir(), 'VERSION');
    // v1.4.9 P1-13：修复提示按安装形态分流（npm tarball 内无 install.sh——
    // `bash install.sh` 对 npm 用户是死路）。判据见 detectInstallShape 注释。
    const installShape = detectInstallShape();
    if (existsSync(homeVersionFile)) {
      const installedVersion = readFileSync(homeVersionFile, 'utf-8').trim();
      if (installedVersion !== VERSION) {
        warn(`~/.sofagent/VERSION 写的是 ${installedVersion}，当前引擎 ${VERSION}——可能发版后未同步`);
        repairHint(formatVersionRepairHint(installShape, 'mismatch', homeVersionFile, VERSION));
        // v1.3.9 补充升级安全性：消除企业 IT 对「升级覆盖数据」的顾虑——
        // 升级保留用户数据与已装 hooks（不覆盖 ~/.sofagent/data/ 与已装 hooks），
        // 破坏性变更见 CHANGELOG 对应版本条目。
        info('升级保留 ~/.sofagent/data/ 与已装 hooks（不覆盖用户数据）；破坏性变更见 CHANGELOG 对应版本条目');
      } else {
        ok(`~/.sofagent/VERSION (${installedVersion}) 与引擎版本一致`);
      }
    } else {
      warn('~/.sofagent/VERSION 不存在——可能是首次安装或旧版本残留');
      repairHint(formatVersionRepairHint(installShape, 'missing', homeVersionFile, VERSION));
    }
  } catch {
    warn('版本检查失败（不影响审计功能）');
  }

  // 2. 配置检查（v1.1.3: 从「存在」升级为「存在且合法」）
  console.log('\n── 配置检查 ──');
  const sofagentDir = join(projectDir, '.sofagent');

  // v1.2.9 SOFAGENT_CONFIG 环境变量检查（企业集中管控用）
  const envConfigPath = process.env.SOFAGENT_CONFIG;
  if (envConfigPath) {
    if (existsSync(envConfigPath)) {
      ok(`SOFAGENT_CONFIG=${envConfigPath}（企业集中管控配置，已存在）`);
    } else {
      fail(`SOFAGENT_CONFIG=${envConfigPath} 但文件不存在`);
      repairHint(`创建配置文件或修正 SOFAGENT_CONFIG 环境变量路径`);
    }
  }

  const configPath = envConfigPath && existsSync(envConfigPath) ? envConfigPath : getConfigFile(projectDir);
  let configOk = false;
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      if (content.trim().length === 0) {
        warn('.sofagent/config.yml 为空');
        repairHint('运行 sofagent-audit --init 生成默认配置');
      } else {
        // v1.1.3: 验证 YAML 合法性
        try {
          yamlLoad(content);
          ok('.sofagent/config.yml 存在且合法');
          configOk = true;
        } catch (yamlErr) {
          if (yamlErr instanceof YAMLException) {
            const line = yamlErr.mark?.line != null ? yamlErr.mark.line + 1 : '?';
            const col = yamlErr.mark?.column != null ? yamlErr.mark.column + 1 : '?';
            fail(`.sofagent/config.yml 格式错误（第 ${line} 行第 ${col} 列: ${yamlErr.reason}）`);
            repairHint('修正 YAML 语法错误（或删除文件让系统使用默认配置：rm .sofagent/config.yml）');
          } else {
            fail(`.sofagent/config.yml 格式错误: ${(yamlErr as Error).message}`);
            repairHint('修正 YAML 语法错误（或删除文件让系统使用默认配置：rm .sofagent/config.yml）');
          }
        }
      }
    } catch (err) {
      fail(`.sofagent/config.yml 读取失败: ${err instanceof Error ? err.message : String(err)}`);
      repairHint('检查文件权限（chmod 644 .sofagent/config.yml）');
    }
  } else {
    warn('.sofagent/config.yml 不存在（将使用默认配置，功能正常）');
    configOk = true;  // 新装场景，使用默认配置，功能正常
    configOk = true;  // 新装场景，使用默认配置，功能正常
  }

  // 3. 数据目录结构（v1.2.1：用户可见数据迁移到 data/，引擎内部状态留在 .sofagent/）
  // v1.1.4 修复：所有运行时目录都是首次使用时自动创建的，全新用户不存在完全正常。
  // 只在目录存在但无法读取时 warn，不存在时完全静默（不报 info 避免噪音）。
  // v1.2.1 起数据分两处：
  //   data/（用户可见）：
  //   - audit/（含 history.jsonl + session-report.json，v1.0.8 起审计结果归档在此）
  //   - task/logs/（A7/A8/A15 读取的任务日志目录）
  //   - knowledge/（L1 task 记忆 + shared/ 跨设备共享）
  //   - orchestrator/（编排状态，v1.1.3+ Checkpoint 存储）
  //   .sofagent/（引擎内部状态）：
  //   - .git-shadow/（v1.0.8 文件系统审计的 isomorphic-git 隐藏仓库）
  //   - ontology/（本体缓存，v1.1.0+）
  // v1.3.5 #4: 段标题加 [全局] 标注——数据目录读全局 SOFAGENT_HOME，多仓库场景下
  //   这些 ✅ 不代表当前仓库（历史教训：企业 IT 把「本机装过」误读为「本仓库健康」）
  console.log('\n── 数据目录结构 [全局 ~/.sofagent/，非当前仓库] ──');
  const dataDir = DATA_DIR;
  // [根目录, 该根下期望的子目录]
  const expectedRoots: Array<[string, string[]]> = [
    [dataDir, ['audit', 'task/logs', 'knowledge', 'orchestrator']],
    [sofagentDir, ['.git-shadow', 'ontology']],
  ];
  let dirsOk = true;
  let existingCount = 0;
  for (const [root, subDirs] of expectedRoots) {
    const rootLabel = root === dataDir ? 'data' : '.sofagent';
    if (!existsSync(root)) continue;
    for (const dir of subDirs) {
      const dirPath = join(root, dir);
      if (existsSync(dirPath)) {
        existingCount++;
        try {
          const files = readdirSync(dirPath).filter((f) => !f.startsWith('.'));
          ok(`${rootLabel}/${dir}/ (${files.length} 文件)`);
        } catch (err) {
          warn(`${rootLabel}/${dir}/ (无法读取): ${err instanceof Error ? err.message : String(err)}`);
          repairHint(`检查目录权限（chmod -R 755 ${rootLabel}/${dir}）`);
          dirsOk = false;
        }
      }
      // 不存在的目录不输出——它们都是运行时自动创建的，全新用户不存在完全正常
    }
  }
  if (existingCount === 0) {
    if (existsSync(dataDir) || existsSync(sofagentDir)) {
      info('数据目录已初始化，运行一次审计后将自动创建数据子目录');
    } else {
      info('data/ 目录不存在（运行 sofagent-audit --init 创建）');
      dirsOk = false;
    }
  }

  // 4. Hook 状态
  console.log('\n── Git Hook 状态 ──');
  let hookOk = false;
  try {
    // 🔴 cwd: projectDir 必传——gitDir 必须基于被检查目录解析，否则在进程 cwd
    // （如 vitest worker 所在的主仓）解析：主仓装了 hook 时测试假阳性、CI 主仓
    // 未装时真失败（两环境结果相反的根因）
    const gitDirResult = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: projectDir }).trim();
    const gitDir = gitDirResult.startsWith('/') ? gitDirResult : join(projectDir, gitDirResult);
    // v1.4.5 (T14): hook 目录尊重 core.hooksPath——与安装侧（audit 包 hook-install.ts
    // 的 resolveHooksDir，E1 施工）同一语义。repo 配置 core.hooksPath 时 hook 写进
    // 该目录，doctor 若仍查 $gitDir/hooks 会假红。解析规则：
    //   1. git config core.hooksPath 有值 → ~ / $VAR 先展开；相对路径按 repo 顶层
    //      （--show-toplevel）resolve——git 自身对 core.hooksPath 就是顶层基准语义，
    //      安装侧同规则，两侧对齐防「装在 A 查在 B」
    //   2. 未配置 → $gitDir/hooks（git 缺省，v1.4.5 之前的行为）
    //   3. 任一 git 子命令失败 → 退回 $gitDir/hooks（与未配置同路径，不因此中断检查）
    let hooksDir = join(gitDir, 'hooks');
    try {
      const configured = execFileSync('git', ['config', 'core.hooksPath'], {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: projectDir,
      }).trim();
      if (configured) {
        let expanded = configured;
        if (expanded.startsWith('~/')) expanded = join(homedir(), expanded.slice(2));
        else if (expanded.startsWith('~')) expanded = join(homedir(), expanded.slice(1));
        else {
          const envMatch = expanded.match(/^\$([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
          if (envMatch) {
            const envVal = process.env[envMatch[1] ?? ''] ?? '';
            expanded = join(envVal, (envMatch[2] ?? '').replace(/^[/\\]/, ''));
          }
        }
        let repoTop = '';
        try {
          repoTop = execFileSync('git', ['rev-parse', '--show-toplevel'], {
            encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: projectDir,
          }).trim();
        } catch { /* worktree 等场景退化用 .git 父目录 */ }
        const base = repoTop || dirname(gitDir);
        hooksDir = isAbsolute(expanded) ? expanded : resolve(base, expanded);
        info(`core.hooksPath 已配置——hook 目录: ${hooksDir}`);
      }
    } catch {
      // core.hooksPath 未配置或 git config 失败——缺省 $gitDir/hooks
    }
    const hookPath = join(hooksDir, 'commit-msg');
    if (existsSync(hookPath)) {
      try {
        const hookContent = readFileSync(hookPath, 'utf-8');
        // v1.5.1 E3：改前是**子串匹配** `hookContent.includes('sofagent')`——
        // 把 commit-msg 换成三行空脚本（只要含一行 `# sofagent` 注释）doctor 就报
        // 「✅ 已安装」，而 SECURITY.md 只声称「删除可检测」，未披露「替换不可检测」。
        // 现按三要素判定（与 tools/check/check-template-drift.sh 的 hook 版本标记口径同源）：
        //   ① sofagent 标记  ② 版本标记行 `# sofagent <hook> hook vX.Y.Z`
        //   ③ 关键行为锚点（审计引擎调用 / 退出码契约）
        // 三要素齐才判「已安装」；缺任一要素即按「不完整」告警并给重装命令。
        // 副作用是 doctor 顺带具备**版本对账**能力（与安装器 Step 6.5 的版本提示互补）。
        const hasMarker = hookContent.includes('sofagent');
        const versionMarker = hookContent.match(/^\s*#\s*sofagent\s+commit-msg\s+hook\s+v(\d+)\.(\d+)\.(\d+)\s*$/m);
        // 关键行为锚点：hook 必须真的调用审计引擎并区分退出码契约
        const hasBehaviorAnchor = hookContent.includes('sofagent-audit') && hookContent.includes('EXIT_CODE');
        if (hasMarker && versionMarker && hasBehaviorAnchor) {
          ok(`commit-msg hook 已安装（v${versionMarker[1]}.${versionMarker[2]}.${versionMarker[3]}，含版本标记与行为锚点）`);
          hookOk = true;
        } else if (!hasMarker) {
          warn('commit-msg hook 存在但不包含 sofagent 标识');
          repairHint('sofagent-audit --install-hook');
        } else {
          // 有 sofagent 字样但缺版本标记 / 行为锚点——典型的**替换型篡改或旧版残留**。
          // 不再误报「已安装」（这正是 E3 的缺陷面）。
          const missing: string[] = [];
          if (!versionMarker) missing.push('版本标记行（# sofagent commit-msg hook vX.Y.Z）');
          if (!hasBehaviorAnchor) missing.push('行为锚点（sofagent-audit 调用 + EXIT_CODE 契约）');
          warn(`commit-msg hook 不完整——缺 ${missing.join(' / ')}（可能是被替换的空壳脚本或旧版残留）`);
          repairHint('sofagent-audit --install-hook（重装以恢复版本标记与行为锚点）');
        }
      } catch (err) {
        warn(`commit-msg hook 存在但无法读取: ${err instanceof Error ? err.message : String(err)}`);
        repairHint(`检查文件权限（chmod 755 ${hookPath}）`);
      }
    } else {
      // v1.5.2 A-7：warn → fail——commit-msg 是审计主防线，「审计不会运行」不该静默
      // 通过（此前 allOk 含 hookOk 但 CLI 侧只看 failCount，warn 即 exit 0——最该
      // 报警的一天静默通过）。文案不变，只升严重度。
      fail('commit-msg hook 未安装——审计不会运行！运行 sofagent-audit --install-hook 安装');
      repairHint('sofagent-audit --install-hook');
    }

    // v1.4.2 H-01: pre-commit——三层防线主防线（.sofagent/ 永不入库的 staged 清理）
    // v1.4.5 (T14): 路径同 commit-msg——统一走 hooksDir（core.hooksPath 生效时为配置目录）
    const preCommitPath = join(hooksDir, 'pre-commit');
    if (existsSync(preCommitPath)) {
      try {
        const prcContent = readFileSync(preCommitPath, 'utf-8');
        const hasGuardLogic = prcContent.includes('git reset') && prcContent.includes('.sofagent/');
        if (prcContent.includes('sofagent') && hasGuardLogic) {
          ok('pre-commit hook 已安装并包含 .sofagent/ 入库防线');
        } else if (prcContent.includes('sofagent')) {
          warn('pre-commit hook 存在但不含入库防线逻辑（旧版审计 hook，无 reset 守卫）');
          repairHint('sofagent-audit --install-hook');
        } else {
          // 非 sofagent 的用户自有 pre-commit——不告警（尊重用户自己的 hook）
          info('pre-commit hook 存在（非 sofagent，未接管——如需三层防线运行 --install-hook）');
        }
      } catch (err) {
        warn(`pre-commit hook 存在但无法读取: ${err instanceof Error ? err.message : String(err)}`);
        repairHint(`检查文件权限（chmod 755 ${preCommitPath}）`);
      }
    } else {
      // v1.5.2 A-7：warn → fail——pre-commit 是 .sofagent/ 入库主防线，语义同
      // commit-msg（主防线缺失 = 最该报警的一天）。文案不变，只升严重度。
      fail('pre-commit hook 未安装——.sofagent/ 入库主防线缺失。运行 sofagent-audit --install-hook 补装');
      repairHint('sofagent-audit --install-hook');
    }

    // post-commit：检查存在性 + 内容是否含审计对账逻辑（v1.3.2 P0-RC3 加强）
    // v1.4.5 (T14): 路径同上——统一走 hooksDir（core.hooksPath 生效时为配置目录）
    const postCommitPath = join(hooksDir, 'post-commit');
    if (existsSync(postCommitPath)) {
      try {
        const pcContent = readFileSync(postCommitPath, 'utf-8');
        const hasAuditLogic = pcContent.includes('sofagent-audit')
          || pcContent.includes('HISTORY_FILE')
          || pcContent.includes('verify-commit')
          || pcContent.includes('parentSha');
        if (hasAuditLogic) {
          ok('post-commit hook 已安装并包含审计对账逻辑');
        } else {
          warn('post-commit hook 存在但不包含 sofagent 审计对账逻辑（可能是占坑 hook）');
          repairHint('sofagent-audit --install-hook');
        }
      } catch (err) {
        warn(`post-commit hook 存在但无法读取: ${err instanceof Error ? err.message : String(err)}`);
        repairHint(`检查文件权限（chmod 755 ${postCommitPath}）`);
      }
    } else {
      warn('post-commit hook 未安装——绕过检测不可用。运行 sofagent-audit --init 或 --install-hook 自动安装');
      repairHint('sofagent-audit --install-hook');
    }
  } catch (err) {
    info(`非 git 仓库，跳过 hook 检查（${err instanceof Error ? err.message : String(err)}）`);
  }

  // 5. 依赖检查
  // 依赖解析改为 require.resolve（从包自身位置解析 Node 模块解析算法），
  //   替代此前手拼路径的 existsSync——手拼路径在 monorepo hoist / pnpm / 不同安装
  //   布局下会误报 "js-yaml 未安装"。require.resolve 从 __dirname 出发，走 Node
  //   标准模块解析（向上逐层 node_modules），覆盖所有包管理器布局。
  console.log('\n── 依赖检查 ──');
  let depsOk = true;

  const criticalDeps = ['js-yaml'];
  for (const dep of criticalDeps) {
    try {
      // require.resolve 从 doctor.ts 编译后的位置（模块包 dist/ 内）向上查找
      // node_modules，不受 cwd 影响——修复非仓库目录运行 --doctor 时误报依赖缺失。
      // CJS 环境下 require 全局可用，直接调用 require.resolve。
      require.resolve(dep);
      ok(`${dep} 已安装`);
    } catch {
      // 模块包内解析失败 → 尝试从 cwd 解析（workspace 场景）
      try {
        const cwdRequire = require('module').createRequire(join(projectDir, 'package.json'));
        cwdRequire.resolve(dep);
        ok(`${dep} 已安装 (workspace)`);
      } catch {
        warn(`${dep} 未安装（某些功能可能不可用）`);
        repairHint(`npm install ${dep}`);
        depsOk = false;
      }
    }
  }

  // 6. dist 完整性检查（v1.2.7: 影子审计器劫持防护——检测 dist/index.js 是否被替换）
  // 计算 dist/index.js 的 SHA-256，与安装时记录的哈希比对（存 ~/.sofagent/internal/audit-hash.txt）
  console.log('\n── dist 完整性检查 ──');
  let distIntegrityOk = true;
  // v1.3.5 #18: 路径修复——此前 `join(__dirname, '..', 'audit', ...)` 从 core/dist 解析到
  //   engine/core/audit/dist/index.js（不存在）→ existsSync 恒 false → 既不校验也不写基线，
  //   影子审计器防御永久失效（SECURITY.md:329 声称与事实矛盾）。
  // 修复后的解析顺序（覆盖 monorepo / npm 全局安装两种布局）：
  //   ① monorepo：core/dist → core → engine/ → engine/audit/dist/index.js（../../audit/dist）
  //   ② 发布安装：require.resolve('@sofagent/audit') 得包 main 入口（./dist/public-api.js），
  //      从入口文件上溯两级（dist/public-api.js → dist → 包根）再拼 dist/index.js
  //   ③ 两者均不存在 → 显式 warn（不再静默跳过——「检查不到」不等于「通过」）
  // 🔴 v1.5.0 TASK-19 修正 ②：原实现 join(dirname(resolve(...)), 'dist', 'index.js')——
  //   dirname(public-api.js) 是 dist/，再拼 dist/index.js 得 dist/dist/index.js（错位，
  //   发布安装态恒 miss → doctor 的 audit 检查空转走显式 warn）。resolve 已落在 dist 内，
  //   正解是上溯到**包根**再拼 dist/index.js（两种安装态的包根布局一致）。
  let auditDistPath = join(__dirname, '..', '..', 'audit', 'dist', 'index.js');
  if (!existsSync(auditDistPath)) {
    try {
      // CJS 环境下 require 全局可用（与上方依赖检查同一先例）；
      // 从 core 包位置出发解析 audit 包，兼容任意 node_modules 嵌套深度。
      // main 入口（dist/public-api.js）→ dirname×2 = 包根 → dist/index.js
      auditDistPath = join(dirname(dirname(require.resolve('@sofagent/audit'))), 'dist', 'index.js');
    } catch {
      // @sofagent/audit 不可解析（未安装/独立安装 core）——留给下方显式 warn
    }
  }
  if (existsSync(auditDistPath)) {
    try {
      const distContent = readFileSync(auditDistPath);
      const currentHash = createHash('sha256').update(distContent).digest('hex');
      const hashRecordPath = join(resolveHomeDir(), 'internal', 'audit-hash.txt');

      // v1.3.5 --reset-baseline：无条件重算并覆写基线（rebuild dist 后一键重置）
      // 覆写后按「基线 = 当前值」输出校验通过——不产生假 mismatch 告警。
      if (options.resetBaseline === true) {
        // v1.4.8 阶段八修正：原实现只写 audit-hash.txt（**兼容锚**，语义 = dist/index.js 单文件哈希），
        // 而 hook 的完整性校验读的是 **主锚 audit-dist-hash.txt**（多入口聚合哈希）⇒ 实测「--reset-baseline
        // 输出『基准哈希已重置』但主锚纹丝不动、commit 仍被拦截」= 名不副实。
        // 正解：调仓内唯一权威实现 tools/audit-baseline-sync.sh（它同步全部三锚：主锚/兼容锚/源码指纹），
        // 避免在此重复实现聚合算法（会再造一套「靠人工保持一致」的双源）。
        // 仓外场景（无 tools/）删除三个锚文件——hook 的「基准缺失」分支会 fail-closed 补生成并放行本次。
        try {
          const hashDir = join(hashRecordPath, '..');
          if (!existsSync(hashDir)) mkdirSync(hashDir, { recursive: true, mode: 0o700 });
          const syncScript = join(projectDir, 'tools', 'audit-baseline-sync.sh');
          if (existsSync(syncScript)) {
            execFileSync('bash', [syncScript, '--quiet'], { stdio: 'pipe' });
            ok(`✅ 三锚已重置（主锚 audit-dist-hash / 兼容锚 audit-hash / 源码指纹）——经 tools/audit-baseline-sync.sh`);
          } else {
            for (const f of ['audit-dist-hash.txt', 'audit-hash.txt', 'audit-src-fingerprint.txt']) {
              try { rmSync(join(hashDir, f), { force: true }); } catch { /* 为何可静默：force:true 下文件不存在不抛错，此 catch 仅兜底权限异常，且清锚失败会让 hook 的「基准缺失」分支兜住，不影响语义 */ }
            }
            ok(`✅ 三锚已清除（仓外无 tools/ 同步脚本）——下次 hook 运行会 fail-closed 重新记录基线`);
          }
        } catch (err) {
          fail(`基准哈希重置失败: ${err instanceof Error ? err.message : String(err)}`);
          distIntegrityOk = false;
        }
      } else if (existsSync(hashRecordPath)) {
        const recordedHash = readFileSync(hashRecordPath, 'utf-8').trim();
        if (currentHash === recordedHash) {
          ok(`audit dist/index.js 完整性校验通过（SHA-256: ${currentHash.slice(0, 12)}...）`);
        } else {
          fail(`audit dist/index.js 哈希不匹配——可能被替换（影子审计器劫持风险）。记录值: ${recordedHash.slice(0, 12)}...，当前值: ${currentHash.slice(0, 12)}...`);
          repairHint('重新安装 sofagent（npm run build 或 sofagent-audit --install-hook）以恢复原始 dist');
          distIntegrityOk = false;
        }
      } else {
        // v1.4.2 G-01: 基线缺失不再静默自动记录——影子审计器劫持的信任锚必须是「首次人工
        // 执行时刻」，自动记录会把「已被篡改的 dist」固化为合法基线（首跑即沦陷场景）。
        // 改为显眼提示 + 引导 --baseline 显式建立（信任锚 = 人工确认时刻）。
        fail('⚠️ 未建立 dist 基线哈希，影子审计器风险未设防。立即执行 sofagent-audit --doctor --baseline 建立基线');
        repairHint('sofagent-audit --doctor --baseline（信任锚 = 你此刻确认 dist 可信的时刻）');
        distIntegrityOk = false;
      }
    } catch (err) {
      warn(`dist 完整性检查异常（已跳过）: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // v1.3.5 #18: dist 不存在 → 显式告警（非 monorepo 且未安装 @sofagent/audit 的场景）。
    // 此前静默跳过 =「检查不到」被当成「通过」，与失败路径不可区分。
    warn('audit dist/index.js 未找到——dist 完整性检查（影子审计器劫持防护）不可用');
    repairHint('npm run build --workspace=engine/audit（monorepo）或安装 @sofagent/audit');
    distIntegrityOk = false;
  }

  // 7. 审计日志完整性（HMAC 密钥强度 + 链完整性，v1.1.8 / v1.2.0）
  // 检查两项：① HMAC 密钥是否配置且足够强 ② history.jsonl 链完整性
  //   修复：区分「篡改（红）」与「历史不可复验（黄，key/环境漂移）」
  console.log('\n── 审计日志完整性 ──');
  const keyStatus = validateHmacKey();
  if (!keyStatus.configured) {
    // (2026-08-02 复核修正)：--init-hmac 命令不存在，提示语指向 的 --init 入口
    // （--init 已实现自动生成 ~/.sofagent-key）
    warn('无 HMAC 签名，完整性校验强度降低：审计日志仅 SHA-256 校验（Agent 可重算整链）。运行 sofagent-audit --init 可自动生成 HMAC 密钥（~/.sofagent-key）启用 HMAC-SHA256 强校验');
    repairHint('sofagent-audit --init');
  } else if (!keyStatus.strong) {
    // 弱密钥明确告警，不静默稀释强校验
    warn(`HMAC 密钥强度不足（${keyStatus.reason}）——审计日志强校验被弱密钥稀释，建议重新生成 ≥16 字节强密钥（如：openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key）`);
    repairHint('openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key');
  } else {
    ok('已配置 HMAC 密钥（~/.sofagent-key，≥16 字节），审计日志使用 HMAC-SHA256 校验（防其他 OS 用户篡改；同用户运行的 Agent 仍可读密钥重算整链，非强防篡改）');
  }

  // 实际校验链完整性（v1.2.0: checkHistoryChainDetailed 已下沉到 core，区分篡改 vs 历史不可复验 vs 不可信）
  // v1.3.1 #14: doctor 只校验最近 500 条（而非全量）——大量历史记录时全量校验性能开销大，
  // doctor 是健康检查不应耗时过久。--verify-chain 命令仍全量校验。
  let auditLogOk = true;

  // v1.4.5 (T3): 凭据文件权限巡检——federation.token 与 data.key 是凭据材料，
  // 宽权限（组/其他可读）= 本机泄露面。文件不存在不告警（未启用联邦/加密是常态）。
  console.log('\n── 凭据文件权限 [全局 ~/.sofagent/，非当前仓库] ──');
  const CREDENTIAL_FILE_CHECKS: Array<{ label: string; path: string; repair: string }> = [
    {
      label: 'federation.token（联邦配对凭据）',
      path: join(resolveHomeDir(), 'federation.token'),
      repair: `chmod 600 ${join(resolveHomeDir(), 'federation.token')}`,
    },
    {
      label: 'keys/data.key（数据加密密钥）',
      path: join(resolveHomeDir(), 'keys', 'data.key'),
      repair: `chmod 600 ${join(resolveHomeDir(), 'keys', 'data.key')}`,
    },
    {
      label: '.sofagent-key（HMAC 签名密钥）',
      path: join(homedir(), '.sofagent-key'),
      repair: `chmod 600 ${join(homedir(), '.sofagent-key')}`,
    },
  ];
  for (const check of CREDENTIAL_FILE_CHECKS) {
    if (!existsSync(check.path)) continue; // 未启用该能力是常态，不告警
    try {
      const mode = statSync(check.path).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        warn(`${check.label} 权限过宽（${mode.toString(8).padStart(3, '0')}，应为 600）——组/其他用户可读 = 凭据泄露面`);
        repairHint(check.repair);
      } else {
        ok(`${check.label} 权限正确（600）`);
      }
    } catch {
      warn(`${check.label} 权限不可读（stat 失败）——请检查文件状态`);
    }
  }

  // F-11：静态加密一致性检查——「曾初始化但密钥缺失」的降级态（新记录回明文）
  // 此前零检测：权限巡检只查「文件在时的 mode」，不查「标记在而文件缺」。
  {
    const { isInitialized, loadDataKey, keysDirPath } = _f11KeyMod;
    const home = resolveHomeDir();
    const initialized = isInitialized(home);
    const keyOk = loadDataKey(home) !== null;
    if (initialized && !keyOk) {
      fail('静态加密一致性——初始化标记在而 data.key 缺失/损坏（新记录正回明文写入）');
      repairHint(`从备份恢复 ${keysDirPath(home)}/data.key，或确认放弃加密后清除初始化标记`);
      auditLogOk = false;
    } else if (initialized && keyOk) {
      ok('静态加密一致性——初始化标记与数据密钥均在位');
    } else {
      console.log('    ℹ️ 静态加密未启用（无初始化标记——合法态，明文写入为默认行为）');
    }
  }

  try {
    const result = checkHistoryChainDetailed(undefined, 500);
    if (result.status === 'ok') {
      ok('审计日志 hash chain 完整性校验通过');
    } else if (result.status === 'tampered') {
      // ① 篡改检测（红）：确为伪造
      auditLogOk = false;
      fail(`审计日志 hash chain 断裂——检测到篡改痕迹（${result.detail ?? ''}），请检查 data/audit/history.jsonl`);
      console.log(`
     可能原因：
     1. secret key 发生变更（如更换机器/重装系统）→ 预期断裂（见下方「历史不可复验」说明）
     2. 审计日志文件损坏（并发写入冲突）→ 检查 ~/.sofagent/data/audit/history.jsonl 是否有损坏行
     3. 审计日志确实被篡改 → 检查 ~/.sofagent/data/audit/history.jsonl 的修改时间`);
    } else if (result.status === 'insufficient') {
      // ③ 历史不可信（黄，）：删除/单条不再报 ok——显式声明防篡改链不可验证
      auditLogOk = false;
      warn(`审计日志 hash chain 不可验证（${result.detail ?? '审计历史不足'}）——审计历史不存在或不足 2 条，无法构成可验证的防篡改链。如非全新安装，请核查审计历史是否被删除`);
    } else {
      // ② 历史不可复验（黄）：key/环境漂移，非篡改——不报「链断裂/篡改」，不判失败
      warn(`审计日志 hash chain 不可复验（黄色提示，非篡改）：${result.detail ?? ''}。这是由于密钥轮换，或运行环境变化（如更换设备/用户/仓库路径）导致的预期断裂，非安全事件。如确为本人密钥变更，可忽略此警告。如非本人操作，请核查 ~/.sofagent-key 与运行环境`);
    }
  } catch (chainErr) {
    // 链校验异常（极少）：不影响其余检查，但记录以便排查，
    // 不再静默吞掉（P1-B-iv：空 catch 会掩盖内部错误并误报「通过」）
    warn(`审计日志 hash chain 校验异常，已跳过（不影响其余检查）: ${chainErr instanceof Error ? chainErr.message : String(chainErr)}`);
    auditLogOk = true;
  }

  // 7b. 未审计 commit 扫描（v1.4.8 F-18——SECURITY.md「二级防御」声称落地）
  // 原理：git log --grep 匹配审计签名（sofagent 审计通过的 commit message 由
  // hook 之外的历史记录覆盖——history.jsonl 的 commitSha/parentSha 集合才是
  // 审计事实源）；对最近 N=50 个 commit 的 SHA 集合与 history 记录的
  // commitSha/parentSha 集合做差，差集 = 未审计 commit → 逐条 WARN。
  console.log('\n── 未审计 commit 扫描 [最近 50 个] ──');
  try {
    const logFmt = execFileSync('git', ['log', '-50', '--pretty=format:%H%x09%h%x09%s'], { cwd: projectDir, encoding: 'utf8' }).toString();
    const commitLines = logFmt.trim().split('\n').filter((l) => l.includes('\t'));
    if (commitLines.length === 0) {
      info('无 commit 历史（空仓库），跳过未审计扫描');
    } else {
      // history.jsonl 审计事实集合（loadHistory 在 audit-history.ts，doctor 已 import 链内）
      const histPath = getHistoryFilePath();
      const auditedShas = new Set<string>();
      if (existsSync(histPath)) {
        try {
          const histLines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
          // 只取最近 500 条（对齐 v1.3.1 #14 doctor 只校验最近 500 条的性能先例）
          for (const line of histLines.slice(-500)) {
            try {
              const entry = JSON.parse(line) as { commitSha?: string; parentSha?: string };
              if (entry.commitSha) auditedShas.add(entry.commitSha);
              // parentSha 记录的是审计时 HEAD——它对应的 commit 本身也被审计覆盖
              if (entry.parentSha) auditedShas.add(entry.parentSha);
            } catch { /* 损坏行跳过——链完整性检查另行报告 */ }
          }
        } catch { /* 读失败按空集处理——下方 diff 为全量时自然提示 */ }
      }
      if (auditedShas.size === 0) {
        warn(`history.jsonl 无可用审计记录（${histPath}）——未审计扫描退化为「全部待核」，请先运行一次审计或 --init`);
      } else {
        const missing: string[] = [];
        for (const line of commitLines) {
          const [fullSha, shortSha, ...rest] = line.split('\t');
          if (!fullSha) continue;
          if (!auditedShas.has(fullSha)) {
            missing.push(`${shortSha ?? fullSha.slice(0, 7)} ${rest.join('\t').slice(0, 50)}`);
          }
        }
        if (missing.length === 0) {
          ok(`最近 ${commitLines.length} 个 commit 均有审计记录覆盖`);
        } else {
          warn(`检测到 ${missing.length} 个未审计 commit（可能 --no-verify 绕过或 hook 安装前提交）：`);
          for (const m of missing.slice(0, 10)) console.log(`     ${m}`);
          if (missing.length > 10) console.log(`     ... 共 ${missing.length} 个`);
          repairHint('sofagent-audit --verify-commit <SHA> 逐个复核；确认无风险后可忽略（hook 安装前的历史 commit 属预期）');
        }
      }
    }
  } catch (err) {
    // 非 git 仓库 / git 不可用——doctor 主流程已有环境检查兜底，这里不重复告警
    info(`未审计 commit 扫描跳过（git 不可用或非 git 仓库）: ${err instanceof Error ? err.message.split('\n')[0] : ''}`);
  }

  // 8. Ontology 完整性检查（v1.4.3 十三）
  // 背景：LIMITATIONS §七多年披露——entities/ frontmatter 格式不规范时实体被合并逻辑
  // 静默跳过，Ontology 缺失对象用户无法自动发现。本段把静默跳过变成 doctor 可见信号：
  //   ① 遍历 <dataDir>/knowledge/entities/*.md，逐文件 frontmatter 三查：
  //      `---` 分隔符存在 / YAML 可解析 / relations 字段名合法
  //   ② 异常文件逐条 WARN（路径 + 病因）+ repairHint（模板样例 + 文档锚点）
  //   ③ 读取 ontology/skip-log.json（merge-engine 落盘）对账「跳过数 vs 报告数」
  // 作用域：数据目录读全局 SOFAGENT_HOME/data（知识库全局共享，见 LIMITATIONS §七），
  // 与第 3 段同款 [全局] 标注——多仓库用户勿误读为「本仓库健康」。
  console.log('\n── Ontology 完整性检查 [全局 data/knowledge/，非当前仓库] ──');
  try {
    const entitiesDir = join(resolveKnowledgeDir(), 'entities');
    const LEGAL_RELATION_KEYS = ['has_many', 'belongs_to', 'depends_on', 'produces', 'consumes'];
    let ontologyIssues = 0;
    let warnReported = 0; // doctor 侧 WARN 计数（对账基准）

    if (existsSync(entitiesDir)) {
      const entityFiles = readdirSync(entitiesDir).filter((f) => f.endsWith('.md'));
      for (const file of entityFiles) {
        const filePath = join(entitiesDir, file);
        let content: string;
        try {
          content = readFileSync(filePath, 'utf-8');
        } catch (err) {
          warn(`Ontology 实体不可读: ${filePath} (${err instanceof Error ? err.message : String(err)})`);
          repairHint('检查文件权限（chmod 644 <实体文件>），或删除损坏文件后从备份恢复');
          warnReported++;
          continue;
        }
        // ① `---` 分隔符存在
        const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
        const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch || !fmMatch[1]) {
          warn(`Ontology 实体缺少 frontmatter（--- 分隔符）: ${filePath}——该实体已被合并逻辑跳过，Ontology 缺失此对象`);
          repairHint('在文件开头补 frontmatter，模板：---\\ntitle: 实体名\\ntype: entity\\nrelations:\\n  has_many: [其他实体]\\n---（字段说明见 CHANGELOG v1.0.1「页面 frontmatter」节）');
          warnReported++;
          continue;
        }
        // ② YAML 可解析
        let fm: Record<string, unknown> | null = null;
        try {
          fm = yamlLoad(fmMatch[1]) as Record<string, unknown>;
        } catch (yamlErr) {
          const line = yamlErr instanceof YAMLException && yamlErr.mark?.line != null ? yamlErr.mark.line + 1 : '?';
          warn(`Ontology 实体 frontmatter YAML 语法错误: ${filePath}（第 ${line} 行附近）——该实体已被合并逻辑跳过`);
          repairHint('修正 frontmatter YAML 语法（冒号后补空格 / 引号包裹特殊字符），字段说明见 CHANGELOG v1.0.1「页面 frontmatter」节');
          warnReported++;
          continue;
        }
        // ③ relations 字段名合法（拼写错 = 关联被静默丢弃）
        if (fm && typeof fm === 'object' && fm['relations'] !== undefined) {
          const rel = fm['relations'];
          if (rel === null || typeof rel !== 'object' || Array.isArray(rel)) {
            warn(`Ontology 实体 relations 字段类型错误（应为映射对象）: ${filePath}——关联信息被合并逻辑忽略`);
            repairHint('relations 应为映射：relations:\\n  has_many: [其他实体]\\n  belongs_to: [父实体]，合法键：has_many / belongs_to / depends_on / produces / consumes');
            warnReported++;
          } else {
            const illegalKeys = Object.keys(rel as Record<string, unknown>).filter(
              (k) => !LEGAL_RELATION_KEYS.includes(k),
            );
            if (illegalKeys.length > 0) {
              warn(`Ontology 实体 relations 含非法字段名（${illegalKeys.join(', ')}）: ${filePath}——拼写错误的关联被静默丢弃，合法键：${LEGAL_RELATION_KEYS.join(' / ')}`);
              repairHint('修正 relations 字段拼写（合法键：has_many / belongs_to / depends_on / produces / consumes），字段说明见 CHANGELOG v1.0.1「页面 frontmatter」节');
              warnReported++;
            }
          }
        }
      }
      ontologyIssues = warnReported;
    } else {
      // entities/ 不存在是正常形态（全新安装/未沉淀知识）——info 不告警
      info('knowledge/entities/ 目录不存在（未沉淀知识实体，跳过 Ontology 检查）');
    }

    // 对账：merge-engine 落盘的 skip-log.json vs doctor 侧报告数
    const skipLogPath = join(resolveDataDir(), 'ontology', 'skip-log.json');
    if (existsSync(skipLogPath)) {
      try {
        const skipLog = JSON.parse(readFileSync(skipLogPath, 'utf-8')) as { mergedAt?: string; scanned?: number; skipped?: Array<{ file?: string; reason?: string }> };
        const skipCount = Array.isArray(skipLog.skipped) ? skipLog.skipped.length : 0;
        if (skipCount === warnReported) {
          ok(`跳过对账一致（合并逻辑跳过 ${skipCount} = doctor 报告 ${warnReported}）`);
        } else {
          warn(`跳过对账不一致：合并逻辑 skip-log.json 记录 ${skipCount} 条跳过，doctor 本次报告 ${warnReported} 条——两次读取之间文件可能已变化，或合并逻辑未重跑（运行 sofagent-ontology merge 刷新）`);
          repairHint('sofagent-ontology merge');
        }
      } catch (err) {
        warn(`skip-log.json 读取失败: ${err instanceof Error ? err.message : String(err)}`);
        repairHint('sofagent-ontology merge（重新生成 skip-log.json）');
      }
    }
    // 有实体且全健康时显式 ok（避免「静默通过」与「没检查」不可区分——对齐 v1.3.5 #18 先例）
    if (existsSync(entitiesDir) && ontologyIssues === 0) {
      ok('Ontology 实体 frontmatter 全部合规（三查通过：分隔符 / YAML / relations 字段）');
    }
  } catch (err) {
    warn(`Ontology 完整性检查异常（已跳过，不影响其余检查）: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 规范关联覆盖率（纯展示——让「多少代码变更是规范驱动的」从不可见变为可运营数字）
  console.log('\n── 规范先行覆盖率（纯展示）──');
  try {
    const recent = execFileSync('git', ['log', '-30', '--pretty=format:%H%x09%s'], { cwd: projectDir, encoding: 'utf8' })
      .trim().split('\n').filter((l) => l.length > 0);
    let codeCommits = 0, compliant = 0, exempted = 0;
    for (const line of recent) {
      const idx = line.indexOf('\t');
      const sha = line.slice(0, idx), subject = line.slice(idx + 1);
      if (/^Merge (branch|pull request|remote-tracking)/i.test(subject)) continue;
      let files = '';
      try {
        files = execFileSync('git', ['show', '--name-only', '--pretty=format:', sha], { cwd: projectDir, encoding: 'utf8' });
      } catch { continue; }
      if (!/^engine\/[^/]+\/src\//m.test(files)) continue;
      codeCommits++;
      if (/\bspec:\s*\S+/.test(subject)) compliant++;
      else if (/\bno-spec:\s*\S+/.test(subject)) exempted++;
    }
    if (codeCommits === 0) {
      info('近 30 条 commit 无 engine/*/src 代码变更——spec 覆盖率不适用');
    } else {
      const rate = Math.round(((compliant + exempted) / codeCommits) * 100);
      ok(`规范关联覆盖率 ${rate}%（近 30 条：代码提交 ${codeCommits}，spec: 标记 ${compliant}，no-spec: 豁免 ${exempted}，无标记 ${codeCommits - compliant - exempted}）`);
    }
  } catch (err) {
    info(`spec 覆盖率统计不可用（非 git 仓库或 git 不可用）：${err instanceof Error ? err.message : String(err)}`);
  }

  // daemon 守护感知（v1.4.4 #32+47——doctor 与 daemon 读同一路径健康文件）
  // 注：core 不依赖 daemon 包（依赖方向 daemon → core 单向），此处自读文件。
  // 路径用 resolveDataDir()（运行时重解析——尊重 SOFAGENT_DATA/SOFAGENT_HOME 沙箱），
  // 与 daemon 侧 resolveHealthFilePath()（SOFAGENT_DATA || DATA_DIR）同源口径。
  console.log('\n── daemon 守护状态 ──');
  try {
    const daemonHealthPath = join(resolveDataDir(), 'daemon-health.json');
    if (existsSync(daemonHealthPath)) {
      try {
        const dh = JSON.parse(readFileSync(daemonHealthPath, 'utf-8')) as {
          status?: string; lastExitCode?: number; stoppedReason?: string; lastHeartbeat?: string;
          startTime?: string; pid?: number;
        };
        const heartbeatStale = !dh.lastHeartbeat || (Date.now() - new Date(dh.lastHeartbeat).getTime()) > 10 * 60 * 1000;
        if (dh.lastExitCode !== undefined && dh.lastExitCode !== 0 && heartbeatStale) {
          fail(`daemon 守护已死亡（exit ${dh.lastExitCode}${dh.stoppedReason ? `，原因 ${dh.stoppedReason}` : ''}——最后心跳 ${dh.lastHeartbeat}）`);
          repairHint('sofagent-daemon start（重启守护进程）；若反复 exit 78 查看启动日志定位致命错误');
        } else if (dh.status === 'stopped' || heartbeatStale) {
          warn(`daemon 已停止运行（最后心跳 ${dh.lastHeartbeat ?? '无'}${dh.lastExitCode !== undefined ? `，exit ${dh.lastExitCode}` : ''}）`);
          repairHint('sofagent-daemon start（按需重启守护进程）');
        } else if (dh.status === 'degraded') {
          warn(`daemon 降级运行中（PID ${dh.pid ?? '?'}）`);
          repairHint('sofagent-daemon doctor（查看降级原因）');
        } else {
          ok(`daemon 运行正常（PID ${dh.pid ?? '?'}，最后心跳 ${dh.lastHeartbeat}）`);
        }
      } catch (parseErr) {
        warn(`daemon-health.json 解析失败: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
        repairHint('sofagent-daemon start（下次心跳写入会覆盖修复）');
      }
    } else {
      info('daemon 从未运行过（daemon-health.json 不存在）——审计核心功能不依赖守护，按需 sofagent-daemon start');
    }
  } catch (err) {
    info(`daemon 状态检查异常（已跳过）: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 总结（v1.2.9: — 有 WARN/FAIL 时不再说"全部通过"）
  const allOk = env.allOk && configOk && dirsOk && hookOk && depsOk && distIntegrityOk && auditLogOk;
  console.log('\n── 健康检查结果 ──');
  if (_failCount > 0) {
    console.log(`  ❌ ${_failCount} 项失败，${_warnCount} 项警告（详见上方）\n`);
  } else if (_warnCount > 0) {
    console.log(`  ⚠️  ${_warnCount} 项警告，其余通过（详见上方，不影响核心审计功能则无需处理）\n`);
  } else {
    console.log('  ✅ 全部通过\n');
  }

  return {
    env: env.allOk,
    config: configOk,
    dataDirs: dirsOk,
    hook: hookOk,
    deps: depsOk,
    auditLog: auditLogOk,
    allOk,
    warnCount: _warnCount,
    failCount: _failCount,
  };
}

// ============================================================
// v1.2.7: --repair 模式
// ============================================================

/**
 * v1.2.7: 带 --repair 模式的 doctor 运行入口。
 *
 * repair=true 时自动执行可自动修复的项：
 *   - ~/.sofagent 不存在 → 创建目录
 *   - commit-msg hook 缺失 → sofagent-audit --install-hook
 *   - HMAC 密钥缺失 → sofagent-audit --init
 *   - js-yaml 未安装 → npm install js-yaml
 *
 * repair=false 时等价于 runDoctor()
 *
 * @param projectDir 项目根目录
 * @param repair 是否自动修复
 * @param options v1.3.5：resetBaseline 透传给 runDoctor（--reset-baseline flag）
 * @returns DoctorReport
 */
export function runDoctorWithRepair(projectDir: string = process.cwd(), repair: boolean = false, options: { resetBaseline?: boolean } = {}): DoctorReport {
  if (repair) {
    console.log('\n  sofagent doctor --repair v' + VERSION + '\n');
    console.log('  检查目录: ' + projectDir + '\n');
    console.log('── 自动修复模式 ──\n');

    let repairsApplied = 0;

    // 1. ~/.sofagent 不存在 → 创建
    // 引导期初始化也走 SSOT 入口（白名单防护生效）；引导语义不变
    // （~/.sofagent 不存在时创建骨架目录）；data/internal 子目录路径
    // 一律取自 data-paths SSOT（resolveDataDir），禁手拼 join(home, 'data')
    const home = resolveHomeDir();
    if (!existsSync(home)) {
      try {
        mkdirSync(home, { recursive: true, mode: 0o700 });
        mkdirSync(resolveDataDir(), { recursive: true, mode: 0o700 });
        mkdirSync(join(home, 'internal'), { recursive: true, mode: 0o700 });
        ok('~/.sofagent 已自动创建');
        repairsApplied++;
      } catch (err) {
        fail(`创建 ~/.sofagent 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. js-yaml 未安装 → npm install(改用 require.resolve 检测）
    let jsYamlInstalled = false;
    try {
      require.resolve('js-yaml');
      jsYamlInstalled = true;
    } catch {
      try {
        const cwdRequire = require('module').createRequire(join(projectDir, 'package.json'));
        cwdRequire.resolve('js-yaml');
        jsYamlInstalled = true;
      } catch {
        // both resolve paths failed
      }
    }
    if (!jsYamlInstalled) {
      warn('js-yaml 未安装——请手动运行: npm install js-yaml');
    }

    // 3. HMAC 密钥缺失 → 提示运行 --init（不自动执行，因为会重置审计链）
    const keyPath = join(homedir(), '.sofagent-key');
    if (!existsSync(keyPath)) {
      info('HMAC 密钥缺失——建议运行 sofagent-audit --init 生成');
      // 不自动执行 --init（会重置审计链，需用户确认）
    }

    console.log(`\n── 修复完成（${repairsApplied} 项自动修复）──\n`);
  }

  // 运行完整检查（无论是否 repair）
  return runDoctor(projectDir, options);
}

// ============================================================
// v1.5.3 章四 · doctor --refresh（Omarchy refresh 模式收编）
// ------------------------------------------------------------
// 「检查→一键修复」闭环：doctor 检出可修复项后，`--refresh` 执行三段——
//   ① 备份：当前 .sofagent/config.yml → 备份目录（时间戳命名）
//   ② 重置：写入 CONFIG_TEMPLATE 默认配置
//   ③ 报告：前后 diff（逐行对照）+ 数据目录体检（消费 engine/scripts/cleanup.sh
//      --report，F-25 只读体检——勿在此重复实现）
// 修复动作全程审计留痕：每段写 decision-log（kind=CONFIG_CHANGE，moment=ACT，
// evidence 载备份路径/重置目标/diff 摘要）。**回滚语义**：refresh 自带回滚 = 最近
// N 份备份自动保留（默认 3，SOFAGENT_REFRESH_KEEP 覆盖）——手工回滚即把备份拷回；
// 与 skillopt「deprecate 的回滚」是两回事（后者是 registry 侧 npm 反命令）。
// 边界：只刷新**项目级**配置（.sofagent/config.yml）；全局 ~/.sofagent/ 不动
// （含审计历史/HMAC 密钥——refresh 永不触碰活链）。
// ============================================================

/** refresh 备份目录（项目级 .sofagent/backups/config/）内保留的份数上限 */
const REFRESH_KEEP_DEFAULT = 3;

/** refresh 结果（三段各自成败 + 落点，供 CLI/测试消费） */
export interface DoctorRefreshResult {
  /** 是否整体成功（三段全成） */
  ok: boolean;
  /** ① 备份段：备份文件绝对路径；未执行（无既有配置）= null */
  backupPath: string | null;
  /** ② 重置段：写回的配置文件绝对路径 */
  configPath: string;
  /** ③ 报告段：diff 行统计（added/removed/unchanged） */
  diff: { added: number; removed: number; unchanged: number };
  /** 备份目录清理后的保留份数（含本次） */
  backupsKept: number;
  /** 体检段输出行数（cleanup.sh --report 消费；-1 = 脚本不可用已告警） */
  healthReportLines: number;
  /** 留痕写入的 decision 条目 ts（audit 侧回查锚）；留痕失败不阻断但如实置 null */
  decisionTs: string | null;
}

/**
 * 计算两段文本的行级 diff 统计（LCS 免实现——refresh 报告只需计数 + 样例行，
 * 逐行集合比对足够：added = 新有旧无，removed = 旧有新无，其余 unchanged 近似）。
 */
function lineDiffStats(oldText: string, newText: string): { added: number; removed: number; unchanged: number; addedSamples: string[]; removedSamples: string[] } {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const oldSet = new Map<string, number>();
  for (const l of oldLines) oldSet.set(l, (oldSet.get(l) ?? 0) + 1);
  const newSet = new Map<string, number>();
  for (const l of newLines) newSet.set(l, (newSet.get(l) ?? 0) + 1);
  let added = 0;
  let removed = 0;
  const addedSamples: string[] = [];
  const removedSamples: string[] = [];
  for (const [line, n] of newSet) {
    const have = oldSet.get(line) ?? 0;
    if (n > have) {
      added += n - have;
      if (addedSamples.length < 5 && line.trim()) addedSamples.push(line.trim().slice(0, 60));
    }
  }
  for (const [line, n] of oldSet) {
    const have = newSet.get(line) ?? 0;
    if (n > have) {
      removed += n - have;
      if (removedSamples.length < 5 && line.trim()) removedSamples.push(line.trim().slice(0, 60));
    }
  }
  const unchanged = Math.max(0, Math.min(oldLines.length, newLines.length) - Math.min(added, removed));
  return { added, removed, unchanged, addedSamples, removedSamples };
}

/**
 * v1.5.3 章四：doctor --refresh 三段执行（备份 → 重置默认 → diff 报告）。
 *
 * 审计留痕：三段各写一条 decision（CONFIG_CHANGE / ACT）；留痕失败**不阻断**
 * refresh（与 audit-middleware 的「决策日志失败不影响工具执行」同容错铁律），
 * 但 decisionTs=null 如实暴露。
 *
 * @param projectDir 项目根目录（默认 cwd）
 * @param deps 依赖注入（测试用）：now 时间源 / writeDecision 留痕面
 * @returns 三段结果（见 {@link DoctorRefreshResult}）
 */
export function runDoctorRefresh(
  projectDir: string = process.cwd(),
  deps: {
    now?: () => Date;
    writeDecision?: (entry: { ts: string; why: string; evidence: string[] }) => void;
  } = {},
): DoctorRefreshResult {
  const now = deps.now ?? (() => new Date());
  const writeDecision =
    deps.writeDecision ??
    (() => {
      /* 为何可静默：默认无注入时尝试动态接入 audit 留痕（见下方 tryImport）；接不进则留 decisionTs=null——留痕缺失在返回值显式可见，不是吞错 */
    });
  void writeDecision; // 注入面保留（真实写入在下方 tryImport 段）

  const stamp = now();
  const ts = stamp.toISOString();
  const configDir = join(projectDir, '.sofagent');
  const configPath = join(configDir, 'config.yml');
  const backupDir = join(configDir, 'backups', 'config');

  console.log(`\n  sofagent doctor --refresh v${VERSION}\n`);
  console.log(`  目标: ${configPath}\n`);

  // ── ① 备份段 ──
  let backupPath: string | null = null;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  // 时间戳含**毫秒**（+ 同毫秒碰撞追加 _NN 序号）：避免同秒双跑互相覆盖——
  // 秒级命名下第二轮会覆写第一轮备份。固定宽度 ⇒ 字典序仍 = 时间序
  // （保留策略「删最旧」按字典序，依赖此性质；`_`(0x5F) > `.`(0x2E) ⇒ 序号名
  // 排在基名之后，分钟/毫秒进位亦不乱序）。
  const backupBase = `config-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}${pad(stamp.getMilliseconds(), 3)}`;
  if (existsSync(configPath)) {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    // 同名（同毫秒碰撞）→ 追加 _NN；`_` > `.` 保证时间序不乱
    let backupName = `${backupBase}.yml`;
    let seq = 1;
    while (existsSync(join(backupDir, backupName))) {
      seq += 1;
      backupName = `${backupBase}_${pad(seq)}.yml`;
    }
    backupPath = join(backupDir, backupName);
    const existing = readFileSync(configPath, 'utf-8');
    writeFileSync(backupPath, existing, 'utf-8');
    ok(`已备份当前配置 → ${backupPath}`);
  } else {
    info('无既有 config.yml（首次初始化形态）——跳过备份段');
  }

  // ── ② 重置段（默认模板覆写） ──
  const oldText = backupPath ? readFileSync(backupPath, 'utf-8') : '';
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath, CONFIG_TEMPLATE, 'utf-8');
  ok(`已重置为默认配置（CONFIG_TEMPLATE v${VERSION}）→ ${configPath}`);

  // ── ③ 报告段（前后 diff + 体检） ──
  const newText = readFileSync(configPath, 'utf-8');
  const stats = lineDiffStats(oldText, newText);
  console.log('\n── 前后 diff ──');
  if (!backupPath) {
    info('无旧配置可比（全新生成）');
  } else {
    console.log(`  +${stats.added} 行新增 / -${stats.removed} 行移除 / ≈${stats.unchanged} 行保留`);
    for (const s of stats.removedSamples) console.log(`    - ${s}`);
    for (const s of stats.addedSamples) console.log(`    + ${s}`);
  }

  // 体检段：消费 cleanup.sh --report（F-25 只读体检——单一事实源，勿重复实现）
  let healthReportLines = -1;
  const cleanupScript = join(projectDir, 'engine', 'scripts', 'cleanup.sh');
  if (existsSync(cleanupScript)) {
    try {
      const report = execFileSync('bash', [cleanupScript, '--report'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const lines = report.split('\n').filter((l) => l.length > 0).length;
      healthReportLines = lines;
      console.log(`\n── 数据目录体检（cleanup.sh --report · 只读）──`);
      // 摘要行（体检总计 + 可回收合计）透传，全量报告引导用户自跑
      for (const line of report.split('\n')) {
        if (line.includes('体检总计') || line.includes('疑似可回收:')) console.log(`  ${line.replace(/^\[cleanup\]\s*/, '')}`);
      }
      console.log(`  （全量报告 ${lines} 行：bash engine/scripts/cleanup.sh --report）`);
    } catch (err) {
      warn(`数据目录体检执行失败（不影响 refresh 结果）: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    info('engine/scripts/cleanup.sh 不存在——体检段跳过（repo 布局差异）');
  }

  // ── 备份保留策略（最近 N 份，默认 3）──
  let backupsKept = backupPath ? 1 : 0;
  try {
    const keepRaw = Number(process.env.SOFAGENT_REFRESH_KEEP);
    const keep = Number.isFinite(keepRaw) && keepRaw > 0 ? Math.floor(keepRaw) : REFRESH_KEEP_DEFAULT;
    if (existsSync(backupDir)) {
      const backups = readdirSync(backupDir)
        .filter((f) => f.startsWith('config-') && f.endsWith('.yml'))
        .sort(); // 时间戳命名 ⇒ 字典序 = 时间序
      const excess = backups.slice(0, Math.max(0, backups.length - keep));
      for (const f of excess) {
        rmSync(join(backupDir, f), { force: true });
      }
      backupsKept = Math.min(backups.length, keep);
      if (excess.length > 0) {
        info(`备份保留策略：保留最近 ${keep} 份（清理 ${excess.length} 份旧备份）`);
      } else {
        info(`备份保留策略：当前 ${backups.length} 份 ≤ ${keep}，无需清理`);
      }
    }
  } catch (err) {
    warn(`备份保留清理失败（不影响 refresh 结果）: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 审计留痕（decision-log · CONFIG_CHANGE）──
  // 动态接入 audit 侧 emitDecision（core 不依赖 audit——依赖方向单向 audit→core，
  // 故此处 require.resolve 试探 + 失败降级 decisionTs=null，如实暴露不吞）。
  let decisionTs: string | null = null;
  if (deps.writeDecision) {
    try {
      deps.writeDecision({ ts, why: 'doctor --refresh 重置项目配置', evidence: [`backup=${backupPath ?? 'none'}`, `target=${configPath}`, `diff=+${stats.added}/-${stats.removed}`] });
      decisionTs = ts;
    } catch (err) {
      warn(`决策留痕失败（注入面，不阻断 refresh）: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    try {
      // CJS：createRequire 从 cwd 出发解析 @sofagent/audit（monorepo / 全局安装均可命中）
      const cwdRequire = require('module').createRequire(join(projectDir, 'package.json'));
      // package.json 缺失时 createRequire 仍可用（以该路径为基准解析 node_modules）
      const auditMod = cwdRequire('@sofagent/audit') as {
        emitDecision?: (input: Record<string, unknown>) => { ts: string };
      };
      if (typeof auditMod.emitDecision === 'function') {
        const entry = auditMod.emitDecision({
          agentId: 'sofagent-doctor',
          sessionId: `refresh-${ts}`,
          kind: 'CONFIG_CHANGE',
          moment: 'ACT',
          category: 'select',
          why: { text: 'doctor --refresh 重置项目配置（备份→默认→diff 报告）', tags: ['doctor', 'refresh'] },
          evidence: [`backup=${backupPath ?? 'none'}`, `target=${configPath}`, `diff=+${stats.added}/-${stats.removed}`, `kept=${backupsKept}`],
        });
        decisionTs = entry.ts;
        ok(`审计留痕已写入 decision-log（ts=${ts}，kind=CONFIG_CHANGE）`);
      } else {
        warn('审计留痕面缺失（@sofagent/audit 未导出 emitDecision）——decisionTs=null');
      }
    } catch (err) {
      warn(`审计留痕不可用（@sofagent/audit 不可解析——decisionTs=null）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n── refresh 完成 ──`);
  console.log(`  备份: ${backupPath ?? '（无既有配置）'} · 保留 ${backupsKept} 份`);
  console.log(`  回滚: cp ${backupPath ?? '<备份文件>'} ${configPath}`);

  return {
    ok: true,
    backupPath,
    configPath,
    diff: { added: stats.added, removed: stats.removed, unchanged: stats.unchanged },
    backupsKept,
    healthReportLines,
    decisionTs,
  };
}

// 直接运行时执行
if (process.argv[1]?.includes('doctor')) {
  // v1.5.3 章四：--refresh 三段（备份 → 重置 → diff 报告）；与只读检查分流
  if (process.argv.includes('--refresh')) {
    const refresh = runDoctorRefresh(process.cwd());
    process.exit(refresh.ok ? 0 : 1);
  }
  const report = runDoctor(process.cwd(), {
    // v1.3.5：--reset-baseline 单独跑（不带 --doctor）经 audit CLI 路由到
    // 本文件执行时，flag 原样透传（resetBaseline 路径与正常 doctor 一致）
    resetBaseline: process.argv.includes('--reset-baseline'),
  });
  process.exit(report.allOk ? 0 : 1);
}
