// ============================================================
// skill-safety-reporter.ts · Skill 安全审查——输出格式化
// ============================================================

import { type SafetyHit, type SafetyResult } from './skill-safety-rules';

const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const GREEN = '\x1b[0;32m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

/** 单文件终端输出 */
export function printFileResult(
  file: string,
  hits: SafetyHit[],
  verdict: 'SAFE' | 'DANGEROUS' | 'SUSPICIOUS',
): void {
  if (verdict === 'SAFE') {
    console.log(`${GREEN}  ✓${NC} SAFE — ${file}`);
    return;
  }

  const prefix = verdict === 'DANGEROUS'
    ? `${RED}  ✗${NC} DANGEROUS — ${file} (${hits.length} hits)`
    : `${YELLOW}  ⚠${NC} SUSPICIOUS — ${file} (${hits.length} hits)`;
  console.log(prefix);

  for (const hit of hits) {
    const hitPrefix = hit.severity === 'DANGEROUS'
      ? `${RED}  ✗${NC}  L${hit.line}: 🚫 ${hit.category} — ${hit.description}`
      : `${YELLOW}  ⚠${NC}  L${hit.line}: ⚠️  ${hit.category} — ${hit.description}`;
    console.log(hitPrefix);
  }
}

/** 终端模式总结输出 */
export function printTerminalSummary(
  result: SafetyResult,
  safeCount: number,
  dangerousCount: number,
  suspiciousCount: number,
): void {
  console.log('');
  console.log(`${BOLD}[sofagent]${NC} Skill 安全审查 · 扫描 ${result.filesScanned} 个文件`);
  console.log('');
  console.log(`  结果: ${GREEN}${safeCount} SAFE${NC} / ${RED}${dangerousCount} DANGEROUS${NC} / ${YELLOW}${suspiciousCount} SUSPICIOUS${NC}`);
  console.log(`  退出码: ${result.exitCode} ${exitCodeLabel(result.exitCode)}`);
  console.log('');
}

export function printJsonOutput(result: SafetyResult): void {
  console.log(JSON.stringify(result, null, 2));
}

export function printQuietOutput(verdict: string): void {
  console.log(verdict);
}

export function printError(msg: string): void {
  console.error(msg);
}

function exitCodeLabel(code: number): string {
  switch (code) {
    case 0: return '(SAFE)';
    case 1: return '(DANGEROUS — 建议直接拦截)';
    case 2: return '(SUSPICIOUS — 需人工/LLM 复查)';
    default: return '';
  }
}

export function showHelp(version: string): void {
  console.log(`sofagent skill-safety-check v${version} · Skill 安全审查`);
  console.log('');
  console.log('用法：');
  console.log('  skill-safety-check <skill-file-or-dir>      扫描单个文件或目录');
  console.log('  skill-safety-check --json <path>            JSON 输出（CI/CD）');
  console.log('  skill-safety-check --quiet <path>           仅输出 verdict + exit code');
  console.log('  skill-safety-check --help                   显示此帮助');
  console.log('');
  console.log('退出码：');
  console.log('  0 = SAFE       未发现威胁');
  console.log('  1 = DANGEROUS  发现高危威胁，建议直接拦截');
  console.log('  2 = SUSPICIOUS 发现可疑内容，需人工/LLM 复查');
}
