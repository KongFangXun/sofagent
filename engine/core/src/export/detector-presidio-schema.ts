// ============================================================
// detector-presidio-schema.ts · v1.5.1 T8 · Presidio 实体类型 schema 对齐
// ============================================================
//
// 对齐 Microsoft Presidio 的实体类型命名（PERSON/EMAIL/PHONE 等）与
// 两段式（analyze / anonymize）API 形态——**借模式不移植代码**
// （Presidio 依赖 Python/spaCy，进不了 Node 引擎与客户机房）；
// 生态既有配置可直接迁移，降低对接与学习成本。
//
// 对齐面：
//   1. 实体类型枚举（Presidio EntityType 命名子集——引擎检测面用到的）
//   2. 类型映射：本仓 REDACTION_PATTERNS / sorting-gate 标签 → Presidio 类型
//   3. 两段式 API 形态适配：analyze(text)→spans / anonymize(text, spans)→text
//      （detector-registry 的 detect/applySpans 即此形态的插槽实现）
// ============================================================

/** Presidio 实体类型（引擎插槽面消费的子集——与生态命名一致） */
export type PresidioEntityType =
  | 'PERSON' // 人名（L1 词典企业专名人格档 / L2 NER）
  | 'ORGANIZATION' // 组织机构名（企业专名主战场）
  | 'LOCATION' // 地址
  | 'EMAIL_ADDRESS' // 邮箱
  | 'PHONE_NUMBER' // 电话
  | 'CREDIT_CARD' // 银行卡号
  | 'IBAN_CODE' // 银行账号
  | 'ID' // 各类证件号（身份证归此）
  | 'URL' // URL
  | 'IP_ADDRESS' // IP
  | 'DATE_TIME' // 日期时间
  | 'MONEY_AMOUNT' // 金额
  | 'CRYPTO' // 密钥/凭据（引擎密钥族映射至此——Presidio 无此类型但扩展位合法）
  | 'INTERNAL_CODE'; // 企业内部代号（引擎扩展——L1 词典专属）

/** Presidio 两段式 analyze 结果形态（与 detector-registry 的 Span 同构——桥接字段） */
export interface PresidioAnalysisResult {
  /** 命中实体类型 */
  entity_type: PresidioEntityType;
  /** 起始偏移（含） */
  start: number;
  /** 结束偏移（不含） */
  end: number;
  /** 置信度 0-1（Presidio score 语义——引擎三层分档消费） */
  score: number;
}

/** Presidio 两段式 anonymizer 替换策略（引擎消费占位符替换——operator 直映射） */
export type PresidioOperator = 'replace' | 'redact' | 'mask' | 'keep';

/**
 * 本仓敏感标签 → Presidio 实体类型映射（单一出口——detector-regex 的
 * labelToPresidio 与 sensitivity-classifier 共享，防口径分裂）。
 *
 * 未覆盖标签返回 'INTERNAL_CODE'（保守归档——引擎内部语义兜底位）。
 */
export function toPresidioType(label: string): PresidioEntityType {
  switch (label) {
    // REDACTION_PATTERNS 密钥族（label 约定：detector-regex 内族名）
    case 'aws-key':
    case 'pem-block':
    case 'anthropic-key':
    case 'openai-project':
    case 'openai-svcacct':
    case 'openai-admin':
    case 'sk-generic':
    case 'github-token':
    case 'gitlab-token':
    case 'stripe-key':
    case 'google-key':
    case 'slack-token':
    case 'jwt-token':
    case 'bare-base64':
      return 'CRYPTO';
    // PII：手机号
    case 'phone':
      return 'PHONE_NUMBER';
    // sorting-gate SENSITIVE_PATTERNS 五标签
    case '手机号':
      return 'PHONE_NUMBER';
    case '身份证号':
      return 'ID';
    case '银行卡号':
      return 'CREDIT_CARD';
    case '金额':
      return 'MONEY_AMOUNT';
    case '邮箱':
      return 'EMAIL_ADDRESS';
    // L1 词典（企业专名——按词典声明的 kind 细分，缺省组织）
    case 'organization':
    case 'org':
    case 'company':
      return 'ORGANIZATION';
    case 'person':
      return 'PERSON';
    case 'product':
    case 'project':
    case 'internal':
    default:
      return 'INTERNAL_CODE';
  }
}

/**
 * 引擎置信度三层 → Presidio 处置 operator 的推荐映射：
 *   高置信（名单+模型一致）→ replace（直接替换）
 *   中置信（单检测器命中）→ replace + 记审计（operator 仍 replace，审计在调度层）
 *   低置信（弱正则模糊命中）→ keep（只标记不替换，交人审）
 */
export function recommendedOperator(confidenceTier: 'high' | 'medium' | 'low'): PresidioOperator {
  if (confidenceTier === 'high' || confidenceTier === 'medium') return 'replace';
  return 'keep';
}
