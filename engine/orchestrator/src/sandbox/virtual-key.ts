// ============================================================
// sandbox/virtual-key.ts · SubAgent 虚拟 key 凭证边界
// v1.3.7 交付① 新增
//
// 设计（changelog §一 + 攻击面声明第 3 条）：
//   SubAgent 拿到的 API key 是虚拟 key——限速（token bucket）+ 限定 scope，
//   不接触真实 key。真实 key 只留在 host 侧（环境变量注入边界之外），
//   虚拟 key 经 host 边界注入（不进 SubAgent 可见 env），日志全程脱敏。
//
//   数据流边契约（v1.2.5 P6 拆入）：虚拟 key 的 scope 限定了它能访问的
//   数据域——数据流契约从隐式约定变显式约束。
// ============================================================

/** 虚拟 key scope（能调哪些类别的 API） */
export type KeyScope = 'llm-chat' | 'llm-embedding' | 'knowledge-read' | 'knowledge-write' | 'tool-invoke';

/** token bucket 限速状态 */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export interface VirtualKeyRecord {
  /** 虚拟 key（vk- 前缀，与真实 key 格式区分——泄漏时一眼可辨） */
  virtualKey: string;
  /** 绑定的 SubAgent 身份 */
  agentId: string;
  /** scope 列表 */
  scopes: KeyScope[];
  /** 限速配置（每秒令牌数） */
  ratePerSec: number;
  /** bucket 容量（允许短时突发——token bucket 而非固定 QPS） */
  burstCapacity: number;
  createdAt: string;
  /** 状态（吊销后立即失效） */
  status: 'active' | 'revoked';
}

export interface VirtualKeyOptions {
  /** 每秒令牌数默认值 */
  defaultRatePerSec?: number;
  /** 突发容量默认值 */
  defaultBurst?: number;
}

export interface UseKeyResult {
  ok: boolean;
  reason?: string;
  /** 剩余令牌（观测用） */
  remainingTokens?: number;
}

export interface VirtualKeyManager {
  /** 签发虚拟 key（真实 key 永不出现在返回值或日志） */
  issue(agentId: string, scopes: KeyScope[], overrides?: { ratePerSec?: number; burstCapacity?: number }): VirtualKeyRecord;
  /** 消费一次——限速 + scope 双校验（守卫先于请求分发） */
  use(virtualKey: string, scope: KeyScope): UseKeyResult;
  /** 吊销（SubAgent 结束/违规时） */
  revoke(virtualKey: string): void;
  /** 列出活跃 key（脱敏视图——key 只显示前 6 位） */
  listActive(): Array<Omit<VirtualKeyRecord, 'virtualKey'> & { virtualKeyMasked: string }>;
  /** 吊销全部活跃 key（沙箱 teardown 用——避免暴露真 key 给调用方） */
  revokeAll(): void;
  /** 脱敏工具——日志/错误消息中出现的 vk- 一律打码 */
  mask(text: string): string;
}

/**
 * 创建虚拟 key 管理器。
 *
 * @param options 默认限速参数
 */
export function createVirtualKeyManager(options: VirtualKeyOptions = {}): VirtualKeyManager {
  const defaultRate = options.defaultRatePerSec ?? 1;      // 默认 1 QPS
  const defaultBurst = options.defaultBurst ?? 5;           // 允许 5 连发突发

  const keys = new Map<string, VirtualKeyRecord>();
  const buckets = new Map<string, TokenBucket>();

  function refill(record: VirtualKeyRecord, bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    if (elapsed <= 0) return;
    bucket.tokens = Math.min(
      record.burstCapacity,
      bucket.tokens + elapsed * record.ratePerSec,
    );
    bucket.lastRefill = now;
  }

  function maskKey(key: string): string {
    return key.slice(0, 6) + '***';
  }

  return {
    issue(agentId, scopes, overrides) {
      // vk- 前缀 + 32 hex 随机——格式与常见真实 key（sk-/AKIA/ghp_）区分
      const virtualKey = 'vk-' + Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16)).join('');
      const record: VirtualKeyRecord = {
        virtualKey,
        agentId,
        scopes,
        ratePerSec: overrides?.ratePerSec ?? defaultRate,
        burstCapacity: overrides?.burstCapacity ?? defaultBurst,
        createdAt: new Date().toISOString(),
        status: 'active',
      };
      keys.set(virtualKey, record);
      buckets.set(virtualKey, { tokens: record.burstCapacity, lastRefill: Date.now() });
      return record;
    },

    use(virtualKey, scope) {
      const record = keys.get(virtualKey);
      if (!record) return { ok: false, reason: '虚拟 key 不存在' };
      if (record.status === 'revoked') return { ok: false, reason: '虚拟 key 已吊销' };

      // scope 校验（数据流边界）
      if (!record.scopes.includes(scope)) {
        return { ok: false, reason: `scope 越界：key 仅授权 ${record.scopes.join(',')}，请求 ${scope}` };
      }

      // token bucket 限速（允许突发）
      const bucket = buckets.get(virtualKey)!;
      refill(record, bucket);
      if (bucket.tokens < 1) {
        return { ok: false, reason: `限速：bucket 空（${record.ratePerSec}/s，容量 ${record.burstCapacity}）`, remainingTokens: 0 };
      }
      bucket.tokens -= 1;
      return { ok: true, remainingTokens: Math.floor(bucket.tokens) };
    },

    revoke(virtualKey) {
      const record = keys.get(virtualKey);
      if (record) record.status = 'revoked';
    },

    listActive() {
      return [...keys.values()]
        .filter(k => k.status === 'active')
        .map(({ virtualKey, ...rest }) => ({ ...rest, virtualKeyMasked: maskKey(virtualKey) }));
    },

    revokeAll() {
      for (const record of keys.values()) {
        record.status = 'revoked';
      }
    },

    mask(text) {
      // 任何 vk- 开头的 32 hex 串打码（日志脱敏——攻击面 3 防泄漏）
      return text.replace(/vk-[0-9a-f]{32}/g, m => maskKey(m));
    },
  };
}

/**
 * host 边界注入器——把虚拟 key 放进 SubAgent 的受控环境。
 *
 * 关键性质（攻击面 3）：真实 key 从不进入 SubAgent 可见 env——
 * 这里只注入 vk- 虚拟 key；真实 key 留在 host 进程内部，
 * 由 host 侧代理层在收到 vk- key 后映射回真实凭证发起调用。
 */
export function buildSandboxEnv(virtualKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    SOFAGENT_VIRTUAL_KEY: virtualKey,
    ...extra,
  };
}
