// ============================================================
// ruleset-loader.ts · JSON 规则集加载器
// v1.3.7 (⑧-2)：规则市场核心——从 JSON 加载规则集，支持 pattern + plugin 两种类型
//
// JSON 规则集格式：
// {
//   "name": "sofagent",
//   "version": "1.0.0",
//   "description": "默认规则集",
//   "rules": [
//     {
//       "id": "no-secrets",
//       "name": "密钥泄漏检测",
//       "severity": "FAIL",
//       "type": "pattern",
//       "pattern": "(?i)(api_key|secret|password|token)...",
//       "filePattern": "\\.(ts|js|py)$",
//       "message": "检测到疑似硬编码密钥"
//     },
//     {
//       "id": "custom-check",
//       "name": "自定义检查",
//       "severity": "WARN",
//       "type": "plugin",
//       "plugin": "@my-org/sofagent-plugin-custom",
//       "options": {}
//     }
//   ]
// }
//
// 用法：
//   const ruleset = loadRuleset('sofagent');           // 加载内置规则集
//   const ruleset = loadRulesetFromPath('./my-rules'); // 加载本地规则集目录
//   const results = runRulesetRules(diffFiles, ruleset); // 运行规则集
//   const available = listAvailableRulesets();          // 列出可用规则集
// ============================================================

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import type { DiffFile } from '@sofagent/core';
import type { RuleCheck } from './rules/types';
import { runPluginRule, type PluginRuleConfig } from './plugin-runner';

// ============================================================
// 类型定义
// ============================================================

/** 规则严重级别 */
export type RulesetSeverity = 'FAIL' | 'WARN';

/** JSON 规则的两种类型 */
export type RulesetRuleType = 'pattern' | 'plugin';

/** JSON 规则集 schema 中的单条规则 */
export interface RulesetRule {
  /** 规则唯一 ID（用于去重和引用） */
  id: string;
  /** 规则显示名称 */
  name: string;
  /** 规则描述 */
  description?: string;
  /** 严重级别：FAIL = 违规（exit 2），WARN = 警告（exit 1） */
  severity: RulesetSeverity;
  /** 规则类型：pattern = 内置正则，plugin = 外部 npm 包 */
  type: RulesetRuleType;
  // --- pattern 类型专属 ---
  /** 正则匹配模式（对 diff 新增行做匹配） */
  pattern?: string;
  /** 文件名过滤正则（可选，不设则匹配所有文件） */
  filePattern?: string;
  /** 匹配时输出的消息模板（支持 {match} / {file} / {line} 占位符） */
  message?: string;
  // --- plugin 类型专属 ---
  /** npm 包名（type=plugin 时必填） */
  plugin?: string;
  /** 传给插件的可选参数 */
  options?: Record<string, unknown>;
}

/** JSON 规则集 schema */
export interface Ruleset {
  /** 规则集名称（唯一标识，如 sofagent / security） */
  name: string;
  /** 规则集版本 */
  version: string;
  /** 规则集描述 */
  description?: string;
  /** 作者信息 */
  author?: string;
  /** 规则集主页 URL */
  homepage?: string;
  /** 规则列表 */
  rules: RulesetRule[];
}

/** 加载规则集时的错误 */
export class RulesetLoadError extends Error {
  constructor(message: string, public readonly rulesetName?: string) {
    super(message);
    this.name = 'RulesetLoadError';
  }
}

/** 规则集校验错误（JSON 格式不合法） */
export class RulesetValidationError extends Error {
  constructor(message: string, public readonly errors: string[]) {
    super(message);
    this.name = 'RulesetValidationError';
  }
}

// ============================================================
// 内置规则集目录解析
// ============================================================

/**
 * 获取内置规则集目录路径
 *
 * 内置规则集打包在 @sofagent/audit 的 dist/ 下：
 *   dist/rulesets/sofagent.json
 *   dist/rulesets/security.json
 *
 * 开发模式下（src/ 直接运行），规则集 JSON 在源码目录的 ../rulesets/
 */
function getBuiltinRulesetsDir(): string {
  // dist/ruleset-loader.js → ../rulesets/
  // src/ruleset-loader.ts → ../rulesets/ (开发模式，由 vitest 处理)
  return join(__dirname, 'rulesets');
}

// ============================================================
// JSON 解析与校验
// ============================================================

/**
 * 校验规则集 JSON 结构完整性
 *
 * @param raw 原始 JSON 对象
 * @throws RulesetValidationError 当结构不合法时
 */
export function validateRuleset(raw: unknown): asserts raw is Ruleset {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    throw new RulesetValidationError('规则集根对象必须是一个 JSON 对象', ['root: must be object']);
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== 'string' || !obj.name) {
    errors.push('name: 必须是非空字符串');
  }
  if (typeof obj.version !== 'string' || !obj.version) {
    errors.push('version: 必须是非空字符串');
  }
  if (!Array.isArray(obj.rules)) {
    errors.push('rules: 必须是数组');
  } else {
    const rules = obj.rules as unknown[];
    rules.forEach((rule, i) => {
      const prefix = `rules[${i}]`;
      if (typeof rule !== 'object' || rule === null) {
        errors.push(`${prefix}: 必须是对象`);
        return;
      }
      const r = rule as Record<string, unknown>;
      if (typeof r.id !== 'string' || !r.id) {
        errors.push(`${prefix}.id: 必须是非空字符串`);
      }
      if (typeof r.name !== 'string' || !r.name) {
        errors.push(`${prefix}.name: 必须是非空字符串`);
      }
      if (r.severity !== 'FAIL' && r.severity !== 'WARN') {
        errors.push(`${prefix}.severity: 必须是 FAIL 或 WARN`);
      }
      if (r.type !== 'pattern' && r.type !== 'plugin') {
        errors.push(`${prefix}.type: 必须是 pattern 或 plugin`);
      }
      // pattern 类型必须有 pattern 正则
      if (r.type === 'pattern') {
        if (typeof r.pattern !== 'string' || !r.pattern) {
          errors.push(`${prefix}.pattern: type=pattern 时必须提供非空正则字符串`);
        }
      }
      // plugin 类型必须有 plugin 包名
      if (r.type === 'plugin') {
        if (typeof r.plugin !== 'string' || !r.plugin) {
          errors.push(`${prefix}.plugin: type=plugin 时必须提供 npm 包名`);
        }
      }
    });
  }

  if (errors.length > 0) {
    throw new RulesetValidationError('规则集校验失败', errors);
  }
}

// ============================================================
// 规则集加载
// ============================================================

/**
 * 从 JSON 文件路径加载单个规则集
 *
 * @param filePath JSON 文件路径
 * @returns 解析后的规则集
 * @throws RulesetLoadError 文件不存在或读取失败
 * @throws RulesetValidationError JSON 格式不合法
 */
export function loadRulesetFile(filePath: string): Ruleset {
  if (!existsSync(filePath)) {
    throw new RulesetLoadError(`规则集文件不存在: ${filePath}`);
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new RulesetLoadError(
      `规则集文件读取失败: ${filePath} — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    throw new RulesetValidationError(
      `JSON 解析失败: ${filePath}`,
      [err instanceof Error ? err.message : String(err)]
    );
  }

  validateRuleset(raw);
  return raw;
}

/**
 * 按名称加载内置规则集
 *
 * 内置规则集名称：
 *   - sofagent：完整规则集（24 条模式规则，覆盖安全/质量/工程规范）
 *   - security：安全子集（仅安全相关规则，适合 CI 严格模式）
 *
 * @param name 规则集名称（sofagent / security）
 * @returns 解析后的规则集
 * @throws RulesetLoadError 内置规则集不存在
 */
export function loadRuleset(name: string): Ruleset {
  const dir = getBuiltinRulesetsDir();
  const filePath = join(dir, `${name}.json`);

  if (!existsSync(filePath)) {
    const available = listBuiltinRulesetNames();
    throw new RulesetLoadError(
      `内置规则集 "${name}" 不存在。可用规则集: ${available.join(', ')}`,
      name
    );
  }

  return loadRulesetFile(filePath);
}

/**
 * 从本地目录加载规则集
 *
 * 目录结构：每个 .json 文件是一个规则集，文件名（不含 .json）即规则集名称。
 * 如果目录中有 index.json，则只加载该文件。
 *
 * @param dirPath 本地规则集目录
 * @param name 可选规则集名称（不传则加载目录下 index.json 或第一个 .json）
 * @returns 解析后的规则集
 * @throws RulesetLoadError 目录不存在或无规则集文件
 */
export function loadRulesetFromPath(dirPath: string, name?: string): Ruleset {
  const absPath = resolve(dirPath);

  if (!existsSync(absPath)) {
    throw new RulesetLoadError(`规则集目录不存在: ${absPath}`);
  }

  // 如果 name 指定，直接加载 name.json
  if (name) {
    return loadRulesetFile(join(absPath, `${name}.json`));
  }

  // 优先加载 index.json
  const indexPath = join(absPath, 'index.json');
  if (existsSync(indexPath)) {
    return loadRulesetFile(indexPath);
  }

  // 否则加载第一个 .json 文件
  let files: string[];
  try {
    files = readdirSync(absPath).filter((f) => f.endsWith('.json'));
  } catch (err) {
    throw new RulesetLoadError(
      `规则集目录读取失败: ${absPath} — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (files.length === 0) {
    throw new RulesetLoadError(`目录中没有 .json 规则集文件: ${absPath}`);
  }

  return loadRulesetFile(join(absPath, files[0]!));
}

// ============================================================
// 规则集列表
// ============================================================

/**
 * 列出内置规则集名称
 *
 * @returns 内置规则集名称数组
 */
export function listBuiltinRulesetNames(): string[] {
  const dir = getBuiltinRulesetsDir();
  if (!existsSync(dir)) {
    return [];
  }
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 列出本地目录中的规则集名称
 *
 * @param dirPath 本地规则集目录
 * @returns 规则集名称数组
 */
export function listLocalRulesetNames(dirPath: string): string[] {
  const absPath = resolve(dirPath);
  if (!existsSync(absPath)) {
    return [];
  }
  try {
    return readdirSync(absPath)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 列出所有可用规则集（内置 + 本地，如有本地路径）
 *
 * @param localPath 可选的本地规则集目录
 * @returns 规则集信息数组
 */
export interface RulesetInfo {
  name: string;
  source: 'builtin' | 'local';
  description?: string;
}

export function listAvailableRulesets(localPath?: string): RulesetInfo[] {
  const result: RulesetInfo[] = [];

  // 内置规则集
  for (const name of listBuiltinRulesetNames()) {
    let description: string | undefined;
    try {
      const rs = loadRuleset(name);
      description = rs.description;
    } catch {
      // 加载失败只跳过描述
    }
    result.push({ name, source: 'builtin', description });
  }

  // 本地规则集
  if (localPath) {
    for (const name of listLocalRulesetNames(localPath)) {
      let description: string | undefined;
      try {
        const rs = loadRulesetFromPath(localPath, name);
        description = rs.description;
      } catch {
        // 加载失败只跳过描述
      }
      result.push({ name, source: 'local', description });
    }
  }

  return result;
}

// ============================================================
// 规则集执行——将 JSON 规则转为 RuleCheck[]
// ============================================================

/**
 * 转义正则字符串中的特殊占位符
 * message 模板支持 {match} / {file} / {line}
 */
function formatMessage(
  template: string | undefined,
  ctx: { match?: string; file?: string; line?: number }
): string {
  if (!template) return '规则命中';
  return template
    .replace(/\{match\}/g, ctx.match ?? '')
    .replace(/\{file\}/g, ctx.file ?? '')
    .replace(/\{line\}/g, ctx.line !== undefined ? String(ctx.line) : '');
}

/**
 * 编译 ruleset 的 pattern 字符串为 RegExp
 *
 * 支持 grep/ripgrep 风格的前导内联修饰符（如 (?i) / (?im) / (?ims)），
 * 自动剥离并转换为 JS RegExp flags——JS 原生不支持内联修饰符语法，
 * 在编译层统一转换，社区 ruleset 无需感知差异。
 *
 * v1.3.4 P1-10：编译前先跑 ReDoS 检测——邪恶 pattern（如 `(a+)+`）拒绝编译。
 *
 * @param pattern 原始 pattern 字符串
 * @param baseFlags 基础 flags（如 'g'）
 * @returns 编译后的 RegExp
 * @throws Error 当 pattern 检测到 ReDoS 风险时
 */
function compilePattern(pattern: string, baseFlags: string): RegExp {
  // v1.3.4 P1-10: ReDoS 静态检测——编译前拦截邪恶 pattern
  const redosWarning = detectReDoSPattern(pattern);
  if (redosWarning) {
    throw new Error(`ReDoS 风险: ${redosWarning}`);
  }

  let flags = baseFlags;
  let body = pattern;
  // 匹配前导内联修饰符：(?i) (?im) (?ims) 等
  const modifierMatch = body.match(/^\(\?([ims]+)\)/);
  if (modifierMatch) {
    const mods = modifierMatch[1] ?? '';
    if (mods.includes('i')) flags += 'i';
    if (mods.includes('m')) flags += 'm';
    if (mods.includes('s')) flags += 's';
    body = body.slice(modifierMatch[0].length);
  }
  return new RegExp(body, flags);
}

/**
 * v1.3.4 P1-10: ReDoS 静态检测 + 运行时 timeout 包裹
 *
 * 邪恶 pattern 经 catastrophic backtracking 可无限挂死审计进程。
 * 本模块做两层防护：
 *   1. 静态检测：嵌套量词模式（如 `(a+)+` / `(a*)*`）→ 直接拒绝
 *   2. 运行时 timeout：pattern.exec 超时 → 判定危险，拒绝该规则
 */

/** ReDoS 超时阈值（ms）——超过此时间判定为危险 pattern */
const REDOS_TIMEOUT_MS = 100;

/**
 * 静态检测邪恶 pattern——嵌套量词是 catastrophic backtracking 的经典模式
 *
 * @returns 检测到的危险描述（null = 安全）
 */
export function detectReDoSPattern(pattern: string): string | null {
  // 嵌套量词模式——catastrophic backtracking 的经典来源
  // 匹配 (X+)+ / (X*)* / (X+)* / (X*)+ 等，其中 X 是非量词字符序列
  const nestedQuantifier = /\(([^()]*?)(?:\+|\*|\{)\)\s*(?:\+|\*|\{)/;
  if (nestedQuantifier.test(pattern)) {
    return '检测到嵌套量词（如 (a+)+ / (a*)*），可能导致 catastrophic backtracking';
  }

  // 另一类：重叠交替（如 (a|a)*）——虽然不是嵌套量词但也可能导致指数回溯
  const overlappingAlt = /\(([^()]*?)\|([^()]*?)\)\s*(?:\+|\*)/;
  const altMatch = pattern.match(overlappingAlt);
  if (altMatch && altMatch[1] && altMatch[2]) {
    // 只在两分支有公共前缀时才判定危险
    const a = altMatch[1].trim();
    const b = altMatch[2].trim();
    if (a.length > 0 && b.length > 0 && a[0] === b[0]) {
      return '检测到重叠交替量词（如 (a|a)*），可能导致指数回溯';
    }
  }

  return null;
}

/**
 * 运行时 ReDoS timeout 检测——用一段对抗性输入测试 pattern 是否会挂死
 *
 * @param regex 已编译的正则
 * @param ruleName 规则名（用于告警）
 * @returns true = 安全（未超时），false = 危险（超时）
 */
export function isPatternReDoSSafe(regex: RegExp, ruleName?: string): boolean {
  // 构造对抗性输入——重复字符 + 结尾不匹配（最容易触发回溯的模式）
  const adversarialInput = 'a'.repeat(30) + '!';

  try {
    const start = Date.now();
    // 重置 lastIndex（全局正则）
    regex.lastIndex = 0;
    regex.test(adversarialInput);
    const elapsed = Date.now() - start;

    if (elapsed > REDOS_TIMEOUT_MS) {
      if (ruleName) {
        console.warn(
          `[sofagent] ⚠️ 规则 "${ruleName}" 的 pattern 运行超时（${elapsed}ms），可能导致 ReDoS，已拒绝加载`
        );
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 执行单条 pattern 类型规则
 *
 * 对 diff 中每个文件的新增行（以 + 开头，非 +++）做正则匹配，命中则收集为 detail。
 * DiffFile.lines 是原始 diff 行，如 "+const key = 'xxx'" / "-old line" / " context"。
 *
 * @param rule 规则集规则定义
 * @param diffFiles diff 文件列表
 * @returns 规则检查结果
 */
export function runPatternRule(
  rule: RulesetRule,
  diffFiles: DiffFile[]
): RuleCheck {
  const details: string[] = [];
  const severity = rule.severity;

  let regex: RegExp;
  try {
    regex = compilePattern(rule.pattern!, 'g');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // v1.3.4 P1-10: ReDoS pattern 被拒绝时输出显著告警
    if (errMsg.includes('ReDoS')) {
      console.warn(`[sofagent] ⚠️ 规则 "${rule.name}" 的 pattern 可能导致 ReDoS，已拒绝加载`);
    }
    return {
      name: rule.name,
      number: 0,
      status: 'WARN',
      details: [`规则 "${rule.name}" 的正则无效: ${errMsg}`],
    };
  }

  // v1.3.4 P1-10: 运行时 ReDoS timeout 检测——对抗性输入测试
  if (!isPatternReDoSSafe(regex, rule.name)) {
    return {
      name: rule.name,
      number: 0,
      status: 'WARN',
      details: [`规则 "${rule.name}" 的 pattern 运行超时，判定为 ReDoS 风险，已拒绝执行`],
    };
  }

  let fileRegex: RegExp | null = null;
  if (rule.filePattern) {
    try {
      fileRegex = compilePattern(rule.filePattern, '');
    } catch {
      // 文件过滤正则无效 → 不过滤（匹配所有文件）
      fileRegex = null;
    }
  }

  for (const file of diffFiles) {
    // 文件名过滤
    if (fileRegex && !fileRegex.test(file.path)) {
      continue;
    }

    // DiffFile.lines 是原始 diff 行，如 "+const x = 1" / "-old" / " context"
    // 遍历所有行，对新增行（以 + 开头且非 +++）做正则匹配
    for (const rawLine of file.lines) {
      // 只检查新增行（以 + 开头且不是 +++）
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        const content = rawLine.substring(1);
        // 重置 regex lastIndex（全局正则在循环中需要重置）
        regex.lastIndex = 0;
        const match = regex.exec(content);
        if (match) {
          const detail = formatMessage(rule.message, {
            match: match[0],
            file: file.path,
          });
          details.push(`${file.path}: ${detail}`);
        }
      }
    }
  }

  return {
    name: rule.name,
    number: 0,
    status: details.length > 0 ? severity : 'PASS',
    details,
    ruleClass: severity === 'FAIL' ? '业务底线' : '工程规范',
  };
}

/**
 * 执行整个规则集，返回所有规则的检查结果
 *
 * pattern 类型规则同步执行（正则匹配），
 * plugin 类型规则委托给 plugin-runner 异步加载执行。
 *
 * @param diffFiles diff 文件列表
 * @param ruleset 加载的规则集
 * @returns 规则检查结果数组
 */
export function runRulesetRules(
  diffFiles: DiffFile[],
  ruleset: Ruleset
): RuleCheck[] {
  const results: RuleCheck[] = [];

  for (const rule of ruleset.rules) {
    if (rule.type === 'pattern') {
      results.push(runPatternRule(rule, diffFiles));
    } else if (rule.type === 'plugin') {
      const pluginConfig: PluginRuleConfig = {
        id: rule.id,
        name: rule.name,
        plugin: rule.plugin!,
        severity: rule.severity,
        options: rule.options,
        message: rule.message,
      };
      results.push(runPluginRule(pluginConfig, diffFiles));
    }
  }

  return results;
}

/**
 * 从规则检查结果数组计算退出码
 *
 * @param results 规则检查结果数组
 * @returns 退出码（0=全通过，1=有警告，2=有违规）
 */
export function computeExitCode(results: RuleCheck[]): number {
  let hasFail = false;
  let hasWarn = false;
  for (const r of results) {
    if (r.status === 'FAIL') hasFail = true;
    else if (r.status === 'WARN') hasWarn = true;
  }
  if (hasFail) return 2;
  if (hasWarn) return 1;
  return 0;
}

// ============================================================
// CLI 格式化输出辅助
// ============================================================

/**
 * 格式化规则集列表为可读字符串（供 --list-rulesets 输出）
 *
 * @param infos 规则集信息数组
 * @returns 可读的规则集列表字符串
 */
export function formatRulesetList(infos: RulesetInfo[]): string {
  if (infos.length === 0) {
    return '暂无可用规则集。';
  }

  const lines: string[] = ['可用规则集:', ''];
  for (const info of infos) {
    const tag = info.source === 'builtin' ? '[内置]' : '[本地]';
    const desc = info.description ? ` — ${info.description}` : '';
    lines.push(`  ${tag} ${info.name}${desc}`);
  }
  lines.push('');
  lines.push('用法: sofagent-audit --diff HEAD~1..HEAD --ruleset <name>');
  return lines.join('\n');
}
