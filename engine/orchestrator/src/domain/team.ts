// ============================================================
// domain/team.ts · 团队协作域（team/hitl/formations/onboard）——域级 barrel（v1.5.7 F32）
// ------------------------------------------------------------
// 只 re-export 本域符号（源码引用只写相对路径）。
// 根 barrel（src/index.ts）保持不变——零 breaking；新代码建议按域子路径
// 导入（@sofagent/orchestrator/domain/team），根 barrel 为兼容面。
// 导出集与根 barrel 同域段落 1:1（同一批语句分拣而来，勿在此单面新增符号——
// 新符号先进根 barrel 再同步分拣到本文件，避免两面漂移）。
// 子路径挂点：package.json exports "./domain/team"。
// ============================================================
/* @public */ export {
  initTeamState,
  addMember,
  updateMemberStatus,
  addTask,
  setFileLock,
  appendFeedback,
  saveTeamState,
  loadTeamState,
  mergeTeamState,
  LocalTeamSyncChannel,
} from '../team/team-state';
/* @public */ export type {
  TeamStateDoc,
  MemberState,
  TaskState,
  FileLockEntry,
  FeedbackEntry,
  TeamSyncChannel,
} from '../team/team-state';
/* @public */ export { IntentBus, matchIntent } from '../team/intent-bus';
/* @public */ export type { IntentEvent, Subscription, ConvergenceResult } from '../team/intent-bus';
/* @public */ export {
  resolveConflict,
  detectFileLockConflict,
  amplifyFeedback,
  getFeedback,
  getFeedbackByType,
} from '../team/protocol';
/* @public */ export type {
  TeamConflictParty,
  ConflictResolutionResult,
  FeedbackType,
  AmplifyFeedbackInput,
} from '../team/protocol';
/* @public */ export {
  TeamManager,
  createTeam,
  parseTeamYaml,
  getTeamStatePath,
  TeamYamlError,
} from '../team/team-manager';
/* @public */ export type {
  TeamYaml,
  TeamYamlMember,
  TeamYamlBroadcastChannel,
  TeamManagerOptions,
  EnqueueSubAgentInput,
} from '../team/team-manager';
/* @public */ export {
  HITL_OPTIONS,
  shouldUseAsyncHITL,
  writeHITLRequest,
  readHITLResponse,
  writeHITLResponse,
  type HITLDecision,
  type HITLRequest,
  type HITLResponse,
} from '../hitl';
/* @public */ export { deriveAgentFromRequirement } from '../onboard/agent-creator';
/* @public */ export type { AgentCreationResult, DerivedAgentConfig } from '../onboard/agent-creator';
/* @public */ export { validateAgentCreation, checkNoModelPersistence } from '../onboard/creation-validator';
/* @public */ export type { ValidationResult } from '../onboard/creation-validator';
