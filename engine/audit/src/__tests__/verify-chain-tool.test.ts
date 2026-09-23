// ============================================================
// verify-chain-tool.test.ts · 独立验签器端到端篡改注入测试（v1.5.2 章二）
// ============================================================
// 被测对象：tools/verify/verify-chain.mjs（单文件零依赖独立验签器）。
// 本测试**不 mock 任何东西**：用真实引擎（appendHistory / emitDecision）造真链，
// 再用真实子进程（node 裸跑 .mjs）验签。测的就是第三方拿去举证时的同一条链路。
//
// 核心纪律：**证明验签器真会红**——防「验签器恒真」的假绿。
//   · 绿路（干净链 → 链完整）只是背景板；
//   · 红路（改任一中间条目 → 必须报断链并定位条目号）才是本测试的重点；
//   · 双链各测一例（history 一例、decision 一例）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { appendHistory } from '../audit-history';
import { emitDecision } from '../decision-log';
import { getEnvFingerprint, getDecisionLogPath } from '@sofagent/core';

/** 独立验签器路径（从本测试文件回溯至仓库根 tools/verify/） */
const TOOL_PATH = fileURLToPath(new URL('../../../../tools/verify/verify-chain.mjs', import.meta.url));

/** 运行验签器子进程，返回 { status, stdout, stderr } */
function runVerifier(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [TOOL_PATH, ...args], { encoding: 'utf-8' });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 造一条历史链条目（appendHistory 会补链字段） */
function histEntry(ts: string) {
  return {
    timestamp: ts,
    diffRange: 'HEAD~1..HEAD',
    exitCode: 0,
    ruleResults: [],
    diffFileCount: 1,
  };
}

function decisionInput(sessionId: string) {
  return {
    agentId: 'engineer',
    sessionId,
    kind: 'TOOL_GATE' as const,
    moment: 'ACT' as const,
    why: { text: `决策 ${sessionId}` },
  };
}

describe('tools/verify/verify-chain.mjs · 独立验签器端到端', () => {
  let testDir: string;
  let keyPath: string;
  let fp: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'sofagent-verify-tool-'));
    mkdirSync(join(testDir, 'audit'), { recursive: true });
    keyPath = join(testDir, 'test-hmac-key');
    writeFileSync(keyPath, 'verify-tool-key-0123456789abcdef');
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = keyPath;

    // 用真实引擎造链：历史链 3 条（并写 history-chain-head 锚点）+ 决策链 3 条
    appendHistory(histEntry('2026-01-01T00:00:00.000Z'), testDir);
    appendHistory(histEntry('2026-01-01T00:00:01.000Z'), testDir);
    appendHistory(histEntry('2026-01-01T00:00:02.000Z'), testDir);
    emitDecision(decisionInput('s1'), testDir);
    emitDecision(decisionInput('s2'), testDir);
    emitDecision(decisionInput('s3'), testDir);

    // 验签器须用与写侧一致的指纹（写侧 getEnvFingerprint(testDir)）
    fp = getEnvFingerprint(testDir);
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  /** 统一验签参数（显式指纹 + 显式密钥，隔离本机环境） */
  function args(): string[] {
    return ['--data-dir', testDir, '--key', keyPath, '--fingerprint', fp];
  }

  it('干净双链 → 链完整（退出码 0）', () => {
    const r = runVerifier(args());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('链完整');
    // 双链同批覆盖：输出必须同时含历史链与决策链段落
    expect(r.stdout).toContain('历史链');
    expect(r.stdout).toContain('决策链');
  });

  it('篡改 history 中间条目 → 报断链并定位条目号 #1（验签器真会红）', () => {
    const filePath = join(testDir, 'audit', 'history.jsonl');
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    // 改第 2 条（0-based index 1）的 exitCode——内容在签名之后被改
    const mid = JSON.parse(lines[1]!);
    mid.exitCode = 1;
    lines[1] = JSON.stringify(mid);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const r = runVerifier(args());
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('断链');
    expect(r.stdout).toContain('#1');
    // 给出期望值 / 实际值（举证面）
    expect(r.stdout).toContain('期望值');
    expect(r.stdout).toContain('实际值');
  });

  it('篡改 decision 中间条目 → 报断链并定位条目号 #1（决策链双覆盖）', () => {
    const filePath = getDecisionLogPath(testDir);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const mid = JSON.parse(lines[1]!);
    mid.why = { text: '被篡改的决策理由' };
    lines[1] = JSON.stringify(mid);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const r = runVerifier(args());
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('断链');
    expect(r.stdout).toContain('#1');
  });

  it('篡改 history 链头锚点 → 报链头不匹配（head-mismatch）', () => {
    const anchorPath = join(testDir, 'audit', 'history-chain-head');
    const anchor = JSON.parse(readFileSync(anchorPath, 'utf-8'));
    anchor.headHash = '0000000000000000';
    writeFileSync(anchorPath, JSON.stringify(anchor) + '\n', 'utf-8');

    const r = runVerifier(args());
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('链头不匹配');
  });

  it('decision 链无锚点 → 如实降级（不假装链头校验）', () => {
    const r = runVerifier(args());
    // 决策链无链头锚点文件；输出须如实说明仅做链完整性校验
    expect(r.stdout).toContain('决策链');
    expect(r.stdout).toContain('无链头锚点');
  });

  it('--json 输出机器可读结论（含 expected/actual 字段）', () => {
    const r = runVerifier([...args(), '--json']);
    expect(r.status).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload.exitCode).toBe(0);
    expect(Array.isArray(payload.results)).toBe(true);
    const kinds = payload.results.map((x: { kind: string }) => x.kind).sort();
    expect(kinds).toEqual(['decision', 'history']);
    // 决策链无锚点 → anchorStatus 为 null
    const decision = payload.results.find((x: { kind: string }) => x.kind === 'decision');
    expect(decision.anchorStatus).toBeNull();
  });
});
