// ============================================================
// audit-decision-writer.ts · decision-log 写入软依赖收口（v1.5.7 章二）
//
// 背景：core 是零上层依赖的底座（依赖方向单向 audit → core），**不得静态 import
// @sofagent/audit**。但 core 侧确有两处需要写 decision-log 留痕：
//   · doctor.ts 的 --refresh 三段（kind=CONFIG_CHANGE）；
//   · audit-dir-maintenance.ts 的遗留备份清理（kind=LEGACY_CLEANUP）。
// 两处共用本文件的 emitAuditDecision——**运行时**动态解析 @sofagent/audit 的
// emitDecision（受控写唯一入口），解析不到则返回 null（fail-open，留痕缺失由调用方
// 如实暴露）。这样既避免「第二份链写实现」，又不在 package.json 引入 core → audit 边。
//
// 解析基准：默认从本模块自身位置向上解析（monorepo 下命中根 node_modules/@sofagent/audit；
// 安装态下命中同级的 @sofagent/audit）——不依赖调用方项目的 node_modules。
// 显式传 projectDir 时沿用 doctor 的旧语义（从该项目解析），保持 100% 向后兼容。
// ============================================================

import { createRequire } from 'module';
import { join } from 'path';

/** decision-log 写入入参（跨包软依赖的收敛面——字段取 emitDecision 所需子集） */
export interface AuditDecisionInput {
  /** 决策种类（DecisionKind 字面量；本模块不校验，交 @sofagent/audit 白名单门） */
  kind: string;
  /** 决策发生时刻（LoopPhase 字面量） */
  moment: string;
  /** 决策理由（字符串或 {text,tags} 结构） */
  why: string | { text: string; tags?: string[] };
  /** 判断时刻分类（可选；route/select/skip/retry/escalate） */
  category?: string;
  /** 触发证据链（可选） */
  evidence?: string[];
  /** Agent 标识（缺省 'sofagent'） */
  agentId?: string;
  /** 会话标识（缺省 `audit-<写入时刻>`) */
  sessionId?: string;
}

/** 动态解析 @sofagent/audit 的 emitDecision 并写入一条 decision-log 记录。 */
type EmitDecisionFn = (input: Record<string, unknown>, dataDir?: string) => { ts: string };

/**
 * 写入一条 decision-log 记录（受控写软依赖收口）。
 *
 * @param input 决策入参（见 {@link AuditDecisionInput}）
 * @param dataDir 数据目录覆盖（测试隔离用；传给 emitDecision 决定落盘位置）
 * @param projectDir 可选——从该项目解析 @sofagent/audit（doctor 旧语义）；
 *                   缺省从本模块自身位置解析（更稳）
 * @returns { ts } 成功；null = @sofagent/audit 不可解析 / 未导出 emitDecision / 写入抛错
 */
export function emitAuditDecision(
  input: AuditDecisionInput,
  dataDir?: string,
  projectDir?: string,
): { ts: string } | null {
  try {
    const requireFrom = projectDir
      ? createRequire(join(projectDir, 'package.json'))
      : createRequire(__filename);
    const auditMod = requireFrom('@sofagent/audit') as { emitDecision?: EmitDecisionFn };
    if (typeof auditMod.emitDecision !== 'function') return null;

    const entry = auditMod.emitDecision(
      {
        agentId: input.agentId ?? 'sofagent',
        sessionId: input.sessionId ?? `audit-${Date.now()}`,
        kind: input.kind,
        moment: input.moment,
        ...(input.category !== undefined ? { category: input.category } : {}),
        why: input.why,
        ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
      },
      dataDir,
    );
    return { ts: entry.ts };
  } catch (err) {
    // 留痕失败不阻断调用方主路径（与 doctor --refresh / audit-middleware 同容错铁律），
    // 但打到 stderr 保证可见——返回 null 让调用方如实暴露「留痕缺失」。
    console.error('[audit-decision-writer] 写入 decision-log 失败:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
