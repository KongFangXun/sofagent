# L2 团队协作协议 · 架构设计文档

> **版本**：v1.3.3 · **状态**：设计稿（review 通过后进入实现）
> **前置**：v1.3.1（身份码 + 跨设备审计聚合）· v1.3.7（Onboard Agent 循环引擎）· v1.1.8（安全联邦加密通道）
> **适用范围**：本文定义 sofagent 多 Agent 团队化的底层协议。所有 v1.3.3 交付物（L2 协作、主 agent 编排、入口路由、Refine Agent、进化闭环）的协作行为均遵循本文约束。

---

## 0. 设计目标与边界

### 0.1 本协议解决什么问题

v1.3.2 交付了单 Agent 全闭环（Onboard L1-L5）+ workflow 批量生成（一次建 N 个 sub-agent）。但 N 个 sub-agent 建出来后**各自为战**——没有共享状态、没有意图广播、冲突没人裁决、一个 Agent 的经验无法回流给团队。本协议补上团队化的五件事：共享态 / 意图广播 / 触发反应 / 冲突消解 / 反馈放大。

### 0.2 本协议不做什么（边界钉死）

| 边界 | 说明 | 归属版本 |
|------|------|---------|
| **不碰权限体系** | 成员能/不能做什么（准入控制、操作授权）归 v1.3.7 场景权限体系。本协议的 trust **只是排序权重，不是权限令牌** | v1.3.7 |
| **不碰 L3 组织能力市场** | Agent 的发现/交易/上架归 v1.3.4 | v1.3.4 |
| **不重写联邦加密链路** | 复用 v1.1.8 AES-256-GCM + FederationChannel 抽象 | v1.1.8 |
| **不重写 CRDT 同步** | 复用 automerge@1.0.1-preview.7（严禁升 2.x） | v1.1.8 |
| **不重写循环引擎** | Refine 复用 loop-agent 的 L1/L3/L4/L5，只换 L2 判据 | v1.3.2 |
| **进化闭环只动经验层** | L1 SKILL.md / 审计规则 / 回溯机制永远不可碰 | 铁律 |

### 0.3 trust 语义边界（提前钉死）

> **铁律：trust = 冲突消解排序权重，不是权限判定 / 准入控制。**

`team.yml` 中每个成员有一个 `trust: 0.0–1.0` 浮点值。它的**唯一用途**是：当多个 Agent 同时修改同一目标（同一文件 / 同一共享态 key）产生冲突时，**trust 值高者胜出**。它**不决定**：

- ❌ 成员能不能加入团队（那是 team-manager 的建队逻辑，无条件接受 team.yml 声明的成员）
- ❌ 成员能不能调用某个工具（那是 v1.3.7 权限体系的事）
- ❌ 成员能不能修改某个文件（同上）
- ❌ 成员的输出是否可信（那是审计引擎 A1-A24 的 git diff 硬证据判定）

实现者最容易犯的错：把 trust 做成 `if (member.trust > 0.5) allow()` 的准入控制。**这是越界实现，必须在 code review 时拦截**。trust 只出现在 `resolveConflict()` 函数的排序比较里，不出现在任何 `if` 条件分支里。

---

## 1. 共享态 Schema（team-state CRDT 结构）

### 1.1 设计选择

共享态让团队成员看到统一的工作状态视图。采用 **automerge CRDT**（无冲突复制数据类型），与 v1.1.8 联邦知识合并（`core/src/federation.ts` 的 `mergeFederationResults`）使用同一套 `Automerge.init / change / clone / merge` API。

**为什么用 CRDT 而不是锁**：
- 团队协作场景冲突概率低（各 Agent 通常改不同文件），乐观并发（CRDT 自动合并）比悲观锁性能好
- automerge 已在 core 包锁定（1.0.1-preview.7），复用零新依赖
- CRDT 天然支持离线编辑 + 重连合并（团队会话中断恢复不丢数据）

**并发写策略**：乐观并发——各 Agent 直接写本地 CRDT 副本，经联邦通道同步后自动合并。文件级写冲突（两个 Agent 改同一文件）走 §3 冲突消解。共享态 key 级冲突由 CRDT 自动 last-writer-wins（基于 Lamport 时钟）。

### 1.2 TeamState CRDT 文档结构

```typescript
import * as Automerge from 'automerge';

/** 团队共享态 CRDT 文档 */
interface TeamStateDoc {
  /** 团队元数据（建队时写入，不可变） */
  meta: {
    teamId: string;
    name: string;
    createdAt: string;  // ISO 8601
  };
  /** 成员表：agentId → 成员状态（实时更新） */
  members: Record<string, MemberState>;
  /** 任务看板：taskId → 任务状态 */
  tasks: Record<string, TaskState>;
  /** 共享文件锁：filePath → 持有者信息（防同文件并发写） */
  fileLocks: Record<string, FileLockEntry>;
  /** 反馈池：团队级学习条目（反馈放大写入） */
  feedback: FeedbackEntry[];
}

/** 单个成员的实时状态 */
interface MemberState {
  agentId: string;        // v1.3.1 Agent 身份码
  role: 'leader' | 'member';
  trust: number;          // 0.0–1.0（冲突消解排序权重，非权限）
  status: 'idle' | 'busy' | 'blocked' | 'offline';
  currentTask?: string;   // 当前正在执行的 taskId
  lastHeartbeat: string;  // ISO 8601（用于离线检测）
}

/** 任务状态 */
interface TaskState {
  taskId: string;
  description: string;
  assignee: string;       // agentId
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;        // 完成时的输出摘要
  updatedAt: string;
}

/** 文件锁（乐观并发——写前检查，冲突时走 §3 消解） */
interface FileLockEntry {
  filePath: string;
  holder: string;         // agentId
  acquiredAt: string;     // ISO 8601
}

/** 反馈条目（反馈放大机制写入） */
interface FeedbackEntry {
  id: string;
  agentId: string;        // 产生反馈的 Agent
  type: 'correction' | 'confirmation' | 'quality_rule';
  content: string;
  ts: string;
}
```

### 1.3 automerge 用法（对齐 core/federation.ts 模式）

```typescript
// 初始化团队共享态
let doc = Automerge.init<TeamStateDoc>();
doc = Automerge.change(doc, (d) => {
  d.meta = { teamId, name, createdAt: new Date().toISOString() };
  d.members = {};
  d.tasks = {};
  d.fileLocks = {};
  d.feedback = [];
});

// 成员加入（更新本地副本）
doc = Automerge.change(doc, (d) => {
  d.members[agentId] = { agentId, role, trust, status: 'idle', lastHeartbeat: now };
});

// 跨设备/跨 Agent 同步：序列化 → 联邦通道传输 → 对端反序列化 → merge
const binary = Automerge.save(doc);              // 序列化为 Uint8Array
const remoteDoc = Automerge.load(binary);         // 反序列化
doc = Automerge.merge(doc, remoteDoc);            // CRDT 自动合并
```

**与 `core/federation.ts` 的 `mergeFederationResults` 区别**：
- `mergeFederationResults` 合并的是**知识查询结果**（一次性合并快照，用完即弃）
- `TeamStateDoc` 是**持久化的团队状态**（持续存在、增量同步、跨会话恢复）

**持久化**：`TeamStateDoc` 经 `Automerge.save()` 序列化为二进制，写入 `data/teams/<team-id>/team-state.automerge`。会话重启时 `Automerge.load()` 恢复——CRDT 保证合并后状态不丢。

---

## 2. 意图总线事件模型（Intent Bus）

### 2.1 为什么独立文件

意图总线（`intent-bus.ts`）独立于协议核心（`protocol.ts`），因为事件总线的逻辑（订阅匹配、事件分发、最终一致性窗口）复杂度高，独立便于单测和演进。protocol.ts 调用 intent-bus 的 API，不内联事件逻辑。

### 2.2 Intent 事件格式

```typescript
/** 意图事件——Agent 广播「我要做什么」 */
interface IntentEvent {
  /** 事件 ID（UUID，幂等去重用） */
  id: string;
  /** 发送者 agentId（v1.3.1 身份码） */
  source: string;
  /** 意图类型（glob 可匹配：intent.create.report / intent.modify.* ） */
  intent: string;
  /** 意图目标（操作的文件/实体/key） */
  target: string;
  /** 意图载荷（自由结构——如要创建的报告内容摘要） */
  payload?: unknown;
  /** 发送时间戳（ISO 8601 UTC） */
  ts: string;
  /** 关联团队 ID */
  teamId: string;
}
```

**意图类型命名约定**：`intent.<动作>.<对象>`，支持 glob 通配符。
- `intent.create.report` — 创建报告
- `intent.modify.config` — 修改配置
- `intent.query.*` — 查询任意对象
- `intent.complete.*` — 完成任意任务

### 2.3 订阅匹配规则

```typescript
/** 订阅规则 */
interface Subscription {
  /** 订阅者 agentId */
  subscriber: string;
  /** 匹配的意图模式（glob：intent.create.* 匹配所有 create 类意图） */
  pattern: string;
  /** 触发反应的回调（收到匹配意图时调用） */
  onMatch: (event: IntentEvent) => void | Promise<void>;
}

/** glob 匹配（复用 minimatch 语义，零新依赖——Node 18+ 内置） */
function matchIntent(pattern: string, intent: string): boolean {
  // pattern: "intent.create.*"  intent: "intent.create.report" → true
  // pattern: "intent.*"         intent: "intent.modify.config" → true
  // pattern: "intent.create.report" intent: "intent.create.report" → 精确匹配
  const regex = globToRegex(pattern);
  return regex.test(intent);
}
```

team.yml 的 `broadcast_channels[].trigger_on` 声明的就是订阅 pattern：
```yaml
broadcast_channels:
  - name: 审批流
    subscribe: [agent-abc123]
    trigger_on: ["intent.create.*"]   # 订阅所有 create 类意图
```

### 2.4 最终一致性窗口

意图广播是异步的——A 广播后，B 不一定立即收到。设定收敛窗口：

> **默认 5 秒无新意图即收敛**（可配置，高频协作场景调短，低频调长）。

```typescript
class IntentBus {
  private windowMs: number;  // 默认 5000

  /** 广播意图：写入事件流 + 通知匹配的订阅者 */
  broadcast(event: IntentEvent): void {
    this.events.push(event);
    this.notifySubscribers(event);
    this.resetConvergenceTimer();
  }

  /** 收敛检测：windowMs 内无新事件 → 触发 onConverged 回调 */
  private resetConvergenceTimer(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.onConverged?.(this.events.slice(-this.batchSize));
    }, this.windowMs);
  }
}
```

---

## 3. 冲突消解算法

### 3.1 冲突触发条件

当满足以下任一条件时触发冲突消解：
1. **文件锁冲突**：Agent B 尝试写文件 X，但 team-state 中 X 的 fileLock 由 Agent A 持有且未过期
2. **共享态 key 冲突**：两个 Agent 在同一收敛窗口内广播了针对同一 target 的矛盾意图（如 A 要删文件、B 要改文件）
3. **审计拦截**：Agent 的修改被审计引擎判 FAIL，且存在其他 Agent 的竞争版本

### 3.2 裁决顺序（trust → 时间戳 → 显式优先级）

```
裁决优先级（从高到低）：
  1. trust 值高者胜（team.yml 声明的 0.0–1.0）
  2. trust 相同时，时间戳早者胜（先到先得——避免活锁）
  3. 时间戳相同时，显式优先级高者胜（leader > member）
  4. 以上都相同时，agentId 字典序小者胜（确定性兜底——避免随机）
```

### 3.3 算法实现

```typescript
interface ConflictParty {
  agentId: string;
  trust: number;          // 0.0–1.0
  ts: string;             // ISO 8601
  role: 'leader' | 'member';
  change: unknown;        // 该方的修改内容
}

function resolveConflict(parties: ConflictParty[]): ConflictParty {
  const rolePriority = { leader: 1, member: 0 };

  return parties.sort((a, b) => {
    // 1. trust 降序（高者胜）
    if (a.trust !== b.trust) return b.trust - a.trust;
    // 2. 时间戳升序（早者胜）
    const tsDiff = new Date(a.ts).getTime() - new Date(b.ts).getTime();
    if (tsDiff !== 0) return tsDiff;
    // 3. 角色优先级降序（leader 胜）
    const roleDiff = rolePriority[b.role] - rolePriority[a.role];
    if (roleDiff !== 0) return roleDiff;
    // 4. agentId 字典序升序（确定性兜底）
    return a.agentId.localeCompare(b.agentId);
  })[0];
}
```

**与 `core/federation.ts` 的 `pickWinner` 对齐**：联邦知识合并的 `pickWinner` 已用 `TRUST_ORDER` + `mtime` 排序。团队冲突消解的裁决维度更多（加了 role + agentId 兜底），但核心思路一致——trust 是第一排序键。两者不共享实现（语义不同：一个是知识新鲜度，一个是修改优先级），但遵循同一排序哲学。

### 3.4 冲突审计

每次冲突消解**必须记审计**（复用 decision-log，kind=`ORCHESTRATION`，moment=`ACT`），记录：
- 冲突方列表（agentId + trust + ts）
- 胜出方 + 裁决理由
- 被覆盖方的修改内容（供回溯）

---

## 4. 反馈放大的团队级聚合路径

### 4.1 核心链路

一次人工纠正（或 Agent 自主确认）→ 团队级 think.md / knowledge 写入：

```
单 Agent 纠正
  → 写入该 Agent 的 think.md（单 Agent 学习，v1.3.2 已有能力）
  → 判定为「团队可复用经验」？(quality_rule / domain_rule)
    → 是 → 经意图总线广播 intent.share.feedback
      → team-manager 收到 → 写入 team-state.feedback[]
      → 分发给团队其他成员
        → 各成员 think.md 追加（atomicAppendSync——复用 memory-contract 契约）
        → 若是质量规则 → 同步写入 Refine Agent 的 quality-rule-set（团队反馈来源）
    → 否 → 仅保留单 Agent think.md
```

### 4.2 写入路径约束

- **think.md 写入必走 atomicAppendSync**（`core/src/shared/atomic-write.ts`）——禁止裸 writeFileSync。这与 v1.3.2 的进化链路写保护约束一致
- **think.md 是 append-only Ledger**（`core/src/memory-contract.ts` 定义的不变量）——团队反馈放大只能追加，不能覆写
- **knowledge/ 是 Views（派生层）**——团队反馈若涉及知识结构化，写入 knowledge/，方向严格单向（think.md → knowledge，不反向）

### 4.3 质量规则回流

Refine Agent 的质量规则集有三来源（见交付 4）。其中「团队反馈放大」来源的链路：

```
Agent A 跑 Refine → 发现质量缺陷 → L4 修复 → 审计通过
  → Agent A 广播 intent.share.quality_rule { rule: "工具描述必须带 example" }
  → team-manager 聚合 → 写入 team-state.feedback[]
  → Agent B 下次跑 Refine → quality-rule-set 加载时合并团队反馈来源
    → Agent B 也受这条规则约束（不需自己踩坑）
```

---

## 5. 三包依赖方向

### 5.1 当前依赖拓扑（v1.3.2）

```
                        ┌─────────────┐
                        │   @core     │  (automerge, atomic-write, federation)
                        └──────┬──────┘
               ┌───────────────┼───────────────┐
               │               │               │
        ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
        │  @audit     │ │ @ontology   │ │  @rules     │
        └──────┬──────┘ └─────────────┘ └─────────────┘
               │
        ┌──────▼──────┐
        │@orchestrator│  (不依赖 daemon——daemon 在 devDeps)
        └──────┬──────┘
               │
        ┌──────▼──────┐     ┌─────────────┐
        │   @mcp      │◄───►│  @daemon    │  (daemon 是 mcp 的 optionalDep)
        └─────────────┘     └──────┬──────┘
                                 │ (daemon → orchestrator: 单向依赖)
```

**关键事实**：
- `orchestrator` 的 `package.json` 中 `@sofagent/daemon` 在 **devDependencies**（不是 dependencies）——orchestrator 运行时不依赖 daemon
- `daemon` 的 `package.json` 中 `@sofagent/orchestrator` 在 **dependencies**——daemon 单向依赖 orchestrator
- `mcp` 的 `package.json` 中 `@sofagent/daemon` 在 **optionalDependencies**——mcp 运行时可选加载 daemon（联邦查询）

### 5.2 v1.3.3 的依赖方向约束

| 包 | 角色 | 可依赖 | 禁止依赖 |
|----|------|--------|---------|
| **orchestrator** | 协议核心 | core / audit / rules / ontology | ❌ **禁止反向 import daemon** |
| **daemon** | 联邦通道 | orchestrator / core / audit | （下游包，无禁止） |
| **mcp** | 工具层 | orchestrator / audit / core / daemon(optional) | （下游包，无禁止） |

### 5.3 team-channel 与协议核心的衔接方式

**问题**：协议核心（orchestrator/team/）需要跨设备同步 team-state，但联邦通道（daemon/federation/）在 daemon 包——orchestrator 不能 import daemon。

**解决方案：接口抽象 + 依赖注入**（不选事件回调注入或 daemon 轮询，原因见下）。

```typescript
// ── orchestrator/team/team-state.ts ──
/** 团队同步通道抽象（orchestrator 定义接口，daemon 实现） */
export interface TeamSyncChannel {
  /** 广播 team-state 增量到团队其他成员的设备 */
  syncTeamState(binary: Uint8Array): Promise<void>;
  /** 接收远端 team-state 增量 */
  onRemoteUpdate(cb: (binary: Uint8Array) => void): void;
}

// orchestrator 内部使用：默认本地单机实现（无联邦）
class LocalTeamSyncChannel implements TeamSyncChannel {
  async syncTeamState(_: Uint8Array): Promise<void> { /* 本地模式：no-op */ }
  onRemoteUpdate(_: (binary: Uint8Array) => void): void { /* 无远端 */ }
}

// ── daemon/federation/team-channel.ts ──
// daemon 实现 TeamSyncChannel，复用 v1.1.8 加密链路
import type { TeamSyncChannel } from '@sofagent/orchestrator';
export class FederatedTeamSyncChannel implements TeamSyncChannel {
  // 经 FederationChannel（AES-256-GCM）传输 Automerge.save() 的二进制
}
```

**衔接路径**：
1. orchestrator 定义 `TeamSyncChannel` 接口（纯类型，零运行时依赖 daemon）
2. orchestrator 提供 `LocalTeamSyncChannel` 默认实现（单机模式，联邦功能降级为 no-op）
3. daemon 实现 `FederatedTeamSyncChannel`（复用 v1.1.8 `FederationChannel` + `encryptPayload`）
4. mcp 层（或 daemon 启动时）注入 Federated 实例到 orchestrator 的 TeamManager

**为什么不选另外两种方案**：

| 方案 | 否决原因 |
|------|---------|
| 事件回调注入 | orchestrator 需要「主动调」sync（写完即同步），回调注入是「被动等」daemon 来拉，语义不对 |
| daemon 轮询 team 状态 | 轮询有延迟（最终一致性窗口不可控）+ 浪费 CPU（团队大部分时间无变更） |

**依赖注入**是最干净的——orchestrator 不知道同步细节，daemon 不知道协议逻辑，mcp 做胶水。这也是 v1.1.8 `FederationChannel` 已有的模式（channel 经参数注入，不硬编码 OpenClaw SDK import）。

---

## 6. 主 Agent 编排衔接

### 6.1 四合一角色落地

主 Agent（Leader）通过 L2 协议机制编排 N 个 sub-agent：

| 职责 | 落地机制 | 调用链 |
|------|---------|--------|
| 分发 | 意图广播 + 触发反应 | Leader 广播 `intent.execute.<task>` → 匹配的 sub-agent 触发 |
| 监控 | 团队级审计轨迹 | Leader 读 decision-log（按 teamId tag 过滤） |
| 审计 | 审计引擎 git diff | sub-agent 产出后走 A1-A24（已有能力） |
| 通讯 | 意图广播 + 共享态中转 | sub-agent 间不直连，经 Leader 的 intent-bus 中转 |

### 6.2 自动入队挂点

v1.3.2 workflow 批量生成的 sub-agent 需要自动加入团队。挂点在 `workflow-parser.ts:156` 的 `deriveAgentFromRequirement` 调用后：

```
parseWorkflowToSubAgents()
  → toSubAgentConfigs()
    → resolveAgent()
      → deriveAgentFromRequirement(node.task)   // L156: 推导 sub-agent
      → [新增] teamManager.enqueueSubAgent(definition)  // 自动入队
```

入队逻辑并入 `team-manager.ts`（不独立 lead-agent.ts——待明确 #3 的倾向），因为编排是团队生命周期的一部分。

---

## 7. Refine Agent 与协议的衔接

### 7.1 复用 loop-agent 引擎

Refine Agent 复用 v1.3.2 loop-agent 的 L1/L3/L4/L5，只替换 L2 判据：

| loop-agent 层 | Refine 复用方式 |
|--------------|----------------|
| `driver.ts`（L1 循环驱动） | 复用骨架，注入 `l2Judge = qualityJudge` |
| `judge.ts`（L1 crash/error/超时） | 直接复用（import） |
| `ontology-comparator.ts`（L2 语义对比） | **替换为 `quality-judge.ts`**（接口对齐 DiffReport） |
| `error-localizer.ts`（L3 LLM 定位） | 直接复用（import） |
| `fix-applier.ts`（L4 修复 + 审计） | 直接复用（import） |
| `diff-report.ts`（DiffReport interface） | 直接复用（import） |

### 7.2 自动触发挂点

Onboard Agent L5 收敛 PASS 后自动触发 Refine。挂点在 `loop-agent/driver.ts:383-386`：

```typescript
if (consecutivePassCount >= l5Config.convergeThreshold) {
  convergenceState = 'converged';
  // [新增] Onboard 收敛 → 自动触发 Refine
  if (options.onConverged) {
    await options.onConverged({ taskId, agentId, rounds });
  }
  break;
}
```

`onConverged` 回调由调用方注入（Refine 驱动器注册），driver.ts 本身不 import refine-agent（保持单向依赖）。

### 7.3 质量规则集三来源

```
quality-rule-set 加载顺序：
  1. 内置模板（硬编码——工具描述必须带 example / 输出不超 500 字 / few-shot ≥ 2 条）
  2. 客户 FDE 回写（delivery-report.md → 规则化解析）
  3. 团队反馈（team-state.feedback[] 中 type=quality_rule 的条目——经 §4 反馈放大链路写入）
```

---

## 8. 进化闭环的约束

### 8.1 优化范围收窄（方案 D 灵魂）

进化闭环（optimization-loop）的优化器**只能修改经验层**：

| 层 | 允许改 | 禁止改 |
|----|:------:|:------:|
| L1 硬约束（SKILL.md） | ❌ | **永远不可碰——审计铁律** |
| L2 决策约束（think.md） | ✅ | |
| L4 经验层（knowledge/） | ✅ | |
| 审计规则（A1-A24） | ❌ | **永远不可碰** |
| 回溯机制（git snapshot） | ❌ | **永远不可碰** |

**哲学一致性**：如果优化器能改约束层，审计就失去意义（优化器可以把自己的审计规则改松来通过"验收"）。这条不是保守，是底线。

### 8.2 Benchmark 接入

进化闭环的 evaluation 步骤复用 v1.3.1 Benchmark 三件套：

```
freezeBenchmark(def)           // benchmark-designer.ts:172 冻结基线
  → Candidate 应用后 evaluateCase()  // case-evaluator.ts 重跑评分
    → appendEvaluationRecord(input)  // evaluation-log.ts:133 HMAC 链落盘
      → strictly > Reference ? accept : git snapshot 回滚
```

### 8.3 evidence 留痕

每次进化动作经 `emitDecision` 写 decision-log，带 `evidence: string[]`（触发证据链）。DecisionKind 扩展 `EVOLUTION`（进化动作）+ `TEAM`（团队协作动作）。

---

## 9. 安全考量

| 攻击面 | 防护措施 |
|--------|---------|
| 意图事件注入 | IntentEvent 的 payload 经 sanitize（复用 `REDACTION_PATTERNS`，与 A9 同类） |
| trust 值篡改 | team.yml 明文存储——建议 chmod 444 或 HMAC 签名（对齐 config.yml 加固模式） |
| 共享态明文 | team-state.automerge 是明文二进制——叠加「已知风险·明文存储」段（与 knowledge 同级风险） |
| 跨设备团队通道 | 复用 v1.1.8 AES-256-GCM 加密链路——「数据不出本机」精确化为「缺省本地 + 可选联邦」 |

---

## 10. 待明确事项（实现时再定）

| # | 问题 | 当前倾向 |
|---|------|---------|
| 1 | 共享态并发写——乐观锁（CAS）还是悲观锁？ | **乐观锁**（CRDT 自动合并，冲突时 trust 高者胜） |
| 2 | 意图广播收敛窗口——多久算收敛？ | **默认 5 秒无新意图**（可配置） |
| 3 | 主 agent 编排逻辑放哪？ | **并入 team-manager.ts**（编排是团队生命周期的一部分） |
| 4 | 团队级审计存哪？ | **复用 decision-log**（kind 加 `TEAM`/`EVOLUTION`，tags 标注团队维度） |

---

*本文档 review 通过后进入实现阶段。所有 v1.3.3 交付物的协作行为必须遵循本文约束。*
