// ============================================================
// schema/index.ts · Ontology JSON Schema 统一导出 + 最小校验器（v1.3.6 交付 1）
//
// 三份 Schema（entity/concept/relations）是 validator 校验、审计对齐、
// 未来模型层注入（v1.3.6 注册接口）的单一事实源。
//
// validateAgainstSchema：纯 JS 实现的最小 JSON Schema 校验器
//（零新依赖，不引入 ajv）——覆盖 type / required / properties / items /
// enum / minLength / oneOf / $ref(#/definitions/...) 七要素，
// 足以校验本目录三份 Schema（真实数据已验证）。
// ============================================================

import entitySchema from './entity.schema.json';
import conceptSchema from './concept.schema.json';
import relationsSchema from './relations.schema.json';

/** JSON Schema 最小类型（宽松——只建模本目录用到的子集） */
export interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  minLength?: number;
  oneOf?: JsonSchema[];
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
  [key: string]: unknown;
}

/** 校验结果 */
export interface SchemaValidationResult {
  /** 是否通过 */
  valid: boolean;
  /** 违规项列表（路径 + 原因；valid=true 时为空） */
  errors: string[];
}

/** entity frontmatter Schema（对齐 CORE-OBJ） */
export const ENTITY_SCHEMA = entitySchema as JsonSchema;
/** concept frontmatter Schema */
export const CONCEPT_SCHEMA = conceptSchema as JsonSchema;
/** relations Schema（对齐 CORE-LNK：direction + cardinality） */
export const RELATIONS_SCHEMA = relationsSchema as JsonSchema;

/**
 * 用最小 JSON Schema 校验器校验数据。
 *
 * @param data 待校验数据
 * @param schema JSON Schema 对象
 * @returns SchemaValidationResult（valid + errors）
 */
export function validateAgainstSchema(data: unknown, schema: JsonSchema): SchemaValidationResult {
  const errors: string[] = [];
  validateNode(data, schema, schema, '', errors);
  return { valid: errors.length === 0, errors };
}

/** 解析 $ref（仅支持 #/definitions/<name> 形式） */
function resolveRef(ref: string, root: JsonSchema): JsonSchema | null {
  const match = ref.match(/^#\/definitions\/(.+)$/);
  if (!match || !match[1]) return null;
  return root.definitions?.[match[1]] ?? null;
}

/** JSON Schema type 关键字 → JS 实际类型判定 */
function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true; // 未知 type 关键字——放行（最小校验器语义）
  }
}

/**
 * 递归校验节点。
 * @param value 当前值
 * @param schema 当前节点 schema
 * @param root 根 schema（$ref 解析用）
 * @param path 当前 JSON 路径（错误消息定位）
 * @param errors 违规收集器
 */
function validateNode(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  errors: string[],
): void {
  // $ref 解引用
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    if (!resolved) {
      errors.push(`${path || '(root)'}: 无法解析 $ref "${schema.$ref}"`);
      return;
    }
    validateNode(value, resolved, root, path, errors);
    return;
  }

  // oneOf：至少一个分支通过
  if (Array.isArray(schema.oneOf)) {
    const branchPass = schema.oneOf.some((branch) => {
      const branchErrors: string[] = [];
      validateNode(value, branch, root, path, branchErrors);
      return branchErrors.length === 0;
    });
    if (!branchPass) {
      errors.push(`${path || '(root)'}: 不满足 oneOf 任一分支`);
    }
    return;
  }

  // type 判定
  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${path || '(root)'}: 期望类型 ${schema.type}，实际 ${describeValue(value)}`);
    return;
  }

  // enum 判定
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path || '(root)'}: 值 ${JSON.stringify(value)} 不在枚举 ${JSON.stringify(schema.enum)} 内`);
  }

  // string minLength
  if (schema.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) {
    errors.push(`${path || '(root)'}: 字符串长度 ${value.length} 小于 minLength ${schema.minLength}`);
  }

  // object：required + properties 递归
  if (schema.type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in obj)) {
        errors.push(`${path || '(root)'}: 缺少必填字段 "${requiredKey}"`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        validateNode(obj[key], propSchema, root, path ? `${path}.${key}` : key, errors);
      }
    }
  }

  // array：items 递归
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      validateNode(item, schema.items as JsonSchema, root, `${path}[${index}]`, errors);
    });
  }
}

/** 值描述（错误消息用） */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
