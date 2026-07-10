// ============================================================
// config-loader.ts · .sofagent/config.yml 配置加载器
// v0.95 新增：三级 fallback（v1.0.0，js-yaml 替代手写 YAML 解析器）
// v0.97 扩展：环境变量配置（从 lib/config.sh 合并）
// v1.0.0 重构：用 js-yaml 替代手写 YAML 解析器
// ============================================================
//
// 三级 fallback：
//   1. ${cwd}/.sofagent/config.yml
//   2. ~/.sofagent/config.yml
//   3. DEFAULT_CONFIG
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { load as yamlLoad } from 'js-yaml';

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
  /** 是否启用扩展规则（E1-E4） */
  extendedRulesEnabled: boolean;
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

/**
 * 加载审计配置（三级 fallback）
 * @param cwd 工作目录（默认 process.cwd()）
 * @returns 合并后的 AuditConfig
 */
export function loadConfig(cwd?: string): AuditConfig {
  const baseDir = cwd || process.cwd();

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
  return { ...DEFAULT_CONFIG };
}

// ============================================================
// 内部实现
// ============================================================

/**
 * 尝试从 YAML 文件加载配置，文件不存在或解析失败时返回 null
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
      return null;
    }
    return audit as Partial<AuditConfig>;
  } catch {
    return null;
  }
}

/**
 * 将部分配置与默认配置合并（缺失字段用默认值填充）
 */
function mergeWithDefaults(partial: Partial<AuditConfig>): AuditConfig {
  return {
    lowRiskPatterns: partial.lowRiskPatterns ?? DEFAULT_CONFIG.lowRiskPatterns,
    testPatterns: partial.testPatterns ?? DEFAULT_CONFIG.testPatterns,
    carefulModifyThreshold: partial.carefulModifyThreshold ?? DEFAULT_CONFIG.carefulModifyThreshold,
    extendedRulesEnabled: partial.extendedRulesEnabled ?? DEFAULT_CONFIG.extendedRulesEnabled,
  };
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
