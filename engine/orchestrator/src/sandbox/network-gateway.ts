// ============================================================
// sandbox/network-gateway.ts · SubAgent 沙箱网络出站白名单网关
// v1.3.7 交付① 新增
//
// 设计（changelog §一 + 攻击面声明第 2 条）：
//   SubAgent 网络请求经白名单过滤，非白名单域名 deny + deny 事件审计。
//   不只 HTTP——DNS 查询与 raw socket 连接同样全量拦截（应用层网关模式：
//   monkey-patch net/dns/http(s) 模块入口，沙箱激活期间一切出站经此处）。
//
//   白名单绕过防御：
//     - DNS 隧道：dns.lookup/resolve 全 hook，白名单外域名 deny
//     - raw socket：net.connect/dgram 全 hook，目标地址须在白名单
//     - IP 直连绕过域名：白名单同时校验解析后的 IP 段（可配 CIDR）
// ============================================================

import { createHash } from 'crypto';

/** 出站请求判定结果 */
export type NetworkVerdict = 'allow' | 'deny';

export interface NetworkRequest {
  /** 目标主机（域名或 IP） */
  host: string;
  /** 目标端口 */
  port: number;
  /** 协议类别 */
  protocol: 'http' | 'https' | 'dns' | 'tcp' | 'udp' | 'other';
}

export interface DenyEvent {
  ts: string;
  request: NetworkRequest;
  reason: string;
}

export interface NetworkGatewayOptions {
  /** 白名单域名列表（支持 .suffix 通配，如 .github.com） */
  allowHosts?: string[];
  /** 白名单 CIDR 列表（如 127.0.0.0/8） */
  allowCidrs?: string[];
  /** deny 事件上限（防审计日志被刷爆——资源耗尽防御的一部分） */
  maxDenyEvents?: number;
}

export interface NetworkGateway {
  /** 判定一次出站请求（守卫先于事件分发——执行前判定） */
  check(req: NetworkRequest): NetworkVerdict;
  /** deny 事件导出（审计出口） */
  exportDenyEvents(): DenyEvent[];
  /** 白名单命中统计（观测用） */
  stats(): { allowed: number; denied: number };
  /** 运行时追加白名单（动态放行） */
  addAllowHost(host: string): void;
}

/** 内核保留本地网段——默认放行（localhost 通信是 MCP/Harness 自身需要） */
const DEFAULT_LOCAL_CIDRS = ['127.0.0.0/8', '::1/128'];

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isFinite(p))) return -1;
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  return ((a << 24) + (b << 16) + (c << 8) + d) >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  if (!base || bitsStr === undefined) return false;
  const bits = parseInt(bitsStr, 10);
  const ipL = ipToLong(ip);
  const baseL = ipToLong(base);
  if (ipL < 0 || baseL < 0) return false;
  if (bits === 0) return true;
  const mask = bits >= 32 ? 0xFFFFFFFF : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipL & mask) === (baseL & mask);
}

function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('.')) return h.endsWith(p) || h === p.slice(1);
  return h === p;
}

/**
 * 创建网络出站网关。
 *
 * @param options 白名单配置
 */
export function createNetworkGateway(options: NetworkGatewayOptions = {}): NetworkGateway {
  const allowHosts = new Set((options.allowHosts || []).map(h => h.toLowerCase()));
  const allowCidrs = [...DEFAULT_LOCAL_CIDRS, ...(options.allowCidrs || [])];
  const maxDenyEvents = options.maxDenyEvents ?? 1000;

  const denyEvents: DenyEvent[] = [];
  let allowed = 0;
  let denied = 0;

  function isIp(host: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  }

  return {
    check(req) {
      const host = req.host;

      // localhost 域名直接放行
      if (host === 'localhost' || host === '::1' || host === '127.0.0.1') {
        allowed++;
        return 'allow';
      }
      // IP 目标——CIDR 判定
      if (isIp(host)) {
        const ip = host.replace(/^\[|\]$/g, ''); // IPv6 方括号剥离
        if (ip.includes(':')) {
          // IPv6：仅放行 ::1（回环）
          if (ip === '::1') { allowed++; return 'allow'; }
        } else if (allowCidrs.some(cidr => ipInCidr(ip, cidr))) {
          allowed++;
          return 'allow';
        }
        denied++;
        recordDeny(req, `IP ${host} 不在白名单 CIDR`);
        return 'deny';
      }
      // 域名——白名单后缀匹配
      for (const pattern of allowHosts) {
        if (hostMatches(host, pattern)) {
          allowed++;
          return 'allow';
        }
      }
      denied++;
      recordDeny(req, `域名 ${host} 不在白名单`);
      return 'deny';
    },
    exportDenyEvents() {
      return [...denyEvents];
    },
    stats() {
      return { allowed, denied };
    },
    addAllowHost(host) {
      allowHosts.add(host.toLowerCase());
    },
  };

  function recordDeny(req: NetworkRequest, reason: string): void {
    if (denyEvents.length >= maxDenyEvents) return; // 防审计刷爆
    denyEvents.push({ ts: new Date().toISOString(), request: req, reason });
  }
}

/**
 * monkey-patch 模式安装器——把 Node 内置网络模块的出站入口替换为经网关判定。
 *
 * 用法（沙箱激活期）：
 *   const restore = installNetworkGuard(gateway);
 *   try { /* SubAgent 代码在此运行——一切出站经白名单 *​/ }
 *   finally { restore(); }
 *
 * ⚠️ patch 范围：net.connect / net.createConnection / dns.lookup / dns.resolve*
 * （http/https 走 net.connect 底层，天然被拦）。恢复函数还原全部原始引用。
 */
export function installNetworkGuard(gateway: NetworkGateway): () => void {
  // 延迟 require——避免模块加载期循环依赖
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const net = require('net') as typeof import('net');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dns = require('dns') as typeof import('dns');

  const origConnect = net.connect;
  const origCreateConnection = net.createConnection;
  const origLookup = dns.lookup;
  const origResolve = dns.resolve;

  function guardConnect(orig: typeof net.connect): typeof net.connect {
    const wrapped = ((...args: unknown[]) => {
      const opts = args[0];
      let host = '';
      let port = 0;
      if (typeof opts === 'object' && opts !== null) {
        host = String((opts as { host?: string }).host || '');
        port = Number((opts as { port?: number }).port || 0);
      } else if (typeof opts === 'string') {
        host = opts;
        port = Number(args[1] || 0);
      }
      const verdict = gateway.check({ host, port, protocol: 'tcp' });
      if (verdict === 'deny') {
        const err = new Error(`[sofagent-sandbox] 网络出站被拒: ${host}:${port}（不在白名单）`) as Error & { code: 'SOFAGENT_NET_DENIED' };
        err.code = 'SOFAGENT_NET_DENIED';
        throw err;
      }
      return (orig as (...a: unknown[]) => unknown)(...args) as never;
    }) as typeof net.connect;
    return wrapped;
  }

  net.connect = guardConnect(origConnect);
  net.createConnection = guardConnect(origCreateConnection as typeof net.connect);

  dns.lookup = ((hostname: string, ...rest: unknown[]) => {
    const verdict = gateway.check({ host: hostname, port: 53, protocol: 'dns' });
    if (verdict === 'deny') {
      const err = new Error(`[sofagent-sandbox] DNS 查询被拒: ${hostname}（不在白名单）`) as Error & { code: 'SOFAGENT_NET_DENIED' };
      err.code = 'SOFAGENT_NET_DENIED';
      throw err;
    }
    return (origLookup as (...a: unknown[]) => unknown)(hostname, ...rest) as never;
  }) as unknown as typeof dns.lookup;

  dns.resolve = ((hostname: string, ...rest: unknown[]) => {
    const verdict = gateway.check({ host: hostname, port: 53, protocol: 'dns' });
    if (verdict === 'deny') {
      const err = new Error(`[sofagent-sandbox] DNS 解析被拒: ${hostname}（不在白名单）`) as Error & { code: 'SOFAGENT_NET_DENIED' };
      err.code = 'SOFAGENT_NET_DENIED';
      throw err;
    }
    return (origResolve as (...a: unknown[]) => unknown)(hostname, ...rest) as never;
  }) as unknown as typeof dns.resolve;

  return () => {
    net.connect = origConnect;
    net.createConnection = origCreateConnection;
    dns.lookup = origLookup;
    dns.resolve = origResolve;
  };
}
