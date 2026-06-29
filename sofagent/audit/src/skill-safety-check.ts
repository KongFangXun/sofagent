// ============================================================
// skill-safety-check.ts · Skill 安全审查（入口）
// ============================================================
// 扫描 Skill 文件中的安全威胁——恶意命令/密钥泄露/危险API/Prompt注入/数据外泄。
// 纯 TypeScript + Node.js 内置模块，零外部依赖。
//
// 用法：
//   npx ts-node src/skill-safety-check.ts <skill-file-or-dir>
//   npx ts-node src/skill-safety-check.ts --json <path>
//   npx ts-node src/skill-safety-check.ts --quiet <path>
//   npx ts-node src/skill-safety-check.ts --help
//
// 退出码：
//   0 = SAFE       / 1 = DANGEROUS  / 2 = SUSPICIOUS
// ============================================================

import { existsSync } from 'fs';
import { VERSION, type SafetyResult } from './rules/skill-safety-rules';
import { findFiles, scanFile } from './rules/skill-safety-engine';
import {
  printFileResult,
  printTerminalSummary,
  printJsonOutput,
  printQuietOutput,
  printError,
  showHelp,
} from './rules/skill-safety-reporter';

/**
 * 扫描指定目标的安全性。
 */
export function scanSkillSafety(
  target: string,
  options?: { mode?: 'terminal' | 'json' | 'quiet' },
): SafetyResult {
  const mode = options?.mode ?? 'terminal';

  if (!existsSync(target)) {
    const result: SafetyResult = {
      version: VERSION,
      scannedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      filesScanned: 0,
      verdict: 'SUSPICIOUS',
      exitCode: 2,
      results: [],
    };

    if (mode === 'terminal') printError(`错误：目标不存在：${target}`);
    else if (mode === 'json') printJsonOutput(result);
    else if (mode === 'quiet') printQuietOutput('SUSPICIOUS');
    return result;
  }

  const files = findFiles(target);
  const fileResults: SafetyResult['results'] = [];
  let safeCount = 0, dangerousCount = 0, suspiciousCount = 0;
  let overallVerdict: 'SAFE' | 'DANGEROUS' | 'SUSPICIOUS' = 'SAFE';

  for (const file of files) {
    const hits = scanFile(file);

    if (hits.length === 0) {
      safeCount++;
      if (mode === 'terminal') printFileResult(file, [], 'SAFE');
      fileResults.push({ file, verdict: 'SAFE', hits: [] });
    } else {
      const hasDangerous = hits.some(h => h.severity === 'DANGEROUS');
      const verdict = hasDangerous ? 'DANGEROUS' : 'SUSPICIOUS';

      if (verdict === 'DANGEROUS') { dangerousCount++; overallVerdict = 'DANGEROUS'; }
      else { suspiciousCount++; if (overallVerdict !== 'DANGEROUS') overallVerdict = 'SUSPICIOUS'; }

      if (mode === 'terminal') printFileResult(file, hits, verdict);
      fileResults.push({ file, verdict, hits });
    }
  }

  const exitCode = overallVerdict === 'DANGEROUS' ? 1 : overallVerdict === 'SUSPICIOUS' ? 2 : 0;

  const result: SafetyResult = {
    version: VERSION,
    scannedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    filesScanned: files.length,
    verdict: overallVerdict,
    exitCode,
    results: fileResults,
  };

  if (mode === 'json') printJsonOutput(result);
  else if (mode === 'terminal') printTerminalSummary(result, safeCount, dangerousCount, suspiciousCount);
  else if (mode === 'quiet') printQuietOutput(overallVerdict);

  return result;
}

/**
 * CLI 入口函数。
 */
export function main(): void {
  const args = process.argv.slice(2);
  let mode: 'terminal' | 'json' | 'quiet' = 'terminal';
  let target = '';

  for (const arg of args) {
    switch (arg) {
      case '--help': case '-h': showHelp(VERSION); process.exit(0);
      case '--json': mode = 'json'; break;
      case '--quiet': mode = 'quiet'; break;
      case '--version': console.log(`skill-safety-check v${VERSION}`); process.exit(0);
      default: target = arg;
    }
  }

  if (!target) {
    printError('错误：缺少扫描目标。用法：skill-safety-check <file-or-dir>');
    process.exit(2);
  }

  const result = scanSkillSafety(target, { mode });
  process.exit(result.exitCode);
}

if (require.main === module) {
  main();
}

// 重新导出子模块（保持向后兼容）
export { findFiles, scanFile } from './rules/skill-safety-engine';
export { type SafetyHit, type SafetyRule, type SafetyResult } from './rules/skill-safety-rules';
