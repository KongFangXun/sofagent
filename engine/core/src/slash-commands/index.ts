// ============================================================
// slash-commands/index.ts · Slash 命令导出
// v1.2.7 新建 · 功能 ①②
//
// 统一导出 slash 命令实现 + 注册表。
// handler.ts / CLI 入口通过本文件注册命令到 globalSlashRegistry。
// ============================================================

export {
  SlashCommandRegistry,
  globalSlashRegistry,
} from '../slash-registry';
export type {
  SlashCommand,
  SlashCommandContext,
  SlashResolveResult,
} from '../slash-registry';

// v1.2.7 功能 ②: /compact 命令
export { CompactCommand } from './compact';

// v1.2.7 功能 ①: /goal 命令
export { GoalCommand } from './goal';
export type { SessionGoal, LoopSpecGoalExtension } from './goal';

/**
 * 注册所有内置 slash 命令到指定注册表（或全局注册表）。
 *
 * 在 handler.ts bootstrap 阶段调用一次即可。
 *
 * @param registry 目标注册表（缺省使用 globalSlashRegistry）
 */
export function registerBuiltinSlashCommands(
  registry?: SlashCommandRegistry,
): void {
  const reg = registry ?? globalSlashRegistry;
  reg.register(new CompactCommand());
  reg.register(new GoalCommand());
}
