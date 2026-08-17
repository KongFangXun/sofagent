// ============================================================
// dual-gate-mw.ts · 双闸验证 middleware（v1.3.6 交付⑫ · 运维闭环增强）
// ============================================================
//
// v1.3.0 的运行时审计只做「执行前 gate」（拦截危险工具调用）。
// 双闸补「执行后副作用复查」——工具执行完后，复查实际产生的副作用
// 是否符合预期（写文件是否只写了预期文件 / git 操作是否碰了禁区 /
// 网络外联是否去了白名单外的目标）。前后双闸 = 执行前拦截 + 执行后复查。
//
// 设计要点：
//   1. postToolCall 钩子——每次工具执行后（next() 返回后）触发规则复查
//   2. 三条内置副作用复查规则：文件写入范围 / git 影响范围 / 网络外联目标
//   3. 复查异常 → 写运行时审计 WARN（emitDecision kind=TOOL_GATE）+ 熔断
//   4. 熔断语义：abortSubsequent=true（默认）时一次 WARN 后后续工具调用
//      直接返回中断消息不执行——「中断后续工具调用」的实现位
//   5. 复查是辅助通道：审计写失败静默降级，绝不因留痕失败吞掉工具结果
// ============================================================

import { emitDecision } from '@sofagent/audit';

// ============================================================
// 类型定义
// ============================================================

/** 工具调用记录（postToolCall 钩子与规则集的输入） */
export interface ToolCallRecord {
  /** 工具名 */
  toolName: string;
  /** 工具入参（规则从这里提取路径/命令/URL 做复查） */
  args: Record<string, unknown>;
  /** 调用描述（审计留痕用） */
  description?: string;
  /**
   * 预期写入路径白名单（文件写入范围规则的判据）。
   * 调用方声明「这次只该写这些路径」——实际入参路径超出即 WARN。
   * 前缀匹配语义：expectedPaths=['src/'] 允许 src/ 下任意子路径。
   */
  expectedPaths?: string[];
  /**
   * 允许外联的主机白名单（网络外联规则的判据）。
   * 入参 URL 的 host 不在列表即 WARN。不传 = 不启用该次调用的网络复查。
   */
  allowedHosts?: string[];
}

/** 副作用复查结果 */
export interface SideEffectCheckResult {
  /** PASS = 复查通过；WARN = 发现预期外副作用 */
  verdict: 'PASS' | 'WARN';
  /** 命中的规则名（WARN 时有值） */
  rule?: string;
  /** WARN 原因（审计留痕文本） */
  reason?: string;
}

/**
 * 副作用复查规则——双闸的执行后复查单元。
 * check 返回 null = PASS；返回字符串 = WARN 原因。
 */
export interface SideEffectRule {
  /** 规则名（审计留痕 + 测试断言用） */
  name: string;
  /** 复查一次工具调用（入参 + 执行结果文本） */
  check(call: ToolCallRecord, resultText: string): string | null;
}

// ============================================================
// 内置规则集（3 条：文件 / git / 网络）
// ============================================================

/** 从工具入参提取文件路径（file_path / path / target 字段） */
function extractPathFromArgs(args: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'filePath', 'path', 'target']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

/** 文件写入类工具名模式（写/删/编辑——只有这类工具才做范围复查） */
const FILE_WRITE_TOOL_PATTERNS = ['write', 'delete', 'edit', 'rm', 'remove', 'create'] as const;

/** 规则 1：文件写入范围复查——实际写入路径必须在 expectedPaths 白名单内 */
export const fileWriteScopeRule: SideEffectRule = {
  name: 'file-write-scope',
  check(call: ToolCallRecord): string | null {
    const lower = call.toolName.toLowerCase();
    const isFileWrite = FILE_WRITE_TOOL_PATTERNS.some((p) => lower.includes(p));
    if (!isFileWrite) return null;
    // 调用方未声明白名单 → 不做范围复查（零侵入：不声明不拦）
    if (!call.expectedPaths || call.expectedPaths.length === 0) return null;

    const actualPath = extractPathFromArgs(call.args);
    if (actualPath === undefined) return null; // 入参无路径字段，无从复查

    // 前缀匹配：expectedPaths 任一项是 actualPath 的前缀即放行
    const inScope = call.expectedPaths.some(
      (allowed) => actualPath === allowed || actualPath.startsWith(allowed.endsWith('/') ? allowed : `${allowed}/`),
    );
    if (inScope) return null;

    return `文件写入超出预期范围：实际写「${actualPath}」，白名单 [${call.expectedPaths.join(', ')}]`;
  },
};

/** git 危险子命令模式（影响范围复查的禁区） */
const GIT_DANGEROUS_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // push ... --force：--force 与 push 之间可能隔参数（origin main 等）——[^&|;]* 限同行不跨命令
  { pattern: /push\b[^&|;]*?(--force\b|-f\b)/i, name: 'push --force（强推覆盖远端历史）' },
  { pattern: /reset\s+--hard/i, name: 'reset --hard（丢弃工作区改动）' },
  { pattern: /clean\s+-[a-z]*f/i, name: 'clean -f（删除未跟踪文件）' },
  { pattern: /push\b[^&|;]*?(--delete\b|:\s*\S+)/, name: 'push --delete（删除远端分支）' },
];

/** 从入参提取命令文本（command / cmd / script 字段） */
function extractCommandFromArgs(args: Record<string, unknown>): string | undefined {
  for (const key of ['command', 'cmd', 'script', 'shell']) {
    const v = args[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

/** 规则 2：git 操作影响范围复查——命令不得含危险子命令 */
export const gitImpactScopeRule: SideEffectRule = {
  name: 'git-impact-scope',
  check(call: ToolCallRecord): string | null {
    const command = extractCommandFromArgs(call.args);
    if (command === undefined) return null;
    // 只复查含 git 的命令（其他命令不归此规则管）
    if (!/\bgit\b/.test(command)) return null;

    for (const { pattern, name } of GIT_DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return `git 操作命中禁区：${name}（命令：${command.slice(0, 120)}）`;
      }
    }
    return null;
  },
};

/** 从入参提取 URL（url / endpoint / target 字段 + 全文扫描 https?://） */
function extractUrlsFromArgs(args: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const value of Object.values(args)) {
    if (typeof value !== 'string') continue;
    const matches = value.match(/https?:\/\/[^\s"'`)}\]]+/g);
    if (matches) urls.push(...matches);
  }
  return urls;
}

/** 规则 3：网络外联目标复查——外联 host 必须在 allowedHosts 白名单内 */
export const networkOutboundTargetRule: SideEffectRule = {
  name: 'network-outbound-target',
  check(call: ToolCallRecord): string | null {
    // 调用方未声明白名单 → 不启用网络复查（零侵入）
    if (!call.allowedHosts || call.allowedHosts.length === 0) return null;

    const urls = extractUrlsFromArgs(call.args);
    if (urls.length === 0) return null;

    for (const url of urls) {
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        return `网络外联 URL 无法解析：${url.slice(0, 120)}`;
      }
      const allowed = call.allowedHosts.some(
        (h) => host === h || host.endsWith(`.${h}`),
      );
      if (!allowed) {
        return `网络外联目标不在白名单：${host}（白名单 [${call.allowedHosts.join(', ')}]）`;
      }
    }
    return null;
  },
};

/** 内置三条规则（文件 / git / 网络） */
export const BUILTIN_SIDE_EFFECT_RULES: readonly SideEffectRule[] = [
  fileWriteScopeRule,
  gitImpactScopeRule,
  networkOutboundTargetRule,
];

// ============================================================
// Middleware
// ============================================================

/** 双闸验证配置 */
export interface DualGateOptions {
  /**
   * 熔断开关（默认 true）：一次复查 WARN 后，后续工具调用直接返回
   * 中断消息不执行——「复查异常中断后续工具调用」的实现位。
   */
  abortSubsequent?: boolean;
  /**
   * 自定义规则集（缺省用内置三条）。传入即替换——需要「内置 + 自定义」
   * 时自行 concat BUILTIN_SIDE_EFFECT_RULES。
   */
  rules?: SideEffectRule[];
  /**
   * Agent 标识（审计留痕 agentId；缺省 'dual-gate'）。
   */
  agentId?: string;
  /**
   * 数据目录覆盖（测试用——透传 emitDecision 第二参数）。
   */
  dataDir?: string;
}

/**
 * 双闸验证 middleware——执行前 gate（调用方负责）+ 执行后副作用复查（本层）。
 *
 * 用法（与 data-sovereignty-mw 同款 wrap 模式）：
 *   const gate = new DualGateMiddleware({ expectedPaths: ['src/'] });
 *   const result = await gate.wrapToolCall(
 *     { toolName: 'write_file', args: { file_path: 'src/a.ts' } },
 *     () => tool.run(...),
 *   );
 *
 * 生命周期：
 *   next() 执行成功 → postToolCall 钩子逐条跑规则 → 全 PASS 返回结果；
 *   任一 WARN → 写审计 WARN + （默认）熔断后续调用。
 *   next() 抛错 → 不跑复查，原样抛出（复查不掩盖工具自身错误）。
 */
export class DualGateMiddleware {
  private readonly rules: readonly SideEffectRule[];
  private readonly abortSubsequent: boolean;
  private readonly agentId: string;
  private readonly dataDir?: string;
  /** 熔断状态（一次 WARN 置 true——实例级） */
  private aborted = false;
  /** 首次 WARN 的原因（中断消息引用） */
  private abortReason?: string;
  /** postToolCall 触发计数（可观测性 + 测试断言） */
  private postCallCount = 0;

  constructor(options: DualGateOptions = {}) {
    this.rules = options.rules ?? BUILTIN_SIDE_EFFECT_RULES;
    this.abortSubsequent = options.abortSubsequent ?? true;
    this.agentId = options.agentId ?? 'dual-gate';
    this.dataDir = options.dataDir;
  }

  /** 熔断是否已触发 */
  isAborted(): boolean {
    return this.aborted;
  }

  /** postToolCall 已触发次数 */
  getPostCallCount(): number {
    return this.postCallCount;
  }

  /**
   * 包装一次工具调用——执行后跑 postToolCall 钩子（副作用复查）。
   *
   * @param call 工具调用记录（toolName + args + 可选白名单声明）
   * @param next 实际工具调用
   * @returns 工具结果；复查 WARN 且熔断后返回中断消息
   */
  async wrapToolCall<T>(call: ToolCallRecord, next: () => Promise<T>): Promise<T | string> {
    // ── 熔断检查：WARN 过的实例不再放行后续调用 ──
    if (this.aborted) {
      return `⛔ [双闸中断] 此前的副作用复查未通过（${this.abortReason ?? '未知原因'}），后续工具调用已中断`;
    }

    // ── 执行工具（抛错不跑复查，原样抛出）──
    let result: T;
    try {
      result = await next();
    } catch (err) {
      throw err;
    }

    // ── postToolCall 钩子：逐条跑副作用复查规则 ──
    this.postCallCount += 1;
    const resultText = typeof result === 'string' ? result : JSON.stringify(result);
    const check = this.postToolCall(call, resultText);

    if (check.verdict === 'WARN') {
      this.writeAuditWarn(call, check);
      if (this.abortSubsequent) {
        this.aborted = true;
        this.abortReason = check.reason;
      }
      return `⚠️ [双闸复查 WARN] ${check.reason}（规则：${check.rule}）`;
    }

    return result;
  }

  /**
   * postToolCall 钩子——每次工具执行后触发，逐条跑规则集。
   * 首条 WARN 即返回（fail-fast——一次只报一个最优先的问题）。
   * 规则自身抛错 → 该规则本次不产出结论（复查组件故障不影响工具结果）。
   */
  postToolCall(call: ToolCallRecord, resultText: string): SideEffectCheckResult {
    for (const rule of this.rules) {
      try {
        const reason = rule.check(call, resultText);
        if (reason !== null) {
          return { verdict: 'WARN', rule: rule.name, reason };
        }
      } catch {
        // 规则实现异常——跳过（韧性：复查失败 ≠ 工具失败）
      }
    }
    return { verdict: 'PASS' };
  }

  /**
   * 复查 WARN 写运行时审计（emitDecision kind=TOOL_GATE——告警语义）。
   * 写失败静默降级（留痕不阻断业务，对齐 data-sovereignty-mw 哲学）。
   */
  private writeAuditWarn(call: ToolCallRecord, check: SideEffectCheckResult): void {
    try {
      emitDecision(
        {
          agentId: this.agentId,
          sessionId: `dual-gate-${Date.now()}`,
          kind: 'TOOL_GATE',
          moment: 'ACT',
          why: {
            text: `[双闸复查 WARN] ${call.toolName}：${check.reason}`,
            tags: ['dual-gate', check.rule ?? 'unknown', 'WARN'],
            confidence: 'high',
          },
        },
        this.dataDir,
      );
    } catch {
      // 审计写失败不阻断（复查结论已通过返回值传达）
    }
  }
}
