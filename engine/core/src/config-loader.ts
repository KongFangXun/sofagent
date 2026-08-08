// ============================================================
// config-loader.ts · .sofagent/config.yml 配置加载器
// v0.95 新增：三级 fallback（v1.2.9，js-yaml 替代手写 YAML 解析器）
// v0.97 扩展：环境变量配置（从 lib/config.sh 合并）
// v1.2.9 重构：用 js-yaml 替代手写 YAML 解析器
// v1.2.9 fail-closed：YAML 解析失败时回退到安全默认值（所有规则启用）
// v1.2.9：新增 ConfigParseError（含 cause 链），audit.strict fail-closed 选项
// ============================================================
//
// 三级 fallback（v1.2.9: 增加 SOFAGENT_CONFIG 环境变量为最高优先级）：
//   0. $SOFAGENT_CONFIG（环境变量指定路径，企业集中管控）
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
import { createHmac, timingSafeEqual } from 'crypto';
import { atomicWriteSync } from './shared/atomic-write';
import { getHmacKey, stableStringify } from './audit-history';
import { getConfigFile } from './data-paths';
import { BASELINE_RULE_KEYS } from './shared/rule-constants';
import { resolveEnvBool, resolveEnvNumber } from './shared/env';

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
  /** 是否启用扩展规则（E1-E4 + A14-A17） */
  extendedRulesEnabled: boolean;
  /** 按规则名禁用——key 为 a1~a23/e1~e4，value 为 false 时禁用 */
  rules?: Record<string, boolean>;
  /** loop-check 绝对轮次上限（v1.0.1），默认 20 */
  loopCheckMaxRounds?: number;
  /** v1.1.3: audit.strict fail-closed——strict 时规则缺失/解析失败直接 FAIL */
  strict?: boolean;
  /** v1.1.0: A16 非授权文件变更配置 */
  A16?: {
    enabled: boolean;
    protected_dirs?: string[];
    sensitive_types?: string[];
  };
  /** v1.1.0: A17 异常批量变更配置 */
  A17?: {
    enabled: boolean;
    bulk_threshold?: number;
    bulk_window_ms?: number;
  };
  /** v1.1.5: FORGE 编排配置 */
  loop?: {
    maxTurns?: {
      /** engineer Sub Agent 最大轮次（默认 20） */
      engineer?: number;
      /** reviewer Sub Agent 最大轮次（默认 15） */
      reviewer?: number;
    };
  };
  /** v1.1.6: webhook 推送配置——CLI --webhook/--webhook-url 未传时回退到此 */
  webhook?: {
    /** webhook 平台：dingtalk / feishu / wecom */
    platform?: 'dingtalk' | 'feishu' | 'wecom';
    /** webhook URL（完整 URL，含 token query 参数） */
    url?: string;
  };
  /** v1.2.0: toolGate 前置拦截配置——orchestrator tool call 事前规则检查 */
  toolGate?: {
    /** 是否启用 tool gate 前置拦截（默认 true） */
    enabled: boolean;
    /** WARN 是否升级为 FAIL 阻断（默认 false，WARN 不阻断） */
    warnAsFail: boolean;
  };
  /** v1.2.8: 自定义脱敏正则——企业业务机密（合同名称/客户名单/工资表等） */
  sanitizePatterns?: { pattern: string; replacement: string }[];
}

/**
 * 默认配置——当所有 fallback 都找不到配置文件时使用
 */
export const DEFAULT_CONFIG: AuditConfig = {
  lowRiskPatterns: ['package-lock.json', 'yarn.lock', '*.log', 'docs/**'],
  testPatterns: ['npm test', 'npm run test', 'pytest', 'go test'],
  carefulModifyThreshold: 0.2,
  extendedRulesEnabled: false,
  toolGate: { enabled: true, warnAsFail: false },
};

/** 配置加载错误——YAML 语法错误时抛出（v1.1.3: 保留向后兼容） */
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
 * 配置解析错误——非法 YAML 不再静默（v1.1.3 新增）
 * 含 cause 链，便于调用方访问原始错误。
 */
export class ConfigParseError extends Error {
  filePath: string;
  line: number | string;
  column: number | string;
  constructor(message: string, filePath: string, line: number | string, column: number | string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ConfigParseError';
    this.filePath = filePath;
    this.line = line;
    this.column = column;
  }
}

/**
 * 加载审计配置（三级 fallback）
 * YAML 语法错误时：
 *   - strict 模式 / audit.strict=true：抛出 ConfigParseError（由 CLI 入口 exit 2）
 *   - 非 strict 模式：输出 WARN + 回退到安全默认值（所有规则启用）
 * @param cwd 工作目录（默认 process.cwd()）
 * @param strict 是否严格模式（YAML 语法错误时抛出异常 vs 回退安全默认值）
 * @returns 合并后的 AuditConfig
 * @throws ConfigParseError 当 strict=true / audit.strict=true 且配置文件存在但 YAML 语法错误时
 */
export function loadConfig(cwd?: string, strict?: boolean): AuditConfig {
  const baseDir = cwd || process.cwd();

  try {
    // 0. v1.2.9: SOFAGENT_CONFIG 环境变量（优先级最高，企业集中管控用）
    const envConfigPath = process.env.SOFAGENT_CONFIG;
    if (envConfigPath) {
      const envConfig = tryLoadYaml(envConfigPath);
      if (envConfig) {
        const merged = mergeWithDefaults(envConfig);
        if (strict || merged.strict) {
          merged.strict = true;
        }
        return merged;
      }
    }

    // 1. 尝试 ${cwd}/.sofagent/config.yml
    const projectConfigPath = getConfigFile(baseDir);
    const projectConfig = tryLoadYaml(projectConfigPath);
    if (projectConfig) {
      const merged = mergeWithDefaults(projectConfig);
      // v1.1.3: config 内 audit.strict 与 CLI --strict 任一为 true 则 fail-closed
      if (strict || merged.strict) {
        merged.strict = true;
      }
      return merged;
    }

    // 2. 尝试 ~/.sofagent/config.yml
    const homeConfigPath = join(homedir(), '.sofagent', 'config.yml');
    const homeConfig = tryLoadYaml(homeConfigPath);
    if (homeConfig) {
      const merged = mergeWithDefaults(homeConfig);
      if (strict || merged.strict) {
        merged.strict = true;
      }
      return merged;
    }

    // 3. 使用默认配置
    const projectExists = existsSync(join(baseDir, '.sofagent', 'config.yml'));
    const homeExists = existsSync(join(homedir(), '.sofagent', 'config.yml'));
    if (projectExists || homeExists) {
      console.warn('⚠️ 配置文件存在但缺少 audit 段，使用默认配置。运行 sofagent-core doctor 诊断。');
    } else {
      console.warn('⚠️ 未找到 .sofagent/config.yml，使用默认配置。运行 sofagent-audit --init 生成配置。');
    }
    return { ...DEFAULT_CONFIG };
  } catch (err) {
    // v1.1.3: 统一处理 ConfigParseError 和旧版 ConfigLoadError
    if (err instanceof ConfigParseError || err instanceof ConfigLoadError) {
      if (strict) {
        throw err; // CLI --strict 模式：向上抛，由 CLI 入口 exit 2
      }
      // 非 strict 模式：WARN + 回退到安全默认值
      console.warn(`⚠️ ${err.message}`);
      console.warn('⚠️ config.yml 格式错误，已回退默认配置。运行 sofagent-core doctor 诊断');
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
 * YAML 语法错误时抛出 ConfigParseError（含行号列号 + cause），不静默回退
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
  } catch (err) {
    console.error('[config-loader] 读取 YAML 配置文件失败:', err);
    return null;
  }

  // v1.1.3: 先尝试浅层解析以提取 audit.strict（用于 fail-closed 判定）
  // v1.1.5:  schema 一致性——允许顶层配置（无 audit: 包装），与 mergeWithDefaults 支持范围对齐
  let configStrict = false;
  try {
    const parsed = yamlLoad(content) as Record<string, unknown> | null;
    // v1.2.0: 可选 signature 字段校验（防 Agent 篡改配置文件）
    verifyConfigSignature(parsed, filePath);
    if (parsed && typeof parsed === 'object') {
      const audit = parsed['audit'];
      // v1.1.5: loop 是顶层独立节，不进 audit 段——单独提取，与 audit 段合并
      const loopSection = parsed['loop'];
      if (audit && typeof audit === 'object') {
        configStrict = !!(audit as Record<string, unknown>)['strict'];
        const result: Partial<AuditConfig> = { ...(audit as Partial<AuditConfig>) };
        if (loopSection && typeof loopSection === 'object') {
          result.loop = loopSection as AuditConfig['loop'];
        }
        return result;
      }
      // v1.1.5: 顶层（无 audit 包装）含 AuditConfig 已知字段时，直接当作 AuditConfig 使用
      // 这样 mergeWithDefaults 的 extendedRulesEnabled / rules / A16 / A17 等字段都能正常生效
      const topLevelAuditKeys: (keyof AuditConfig)[] = [
        'lowRiskPatterns', 'testPatterns', 'carefulModifyThreshold',
        'extendedRulesEnabled', 'rules', 'loopCheckMaxRounds', 'strict', 'A16', 'A17',
        'loop', 'webhook', 'sanitizePatterns',
      ];
      const hasAny = topLevelAuditKeys.some(k => k in parsed);
      if (hasAny) {
        return parsed as Partial<AuditConfig>;
      }
      // 既无 audit 段也无任何已知字段——确实不是有效配置
      console.warn('⚠️ 配置文件缺少 audit 段，使用默认配置');
      return null;
    }
    return null;
  } catch (err) {
    // YAML 语法错误——抛出 ConfigParseError（含 cause 链）
    if (err instanceof YAMLException) {
      const line = err.mark?.line != null ? err.mark.line + 1 : '?';
      const col = err.mark?.column != null ? err.mark.column + 1 : '?';
      throw new ConfigParseError(
        `${filePath} 第 ${line} 行第 ${col} 列: ${err.reason}`,
        filePath,
        line,
        col,
        err
      );
    }
    throw new ConfigParseError(`${filePath}: ${(err as Error).message}`, filePath, '?', '?', err as Error);
  }
}

/**
 * v1.2.0 最小安全实现：config.yml 可选 signature 字段校验
 *
 * 设计：
 *   - config.yml 顶层可带 `signature: <hex HMAC-SHA256>` 字段。
 *   - 加载时用与审计一致的 HMAC-SHA256 + stableStringify（去除 signature 后）
 *     对整份配置计算签名并与字段比对。
 *   - 不匹配 → 告警（warn）但不阻断启动（避免把已有用户配置搞崩）。
 *     ⚠️ FIXED(v1.2.2-hotfix): 签名不匹配已升级为 fail-closed 阻断启动。
 *         当前抛出 Error 拒绝启动，不再静默继续（原 TODO 已闭环）。
 *         如需降级为告警（不阻断），可删除下方 throw 并恢复 console.warn。
 *   - 不带 signature 字段 → 向后兼容，不强制。
 *   - 无 ~/.sofagent-key 时无法校验 → 跳过（warn 提示，不阻断）。
 *
 * 注：完整签名体系（密钥管理 / 签名工具 CLI）属产品决策，本实现仅落地
 *     「加载侧可选校验」分支。
 */
function verifyConfigSignature(parsed: Record<string, unknown> | null, filePath: string): void {
  if (!parsed || typeof parsed !== 'object') return;

  // DP-3 修复：检测 audit 段（或其它非顶层位置）误放的 signature 字段。
  // 设计上 signature 只允许放在顶层；放在 audit 段会被静默剥离且不校验，
  // 这是 QA 发现的 LOW 级问题，现在明确告警，避免用户以为签了名实际没生效。
  const auditSection = parsed['audit'];
  if (
    auditSection &&
    typeof auditSection === 'object' &&
    (auditSection as Record<string, unknown>)['signature'] !== undefined
  ) {
    console.warn(
      `⚠️ config.yml: audit 段含 signature 字段——签名应放在顶层（与 audit 同级），audit 段签名已忽略: ${filePath}`
    );
    delete (auditSection as Record<string, unknown>)['signature'];
  }

  const sig = parsed['signature'];
  if (typeof sig !== 'string' || sig.trim().length === 0) {
    // (v1.2.7): 签名缺失——fail-open（全新安装无签名是常态），但 WARN 更显眼
    // 全新安装时无签名是正常的；已有配置但无签名 = 配置可被任意修改且不被发现
    console.warn('');
    console.warn('  ╔══════════════════════════════════════════════════════╗');
    console.warn('  ║  ⚠️  config.yml 无防篡改签名（signature 字段缺失）  ║');
    console.warn('  ║  配置可被任意修改且不被发现。                          ║');
    console.warn('  ║  如需强校验，运行：sofagent-audit --sign-config       ║');
    console.warn('  ╚══════════════════════════════════════════════════════╝');
    console.warn('');
    return;
  }

  // 从待验内容中剔除顶层 signature 字段（计算签名时不应包含签名自身）
  delete parsed['signature'];

  const key = getHmacKey();
  if (key === null) {
    // v1.2.6: fail-closed——配置文件有 signature 但无密钥时拒绝启动（而非静默跳过）。
    // 原为 console.warn 后继续（等于没有防护），现与签名不匹配时的处理一致。
    console.error(`❌ config.yml 含 signature 字段但无 ~/.sofagent-key，无法验签——拒绝启动: ${filePath}`);
    throw new Error(`配置文件签名校验失败（缺少 HMAC 密钥），拒绝启动。请创建 ~/.sofagent-key 或删除 config.yml 中的 signature 字段: ${filePath}`);
  }
  const canonical = stableStringify(parsed);
  const expected = createHmac('sha256', key).update(canonical).digest('hex');
  const provided = sig.trim().toLowerCase();
  const matched =
    provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided, 'utf-8'), Buffer.from(expected, 'utf-8'));
  if (!matched) {
    // FIXED(v1.2.2-hotfix): 签名不匹配已升级为 fail-closed 阻断启动。
    //   原为 console.warn 后继续（等于没有防护），现抛 Error 拒绝启动。
    //   降级方案：删除下方 throw 并恢复 console.warn 即可回到 fail-open。
    console.error(`❌ config.yml signature 不匹配——内容可能被篡改或密钥不匹配。拒绝启动: ${filePath}`);
    throw new Error(`配置文件签名校验失败，拒绝启动。请检查 config.yml 完整性: ${filePath}`);
  }
}

/**
 * v1.2.1 (DP-2) 对 config.yml 签名并写回——完整签名体系的颁发侧。
 *
 * 算法与 verifyConfigSignature 完全对称：
 *   1. 解析 YAML → 对象
 *   2. 剔除 signature 字段（顶层 + audit 段）
 *   3. stableStringify（字典序排序）→ canonical
 *   4. HMAC-SHA256(canonical, ~/.sofagent-key) → hex 签名
 *   5. 把 `signature: <hex>` 写回 YAML 顶层，原子写回文件
 *
 * @param filePath config.yml 路径
 * @returns 'signed' | 'updated'（首次签名 / 更新已有签名）
 * @throws Error 当文件不存在 / 无 ~/.sofagent-key / YAML 解析失败时
 */
export function signConfig(filePath: string): 'signed' | 'updated' {
  if (!existsSync(filePath)) {
    throw new Error(`配置文件不存在: ${filePath}`);
  }
  const key = getHmacKey();
  if (key === null) {
    throw new Error('无 ~/.sofagent-key——无法签名。请先创建密钥：openssl rand -hex 32 > ~/.sofagent-key && chmod 600 ~/.sofagent-key');
  }

  const content = readFileSync(filePath, 'utf-8');
  const parsed = yamlLoad(content) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`YAML 解析失败或顶层非对象: ${filePath}`);
  }

  // 判断是否已有顶层签名
  const hadSignature =
    typeof parsed['signature'] === 'string' && (parsed['signature'] as string).trim().length > 0;

  // 剔除 signature（与 verifyConfigSignature 对称）
  const auditSection = parsed['audit'];
  if (
    auditSection &&
    typeof auditSection === 'object' &&
    (auditSection as Record<string, unknown>)['signature'] !== undefined
  ) {
    delete (auditSection as Record<string, unknown>)['signature'];
  }
  delete parsed['signature'];

  // 计算签名
  const canonical = stableStringify(parsed);
  const sig = createHmac('sha256', key).update(canonical).digest('hex');

  // 写回：把 signature 加到 YAML 顶层（在文件末尾追加，YAML 合法）
  // 先剔除文件中已有的 signature 行（顶层），再追加新的
  let lines = content.split('\n');
  lines = lines.filter((line) => !/^signature\s*:/.test(line.trimStart()));
  lines.push(`signature: ${sig}`);
  const newContent = lines.join('\n');

  atomicWriteSync(filePath, newContent);
  return hadSignature ? 'updated' : 'signed';
}

/**
 * 将部分配置与默认配置合并（缺失字段用默认值填充）
 */
function mergeWithDefaults(partial: Partial<AuditConfig>): AuditConfig {
  const merged: AuditConfig = {
    lowRiskPatterns: partial.lowRiskPatterns ?? DEFAULT_CONFIG.lowRiskPatterns,
    testPatterns: partial.testPatterns ?? DEFAULT_CONFIG.testPatterns,
    carefulModifyThreshold: partial.carefulModifyThreshold ?? DEFAULT_CONFIG.carefulModifyThreshold,
    extendedRulesEnabled: partial.extendedRulesEnabled ?? DEFAULT_CONFIG.extendedRulesEnabled,
    rules: partial.rules,
    loopCheckMaxRounds: partial.loopCheckMaxRounds ?? 20,
    // v1.1.3: 透传 audit.strict（默认 false）
    strict: partial.strict ?? false,
    A16: partial.A16,
    A17: partial.A17,
    // v1.1.5: loop 配置透传
    loop: partial.loop,
    // v1.2.0: toolGate 配置透传——orchestrator tool call 事前拦截
    toolGate: partial.toolGate ?? DEFAULT_CONFIG.toolGate,
    // v1.1.6: webhook 配置透传（CLI 未传 --webhook 时回退到此）
    webhook: partial.webhook,
    sanitizePatterns: partial.sanitizePatterns,
  };

  // 校验 rules key——未知规则名输出警告
  // v1.1.5: 补全 a18/a19（v1.1.4 新增 A18/A19 规则后此处遗漏）
  // 基线规则集合与 runner 统一（共享常量 BASELINE_RULE_KEYS，9 条：a1/a2/a9/a10/a11/a20/a21/a22/a23）
  if (merged.rules) {
    for (const key of BASELINE_RULE_KEYS) {
      if (merged.rules[key] === false) {
        console.warn(`⚠️ 基线规则 ${key.toUpperCase()} 不可禁用，已强制启用（runner 侧亦有强制点）`);
        merged.rules[key] = true;
      }
    }

    // ⚠️ 同步要求：新增 A 类规则时，此处必须同步追加
    //    权威源见 sofagent/audit/src/rules/runner.ts AUDIT_PRIORITY
    //    v1.2.5: A20-A23 加入 knownKeys（BASELINE_RULE_KEYS 已含 a20-a23）
    const knownKeys = new Set([
      ...BASELINE_RULE_KEYS,
      'a3', 'a4', 'a5', 'a6', 'a7', 'a8',
      'a14', 'a15', 'a16', 'a17', 'a18', 'a19',
      'e1', 'e2', 'e3', 'e4',
    ]);
    for (const key of Object.keys(merged.rules)) {
      if (!knownKeys.has(key.toLowerCase())) {
        console.warn(`⚠️ config.yml: 未知规则名 "${key}" → 已忽略（已知: a1-a11, a14-a23, e1-e4）`);
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
 *
 * 注意：DEFAULT_CONFIG.extendedRulesEnabled=false 和
 * safeDefaults 强制 extendedRulesEnabled=true 是故意的 fail-closed 保护设计，
 * 不可改变。
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
      a14: true, a15: true, a16: true, a17: true, a18: true, a19: true,
    },
    loopCheckMaxRounds: 20,
    strict: false,
    toolGate: { enabled: true, warnAsFail: false },
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
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  atomicWriteSync(filePath, config);
}

// ============================================================
// v0.97: 环境变量配置（从 lib/config.sh 合并）
// ============================================================

/**
 * 运行时配置——由环境变量加载（对应 lib/config.sh 导出项）
 *
 * 命名约定说明：`Sofa*` 是 TS 接口/类型的驼峰命名，仅存在于 TypeScript
 * 层；它对应的**所有**环境变量均为 `SOFAGENT_` 全大写 + 下划线（SOFAGENT_HOME /
 * SOFAGENT_DATA / SOFAGENT_KEY_PATH …），符合 Unix 环境变量约定。shell↔TS 边界
 * 只通过 `process.env.SOFAGENT_*`（见 resolveDataDir）传递，不存在驼峰环境变量，
 * 故无 shell 注入/边界风险——此处保留驼峰类型名即可，无需重命名。
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
  // 数据主权产品的脱敏不应是 opt-in——默认开启
  sanitizeEnabled: true,
  sanitizeIpsEnabled: true,
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
    // 前缀统一为 SOFAGENT_*；旧 SOFA_* 保留为向后兼容别名
    // （resolveEnv 内部先读 SOFAGENT_*，未设置再读 SOFA_*）
    sanitizeEnabled: resolveBoolEnv('SOFAGENT_SANITIZE', 'SOFA_SANITIZE', ENV_DEFAULTS.sanitizeEnabled),
    sanitizeIpsEnabled: resolveBoolEnv('SOFAGENT_SANITIZE_IPS', 'SOFA_SANITIZE_IPS', ENV_DEFAULTS.sanitizeIpsEnabled),
    retentionDays: resolveNumberEnv('SOFAGENT_RETENTION_DAYS', 'SOFA_RETENTION_DAYS', ENV_DEFAULTS.retentionDays),
    retentionMax: resolveNumberEnv('SOFAGENT_RETENTION_MAX', 'SOFA_RETENTION_MAX', ENV_DEFAULTS.retentionMax),
    cleanupOnRecord: resolveBoolEnv('SOFAGENT_CLEANUP_ON_RECORD', 'SOFA_CLEANUP_ON_RECORD', ENV_DEFAULTS.cleanupOnRecord),
    cleanupFrequency: resolveNumberEnv('SOFAGENT_CLEANUP_FREQUENCY', 'SOFA_CLEANUP_FREQUENCY', ENV_DEFAULTS.cleanupFrequency),
    auditEnabled: resolveBoolEnv('SOFAGENT_AUDIT_ENABLED', 'SOFA_AUDIT_ENABLED', ENV_DEFAULTS.auditEnabled),
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
      } catch (err) {
        console.error('[config-loader] 读取标记文件失败:', err);
      }
    }
  }

  // 4. fallback
  return join(process.cwd(), '.sofagent');
}

// 布尔/数字环境变量读取统一走 shared/env（SOFAGENT_* 主名 + SOFA_* 别名兜底）
function resolveBoolEnv(key: string, legacyKey: string | null, defaultValue: boolean): boolean {
  return resolveEnvBool(key, legacyKey ?? undefined, defaultValue);
}

function resolveNumberEnv(key: string, legacyKey: string | null, defaultValue: number): number {
  return resolveEnvNumber(key, legacyKey ?? undefined, defaultValue);
}
