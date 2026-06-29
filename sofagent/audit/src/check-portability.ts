// ============================================================
// check-portability.ts · 跨平台兼容性检查
// v0.97: 从 check-portability.sh 迁移到 TS，零外部依赖
// ============================================================
// 检查平台兼容性：bash/stat/shasum 可用性，OS 类型等
// ============================================================

import { execFileSync } from 'child_process';
import { platform, arch, release, type } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

const VERSION = '0.97';

export interface PortabilityReport {
  os: string;
  arch: string;
  release: string;
  bashVersion: string | null;
  gitVersion: string | null;
  nodeVersion: string | null;
  hasShasum: boolean;
  hasSha256sum: boolean;
  statType: 'gnu' | 'bsd' | 'unknown';
  issues: string[];
}

function commandExists(cmd: string): boolean {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

function tryVersion(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

/**
 * 执行跨平台兼容性检查
 */
export function checkPortability(): PortabilityReport {
  const issues: string[] = [];

  // OS info
  const osType = type();
  const osArch = arch();
  const osRelease = release();
  let osName = `${osType} ${osRelease} (${osArch})`;

  // Bash
  const bashVer = tryVersion('bash', ['--version']);
  if (!bashVer) {
    issues.push('bash 不可用——Windows 环境建议用 PowerShell 脚本替代');
  }

  // Git
  const gitVer = tryVersion('git', ['--version']);
  if (!gitVer) {
    issues.push('git 不可用——部分功能（worktree 隔离）将降级');
  }

  // Node.js
  const nodeVer = tryVersion('node', ['--version']);
  if (!nodeVer) {
    issues.push('Node.js 不可用——审计引擎无法运行');
  } else {
    const match = nodeVer.match(/v?(\d+)\./);
    const major = match ? parseInt(match[1]!, 10) : 0;
    if (major < 18) {
      issues.push(`Node.js < 18（当前 ${nodeVer}）——部分功能不兼容`);
    }
  }

  // shasum / sha256sum
  const hasShasum = commandExists('shasum');
  const hasSha256sum = commandExists('sha256sum');
  if (!hasShasum && !hasSha256sum) {
    issues.push('shasum 和 sha256sum 均不可用——task slug 生成将降级');
  }

  // stat type detection
  let statType: PortabilityReport['statType'] = 'unknown';
  if (osType === 'Darwin') {
    statType = 'bsd';
  } else if (osType === 'Linux') {
    try {
      const statVer = execFileSync('stat', ['--version'], { encoding: 'utf-8', timeout: 3000 });
      if (statVer.includes('GNU')) statType = 'gnu';
    } catch {
      // BusyBox stat — doesn't support --version
      statType = 'unknown';
    }
  }

  // Check for common cross-platform issues
  if (!commandExists('sh') && osType !== 'Windows_NT') {
    issues.push('sh 不可用');
  }

  return {
    os: osName,
    arch: osArch,
    release: osRelease,
    bashVersion: bashVer ? bashVer.split('\n')[0] ?? null : null,
    gitVersion: gitVer ? gitVer.split('\n')[0] ?? null : null,
    nodeVersion: nodeVer,
    hasShasum,
    hasSha256sum,
    statType,
    issues,
  };
}

/**
 * 打印格式化的可移植性报告
 */
export function printReport(report: PortabilityReport): string {
  const lines: string[] = [];

  lines.push('== 环境 ==');
  lines.push(`  uname    : ${report.os}`);
  lines.push(`  stat     : ${report.statType === 'gnu' ? 'GNU stat' : report.statType === 'bsd' ? 'BSD stat' : '未知（busybox等）'}`);
  lines.push(`  shasum   : ${report.hasShasum ? '有' : '无'}`);
  lines.push(`  sha256sum: ${report.hasSha256sum ? '有' : '无'}`);
  lines.push('');

  lines.push('== 关键依赖 ==');
  lines.push(`  bash     : ${report.bashVersion || '❌ 不可用'}`);
  lines.push(`  git      : ${report.gitVersion || '❌ 不可用'}`);
  lines.push(`  node     : ${report.nodeVersion || '❌ 不可用'}`);
  lines.push('');

  if (report.issues.length > 0) {
    lines.push('== 发现问题 ==');
    for (const issue of report.issues) {
      lines.push(`  ⚠️  ${issue}`);
    }
    lines.push('');
  }

  if (report.issues.length === 0) {
    lines.push('== 结果：全部通过 ==');
  } else {
    lines.push(`== 结果：${report.issues.length} 个问题 ==`);
  }

  return lines.join('\n');
}

/**
 * 快速验证 shasum/sha256sum 回退机制
 */
export function testHashFallback(input: string): { slug: string; ok: boolean; error?: string } {
  try {
    // Try shasum first, then sha256sum
    let output: string;
    try {
      output = execFileSync(
        'bash',
        ['-c', `printf '%s' '${input}' | { shasum -a 256 2>/dev/null || sha256sum 2>/dev/null; } | cut -c1-8`],
        { encoding: 'utf-8', timeout: 5000 },
      );
    } catch {
      // Try with Node.js crypto as fallback
      const { createHash } = require('crypto');
      output = createHash('sha256').update(input).digest('hex').slice(0, 8);
    }
    const slug = output.trim();
    const ok = /^[0-9a-f]{8}$/.test(slug);
    return { slug, ok };
  } catch (e: any) {
    return { slug: '', ok: false, error: e.message };
  }
}

// ── CLI ──
function main(): void {
  if (process.argv.includes('--help')) {
    console.log(`sofagent check-portability v${VERSION}`);
    console.log('  检查平台兼容性（bash/git/node/shasum/stat）');
    console.log('');
    console.log('  用法:');
    console.log('    node check-portability.js           完整检查');
    console.log('    node check-portability.js --json    JSON 输出');
    process.exit(0);
  }

  const report = checkPortability();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(printReport(report));
  }

  if (report.issues.length > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
