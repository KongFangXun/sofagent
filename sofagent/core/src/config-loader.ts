// ============================================================
// config-loader.ts · .sofagent/config.yml 配置加载器
// v1.1.0 从 sofagent/audit/src/config-loader.ts 迁出
// v0.95 新增：三级 fallback（v1.0.9，js-yaml 替代手写 YAML 解析器）
// v0.97 扩展：环境变量配置（从 lib/config.sh 合并）
// v1.0.9 重构：用 js-yaml 替代手写 YAML 解析器
// v1.0.9 fail-closed：YAML 解析失败时回退到安全默认值（所有规则启用）
// ============================================================
//
// 三级 fallback：
//   1. ${cwd}/.sofagent/config.yml
//   2. ~/.sofagent/config.yml
//   3. DEFAULT_CONFIG
//
// fail-closed 原则（v1.0.5）：
//   YAML 解析失败时，不再静默用默认配置——改为回退到最严格的安全默认值
//   （所有安全规则全部启用、silent=false），确保"坏了也是安全的"。
// ============================================================

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { load as yamlLoad, YAMLException } from 'js-yaml';
import { atomicWriteSync } from './shared/atomic-write';

/**
 * 审计配置——由 .sofagent/config.yml 加载
 */
export interface AuditConfig {
  /** 低风险文件模式（不计入「不改越界」检查），支持 glob 风格 */
  lowRiskPatterns: string[];
  /** 测试/构建命令模式（用于「不逃验证」规则匹配日志） */
  testPatterns: string[];
  /** 「不改越界」阈值——不相关文件占比超过此比例时 WARN */
  carefulModifyThreshold: number;
  /** 是否启用扩展规则（E1-E4 + A14 + A15） */
  extendedRulesEnabled: boolean;
  /** 按规则名禁用——key 为 a1~a15/e1~e4，value 为 false 时禁用 */
  rules?: Record<string, boolean>;
  /** loop-check 绝对轮次上限（v1.0.1），默认 20 */
  loopCheckMaxRounds?: number;
  /** v1.0.9: A16 非授权文件变更配置 */
  A16?: {
    enabled: boolean;
    protected_dirs?: string[];
    sensitive_types?: string[];
  };
  /** v1.0.9: A17 异常批量变更配置 */
  A17?: {
    enabled: boolean;
    bulk_threshold?: number;
    bulk_window_ms?: number;
  };
}

/**
 * 默认配置——当所有 fallback 都找不到配置文件时使用
 */
export const DEFAULT_CONFIG: AuditConfig = {
  lowRiskPatterns: ['package-lock.json', 'yarn.lock', '*.log', 'docs/**'],
  testPatterns: ['npm test', 'npm run test', 'pytest', 'go test'],
  carefulModifyThreshold: 0.2,
  extendedRulesEnabled: false,
};

/** 配置加载错误——YAML 语法错误时抛出 */
export class ConfigLoadError extends Error {
  filePath: string;
  line: number | string;
  column: number | string;
  constructor(message: string, filePath: string, line: number | string, column: number | string) {
    super(message);
    this.name = 'ConfigLoadError';
    this.filePath = filePath;
    this.line = line;
    this.column = column;
  }
}

/**
 * 加载审计配置（三级 fallback）
 * YAML 语法错误时：
 *   - strict 模式：抛出 ConfigLoadError（由 CLI 入口 exit 2）
 *   - 非 strict 模式：输出 WARN + 回退到安全默认值（所有规则启用）
 * @param cwd 工作目录（默认 process.cwd()）
 * @param strict 是否严格模式（YAML 语法错误时抛出异常 vs 回退安全默认值）
 * @returns 合并后的 AuditConfig
 * @throws ConfigLoadError 当 strict=true 且配置文件存在但 YAML 语法错误时
 */
export function loadConfig(cwd?: string, strict?: boolean): AuditConfig {
  const baseDir = cwd || process.cwd();

  try {
    // 1. 尝试 ${cwd}/.sofagent/config.yml
    const projectConfigPath = join(baseDir, '.sofagent', 'config.yml');
    const projectConfig = tryLoadYaml(projectConfigPath);
    if (projectConfig) {
      return mergeWithDefaults(projectConfig);
    }

    // 2. 尝试 ~/.sofagent/config.yml
    const homeConfigPath = join(homedir(), '.sofagent', 'config.yml');
    const homeConfig = tryLoadYaml(homeConfigPath);
    if (homeConfig) {
      return mergeWithDefaults(homeConfig);
    }

    // 3. 使用默认配置
    console.warn('⚠️ 未找到 .sofagent/config.yml，使用默认配置。运行 sofagent-audit --init 生成配置。');
    return { ...DEFAULT_CONFIG };
  } catch (err) {
    if (err instanceof ConfigLoadError) {
      if (strict) {
        throw err; // strict 模式：向上抛，由 CLI 入口 exit 2
      }
      // 非 strict 模式：WARN + 回退到安全默认值
      console.warn(`⚠️ ${err.message}`);
      console.warn('⚠️ 配置解析失败，回退到安全默认值（所有安全规则已启用）。建议修复配置文件后重试。');
      return safeDefaults();
    }
    throw err;
  }
}

// ============================================================
// 内部实现
// ============================================================

/**
 * 尝试从 YAML 文件加载配置，文件不存在返回 null
 * YAML 语法错误时抛出 ConfigLoadError（含行号列号），不静默回退
 * 配置结构：
 *   audit:
 *     lowRiskPatterns:
 *       - package-lock.json
 *       - yarn.lock
 *     carefulModifyThreshold: 0.2
 *     等等...
 */
function tryLoadYaml(filePath: string): Partial<AuditConfig> | null {
  if (!existsSync(filePath)) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  try {
    const parsed = yamlLoad(content) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const audit = parsed['audit'];
    if (!audit || typeof audit !== 'object') {
      // P2-3: 配置文件缺少 audit 段时提示
      console.warn('⚠️ 配置文件缺少 audit 段，使用默认配置');
      return null;
    }
    return audit as Partial<AuditConfig>;
  } catch (err) {
    // YAML 语法错误——抛出自定义异常，含行号列号
    if (err instanceof YAMLException) {
      const line = err.mark?.line != null ? err.mark.line + 1 : '?';
      const col = err.mark?.column != null ? err.mark.column + 1 : '?';
      throw new ConfigLoadError(
        `${filePath} 第 ${line} 行第 ${col} 列: ${err.reason}`,
        filePath,
        line,
        col
      );
    }
    throw new ConfigLoadError(`${filePath}: ${(err as Error).message}`, filePath, '?', '?');
  }
}

/**
 * 将部分配置与默认配置合并（缺失字段用默认值填充）
 */
function mergeWithDefaults(partial: Partial<AuditConfig>): AuditConfig {
  const merged = {
    lowRiskPatterns: partial.lowRiskPatterns ?? DEFAULT_CONFIG.lowRiskPatterns,
    testPatterns: partial.testPatterns ?? DEFAULT_CONFIG.testPatterns,
    carefulModifyThreshold: partial.carefulModifyThreshold ?? DEFAULT_CONFIG.carefulModifyThreshold,
    extendedRulesEnabled: partial.extendedRulesEnabled ?? DEFAULT_CONFIG.extendedRulesEnabled,
    rules: partial.rules,
    loopCheckMaxRounds: partial.loopCheckMaxRounds ?? 20,
  };

  // 校验 rules key——未知规则名输出警告
  if (merged.rules) {
    const knownKeys = new Set([
      'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a14', 'a15', 'a16', 'a17',
      'e1', 'e2', 'e3', 'e4',
    ]);
    for (const key of Object.keys(merged.rules)) {
      if (!knownKeys.has(key.toLowerCase())) {
        console.warn(`⚠️ config.yml: 未知规则名 "${key}"（已知: a1-a11, a14-a17, e1-e4）`);
      }
    }

    // P1-16: 安全规则被禁用时告警
    const securityRules = ['a1', 'a2'];
    for (const key of securityRules) {
      if (merged.rules[key] === false) {
        console.warn(`⚠️ 安全规则 ${key.toUpperCase()} 已被禁用——审计将不拦截${key === 'a1' ? '敏感文件' : '密钥泄漏'}`);
      }
    }
  }

  return merged;
}

// ============================================================
// v1.0.5: fail-closed 默认安全
// ============================================================

/**
 * 安全默认值——在无法信任用户配置时（YAML 解析失败等），
 * 返回最严格的默认值：所有安全规则启用、不允许静默。
 * 遵循 gstack 的 classifier_score > 0 门控哲学——
 * 默认不信任，参数格式错误时回退到安全默认值而非默认配置。
 */
export function safeDefaults(): AuditConfig {
  return {
    lowRiskPatterns: ['package-lock.json', 'yarn.lock'],
    testPatterns: ['npm test', 'npm run test', 'pytest', 'go test'],
    carefulModifyThreshold: 0.1,       // 更严格的越界阈值
    extendedRulesEnabled: true,         // A14/A15 是安全相关扩展规则，fail-closed 时必须启用
    rules: {
      a1: true, a2: true, a3: true, a4: true, a5: true,
      a6: true, a7: true, a8: true, a9: true, a10: true, a11: true,
      a14: true, a15: true,
    },
    loopCheckMaxRounds: 20,
  };
}

/**
 * 写入配置文件（原子写入）
 * v1.0.5 新增：使用原子写入防止并发写导致的配置损坏
 * @param filePath 配置文件路径
 * @param config 要写入的配置内容（YAML 字符串）
 */
export function writeConfig(filePath: string, config: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  atomicWriteSync(filePath, config);
}

// ============================================================
// v0.97: 环境变量配置（从 lib/config.sh 合并）
// ============================================================

/**
 * 运行时配置——由环境变量加载（对应 lib/config.sh 导出项）
 */
export interface SofaEnvConfig {
  /** 数据目录路径 */
  dataDir: string;
  /** 日志脱敏开关 */
  sanitizeEnabled: boolean;
  /** 内网 IP 脱敏开关 */
  sanitizeIpsEnabled: boolean;
  /** 日志保留天数 */
  retentionDays: number;
  /** 日志最大条数 */
  retentionMax: number;
  /** 写日志后是否触发清理 */
  cleanupOnRecord: boolean;
  /** 清理触发频率（1/N 概率） */
  cleanupFrequency: number;
  /** 审计日志开关 */
  auditEnabled: boolean;
}

/** 环境变量默认值 */
export const ENV_DEFAULTS: Omit<SofaEnvConfig, 'dataDir'> = {
  sanitizeEnabled: false,
  sanitizeIpsEnabled: false,
  retentionDays: 90,
  retentionMax: 500,
  cleanupOnRecord: false,
  cleanupFrequency: 10,
  auditEnabled: false,
};

/**
 * 从环境变量加载运行时配置
 * 对应 lib/config.sh 的 _parse_conf + export 逻辑
 */
export function loadEnvConfig(): SofaEnvConfig {
  const homeDir = homedir();
  const dataDir = resolveDataDir(homeDir);

  return {
    dataDir,
    sanitizeEnabled: resolveBoolEnv('SOFA_SANITIZE', ENV_DEFAULTS.sanitizeEnabled),
    sanitizeIpsEnabled: resolveBoolEnv('SOFA_SANITIZE_IPS', ENV_DEFAULTS.sanitizeIpsEnabled),
    retentionDays: resolveNumberEnv('SOFA_RETENTION_DAYS', ENV_DEFAULTS.retentionDays),
    retentionMax: resolveNumberEnv('SOFA_RETENTION_MAX', ENV_DEFAULTS.retentionMax),
    cleanupOnRecord: resolveBoolEnv('SOFA_CLEANUP_ON_RECORD', ENV_DEFAULTS.cleanupOnRecord),
    cleanupFrequency: resolveNumberEnv('SOFA_CLEANUP_FREQUENCY', ENV_DEFAULTS.cleanupFrequency),
    auditEnabled: resolveBoolEnv('SOFA_AUDIT_ENABLED', ENV_DEFAULTS.auditEnabled),
  };
}

/**
 * 解析数据目录（对应 _sofa_find_data_dir 函数）
 * 优先级：环境变量 > 当前目录 > 标记文件 > fallback
 */
function resolveDataDir(home: string): string {
  // 1. 环境变量显式指定
  if (process.env.SOFAGENT_DATA && existsSync(process.env.SOFAGENT_DATA)) {
    return process.env.SOFAGENT_DATA;
  }

  // 2. 当前目录有 .sofagent/
  const cwdData = join(process.cwd(), '.sofagent');
  if (existsSync(cwdData)) {
    return cwdData;
  }

  // 3. 标记文件
  const markers = [
    join(home, '.openclaw', 'skills', 'sofagent', '.sofagent-data-path'),
    join(home, '.workbuddy', 'skills', 'sofagent', '.sofagent-data-path'),
  ];
  for (const marker of markers) {
    if (existsSync(marker)) {
      try {
        const path = readFileSync(marker, 'utf-8').trim();
        if (path && existsSync(path)) return path;
      } catch { /* */ }
    }
  }

  // 4. fallback
  return join(process.cwd(), '.sofagent');
}

function resolveBoolEnv(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes';
}

function resolveNumberEnv(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultValue : num;
}
