// ============================================================
// ontology-import.ts · MCP tool：ontology_import（v1.3.6 交付 ②）
// ============================================================
//
// Ontology 标准注入入口——外部提交 entity/concept/relations（JSON 文本），
// 委托 @sofagent/orchestrator 的 importOntology 管线：
//   v1.3.1 schema 校验（单一事实源）→ D1-D5 数据审计 → 注册 entity-store
//   + 写 knowledge 页 → decision-log 留痕（谁注入的 / 注入什么 / 校验结果）
//
// 行为契约：
//   - 全量校验先行：任何一项非法 → 返回结构化错误清单（issues），零写入
//   - 注入失败可回滚：管线中途失败自动还原已写文件（文件级还原）；
//     历史级回溯走 git snapshot 兜底（snapshot_list / snapshot_restore）
//   - DSH 语义层提供方预留：import 参数 ↔ Cordis tool schema 对照已落
//     ONTOLOGY_IMPORT_DSH_MAPPING（v1.4.0 cordis-plugin 同批包装）
// ============================================================

import { join } from 'path';

/** 获取数据根目录（与 create-entity 同源规则） */
function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

export interface OntologyImportArgs {
  /** ontology JSON 文本：{ entities?, concepts?, relations? } */
  payload: string;
  /** 注入者标识（decision-log 留痕——谁注入的；缺省 'external-model-layer'） */
  agent_id?: string;
  /** 注入备注（decision-log why 补充） */
  comment?: string;
}

/**
 * 结构化结果（对齐 snapshot_restore 模式——data 带具体类型）。
 */
export interface OntologyImportToolResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    /** 注入是否成功 */
    ok: boolean;
    /** 结构化错误清单（ok=false 时非空） */
    issues: string[];
    /** 注入统计（ok=true 时有值） */
    imported?: { entities: number; concepts: number; relations: number };
    /** 写入文件数（ok=true 时有值） */
    writtenFiles?: number;
    /** D1-D5 审计是否 WARN（ok=true 时） */
    auditWarn?: boolean;
    /** decision-log 是否留痕成功（ok=true 时） */
    decisionLogged?: boolean;
    /** 回滚说明（发生回滚时非空） */
    rollbackNote?: string;
  };
}

/**
 * ontology_import——外部提交 ontology 进约束层。
 */
export async function ontologyImport(args: OntologyImportArgs): Promise<OntologyImportToolResult> {
  const { payload, agent_id, comment } = args;

  if (typeof payload !== 'string' || payload.trim() === '') {
    return {
      text: '[sofagent] ontology_import 失败：payload 内容为空',
      data: { isError: true, ok: false, issues: ['payload 内容为空'] },
    };
  }

  // 1. JSON 解析（外部提交的是 JSON 文本）
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] ontology_import 失败：payload 不是合法 JSON——${msg}`,
      data: { isError: true, ok: false, issues: [`payload JSON 解析失败：${msg}`] },
    };
  }

  // 2. 委托注入管线
  try {
    const { importOntology } = await import('@sofagent/orchestrator');
    const result = importOntology(parsedPayload as never, {
      dataDir: getSofagentDataDir(),
      agentId: agent_id ?? 'external-model-layer',
      ...(typeof comment === 'string' && comment.trim() !== '' ? { comment } : {}),
    });

    if (!result.ok) {
      return {
        text:
          `[sofagent] ontology 注入未通过 ❌（${result.issues.length} 项）：` +
          result.issues.join('；') +
          (result.rollbackNote ? `\n  ${result.rollbackNote}` : ''),
        data: {
          isError: true,
          ok: false,
          issues: result.issues,
          ...(result.rollbackNote ? { rollbackNote: result.rollbackNote } : {}),
        },
      };
    }

    const { entities, concepts, relations } = result.imported;
    const warnNote = result.audit.hasWarn ? `（D1-D5 警告 ×${result.audit.warnCount}）` : '';
    return {
      text:
        `[sofagent] ontology 注入成功 ✅ ${entities} entity + ${concepts} concept + ` +
        `${relations} relation · ${result.written.length} 文件${warnNote}` +
        ` · decision-log ${result.decisionLogged ? '已留痕' : '留痕降级（不阻塞）'}`,
      data: {
        isError: false,
        ok: true,
        issues: result.issues,
        imported: result.imported,
        writtenFiles: result.written.length,
        auditWarn: result.audit.hasWarn,
        decisionLogged: result.decisionLogged,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] ontology_import 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
