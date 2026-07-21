// ============================================================
// skillopt/backfill.ts · Dream Cycle skillopt_backfill 钩子
// v1.1.8 新增
//
// 供 @sofagent/daemon Dream Cycle Stage 5 调用：把合成出的 Concept
// 回灌给 skillopt 自进化引擎，触发 fde.md 优化钩子。
//
// 本版设计：backfill 是「记录待优化线索」的轻量钩子——把 concept 的
// 来源/标题登记到进程内队列，供 skillopt 后续优化周期消费。真正的
// fde.md 改写仍走 skillopt-integration 的 runSkillOpt（就地演化 +
// validateCandidate 校验），本钩子不直接改任何 live 文件。
// ============================================================

/** 可被回灌的最小概念形状（与 daemon 的 Concept 结构对齐） */
export interface BackfillConcept {
  /** slug */
  slug: string;
  /** 概念标题 */
  title: string;
  /** 来源回指 */
  source: string;
  /** 敏感性分级 */
  sensitivity?: 'public' | 'internal' | 'restricted';
}

/** 回灌队列条目（待 skillopt 优化周期消费的线索） */
export interface BackfillEntry {
  /** 概念 slug */
  slug: string;
  /** 概念标题 */
  title: string;
  /** 来源回指 */
  source: string;
  /** 回灌时间 ISO 字符串 */
  queuedAt: string;
}

/** 进程内回灌队列（本版轻量态） */
const queue: BackfillEntry[] = [];

/**
 * Dream Cycle 回灌钩子——把 concept 登记到待优化队列。
 *
 * - 空数组 → 空操作（不报错）
 * - 返回本轮回灌条数，供 Dream Cycle Stage 5 断言/记录
 */
export function backfill(concepts: BackfillConcept[]): Promise<number> {
  for (const concept of concepts) {
    queue.push({
      slug: concept.slug,
      title: concept.title,
      source: concept.source,
      queuedAt: new Date().toISOString(),
    });
  }
  return Promise.resolve(concepts.length);
}

/** 查询当前回灌队列（供调试/测试断言） */
export function getBackfillQueue(): readonly BackfillEntry[] {
  return queue;
}

/** 清空回灌队列（测试用） */
export function clearBackfillQueue(): void {
  queue.length = 0;
}
