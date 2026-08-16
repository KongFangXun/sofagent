// ============================================================
// data-diff.ts · 结构化数据变更审计引擎（v1.3.6 S4 新增）
// ============================================================
//
// 与代码审计规则引擎（A1-A21）完全独立的 D1-D5 数据规则引擎。
// 触发时机：事中（数据写入时同步检查 before/after）
//
// D1 关键字段保护 — entity 的 domain/name 不允许从有值改为空 → FAIL
// D2 关联完整性 — entity relations.belongs_to 引用目标必须存在 → WARN
// D3 批量删除告警 — 单次删除 >3 个 entity/concept → WARN
// D4 格式一致性 — entity frontmatter 必须含 created_at + updated_at → WARN
// D5 敏感信息检测 — entity/concept 内容不含 secret-like 串 → FAIL
// ============================================================

// ============================================================
// 类型定义
// ============================================================

/** 结构化数据变更记录（区别于 git diff 的 DiffFile） */
export interface DataChange {
  /** 数据类型 */
  type: 'entity' | 'concept' | 'config';
  /** entity/concept 名称或配置文件名 */
  name: string;
  /** 变更动作 */
  action: 'create' | 'update' | 'delete';
  /** 变更前内容（create 时为 undefined） */
  before?: Record<string, unknown>;
  /** 变更后内容（delete 时为 undefined） */
  after?: Record<string, unknown>;
  /** 变更时间戳 */
  timestamp: string;
}

/** 数据审计违规项 */
export interface DataViolation {
  /** 规则编号（D1-D5） */
  rule: string;
  /** 违规级别 */
  severity: 'WARN' | 'FAIL';
  /** 违规详情 */
  detail: string;
}

/** 数据审计结果 */
export interface DataAuditResult {
  /** 是否有 FAIL 级违规 */
  hasFail: boolean;
  /** 是否有 WARN 级违规 */
  hasWarn: boolean;
  /** FAIL 违规数 */
  failCount: number;
  /** WARN 违规数 */
  warnCount: number;
  /** 所有违规列表 */
  violations: DataViolation[];
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 对比两个结构化对象，生成 DataChange
 *
 * @param type 数据类型
 * @param name 名称
 * @param before 变更前内容（create 时 undefined）
 * @param after 变更后内容（delete 时 undefined）
 * @returns DataChange 记录
 */
export function diffDataChange(
  type: DataChange['type'],
  name: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): DataChange {
  let action: DataChange['action'];
  if (before === undefined && after !== undefined) {
    action = 'create';
  } else if (before !== undefined && after === undefined) {
    action = 'delete';
  } else {
    action = 'update';
  }

  return {
    type,
    name,
    action,
    before,
    after,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 从 DataChange[] 跑数据规则，返回 DataAuditResult
 *
 * D1-D5 五条规则独立运行，不共享代码规则引擎的 registry。
 *
 * @param changes 数据变更列表
 * @returns 审计结果
 */
export function runDataRules(changes: DataChange[]): DataAuditResult {
  const violations: DataViolation[] = [];

  // D3 批量删除告警：统计单次调用中删除的 entity/concept 数量
  const deleteCount = changes.filter(
    (c) => c.action === 'delete' && (c.type === 'entity' || c.type === 'concept'),
  ).length;
  if (deleteCount > 3) {
    violations.push({
      rule: 'D3',
      severity: 'WARN',
      detail: `单次操作删除 ${deleteCount} 个 entity/concept（超过 3 个阈值）`,
    });
  }

  for (const change of changes) {
    // D1: 关键字段保护 — entity 的 domain/name 不允许从有值改为空
    if (change.type === 'entity' && change.action === 'update' && change.before && change.after) {
      for (const field of ['domain', 'name'] as const) {
        const beforeVal = change.before[field];
        const afterVal = change.after[field];
        if (beforeVal && String(beforeVal).trim() && (!afterVal || !String(afterVal).trim())) {
          violations.push({
            rule: 'D1',
            severity: 'FAIL',
            detail: `entity "${change.name}" 的 ${field} 字段从 "${beforeVal}" 改为空值`,
          });
        }
      }
    }

    // D2: 关联完整性 — entity relations.belongs_to 引用目标必须存在
    if (change.type === 'entity' && change.after) {
      const relations = change.after['relations'];
      if (relations && typeof relations === 'object') {
        const relationsObj = relations as Record<string, unknown>;
        const belongsTo = relationsObj['belongs_to'];
        if (Array.isArray(belongsTo)) {
          // belongs_to 引用完整性需要全局知识库上下文
          // 这里只能检查引用字符串是否存在（不能检查目标文件是否存在）
          // 留给 create_entity 的调用方在写入前做完整检查
          // D2 在此记录：如果 belongs_to 包含空字符串或空值
          for (const target of belongsTo) {
            if (typeof target === 'string' && target.trim() === '') {
              violations.push({
                rule: 'D2',
                severity: 'WARN',
                detail: `entity "${change.name}" 的 belongs_to 包含空引用`,
              });
            }
          }
        }
      }
    }

    // D4: 格式一致性 — entity frontmatter 必须含 created_at + updated_at
    if (change.type === 'entity' && change.after && change.action !== 'delete') {
      const after = change.after;
      if (!after['created_at']) {
        violations.push({
          rule: 'D4',
          severity: 'WARN',
          detail: `entity "${change.name}" 缺少 created_at 字段`,
        });
      }
      if (!after['updated_at']) {
        violations.push({
          rule: 'D4',
          severity: 'WARN',
          detail: `entity "${change.name}" 缺少 updated_at 字段`,
        });
      }
    }

    // D5: 敏感信息检测 — entity/concept 内容不含 secret-like 串
    if (change.after) {
      const contentStr = JSON.stringify(change.after);
      if (detectSecret(contentStr)) {
        violations.push({
          rule: 'D5',
          severity: 'FAIL',
          detail: `entity/concept "${change.name}" 内容疑似包含敏感信息（API Key / 密钥 / 密码）`,
        });
      }
    }
  }

  const failCount = violations.filter((v) => v.severity === 'FAIL').length;
  const warnCount = violations.filter((v) => v.severity === 'WARN').length;

  return {
    hasFail: failCount > 0,
    hasWarn: warnCount > 0,
    failCount,
    warnCount,
    violations,
  };
}

// ============================================================
// 辅助：敏感信息检测（与 A2/A9 同源逻辑）
// ============================================================

/**
 * 检测字符串中是否包含 secret-like 串
 *
 * 检测模式：
 * - API Key（sk- / sk-ant- 前缀 + 足够长后缀）
 * - password= / secret= / api_key= 赋值模式
 * - AWS Access Key（AKIA 开头）
 * - Bearer token
 * - 私钥块
 */
function detectSecret(content: string): boolean {
  // API Key（sk- 前缀，至少 20 字符后缀）
  if (/sk-(ant(-api-)?-)?[a-zA-Z0-9_-]{20,}/.test(content)) return true;
  // AWS Access Key
  if (/AKIA[0-9A-Z]{16}/.test(content)) return true;
  // Bearer token
  if (/Bearer\s+[a-zA-Z0-9._~+/-]{20,}/.test(content)) return true;
  // 私钥块
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)) return true;
  // 密码/密钥赋值模式（词边界保护，防误伤 monkey=foo）
  if (/(?:^|[^a-zA-Z0-9_])(?:password|passwd|secret|api_key|apikey|access_token)\s*[=:]\s*\S{4,}/i.test(content)) return true;
  return false;
}
