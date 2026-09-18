// ============================================================
// graph/validator.ts · Ontology Validation Engine（v1.5.0 第三章）
//
// 交付：
//   1. DAG 无环校验——复用 workflow-parser 的三色 DFS 判定逻辑，
//      但输出结构化错误（含环路定位），供 activate 前置门消费
//   2. schema 兼容校验——workflow 节点 IO schema 与 ontology 实体字段
//      兼容性检查（类型/必填对齐）
//   3. fail-closed 语义——校验器自身异常也拒绝激活（ValidationError
//      包裹一切非预期抛错）
//
// 边界（马鞍铁律同款）：本模块只做「判定」，不做「修复」——
// 错误定位输出给调用方，怎么改是人的事。
// ============================================================

/** 校验错误（结构化定位——节点/字段级，不是笼统「校验失败」） */
export interface ValidationIssue {
  /** 错误类别：cycle = 环 / schema = 字段不兼容 / internal = 校验器自身异常 */
  kind: 'cycle' | 'schema' | 'internal';
  /** 节点定位（cycle = 环上节点链；schema = 不兼容节点 id） */
  node: string;
  /** 字段定位（schema 类有值） */
  field?: string;
  /** 人类可读说明（含定位信息） */
  detail: string;
}

export interface ValidationResult {
  /** true = 校验通过（零 issue） */
  valid: boolean;
  issues: ValidationIssue[];
}

/** workflow 节点最小面（与 workflow-parser 的 WorkflowNode 结构兼容） */
export interface NodeLike {
  id: string;
  depends_on: string[];
  /** 节点 IO schema 引用（可选——引用 ontology 实体字段约定） */
  io?: {
    /** 输入实体名（该节点消费的 ontology 实体） */
    consumes?: Array<{ entity: string; fields?: Record<string, string> }>;
    /** 输出实体名（该节点产出的 ontology 实体） */
    produces?: Array<{ entity: string; fields?: Record<string, string> }>;
  };
}

/** ontology 实体最小面（与 merge-engine 的 OntologyObject 兼容） */
export interface EntityLike {
  name: string;
  /** 字段名 → 类型（schema 兼容校验的事实源） */
  fields?: Record<string, string>;
}

/**
 * DAG 无环校验（三色 DFS——与 workflow-parser.assertAcyclic 同判定，
 * 差异：不抛异常而是返回结构化 issue，供前置门聚合输出）。
 */
export function validateDag(nodes: NodeLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const color = new Map<string, 'white' | 'gray' | 'black'>(nodes.map((n) => [n.id, 'white']));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  function visit(id: string, stack: string[]): void {
    color.set(id, 'gray');
    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (!byId.has(dep)) {
        issues.push({
          kind: 'cycle',
          node: id,
          detail: `节点 ${id} 依赖悬空节点 ${dep}（depends_on 引用不存在的节点）`,
        });
        continue;
      }
      if (color.get(dep) === 'gray') {
        issues.push({
          kind: 'cycle',
          node: [...stack, id, dep].join(' → '),
          detail: `depends_on 存在环：${[...stack, id, dep].join(' → ')}`,
        });
        return;
      }
      if (color.get(dep) === 'white') visit(dep, [...stack, id]);
    }
    color.set(id, 'black');
  }

  for (const n of nodes) {
    if (color.get(n.id) === 'white') visit(n.id, []);
  }
  return issues;
}

/**
 * schema 兼容校验——节点 IO 引用的实体与字段必须存在且类型对齐。
 *
 * 判定规则：
 *   - io.consumes/produces 引用的实体名不在 entities 集内 → issue（悬空引用）
 *   - 引用的字段名不在实体 fields 内 → issue（字段缺失）
 *   - 节点声明的字段类型与实体 fields 类型不一致 → issue（类型错配）
 */
export function validateSchemaCompat(nodes: NodeLike[], entities: EntityLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byName = new Map(entities.map((e) => [e.name, e]));

  for (const node of nodes) {
    if (!node.io) continue;
    for (const direction of ['consumes', 'produces'] as const) {
      for (const ref of node.io[direction] ?? []) {
        const entity = byName.get(ref.entity);
        if (!entity) {
          issues.push({
            kind: 'schema',
            node: node.id,
            field: `${direction}.${ref.entity}`,
            detail: `节点 ${node.id} 的 ${direction} 引用未知实体 "${ref.entity}"（ontology 无此实体）`,
          });
          continue;
        }
        if (!ref.fields) continue;
        for (const [fieldName, declaredType] of Object.entries(ref.fields)) {
          const actualType = entity.fields?.[fieldName];
          if (actualType === undefined) {
            issues.push({
              kind: 'schema',
              node: node.id,
              field: `${direction}.${ref.entity}.${fieldName}`,
              detail: `节点 ${node.id} 的 ${direction}.${ref.entity} 引用字段 "${fieldName}"——实体 "${ref.entity}" 无此字段`,
            });
            continue;
          }
          if (actualType !== declaredType) {
            issues.push({
              kind: 'schema',
              node: node.id,
              field: `${direction}.${ref.entity}.${fieldName}`,
              detail: `节点 ${node.id} 的 ${direction}.${ref.entity}.${fieldName} 声明类型 "${declaredType}" 与实体字段类型 "${actualType}" 不匹配`,
            });
          }
        }
      }
    }
  }
  return issues;
}

/**
 * 激活前置门——fail-closed 语义总入口。
 *
 * 任何校验不过 = 拒绝激活；校验器自身异常 = 同样拒绝（internal issue），
 * 绝不「校验器挂了就放行」。
 */
export function validateForActivation(nodes: NodeLike[], entities: EntityLike[]): ValidationResult {
  try {
    const issues = [...validateDag(nodes), ...validateSchemaCompat(nodes, entities)];
    return { valid: issues.length === 0, issues };
  } catch (err) {
    // fail-closed：校验器异常 → 拒绝激活 + internal 定位
    return {
      valid: false,
      issues: [
        {
          kind: 'internal',
          node: '(validator)',
          detail: `校验器自身异常（fail-closed 拒绝激活）：${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}
