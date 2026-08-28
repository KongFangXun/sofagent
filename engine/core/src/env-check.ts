#!/usr/bin/env node
// env-check.ts · FDE 环境验证 CLI — v1.4.2
// 用法: sofagent-env-check [--json]

import { execFileSync } from 'child_process';
import { existsSync, statfsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { VERSION } from './shared/constants.js';
const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', N = '\x1b[0m', D = '\x1b[2m';
const C = (ok: boolean) => ok ? `${G}✓${N}` : `${R}✗${N}`;

export interface EnvResult {
  node: { version: string; ok: boolean };
  git: { available: boolean; isRepo: boolean };
  npm: { available: boolean };
  disk: { freeMB: number };
  openclaw: { exists: boolean };
  sofagent: { exists: boolean };
  bash: { version: string | null; ok: boolean };
  allOk: boolean;
}

export function checkEnv(): EnvResult {
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0]!, 10);

  let gitAvail = false, gitRepo = false;
  try { execFileSync('git', ['--version'], { stdio: 'pipe' }); gitAvail = true; } catch { /* */ }
  if (gitAvail) {
    try { execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe' }); gitRepo = true; } catch { /* */ }
  }

  let npmAvail = false;
  try { execFileSync('npm', ['--version'], { stdio: 'pipe' }); npmAvail = true; } catch { /* */ }

  let freeMB = 0;
  if (process.platform === 'win32') {
    // Windows: statfsSync 不存在，跳过磁盘检查
    freeMB = 0;
  } else {
    try {
      const s = statfsSync(homedir());
      freeMB = Math.round((s.bsize * s.bfree) / (1024 * 1024));
    } catch {
      try {
        const out = execFileSync('df', ['-m', homedir()], { encoding: 'utf-8' }).trim();
        const m = out.split('\n')[1]?.match(/(\d+)\s+\d+%/);
        if (m) freeMB = parseInt(m[1]!, 10);
      } catch { /* */ }
    }
  }

  const ocExists = existsSync(join(homedir(), '.openclaw'));
  const saExists = existsSync(join(homedir(), '.sofagent'));

  let bashVer: string | null = null, bashOk = false;
  try {
    const out = execFileSync('bash', ['--version'], { encoding: 'utf-8' });
    const m = out.match(/version\s+(\d+)\.(\d+)/);
    bashVer = out.split('\n')[0]!.trim();
    // 🔴 v1.2.6 修复：阈值从 >=4 降为 >=3.2。
    // 项目全部 .sh 脚本刻意兼容 bash 3.2（cleanup.sh / sofagent-dashboard.sh /
    // test-count.sh 均有明确注释"macOS 自带 bash 3.2 不支持 declare -A/mapfile"），
    // 要求 >=4 与实际约束自相矛盾，导致 macOS 系统 bash 3.2 被误杀 → doctor EXIT=1。
    if (m) {
      const major = parseInt(m[1]!, 10);
      const minor = parseInt(m[2]!, 10);
      bashOk = major > 3 || (major === 3 && minor >= 2);
    }
  } catch { /* */ }

  const allOk = nodeMajor >= 18 && gitAvail && npmAvail && freeMB > 1024 && bashOk;
  // ocExists 和 saExists 降级为建议项——OpenClaw/sofagent 目录不存在不代表系统不可用
  // 它们会影响 doctor 的 warn 输出但不影响 allOk 判定
  return { node: { version: nodeVersion, ok: nodeMajor >= 18 },
    git: { available: gitAvail, isRepo: gitRepo }, npm: { available: npmAvail },
    disk: { freeMB }, openclaw: { exists: ocExists }, sofagent: { exists: saExists },
    bash: { version: bashVer, ok: bashOk }, allOk };
}

function formatTable(r: EnvResult): string {
  const gb = r.disk.freeMB >= 1024 ? `${(r.disk.freeMB / 1024).toFixed(1)} GB` : `${r.disk.freeMB} MB`;
  const rows: [string, string, string][] = [
    ['Node.js', r.node.version, C(r.node.ok) + (r.node.ok ? ' (≥18)' : ` ${R}(<18)${N}`)],
    ['git', r.git.available ? '可用' : '不可用', `${C(r.git.available)}${r.git.isRepo ? ` ${G}(in repo)${N}` : ''}`],
    ['npm', r.npm.available ? '可用' : '不可用', C(r.npm.available)],
    ['Disk free', gb, r.disk.freeMB > 1024 ? `${G}✓${N}` : `${Y}⚠ low${N}`],
    ['OpenClaw', r.openclaw.exists ? '已安装' : '未安装', C(r.openclaw.exists)],
    ['.sofagent', r.sofagent.exists ? '存在' : '不存在', C(r.sofagent.exists)],
    ['bash', r.bash.version || 'N/A', C(r.bash.ok) + (r.bash.ok ? ' (≥3.2)' :
      r.bash.version ? ` ${R}(<3.2)${N}` : '')],
  ];
  const w = Math.max(...rows.map(r => r[0].length)) + 2;
  return [
    `${D}┌${'─'.repeat(w + 32)}┐${N}`,
    ...rows.map(([k, v, s]) =>
      `${D}│${N} ${k.padEnd(w)} ${(v + ' ').padEnd(18, ' ')} ${s} ${D}│${N}`),
    `${D}└${'─'.repeat(w + 32)}┘${N}`,
    `\n  结果: ${r.allOk ? `${G}全部通过 ✓${N}` : `${R}存在问题 ✗${N}`}`,
  ].join('\n');
}
if (process.argv[1]?.includes('env-check')) {
  const r = checkEnv();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`\n  sofagent env-check v${VERSION}\n`);
    console.log(formatTable(r));
    console.log('');
  }
  process.exit(r.allOk ? 0 : 1);
}
