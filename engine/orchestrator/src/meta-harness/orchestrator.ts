// ============================================================
// orchestrator.ts · meta-harness 统一编排层
// v1.4.2（二）：多个 SubAgent harness（各自带沙箱）在一个 meta-harness
// 下协同运行 + 跨会话协作（对齐 Omnigent「策略强制在基础设施层」）
//
// DSH RC.7/RC.8 启发的统一调度层形态（2026-08-20）：
// - 上层拆任务编排、底层按需把不同 Agent 拉进来干活
// - 子代理 Profile Bundle 按需安装
// - 多命名实例（同一 profile 装多个并行实例，如 audit-a / audit-b）
// - 子代理完成 reportDelivery 主动反馈并唤醒父任务（父任务不必轮询等待）
//
// 与既有模块的关系：
// - 单 harness 沙箱：v1.3.7 createSandboxSession（本层只管多实例编排，不重复造沙箱）
// - 策略强制：policy-layer（动作前拦截）
// - 审计聚合：audit-aggregator（跨 harness 轨迹一视图）
// ============================================================

import { randomUUID } from 'crypto';
import { PolicyLayer, type MetaAction } from './policy-layer';
import { AuditAggregator, type AggregateAuditEntry } from './audit-aggregator';

/** Profile Bundle——子代理能力包（DSH 形态：按需安装，装完才能接对应任务） */
export interface ProfileBundle {
  /** profile 名（sofagent-* 或 @scope/*，受白名单策略约束） */
  name: string;
  /** 版本 */
  version?: string;
  /** 该 profile 暴露的工具清单（登记用，实际工具由 harness 沙箱 gate 管控） */
  tools?: string[];
  /** 安装钩子（拉包/初始化；缺省视为纯登记） */
  install?: (harnessId: string) => void | Promise<void>;
}

/** meta 层的 harness 实例描述 */
export interface HarnessDescriptor {
  /** 实例 ID（多命名实例：同 profile 可装多个，如 audit-a / audit-b） */
  id: string;
  /** 显示名 */
  name?: string;
  /** 初始 Profile Bundle（注册时装） */
  profile?: ProfileBundle;
  /** 沙箱数据目录（透传给 createSandboxSession 的 dataDir——由调用方组装沙箱） */
  sandboxDataDir?: string;
  /** agent 身份码（v1.3.1，聚合归因用） */
  agentId?: string;
}

/** meta 层任务 */
export interface MetaTask {
  /** 任务 ID（缺省生成） */
  id?: string;
  /** 任务描述 */
  description: string;
  /** 指定 harness 实例（缺省轮转调度） */
  harnessId?: string;
  /** 任务载荷（类型由 harness 自定） */
  payload?: unknown;
}

/** 任务结果 */
export interface MetaTaskResult {
  taskId: string;
  harnessId: string;
  status: 'completed' | 'failed' | 'denied';
  /** 产出（成功）或错误信息（失败） */
  output?: unknown;
  error?: string;
  /** 完成时间戳 */
  completedAt: string;
}

/** 任务执行器——由调用方注入（真正干活的是 harness 沙箱里的 SubAgent） */
export type TaskExecutor = (task: MetaTask, harness: HarnessDescriptor) => Promise<unknown>;

/** reportDelivery 回调（子代理主动反馈——唤醒父任务的通道） */
export type DeliveryListener = (result: MetaTaskResult) => void;

/**
 * meta-harness 统一编排器。
 *
 * 生命周期：
 *   const meta = new MetaHarness();
 *   meta.register({ id: 'audit-a', profile: { name: 'sofagent-audit' } });
 *   const taskId = await meta.submitTask({ description: '...' }, executor);
 *   const result = await meta.waitForDelivery(taskId);  // 被 reportDelivery 唤醒，零轮询
 */
export class MetaHarness {
  private readonly harnesses = new Map<string, HarnessDescriptor>();
  private readonly policy = new PolicyLayer();
  private readonly audit = new AuditAggregator();
  private readonly pending = new Map<string, {
    resolve: (r: MetaTaskResult) => void;
    /** 交付 promise 本体（waitForDelivery 直接 await） */
    deliveryPromise: Promise<MetaTaskResult>;
    listeners: DeliveryListener[];
    submittedAt: string;
    harnessId: string;
  }>();
  private readonly results = new Map<string, MetaTaskResult>();
  /** 轮转调度游标 */
  private rrCursor = 0;

  /** 注册一个 harness 命名实例（含可选 Profile 按需安装） */
  async register(desc: HarnessDescriptor): Promise<DescriptorRegistration> {
    if (this.harnesses.has(desc.id)) {
      throw new Error(`harness 实例已存在: ${desc.id}（多命名实例请用不同 ID，如 audit-a / audit-b）`);
    }
    // 动作前拦截：profile 安装先过策略层（白名单）
    if (desc.profile) {
      const verdict = this.policy.beforeAction({
        harnessId: desc.id,
        type: 'profile_install',
        detail: desc.profile.name,
        agentId: desc.agentId,
      });
      if (!verdict.allowed) {
        this.audit.ingest(desc.id, 'interception', `profile 安装被拒: ${desc.profile.name}（${verdict.reason}）`, { agentId: desc.agentId });
        return { descriptor: desc, profileInstalled: false, deniedReason: verdict.reason };
      }
      if (desc.profile.install) await desc.profile.install(desc.id);
      this.policy.trackProfileInstall(desc.id, desc.profile.name);
    }
    this.harnesses.set(desc.id, desc);
    this.policy.trackHarness(desc.id);
    this.audit.ingest(desc.id, 'decision', `harness 实例注册${desc.profile ? `（profile=${desc.profile.name}）` : ''}`, { agentId: desc.agentId });
    return { descriptor: desc, profileInstalled: !!desc.profile };
  }

  /** 按需安装 Profile Bundle（运行中补装——DSH「按需把 Agent 拉进来」） */
  async installProfile(harnessId: string, bundle: ProfileBundle): Promise<boolean> {
    const harness = this.harnesses.get(harnessId);
    if (!harness) throw new Error(`harness 未注册: ${harnessId}`);
    const verdict = this.policy.beforeAction({
      harnessId,
      type: 'profile_install',
      detail: bundle.name,
      agentId: harness.agentId,
    });
    if (!verdict.allowed) {
      this.audit.ingest(harnessId, 'interception', `profile 安装被拒: ${bundle.name}（${verdict.reason}）`);
      return false;
    }
    if (bundle.install) await bundle.install(harnessId);
    this.policy.trackProfileInstall(harnessId, bundle.name);
    this.audit.ingest(harnessId, 'decision', `profile 按需安装: ${bundle.name}`);
    return true;
  }

  /**
   * 提交任务——经策略层动作前拦截后分派给 harness。
   * 返回 taskId；executor 由调用方注入（真正执行在 harness 沙箱内）。
   */
  async submitTask(task: MetaTask, executor: TaskExecutor): Promise<string> {
    const harnessId = task.harnessId ?? this.pickHarness();
    const harness = this.harnesses.get(harnessId);
    if (!harness) throw new Error(`harness 未注册: ${harnessId}`);

    // 动作前拦截：subagent_spawn 策略（并发上限等）
    const verdict = this.policy.beforeAction({
      harnessId,
      type: 'subagent_spawn',
      detail: task.description.slice(0, 80),
      agentId: harness.agentId,
    });
    if (!verdict.allowed) {
      const taskId = task.id ?? randomUUID();
      const denied: MetaTaskResult = {
        taskId, harnessId, status: 'denied',
        error: verdict.reason, completedAt: new Date().toISOString(),
      };
      this.results.set(taskId, denied);
      this.audit.ingest(harnessId, 'interception', `任务被策略层拒绝: ${verdict.reason}`);
      // 拒绝也要「唤醒」等待方——父任务拿到 denied 结果而非挂死
      const deniedPromise = Promise.resolve(denied);
      this.pending.set(taskId, {
        resolve: () => undefined,
        deliveryPromise: deniedPromise,
        listeners: [],
        submittedAt: new Date().toISOString(),
        harnessId,
      });
      this.flushDelivery(taskId, denied);
      return taskId;
    }

    const taskId = task.id ?? randomUUID();
    this.policy.trackTaskStart(harnessId);
    this.audit.ingest(harnessId, 'decision', `任务受理: ${task.description.slice(0, 80)}`, { agentId: harness.agentId });

    // pending 登记先行（executor 可能同步完成即调 reportDelivery）。
    // pending 持有交付 promise 本体——waitForDelivery 直接 await，
    // 🔴 不许 `new Promise(entry.resolve)`：那会把 resolve 函数当值立即解析
    let release!: (r: MetaTaskResult) => void;
    const deliveryPromise = new Promise<MetaTaskResult>((res) => { release = res; });
    this.pending.set(taskId, {
      resolve: release,
      deliveryPromise,
      listeners: [],
      submittedAt: new Date().toISOString(),
      harnessId,
    });

    // 异步执行——executor 内部应调用 meta.reportDelivery 汇报（或直接返回走隐式汇报）
    void (async () => {
      try {
        const output = await executor({ ...task, id: taskId }, harness);
        // executor 直接返回 = 隐式 reportDelivery（便捷路径）
        if (!this.results.has(taskId)) {
          this.reportDelivery(harnessId, taskId, { status: 'completed', output });
        }
      } catch (err) {
        if (!this.results.has(taskId)) {
          this.reportDelivery(harnessId, taskId, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return taskId;
  }

  /**
   * 子代理完成主动反馈——唤醒父任务（父任务不必轮询等待）。
   * DSH RC.7 形态：delivery 是推送不是拉取。
   */
  reportDelivery(harnessId: string, taskId: string, outcome: {
    status: 'completed' | 'failed';
    output?: unknown;
    error?: string;
  }): MetaTaskResult {
    const result: MetaTaskResult = {
      taskId,
      harnessId,
      status: outcome.status,
      ...(outcome.output !== undefined ? { output: outcome.output } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
      completedAt: new Date().toISOString(),
    };
    this.audit.ingest(harnessId, 'tool_call', `reportDelivery: task=${taskId} status=${outcome.status}`, { payload: { taskId, status: outcome.status } });
    this.flushDelivery(taskId, result);
    return result;
  }

  /** 父任务等待交付——被 reportDelivery 唤醒（零轮询）；超时返回 null */
  async waitForDelivery(taskId: string, timeoutMs?: number): Promise<MetaTaskResult | null> {
    const entry = this.pending.get(taskId);
    if (entry) {
      if (timeoutMs === undefined) return await entry.deliveryPromise;
      return await Promise.race([
        entry.deliveryPromise,
        new Promise<null>((res) => setTimeout(() => res(null), timeoutMs)),
      ]);
    }
    return this.results.get(taskId) ?? null;
  }

  /** 订阅交付事件（多消费者——Dashboard 波次渲染等） */
  onDelivery(taskId: string, listener: DeliveryListener): void {
    const entry = this.pending.get(taskId);
    if (!entry) return;
    entry.listeners.push(listener);
  }

  /** 注销 harness 实例（释放锁与计数） */
  unregister(harnessId: string): void {
    this.harnesses.delete(harnessId);
    this.policy.untrackHarness(harnessId);
  }

  /** 策略层直访（测试与扩展用） */
  getPolicyLayer(): PolicyLayer { return this.policy; }

  /** 审计聚合器直访（worklog 三消费同一数据源） */
  getAuditAggregator(): AuditAggregator { return this.audit; }

  /** 已注册实例列表（多命名实例视图） */
  listHarnesses(): HarnessDescriptor[] { return [...this.harnesses.values()]; }

  // ── 内部 ──

  /** 轮转调度（多 harness 均衡） */
  private pickHarness(): string {
    const ids = [...this.harnesses.keys()];
    if (ids.length === 0) throw new Error('meta-harness 无已注册实例——先 register()');
    const id = ids[this.rrCursor % ids.length]!;
    this.rrCursor++;
    return id;
  }

  /** 交付落地：写 results + resolve pending + 通知 listeners */
  private flushDelivery(taskId: string, result: MetaTaskResult): void {
    this.results.set(taskId, result);
    this.policy.trackTaskEnd(result.harnessId);
    const entry = this.pending.get(taskId);
    if (entry) {
      this.pending.delete(taskId);
      entry.resolve(result);
      for (const l of entry.listeners) {
        try { l(result); } catch { /* 监听器异常不影响交付 */ }
      }
    }
  }
}

/** register() 的返回 */
export interface DescriptorRegistration {
  descriptor: HarnessDescriptor;
  /** profile 是否安装成功（白名单拒绝时 false） */
  profileInstalled: boolean;
  /** 拒绝原因（profileInstalled=false 时有值） */
  deniedReason?: string;
}

export type { MetaAction, PolicyVerdict, MetaPolicy, MetaStateView } from './policy-layer';
export type { AggregateAuditEntry, AuditQuery, L2EventInput } from './audit-aggregator';
