#!/usr/bin/env node
// doctor.ts · sofagent 健康检查
// v1.3.7 新增：从 sofagent-audit --doctor 迁移至 @sofagent/core
// v1.3.7 维护：新增 post-commit hook 存在性检查
// v1.3.7 新增：每项 fail/warn 附修复命令 + --repair 自动修复模式
//
// 检查项：
//   1. 环境检查（Node / git / npm / disk / bash）
//   2. 配置检查（.sofagent/config.yml 是否存在且有效）
//   3. 数据目录结构（v1.4.5：data/ 用户可见数据 + .sofagent/ 引擎内部状态）
//   4. Hook 状态（commit-msg 是否安装含 sofagent 标识 + post-commit 是否存在）
//   5. 包完整性（node_modules 依赖）
//   8. Ontology 完整性（v1.4.3 十三：knowledge/entities/ frontmatter 三查 + skip-log 对账）
//
// 注意：post-commit 仅检查存在性——不检查内容是否引用 sofagent

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { checkEnv } from './env-check';
import { VERSION } from './shared/constants';
import { load as yamlLoad, YAMLException } from 'js-yaml';
import { checkHistoryChainDetailed, validateHmacKey } from './audit-history';
import { DATA_DIR, getConfigFile, resolveDataDir, resolveHomeDir, resolveKnowledgeDir } from './data-paths';

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); _warnCount++; }
function fail(msg: string) { console.log(`  ❌ ${msg}`); _failCount++; }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }

// v1.2.9: — 计数器，用于结尾诚实汇总
let _warnCount = 0;
let _failCount = 0;

/** v1.2.7: 修复提示输出 */
function repairHint(cmd: string) { console.log(`     修复：${cmd}`); }

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
    if (existsSync(homeVersionFile)) {
      const installedVersion = readFileSync(homeVersionFile, 'utf-8').trim();
      if (installedVersion !== VERSION) {
        warn(`~/.sofagent/VERSION 写的是 ${installedVersion}，当前引擎 ${VERSION}——可能发版后未同步`);
        repairHint(`重新安装以同步版本：bash install.sh（或手动更新 ${homeVersionFile}）`);
        // v1.3.9 补充升级安全性：消除企业 IT 对「升级覆盖数据」的顾虑——
        // 升级保留用户数据与已装 hooks（不覆盖 ~/.sofagent/data/ 与已装 hooks），
        // 破坏性变更见 CHANGELOG 对应版本条目。
        info('升级保留 ~/.sofagent/data/ 与已装 hooks（不覆盖用户数据）；破坏性变更见 CHANGELOG 对应版本条目');
      } else {
        ok(`~/.sofagent/VERSION (${installedVersion}) 与引擎版本一致`);
      }
    } else {
      warn('~/.sofagent/VERSION 不存在——可能是首次安装或旧版本残留');
      repairHint('重新运行 install.sh 创建 VERSION 文件');
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
    const gitDirResult = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
        if (hookContent.includes('sofagent')) {
          ok('commit-msg hook 已安装并包含 sofagent');
          hookOk = true;
        } else {
          warn('commit-msg hook 存在但不包含 sofagent 标识');
          repairHint('sofagent-audit --install-hook');
        }
      } catch (err) {
        warn(`commit-msg hook 存在但无法读取: ${err instanceof Error ? err.message : String(err)}`);
        repairHint(`检查文件权限（chmod 755 ${hookPath}）`);
      }
    } else {
      warn('commit-msg hook 未安装——审计不会运行！运行 sofagent-audit --install-hook 安装');
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
      warn('pre-commit hook 未安装——.sofagent/ 入库主防线缺失。运行 sofagent-audit --install-hook 补装');
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
      // require.resolve 从 doctor.ts 编译后的位置（引擎包 dist/ 内）向上查找
      // node_modules，不受 cwd 影响——修复非仓库目录运行 --doctor 时误报依赖缺失。
      // CJS 环境下 require 全局可用，直接调用 require.resolve。
      require.resolve(dep);
      ok(`${dep} 已安装`);
    } catch {
      // 引擎包内解析失败 → 尝试从 cwd 解析（workspace 场景）
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
  //   ② 发布安装：require.resolve('@sofagent/audit') 反推 audit 包根，再拼 dist/index.js
  //   ③ 两者均不存在 → 显式 warn（不再静默跳过——「检查不到」不等于「通过」）
  let auditDistPath = join(__dirname, '..', '..', 'audit', 'dist', 'index.js');
  if (!existsSync(auditDistPath)) {
    try {
      // CJS 环境下 require 全局可用（与上方依赖检查同一先例）；
      // 从 core 包位置出发解析 audit 包，兼容任意 node_modules 嵌套深度。
      auditDistPath = join(dirname(require.resolve('@sofagent/audit')), 'dist', 'index.js');
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
        try {
          const hashDir = join(hashRecordPath, '..');
          if (!existsSync(hashDir)) mkdirSync(hashDir, { recursive: true, mode: 0o700 });
          writeFileSync(hashRecordPath, currentHash + '\n', { mode: 0o600 });
          ok(`✅ 基准哈希已重置（SHA-256: ${currentHash.slice(0, 8)}…）`);
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
    ok('已配置 HMAC 密钥（~/.sofagent-key，≥16 字节），审计日志使用 HMAC-SHA256 强校验');
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

  // 8. Ontology 完整性检查（v1.4.3 十三）
  // 背景：LIMITATIONS §七多年披露——entities/ frontmatter 格式不规范时实体被合并引擎
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
          warn(`Ontology 实体缺少 frontmatter（--- 分隔符）: ${filePath}——该实体已被合并引擎跳过，Ontology 缺失此对象`);
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
          warn(`Ontology 实体 frontmatter YAML 语法错误: ${filePath}（第 ${line} 行附近）——该实体已被合并引擎跳过`);
          repairHint('修正 frontmatter YAML 语法（冒号后补空格 / 引号包裹特殊字符），字段说明见 CHANGELOG v1.0.1「页面 frontmatter」节');
          warnReported++;
          continue;
        }
        // ③ relations 字段名合法（拼写错 = 关联被静默丢弃）
        if (fm && typeof fm === 'object' && fm['relations'] !== undefined) {
          const rel = fm['relations'];
          if (rel === null || typeof rel !== 'object' || Array.isArray(rel)) {
            warn(`Ontology 实体 relations 字段类型错误（应为映射对象）: ${filePath}——关联信息被合并引擎忽略`);
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
          ok(`跳过对账一致（合并引擎跳过 ${skipCount} = doctor 报告 ${warnReported}）`);
        } else {
          warn(`跳过对账不一致：合并引擎 skip-log.json 记录 ${skipCount} 条跳过，doctor 本次报告 ${warnReported} 条——两次读取之间文件可能已变化，或合并引擎未重跑（运行 sofagent-ontology merge 刷新）`);
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
    // run-07 verdict P1-3：同批收口——引导期初始化也走 SSOT 入口（白名单防护生效）；
    // 引导语义不变（~/.sofagent 不存在时创建骨架目录）。
    const home = resolveHomeDir();
    if (!existsSync(home)) {
      try {
        mkdirSync(home, { recursive: true, mode: 0o700 });
        mkdirSync(join(home, 'data'), { recursive: true, mode: 0o700 });
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

// 直接运行时执行
if (process.argv[1]?.includes('doctor')) {
  const report = runDoctor(process.cwd(), {
    // v1.3.5：--reset-baseline 单独跑（不带 --doctor）经 audit CLI 路由到
    // 本文件执行时，flag 原样透传（resetBaseline 路径与正常 doctor 一致）
    resetBaseline: process.argv.includes('--reset-baseline'),
  });
  process.exit(report.allOk ? 0 : 1);
}
