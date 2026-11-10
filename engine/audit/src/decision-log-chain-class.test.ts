// ============================================================
// decision-log-chain-class.test.ts · 写入面分链硬闸 + 分链验链回归锁（2026-11）
// ============================================================
//
// 背景（实测定性）：`decision-log.jsonl` 混着三种结构性不同的写入面——
//   · 宿主 host：宿主 key 签名（正式安装面）；
//   · 设备 device：`device-*` agentId（217 个不同 id），device key 签名；
//   · 测试 test：早期夹具 agentId（A / B / a / smoke / smoke2 / test-agent），一次性 key。
// 混链 ⇒ 整链出现不可复验长段（实测 104,337 条中 8,333 条，非篡改）。
// 修法 = 历史原样 + **新写入面分段**：本文件锁死「新写入」这一侧的防复发闸。
//
// 本文件锁六件事：
//   ① agentId='A' / 'test-agent' / 'device-abc' 在 host 请求下被强制降链，且
//      **host 链一字未写**（防复发核心：错的条目再也不会进宿主链）；
//   ② 降链不静默：stderr 留一行、返回值的 chainClass 如实报实际落链；
//   ③ 显式请求 test / device 不受硬闸影响（调用方自持写入面）；
//   ④ 非法链分类 fail-loud（与 core 同一取值域，双向抛错）；
//   ⑤ `--chain all` 的分链报告**不合并计数**（夹具造 host + test 两条链）；
//   ⑥ 老语义零漂移：普通 agentId 仍落 host 链、写入正文不含 chainClass 字段。
//
// 隔离：全部落 mkdtemp 临时目录（显式 dataDir 入参 + SOFAGENT_KEY_PATH 指向临时钥），
// 绝不触碰真实 ~/.sofagent/data 与 ~/.sofagent-key。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { getDecisionLogPath } from '@sofagent/core';
import { emitDecision, type EmitDecisionInput, type DecisionChainClass } from './decision-log';
import { collectDecisionChainReports } from './commands/verify';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-chain-class-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInput(overrides: Partial<EmitDecisionInput> = {}): EmitDecisionInput {
  return {
    agentId: 'engineer',
    sessionId: 'sess-chain-class',
    kind: 'TOOL_GATE',
    moment: 'ACT',
    why: { text: '写入面分链用例', tags: ['chain-class'], confidence: 'high' },
    ...overrides,
  };
}

/** 读某条链的全部条目（不存在返回空数组——空链与「无写入」同义） */
function readChainEntries(dataDir: string, chain: DecisionChainClass): Record<string, unknown>[] {
  const filePath = getDecisionLogPath(dataDir, chain);
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('emitDecision · 写入面分链硬闸（防复发核心）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;
  let savedChainClassEnv: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    // 临时密钥——绝不触碰真实 ~/.sofagent-key
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const keyPath = join(testDir, 'test-hmac-key');
    writeFileSync(keyPath, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = keyPath;
    // 环境变量档必须清干净：否则外部环境会把用例拖到别的链
    savedChainClassEnv = process.env.SOFAGENT_CHAIN_CLASS;
    delete process.env.SOFAGENT_CHAIN_CLASS;
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // 为何可静默：临时目录清理失败不影响断言结论（下次 tmpdir 用新路径），
      // 也不污染真实数据面——不为清理失败把绿灯改红。
    }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    if (savedChainClassEnv === undefined) delete process.env.SOFAGENT_CHAIN_CLASS;
    else process.env.SOFAGENT_CHAIN_CLASS = savedChainClassEnv;
  });

  it('agentId="A"（测试夹具）在 host 请求下被强制降链 test，host 链一字未写', () => {
    const entry = emitDecision(makeInput({ agentId: 'A' }), testDir);

    expect(entry.chainClass).toBe('test');
    // host 链根本没被创建（比「写了但内容不对」更强的断言）
    expect(existsSync(getDecisionLogPath(testDir, 'host'))).toBe(false);
    const testEntries = readChainEntries(testDir, 'test');
    expect(testEntries).toHaveLength(1);
    expect(testEntries[0]!.agentId).toBe('A');
  });

  it('agentId="test-agent" / "smoke" 同样降链 test（白名单全档）', () => {
    emitDecision(makeInput({ agentId: 'test-agent' }), testDir);
    emitDecision(makeInput({ agentId: 'smoke' }), testDir);
    expect(readChainEntries(testDir, 'test')).toHaveLength(2);
    expect(existsSync(getDecisionLogPath(testDir, 'host'))).toBe(false);
  });

  it('agentId="device-abc"（设备写入面）在 host 请求下被强制降链 device', () => {
    const entry = emitDecision(makeInput({ agentId: 'device-abc' }), testDir);

    expect(entry.chainClass).toBe('device');
    expect(existsSync(getDecisionLogPath(testDir, 'host'))).toBe(false);
    const deviceEntries = readChainEntries(testDir, 'device');
    expect(deviceEntries).toHaveLength(1);
    expect(deviceEntries[0]!.agentId).toBe('device-abc');
  });

  it('普通 agentId 仍落 host 链（老语义零漂移）', () => {
    const entry = emitDecision(makeInput({ agentId: 'engineer' }), testDir);

    expect(entry.chainClass).toBe('host');
    expect(readChainEntries(testDir, 'host')).toHaveLength(1);
    expect(existsSync(getDecisionLogPath(testDir, 'test'))).toBe(false);
    expect(existsSync(getDecisionLogPath(testDir, 'device'))).toBe(false);
  });

  it('显式请求 test / device 不受硬闸影响（调用方自持写入面）', () => {
    const toTest = emitDecision(makeInput({ agentId: 'engineer', chainClass: 'test' }), testDir);
    const toDevice = emitDecision(makeInput({ agentId: 'device-xyz', chainClass: 'device' }), testDir);

    expect(toTest.chainClass).toBe('test');
    expect(toDevice.chainClass).toBe('device');
    expect(readChainEntries(testDir, 'test')).toHaveLength(1);
    expect(readChainEntries(testDir, 'device')).toHaveLength(1);
    expect(existsSync(getDecisionLogPath(testDir, 'host'))).toBe(false);
  });

  it('显式 host + 测试 agentId 仍被硬闸改道（"请求 host" 不能绕过分链）', () => {
    const entry = emitDecision(makeInput({ agentId: 'B', chainClass: 'host' }), testDir);
    expect(entry.chainClass).toBe('test');
    expect(existsSync(getDecisionLogPath(testDir, 'host'))).toBe(false);
  });

  it('SOFAGENT_CHAIN_CLASS=test 时普通 agentId 落 test 链（环境变量档生效）', () => {
    process.env.SOFAGENT_CHAIN_CLASS = 'test';
    const entry = emitDecision(makeInput({ agentId: 'engineer' }), testDir);
    expect(entry.chainClass).toBe('test');
    expect(readChainEntries(testDir, 'test')).toHaveLength(1);
  });

  it('非法链分类 fail-loud（不写任何文件）', () => {
    expect(() => emitDecision(makeInput({ agentId: 'engineer', chainClass: 'all' as never }), testDir)).toThrow(
      /非法审计链分类/,
    );
    expect(existsSync(getDecisionLogPath(testDir, 'host'))).toBe(false);
    expect(existsSync(getDecisionLogPath(testDir, 'test'))).toBe(false);
  });

  it('写入正文不含 chainClass 字段（分链不改写入正文/不改签名语义）', () => {
    emitDecision(makeInput({ agentId: 'test-agent' }), testDir);
    const raw = readFileSync(getDecisionLogPath(testDir, 'test'), 'utf-8').trim();
    expect(raw.includes('"chainClass"')).toBe(false);
    // 链字段齐全（分链后签名协议一字未改）
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(typeof parsed.hmacSig).toBe('string');
    expect(parsed.hashVersion).toBe(2);
  });

  it('降链在 stderr 留痕（不静默）', () => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '));
    };
    try {
      emitDecision(makeInput({ agentId: 'device-abc' }), testDir);
    } finally {
      console.error = original;
    }
    expect(lines.join('\n')).toContain('写入面分链');
    expect(lines.join('\n')).toContain('device-abc');
    expect(lines.join('\n')).toContain('device');
  });
});

describe('collectDecisionChainReports · 分链报告不合并计数', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const keyPath = join(testDir, 'test-hmac-key');
    writeFileSync(keyPath, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = keyPath;
    // 夹具：host 链 2 条 + test 链 3 条（device 链不造 = 空链）
    emitDecision(makeInput({ agentId: 'engineer', sessionId: 'host-1' }), testDir);
    emitDecision(makeInput({ agentId: 'architect', sessionId: 'host-2' }), testDir);
    emitDecision(makeInput({ agentId: 'A', sessionId: 'test-1' }), testDir);
    emitDecision(makeInput({ agentId: 'test-agent', sessionId: 'test-2' }), testDir);
    emitDecision(makeInput({ agentId: 'smoke', sessionId: 'test-3' }), testDir);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // 为何可静默：临时目录清理失败不影响断言（同上方用例同口径），不修改真实数据面
    }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('三条链各自报自己的条数与状态（host=2 / test=3 / device=空链）', () => {
    const { reports, code } = collectDecisionChainReports(['host', 'device', 'test'], testDir);

    expect(reports.map((r) => r.chain)).toEqual(['host', 'device', 'test']);
    const host = reports.find((r) => r.chain === 'host')!;
    const device = reports.find((r) => r.chain === 'device')!;
    const test = reports.find((r) => r.chain === 'test')!;

    expect(host.entries).toBe(2);
    expect(test.entries).toBe(3);
    expect(device.entries).toBe(0);
    expect(device.status).toBe('empty');
    // 空链是设备/测试面的常态：退出码 1（不可完全复验），不是红
    expect(device.code).toBe(1);
    expect(code).toBe(1);
  });

  it('没有任何一条报告持有跨链合并计数（禁止重造「混合链」假象）', () => {
    const { reports } = collectDecisionChainReports(['host', 'device', 'test'], testDir);
    const total = reports.reduce((sum, r) => sum + r.entries, 0);
    expect(total).toBe(5);
    for (const report of reports) {
      expect(report.entries).toBeLessThan(total);
      expect(report.entries).toBe(readChainEntries(testDir, report.chain).length);
    }
  });

  it('只请求 host 时报告只含 host（--chain host 语义）', () => {
    const { reports } = collectDecisionChainReports(['host'], testDir);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.chain).toBe('host');
    expect(reports[0]!.entries).toBe(2);
    // 两条同指纹同密钥的干净条目 → ok
    expect(reports[0]!.status).toBe('ok');
  });

  it('篡改某一条链只让该链变红，其它链不被牵连（分链判定的意义）', () => {
    const hostPath = getDecisionLogPath(testDir, 'host');
    const lines = readFileSync(hostPath, 'utf-8').trim().split('\n');
    // 改 host 链首条正文（不动链字段）→ 只在 host 链上体现
    const tampered = JSON.parse(lines[0]!) as Record<string, unknown>;
    tampered.sessionId = 'tampered-session';
    lines[0] = JSON.stringify(tampered);
    writeFileSync(hostPath, lines.join('\n') + '\n');

    const { reports, code } = collectDecisionChainReports(['host', 'test'], testDir);
    const host = reports.find((r) => r.chain === 'host')!;
    const test = reports.find((r) => r.chain === 'test')!;
    expect(host.status).toBe('tampered');
    expect(host.code).toBe(2);
    expect(test.status).toBe('ok');
    expect(code).toBe(2);
  });
});
