// ============================================================
// audit-history.test.ts · 审计历史持久化测试
// v0.98 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, homedir } from 'os';
import { createHash, randomBytes } from 'crypto';
import {
  appendHistory,
  loadHistory,
  clearHistory,
  checkHistoryChainIntegrity,
  checkHistoryChainDetailed,
  getHistoryFilePath,
  type AuditHistoryEntry,
} from './audit-history';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-history-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 构造一条测试用的历史条目 */
function makeEntry(timestamp: string, exitCode: number, ruleResults?: AuditHistoryEntry['ruleResults']): AuditHistoryEntry {
  return {
    timestamp,
    diffRange: 'HEAD~1..HEAD',
    task: '测试任务',
    exitCode,
    ruleResults: ruleResults ?? [
      { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [] },
      { name: 'A2 不泄密钥', number: 2, status: exitCode >= 1 ? 'WARN' : 'PASS', details: exitCode >= 1 ? ['发现 src/config.ts'] : [] },
    ],
    diffFileCount: 3,
    commitMsg: 'test commit',
  };
}

describe('audit-history', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('appendHistory 写入到正确的文件路径', () => {
    // 验证：追加后文件存在，且内容为 JSONL 格式
    const entry = makeEntry('2026-01-01T00:00:00.000Z', 0);
    appendHistory(entry, testDir);

    const filePath = getHistoryFilePath(testDir);
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.exitCode).toBe(0);
  });

  it('appendHistory 目录不存在时自动创建', () => {
    // 验证：数据目录的 audit 子目录不存在时也能正常写入
    const entry = makeEntry('2026-01-01T00:00:00.000Z', 0);
    appendHistory(entry, testDir);

    // audit 子目录应该被自动创建
    expect(existsSync(join(testDir, 'audit'))).toBe(true);
    expect(existsSync(getHistoryFilePath(testDir))).toBe(true);
  });

  it('appendHistory 多次追加不覆盖', () => {
    // 验证：多次追加产生多行 JSONL
    appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), testDir);
    appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 1), testDir);
    appendHistory(makeEntry('2026-01-03T00:00:00.000Z', 2), testDir);

    const content = readFileSync(getHistoryFilePath(testDir), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(3);
  });

  // v1.3.8 P1-A1 回归：commitMsg/task 自由文本脱敏——此前 sanitize 只映射 ruleResults，
  // message 里密钥全文落盘 history.jsonl（审计工具自身成为第二泄漏点）。
  // 密钥运行时拼接（铁律：测试不字面写真实格式密钥）。
  it('appendHistory 对 commitMsg/task 中的密钥脱敏（自由文本不全文落盘）', () => {
    const leakKey = ['sk-', 'a'.repeat(40)].join('');
    const awsKey = ['AK', 'IAIOSFODNN7EXAMPLE'].join('');
    const entry = makeEntry('2026-01-01T00:00:00.000Z', 0);
    entry.commitMsg = `add key ${leakKey} to config`;
    entry.task = `同步 AWS 密钥 ${awsKey}`;
    appendHistory(entry, testDir);

    const content = readFileSync(getHistoryFilePath(testDir), 'utf-8');
    // 密钥原文不得出现在落盘内容里
    expect(content).not.toContain(leakKey);
    expect(content).not.toContain(awsKey);
    // 脱敏占位符存在（证明走了 REDACTION_PATTERNS 管道）
    expect(content).toContain('sk-***REDACTED***');
    expect(content).toContain('AKIA***REDACTED***');
    // 非密钥文本保留
    expect(content).toContain('to config');
    expect(content).toContain('同步 AWS 密钥');
  });

  it('appendHistory 无密钥的 commitMsg/task 原样保留（不误伤）', () => {
    const entry = makeEntry('2026-01-01T00:00:00.000Z', 0);
    entry.commitMsg = 'fix: 修复登录超时问题';
    entry.task = '正常的任务描述，无敏感信息';
    appendHistory(entry, testDir);
    const content = readFileSync(getHistoryFilePath(testDir), 'utf-8');
    expect(content).toContain('fix: 修复登录超时问题');
    expect(content).toContain('正常的任务描述，无敏感信息');
    expect(content).not.toContain('REDACTED');
  });

  it('loadHistory 返回按时间倒序的数组', () => {
    // 验证：加载历史，最新（时间戳最大）的排前面
    appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), testDir);
    appendHistory(makeEntry('2026-01-03T00:00:00.000Z', 2), testDir);
    appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 1), testDir);

    const entries = loadHistory(undefined, testDir);
    expect(entries.length).toBe(3);
    // 倒序——最新的在前
    expect(entries[0]!.timestamp).toBe('2026-01-03T00:00:00.000Z');
    expect(entries[1]!.timestamp).toBe('2026-01-02T00:00:00.000Z');
    expect(entries[2]!.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('loadHistory limit 参数限制返回条数', () => {
    // 验证：limit=2 时只返回最近 2 条
    for (let i = 1; i <= 5; i++) {
      appendHistory(makeEntry(`2026-01-0${i}T00:00:00.000Z`, 0), testDir);
    }

    const entries = loadHistory(2, testDir);
    expect(entries.length).toBe(2);
    // 返回最近 2 条
    expect(entries[0]!.timestamp).toBe('2026-01-05T00:00:00.000Z');
    expect(entries[1]!.timestamp).toBe('2026-01-04T00:00:00.000Z');
  });

  it('loadHistory 文件不存在时返回空数组', () => {
    // 验证：无历史文件时返回空数组，不报错
    const entries = loadHistory(undefined, testDir);
    expect(entries).toEqual([]);
  });

  it('loadHistory 跳过解析失败的行（容错）', () => {
    // 验证：JSONL 中混入损坏行时，正常行不受影响
    const filePath = getHistoryFilePath(testDir);
    mkdirSync(join(testDir, 'audit'), { recursive: true });

    // 手动写入：1 行正常 + 1 行损坏 + 1 行正常
    const validEntry = JSON.stringify(makeEntry('2026-01-01T00:00:00.000Z', 0));
    const corruptedLine = '{ this is not valid json !!!';
    const validEntry2 = JSON.stringify(makeEntry('2026-01-02T00:00:00.000Z', 1));
    const content = `${validEntry}\n${corruptedLine}\n${validEntry2}\n`;

    // 用 appendFileSync 直接写入（绕过 appendHistory）
    const { appendFileSync } = require('fs');
    appendFileSync(filePath, content, 'utf-8');

    const entries = loadHistory(undefined, testDir);
    // 损坏行被跳过，正常行保留
    expect(entries.length).toBe(2);
  });

  it('clearHistory 清空历史文件内容', () => {
    // 验证：清空后文件存在但内容为空
    appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), testDir);
    appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 1), testDir);

    expect(loadHistory(undefined, testDir).length).toBe(2);

    clearHistory(testDir);

    // 文件还在，但内容为空
    const filePath = getHistoryFilePath(testDir);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('');
    expect(loadHistory(undefined, testDir)).toEqual([]);
  });

  it('v1.0.6: 混合格式不误报链断裂（旧条目无 hashVersion + 新条目 hashVersion:2）', () => {
    // 场景：用户从 v1.0.5 升级到 v1.0.6
    // history.jsonl 前两条是旧格式（无 hashVersion，旧算法 hash 不含指纹）
    // 第三条是新格式（hashVersion:2，新算法 hash 含环境指纹）
    // checkHistoryChainIntegrity 应返回 true（逐条判断，不误报）

    mkdirSync(join(testDir, 'audit'), { recursive: true });
    const histPath = getHistoryFilePath(testDir);

    // 旧格式条目 1（无 hashVersion）
    const e1 = {
      timestamp: '2026-07-01T00:00:00Z',
      diffRange: 'HEAD~1..HEAD',
      exitCode: 0,
      ruleResults: [],
      diffFileCount: 1,
      prevHash: 'genesis',
    };

    // 旧格式条目 2（无 hashVersion，prevHash 用旧算法 = SHA-256(e1 without prevHash/hashVersion)）
    const e1ForHash = { ...e1, prevHash: undefined, hashVersion: undefined };
    const hash1 = createHash('sha256').update(JSON.stringify(e1ForHash)).digest('hex').slice(0, 16);
    const e2 = {
      timestamp: '2026-07-02T00:00:00Z',
      diffRange: 'HEAD~2..HEAD~1',
      exitCode: 0,
      ruleResults: [],
      diffFileCount: 1,
      prevHash: hash1,
    };

    // 写两条旧格式到文件
    writeFileSync(histPath, JSON.stringify(e1) + '\n' + JSON.stringify(e2) + '\n');

    // 验证纯旧格式时链完整
    expect(checkHistoryChainIntegrity(testDir)).toBe(true);

    // 追加一条新格式（appendHistory 自动用 hashVersion:2 + 环境指纹）
    appendHistory({
      timestamp: '2026-07-03T00:00:00Z',
      diffRange: 'HEAD~3..HEAD~2',
      exitCode: 0,
      ruleResults: [],
      diffFileCount: 1,
    } as AuditHistoryEntry, testDir);

    // 混合格式——不应误报链断裂
    // 关键：e2→e3 这一步用 curr(e3).hashVersion === 2 决定算法（含指纹）
    //      e1→e2 这一步用 curr(e2).hashVersion === undefined 决定算法（不含指纹）
    expect(checkHistoryChainIntegrity(testDir)).toBe(true);
  });

  describe('Action Governance schema (A4 研读落地)', () => {
    it('appendHistory 保留 actionGovernance（5 字段 + 决策溯源组）', () => {
      // 验证：审计记录经 append/load 往返后，Action Governance 5 字段 + 决策溯源组不丢失
      const entry: AuditHistoryEntry = {
        ...makeEntry('2026-01-01T00:00:00.000Z', 0),
        actionGovernance: {
          actor: 'alice',
          timestamp: '2026-01-01T00:00:00.000Z',
          targetEntity: 'src/foo.ts; src/bar.ts',
          context: '修复 issue #1',
          decisionProvenance: {
            who: 'alice',
            when: '2026-01-01T00:00:00.000Z',
            whichApp: 'sofagent-audit v1.1.6',
          },
        },
      };
      appendHistory(entry, testDir);

      const loaded = loadHistory(undefined, testDir);
      expect(loaded.length).toBe(1);
      const gov = loaded[0]!.actionGovernance;
      expect(gov).toBeDefined();
      // 5 字段
      expect(gov!.actor).toBe('alice');
      expect(gov!.timestamp).toBe('2026-01-01T00:00:00.000Z');
      expect(gov!.targetEntity).toBe('src/foo.ts; src/bar.ts');
      expect(gov!.context).toBe('修复 issue #1');
      // decisionProvenance 决策溯源组
      expect(gov!.decisionProvenance.who).toBe('alice');
      expect(gov!.decisionProvenance.when).toBe('2026-01-01T00:00:00.000Z');
      expect(gov!.decisionProvenance.whichApp).toBe('sofagent-audit v1.1.6');
      // whichDataVersion 当前未回填——可省略（不伪造）
      expect(gov!.decisionProvenance.whichDataVersion).toBeUndefined();
    });

    it('actionGovernance 为可选字段——无该字段的旧记录向后兼容', () => {
      // 验证：旧格式记录（无 actionGovernance）写入后仍能正常加载，不报错
      const filePath = getHistoryFilePath(testDir);
      mkdirSync(join(testDir, 'audit'), { recursive: true });
      writeFileSync(filePath, JSON.stringify(makeEntry('2026-01-01T00:00:00.000Z', 0)) + '\n', 'utf-8');

      const loaded = loadHistory(undefined, testDir);
      expect(loaded.length).toBe(1);
      expect(loaded[0]!.actionGovernance).toBeUndefined();
    });
  });

  describe('P2-6: HMAC-SHA256 签名（v1.1.8）', () => {
    // P1-4: 用 SOFAGENT_KEY_PATH 指向临时目录——绝不触碰真实 ~/.sofagent-key
    // （此前 beforeEach 删真实密钥、afterEach 恢复，中途 kill -9 会丢用户密钥）
    let KEY_PATH: string;
    let savedKeyPath: string | undefined;

    beforeEach(() => {
      savedKeyPath = process.env.SOFAGENT_KEY_PATH;
      KEY_PATH = join(tmpDir(), '.sofagent-key');
      process.env.SOFAGENT_KEY_PATH = KEY_PATH;
    });

    afterEach(() => {
      try { rmSync(dirname(KEY_PATH), { recursive: true, force: true }); } catch { /* */ }
      if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
      else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    });

    it('无 HMAC 密钥：降级 SHA-256，append + check 通过且不含 hmacSig', () => {
      // P0-3: 单条不足 2 条 → insufficient（不可信）；≥2 条才能验证链
      appendHistory(makeEntry('2026-02-01T00:00:00Z', 0), testDir);
      appendHistory(makeEntry('2026-02-01T00:00:01Z', 0), testDir);
      expect(checkHistoryChainIntegrity(testDir)).toBe(true);
      const lines = readFileSync(getHistoryFilePath(testDir), 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.hmacSig).toBeUndefined();
    });

    it('有 HMAC 密钥：写入 hmacSig 且 append + check 通过', () => {
      writeFileSync(KEY_PATH, 'test-hmac-key-1234567890', { mode: 0o600 });
      appendHistory(makeEntry('2026-02-02T00:00:00Z', 0), testDir);
      appendHistory(makeEntry('2026-02-02T00:00:01Z', 0), testDir);
      expect(checkHistoryChainIntegrity(testDir)).toBe(true);
      const lines = readFileSync(getHistoryFilePath(testDir), 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]!);
      expect(typeof parsed.hmacSig).toBe('string');
      expect(parsed.hmacSig.length).toBeGreaterThan(0);
    });

    it('有 HMAC 密钥：含 A2/A9 结果的 ≥2 条干净链 append + check 通过（P0-3 回归）', () => {
      writeFileSync(KEY_PATH, 'test-hmac-key-1234567890', { mode: 0o600 });
      // 构造含 A2(number=2) + A9(number=9) 的结果，且 FAIL 触发 sanitizeRuleResult 覆盖 details
      const a2a9 = [
        { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [] },
        { name: 'A2 不泄密钥', number: 2, status: 'FAIL', details: ['命中行 src/secret.ts'] },
        { name: 'A9 不纳注入', number: 9, status: 'FAIL', details: ['命中行 evil.py', '命中行 bad.sh'] },
      ];
      appendHistory(makeEntry('2026-03-01T00:00:00Z', 2, a2a9), testDir);
      appendHistory(makeEntry('2026-03-02T00:00:00Z', 2, a2a9), testDir);
      // 写侧基于脱敏记录签名、读侧校验脱敏记录 → 必须一致（不因 A2/A9 脱敏差异误判篡改）
      expect(checkHistoryChainIntegrity(testDir)).toBe(true);
    });

    it('有 HMAC 密钥：篡改条目 → HMAC 校验失败（链断裂）', () => {
      writeFileSync(KEY_PATH, 'test-hmac-key-1234567890', { mode: 0o600 });
      appendHistory(makeEntry('2026-02-03T00:00:00Z', 0), testDir);
      appendHistory(makeEntry('2026-02-04T00:00:00Z', 0), testDir);
      // 篡改前干净链必须通过（确保不是因 A2/A9 脱敏不一致而“假通过”）
      expect(checkHistoryChainIntegrity(testDir)).toBe(true);
      // 篡改最后一条（exitCode 从 0 改成 2）→ HMAC 验签失败 → 链断裂
      const histPath = getHistoryFilePath(testDir);
      const lines = readFileSync(histPath, 'utf-8').trim().split('\n');
      const tampered = JSON.parse(lines[lines.length - 1]!);
      tampered.exitCode = 2;
      writeFileSync(histPath, lines.slice(0, -1).concat(JSON.stringify(tampered)).join('\n') + '\n');
      expect(checkHistoryChainIntegrity(testDir)).toBe(false);
    });

    it('P0-3(2026-08-02 复核修正): stable 条目 + hashVersion=2 + HMAC 不匹配且环境指纹一致 → tampered', () => {
      // appendHistory 写入 hashVersion:2 + hmacAlgo:'stable' + envFingerprint（当前环境指纹）
      // 篡改后 HMAC 不匹配，但 envFingerprint 与当前指纹一致（运行环境未变）→
      // 只能是内容被改 → tampered（红）。这是 P0-3 修复的核心：v2 条目篡改不再检测不到。
      writeFileSync(KEY_PATH, 'test-hmac-key-1234567890', { mode: 0o600 });
      appendHistory(makeEntry('2026-04-01T00:00:00Z', 0), testDir);
      appendHistory(makeEntry('2026-04-02T00:00:00Z', 0), testDir);

      // 篡改前干净链必须是 ok
      const cleanResult = checkHistoryChainDetailed(testDir);
      expect(cleanResult.status).toBe('ok');

      // 篡改最后一条（exitCode 从 0 改成 2）→ HMAC 验签失败
      const histPath = getHistoryFilePath(testDir);
      const lines = readFileSync(histPath, 'utf-8').trim().split('\n');
      const tampered = JSON.parse(lines[lines.length - 1]!);
      tampered.exitCode = 2;
      writeFileSync(histPath, lines.slice(0, -1).concat(JSON.stringify(tampered)).join('\n') + '\n');

      // hashVersion=2 + 环境指纹一致 → HMAC 不匹配 = 确为篡改（红），不再是「无法区分」的黄
      const result = checkHistoryChainDetailed(testDir);
      expect(result.status).toBe('tampered');
    });

    it('P0-1: stable 条目 + hashVersion 未定义 + HMAC 不匹配 → tampered（环境无关确为篡改）', () => {
      // 手动构造：hmacAlgo='stable' 但 hashVersion 未定义（无环境指纹）
      // 链 + HMAC 均用无指纹算法，篡改后 HMAC 不匹配 → 环境无关，确为内容被改 → tampered（红）
      writeFileSync(KEY_PATH, 'test-hmac-key-1234567890', { mode: 0o600 });
      const key = 'test-hmac-key-1234567890';

      const { createHash: chHash, createHmac: chHmac } = require('crypto');
      const { stableStringify: ss } = require('@sofagent/core');

      // 第一条条目（链起点，无 prevHash 要求）
      const baseEntry1 = {
        timestamp: '2026-05-01T00:00:00Z',
        diffRange: 'HEAD~1..HEAD',
        exitCode: 0,
        ruleResults: [],
        diffFileCount: 1,
        commitMsg: 'test',
      };
      // 计算 e1 的 HMAC（stable 签名，无指纹）
      const recForSig1 = { ...baseEntry1, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
      const sig1 = chHmac('sha256', key).update(ss(recForSig1)).digest('hex').slice(0, 32);
      const e1 = { ...baseEntry1, prevHash: 'unknown', hashVersion: undefined, hmacAlgo: 'stable', hmacSig: sig1 };

      // 第二条条目：prevHash 用无指纹算法 = SHA-256(e1 without prevHash/hashVersion)
      const e1ForHash = { ...e1, prevHash: undefined, hashVersion: undefined };
      const prevHash2 = chHash('sha256').update(JSON.stringify(e1ForHash)).digest('hex').slice(0, 16);
      const baseEntry2 = {
        timestamp: '2026-05-02T00:00:00Z',
        diffRange: 'HEAD~2..HEAD~1',
        exitCode: 0,
        ruleResults: [],
        diffFileCount: 1,
        commitMsg: 'test2',
        prevHash: prevHash2,
      };
      const recForSig2 = { ...baseEntry2, prevHash: undefined, hashVersion: undefined, hmacSig: undefined, hmacAlgo: undefined };
      const sig2 = chHmac('sha256', key).update(ss(recForSig2)).digest('hex').slice(0, 32);
      const e2 = { ...baseEntry2, hashVersion: undefined, hmacAlgo: 'stable', hmacSig: sig2 };

      mkdirSync(join(testDir, 'audit'), { recursive: true });
      const histPath = getHistoryFilePath(testDir);
      writeFileSync(histPath, JSON.stringify(e1) + '\n' + JSON.stringify(e2) + '\n');

      // 篡改最后一条（exitCode 0→2）→ prevHash 链仍通过，但 HMAC 验签失败
      const lines = readFileSync(histPath, 'utf-8').trim().split('\n');
      const tampered = JSON.parse(lines[lines.length - 1]!);
      tampered.exitCode = 2;
      writeFileSync(histPath, lines.slice(0, -1).concat(JSON.stringify(tampered)).join('\n') + '\n');

      // hashVersion 未定义 = 无指纹，stable HMAC 不匹配 = 内容被改 → tampered（红）
      const result = checkHistoryChainDetailed(testDir);
      expect(result.status).toBe('tampered');
    });

    it('R-02: stable 干净链 → checkHistoryChainDetailed 返回 ok（防假阳性回归）', () => {
      // 确保写入侧用 stableStringify 签名、读取侧也用 stableStringify 校验时
      // 干净链不会被误报为篡改（run-09 回归防护）
      writeFileSync(KEY_PATH, 'test-hmac-key-1234567890', { mode: 0o600 });
      appendHistory(makeEntry('2026-04-03T00:00:00Z', 0), testDir);
      appendHistory(makeEntry('2026-04-04T00:00:00Z', 1), testDir);
      appendHistory(makeEntry('2026-04-05T00:00:00Z', 2), testDir);

      const result = checkHistoryChainDetailed(testDir);
      expect(result.status).toBe('ok');
    });

    describe('结构异常检测：非标准 schema 行 = 篡改（红）', () => {
      it('追加伪造行（{"tampered":true,"hmacSig":"fake"}）→ tampered 而非 unverifiable', () => {
        // 攻击链：伪造/篡改者向 history.jsonl 追加非标准 schema 行。
        // 此前该类行因无 prevHash 被归为 unverifiable（黄，exit 1）——
        // 语义轻描淡写。非标准 schema = 结构异常 = tampered（红，exit 2）。
        writeFileSync(KEY_PATH, 'test-hmac-key-1234567890', { mode: 0o600 });
        appendHistory(makeEntry('2026-06-01T00:00:00Z', 0), testDir);
        appendHistory(makeEntry('2026-06-02T00:00:00Z', 0), testDir);
        // 篡改前干净链必须是 ok
        expect(checkHistoryChainDetailed(testDir).status).toBe('ok');

        const histPath = getHistoryFilePath(testDir);
        const lines = readFileSync(histPath, 'utf-8').trim().split('\n');
        writeFileSync(histPath, [...lines, '{"tampered":true,"hmacSig":"fake"}'].join('\n') + '\n');

        const result = checkHistoryChainDetailed(testDir);
        expect(result.status).toBe('tampered');
        expect(result.detail).toContain('非标准 schema');
      });

      it('非 JSON 行（损坏/手写）→ tampered（结构异常）', () => {
        appendHistory(makeEntry('2026-06-03T00:00:00Z', 0), testDir);
        appendHistory(makeEntry('2026-06-04T00:00:00Z', 0), testDir);
        const histPath = getHistoryFilePath(testDir);
        const lines = readFileSync(histPath, 'utf-8').trim().split('\n');
        writeFileSync(histPath, [...lines, 'not-a-json-line'].join('\n') + '\n');
        expect(checkHistoryChainDetailed(testDir).status).toBe('tampered');
      });

      it('合法事件行（rule_disabled，无 exitCode 但有 event 字段）不误报', () => {
        // index.ts 的规则关闭事件行 schema 与审计记录不同（无 exitCode），
        // 带 event 字段 → 合法事件记录，豁免结构检测，不判篡改。
        appendHistory(makeEntry('2026-06-05T00:00:00Z', 0), testDir);
        appendHistory(makeEntry('2026-06-06T00:00:00Z', 0), testDir);
        const histPath = getHistoryFilePath(testDir);
        const lines = readFileSync(histPath, 'utf-8').trim().split('\n');
        const eventLine = JSON.stringify({
          timestamp: new Date().toISOString(),
          event: 'rule_disabled',
          disabledRules: 'a10, a11',
          count: 2,
        });
        writeFileSync(histPath, [...lines, eventLine].join('\n') + '\n');
        // 事件行不构成链断裂（不判 ok——事件行无链字段归 unverifiable 段；但绝不判 tampered）
        const result = checkHistoryChainDetailed(testDir);
        expect(result.status).not.toBe('tampered');
      });

      it('legacy 条目（有 timestamp/exitCode，无链字段）不误报为结构异常', () => {
        // legacy 漂移（黄）与结构异常（红）的边界：legacy 条目仍具备审计记录
        // 必有字段，只是无 prevHash/hmacSig 链字段——归 unverifiable，不判 tampered。
        mkdirSync(join(testDir, 'audit'), { recursive: true });
        const histPath = getHistoryFilePath(testDir);
        const legacy1 = { timestamp: '2026-07-01T00:00:00Z', diffRange: 'HEAD~1..HEAD', exitCode: 0, ruleResults: [], diffFileCount: 1 };
        const legacy2 = { timestamp: '2026-07-02T00:00:00Z', diffRange: 'HEAD~2..HEAD~1', exitCode: 1, ruleResults: [], diffFileCount: 1 };
        writeFileSync(histPath, JSON.stringify(legacy1) + '\n' + JSON.stringify(legacy2) + '\n');
        const result = checkHistoryChainDetailed(testDir);
        expect(result.status).not.toBe('tampered');
      });
    });
  });
});
