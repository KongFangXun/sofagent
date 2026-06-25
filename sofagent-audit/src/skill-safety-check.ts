// ============================================================
// skill-safety-check.ts · Skill 安全审查（确定性正则快筛）
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
//   0 = 未发现威胁（SAFE）
//   1 = 发现高危威胁（DANGEROUS）
//   2 = 发现可疑内容（SUSPICIOUS）
// ============================================================

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const VERSION = '0.92';

// ANSI 颜色代码
const RED = '\x1b[0;31m';
const YELLOW = '\x1b[0;33m';
const GREEN = '\x1b[0;32m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

/** 安全检查规则 */
export interface SafetyRule {
  pattern: RegExp;
  category: string;
  severity: 'DANGEROUS' | 'SUSPICIOUS' | 'INFO';
  description: string;
}

/** 单条命中记录 */
export interface SafetyHit {
  file: string;
  line: number;
  category: string;
  severity: 'DANGEROUS' | 'SUSPICIOUS' | 'INFO';
  pattern: string;
  description: string;
}

/** 扫描结果 */
export interface SafetyResult {
  version: string;
  scannedAt: string;
  filesScanned: number;
  verdict: 'SAFE' | 'DANGEROUS' | 'SUSPICIOUS';
  exitCode: number;
  results: Array<{
    file: string;
    verdict: 'SAFE' | 'DANGEROUS' | 'SUSPICIOUS';
    hits: SafetyHit[];
  }>;
}

// ============================================================
// 21 条安全规则（从 bash 版逐条迁移）
// ============================================================

const RULES: SafetyRule[] = [
  // === 恶意命令 (DANGEROUS) ===
  // 1. rm -rf /
  { pattern: /(^|[^a-zA-Z0-9_])rm\s+-rf\s+\//, category: '恶意命令', severity: 'DANGEROUS', description: 'rm -rf / 危险删除' },
  // 2. curl | bash
  { pattern: /curl.*\|.*bash/, category: '恶意命令', severity: 'DANGEROUS', description: 'curl 管道执行 bash' },
  // 3. curl | sh（bash 版末尾有未闭合括号问题，JS 版用 \b 修复；前置 \b 避免误匹配 bash/fish）
  { pattern: /curl.*\|.*\bsh\b/, category: '恶意命令', severity: 'DANGEROUS', description: 'curl 管道执行 sh' },
  // 4. wget | sh
  { pattern: /wget.*\|.*sh/, category: '恶意命令', severity: 'DANGEROUS', description: 'wget 管道执行 sh' },
  // 5. wget | bash
  { pattern: /wget.*\|.*bash/, category: '恶意命令', severity: 'DANGEROUS', description: 'wget 管道执行 bash' },
  // 6. chmod 777 /
  { pattern: /chmod\s+777\s+\//, category: '恶意命令', severity: 'DANGEROUS', description: 'chmod 777 / 全局可写' },
  // 7. mkfs.
  { pattern: /mkfs\./, category: '恶意命令', severity: 'DANGEROUS', description: 'mkfs 格式化磁盘' },
  // 8. dd if= of=/dev/
  { pattern: /dd\s+if=.*of=\/dev\//, category: '恶意命令', severity: 'DANGEROUS', description: 'dd 磁盘覆写' },

  // === 密钥泄露 (DANGEROUS) ===
  // 9. AWS Access Key
  { pattern: /AKIA[0-9A-Z]{16}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'AWS Access Key' },
  // 10. OpenAI API Key
  { pattern: /sk-[a-zA-Z0-9]{20,}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'OpenAI API Key' },
  // 11. GitHub Token
  { pattern: /gh[pousr]_[A-Za-z0-9]{36}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'GitHub Token' },
  // 12. PEM 私钥头
  { pattern: /-----BEGIN.*PRIVATE KEY-----/, category: '密钥泄露', severity: 'DANGEROUS', description: 'PEM 私钥头' },

  // === 危险调用 (SUSPICIOUS) ===
  // 13. eval() 非常量参数
  { pattern: /eval\(.*[^0-9"'].*\)/, category: '危险调用', severity: 'SUSPICIOUS', description: 'eval() 非常量参数' },
  // 14. os.system()
  { pattern: /os\.system\(/, category: '危险调用', severity: 'SUSPICIOUS', description: 'os.system() 系统调用' },
  // 15. child_process.exec
  { pattern: /child_process\.exec/, category: '危险调用', severity: 'SUSPICIOUS', description: 'child_process.exec 命令执行' },
  // 16. subprocess.call
  { pattern: /subprocess\.call/, category: '危险调用', severity: 'SUSPICIOUS', description: 'subprocess.call 命令执行' },
  // 17. new Function()
  { pattern: /new\s+Function\(/, category: '危险调用', severity: 'SUSPICIOUS', description: 'new Function() 动态执行' },

  // === 注入攻击 / 数据外泄 (SUSPICIOUS) ===
  // 18. ignore previous instructions
  { pattern: /(^|[^a-zA-Z])(ignore|forget|disregard)\s+(previous|all|above)\s*(instructions|prompts|rules)/i, category: '注入攻击', severity: 'SUSPICIOUS', description: 'ignore previous instructions 注入' },
  // 19. 数据外泄端点
  { pattern: /webhook\.site|requestbin|pipedream/, category: '注入攻击', severity: 'SUSPICIOUS', description: '数据外泄端点' },

  // === 混淆代码 ===
  // 20. Base64 解码
  { pattern: /base64\s+.*decode/, category: '混淆代码', severity: 'SUSPICIOUS', description: 'Base64 解码（可能混淆载荷）' },
  // 21. eval(atob()) Base64 混淆执行
  { pattern: /eval\(atob\(/, category: '混淆代码', severity: 'DANGEROUS', description: 'eval(atob()) Base64 混淆执行' },
];

/** 可扫描的文件扩展名 */
const SCANNABLE_EXTENSIONS = new Set(['.md', '.js', '.ts', '.py', '.sh', '.json', '.yaml', '.yml']);

// ============================================================
// 扫描函数
// ============================================================

/**
 * 递归找出所有需扫描的文件。
 */
export function findFiles(target: string): string[] {
  if (!existsSync(target)) {
    return [];
  }

  const stat = statSync(target);
  if (stat.isFile()) {
    const ext = extname(target).toLowerCase();
    if (SCANNABLE_EXTENSIONS.has(ext)) {
      return [target];
    }
    // 无扩展名也扫描（如 Makefile、Dockerfile）
    if (ext === '') {
      return [target];
    }
    return [];
  }

  if (stat.isDirectory()) {
    const files: string[] = [];
    try {
      const entries = readdirSync(target, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(target, entry.name);
        if (entry.isDirectory()) {
          // 跳过隐藏目录和 node_modules
          if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }
          files.push(...findFiles(fullPath));
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (SCANNABLE_EXTENSIONS.has(ext) || ext === '') {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // 跳过无法读取的目录
    }
    return files;
  }

  return [];
}

/**
 * 扫描单个文件，返回命中列表。
 */
export function scanFile(filePath: string): SafetyHit[] {
  const hits: SafetyHit[] = [];

  let lines: string[];
  try {
    lines = readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return hits;
  }

  for (const rule of RULES) {
    // 重置 lastIndex
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags);
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      re.lastIndex = 0;
      if (re.test(lines[lineNum])) {
        hits.push({
          file: filePath,
          line: lineNum + 1, // 1-based 行号
          category: rule.category,
          severity: rule.severity,
          pattern: rule.pattern.source,
          description: rule.description,
        });
      }
    }
  }

  return hits;
}

/**
 * 扫描指定目标的安全性。
 * @param target - 文件或目录路径
 * @param options - 输出模式选项
 * @returns 扫描结果
 */
export function scanSkillSafety(
  target: string,
  options?: { mode?: 'terminal' | 'json' | 'quiet' },
): SafetyResult {
  const mode = options?.mode ?? 'terminal';

  // 目标不存在
  if (!existsSync(target)) {
    const result: SafetyResult = {
      version: VERSION,
      scannedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      filesScanned: 0,
      verdict: 'SUSPICIOUS',
      exitCode: 2,
      results: [],
    };

    if (mode === 'terminal') {
      console.error(`错误：目标不存在：${target}`);
    } else if (mode === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else if (mode === 'quiet') {
      console.log('SUSPICIOUS');
    }
    return result;
  }

  // 收集文件列表
  const files = findFiles(target);
  const filesScanned = files.length;

  const fileResults: SafetyResult['results'] = [];
  let safeCount = 0;
  let dangerousCount = 0;
  let suspiciousCount = 0;
  let overallVerdict: 'SAFE' | 'DANGEROUS' | 'SUSPICIOUS' = 'SAFE';

  for (const file of files) {
    const hits = scanFile(file);
    const hitCount = hits.length;

    if (hitCount === 0) {
      safeCount++;
      if (mode === 'terminal') {
        console.log(`${GREEN}  ✓${NC} SAFE — ${file}`);
      }
      fileResults.push({
        file,
        verdict: 'SAFE',
        hits: [],
      });
    } else {
      // 判断 verdict：有 DANGEROUS 命中 → DANGEROUS，否则 SUSPICIOUS
      const hasDangerous = hits.some((h) => h.severity === 'DANGEROUS');
      const fileVerdict = hasDangerous ? 'DANGEROUS' : 'SUSPICIOUS';

      if (fileVerdict === 'DANGEROUS') {
        dangerousCount++;
        overallVerdict = 'DANGEROUS';
      } else {
        suspiciousCount++;
        if (overallVerdict !== 'DANGEROUS') {
          overallVerdict = 'SUSPICIOUS';
        }
      }

      if (mode === 'terminal') {
        if (fileVerdict === 'DANGEROUS') {
          console.log(`${RED}  ✗${NC} DANGEROUS — ${file} (${hitCount} hits)`);
        } else {
          console.log(`${YELLOW}  ⚠${NC} SUSPICIOUS — ${file} (${hitCount} hits)`);
        }
        // 逐条展示命中
        for (const hit of hits) {
          const prefix = hit.severity === 'DANGEROUS'
            ? `${RED}  ✗${NC}  L${hit.line}: 🚫 ${hit.category} — ${hit.description}`
            : `${YELLOW}  ⚠${NC}  L${hit.line}: ⚠️  ${hit.category} — ${hit.description}`;
          console.log(prefix);
        }
      }

      fileResults.push({
        file,
        verdict: fileVerdict,
        hits: hits.map((h) => ({
          ...h,
          // JSON 输出用相对短的 pattern 字符串
          pattern: h.pattern,
        })),
      });
    }
  }

  // 确定退出码
  let exitCode: number;
  if (overallVerdict === 'DANGEROUS') {
    exitCode = 1;
  } else if (overallVerdict === 'SUSPICIOUS') {
    exitCode = 2;
  } else {
    exitCode = 0;
  }

  const result: SafetyResult = {
    version: VERSION,
    scannedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    filesScanned,
    verdict: overallVerdict,
    exitCode,
    results: fileResults,
  };

  // 输出
  if (mode === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (mode === 'terminal') {
    console.log('');
    console.log(`${BOLD}[sofagent]${NC} Skill 安全审查 · 扫描 ${filesScanned} 个文件`);
    console.log('');
    console.log(`  结果: ${GREEN}${safeCount} SAFE${NC} / ${RED}${dangerousCount} DANGEROUS${NC} / ${YELLOW}${suspiciousCount} SUSPICIOUS${NC}`);
    console.log(`  退出码: ${exitCode} ${exitCodeLabel(exitCode)}`);
    console.log('');
  } else if (mode === 'quiet') {
    console.log(overallVerdict);
  }

  return result;
}

/** 退出码标签 */
function exitCodeLabel(code: number): string {
  switch (code) {
    case 0: return '(SAFE)';
    case 1: return '(DANGEROUS — 建议直接拦截)';
    case 2: return '(SUSPICIOUS — 需人工/LLM 复查)';
    default: return '';
  }
}

/**
 * CLI 入口函数，处理 process.argv。
 */
export function main(): void {
  const args = process.argv.slice(2);
  let mode: 'terminal' | 'json' | 'quiet' = 'terminal';
  let target = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
      case '--json':
        mode = 'json';
        break;
      case '--quiet':
        mode = 'quiet';
        break;
      case '--version':
        console.log(`skill-safety-check v${VERSION}`);
        process.exit(0);
      default:
        target = args[i];
        break;
    }
  }

  if (!target) {
    console.error('错误：缺少扫描目标。用法：skill-safety-check <file-or-dir>');
    process.exit(2);
  }

  const result = scanSkillSafety(target, { mode });
  process.exit(result.exitCode);
}

function showHelp(): void {
  console.log(`sofagent skill-safety-check v${VERSION} · Skill 安全审查`);
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

// 直接运行时执行 CLI
if (require.main === module) {
  main();
}
