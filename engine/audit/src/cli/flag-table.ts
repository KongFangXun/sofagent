// ============================================================
// cli/flag-table.ts · audit CLI 子命令与 flag 单源（v1.4.9 深模块条目 8）
// ============================================================
// 背景：SUBCOMMANDS（index.ts）与 FULL_ONLY_SUBCOMMANDS（cli-quick.ts）
// 两处手工同步，历史 F-12/F-13 两次漂移事故。本文件是唯一事实源，
// 两处均从此导入派生。只做数据单源，不动解析逻辑。
// ============================================================

/** 全部子命令（quick 入口见名提示装完整版；full 入口直接分发） */
export const AUDIT_SUBCOMMANDS: readonly string[] = [
  'ontology',
  'conflict-check',
  'federation-distill',
  'agent-shield',
  'corpus',
] as const;

/** 完整版专属 flag（quick 模式遇到 → 提示装完整版或自动路由）——与 cli-quick 既有清单逐项对齐（单源化时零成员变化） */
export const FULL_ONLY_FLAGS: readonly string[] = [
  '--init', '--doctor', '--install-hook',
  '--list-rulesets', '--ruleset', '--ruleset-path',
  '--support-bundle', '--sign-config', '--verify-chain', '--verify-commit',
  '--diff', '--cached', '--silent', '--ci', '--task', '--commit-msg',
  // --timeline / --revert 只在完整引擎实现（index.ts 解析 + 快照时间线 / 回滚执行）。
  // quick 侧不识别时它们落进位置参数分支被忽略 ⇒ 对 HEAD 跑一次审计并 exit 0——用户以为
  // 查了时间线/做了回滚，实际审计的是错对象且拿到假绿。收纳进本表后 quick 命中即转完整引擎。
  '--timeline', '--revert',
  '--strict',
] as const;
