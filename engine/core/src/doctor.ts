#!/usr/bin/env node
// doctor.ts · sofagent 健康检查
// v1.2.0 新增：从 sofagent-audit --doctor 迁移至 @sofagent/core
// v1.2.0 维护：新增 post-commit hook 存在性检查
//
// 检查项：
//   1. 环境检查（Node / git / npm / disk / bash）
//   2. 配置检查（.sofagent/config.yml 是否存在且有效）
//   3. 数据目录结构（.sofagent/ 子目录完整性）
//   4. Hook 状态（commit-msg 是否安装含 sofagent 标识 + post-commit 是否存在）
//   5. 包完整性（node_modules 依赖）
//
// 注意：post-commit 仅检查存在性——不检查内容是否引用 sofagent

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { checkEnv } from './env-check';
import { VERSION } from './shared/constants';
import { load as yamlLoad, YAMLException } from 'js-yaml';
import { checkHistoryChainIntegrity } from './audit-history';

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }

export interface DoctorReport {
  env: boolean;
  config: boolean;
  dataDirs: boolean;
  hook: boolean;
  deps: boolean;
  auditLog: boolean;
  allOk: boolean;
}

/**
 * 运行 doctor 健康检查
 * @param projectDir 项目根目录
 * @returns DoctorReport
 */
export function runDoctor(projectDir: string = process.cwd()): DoctorReport {
  console.log(`\n  sofagent doctor v${VERSION}\n`);
  console.log(`  检查目录: ${projectDir}\n`);

  // 1. 环境检查
  console.log('── 环境检查 ──');
  const env = checkEnv();
  if (env.allOk) {
    ok('环境检查通过');
  } else {
    if (!env.node.ok) fail(`Node.js ${env.node.version} (需要 ≥18)`);
    else ok(`Node.js ${env.node.version}`);
    if (!env.git.available) fail('git 不可用');
    else ok('git 可用');
    if (!env.npm.available) fail('npm 不可用');
    else ok('npm 可用');
    if (env.disk.freeMB <= 1024) warn(`磁盘空间不足: ${env.disk.freeMB} MB`);
    else ok(`磁盘空间: ${(env.disk.freeMB / 1024).toFixed(1)} GB`);
    if (!env.openclaw.exists) warn('~/.openclaw 不存在');
    if (!env.sofagent.exists) warn('~/.sofagent 不存在（将自动创建）');
  }

  // 2. 配置检查（v1.1.3: 从「存在」升级为「存在且合法」）
  console.log('\n── 配置检查 ──');
  const sofagentDir = join(projectDir, '.sofagent');
  const configPath = join(sofagentDir, 'config.yml');
  let configOk = false;
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      if (content.trim().length === 0) {
        warn('.sofagent/config.yml 为空');
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
          } else {
            fail(`.sofagent/config.yml 格式错误: ${(yamlErr as Error).message}`);
          }
        }
      }
    } catch {
      fail('.sofagent/config.yml 读取失败');
    }
  } else {
    warn('.sofagent/config.yml 不存在（将使用默认配置）');
  }

  // 3. 数据目录结构（v1.1.3 修复：路径口径与实际运行时一致）
  // v1.1.4 修复：所有运行时目录都是首次使用时自动创建的，全新用户不存在完全正常。
  // 只在目录存在但无法读取时 warn，不存在时完全静默（不报 info 避免噪音）。
  // v1.1.4 起从陈旧的 logs/history/snapshots 修正为实际路径：
  //   - audit/（含 history.jsonl + audit.md，v1.0.8 起审计结果归档在此）
  //   - task/logs/（A7/A8/A15 读取的任务日志目录）
  //   - knowledge/（L1 task 记忆 + shared/ 跨设备共享）
  //   - .git-shadow/（v1.0.8 文件系统审计的 isomorphic-git 隐藏仓库）
  //   - ontology/（本体缓存，v1.1.0+）
  //   - orchestrator/（编排状态，v1.1.3+ Checkpoint 存储）
  console.log('\n── 数据目录结构 ──');
  const expectedDirs = ['audit', 'task/logs', 'knowledge', '.git-shadow', 'ontology', 'orchestrator'];
  let dirsOk = true;
  if (existsSync(sofagentDir)) {
    let existingCount = 0;
    for (const dir of expectedDirs) {
      const dirPath = join(sofagentDir, dir);
      if (existsSync(dirPath)) {
        existingCount++;
        try {
          const files = readdirSync(dirPath).filter((f) => !f.startsWith('.'));
          ok(`${dir}/ (${files.length} 文件)`);
        } catch {
          warn(`${dir}/ (无法读取)`);
          dirsOk = false;
        }
      }
      // 不存在的目录不输出——它们都是运行时自动创建的，全新用户不存在完全正常
    }
    if (existingCount === 0) {
      info('.sofagent/ 已初始化，运行一次审计后将自动创建数据目录');
    }
  } else {
    info('.sofagent/ 目录不存在（运行 sofagent-audit --init 创建）');
    dirsOk = false;
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
        }
      } catch {
        warn('commit-msg hook 存在但无法读取');
      }
    } else {
      info('commit-msg hook 未安装（运行 sofagent-audit --install-hook 安装）');
    }

    // post-commit：仅检查存在性，不检查内容
    const postCommitPath = join(gitDir, 'hooks', 'post-commit');
    if (existsSync(postCommitPath)) {
      ok('post-commit hook 已安装');
    } else {
      info('post-commit hook 未安装（运行 sofagent-audit --init 自动安装）');
    }
  } catch {
    info('非 git 仓库，跳过 hook 检查');
  }

  // 5. 依赖检查
  console.log('\n── 依赖检查 ──');
  let depsOk = true;
  const workspaceDir = join(projectDir, 'node_modules');
  const rootNodeModules = join(
    projectDir.split('/engine/')[0] || projectDir,
    'node_modules'
  );

  const criticalDeps = ['js-yaml', '@langchain/langgraph'];
  for (const dep of criticalDeps) {
    const depPath = join(rootNodeModules, dep);
    if (existsSync(depPath)) {
      ok(`${dep} 已安装`);
    } else {
      // 检查 workspace node_modules
      const wsPath = join(projectDir, 'node_modules', dep);
      if (existsSync(wsPath)) {
        ok(`${dep} 已安装 (workspace)`);
      } else {
        warn(`${dep} 未安装（某些功能可能不可用）`);
        depsOk = false;
      }
    }
  }

  // 6. 审计日志完整性（HMAC 签名 + 链完整性，v1.1.8 新增）
  // 检查两项：① HMAC 密钥是否配置 ② history.jsonl hash chain 是否完整
  console.log('\n── 审计日志完整性 ──');
  const hmacKeyPath = join(homedir(), '.sofagent-key');
  const hasKey = existsSync(hmacKeyPath);

  if (hasKey) {
    ok('已配置 HMAC 密钥（~/.sofagent-key），审计日志使用 HMAC-SHA256 强校验');
  } else {
    warn('无 HMAC 签名，完整性校验强度降低：审计日志仅 SHA-256 校验（Agent 可重算整链）。配置 ~/.sofagent-key 可启用 HMAC-SHA256 强校验');
  }

  // 实际校验链完整性（v1.2.0: checkHistoryChainIntegrity 已下沉到 core，消除 core→audit 反向依赖）
  let auditLogOk = true;
  try {
    const chainIntact = checkHistoryChainIntegrity();
    auditLogOk = chainIntact;
    if (chainIntact) {
      ok('审计日志 hash chain 完整性校验通过');
    } else {
      fail('审计日志 hash chain 断裂——检测到篡改痕迹，请检查 .sofagent/audit/history.jsonl');
    }
  } catch {
    // 链校验异常（极少），不影响其余检查
    auditLogOk = true;
  }

  // 总结
  const allOk = env.allOk && configOk && dirsOk && hookOk && depsOk && auditLogOk;
  console.log('\n── 健康检查结果 ──');
  if (allOk) {
    console.log('  ✅ 全部通过\n');
  } else {
    console.log('  ⚠️  存在问题，详见上方检查项\n');
  }

  return {
    env: env.allOk,
    config: configOk,
    dataDirs: dirsOk,
    hook: hookOk,
    deps: depsOk,
    auditLog: auditLogOk,
    allOk,
  };
}

// 直接运行时执行
if (process.argv[1]?.includes('doctor')) {
  const report = runDoctor();
  process.exit(report.allOk ? 0 : 1);
}
