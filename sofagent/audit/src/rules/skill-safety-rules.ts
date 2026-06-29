// ============================================================
// skill-safety-rules.ts · Skill 安全审查——规则定义
// ============================================================
// SafetyRule.pattern = 原始正则（用于 COMPILED_RULES 预编译和 SafetyHit.pattern 展示）
// SafetyRule.regex  = 编译后无 g flag 的版本（scanFile 实际使用，避免 lastIndex 状态问题）

export const VERSION = '0.97';

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
  // v0.97 新增 5 条密钥规则
  { pattern: /"type":\s*"service_account"/i, category: '密钥泄露', severity: 'DANGEROUS', description: 'Google Service Account Key' },
  { pattern: /AccountKey=[a-zA-Z0-9+/]{50,}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'Azure Storage Account Key' },
  { pattern: /xox[baprs]-[0-9a-zA-Z-]{10,}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'Slack Bot/User Token' },
  { pattern: /sk_live_[0-9a-zA-Z]{24,}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'Stripe Secret Key (Live)' },
  { pattern: /glpat-[0-9a-zA-Z\-_]{20,}/, category: '密钥泄露', severity: 'DANGEROUS', description: 'GitLab Personal Access Token' },

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

// ============================================================
// v0.97 新增密钥规则的已知 FP（误报）风险评估
// ============================================================
//
// 1. Google Service Account Key
//    模式: /"type":\s*"service_account"/i
//    FP 风险: 低。service_account JSON 键几乎不会在非密钥上下文中出现。
//    已知误报场景: 文档或博客中摘录的 Google Cloud 示例代码。
//
// 2. Azure Storage Account Key
//    模式: /AccountKey=[a-zA-Z0-9+/]{50,}/
//    FP 风险: 中。AccountKey= 前缀可能在 Azure SDK 测试 stub 代码中出现。
//    已知误报场景: Azure 示例文档中形如 AccountKey=base64encodedstring 的参数说明。
//
// 3. Slack Bot/User Token
//    模式: /xox[baprs]-[0-9a-zA-Z-]{10,}/
//    FP 风险: 低。xox 前缀是 Slack token 的明确标识，命名冲突概率极低。
//    已知误报场景: Slack Bot 开发示例中的 placeholder token 值。
//
// 4. Stripe Secret Key (Live)
//    模式: /sk_live_[0-9a-zA-Z]{24,}/
//    FP 风险: 低。sk_live_ 前缀是 Stripe 生产密钥的明确标识。
//    已知误报场景: Stripe 文档示例代码中的测试占位符 sk_live_xxx...。
//
// 5. GitLab Personal Access Token
//    模式: /glpat-[0-9a-zA-Z\-_]{20,}/
//    FP 风险: 中。glpat- 是 GitLab 15.0+ 的 PAT 前缀，但可能出现在
//    CI 配置文档或 issue 模板中。
//    已知误报场景: GitLab CI/CD 文档中的配置示例 glpat-xxxxxxxxxxxxxxxxxxxx。
