// ============================================================
// crud/schema-gate.ts · workflow CRUD 共用校验门
// ============================================================
//
// G14 workflow CRUD 的统一校验入口——所有写路径（create/update/
// node_add）先过本门再落库：
//   zod 结构校验（字段路径级错误）→ trigger.schedule cron 语法校验
//   → 可见性枚举校验（parser 已收口，此处兜底）
//
// 设计约束：
// - 复用 orchestrator 既有 zod ^4.4.3 依赖，不引新校验库
// - 结构化错误含字段路径（workflow.nodes[2].trigger.schedule 形态），
//   外部提交方可直接定位错在哪一段
// - 非法 cron fail-loud 拒绝（静默永不调度 = 定时触发悄悄失效）
// - 自然语言周期（非 cron 形态）放行——由消费端解析，不在引擎侧硬卡
// ============================================================

import { z } from 'zod';

/** 糖宏表（与 daemon scheduler.ts expandCronSugar 同表——分属两包不互相 import，语义对齐注释互指） */
const CRON_SUGAR = new Set(['@daily', '@weekly', '@monthly']);

/** cron 段边界（分/时/日/月/周）——对齐 scheduler.ts matchField 语法表 */
const CRON_FIELD_BOUNDS: ReadonlyArray<{ min: number; max: number; name: string }> = [
  { min: 0, max: 59, name: '分' },
  { min: 0, max: 23, name: '时' },
  { min: 1, max: 31, name: '日' },
  { min: 1, max: 12, name: '月' },
  { min: 0, max: 6, name: '周' },
];

/**
 * 校验单段 cron 语法（`*` / 数字 / 逗号列表 / 范围 / 步进）。
 * @returns null=合法；string=错误描述
 */
function validateCronField(field: string, min: number, max: number, fieldName: string): string | null {
  for (const part of field.split(',')) {
    const p = part.trim();
    if (p === '') return `${fieldName}段「${field}」含空子项（逗号格式错误）`;
    // 步进 `*/N` 或 `A-B/N`
    const stepMatch = p.match(/^(.*)\/(\d+)$/);
    const range = stepMatch ? stepMatch[1]! : p;
    if (stepMatch) {
      const step = parseInt(stepMatch[2]!, 10);
      if (step < 1) return `${fieldName}段「${field}」步进值 ${step} 非法（必须 ≥1）`;
    }
    if (range === '*') continue;
    const rangeMatch = range.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]!, 10);
      const hi = parseInt(rangeMatch[2]!, 10);
      if (lo < min || hi > max || lo > hi) {
        return `${fieldName}段「${field}」范围 ${lo}-${hi} 越界（合法 ${min}-${max}）`;
      }
      continue;
    }
    if (/^\d+$/.test(range)) {
      const v = parseInt(range, 10);
      if (v < min || v > max) return `${fieldName}段「${field}」值 ${v} 越界（合法 ${min}-${max}）`;
      continue;
    }
    return `${fieldName}段「${field}」语法非法（支持 * / 数字 / 逗号列表 / 范围 / 步进）`;
  }
  return null;
}

/**
 * cron 表达式完整校验（糖宏直接过；五段逐段校；非 cron 形态视为自然语言周期放行）。
 * @returns null=合法或自然语言；string=错误描述
 */
export function validateCronSchedule(schedule: string): string | null {
  const s = schedule.trim();
  if (s === '') return 'schedule 为空';
  if (CRON_SUGAR.has(s)) return null;
  if (!/^[0-9*,/\- ]+$/.test(s)) return null; // 非纯 cron 字符集（含空格）→ 自然语言周期，消费端解析
  const parts = s.split(/\s+/);
  if (parts.length !== 5) {
    return `「${s}」是 cron 字符集但不是 5 段（分 时 日 月 周）——补全或改用自然语言周期`;
  }
  for (let i = 0; i < 5; i++) {
    const b = CRON_FIELD_BOUNDS[i]!;
    const err = validateCronField(parts[i]!, b.min, b.max, b.name);
    if (err) return err;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// zod 结构定义（G14 CRUD 入参）
// ────────────────────────────────────────────────────────────

/** workflow 对象（nodes 形态——与 workflow.schema.json 同构，结构校验单一入口） */
export const workflowDocSchema = z.object({
  name: z.string().min(1, 'workflow 名称非空'),
  description: z.string().optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().min(1, '节点 id 非空'),
        agent: z.string().min(1, '节点 agent 非空'),
        task: z.string().min(1, '节点 task 非空'),
        depends_on: z.array(z.string()).optional(),
        type: z.enum(['loop', 'auto', 'manual']).optional(),
        hitl: z.boolean().optional(),
        trigger: z
          .object({ schedule: z.string().min(1, 'trigger.schedule 非空') })
          .optional(),
        visibility: z.enum(['open', 'private', 'result-only']).optional(),
      }),
    )
    .min(1, 'nodes 至少 1 个'),
  merge_criteria: z.array(z.record(z.string(), z.unknown())).optional(),
  approver: z
    .object({
      id: z.string().min(1, 'approver.id 非空'),
      kind: z.enum(['human', 'role', 'agent']).optional(),
      required: z.boolean().optional(),
      note: z.string().optional(),
    })
    .optional(),
});

/** workflow_create 入参 */
export const workflowCreateSchema = z.object({
  workflow: workflowDocSchema,
  owner: z.string().min(1, 'owner 非空'),
  description: z.string().optional(),
});

/** workflow_update 入参（全量替换 workflow 文档） */
export const workflowUpdateSchema = z.object({
  workflow_id: z.string().min(1, 'workflow_id 非空'),
  workflow: workflowDocSchema,
  actor: z.string().min(1, 'actor 非空'),
});

/** workflow_node_add 入参 */
export const workflowNodeAddSchema = z.object({
  workflow_id: z.string().min(1, 'workflow_id 非空'),
  node: z.object({
    id: z.string().min(1, '节点 id 非空'),
    agent: z.string().min(1, '节点 agent 非空'),
    task: z.string().min(1, '节点 task 非空'),
    depends_on: z.array(z.string()).optional(),
    type: z.enum(['loop', 'auto', 'manual']).optional(),
    hitl: z.boolean().optional(),
    trigger: z.object({ schedule: z.string().min(1, 'trigger.schedule 非空') }).optional(),
    visibility: z.enum(['open', 'private', 'result-only']).optional(),
  }),
  actor: z.string().min(1, 'actor 非空'),
});

/** workflow_diff_preview 入参 */
export const workflowDiffPreviewSchema = z.object({
  workflow_id: z.string().min(1, 'workflow_id 非空'),
  workflow: workflowDocSchema,
  actor: z.string().min(1, 'actor 非空'),
});

export type WorkflowCreateInput = z.infer<typeof workflowCreateSchema>;
export type WorkflowUpdateInput = z.infer<typeof workflowUpdateSchema>;
export type WorkflowNodeAddInput = z.infer<typeof workflowNodeAddSchema>;
export type WorkflowDiffPreviewInput = z.infer<typeof workflowDiffPreviewSchema>;

/** 校验门结构化错误——含字段路径（zod path → 点号路径串） */
export class SchemaGateError extends Error {
  /** 逐项错误（含字段路径 + 人类可读描述） */
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'SchemaGateError';
    this.issues = issues.length > 0 ? issues : [message];
  }
}

/**
 * zod path（数组形态）→ 字段路径串。
 * [ 'workflow', 'nodes', 2, 'trigger', 'schedule' ] → workflow.nodes[2].trigger.schedule
 */
function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else out = out === '' ? String(seg) : `${out}.${String(seg)}`;
  }
  return out;
}

/**
 * 通用校验门——zod 结构校验 + trigger.schedule cron 语法校验。
 * @param schema zod schema（四入参之一）
 * @param input 原始入参
 * @param label 错误前缀（tool 名）
 * @returns 校验通过的强类型入参
 * @throws SchemaGateError 校验失败（结构化错误清单，不 crash 由调用方转 isError）
 */
export function gateOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  label: string,
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${formatPath(i.path)}: ${i.message}`,
    );
    throw new SchemaGateError(`${label} 参数校验未通过（${issues.length} 项）：${issues[0]}`, issues);
  }
  return result.data;
}

/**
 * 对已过结构门的 workflow 文档做 cron 语法校验（nodes 逐节 trigger.schedule）。
 * @param doc workflow 文档（workflowDocSchema 校验通过的 nodes 形态）
 * @returns 违规项列表（空数组 = 通过）
 */
export function validateWorkflowCrons(
  doc: Pick<z.infer<typeof workflowDocSchema>, 'nodes'>,
): string[] {
  const issues: string[] = [];
  doc.nodes.forEach((n, idx) => {
    if (n.trigger?.schedule) {
      const err = validateCronSchedule(n.trigger.schedule);
      if (err) issues.push(`workflow.nodes[${idx}] (${n.id}) trigger.schedule: ${err}`);
    }
  });
  return issues;
}
