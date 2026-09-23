// ============================================================
// invalidation.test.ts · 审计结论失效语义测试（v1.5.2 章四）
//
// 逐条对齐 SSOT（docs/changelog/v1.5/v1.5.2.md §四）验收标准：
//   ① 失效原因词汇表落地（schema 字段 + 枚举值 + 非法值拒绝）
//   ② 三触发钩子生效（授权变更 / 压缩事件 / 风险升级 → 既有结论被标记失效）
//   ③ 失效结论被下游过滤（HITL 依据 / 治理 KPI 统计 / filterValid）
//   ④ 失效结论原文保留（标记前后原条目字节逐字不变 + 链仍判 ok）
//   ⑤ 向后兼容（老日志无 invalidationReason 字段照常解析/校验）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { getDecisionLogPath } from '@sofagent/core';
import { emitDecision, DecisionSchemaError, type EmitDecisionInput } from '../decision-log';
import { checkDecisionChainDetailed } from '../decision-chain';
import { loadDecisionLog, findSimilarDecisions } from '../decision-query';
import { computeGovernanceKpis } from '../governance';
import { appendHistory, type AuditHistoryEntry } from '../audit-history';
import { defaultRules } from '../rules';
import {
  markInvalid,
  hooks,
  collectInvalidations,
  isInvalidated,
  filterValid,
  isInvalidationMarker,
  findConclusionsByRules,
  findConclusionsForObject,
  findSessionConclusions,
} from '../invalidation';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-invalidation-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInput(overrides: Partial<EmitDecisionInput> = {}): EmitDecisionInput {
  return {
    agentId: 'engineer',
    sessionId: 'sess-1',
    kind: 'TOOL_GATE',
    moment: 'ACT',
    why: { text: '拦截写 .env（A1 敏感文件）', tags: ['a1'], confidence: 'high' },
    ...overrides,
  };
}

/** 读取日志文件的原始行（用于「原文逐字节不变」断言） */
function rawLines(dir: string): string[] {
  const p = getDecisionLogPath(dir);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim() !== '');
}

/** 取包含指定 ts 的原始行 */
function rawLineOfTs(dir: string, ts: string): string {
  const line = rawLines(dir).find((l) => l.includes(`"ts":"${ts}"`));
  expect(line, `未找到 ts=${ts} 的原始行`).toBeTruthy();
  return line as string;
}

describe('v1.5.2 章四 · 审计结论失效语义', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    // 与 decision-log.test.ts 同款隔离：临时 HMAC 密钥，绝不触碰真实 ~/.sofagent-key
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const KEY_PATH = join(testDir, 'test-hmac-key');
    // 强随机密钥——避开弱密钥告警（appendHistory 会检 'test-hmac-key' 字面模式），保持测试输出干净
    writeFileSync(KEY_PATH, randomBytes(32).toString('hex'));
    process.env.SOFAGENT_KEY_PATH = KEY_PATH;
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  // ── ① 词汇表落地 ──────────────────────────────────────────

  describe('① 失效原因词汇表', () => {
    it('invalidationReason 落盘并随条目读回（五项枚举全部可写）', () => {
      const reasons = [
        'authorization-changed', 'incompatible-compaction', 'elevated-risk', 'stale-score', 'fresh-required',
      ] as const;
      for (const reason of reasons) {
        const entry = emitDecision(
          { ...makeInput({ sessionId: `s-${reason}` }), kind: 'INVALIDATION', moment: 'ATTRIBUTION', invalidationReason: reason },
          testDir,
        );
        expect(entry.invalidationReason).toBe(reason);
      }
      const loaded = loadDecisionLog(testDir);
      expect(loaded.map((e) => e.invalidationReason)).toEqual([...reasons]);
    });

    it('非法 invalidationReason 被 schema 拒绝（DecisionSchemaError，不写文件）', () => {
      expect(() =>
        emitDecision(
          { ...makeInput(), kind: 'INVALIDATION', invalidationReason: 'NOT_A_REASON' as never },
          testDir,
        ),
      ).toThrow(DecisionSchemaError);
      expect(existsSync(getDecisionLogPath(testDir))).toBe(false);
    });

    it('可选语义：缺省 = 有效——不传则条目不落 invalidationReason 字段', () => {
      const entry = emitDecision(makeInput(), testDir);
      expect(entry.invalidationReason).toBeUndefined();
      expect(isInvalidationMarker(entry)).toBe(false);
      // 落盘 JSON 中不出现该键（老日志形态逐字一致）
      expect(rawLineOfTs(testDir, entry.ts)).not.toContain('invalidationReason');
    });
  });

  // ── ② 三触发钩子 ──────────────────────────────────────────

  describe('② 三触发钩子生效', () => {
    it('① 授权变更：以被关规则为依据的既有结论被标记失效', () => {
      // 既有结论：以规则 a1 为依据（tags=['a1']）
      const conclusion = emitDecision(makeInput({ why: { text: '放行 .env 变更', tags: ['a1'] } }), testDir);
      // 无关结论（不受影响）
      const unrelated = emitDecision(
        makeInput({ sessionId: 'sess-2', why: { text: '无关决策', tags: ['a9'] } }),
        testDir,
      );

      const marker = hooks.onAuthorizationChanged({
        agentId: 'sofagent-audit',
        sessionId: 'HEAD~1..HEAD',
        changedRules: ['a1'],
        trigger: 'config.yml 关闭审计规则：a1',
      }, testDir);

      expect(marker).not.toBeNull();
      expect(marker!.kind).toBe('INVALIDATION');
      expect(marker!.invalidationReason).toBe('authorization-changed');
      expect(marker!.causalType).toBe('influenced');
      expect(marker!.causedBy).toEqual([conclusion.ts]);

      expect(isInvalidated(conclusion.ts, testDir)).toBe(true);
      expect(isInvalidated(unrelated.ts, testDir)).toBe(false);
    });

    it('② 压缩事件：会话内既有结论全部标记失效（前提不再可核）', () => {
      const c1 = emitDecision(makeInput({ sessionId: 'sess-c', kind: 'ARTIFACT_EDIT' }), testDir);
      const c2 = emitDecision(makeInput({ sessionId: 'sess-c', kind: 'ORCHESTRATION', moment: 'INDUC' }), testDir);
      const other = emitDecision(makeInput({ sessionId: 'sess-other' }), testDir);

      const marker = hooks.onCompaction({
        agentId: 'sofagent',
        sessionId: 'sess-c',
        source: 'l2-tool-output',
        trigger: 'L2 工具输出总结：上下文已压缩',
      }, testDir);

      expect(marker).not.toBeNull();
      expect(marker!.invalidationReason).toBe('incompatible-compaction');
      expect(new Set(marker!.causedBy)).toEqual(new Set([c1.ts, c2.ts]));
      expect(isInvalidated(c1.ts, testDir)).toBe(true);
      expect(isInvalidated(c2.ts, testDir)).toBe(true);
      expect(isInvalidated(other.ts, testDir)).toBe(false);
    });

    it('③ 风险升级：同一对象后续被更严规则命中 → 先前结论失效（真实规则命中场景）', () => {
      // 「真实规则命中场景」：取规则注册表里的真实规则作为更严规则，
      // 并用真实审计历史落一条 FAIL 命中记录（同对象反复出现 = 风险升级）
      const strictRule = defaultRules[0]!;
      const objectRef = 'engine/audit/src/secrets.ts';
      const conclusion = emitDecision(
        makeInput({ artifactRef: objectRef, why: { text: `先前判定：${strictRule.name} 未命中`, tags: ['pass'] } }),
        testDir,
      );
      const historyEntry: AuditHistoryEntry = {
        timestamp: new Date().toISOString(),
        diffRange: 'HEAD~1..HEAD',
        exitCode: 2,
        ruleResults: [
          { number: 1, name: strictRule.name, status: 'FAIL', details: `${objectRef} 后续轮次被更严规则命中` },
        ],
        diffFileCount: 1,
      };
      appendHistory(historyEntry, testDir);

      const marker = hooks.onRiskEscalated({
        agentId: 'sofagent-audit',
        sessionId: 'HEAD~1..HEAD',
        objectRef,
        rule: strictRule.name,
        evidence: [`history: exitCode=${historyEntry.exitCode}`, `rule=${strictRule.name}`],
      }, testDir);

      expect(marker).not.toBeNull();
      expect(marker!.invalidationReason).toBe('elevated-risk');
      expect(marker!.causedBy).toEqual([conclusion.ts]);
      expect(isInvalidated(conclusion.ts, testDir)).toBe(true);
    });

    it('无可失效目标时不追加空标记（返回 null，日志不增长）', () => {
      const before = rawLines(testDir).length;
      const marker = hooks.onRiskEscalated({
        agentId: 'sofagent',
        sessionId: 'sess-none',
        objectRef: 'never/seen.ts',
        rule: 'A20',
      }, testDir);
      expect(marker).toBeNull();
      expect(rawLines(testDir).length).toBe(before);
    });

    it('幂等：同一触发重复调用不重复追加标记', () => {
      const conclusion = emitDecision(makeInput({ why: { text: 'x', tags: ['a2'] } }), testDir);
      const first = hooks.onAuthorizationChanged({ agentId: 'a', sessionId: 's', changedRules: ['a2'] }, testDir);
      const second = hooks.onAuthorizationChanged({ agentId: 'a', sessionId: 's', changedRules: ['a2'] }, testDir);
      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(collectInvalidations(testDir).has(conclusion.ts)).toBe(true);
    });

    it('选择器：规则匹配不误伤相邻编号（a1 不命中 a10）', () => {
      const a1 = emitDecision(makeInput({ why: { text: 'a1', tags: ['a1'] } }), testDir);
      const a10 = emitDecision(makeInput({ sessionId: 's2', why: { text: 'a10', tags: ['a10'] } }), testDir);
      expect(findConclusionsByRules(['a1'], testDir)).toEqual([a1.ts]);
      expect(findConclusionsByRules(['a10'], testDir)).toEqual([a10.ts]);
      expect(findConclusionsForObject('no-match', testDir)).toEqual([]);
      expect(findSessionConclusions('nope', undefined, testDir)).toEqual([]);
    });

    it('markInvalid 校验：空 targets / 非法 reason 拒绝写入', () => {
      expect(() => markInvalid({
        agentId: 'a', sessionId: 's', reason: 'elevated-risk', targets: [], trigger: 't',
      }, testDir)).toThrow(/targets/);
      expect(() => markInvalid({
        agentId: 'a', sessionId: 's', reason: 'nope' as never, targets: ['x'], trigger: 't',
      }, testDir)).toThrow(/失效原因/);
    });
  });

  // ── ③ 下游过滤 ────────────────────────────────────────────

  describe('③ 失效结论被下游过滤', () => {
    it('filterValid 剔除失效条目，未失效条目不受影响', () => {
      const valid = emitDecision(makeInput({ sessionId: 'v' }), testDir);
      const invalid = emitDecision(makeInput({ sessionId: 'i' }), testDir);
      hooks.onCompaction({ agentId: 'a', sessionId: 's', targets: [invalid.ts] }, testDir);
      const set = collectInvalidations(testDir);
      const kept = filterValid([valid, invalid], set);
      expect(kept.map((e) => e.ts)).toEqual([valid.ts]);
      expect(kept).toHaveLength(1);
    });

    it('HITL 依据：findSimilarDecisions（人审先例检索）不返回失效结论', () => {
      const q = { tags: ['hitl-precedent'] };
      const c1 = emitDecision(makeInput({ sessionId: 'p1', why: { text: '先例一', tags: ['hitl-precedent'] } }), testDir);
      const c2 = emitDecision(makeInput({ sessionId: 'p2', why: { text: '先例二', tags: ['hitl-precedent'] } }), testDir);
      expect(findSimilarDecisions(q, {}, testDir).map((h) => h.entry.ts).sort()).toEqual([c1.ts, c2.ts].sort());

      hooks.onCompaction({ agentId: 'a', sessionId: 's', targets: [c1.ts] }, testDir);
      expect(findSimilarDecisions(q, {}, testDir).map((h) => h.entry.ts)).toEqual([c2.ts]);
    });

    it('治理 KPI 统计：失效的 TOOL_GATE 结论不计入重复执行维度', () => {
      const agentId = 'kpi-agent';
      const d1 = emitDecision(makeInput({ agentId, why: { text: 'r1', tags: ['rep'] } }), testDir);
      emitDecision(makeInput({ agentId, why: { text: 'r2', tags: ['rep'] } }), testDir);

      const before = computeGovernanceKpis({ dataDir: testDir });
      expect(before.repetition.totalDecisions).toBe(2);
      expect(before.repetition.repeatedFingerprints).toBe(1);

      hooks.onAuthorizationChanged({ agentId: 'a', sessionId: 's', targets: [d1.ts] }, testDir);

      const after = computeGovernanceKpis({ dataDir: testDir });
      expect(after.repetition.totalDecisions).toBe(1);
      expect(after.repetition.repeatedFingerprints).toBe(0);
      // 失效条目仍在日志（原文留痕），只是不进统计
      expect(loadDecisionLog(testDir).some((e) => e.ts === d1.ts)).toBe(true);
    });
  });

  // ── ④ 原文保留 + 链不破坏 ─────────────────────────────────

  describe('④ 原文保留 + HMAC 链不破坏', () => {
    it('标记失效后原条目原始行逐字节不变，且 checkDecisionChainDetailed 仍判 ok', () => {
      const original = emitDecision(makeInput({ why: { text: '原始结论：放行', tags: ['a3'] } }), testDir);
      emitDecision(makeInput({ sessionId: 's2' }), testDir); // 保证 ≥2 条（验链下限）

      const lineBefore = rawLineOfTs(testDir, original.ts);
      expect(checkDecisionChainDetailed(testDir).status).toBe('ok');

      const marker = hooks.onAuthorizationChanged({
        agentId: 'sofagent-audit', sessionId: 's', changedRules: ['a3'],
      }, testDir);
      expect(marker).not.toBeNull();

      // 原文逐字节不变（失效是标记不是抹除）
      const lineAfter = rawLineOfTs(testDir, original.ts);
      expect(lineAfter).toBe(lineBefore);
      // 原行位置也不变（只追加，不重排/不插入）
      expect(rawLines(testDir).indexOf(lineAfter)).toBe(0);
      // 链仍完整可验
      const verdict = checkDecisionChainDetailed(testDir);
      expect(verdict.status).toBe('ok');
      expect(verdict.detail).toBeUndefined();
    });

    it('向后兼容：无 invalidationReason 的老口径条目照常解析、验链、且不在失效集合内', () => {
      const legacy = emitDecision(makeInput(), testDir); // 无新字段 = 老日志形态
      emitDecision(makeInput({ sessionId: 's2' }), testDir);
      expect(legacy.invalidationReason).toBeUndefined();
      expect(collectInvalidations(testDir).size).toBe(0);
      expect(isInvalidated(legacy.ts, testDir)).toBe(false);
      expect(filterValid(loadDecisionLog(testDir), collectInvalidations(testDir))).toHaveLength(2);
      expect(checkDecisionChainDetailed(testDir).status).toBe('ok');
    });
  });
});
