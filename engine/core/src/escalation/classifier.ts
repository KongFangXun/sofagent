// ============================================================
// escalation/classifier.ts · shell 命令三态分级（v1.5.1 第五章）
// ============================================================
// 纯函数（core 零跨包 import 纪律）：
//   safe      只读/无副作用（ls / cat / grep / git status…）
//   risky     写操作/网络（npm install / curl / git commit…）
//   dangerous 删除/提权/密钥接触（rm -rf / sudo / cat ~/.ssh…）
//
// 审计落痕与 HITL 入队归调用层（orchestrator/daemon 执行侧）承接——
// DecisionKind/DecisionCategory 定义在 audit 包，core import 即违反
// 第七章依赖方向门禁（对齐第二章 ToolGate 落点裁定先例）。
//
// 分级规则可配置：企业可传 overrides 附加自定义危险模式。
// ============================================================

/** 命令三态 */
export type EscalationLevel = 'safe' | 'risky' | 'dangerous';

export interface ClassifiedCommand {
  /** 原命令 */
  command: string;
  /** 分级 */
  level: EscalationLevel;
  /** 命中依据（可解释——供决策留痕） */
  basis: string;
}

/** 只读命令前缀（safe 白名单——精确匹配首个词） */
const SAFE_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'sort', 'uniq',
  'pwd', 'whoami', 'date', 'echo', 'which', 'type', 'file', 'stat', 'du',
  'ps', 'top', 'uname', 'env', 'printenv', 'node', 'python3', 'python',
  'jq', 'awk', 'sed', 'diff', 'comm', 'cut', 'tr', 'basename', 'dirname',
]);

/** git 只读子命令（git <sub> 形态） */
const SAFE_GIT_SUB = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote', 'rev-parse',
  'ls-files', 'ls-tree', 'describe', 'blame', 'shortlog', 'reflog', 'config --get',
]);

/** 危险模式（dangerous——正则命中即危险，优先于其他判定） */
const DANGEROUS_PATTERNS: Array<{ re: RegExp; basis: string }> = [
  { re: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*|--)?\s*[^|;]*$/i, basis: '删除命令（rm）' },
  { re: /\bsudo\b/i, basis: '提权执行（sudo）' },
  { re: /\bsu\s+/i, basis: '切换用户（su）' },
  { re: /\bchmod\s+[0-7]*[67][0-7]{2}\b|\bchown\b/i, basis: '权限变更（chmod/chown 写态）' },
  { re: /~\/\.ssh|\/\.ssh\/|id_rsa|authorized_keys|\.pem\b|\.env\b/i, basis: '密钥/凭据文件接触' },
  { re: /\bgit\s+push\s+.*--force\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[a-zA-Z]*f/i, basis: '破坏性 git 操作（force/reset --hard/clean -f）' },
  { re: /\b(dd|mkfs|fdisk|diskutil)\b/i, basis: '磁盘级写入' },
  { re: /\bcurl\b[^|;]*\|\s*(ba)?sh\b|\bwget\b[^|;]*\|\s*(ba)?sh\b/i, basis: '下载即执行（curl|sh 形态）' },
  { re: /\bkubectl\s+delete\b|\bdocker\s+(rm|rmi|system\s+prune)\b/i, basis: '容器/资源删除' },
];

/** 危险模式（risky——写/网络副作用） */
const RISKY_PATTERNS: Array<{ re: RegExp; basis: string }> = [
  { re: /\bnpm\s+(install|i|uninstall|update|ci)\b/i, basis: '包管理写操作（npm install 系）' },
  { re: /\bcurl\b|\bwget\b|\bping\b|\bssh\b|\bscp\b/i, basis: '网络访问' },
  { re: /\bgit\s+(add|commit|merge|rebase|checkout|stash|pull|push|clone|fetch)\b/i, basis: 'git 写操作' },
  { re: /\b(mkdir|touch|mv|cp|tee)\b/i, basis: '文件系统写操作' },
  { re: /\bnpx\b|\bpip\d?\s+install\b|\bbrew\s+(install|uninstall)\b/i, basis: '外部包执行/安装' },
  { re: />\s*\/[^t]/, basis: '重定向写非临时文件' },
];

/** 企业自定义危险模式（可配置面） */
export interface ClassifierOverrides {
  /** 追加 dangerous 正则（basis 必填——可解释性纪律） */
  dangerousPatterns?: Array<{ re: string; basis: string }>;
  /** 追加 safe 命令名 */
  safeCommands?: string[];
}

/**
 * shell 命令三态分级（纯函数）。
 * 判定序：dangerous 模式（含企业扩展）→ safe 白名单 → risky 模式 → 缺省 risky
 * （缺省 risky 而非 safe——未知命令按有副作用处理，fail-safe）。
 */
export function classifyCommand(command: string, overrides?: ClassifierOverrides): ClassifiedCommand {
  const trimmed = command.trim();

  // 1. dangerous（内置 + 企业扩展）
  const allDangerous = [...DANGEROUS_PATTERNS];
  for (const ext of overrides?.dangerousPatterns ?? []) {
    allDangerous.push({ re: new RegExp(ext.re, 'i'), basis: `${ext.basis}（企业扩展）` });
  }
  for (const { re, basis } of allDangerous) {
    if (re.test(trimmed)) {
      return { command: trimmed, level: 'dangerous', basis };
    }
  }

  // 2. safe 白名单（首词精确匹配；git 走子命令白名单）
  const firstWord = trimmed.split(/\s+/)[0] ?? '';
  const safeSet = new Set([...SAFE_COMMANDS, ...(overrides?.safeCommands ?? [])]);
  if (firstWord === 'git') {
    const sub = trimmed.split(/\s+/)[1] ?? '';
    if (SAFE_GIT_SUB.has(sub)) {
      return { command: trimmed, level: 'safe', basis: `git 只读子命令（${sub}）` };
    }
  } else if (safeSet.has(firstWord)) {
    // echo/env 类 safe 命令若带重定向写或管道进危险命令，被 1/3 步拦——此处纯读形态
    if (!/[>]{1,2}\s*\//.test(trimmed) && !/\bsudo\b|\brm\b/i.test(trimmed)) {
      return { command: trimmed, level: 'safe', basis: `只读命令（${firstWord}）` };
    }
  }

  // 3. risky 模式
  for (const { re, basis } of RISKY_PATTERNS) {
    if (re.test(trimmed)) {
      return { command: trimmed, level: 'risky', basis };
    }
  }

  // 4. 缺省 risky（未知命令按有副作用处理）
  return { command: trimmed, level: 'risky', basis: '未命中任何白名单/模式——缺省按有副作用处理（fail-safe）' };
}
