// ============================================================
// skill-safety-rules.ts · Skill 安全审查——规则定义
// ============================================================

export const VERSION = '0.96';

export const SCANNABLE_EXTENSIONS = new Set(['.md', '.js', '.ts', '.py', '.sh', '.json', '.yaml', '.yml']);

/** 安全检查规则 */
export interface SafetyRule {
  pattern: RegExp;
  regex?: RegExp;
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
// 21 条安全规则
// ============================================================

const RULES: SafetyRule[] = [
  // === 恶意命令 (DANGEROUS) ===
  { pattern: /(^|[^a-zA-Z0-9_])rm\s+-rf\s+\//, category: '恶意命令', severity: 'DANGEROUS', description: 'rm -rf / 危险删除' },
  { pattern: /curl.*\|.*bash/, category: '恶意命令', severity: 'DANGEROUS', description: 'curl 管道执行 bash' },
  { pattern: /curl.*\|.*\bsh\b/, category: '恶意命令', severity: 'DANGEROUS', description: 'curl 管道执行 sh' },
  { pattern: /wget.*\|.*sh/, category: '恶意命令', severity: 'DANGEROUS', description: 'wget 管道执行 sh' },
  { pattern: /wget.*\|.*bash/, category: '恶意命令', severity: 'DANGEROUS', description: 'wget 管道执行 bash' },
  { pattern: /chmod\s+777\s+\//, category: '恶意命令', severity: 'DANGEROUS', description: 'chmod 777 / 全局可写' },
  { pattern: /mkfs\./, category: '恶意命令', severity: 'DANGEROUS', description: 'mkfs 格式化磁盘' },
  { pattern: /dd\s+if=.*of=\/dev\//, category: '恶意命令', severity: 'DANGEROUS', description: 'dd 磁盘覆写' },

  // === 密钥泄露 (DANGEROUS) ===
  { pattern: /AKIA[0-9A-Z]{16}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'AWS Access Key' },
  { pattern: /sk-[a-zA-Z0-9]{20,}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'OpenAI API Key' },
  { pattern: /gh[pousr]_[A-Za-z0-9]{36}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'GitHub Token' },
  { pattern: /-----BEGIN.*PRIVATE KEY-----/, category: '密钥泄露', severity: 'DANGEROUS', description: 'PEM 私钥头' },

  // === 危险调用 (SUSPICIOUS) ===
  { pattern: /eval\(.*[^0-9"'].*\)/, category: '危险调用', severity: 'SUSPICIOUS', description: 'eval() 非常量参数' },
  { pattern: /os\.system\(/, category: '危险调用', severity: 'SUSPICIOUS', description: 'os.system() 系统调用' },
  { pattern: /child_process\.exec/, category: '危险调用', severity: 'SUSPICIOUS', description: 'child_process.exec 命令执行' },
  { pattern: /subprocess\.call/, category: '危险调用', severity: 'SUSPICIOUS', description: 'subprocess.call 命令执行' },
  { pattern: /new\s+Function\(/, category: '危险调用', severity: 'SUSPICIOUS', description: 'new Function() 动态执行' },

  // === 注入攻击 / 数据外泄 (SUSPICIOUS) ===
  { pattern: /(^|[^a-zA-Z])(ignore|forget|disregard)\s+(previous|all|above)\s*(instructions|prompts|rules)/i, category: '注入攻击', severity: 'SUSPICIOUS', description: 'ignore previous instructions 注入' },
  { pattern: /webhook\.site|requestbin|pipedream/, category: '注入攻击', severity: 'SUSPICIOUS', description: '数据外泄端点' },

  // === 混淆代码 ===
  { pattern: /base64\s+.*decode/, category: '混淆代码', severity: 'SUSPICIOUS', description: 'Base64 解码（可能混淆载荷）' },
  { pattern: /eval\(atob\(/, category: '混淆代码', severity: 'DANGEROUS', description: 'eval(atob()) Base64 混淆执行' },
];

/** 预编译规则（去除 g flag，避免 lastIndex 状态问题） */
export const COMPILED_RULES: SafetyRule[] = RULES.map(r => ({
  ...r,
  regex: new RegExp(r.pattern.source, r.pattern.flags.replace(/g/g, '')),
}));
