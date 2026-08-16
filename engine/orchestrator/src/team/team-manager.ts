// ============================================================
// team-manager.ts · 团队生命周期管理（v1.3.6 交付 T02）
//
// 职责：
//   1. 建队——从 team.yml 解析成员 → 初始化 CRDT 文档
//   2. 加入/退出——成员状态维护（status/heartbeat）
//   3. 持久化——CRDT save/load（会话重启状态不丢）
//   4. 同步——经 TeamSyncChannel 跨设备同步（依赖注入）
//   5. 主 agent 编排——enqueueSubAgent 自动入队（协议设计 §6.2）
//
// ⚠️ 依赖方向：team-manager 不 import daemon。
// TeamSyncChannel 由外部注入（默认 LocalTeamSyncChannel 单机 no-op）。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import * as yaml from 'js-yaml';
import { change } from '@automerge/automerge';
import type { Doc } from '@automerge/automerge';
import { loadEnvConfig } from '@sofagent/core';

import type { TeamStateDoc, MemberState, TeamSyncChannel, TaskState } from './team-state';
import {
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
} from './team-state';
import { IntentBus } from './intent-bus';
import type { IntentEvent } from './intent-bus';

// ────────────────────────────────────────────────────────────
// team.yml 解析（dev prompt L77-95 格式）
// ────────────────────────────────────────────────────────────

/** team.yml 中的成员声明 */
export interface TeamYamlMember {
  agent_id: string;
  role: 'leader' | 'member';
  trust: number;
}

/** team.yml 中的广播频道声明 */
export interface TeamYamlBroadcastChannel {
  name: string;
  subscribe: string[];
  trigger_on: string[];
}

/** team.yml 完整结构 */
export interface TeamYaml {
  name: string;
  team_id: string;
  members: TeamYamlMember[];
  shared_state: string[];
  broadcast_channels: TeamYamlBroadcastChannel[];
}

/** team.yml 解析错误 */
export class TeamYamlError extends Error {
  constructor(message: string) {
    super(`[team-manager] team.yml 解析失败: ${message}`);
    this.name = 'TeamYamlError';
  }
}

/**
 * 解析 team.yml 文本为结构化 TeamYaml。
 *
 * @param yamlText team.yml 文本
 * @returns 解析后的结构
 * @throws TeamYamlError 格式非法
 */
export function parseTeamYaml(yamlText: string): TeamYaml {
  let doc: unknown;
  try {
    doc = yaml.load(yamlText);
  } catch (e) {
    throw new TeamYamlError(`YAML 解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof doc !== 'object' || doc === null) {
    throw new TeamYamlError('YAML 顶层不是对象');
  }
  const root = doc as Record<string, unknown>;
  if (typeof root.name !== 'string' || root.name.trim() === '') {
    throw new TeamYamlError('缺 name 字段');
  }
  if (typeof root.team_id !== 'string' || root.team_id.trim() === '') {
    throw new TeamYamlError('缺 team_id 字段');
  }
  if (!Array.isArray(root.members) || root.members.length === 0) {
    throw new TeamYamlError('members 缺失或为空数组');
  }
  const members: TeamYamlMember[] = root.members.map((m, i) => {
    if (typeof m !== 'object' || m === null) throw new TeamYamlError(`members[${i}] 不是对象`);
    const mo = m as Record<string, unknown>;
    if (typeof mo.agent_id !== 'string' || mo.agent_id.trim() === '') {
      throw new TeamYamlError(`members[${i}] 缺 agent_id`);
    }
    if (mo.role !== 'leader' && mo.role !== 'member') {
      throw new TeamYamlError(`members[${i}] role 非法（${String(mo.role)}），必须为 leader|member`);
    }
    if (typeof mo.trust !== 'number' || mo.trust < 0 || mo.trust > 1) {
      throw new TeamYamlError(`members[${i}] trust 非法（${String(mo.trust)}），必须为 0.0-1.0`);
    }
    return { agent_id: mo.agent_id, role: mo.role, trust: mo.trust };
  });

  const shared_state = Array.isArray(root.shared_state)
    ? root.shared_state.map((s) => String(s))
    : [];
  const broadcast_channels: TeamYamlBroadcastChannel[] = Array.isArray(root.broadcast_channels)
    ? root.broadcast_channels.map((ch) => {
        const cho = ch as Record<string, unknown>;
        return {
          name: typeof cho.name === 'string' ? cho.name : 'unnamed',
          subscribe: Array.isArray(cho.subscribe) ? cho.subscribe.map(String) : [],
          trigger_on: Array.isArray(cho.trigger_on) ? cho.trigger_on.map(String) : [],
        };
      })
    : [];

  return {
    name: root.name,
    team_id: root.team_id,
    members,
    shared_state,
    broadcast_channels,
  };
}

// ────────────────────────────────────────────────────────────
// 自动入队的 sub-agent 定义（协议设计 §6.2）
// ────────────────────────────────────────────────────────────

/** 待入队的 sub-agent 定义 */
export interface EnqueueSubAgentInput {
  /** sub-agent 名称 / id */
  agentId: string;
  /** 角色默认 member（自动入队的 sub-agent 不是 leader） */
  role?: 'leader' | 'member';
  /** trust 缺省 0.5（中等权重——自动生成的不预设高信任） */
  trust?: number;
}

// ────────────────────────────────────────────────────────────
// TeamManager
// ────────────────────────────────────────────────────────────

/** TeamManager 构造选项 */
export interface TeamManagerOptions {
  /** 数据目录（缺省用 loadEnvConfig） */
  dataDir?: string;
  /** 同步通道（缺省 LocalTeamSyncChannel 单机 no-op） */
  syncChannel?: TeamSyncChannel;
  /** 收敛窗口 ms（缺省 5000） */
  convergenceWindowMs?: number;
}

/**
 * 团队管理器——封装团队生命周期 + 编排。
 *
 * 持有 CRDT 文档（TeamStateDoc）+ 意图总线（IntentBus）。
 * 持久化路径：`<dataDir>/teams/<teamId>/team-state.automerge`
 */
export class TeamManager {
  private doc: Doc<TeamStateDoc>;
  private readonly teamId: string;
  private readonly dataDir: string;
  private readonly syncChannel: TeamSyncChannel;
  private readonly stateFilePath: string;
  readonly intentBus: IntentBus;

  constructor(teamYaml: TeamYaml, options: TeamManagerOptions = {}) {
    this.teamId = teamYaml.team_id;
    this.dataDir = options.dataDir ?? loadEnvConfig().dataDir;
    this.syncChannel = options.syncChannel ?? new LocalTeamSyncChannel();
    this.stateFilePath = join(this.dataDir, 'teams', this.teamId, 'team-state.automerge');
    this.intentBus = new IntentBus(this.teamId, options.convergenceWindowMs);

    // 初始化 CRDT 文档——先尝试从持久化恢复，否则新建
    this.doc = this.loadOrInit(teamYaml);

    // 注册远端更新回调——收到远端增量后 merge
    this.syncChannel.onRemoteUpdate((binary) => {
      try {
        const remoteDoc = loadTeamState(binary);
        this.doc = mergeTeamState(this.doc, remoteDoc);
      } catch (err) {
        console.error(`[team-manager] 远端 team-state merge 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  /** 获取当前 CRDT 文档（只读——外部不应直接修改） */
  getState(): Doc<TeamStateDoc> {
    return this.doc;
  }

  /** 获取团队 ID */
  getTeamId(): string {
    return this.teamId;
  }

  // ── 成员管理 ──

  /**
   * 加入团队（无条件接受——trust 不是准入控制，见铁律）。
   *
   * @param agentId 成员 agentId
   * @param role 角色
   * @param trust trust 权重（0.0-1.0，仅排序用）
   */
  join(agentId: string, role: 'leader' | 'member', trust: number): void {
    const member: MemberState = {
      agentId,
      role,
      trust,
      status: 'idle',
      lastHeartbeat: new Date().toISOString(),
    };
    this.doc = addMember(this.doc, member);
    this.persistAndSync();
  }

  /**
   * 成员退出团队。
   * @param agentId 成员 agentId
   */
  leave(agentId: string): void {
    this.doc = updateMemberStatus(this.doc, agentId, {
      status: 'offline',
      currentTask: undefined,
    });
    this.persistAndSync();
  }

  /**
   * 更新成员心跳 + 状态。
   */
  heartbeat(agentId: string, status: MemberState['status'], currentTask?: string): void {
    this.doc = updateMemberStatus(this.doc, agentId, {
      status,
      currentTask,
      lastHeartbeat: new Date().toISOString(),
    });
    this.persistAndSync();
  }

  // ── 自动入队（主 agent 编排 · 协议设计 §6.2）──

  /**
   * 自动入队 sub-agent——workflow 批量生成的 sub-agent 自动加入团队。
   *
   * 挂点：workflow-parser.ts 的 deriveAgentFromRequirement 调用后（协议设计 §6.2）。
   * 入队逻辑并入 team-manager——编排是团队生命周期的一部分。
   *
   * @param input sub-agent 定义
   */
  enqueueSubAgent(input: EnqueueSubAgentInput): void {
    this.join(
      input.agentId,
      input.role ?? 'member',
      input.trust ?? 0.5, // 自动生成的不预设高信任
    );
  }

  // ── 主 agent 编排（四合一角色 · 协议设计 §6.1）──

  /**
   * 分发任务——主 agent（Leader）把任务派发给 sub-agent。
   *
   * 编排职责「分发」落地机制：Leader 广播 intent.execute.<task> →
   * 更新 sub-agent 状态为 busy → 写入 team-state.tasks[]。
   *
   * @param taskId 任务 ID
   * @param assignee 被派发的 sub-agent agentId
   * @param description 任务描述
   * @returns 广播的意图事件
   */
  dispatchTask(taskId: string, assignee: string, description: string): IntentEvent {
    // 写入任务看板
    const task: TaskState = {
      taskId,
      description,
      assignee,
      status: 'running',
      updatedAt: new Date().toISOString(),
    };
    this.doc = addTask(this.doc, task);

    // 更新 sub-agent 状态为 busy
    this.doc = updateMemberStatus(this.doc, assignee, {
      status: 'busy',
      currentTask: taskId,
    });

    this.persistAndSync();

    // 广播执行意图（sub-agent 经意图总线收到触发）
    return this.broadcastIntent(
      this.findLeader() ?? 'leader',
      `intent.execute.${taskId}`,
      taskId,
      { description, assignee },
    );
  }

  /**
   * 收集结果——sub-agent 完成任务后回传结果。
   *
   * 编排职责「监控」落地机制：更新 task 状态为 done/failed →
   * sub-agent 状态恢复 idle → 结果摘要写入 team-state.tasks[]。
   *
   * @param taskId 任务 ID
   * @param result 结果摘要
   * @param success 是否成功（false → status='failed'）
   */
  collectResult(taskId: string, result: string, success: boolean): void {
    this.doc = change(this.doc, (d) => {
      const task = d.tasks[taskId];
      if (task) {
        task.status = success ? 'done' : 'failed';
        task.result = result;
        task.updatedAt = new Date().toISOString();
      }
    });

    // 找到该任务的 assignee，恢复 idle
    const task = this.doc.tasks[taskId];
    if (task) {
      this.doc = updateMemberStatus(this.doc, task.assignee, {
        status: 'idle',
        currentTask: undefined,
      });
    }

    this.persistAndSync();
  }

  /**
   * 获取团队级审计轨迹——主 agent 按 teamId 过滤 decision-log。
   *
   * 编排职责「审计」落地机制：Leader 读 decision-log（按 teamId tag 过滤）。
   * 实际 decision-log 查询由 audit 包提供（queryByKind 等），此处仅返回
   * 团队维度的任务状态摘要（供 Leader 做编排决策）。
   *
   * @returns 团队任务看板摘要（各任务状态）
   */
  getTeamDashboard(): { tasks: TaskState[]; members: MemberState[] } {
    const state = this.doc;
    return {
      tasks: Object.values(state.tasks).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
      members: Object.values(state.members),
    };
  }

  /**
   * sub-agent 间通讯中转——sub-agent 不直连，经主 agent 意图总线中转。
   *
   * 编排职责「通讯」落地机制：sub-agent A 要通知 sub-agent B 时，
   * 经此方法广播意图，B 通过订阅匹配接收（不直连 A）。
   *
   * @param fromAgent 发送方 sub-agent
   * @param toPattern 接收方的订阅 pattern（glob）
   * @param message 消息内容
   * @param target 目标实体
   */
  relayMessage(
    fromAgent: string,
    toPattern: string,
    message: string,
    target: string,
  ): IntentEvent {
    return this.broadcastIntent(fromAgent, toPattern, target, { message });
  }

  /** 查找团队 leader 的 agentId */
  private findLeader(): string | undefined {
    const members = Object.values(this.doc.members);
    const leader = members.find((m) => m.role === 'leader');
    return leader?.agentId;
  }

  // ── 意图广播 ──

  /**
   * 广播意图事件。
   *
   * @param source 发送者 agentId
   * @param intent 意图类型（glob 可匹配）
   * @param target 意图目标
   * @param payload 载荷
   */
  broadcastIntent(
    source: string,
    intent: string,
    target: string,
    payload?: unknown,
  ): IntentEvent {
    const event: IntentEvent = {
      id: randomUUID(),
      source,
      intent,
      target,
      ts: new Date().toISOString(),
      teamId: this.teamId,
      ...(payload !== undefined ? { payload } : {}),
    };
    this.intentBus.broadcast(event);
    return event;
  }

  // ── 持久化 ──

  /**
   * 持久化 CRDT 文档到磁盘（atomic）。
   * 会话重启时 loadOrInit 恢复——CRDT 保证合并后状态不丢。
   */
  persist(): void {
    const binary = saveTeamState(this.doc);
    const dir = dirname(this.stateFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.stateFilePath, Buffer.from(binary));
  }

  /**
   * 关闭团队——持久化 + 关闭意图总线。
   */
  close(): void {
    this.persist();
    this.intentBus.close();
  }

  // ── 内部方法 ──

  /** 持久化 + 同步到远端 */
  private persistAndSync(): void {
    this.persist();
    // 异步同步——不阻塞本地操作
    const binary = saveTeamState(this.doc);
    void this.syncChannel.syncTeamState(binary).catch((err) => {
      console.error(`[team-manager] team-state 同步失败: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** 从磁盘恢复或初始化 CRDT 文档 */
  private loadOrInit(teamYaml: TeamYaml): Doc<TeamStateDoc> {
    if (existsSync(this.stateFilePath)) {
      try {
        const binary = new Uint8Array(readFileSync(this.stateFilePath));
        const loaded = loadTeamState(binary);
        // CRDT 文档已持久化——直接返回（持久化时已含全部状态）。
        // 不与 fresh merge（两个独立 init 的文档无共同祖先，merge 可能丢失数据）。
        return loaded;
      } catch (err) {
        console.warn(`[team-manager] 持久化 team-state 恢复失败，重新初始化: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // 新建——写入 team.yml 声明的成员
    let doc = initTeamState(teamYaml.team_id, teamYaml.name);
    for (const m of teamYaml.members) {
      doc = addMember(doc, {
        agentId: m.agent_id,
        role: m.role,
        trust: m.trust,
        status: 'offline', // 初始为 offline，join 后变 idle
        lastHeartbeat: new Date().toISOString(),
      });
    }
    return doc;
  }
}

// ────────────────────────────────────────────────────────────
// 工厂函数
// ────────────────────────────────────────────────────────────

/**
 * 从 team.yml 文本创建 TeamManager。
 *
 * @param yamlText team.yml 文本
 * @param options 构造选项
 * @returns TeamManager 实例
 * @throws TeamYamlError team.yml 格式非法
 */
export function createTeam(yamlText: string, options?: TeamManagerOptions): TeamManager {
  const teamYaml = parseTeamYaml(yamlText);
  return new TeamManager(teamYaml, options);
}

/**
 * 获取团队状态文件路径。
 * @param teamId 团队 ID
 * @param dataDir 数据目录
 */
export function getTeamStatePath(teamId: string, dataDir?: string): string {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  return join(dir, 'teams', teamId, 'team-state.automerge');
}
