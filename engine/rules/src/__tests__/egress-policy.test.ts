// ============================================================
// egress-policy.test.ts · v1.5.2 章五 · 出站白名单策略测试
// ============================================================
//
// 覆盖面（对齐 G10 device-data-policy.test.ts 的判据结构）：
//   1. 白名单三态：空 = 全拒 / 声明后放行 / 未在名单 = 拒（验收 ①）
//   2. 通配边界语义（.x 放行本体+子域，不放行 evilx；精确 host 不放行子域；裸 * 非法）
//   3. 端口 / 协议收窄维度（fail-closed）
//   4. 裁决理由可追溯（matchedRule / reason 码——供审计挂链消费）
//   5. 声明文件往返（save → load）+ 损坏 fail-closed
//   6. URL 提取（复用 networkOutboundTargetRule 的 hostname 解析口径）
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  EGRESS_POLICY_FILE,
  EGRESS_POLICY_VERSION,
  normalizeEgressHost,
  hostMatchesEgressRule,
  declareEgressHosts,
  decideEgress,
  egressRequestFromUrl,
  egressPolicyPath,
  loadEgressPolicy,
  saveEgressPolicy,
} from '../egress-policy';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-egress-policy-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响断言 */
    }
  }
});

describe('白名单三态（默认空全拒 · opt-in）', () => {
  it('空声明 = 全拒（无策略 null）', () => {
    const d = decideEgress({ host: 'api.github.com' }, null);
    expect(d.verdict).toBe('Deny');
    expect(d.reason).toBe('empty-policy');
  });

  it('空声明 = 全拒（策略对象但 hosts 为空数组）', () => {
    const d = decideEgress({ host: 'api.github.com' }, declareEgressHosts([]));
    expect(d.verdict).toBe('Deny');
    expect(d.reason).toBe('empty-policy');
  });

  it('声明后放行（精确 host）', () => {
    const policy = declareEgressHosts(['api.github.com']);
    const d = decideEgress({ host: 'api.github.com' }, policy);
    expect(d.verdict).toBe('Allow');
    expect(d.reason).toBe('allowed');
    expect(d.matchedRule).toBe('api.github.com');
  });

  it('未在名单 = 拒（host-not-allowed，非 empty-policy）', () => {
    const policy = declareEgressHosts(['api.github.com']);
    const d = decideEgress({ host: 'evil.example.com' }, policy);
    expect(d.verdict).toBe('Deny');
    expect(d.reason).toBe('host-not-allowed');
    expect(d.host).toBe('evil.example.com');
  });

  it('host 大小写 / 尾点 / 端口 归一化后参与匹配', () => {
    const policy = declareEgressHosts(['API.GitHub.com']);
    expect(decideEgress({ host: 'api.github.com.' }, policy).verdict).toBe('Allow');
    expect(decideEgress({ host: 'API.GITHUB.COM:443' }, policy).verdict).toBe('Allow');
  });

  it('host 缺失 / 空串 = invalid-request（fail-closed，不静默放行）', () => {
    const policy = declareEgressHosts(['api.github.com']);
    expect(decideEgress({ host: '' }, policy).reason).toBe('invalid-request');
    expect(decideEgress({ host: '   ' }, policy).reason).toBe('invalid-request');
  });

  it('策略结构非法（hosts 非数组）= malformed-policy', () => {
    const bad = { version: 1, hosts: 'api.github.com' } as unknown as Parameters<typeof decideEgress>[1];
    const d = decideEgress({ host: 'api.github.com' }, bad);
    expect(d.verdict).toBe('Deny');
    expect(d.reason).toBe('malformed-policy');
  });
});

describe('通配边界语义（禁 `*` 全放行）', () => {
  it('.x 后缀通配：本体命中', () => {
    expect(hostMatchesEgressRule('github.com', '.github.com')).toBe(true);
  });

  it('.x 后缀通配：子域命中', () => {
    expect(hostMatchesEgressRule('api.github.com', '.github.com')).toBe(true);
    expect(hostMatchesEgressRule('a.b.github.com', '.github.com')).toBe(true);
  });

  it('.x 后缀通配：点边界防借壳——evilgithub.com 不命中', () => {
    expect(hostMatchesEgressRule('evilgithub.com', '.github.com')).toBe(false);
    expect(hostMatchesEgressRule('github.com.evil.example', '.github.com')).toBe(false);
  });

  it('精确 host 只放行本体，不放行子域', () => {
    expect(hostMatchesEgressRule('github.com', 'github.com')).toBe(true);
    expect(hostMatchesEgressRule('api.github.com', 'github.com')).toBe(false);
  });

  it('*.x 声明归一化为 .x（同一语义）', () => {
    const policy = declareEgressHosts(['*.corp.internal']);
    expect(policy.hosts[0]!.host).toBe('.corp.internal');
    expect(decideEgress({ host: 'git.corp.internal' }, policy).verdict).toBe('Allow');
    expect(decideEgress({ host: 'corp.internal' }, policy).verdict).toBe('Allow');
  });

  it('裸 `*` 被丢弃——不构成全放行', () => {
    const policy = declareEgressHosts(['*', 'api.github.com']);
    expect(policy.hosts).toHaveLength(1);
    expect(policy.hosts[0]!.host).toBe('api.github.com');
    expect(decideEgress({ host: 'anything.example.com' }, policy).verdict).toBe('Deny');
  });

  it('畸形前缀通配（*evil.com）被丢弃——不做前缀通配', () => {
    expect(hostMatchesEgressRule('notevil.com', '*evil.com')).toBe(false);
    const policy = declareEgressHosts(['*evil.com']);
    expect(policy.hosts).toHaveLength(0);
    expect(decideEgress({ host: 'notevil.com' }, policy).reason).toBe('empty-policy');
  });

  it('声明条目重复归一化后去重（保留首条）', () => {
    const policy = declareEgressHosts(['.github.com', '*.github.com']);
    expect(policy.hosts).toHaveLength(1);
  });
});

describe('端口 / 协议收窄维度（声明才校验，fail-closed）', () => {
  it('声明端口后：命中端口放行 / 越界端口拒', () => {
    const policy = declareEgressHosts([{ host: 'api.github.com', ports: [443] }]);
    expect(decideEgress({ host: 'api.github.com', port: 443 }, policy).verdict).toBe('Allow');
    const denied = decideEgress({ host: 'api.github.com', port: 8080 }, policy);
    expect(denied.verdict).toBe('Deny');
    expect(denied.reason).toBe('port-not-allowed');
  });

  it('声明端口但请求无 port → port-not-allowed（fail-closed）', () => {
    const policy = declareEgressHosts([{ host: 'api.github.com', ports: [443] }]);
    expect(decideEgress({ host: 'api.github.com' }, policy).reason).toBe('port-not-allowed');
  });

  it('声明协议后：命中协议放行 / 越界协议拒（大小写不敏感）', () => {
    const policy = declareEgressHosts([{ host: 'api.github.com', protocols: ['HTTPS'] }]);
    expect(decideEgress({ host: 'api.github.com', protocol: 'https' }, policy).verdict).toBe('Allow');
    const denied = decideEgress({ host: 'api.github.com', protocol: 'http' }, policy);
    expect(denied.verdict).toBe('Deny');
    expect(denied.reason).toBe('protocol-not-allowed');
  });

  it('未声明 ports/protocols = 不限制该维度', () => {
    const policy = declareEgressHosts(['api.github.com']);
    expect(decideEgress({ host: 'api.github.com', port: 1234, protocol: 'tcp' }, policy).verdict).toBe('Allow');
  });
});

describe('裁决理由可追溯（供审计挂链 / 判定底座消费）', () => {
  it('Allow 决策携带 matchedRule（依据哪条声明放行）', () => {
    const policy = declareEgressHosts(['.corp.internal']);
    const d = decideEgress({ host: 'git.corp.internal' }, policy);
    expect(d.verdict).toBe('Allow');
    expect(d.matchedRule).toBe('.corp.internal');
    expect(d.message).toContain('.corp.internal');
  });

  it('Deny 决策 reason 为稳定码 + 回显 host（可被消费方查表）', () => {
    const policy = declareEgressHosts(['api.github.com']);
    const d = decideEgress({ host: 'exfil.example.com' }, policy);
    expect(d.reason).toBe('host-not-allowed');
    expect(d.host).toBe('exfil.example.com');
    expect(typeof d.message).toBe('string');
    expect(d.message.length).toBeGreaterThan(0);
  });

  it('决策结构可 JSON 序列化且字段稳定（契约面）', () => {
    const policy = declareEgressHosts(['api.github.com']);
    const d = decideEgress({ host: 'api.github.com' }, policy);
    const roundTrip = JSON.parse(JSON.stringify(d)) as typeof d;
    expect(Object.keys(roundTrip).sort()).toEqual(['host', 'matchedRule', 'message', 'reason', 'verdict']);
  });
});

describe('声明文件往返（<dataDir>/config/egress-policy.json）', () => {
  it('save → load 往返保持语义', () => {
    const dir = mkDataDir();
    const policy = declareEgressHosts([{ host: '.corp.internal', ports: [443] }, 'api.github.com'], {
      subject: 'wf-42',
    });
    saveEgressPolicy(policy, dir);
    expect(fs.existsSync(egressPolicyPath(dir))).toBe(true);
    expect(egressPolicyPath(dir).endsWith(path.join('config', 'egress-policy.json'))).toBe(true);
    expect(EGRESS_POLICY_FILE).toBe('config/egress-policy.json');

    const loaded = loadEgressPolicy(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(EGRESS_POLICY_VERSION);
    expect(loaded!.subject).toBe('wf-42');
    expect(decideEgress({ host: 'git.corp.internal', port: 443 }, loaded).verdict).toBe('Allow');
    expect(decideEgress({ host: 'exfil.example.com' }, loaded).verdict).toBe('Deny');
  });

  it('文件不存在 → load 返回 null（默认空 = 全拒）', () => {
    const dir = mkDataDir();
    expect(loadEgressPolicy(dir)).toBeNull();
    expect(decideEgress({ host: 'api.github.com' }, loadEgressPolicy(dir)).reason).toBe('empty-policy');
  });

  it('结构非法（hosts 非数组）→ load 返回 null（fail-closed）', () => {
    const dir = mkDataDir();
    const p = egressPolicyPath(dir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ version: 1, hosts: 'nope' }), 'utf-8');
    expect(loadEgressPolicy(dir)).toBeNull();
  });

  it('JSON 损坏 → load 返回 null 且留证告警（不抛异常）', () => {
    const dir = mkDataDir();
    const p = egressPolicyPath(dir);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{ broken json', 'utf-8');
    expect(loadEgressPolicy(dir)).toBeNull();
  });

  it('write mode 收紧：0o600（安全配置面）', () => {
    const dir = mkDataDir();
    saveEgressPolicy(declareEgressHosts(['api.github.com']), dir);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(egressPolicyPath(dir)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});

describe('URL 提取（复用 networkOutboundTargetRule 的 hostname 口径）', () => {
  it('https URL → host + 默认端口 443 + 协议 https', () => {
    expect(egressRequestFromUrl('https://api.github.com/repos/a')).toEqual({
      host: 'api.github.com',
      port: 443,
      protocol: 'https',
    });
  });

  it('显式端口优先于默认端口', () => {
    expect(egressRequestFromUrl('http://localhost:8080/health')).toEqual({
      host: 'localhost',
      port: 8080,
      protocol: 'http',
    });
  });

  it('无法解析的 URL → null（不静默放行）', () => {
    expect(egressRequestFromUrl('not a url')).toBeNull();
    expect(egressRequestFromUrl('')).toBeNull();
  });
});

describe('normalizeEgressHost 边界', () => {
  it('IPv6 方括号剥离 + 小写', () => {
    expect(normalizeEgressHost('[::1]')).toBe('::1');
  });

  it('非字符串 / 空串 → 空串', () => {
    expect(normalizeEgressHost(undefined as unknown as string)).toBe('');
    expect(normalizeEgressHost('  ')).toBe('');
  });
});
