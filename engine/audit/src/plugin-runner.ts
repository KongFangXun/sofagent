// ============================================================
// plugin-runner.ts · 插件类型规则执行器
// v1.4.5 (⑧-2)：规则市场——type=plugin 委托给外部 npm 包执行
//
// 插件协议：
//   type SofagentPlugin = (ctx: PluginContext) => PluginResult[]
//
//   interface PluginContext {
//     diffFiles: DiffFile[];     // git diff 解析的文件列表
//     options?: Record<string, unknown>;  // 规则集中配置的 options
//   }
//
//   interface PluginResult {
//     file: string;      // 命中的文件路径
//     line?: number;     // 行号（可选）
//     message: string;   // 违规描述
//   }
//
// 插件安装方式：
//   npm install @my-org/sofagent-plugin-custom
//   在规则集 JSON 中声明 "plugin": "@my-org/sofagent-plugin-custom"
//
// 安全约束：
//   - 插件通过 require() 动态加载——执行在 sofagent-audit 进程内
//   - 插件异常会被捕获，降级为该规则的 WARN（不中断审计）
//   - 插件返回非预期格式会被校验并跳过无效结果
// ============================================================

import type { DiffFile } from '@sofagent/core';
import type { RuleCheck } from './rules/types';
import type { RulesetSeverity } from './ruleset-loader';

// ============================================================
// 类型定义
// ============================================================

/** 插件上下文——传给插件函数的参数 */
export interface PluginContext {
  /** git diff 解析的文件列表 */
  diffFiles: DiffFile[];
  /** 规则集中配置的可选参数 */
  options?: Record<string, unknown>;
}

/** 插件返回的单条检测结果 */
export interface PluginResult {
  /** 命中的文件路径 */
  file: string;
  /** 行号（可选，缺省不显示行号） */
  line?: number;
  /** 违规描述消息 */
  message: string;
}

/** 插件函数签名 */
export type SofagentPlugin = (ctx: PluginContext) => PluginResult[];

/** plugin 类型规则的完整配置（从 RulesetRule 转换而来） */
export interface PluginRuleConfig {
  /** 规则 ID */
  id: string;
  /** 规则显示名称 */
  name: string;
  /** npm 包名 */
  plugin: string;
  /** 严重级别 */
  severity: RulesetSeverity;
  /** 传给插件的可选参数 */
  options?: Record<string, unknown>;
  /** 匹配时输出的消息模板 */
  message?: string;
}

// ============================================================
// 模块加载器——可注入，便于测试
// ============================================================

/** 默认模块加载函数（Node.js require） */
let _moduleLoader: (name: string) => unknown = (name: string) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(name);
};

/**
 * 注入自定义模块加载器（测试用）
 * @param fn 自定义加载函数
 */
export function _setModuleLoader(fn: (name: string) => unknown): void {
  _moduleLoader = fn;
}

/** 恢复默认模块加载器（测试用） */
export function _resetModuleLoader(): void {
  _moduleLoader = (name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name);
  };
}

// ============================================================
// 插件加载
// ============================================================

/**
 * 动态加载 npm 插件包
 *
 * 插件可以两种形式导出：
 *   1. 默认导出函数：module.exports = function(ctx) { ... }
 *   2. 命名导出 run：module.exports = { run: function(ctx) { ... } }
 *
 * @param packageName npm 包名
 * @returns 插件函数
 * @throws Error 包不存在或导出格式不符合协议
 */
export function loadPlugin(packageName: string): SofagentPlugin {
  let mod: unknown;
  try {
    mod = _moduleLoader(packageName);
  } catch (err) {
    throw new Error(
      `插件 "${packageName}" 加载失败: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 默认导出函数
  if (typeof mod === 'function') {
    return mod as SofagentPlugin;
  }

  // 命名导出 run
  if (typeof mod === 'object' && mod !== null) {
    const obj = mod as Record<string, unknown>;
    if (typeof obj.run === 'function') {
      return obj.run as SofagentPlugin;
    }
    if (typeof obj.default === 'function') {
      return obj.default as SofagentPlugin;
    }
  }

  throw new Error(
    `插件 "${packageName}" 导出格式不符合协议——需要导出一个函数或 { run: Function }`
  );
}

/**
 * 校验插件返回的结果格式
 *
 * @param raw 插件返回的原始值
 * @returns 合法的 PluginResult 数组（过滤掉无效条目）
 */
export function validatePluginResults(raw: unknown): PluginResult[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const valid: PluginResult[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.file !== 'string' || !r.file) continue;
    if (typeof r.message !== 'string' || !r.message) continue;
    // line 可选，但必须是数字
    const line = r.line !== undefined ? r.line : undefined;
    if (line !== undefined && typeof line !== 'number') continue;

    valid.push({
      file: r.file,
      message: r.message,
      line: typeof line === 'number' ? line : undefined,
    });
  }

  return valid;
}

// ============================================================
// 插件规则执行
// ============================================================

/**
 * 执行单条 plugin 类型规则
 *
 * 加载外部 npm 包，调用插件函数，收集结果转为 RuleCheck。
 * 插件异常会被捕获——降级为该规则的 WARN，不中断审计。
 *
 * @param config 插件规则配置
 * @param diffFiles diff 文件列表
 * @returns 规则检查结果
 */
export function runPluginRule(
  config: PluginRuleConfig,
  diffFiles: DiffFile[]
): RuleCheck {
  // 1. 加载插件
  let plugin: SofagentPlugin;
  try {
    plugin = loadPlugin(config.plugin);
  } catch (err) {
    // v1.4.5 T13: severity=FAIL 的插件加载失败按 FAIL 输出——
    // 此前无条件降 WARN：规则集声明该插件为阻断级（FAIL），加载失败
    // （包未装/被篡改/版本漂移）时静默降 WARN = 阻断线自己给自己放水。
    // WARN 级插件保持 WARN 降级（插件缺失不该阻断 advisory 检查）。
    return {
      name: config.name,
      number: 0,
      status: config.severity === 'FAIL' ? 'FAIL' : 'WARN',
      details: [
        `插件加载失败 (${config.plugin}): ${err instanceof Error ? err.message : String(err)}`
      ],
      ruleClass: '工程规范',
    };
  }

  // 2. 执行插件
  let rawResults: unknown;
  try {
    rawResults = plugin({
      diffFiles,
      options: config.options,
    });
  } catch (err) {
    // v1.4.5 T13: 同上——severity=FAIL 的插件执行 crash 按 FAIL 输出
    return {
      name: config.name,
      number: 0,
      status: config.severity === 'FAIL' ? 'FAIL' : 'WARN',
      details: [
        `插件执行异常 (${config.plugin}): ${err instanceof Error ? err.message : String(err)}`
      ],
      ruleClass: '工程规范',
    };
  }

  // 3. 校验返回格式
  const pluginResults = validatePluginResults(rawResults);

  // 4. 转为 details
  const details: string[] = [];
  for (const r of pluginResults) {
    const location = r.line !== undefined ? `${r.file}:${r.line}` : r.file;
    const message = config.message
      ? config.message
        .replace(/\{file\}/g, r.file)
        .replace(/\{line\}/g, r.line !== undefined ? String(r.line) : '')
      : r.message;
    details.push(`${location}: ${message}`);
  }

  return {
    name: config.name,
    number: 0,
    status: details.length > 0 ? config.severity : 'PASS',
    details,
    ruleClass: config.severity === 'FAIL' ? '业务底线' : '工程规范',
  };
}
