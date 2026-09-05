// ============================================================
// skill-evolution/isolation-guard.ts · 执行/进化上下文隔离守卫
// v1.4.5 第七章四新增（WikiSkill 消融 -2.8pt 实证收编）
// ============================================================
//
// WikiSkill 消融实证：推理时（rollout 期）让 Agent 直接查知识库，
// 产出的轨迹对技能开发失去参考价值（-2.8pt）——知识仅供进化者
// （Proposer/Maintainer）离线消费。落到 sofagent 的显式约束：
//
//   一、执行 Agent 运行期不可读进化知识库（rollout 期禁查 Wiki）
//      ——运行时守卫：执行中访问 evolution 知识目录即审计告警
//   二、history/lessons 只进不出（写入不读取）
//   三、进化提案发生在任务边界之外（提案窗口标记，任务内禁提案）
//
// 告警语义：违反是「审计事件」不是崩溃——记录 + 返回 false 让
// 调用方（执行环境）决定是否阻断。告警文件 append-only。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

/** 隔离告警文件路径（data/skill-evolution/isolation-violations.jsonl） */
export function isolationViolationsPath(dataDir: string): string {
  return join(dataDir, 'skill-evolution', 'isolation-violations.jsonl');
}

/** 运行上下文角色（隔离策略的判据） */
export type ContextRole = 'executor' | 'evolver';

/** 隔离告警记录 */
export interface IsolationViolation {
  /** ISO 8601 时间戳 */
  ts: string;
  /** 违反者角色（executor 期访问进化知识库是典型违反） */
  role: ContextRole;
  /** 被访问的进化知识路径（knowledge/entities 等只进进化者可达的目录） */
  attemptedPath: string;
  /** 访问方式（read/list/search——只进不出的『出』即这三类） */
  accessKind: 'read' | 'list' | 'search';
  /** 关联任务 ID（执行上下文携带——无任务标记『边界外』） */
  taskId?: string;
  /** 告警说明（固定语义文本） */
  message: string;
}

/** 进化知识目录判定（这些目录在执行 Agent 运行期禁读） */
export function isEvolutionKnowledgePath(p: string): boolean {
  const normalized = p.replace(/\\/g, '/');
  return (
    normalized.includes('knowledge/entities') ||
    normalized.includes('skill-evolution') ||
    normalized.includes('instinct/failure-log')
  );
}

/**
 * 运行时守卫——执行 Agent 期间的进化知识库访问检查。
 *
 * @returns true = 允许（evolver 角色或非进化知识路径）
 *          false = 拒绝（executor 访问进化知识——已记审计告警）
 */
export function guardKnowledgeAccess(
  dataDir: string,
  role: ContextRole,
  attemptedPath: string,
  accessKind: 'read' | 'list' | 'search',
  taskId?: string,
): boolean {
  // evolver（Proposer/Maintainer）离线消费合法——WikiSkill 语义
  if (role === 'evolver') return true;
  // executor 访问普通路径合法——只拦进化知识目录
  if (!isEvolutionKnowledgePath(attemptedPath)) return true;

  // 违反：executor 运行期访问进化知识库 → 审计告警（append-only）+ 拒绝
  const violation: IsolationViolation = {
    ts: new Date().toISOString(),
    role,
    attemptedPath,
    accessKind,
    ...(taskId ? { taskId } : {}),
    message:
      '执行/进化上下文隔离违反：执行 Agent 运行期不可读进化知识库（rollout 期禁查 Wiki，消融 -2.8pt 实证）——知识仅供进化者离线消费',
  };
  const dir = join(dataDir, 'skill-evolution');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(isolationViolationsPath(dataDir), JSON.stringify(violation) + '\n', 'utf-8');
  return false;
}

/** 读隔离告警记录（审计/报告消费——坏行跳过宽松语义） */
export function readIsolationViolations(dataDir: string): IsolationViolation[] {
  const path = isolationViolationsPath(dataDir);
  if (!existsSync(path)) return [];
  const violations: IsolationViolation[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      violations.push(JSON.parse(line) as IsolationViolation);
    } catch {
      // 坏行跳过
    }
  }
  return violations;
}
