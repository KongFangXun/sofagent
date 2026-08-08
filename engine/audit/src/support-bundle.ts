// ============================================================
// support-bundle.ts · 一键生成 issue 摘要 + 证据 zip
// v1.3.0 新建 · 功能 ⑦
//
// 用法：sofagent-audit --support-bundle
// 输出：data/support-bundles/<timestamp>-support-bundle.zip
//
// zip 内容：
//   version.txt          — sofagent 版本
//   doctor-output.txt    — doctor 检查结果
//   audit-log-recent.jsonl — 最近 100 条审计日志
//   config-summary.yml   — 配置摘要（脱敏）
//   install-info.txt     — 安装信息
//
// 脱敏：API key / HMAC key / 真实姓名等自动脱敏
// ============================================================

import { execFileSync } from 'child_process';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { VERSION } from '@sofagent/core';
import { AUDIT_HISTORY, DATA_DIR, getConfigFile } from '@sofagent/core';

/** zip 大小上限（10MB） */
const MAX_ZIP_SIZE = 10 * 1024 * 1024;

/** 最近审计日志条数 */
const RECENT_AUDIT_LINES = 100;

/**
 * 脱敏处理——移除敏感信息。
 * 替换 API key / HMAC key / 密钥 / token 等。
 */
export function sanitize(text: string): string {
  if (!text) return '';
  let result = text;
  // API key（sk-xxx / sk_xxx）
  result = result.replace(/sk[-_]?[a-zA-Z0-9]{20,}/g, 'sk-***REDACTED***');
  // HMAC key
  result = result.replace(/~\/\.sofagent-key/g, '~/.sofagent-key (exists)');
  // Bearer token
  result = result.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***REDACTED***');
  // 密钥赋值（key=xxx / api_key=xxx / secret=xxx）
  result = result.replace(/(api[_-]?key|secret|token|password|passwd)\s*[=:]\s*\S+/gi, '$1=***REDACTED***');
  // 真实姓名（路径中 /Users/xxx/ 或 /home/xxx/）
  result = result.replace(/\/Users\/[^/\s]+/g, '/Users/***');
  result = result.replace(/\/home\/[^/\s]+/g, '/home/***');
  return result;
}

/**
 * 收集 doctor 输出。
 */
function collectDoctorOutput(): string {
  try {
    // 延迟导入避免循环依赖
    const { runDoctor } = require('@sofagent/core');
    const originalLog = console.log;
    let output = '';
    console.log = (...args: unknown[]) => { output += args.join(' ') + '\n'; };
    try {
      runDoctor(process.cwd());
    } catch {
      // doctor 失败不影响 bundle 生成
    }
    console.log = originalLog;
    return output;
  } catch {
    return '(doctor 不可用)';
  }
}

/**
 * 收集最近审计日志。
 */
function collectRecentAuditLog(): string {
  if (!existsSync(AUDIT_HISTORY)) return '(无审计日志)';
  try {
    const content = readFileSync(AUDIT_HISTORY, 'utf-8');
    const lines = content.trim().split('\n');
    const recent = lines.slice(-RECENT_AUDIT_LINES);
    return recent.join('\n');
  } catch {
    return '(审计日志读取失败)';
  }
}

/**
 * 收集配置摘要（脱敏）。
 */
function collectConfigSummary(): string {
  const configPath = getConfigFile(process.cwd());
  if (!existsSync(configPath)) return '# 配置不存在（使用默认配置）\n';
  try {
    const content = readFileSync(configPath, 'utf-8');
    return sanitize(content);
  } catch {
    return '(配置读取失败)';
  }
}

/**
 * 收集安装信息。
 */
function collectInstallInfo(): string {
  const lines: string[] = [
    `sofagent version: ${VERSION}`,
    `node: ${process.version}`,
    `platform: ${process.platform} ${process.arch}`,
    `cwd: ${process.cwd()}`,
    `SOFAGENT_HOME: ${process.env.SOFAGENT_HOME || '(default ~/.sofagent)'}`,
  ];

  // git 信息
  try {
    const gitRemote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf-8', stdio: 'pipe' }).trim();
    lines.push(`git remote: ${sanitize(gitRemote)}`);
  } catch { /* 非 git 仓库 */ }

  try {
    const gitBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8', stdio: 'pipe' }).trim();
    lines.push(`git branch: ${gitBranch}`);
  } catch { /* */ }

  // 安装目录
  const sofagentHome = process.env.SOFAGENT_HOME || join(homedir(), '.sofagent');
  lines.push(`install dir: ${sofagentHome}`);
  lines.push(`install dir exists: ${existsSync(sofagentHome)}`);

  // VERSION 文件
  const versionFile = join(sofagentHome, 'VERSION');
  if (existsSync(versionFile)) {
    lines.push(`installed version: ${readFileSync(versionFile, 'utf-8').trim()}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * 生成 support-bundle zip 文件。
 *
 * 使用 archiver 打包以下内容：
 *   version.txt / doctor-output.txt / audit-log-recent.jsonl /
 *   config-summary.yml / install-info.txt
 *
 * @param outputDir 输出目录（默认 data/support-bundles/）
 * @returns 生成的 zip 文件路径
 */
export async function generateSupportBundle(outputDir?: string): Promise<string> {
  const archiver = (await import('archiver')).default;
  const { createWriteStream } = await import('fs');

  const bundleDir = outputDir ?? join(DATA_DIR, 'support-bundles');
  if (!existsSync(bundleDir)) mkdirSync(bundleDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zipPath = join(bundleDir, `${timestamp}-support-bundle.zip`);

  // 收集内容
  const versionContent = `sofagent ${VERSION}\nGenerated: ${new Date().toISOString()}\n`;
  const doctorContent = sanitize(collectDoctorOutput());
  const auditContent = sanitize(collectRecentAuditLog());
  const configContent = collectConfigSummary();
  const installContent = collectInstallInfo();

  // 打包 zip
  return new Promise<string>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      // 检查 zip 大小
      const stats = statSync(zipPath);
      if (stats.size > MAX_ZIP_SIZE) {
        // 超限时截断日志（重新生成——简化版直接警告）
        console.warn(`⚠️ support-bundle 超过大小上限（${(stats.size / 1024 / 1024).toFixed(1)}MB > 10MB）`);
      }
      resolve(zipPath);
    });

    archive.on('error', reject);
    archive.on('warning', (err: { code?: string; message?: string }) => {
      if (err.code !== 'ENOENT') console.warn(err.message);
    });

    archive.pipe(output);

    // 添加文件
    archive.append(versionContent, { name: 'version.txt' });
    archive.append(doctorContent, { name: 'doctor-output.txt' });
    archive.append(auditContent, { name: 'audit-log-recent.jsonl' });
    archive.append(configContent, { name: 'config-summary.yml' });
    archive.append(installContent, { name: 'install-info.txt' });

    archive.finalize();
  });
}
