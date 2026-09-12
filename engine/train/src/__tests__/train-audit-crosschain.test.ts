// ============================================================
// train-audit-crosschain.test.ts · 跨模块审计链对拍（v1.4.8 第〇批收口）
// ============================================================
// 判据（收口前做不到——两个 verifier 是两份独立代码）：
//   **同一个 verifyChain**（@sofagent/audit 的 chain-kernel 导出）同时校验
//   audit 侧写入的 decision-log.jsonl 与 train 侧写入的 audit.jsonl，
//   两个文件都通过；且同一处篡改 / 同一处指纹漂移在两文件上给出同一判定。
//
// golden vector 硬锚放在 kernel 测试（chain-kernel.test.ts）——两侧共用内核，
// 一次锚住两条链。此处验证「同一内核函数确实同时服务两侧」。
//
// 隔离纪律：独立 mkdtemp dataDir + 临时 SOFAGENT_KEY_PATH——绝不触碰真实
// ~/.sofagent-key 与真实 data 目录。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getEnvFingerprint, getHmacKey, getDecisionLogPath } from '@sofagent/core';
import { emitDecision, verifyChain, checkDecisionChainDetailed, type EmitDecisionInput } from '@sofagent/audit';
import { emitTrainAudit, trainAuditPath, checkTrainAuditChain } from '../train-audit';

let dataDir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-crosschain-'));
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = join(dataDir, 'test-hmac-key');
  writeFileSync(process.env.SOFAGENT_KEY_PATH, 'crosschain-test-key-0123456789abcdef');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
});

/** audit 侧决策输入（缺省合法） */
function decisionInput(sessionId: string): EmitDecisionInput {
  return {
    agentId: 'engineer',
    sessionId,
    kind: 'TOOL_GATE',
    moment: 'ACT',
    why: { text: `决策 ${sessionId}` },
  };
}

/** train 侧审计输入（缺省合法） */
function trainInput(type: string): Parameters<typeof emitTrainAudit>[0] {
  return {
    type: type as Parameters<typeof emitTrainAudit>[0]['type'],
    trainJobId: 'job-cross-001',
    enterpriseId: 'ent-cross',
    dataSourceHash: 'a'.repeat(64),
    hyperparams: { lr: 0.0002 },
  };
}

/** 解析 JSONL 文件为条目数组 */
function parseJsonl(filePath: string): Record<string, unknown>[] {
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 同时写两侧的两条链，返回两个文件路径 */
function writeBothChains(): { decisionFile: string; trainFile: string } {
  emitDecision(decisionInput('s1'), dataDir);
  emitDecision(decisionInput('s2'), dataDir);
  emitTrainAudit(trainInput('train_job_submitted'), dataDir);
  emitTrainAudit(trainInput('train_job_started'), dataDir);
  return {
    decisionFile: getDecisionLogPath(dataDir),
    trainFile: trainAuditPath(dataDir, 'ent-cross', 'job-cross-001'),
  };
}

describe('跨模块审计链对拍（同一 verifyChain 校验两侧）', () => {
  it('test_同一verifyChain_同时校验decision-log与audit_两文件均ok', () => {
    const { decisionFile, trainFile } = writeBothChains();
    expect(existsSync(decisionFile)).toBe(true);
    expect(existsSync(trainFile)).toBe(true);

    const key = getHmacKey();
    const fingerprint = getEnvFingerprint(dataDir);

    // 🔴 同一个 verifyChain 函数实例，校验两个不同模块写出的链文件
    const decisionResult = verifyChain(parseJsonl(decisionFile), { key, fingerprint, subject: '决策' });
    const trainResult = verifyChain(parseJsonl(trainFile), { key, fingerprint, subject: '审计' });

    expect(decisionResult.status).toBe('ok');
    expect(trainResult.status).toBe('ok');

    // 两侧各自的封装 verifier 与内核判定一致（证明封装确实委派同一内核）
    expect(checkDecisionChainDetailed(dataDir).status).toBe(decisionResult.status);
    expect(checkTrainAuditChain(dataDir, 'ent-cross', 'job-cross-001').status).toBe(trainResult.status);
  });

  it('test_同一篡改_两侧均判tampered', () => {
    const { decisionFile, trainFile } = writeBothChains();
    const key = getHmacKey();
    const fingerprint = getEnvFingerprint(dataDir);

    // 两侧各篡改末条内容（改签名字段 → HMAC 必失配）
    for (const filePath of [decisionFile, trainFile]) {
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
      const last = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
      last.why = { text: '被篡改' };
      last.hyperparams = { lr: 999 };
      lines[lines.length - 1] = JSON.stringify(last);
      writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    }

    // 同一 verifyChain 对两侧给出同一判定
    expect(verifyChain(parseJsonl(decisionFile), { key, fingerprint }).status).toBe('tampered');
    expect(verifyChain(parseJsonl(trainFile), { key, fingerprint }).status).toBe('tampered');
    expect(checkDecisionChainDetailed(dataDir).status).toBe('tampered');
    expect(checkTrainAuditChain(dataDir, 'ent-cross', 'job-cross-001').status).toBe('tampered');
  });

  it('test_同一指纹漂移_两侧均判unverifiable', () => {
    const { decisionFile, trainFile } = writeBothChains();
    const key = getHmacKey();

    // 用「另一个环境指纹」复验（= 换机器 / 密钥轮换 / 路径变化）
    const drifted = 'drifted-fingerprint';
    expect(verifyChain(parseJsonl(decisionFile), { key, fingerprint: drifted }).status).toBe('unverifiable');
    expect(verifyChain(parseJsonl(trainFile), { key, fingerprint: drifted }).status).toBe('unverifiable');
  });

  it('test_两文件均落盘16位prevHash链_结构同构', () => {
    const { decisionFile, trainFile } = writeBothChains();
    for (const filePath of [decisionFile, trainFile]) {
      const entries = parseJsonl(filePath);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.prevHash).toBe('genesis');
      expect(entries[1]!.prevHash).toMatch(/^[0-9a-f]{16}$/);
      expect(entries.every((e) => e.hashVersion === 2)).toBe(true);
      expect(entries.every((e) => typeof e.hmacSig === 'string' && (e.hmacSig as string).length === 32)).toBe(true);
      expect(entries.every((e) => e.hmacAlgo === 'stable')).toBe(true);
    }
    // 目录权限 0o700（内核统一收紧——两侧同源）
    expect(dirMode(join(dataDir, 'audit'))).toBe(0o700);
    expect(dirMode(join(dataDir, 'train', 'ent-cross', 'job-cross-001'))).toBe(0o700);
  });
});

/** 目录权限位（0o777 掩码） */
function dirMode(path: string): number {
  return statSync(path).mode & 0o777;
}
