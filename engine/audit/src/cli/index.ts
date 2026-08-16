// ============================================================
// audit/cli/index.ts · CLI 子命令桶文件（v1.3.5 · P2）
// ============================================================

export {
  runConflictCheckCli,
  parseConflictCheckArgs,
} from './conflict-check';
export type {
  ConflictCheckArgs,
  ConflictCheckResult,
  ConflictCheckFn,
} from './conflict-check';

export {
  runFederationDistillCli,
  parseFederationDistillArgs,
} from './federation-distill';
export type {
  FederationDistillArgs,
  DistillResult,
  MergeFn,
} from './federation-distill';
