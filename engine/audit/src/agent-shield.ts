// ============================================================
// agent-shield.ts · AgentShield 五类配置面扫描（竞品吸收①）
// v1.3.7 交付③ 新增
//
// 来源：ECC AgentShield 启发 + Check Point CVE-2025-59536 / CVE-2026-21852
// ——Agent 配置文件/工具定义/MCP 端点本身可被注入恶意指令，是独立于
//   代码变更（git diff）的攻击面。
//
// 五类扫描（全部确定性静态分析——正则 + 结构解析，零 LLM 自评）：
//   1. MCP 配置风险画像：server 权限范围 + 数据出网路径
//   2. Hook 注入分析：git hook / session hook 含恶意代码
//   3. Agent 配置审查：SKILL.md / fde.md 含越权指令或 prompt 注入
//   4. 密钥检测增强：A2 扩展——扫配置文件（不只 git diff）
//   5. Shadow AI 发现：扫进程/配置/仓库发现未注册「影子 agent」
//
// 输出接入 24 规则同一审计出口：WARN/FAIL 语义一致，可被 --ruleset 豁免
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/** 单条扫描发现 */
export interface ShieldFinding {
  /** 扫描类别（五类之一） */
  category: 'mcp-risk' | 'hook-injection' | 'agent-config' | 'secret-enhanced' | 'shadow-ai';
  /** 严重度（与 24 规则同语义） */
  severity: 'FAIL' | 'WARN' | 'INFO';
  /** 目标（文件路径/进程名/端点名） */
  target: string;
  /** 发现描述 */
  message: string;
  /** 证据（匹配行/命令输出片段） */
  evidence: string;
}

export interface ShieldScanResult {
  findings: ShieldFinding[];
  /** 扫描统计 */
  stats: { category: ShieldFinding['category'] | 'total'; count: number }[];
}

export interface ShieldOptions {
  /** Shadow AI 已知进程白名单（默认含常见合法 AI 工具——白名单内零告警） */
  knownAgentWhitelist?: string[];
  /** 是否扫描进程源（默认 true——CI 环境可关） */
  scanProcesses?: boolean;
  /** 注入检测模式列表（Agent 配置审查用，可扩展） */
  injectionPatterns?: RegExp[];
}

/** 默认已知合法 AI 工具进程白名单（可配置扩展——决议 6） */
export const DEFAULT_KNOWN_AGENTS = [
  'Claude', 'claude',            // Claude Code
  'CodeBuddy', 'codebuddy',      // 腾讯 CodeBuddy
  'Copilot', 'copilot',          // GitHub Copilot
  'WorkBuddy', 'workbuddy',
  'Cursor', 'cursor',
  'sofagent',                    // 自家
  'node', 'npm', 'npx',          // 运行时本体（误报防护）
  'Code', 'Electron', 'Google Chrome', 'Safari', // 编辑器/浏览器宿主
  'ps', 'grep', 'rg', 'bash', 'zsh', 'sh', // 扫描工具自身
];

/** MCP 端点风险画像模式（类别 1） */
const MCP_RISK_PATTERNS: Array<{ pattern: RegExp; severity: 'FAIL' | 'WARN'; message: string }> = [
  { pattern: /"(command|args)"\s*:\s*(?:"[^"]*|\[[^\]]*)["\]]?(curl|wget)\s/i, severity: 'FAIL', message: 'MCP server 定义经 curl/wget 拉取远程脚本——供应链注入风险' },
  { pattern: /"(command)"\s*:\s*"[^"]*\$\(/, severity: 'FAIL', message: 'MCP command 含命令替换 $()——动态执行风险' },
  { pattern: /"(env|ENVIRONMENT)"\s*:\s*"[^"]*(API_KEY|SECRET|TOKEN)=/i, severity: 'WARN', message: 'MCP env 内联凭证——建议改用文件/密管' },
  { pattern: /https?:\/\/(?!localhost|127\.0\.0\.1)[^"]+/i, severity: 'WARN', message: 'MCP 端点指向远程主机——数据出网路径' },
];

/** Hook 注入模式（类别 2） */
const HOOK_INJECTION_PATTERNS: Array<{ pattern: RegExp; severity: 'FAIL' | 'WARN'; message: string }> = [
  { pattern: /curl[^|]*\|\s*(ba)?sh/, severity: 'FAIL', message: 'Hook 含 curl | sh——远程代码执行' },
  { pattern: /wget[^|]*\|\s*(ba)?sh/, severity: 'FAIL', message: 'Hook 含 wget | sh——远程代码执行' },
  { pattern: /eval\s+["']\$/, severity: 'FAIL', message: 'Hook 含 eval 变量执行' },
  { pattern: /base64\s+-d\s*\|\s*(ba)?sh/, severity: 'FAIL', message: 'Hook 含 base64 解码执行——混淆载荷' },
  { pattern: /rm\s+-rf\s+\/(?!tmp|home\/\w+\/\.)/, severity: 'FAIL', message: 'Hook 含危险 rm -rf' },
  { pattern: />(\/dev\/tcp|\/proc\/self\/fd)/, severity: 'WARN', message: 'Hook 含反弹 shell 特征重定向' },
];

/** Agent 配置越权指令模式（类别 3） */
const AGENT_CONFIG_PATTERNS: Array<{ pattern: RegExp; severity: 'FAIL' | 'WARN'; message: string }> = [
  // 中文注入：忽略类指令（排除「不能忽略/请勿忽略/不要忽略」等反向表述）
  { pattern: /(?<!不能|请勿|不要|无法|绝不)(忽略|无视|跳过)[^。；\n]{0,8}(指令|规则|约束|限制)/, severity: 'FAIL', message: 'Agent 配置含指令覆盖注入（中文）' },
  { pattern: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|rules?)/i, severity: 'FAIL', message: 'Agent 配置含指令覆盖注入（英文）' },
  { pattern: /(你现在是|act\s+as)\s*(一个)?\s*(不受限制|unrestricted)/i, severity: 'WARN', message: 'Agent 配置含越狱人格设定' },
  { pattern: /(禁用|关闭|绕过|bypass|disable)\s*(审计|约束|沙箱|audit|sandbox|guard)/i, severity: 'FAIL', message: 'Agent 配置指令尝试禁用约束层' },
  { pattern: /(不要|无需|不必)(记录|留痕|审计)/, severity: 'WARN', message: 'Agent 配置指令尝试抑制审计' },
];

/** 密钥增强模式（类别 4——A2 扩展到配置文件） */
const SECRET_ENHANCED_PATTERNS: Array<{ pattern: RegExp; severity: 'FAIL' | 'WARN'; message: string }> = [
  { pattern: /(sk-[a-zA-Z0-9]{20,})/, severity: 'FAIL', message: '配置文件含 OpenAI 格式 key' },
  { pattern: /(AKIA[A-Z0-9]{16})/, severity: 'FAIL', message: '配置文件含 AWS AKIA key' },
  { pattern: /(ghp_[a-zA-Z0-9]{36})/, severity: 'FAIL', message: '配置文件含 GitHub token' },
  { pattern: /(xox[baprs]-[a-zA-Z0-9-]{10,})/, severity: 'FAIL', message: '配置文件含 Slack token' },
  { pattern: /(-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)/, severity: 'FAIL', message: '配置文件含 PEM 私钥' },
  { pattern: /"(password|passwd|secret|token)"\s*:\s*"[^"$\{][^"]{6,}"/i, severity: 'WARN', message: '配置文件含明文凭证字段' },
];

/** 影子 agent 进程检测模式（类别 5） */
const SHADOW_AI_PROCESS_PATTERNS = [
  'aider', 'continue', 'cline', 'roo', 'windsurf', 'tabnine',
  'sourcegraph-cody', 'cody', 'amazonq', 'q-developer', 'codeium',
  ' Pieces', 'pieces', 'sweep', 'devin', 'openinterpreter', 'interpreter',
  'auto-gpt', 'gpt-engineer', 'smol-developer', 'wgpt', 'evilgen',
];

/**
 * 创建 AgentShield 扫描器。
 */
export function createAgentShield(options: ShieldOptions = {}) {
  const whitelist = options.knownAgentWhitelist || DEFAULT_KNOWN_AGENTS;
  const scanProcesses = options.scanProcesses ?? true;

  /** 按模式表扫描单个文本（三类别共用逻辑） */
  function scanText(
    text: string,
    target: string,
    patterns: Array<{ pattern: RegExp; severity: 'FAIL' | 'WARN'; message: string }>,
    category: ShieldFinding['category'],
    existing: ShieldFinding[],
  ): void {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const p of patterns) {
        if (p.pattern.test(lines[i]!)) {
          existing.push({
            category,
            severity: p.severity,
            target,
            message: p.message,
            evidence: `L${i + 1}: ${lines[i]!.trim().slice(0, 120)}`,
          });
        }
      }
    }
  }

  return {
    /** 类别 1：MCP 配置风险画像——扫 mcpServers JSON 配置 */
    scanMcpConfig(configPath: string): ShieldFinding[] {
      const findings: ShieldFinding[] = [];
      if (!existsSync(configPath)) return findings;
      const text = readFileSync(configPath, 'utf-8');
      scanText(text, configPath, MCP_RISK_PATTERNS, 'mcp-risk', findings);
      return findings;
    },

    /** 类别 2：Hook 注入分析——扫 git hooks / session hooks 目录 */
    scanHooks(hooksDir: string): ShieldFinding[] {
      const findings: ShieldFinding[] = [];
      if (!existsSync(hooksDir)) return findings;
      for (const f of readdirSync(hooksDir)) {
        const p = join(hooksDir, f);
        try {
          if (f.endsWith('.sample')) continue; // git 模板样本跳过
          const stat = require('fs').statSync(p) as { isFile(): boolean };
          if (!stat.isFile()) continue;
          const text = readFileSync(p, 'utf-8');
          scanText(text, p, HOOK_INJECTION_PATTERNS, 'hook-injection', findings);
        } catch { /* 读不了的跳过 */ }
      }
      return findings;
    },

    /** 类别 3：Agent 配置审查——SKILL.md / fde.md 等约束文件 */
    scanAgentConfig(configPath: string): ShieldFinding[] {
      const findings: ShieldFinding[] = [];
      if (!existsSync(configPath)) return findings;
      const text = readFileSync(configPath, 'utf-8');
      scanText(text, configPath, AGENT_CONFIG_PATTERNS, 'agent-config', findings);
      return findings;
    },

    /** 类别 4：密钥检测增强——A2 扩展扫配置文件（不只 git diff） */
    scanSecrets(filePath: string): ShieldFinding[] {
      const findings: ShieldFinding[] = [];
      if (!existsSync(filePath)) return findings;
      const text = readFileSync(filePath, 'utf-8');
      // 二进制文件跳过内容扫描（与 A2 二进制 WARN 语义一致）
      if (text.includes('\u0000')) {
        return [{ category: 'secret-enhanced', severity: 'WARN', target: filePath, message: '二进制文件不在文本密钥扫描面（与 A2 边界一致）', evidence: 'NUL byte detected' }];
      }
      scanText(text, filePath, SECRET_ENHANCED_PATTERNS, 'secret-enhanced', findings);
      return findings;
    },

    /** 类别 5：Shadow AI 发现——进程/配置/仓库三源 */
    scanShadowAi(repoDir: string): ShieldFinding[] {
      const findings: ShieldFinding[] = [];

      // 源 A：进程扫描（白名单外 WARN 不 FAIL——决议 6）
      if (scanProcesses) {
        try {
          const ps = execSync('ps aux 2>/dev/null || true', { encoding: 'utf-8', timeout: 5000 });
          const seen = new Set<string>();
          for (const line of ps.split('\n')) {
            for (const pat of SHADOW_AI_PROCESS_PATTERNS) {
              const re = new RegExp(`/(bin/)?(${pat}[^/\\s]*)\\b`, 'i');
              const m = line.match(re);
              if (m) {
                const procName = m[2]!;
                if (seen.has(procName.toLowerCase())) continue;
                seen.add(procName.toLowerCase());
                // 白名单判定（大小写不敏感子串匹配）
                const whitelisted = whitelist.some(w => procName.toLowerCase().includes(w.toLowerCase()));
                if (!whitelisted) {
                  findings.push({
                    category: 'shadow-ai',
                    severity: 'WARN', // 白名单外 WARN 不 FAIL（决议 6）
                    target: procName,
                    message: '发现未注册的影子 AI 工具进程——绕过约束层私跑，属审计盲区',
                    evidence: line.trim().slice(0, 140),
                  });
                }
              }
            }
          }
        } catch { /* ps 不可用（非 POSIX）跳过进程源 */ }
      }

      // 源 B：配置源——常见 AI 工具配置文件出现但未在 .sofagent 注册
      const configCandidates = [
        join(require('os').homedir(), '.aider', 'conf.yml'),
        join(require('os').homedir(), '.continue', 'config.json'),
        join(require('os').homedir(), '.cline', 'settings.json'),
        join(repoDir, '.windsurf', 'rules'),
      ];
      for (const c of configCandidates) {
        if (existsSync(c)) {
          findings.push({
            category: 'shadow-ai',
            severity: 'WARN',
            target: c,
            message: '发现未注册 AI 工具配置——该工具未纳入约束层管理',
            evidence: '配置文件存在',
          });
        }
      }

      // 源 C：仓库源——.gitignore 之外的 AI 工具痕迹目录
      try {
        const entries = readdirSync(repoDir);
        for (const e of entries) {
          if (/^\.(aider|continue|cline|codeium|windsurf)/.test(e)) {
            findings.push({
              category: 'shadow-ai',
              severity: 'INFO',
              target: join(repoDir, e),
              message: '仓库内含 AI 工具痕迹目录',
              evidence: '目录存在',
            });
          }
        }
      } catch { /* 仓库不可读跳过 */ }

      return findings;
    },

    /** 全量扫描（五类一次跑完，汇总统计） */
    scanAll(paths: { mcpConfig?: string; hooksDir?: string; agentConfigs?: string[]; secretTargets?: string[]; repoDir?: string }): ShieldScanResult {
      const findings: ShieldFinding[] = [];
      if (paths.mcpConfig) findings.push(...this.scanMcpConfig(paths.mcpConfig));
      if (paths.hooksDir) findings.push(...this.scanHooks(paths.hooksDir));
      for (const c of paths.agentConfigs || []) findings.push(...this.scanAgentConfig(c));
      for (const s of paths.secretTargets || []) findings.push(...this.scanSecrets(s));
      if (paths.repoDir) findings.push(...this.scanShadowAi(paths.repoDir));

      const byCat = new Map<string, number>();
      for (const f of findings) byCat.set(f.category, (byCat.get(f.category) || 0) + 1);
      const stats: ShieldScanResult['stats'] = [...byCat.entries()].map(([category, count]) => ({ category: category as ShieldFinding['category'], count }));
      stats.push({ category: 'total', count: findings.length });
      return { findings, stats };
    },

    /** 白名单（供外部查询/扩展） */
    whitelistView(): string[] {
      return [...whitelist];
    },
  };
}

export type AgentShield = ReturnType<typeof createAgentShield>;
