// ============================================================
// workflow/dsh-seam.ts · DSH workflow seam 互转契约位（v1.3.7 交付 ①）
// ============================================================
//
// 设计目标（v1.4.5.md 一、DSH workflow seam 互转预留）：
//   sofagent workflow 容器可作为 DSH ctx.workflowEngine 的提供方插件——
//   「交 YAML，得一张受约束可审计的业务图」。DSH 无声明式 workflow 编译器
//   （其 workflowEngine 是模型临场写 JS 脚本风格），sofagent 的声明式
//   schema + DAG 校验 + 审阅协议正是互补面。
//
// 本版交付边界（互转契约位，不实现真实互转）：
//   ① YAML 字段 ↔ DSH 消费面映射表（字段级对照，机器可读）
//   ② 转换器接口签名（WorkflowSeamConverter）——真实互转等 DSH 正式版
//      后随 v1.4.0 cordis-plugin 同批评估，接口签名本版冻结
//
// 为什么现在冻结签名：模型层接入约束层需要稳定的契约面。签名一旦发布，
// 后续版本向后兼容（对齐训练协议「协议即版本边界」纪律）。
// ============================================================

import type { ParsedWorkflow } from '../workflow-parser';

/**
 * DSH 消费面形态描述——sofagent workflow 经 seam 转换后暴露给
 * DSH ctx.workflowEngine 的字段映射（本版只落映射文档，真实转换 v1.4.0）。
 *
 * 映射方向：sofagent YAML 字段 → DSH 侧消费语义。
 */
export interface DshSeamFieldMapping {
  /** sofagent 侧字段（workflow.schema.json 路径） */
  sofagentField: string;
  /** DSH 侧消费语义（ctx.workflowEngine 视角） */
  dshSurface: string;
  /** 映射说明（转换时的语义对齐要点） */
  note: string;
}

/** YAML 字段 ↔ DSH 消费面映射表（单一事实源——v1.4.0 转换器照此实现） */
export const DSH_SEAM_FIELD_MAPPINGS: readonly DshSeamFieldMapping[] = [
  {
    sofagentField: 'workflow.name',
    dshSurface: 'workflowEngine 实例标识',
    note: 'DSH workflowEngine 无命名编译器——以 name 作为注册标识',
  },
  {
    sofagentField: 'workflow.nodes[].id / agent / task / depends_on',
    dshSurface: 'DAG 执行计划（节点图）',
    note: 'sofagent 声明式 DAG → DSH 侧按 depends_on 拓扑序执行；agent 经 registry 解析链实例化',
  },
  {
    sofagentField: 'workflow.merge_criteria',
    dshSurface: 'turn-stopping 检查点（v1.4.0 硬门禁）',
    note: '机器可判定验收条件 → DSH agent/turn-stopping serial 检查点拦截关轮的输入',
  },
  {
    sofagentField: 'workflow.approver',
    dshSurface: '审批应答者（治理通道）',
    note: '对齐 promote_ab 强制人审——DSH 侧经 v1.3.5 MCP 互通调用 hitl_resolve',
  },
] as const;

/**
 * 转换器接口签名（v1.3.6 冻结 · v1.4.0 实现）。
 *
 * toDshSurface：ParsedWorkflow → DSH workflowEngine 消费面（对象）。
 * fromDshSurface：DSH 侧产物 → sofagent ParsedWorkflow（反向，供回流校验）。
 *
 * ⚠️ 本版两个方法均为占位实现（抛 NotImplemented 语义的明确错误）——
 * 契约位先行，真实互转等 DSH 正式版 + 后端跑通后验证。
 */
export interface DshSeamConverter {
  /** sofagent → DSH 消费面 */
  toDshSurface(): {
    ok: boolean;
    surface?: Record<string, unknown>;
    /** 未实现时的明确提示（非 crash） */
    reason?: string;
  };
  /** DSH 消费面 → sofagent（回流校验用） */
  fromDshSurface(surface: Record<string, unknown>): {
    ok: boolean;
    workflow?: ParsedWorkflow;
    reason?: string;
  };
}

/**
 * 创建 seam 转换器（绑定已解析 workflow）。
 * 真实互转等 DSH 正式版——本版返回映射文档 + 明确的未实现提示。
 */
export function createDshSeamConverter(parsed: ParsedWorkflow): DshSeamConverter {
  return {
    toDshSurface() {
      return {
        ok: false,
        reason:
          'DSH workflow seam 真实互转待 DSH 正式版（当前 rc 期版本守卫拦截）——' +
          `契约位已就绪：${DSH_SEAM_FIELD_MAPPINGS.length} 条字段映射，workflow="${parsed.name}"，` +
          'v1.4.0 cordis-plugin 同批实现（接口签名本版冻结，向后兼容）。',
      };
    },
    fromDshSurface(_surface) {
      return {
        ok: false,
        reason: 'DSH 消费面 → sofagent 反向互转待 DSH 正式版（契约位先行，见 DSH_SEAM_FIELD_MAPPINGS）',
      };
    },
  };
}
