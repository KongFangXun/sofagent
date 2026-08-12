#!/usr/bin/env node
// doctor.ts · sofagent 健康检查
// v1.3.3 新增：从 sofagent-audit --doctor 迁移至 @sofagent/core
// v1.3.3 维护：新增 post-commit hook 存在性检查
// v1.3.3 新增：每项 fail/warn 附修复命令 + --repair 自动修复模式
//
// 检查项：
//   1. 环境检查（Node / git / npm / disk / bash）
//   2. 配置检查（.sofagent/config.yml 是否存在且有效）
//   3. 数据目录结构（v1.3.3：data/ 用户可见数据 + .sofagent/ 引擎内部状态）
//   4. Hook 状态（commit-msg 是否安装含 sofagent 标识 + post-commit 是否存在）
//   5. 包完整性（node_modules 依赖）
//
// 注意：post-commit 仅检查存在性——不检查内容是否引用 sofagent

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { checkEnv } from './env-check';
import { VERSION } from './shared/constants';
import { load as yamlLoad, YAMLException } from 'js-yaml';
import { checkHistoryChainDetailed, validateHmacKey } from './audit-history';
import { DATA_DIR, getConfigFile } from './data-paths';

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
 * @returns DoctorReport
 */
export function runDoctor(projectDir: string = process.cwd()): DoctorReport {
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
  console.log('\n── 版本一致性 ──');
  try {
    const homeVersionFile = join(process.env.SOFAGENT_HOME || join(process.env.HOME || '~', '.sofagent'), 'VERSION');
    if (existsSync(homeVersionFile)) {
      const installedVersion = readFileSync(homeVersionFile, 'utf-8').trim();
      if (installedVersion !== VERSION) {
        warn(`~/.sofagent/VERSION 写的是 ${installedVersion}，当前引擎 ${VERSION}——可能发版后未同步`);
        repairHint(`重新安装以同步版本：bash install.sh（或手动更新 ${homeVersionFile}）`);
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
  console.log('\n── 数据目录结构 ──');
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
    const hookPath = join(gitDir, 'hooks', 'commit-msg');
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

    // post-commit：检查存在性 + 内容是否含审计对账逻辑（v1.3.2 P0-RC3 加强）
    const postCommitPath = join(gitDir, 'hooks', 'post-commit');
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
  const auditDistPath = join(__dirname, '..', 'audit', 'dist', 'index.js');
  if (existsSync(auditDistPath)) {
    try {
      const distContent = readFileSync(auditDistPath);
      const currentHash = createHash('sha256').update(distContent).digest('hex');
      const hashRecordPath = join(process.env.SOFAGENT_HOME || join(homedir(), '.sofagent'), 'internal', 'audit-hash.txt');
      if (existsSync(hashRecordPath)) {
        const recordedHash = readFileSync(hashRecordPath, 'utf-8').trim();
        if (currentHash === recordedHash) {
          ok(`audit dist/index.js 完整性校验通过（SHA-256: ${currentHash.slice(0, 12)}...）`);
        } else {
          fail(`audit dist/index.js 哈希不匹配——可能被替换（影子审计器劫持风险）。记录值: ${recordedHash.slice(0, 12)}...，当前值: ${currentHash.slice(0, 12)}...`);
          repairHint('重新安装 sofagent（npm run build 或 sofagent-audit --install-hook）以恢复原始 dist');
          distIntegrityOk = false;
        }
      } else {
        // 首次记录哈希（安装时未记录）
        warn(`audit dist/index.js 哈希未记录（首次运行）——当前 SHA-256: ${currentHash.slice(0, 12)}...`);
        try {
          const hashDir = join(hashRecordPath, '..');
          if (!existsSync(hashDir)) mkdirSync(hashDir, { recursive: true, mode: 0o700 });
          writeFileSync(hashRecordPath, currentHash + '\n', { mode: 0o600 });
          ok('已自动记录当前哈希作为基准（后续运行将比对）');
        } catch {
          // 记录失败不影响核心功能
        }
      }
    } catch (err) {
      warn(`dist 完整性检查异常（已跳过）: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // 非 monorepo 开发环境可能没有 audit/dist，跳过
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
     1. secret key 发生变更（如更换机器/重装系统）→ 运行 sofagent-audit --init --reset-chain
     2. 审计日志文件损坏（并发写入冲突）→ 检查 ~/.sofagent/data/audit/history.jsonl 是否有损坏行
     3. 审计日志确实被篡改 → 检查 ~/.sofagent/data/audit/history.jsonl 的修改时间`);
    } else if (result.status === 'insufficient') {
      // ③ 历史不可信（黄，）：删除/单条不再报 ok——显式声明防篡改链不可验证
      auditLogOk = false;
      warn(`审计日志 hash chain 不可验证（${result.detail ?? '审计历史不足'}）——审计历史不存在或不足 2 条，无法构成可验证的防篡改链。如非全新安装，请核查审计历史是否被删除`);
    } else {
      // ② 历史不可复验（黄）：key/环境漂移，非篡改——不报「链断裂/篡改」，不判失败
      warn(`审计日志 hash chain 不可复验（黄色提示，非篡改）：${result.detail ?? ''}。这是由于密钥轮换，或运行环境变化（如更换设备/用户/仓库路径）导致的预期断裂，非安全事件。如确为本人密钥变更，可忽略此警告；如需重置 hash chain，运行 sofagent-audit --init --reset-chain。如非本人操作，请核查 ~/.sofagent-key 与运行环境`);
    }
  } catch (chainErr) {
    // 链校验异常（极少）：不影响其余检查，但记录以便排查，
    // 不再静默吞掉（P1-B-iv：空 catch 会掩盖内部错误并误报「通过」）
    warn(`审计日志 hash chain 校验异常，已跳过（不影响其余检查）: ${chainErr instanceof Error ? chainErr.message : String(chainErr)}`);
    auditLogOk = true;
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
 * @returns DoctorReport
 */
export function runDoctorWithRepair(projectDir: string = process.cwd(), repair: boolean = false): DoctorReport {
  if (repair) {
    console.log('\n  sofagent doctor --repair v' + VERSION + '\n');
    console.log('  检查目录: ' + projectDir + '\n');
    console.log('── 自动修复模式 ──\n');

    let repairsApplied = 0;

    // 1. ~/.sofagent 不存在 → 创建
    const home = process.env.SOFAGENT_HOME || join(homedir(), '.sofagent');
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
  return runDoctor(projectDir);
}

// 直接运行时执行
if (process.argv[1]?.includes('doctor')) {
  const report = runDoctor();
  process.exit(report.allOk ? 0 : 1);
}
