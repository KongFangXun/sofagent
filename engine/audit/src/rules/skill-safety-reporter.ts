// ============================================================
// skill-safety-reporter.ts · Skill 安全审查——输出格式化
// ============================================================

import { type SafetyHit, type SafetyResult } from './skill-safety-rules';
import { log } from '../logger';

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
    log.info(`${GREEN}  ✓${NC} SAFE — ${file}`);
    return;
  }

  const prefix = verdict === 'DANGEROUS'
    ? `${RED}  ✗${NC} DANGEROUS — ${file} (${hits.length} hits)`
    : `${YELLOW}  ⚠${NC} SUSPICIOUS — ${file} (${hits.length} hits)`;
  log.info(prefix);

  for (const hit of hits) {
    const hitPrefix = hit.severity === 'DANGEROUS'
      ? `${RED}  ✗${NC}  L${hit.line}: 🚫 ${hit.category} — ${hit.description}`
      : `${YELLOW}  ⚠${NC}  L${hit.line}: ⚠️  ${hit.category} — ${hit.description}`;
    log.info(hitPrefix);
  }
}

/** 终端模式总结输出 */
export function printTerminalSummary(
  result: SafetyResult,
  safeCount: number,
  dangerousCount: number,
  suspiciousCount: number,
): void {
  log.info('');
  log.info(`${BOLD}[sofagent]${NC} Skill 安全审查 · 扫描 ${result.filesScanned} 个文件`);
  log.info('');
  log.info(`  结果: ${GREEN}${safeCount} SAFE${NC} / ${RED}${dangerousCount} DANGEROUS${NC} / ${YELLOW}${suspiciousCount} SUSPICIOUS${NC}`);
  log.info(`  退出码: ${result.exitCode} ${exitCodeLabel(result.exitCode)}`);
  log.info('');
}

export function printJsonOutput(result: SafetyResult): void {
  log.info(JSON.stringify(result, null, 2));
}

export function printQuietOutput(verdict: string): void {
  log.info(verdict);
}

export function printError(msg: string): void {
  log.error(msg);
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
  log.info(`sofagent skill-safety-check v${version} · Skill 安全审查`);
  log.info('');
  log.info('用法：');
  log.info('  skill-safety-check <skill-file-or-dir>      扫描单个文件或目录');
  log.info('  skill-safety-check --json <path>            JSON 输出（CI/CD）');
  log.info('  skill-safety-check --quiet <path>           仅输出 verdict + exit code');
  log.info('  skill-safety-check --help                   显示此帮助');
  log.info('');
  log.info('退出码：');
  log.info('  0 = SAFE       未发现威胁');
  log.info('  1 = DANGEROUS  发现高危威胁，建议直接拦截');
  log.info('  2 = SUSPICIOUS 发现可疑内容，需人工/LLM 复查');
}
