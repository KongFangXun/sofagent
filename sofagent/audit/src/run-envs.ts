// ============================================================
// run-envs.ts · 多环境探测
// v0.97: 从 run-envs.sh 迁移到 TS，零外部依赖
// ============================================================
// 功能：
//   1. 收集环境变量（PATH/HOME/SHELL 等）
//   2. 检测运行环境（WSL/Docker/MSYS2/macOS/Linux）
//   3. 检测可用工具链（bash/git/node/npm/ao）
// ============================================================

import { platform, homedir, hostname, userInfo } from 'os';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';

const VERSION = '0.97';

export interface EnvReport {
  /** 环境变量 */
  env: Record<string, string>;
  /** 运行环境类型 */
  runtimeEnv: string;
  /** 工具链可用性 */
  tools: Record<string, { available: boolean; version?: string }>;
  /** 路径信息 */
  paths: string[];
}

function commandExists(cmd: string): boolean {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

function tryVersion(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0];
  } catch {
    return undefined;
  }
}

/**
 * 探测运行环境类型
 */
export function detectRuntimeEnv(): string {
  const osType = platform();

  if (process.env.WSL_DISTRO_NAME) {
    return `WSL (${process.env.WSL_DISTRO_NAME})`;
  }
  if (process.env.MSYSTEM) {
    return `MSYS2/Git Bash (${process.env.MSYSTEM})`;
  }
  if (process.env.CYGWIN) {
    return 'Cygwin';
  }
  if (osType === 'darwin') {
    return 'macOS';
  }
  if (osType === 'linux') {
    // Check for Docker container
    if (existsSync('/.dockerenv') || (existsSync('/proc/1/cgroup') && require('fs').readFileSync('/proc/1/cgroup', 'utf-8').includes('docker'))) {
      return 'Docker Container (Linux)';
    }
    return 'Native Linux';
  }
  if (osType === 'win32') {
    return 'Windows (native bash/PS)';
  }

  return `Unknown (${osType})`;
}

/**
 * 收集关键环境变量
 */
export function collectEnvVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  const keys = ['PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'PWD', 'LANG', 'LC_ALL',
    'SOFAGENT_DATA', 'SOFA_AUDIT_ENABLED', 'SOFA_SANITIZE', 'SOFA_RETENTION_DAYS', 'SOFA_RETENTION_MAX',
    'OPENCLAW_STATE_DIR', 'WORKBUDDY_DIR',
    'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  ];

  for (const key of keys) {
    const val = process.env[key];
    if (val !== undefined) {
      // 脱敏 API Key
      if (key.endsWith('API_KEY') && val.length > 8) {
        vars[key] = val.slice(0, 6) + '***';
      } else {
        vars[key] = val;
      }
    }
  }

  return vars;
}

/**
 * 探测工具链可用性
 */
export function detectTools(): Record<string, { available: boolean; version?: string }> {
  const tools: Record<string, { available: boolean; version?: string }> = {};

  const toolDefs: [string, string?][] = [
    ['bash', 'GNU bash, version 3.2'],
    ['sh', ''],
    ['git', 'git version 2.39'],
    ['node', 'v22.0.0'],
    ['npm', '10.0.0'],
    ['ao', '0.7.5'],
    ['docker', 'Docker version 27'],
    ['python3', 'Python 3.12'],
    ['jq', 'jq-1.7'],
    ['sed', ''],
    ['awk', ''],
    ['curl', 'curl 8.0'],
    ['wget', 'GNU Wget 1.24'],
    ['rsync', 'rsync version 3'],
    ['make', 'GNU Make 4'],
    ['gcc', ''],
    ['openssl', 'OpenSSL 3'],
  ];

  for (const [cmd, expectedPattern] of toolDefs) {
    const available = commandExists(cmd);
    const version = available ? tryVersion(cmd, ['--version']) : undefined;

    // 如果 --version 不工作，尝试 -V
    const finalVersion = version || (available ? tryVersion(cmd, ['-V']) : undefined);

    tools[cmd] = { available, version: finalVersion };
  }

  return tools;
}

/**
 * 收集 PATH 中的路径
 */
export function collectPaths(separator = ':'): string[] {
  const path = process.env.PATH || '';
  return path
    .split(separator)
    .filter(p => p.trim().length > 0)
    .map(p => p.trim());
}

/**
 * 获取系统信息
 */
export function getSystemInfo(): { hostname: string; user: string; home: string; platform: string; cpus: number } {
  return {
    hostname: hostname(),
    user: userInfo().username,
    home: homedir(),
    platform: `${platform()} ${require('os').release()}`,
    cpus: require('os').cpus().length,
  };
}

/**
 * 完整环境探测
 */
export function probeEnvironment(): EnvReport {
  return {
    env: collectEnvVars(),
    runtimeEnv: detectRuntimeEnv(),
    tools: detectTools(),
    paths: collectPaths(),
  };
}

// ── CLI ──
function main(): void {
  if (process.argv.includes('--help')) {
    console.log(`sofagent run-envs v${VERSION}`);
    console.log('  多环境探测——收集环境变量/工具链/路径信息');
    console.log('');
    console.log('  用法:');
    console.log('    node run-envs.js           完整探测');
    console.log('    node run-envs.js --json    JSON 输出');
    console.log('    node run-envs.js --tools   仅工具链');
    console.log('    node run-envs.js --env     仅环境变量');
    process.exit(0);
  }

  if (process.argv.includes('--tools')) {
    const tools = detectTools();
    console.log(JSON.stringify(tools, null, 2));
    process.exit(0);
  }

  if (process.argv.includes('--env')) {
    const env = collectEnvVars();
    console.log(JSON.stringify(env, null, 2));
    process.exit(0);
  }

  if (process.argv.includes('--json')) {
    const report = probeEnvironment();
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  // 默认格式输出
  const sysInfo = getSystemInfo();
  const env = collectEnvVars();
  const tools = detectTools();

  console.log(`== 系统信息 ==`);
  console.log(`  主机: ${sysInfo.hostname}`);
  console.log(`  用户: ${sysInfo.user}`);
  console.log(`  目录: ${sysInfo.home}`);
  console.log(`  平台: ${sysInfo.platform}`);
  console.log(`  CPU: ${sysInfo.cpus} 核心`);
  console.log(`  运行环境: ${detectRuntimeEnv()}`);
  console.log('');

  console.log('== 关键环境变量 ==');
  for (const [key, val] of Object.entries(env)) {
    console.log(`  ${key}=${val}`);
  }
  console.log('');

  console.log('== 工具链 ==');
  for (const [tool, info] of Object.entries(tools)) {
    const status = info.available ? '✓' : '✗';
    const ver = info.version || '';
    console.log(`  ${status} ${tool.padEnd(10)} ${ver}`);
  }
}

if (require.main === module) {
  main();
}
