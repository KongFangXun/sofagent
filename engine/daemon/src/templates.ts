// ============================================================
// templates.ts · 首部署 cron job 模板库（G8 · v1.4.7）
//
// 从 cli.ts scheduler create 内联表抽出为独立模块——模板增多
// 不再撑爆 CLI 入口文件；billing/templates 单测挂本模块。
//
// 模板语义：预置 prompt 的便捷面（显式 --prompt 优先）——
// 模板只填 prompt 与建议 schedule，不改变 scheduler.create
// 既有校验路径（name/schedule/type 推断逻辑不动）。
// ============================================================

/** 模板定义 */
export interface SchedulerTemplate {
  /** 模板 ID（--template 取值） */
  id: string;
  /** 展示名 */
  label: string;
  /** 建议 schedule（可被显式 --schedule 覆盖） */
  defaultSchedule: string;
  /** 预置 prompt */
  prompt: string;
  /** 模板用途说明（帮助文本） */
  description: string;
}

/**
 * 首部署模板库（G8：部署即见效的确定性任务）。
 *
 * daily-health：客户部署第一天就看到的每日产出（G8 核心模板）；
 * weekly-report：L2 深度巡检周报（扩展位，验证模板库可增长）。
 */
export const SCHEDULER_TEMPLATES: SchedulerTemplate[] = [
  {
    id: 'daily-health',
    label: '每日健康巡检',
    defaultSchedule: '@daily',
    prompt: '每日健康巡检：检查 daemon 状态、审计历史增量、WARN 累积并汇总日报',
    description: 'daemon 状态 + 审计增量 + WARN 累积日报（G8 首部署核心模板）',
  },
  {
    id: 'weekly-report',
    label: '每周巡检报告',
    defaultSchedule: '@weekly',
    prompt: '每周巡检报告：L2 深度巡检全量执行并输出周报（知识矛盾/孤儿/死链/新鲜度）',
    description: 'L2 深度巡检全量周报（知识矛盾/孤儿/死链/新鲜度）',
  },
];

/** 按 ID 取模板（不存在返回 undefined） */
export function getTemplate(id: string): SchedulerTemplate | undefined {
  return SCHEDULER_TEMPLATES.find((t) => t.id === id);
}

/** 模板 ID 清单（帮助文本用，如 "daily-health / weekly-report"） */
export function templateIds(): string {
  return SCHEDULER_TEMPLATES.map((t) => t.id).join(' / ');
}
