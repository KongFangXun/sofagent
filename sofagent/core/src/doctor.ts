#!/usr/bin/env node
// doctor.ts · sofagent 健康检查
// v1.1.3 新增：从 sofagent-audit --doctor 迁移至 @sofagent/core
// v1.1.3 维护：新增 post-commit hook 存在性检查
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

  // 3. 数据目录结构
  console.log('\n── 数据目录结构 ──');
  const expectedDirs = ['logs', 'history', 'ontology', 'snapshots'];
  let dirsOk = true;
  if (existsSync(sofagentDir)) {
    for (const dir of expectedDirs) {
      const dirPath = join(sofagentDir, dir);
      if (existsSync(dirPath)) {
        try {
          const files = readdirSync(dirPath).filter((f) => !f.startsWith('.'));
          ok(`${dir}/ (${files.length} 文件)`);
        } catch {
          warn(`${dir}/ (无法读取)`);
        }
      } else {
        info(`${dir}/ 不存在（将在首次运行时自动创建）`);
      }
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
    projectDir.split('/sofagent/')[0] || projectDir,
    'node_modules'
  );

  const criticalDeps = ['js-yaml', 'deepagents'];
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

  // 总结
  const allOk = env.allOk && configOk && dirsOk && hookOk && depsOk;
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
    allOk,
  };
}

// 直接运行时执行
if (process.argv[1]?.includes('doctor')) {
  const report = runDoctor();
  process.exit(report.allOk ? 0 : 1);
}
