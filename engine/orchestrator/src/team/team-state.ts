// ============================================================
// team-state.ts · TeamState CRDT 类型 + 同步通道抽象（v1.3.7 交付 T02）
//
// 团队共享态的 CRDT 文档结构 + 跨设备同步通道接口。
// v1.3.7 交付 4b：automerge 1.0.1-preview.7 → @automerge/automerge 3.4.1
// （旧包名废弃，新包 Rust WASM 稳定核心；API 迁移对照见 v1.3.9 dev-prompt）
//
// ⚠️ 依赖方向铁律：
//   orchestrator 定义 TeamSyncChannel 接口（纯类型），提供 LocalTeamSyncChannel
//   默认实现（单机 no-op）。daemon 实现 FederatedTeamSyncChannel（复用加密链路）。
//   orchestrator 绝不 import daemon——依赖注入模式。
// ============================================================

import {
  init,
  change,
  save,
  load,
  merge,
} from '@automerge/automerge';
import type { Doc } from '@automerge/automerge';

// ────────────────────────────────────────────────────────────
// TeamState CRDT 文档结构（协议设计 §1.2）
// ────────────────────────────────────────────────────────────

/** 单个成员的实时状态 */
export interface MemberState {
  /** Agent 身份码（v1.3.1） */
  agentId: string;
  /** 角色：leader / member */
  role: 'leader' | 'member';
  /**
   * trust 值（0.0–1.0）
   *
   * ⚠️ 铁律：trust 只是冲突消解排序权重（resolveConflict 的第一排序键），
   * 不是权限判定 / 准入控制。不出现在任何 if 条件分支里。
   * 成员能不能加入团队由 team-manager 无条件接受 team.yml 声明；
   * 能不能调用工具归 v1.3.7 权限体系。
   */
  trust: number;
  /** 实时状态 */
  status: 'idle' | 'busy' | 'blocked' | 'offline';
  /** 当前正在执行的 taskId */
  currentTask?: string;
  /** 最后心跳时间（ISO 8601，用于离线检测） */
  lastHeartbeat: string;
}

/** 任务状态 */
export interface TaskState {
  taskId: string;
  description: string;
  assignee: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
  updatedAt: string;
}

/** 文件锁（乐观并发——写前检查，冲突时走 resolveConflict） */
export interface FileLockEntry {
  filePath: string;
  holder: string;
  acquiredAt: string;
}

/** 反馈条目（反馈放大机制写入） */
export interface FeedbackEntry {
  id: string;
  agentId: string;
  type: 'correction' | 'confirmation' | 'quality_rule';
  content: string;
  ts: string;
}

/** 团队共享态 CRDT 文档 */
export interface TeamStateDoc {
  meta: {
    teamId: string;
    name: string;
    createdAt: string;
  };
  members: Record<string, MemberState>;
  tasks: Record<string, TaskState>;
  fileLocks: Record<string, FileLockEntry>;
  feedback: FeedbackEntry[];
}

// ────────────────────────────────────────────────────────────
// CRDT 操作原语（对齐 core/federation.ts 的 Automerge 用法）
// ────────────────────────────────────────────────────────────

/**
 * 初始化团队共享态 CRDT 文档。
 *
 * @param teamId 团队 ID
 * @param name 团队名称
 * @returns 初始化后的 Automerge 文档
 */
export function initTeamState(teamId: string, name: string): Doc<TeamStateDoc> {
  let doc = init<TeamStateDoc>();
  doc = change(doc, (d) => {
    d.meta = { teamId, name, createdAt: new Date().toISOString() };
    d.members = {};
    d.tasks = {};
    d.fileLocks = {};
    d.feedback = [];
  });
  return doc;
}

/**
 * 添加成员到团队共享态。
 *
 * @param doc 当前 CRDT 文档
 * @param member 成员状态
 * @returns 更新后的文档（不可变——Automerge.change 返回新文档）
 */
export function addMember(
  doc: Doc<TeamStateDoc>,
  member: MemberState,
): Doc<TeamStateDoc> {
  return change(doc, (d) => {
    d.members[member.agentId] = member;
  });
}

/**
 * 更新成员状态（status / currentTask / heartbeat）。
 */
export function updateMemberStatus(
  doc: Doc<TeamStateDoc>,
  agentId: string,
  update: Partial<Pick<MemberState, 'status' | 'currentTask' | 'lastHeartbeat'>>,
): Doc<TeamStateDoc> {
  return change(doc, (d) => {
    const member = d.members[agentId];
    if (member) {
      if (update.status !== undefined) member.status = update.status;
      if (update.currentTask !== undefined) member.currentTask = update.currentTask;
      if (update.lastHeartbeat !== undefined) member.lastHeartbeat = update.lastHeartbeat;
    }
  });
}

/**
 * 添加任务到团队共享态。
 */
export function addTask(
  doc: Doc<TeamStateDoc>,
  task: TaskState,
): Doc<TeamStateDoc> {
  return change(doc, (d) => {
    d.tasks[task.taskId] = task;
  });
}

/**
 * 获取/释放文件锁。
 *
 * @param doc 当前 CRDT 文档
 * @param filePath 文件路径
 * @param holder 持有者 agentId（设为 null 表示释放）
 * @returns 更新后的文档
 */
export function setFileLock(
  doc: Doc<TeamStateDoc>,
  filePath: string,
  holder: string | null,
): Doc<TeamStateDoc> {
  return change(doc, (d) => {
    if (holder === null) {
      delete d.fileLocks[filePath];
    } else {
      d.fileLocks[filePath] = { filePath, holder, acquiredAt: new Date().toISOString() };
    }
  });
}

/**
 * 追加反馈条目（反馈放大机制写入）。
 */
export function appendFeedback(
  doc: Doc<TeamStateDoc>,
  entry: FeedbackEntry,
): Doc<TeamStateDoc> {
  return change(doc, (d) => {
    d.feedback.push(entry);
  });
}

/**
 * 序列化 CRDT 文档为二进制（用于持久化 / 跨设备传输）。
 */
export function saveTeamState(doc: Doc<TeamStateDoc>): Uint8Array {
  return save(doc);
}

/**
 * 从二进制反序列化 CRDT 文档。
 *
 * v1.3.5 交付 4b：@automerge/automerge 3.x 的 load 直接接受 Uint8Array，
 * 旧 1.x 的 BinaryDocument 品牌类型断言已移除。
 */
export function loadTeamState(binary: Uint8Array): Doc<TeamStateDoc> {
  return load<TeamStateDoc>(binary);
}

/**
 * 合并两个 CRDT 文档（跨设备同步后收敛）。
 *
 * CRDT 保证合并后状态不丢——会话重启时 load 持久化二进制 + merge 远端增量即可恢复。
 */
export function mergeTeamState(
  local: Doc<TeamStateDoc>,
  remote: Doc<TeamStateDoc>,
): Doc<TeamStateDoc> {
  return merge(local, remote);
}

// ────────────────────────────────────────────────────────────
// 同步通道抽象（依赖注入——orchestrator 定义接口，daemon 实现）
// ────────────────────────────────────────────────────────────

/**
 * 团队同步通道抽象（协议设计 §5.3）。
 *
 * orchestrator 定义此接口（纯类型，零运行时依赖 daemon）。
 * daemon 实现 FederatedTeamSyncChannel（复用 v1.1.8 AES-256-GCM 加密链路）。
 * mcp 层注入 Federated 实例到 orchestrator 的 TeamManager。
 *
 * 默认提供 LocalTeamSyncChannel（单机模式，联邦功能降级为 no-op）。
 */
export interface TeamSyncChannel {
  /** 广播 team-state 增量到团队其他成员的设备 */
  syncTeamState(binary: Uint8Array): Promise<void>;
  /** 接收远端 team-state 增量 */
  onRemoteUpdate(cb: (binary: Uint8Array) => void): void;
}

/**
 * 本地单机同步通道（默认实现——无联邦，所有方法 no-op）。
 *
 * 单机模式下团队功能降级运行（共享态仅本地维护，不跨设备同步）。
 * 联邦功能启用时由 daemon 的 FederatedTeamSyncChannel 替换。
 */
export class LocalTeamSyncChannel implements TeamSyncChannel {
  async syncTeamState(_binary: Uint8Array): Promise<void> {
    // 本地模式：无远端，no-op
  }
  onRemoteUpdate(_cb: (binary: Uint8Array) => void): void {
    // 本地模式：无远端更新
  }
}
