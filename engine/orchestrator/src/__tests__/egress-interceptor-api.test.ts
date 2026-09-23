// ============================================================
// egress-interceptor-api.test.ts · v1.5.2 章五 · 出站裁决拦截器通道测试
// ============================================================
//
// 覆盖面（验收 ③ + 防「空壳」）：
//   1. **外部假拦截器接入**：两个独立 name 的外部实现（egress proxy 孪生 /
//      OS 沙箱孪生）经通道注册并可裁决——证明接口可被外部实现消费
//   2. 全链路：策略（@sofagent/rules egress-policy）→ 外部拦截器裁决 → sink 留痕
//   3. 通道 fail-closed：无拦截器注册 → Deny(no-interceptor)（opt-in 语义）
//   4. 约束层：裁决必经 sink；sink 抛错 → audited=false 但不吞裁决
//   5. 注册表契约：重名拒绝 / 注销切换 / list
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { decideEgress, declareEgressHosts } from '@sofagent/rules';
import type { EgressDecision, EgressPolicy, EgressRequest } from '@sofagent/rules';
import {
  EgressChannel,
  EgressChannelError,
  type EgressAuditSink,
  type EgressInterceptContext,
  type EgressInterceptor,
} from '../egress-interceptor-api';

const CTX: EgressInterceptContext = { subject: 'wf-42', sessionId: 'sess-1', agentId: 'eng-ch5' };

/**
 * 外部假拦截器——「egress proxy 孪生」：内部复用 rules 策略契约的纯裁决函数。
 * 这代表一类外部实现形态（代理侧查策略表后裁决）。
 */
function makeProxyDouble(): EgressInterceptor {
  return {
    name: 'egress-proxy-double',
    decide(request: EgressRequest, policy: EgressPolicy | null): EgressDecision {
      return decideEgress(request, policy);
    },
  };
}

/**
 * 外部假拦截器——「OS 沙箱孪生」：自带最小边界匹配，**不**复用 rules 裁决函数。
 * 证明通道不要求实现方依赖引擎裁决逻辑（通道形态·不绑实现）。
 */
function makeSandboxDouble(): EgressInterceptor {
  return {
    name: 'os-sandbox-double',
    decide(request: EgressRequest, policy: EgressPolicy | null): EgressDecision {
      const host = (request.host || '').toLowerCase();
      const declared = (policy?.hosts ?? []).map((h) => h.host.toLowerCase());
      const hit = declared.find((d) => (d.startsWith('.') ? host === d.slice(1) || host.endsWith(d) : host === d));
      if (!hit) {
        return { verdict: 'Deny', reason: 'host-not-allowed', host, message: `沙箱拒绝 ${host}` };
      }
      return { verdict: 'Allow', reason: 'allowed', host, matchedRule: hit, message: `沙箱放行 ${host}` };
    },
  };
}

describe('外部拦截器接入（通道形态 · 不绑实现）', () => {
  it('两个不同形态的外部实现都能注册并各自产出裁决', () => {
    const channel = new EgressChannel();
    channel.register(makeProxyDouble());
    channel.register(makeSandboxDouble());
    expect(channel.list()).toEqual(['egress-proxy-double', 'os-sandbox-double']);
    expect(channel.primary()).toBe('egress-proxy-double');

    const policy = declareEgressHosts(['api.github.com']);
    const r = channel.handle({ host: 'api.github.com' }, policy, CTX);
    expect(r.interceptor).toBe('egress-proxy-double');
    expect(r.decision.verdict).toBe('Allow');
  });

  it('重名注册 → EgressChannelError（不静默覆盖）', () => {
    const channel = new EgressChannel();
    channel.register(makeProxyDouble());
    expect(() => channel.register(makeProxyDouble())).toThrow(EgressChannelError);
  });

  it('非法拦截器（缺 name / decide）→ EgressChannelError', () => {
    const channel = new EgressChannel();
    expect(() => channel.register({ name: '', decide: () => ({}) as EgressDecision })).toThrow(EgressChannelError);
    expect(() =>
      channel.register({ name: 'x', decide: undefined as unknown as EgressInterceptor['decide'] }),
    ).toThrow(EgressChannelError);
  });

  it('注销当前裁决器 → 下一个接管', () => {
    const channel = new EgressChannel({ interceptors: [makeProxyDouble(), makeSandboxDouble()] });
    expect(channel.unregister('egress-proxy-double')).toBe(true);
    expect(channel.unregister('nope')).toBe(false);
    expect(channel.primary()).toBe('os-sandbox-double');
    const r = channel.handle({ host: 'exfil.example.com' }, declareEgressHosts(['api.github.com']), CTX);
    expect(r.interceptor).toBe('os-sandbox-double');
    expect(r.decision.verdict).toBe('Deny');
  });
});

describe('全链路：策略 → 外部拦截器 → 审计留痕', () => {
  it('空白名单 = 全拒（策略 face → 拦截器 → 裁决 Deny 并留痕）', () => {
    const events: Array<{ request: EgressRequest; decision: EgressDecision; ctx: EgressInterceptContext }> = [];
    const sink: EgressAuditSink = (request, decision, ctx) => events.push({ request, decision, ctx });
    const channel = new EgressChannel({ interceptors: [makeProxyDouble()], sink });

    const r = channel.handle({ host: 'api.github.com' }, declareEgressHosts([]), CTX);
    expect(r.decision.verdict).toBe('Deny');
    expect(r.decision.reason).toBe('empty-policy');
    expect(r.audited).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]!.request.host).toBe('api.github.com');
    expect(events[0]!.decision.verdict).toBe('Deny');
    expect(events[0]!.ctx).toEqual(CTX);
  });

  it('声明后放行（策略 face → 拦截器 → 裁决 Allow + matchedRule 进留痕）', () => {
    const events: EgressDecision[] = [];
    const channel = new EgressChannel({
      interceptors: [makeProxyDouble()],
      sink: (_req, decision) => events.push(decision),
    });
    const policy = declareEgressHosts(['.corp.internal']);
    const r = channel.handle({ host: 'git.corp.internal', port: 443 }, policy, CTX);
    expect(r.decision.verdict).toBe('Allow');
    expect(r.decision.matchedRule).toBe('.corp.internal');
    expect(events[0]!.matchedRule).toBe('.corp.internal');
  });

  it('未在名单 = 拒（host-not-allowed 经通道留痕）', () => {
    const sink = vi.fn();
    const channel = new EgressChannel({ interceptors: [makeSandboxDouble()], sink });
    const r = channel.handle({ host: 'exfil.example.com' }, declareEgressHosts(['api.github.com']), CTX);
    expect(r.decision.verdict).toBe('Deny');
    expect(r.decision.reason).toBe('host-not-allowed');
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]![0]).toEqual({ host: 'exfil.example.com' });
  });
});

describe('通道约束层（fail-closed + 留痕不吞裁决）', () => {
  it('无拦截器注册 → Deny(no-interceptor)（opt-in：注册后方可裁决）', () => {
    const channel = new EgressChannel();
    const r = channel.handle({ host: 'api.github.com' }, declareEgressHosts(['api.github.com']), CTX);
    expect(r.interceptor).toBe('none');
    expect(r.decision.verdict).toBe('Deny');
    expect(r.decision.reason).toBe('no-interceptor');
    expect(r.audited).toBe(false); // 无 sink
  });

  it('无拦截器的 fail-closed 裁决同样必经 sink 留痕', () => {
    const sink = vi.fn();
    const channel = new EgressChannel({ sink });
    const r = channel.handle({ host: 'api.github.com' }, null, CTX);
    expect(r.decision.reason).toBe('no-interceptor');
    expect(r.audited).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('sink 抛错 → audited=false 但裁决照常返回（留痕失败不吞裁决）', () => {
    const channel = new EgressChannel({
      interceptors: [makeProxyDouble()],
      sink: () => {
        throw new Error('audit chain down');
      },
    });
    const r = channel.handle({ host: 'api.github.com' }, declareEgressHosts(['api.github.com']), CTX);
    expect(r.decision.verdict).toBe('Allow');
    expect(r.audited).toBe(false);
  });

  it('setAuditSink 可后置注入（通道与 sink 解耦）', () => {
    const channel = new EgressChannel({ interceptors: [makeProxyDouble()] });
    const sink = vi.fn();
    expect(channel.handle({ host: 'x.example.com' }, null, CTX).audited).toBe(false);
    channel.setAuditSink(sink);
    expect(channel.handle({ host: 'x.example.com' }, null, CTX).audited).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
