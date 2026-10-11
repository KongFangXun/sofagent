// ============================================================
// baseline-snapshot.test.ts · 能力基线版本线测试（v1.5.9 章二）
// 覆盖：快照完整性（四层打包 / 可寻址 id / 篡改检出）/
//       版本链前驱指针（成链 / 寻址 / 回溯任一时点）/ 回滚可举证（四层计划 + decision-log 留痕 + 引证）
// 隔离纪律：SOFAGENT_DATA 指向临时目录（不触真实 ~/.sofagent/data）
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMemoryStore } from '@sofagent/core';

import {
  BASELINE_LAYERS,
  collectFourLayerState,
  computeStateHash,
  createBaselineSnapshot,
  loadBaselineChain,
  resolveBaselineChainPath,
  getBaselineById,
  resolveBaselineAt,
  verifySnapshotIntegrity,
  verifyBaselineChain,
  rollbackToBaseline,
  citeBaseline,
  buildRestorePlan,
  advisoryBaselineRestorer,
  BaselineIntegrityError,
  BaselineNotFoundError,
  type BaselineSnapshot,
  type BaselineRestorePlan,
  type CapabilityChangeEventInput,
} from '../baseline-snapshot';

let dataDir: string;
let skillRoot: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'baseline-data-'));
  skillRoot = mkdtempSync(join(tmpdir(), 'baseline-skills-'));
  process.env.SOFAGENT_DATA = dataDir;
});

afterAll(() => {
  delete process.env.SOFAGENT_DATA;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(skillRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // 每测重置链与 evolve 台账；memory 事实按需重建
  rmSync(join(dataDir, 'evolve'), { recursive: true, force: true });
  rmSync(join(dataDir, 'memory'), { recursive: true, force: true });
});

/** 造一个变更事件（at 递增由调用方给） */
function ev(over: Partial<CapabilityChangeEventInput> = {}): CapabilityChangeEventInput {
  return { kind: 'promote', actor: 'agent-1', source: 'self-improvement', at: '2026-10-01T00:00:00.000Z', ...over };
}

/** 造一条记忆事实（锚点来源） */
function seedFact(key: string, value: string): void {
  createMemoryStore(dataDir, { scope: 'test' }).set({
    key,
    value,
    source: 'test',
    confidence: 1,
    tags: [],
    scope: 'test',
  });
}

/** 采集四层（统一注入隔离参数与确定性时间） */
function collect(at = '2026-10-01T00:00:00.000Z') {
  return collectFourLayerState({
    dataDir,
    skillRoot,
    configValues: { skillDir: '.sofagent' },
    weightsManifestRef: 'wm-v3-sha256:abc123',
    now: () => at,
  });
}

// ════════════════════════════════════════════════════════════
describe('章二 · 快照完整性（四层打包 + 可寻址 id + 篡改检出）', () => {
  it('四层齐备：prompt / skill / memory / weights 全部采集，版本带域前缀', () => {
    seedFact('用户偏好.前端框架', 'React');
    seedFact('项目约定.包管理', 'pnpm');
    const state = collect();
    expect(state.prompt.version.startsWith('pc-')).toBe(true);
    expect(state.prompt.fieldCount).toBeGreaterThan(0);
    expect(state.prompt.layers.length).toBeGreaterThan(0);
    expect(state.skill.version.startsWith('sk-')).toBe(true);
    expect(state.memoryAnchors.map((a) => a.key).sort()).toEqual(['用户偏好.前端框架', '项目约定.包管理']);
    // 锚点只存指针 + 摘要，不存事实原文
    expect(state.memoryAnchors[0]!.hash).toHaveLength(16);
    expect(state.weights.ref).toBe('wm-v3-sha256:abc123');
    expect(state.collectedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('权重 manifest 未接线 ⇒ 如实记 null + 原因（不假装有值）', () => {
    const state = collectFourLayerState({ dataDir, skillRoot, weightsManifestRef: undefined, now: () => '2026-10-01T00:00:00.000Z' });
    expect(state.weights.ref).toBeNull();
    expect(String(state.weights.reason)).toContain('软依赖');
  });

  it('能力变更自动生成快照：可寻址 id + stateHash 自证一致', () => {
    const snap = createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: { skillDir: '.sofagent' }, weightsManifestRef: 'wm-1' });
    expect(snap.id).toMatch(/^bs-[0-9a-f]{16}$/);
    expect(snap.prevId).toBeNull();
    expect(snap.stateHash).toBe(computeStateHash(snap.state));
    expect(verifySnapshotIntegrity(snap).ok).toBe(true);
  });

  it('四层状态被篡改 ⇒ 完整性自证失败（stateHash 不匹配）', () => {
    const snap = createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1', persist: false });
    const tampered: BaselineSnapshot = {
      ...snap,
      state: { ...snap.state, memoryAnchors: [{ key: '伪造', factId: 'x', updatedAt: 'x', hash: 'x' }] },
    };
    const integ = verifySnapshotIntegrity(tampered);
    expect(integ.ok).toBe(false);
    expect(String(integ.reason)).toContain('篡改');
  });
});

// ════════════════════════════════════════════════════════════
describe('章二 · 版本链前驱指针（成链 / 寻址 / 回溯任一时点）', () => {
  it('快照按时间成链：链首 prevId=null，其后逐条指向直接前驱', () => {
    const s1 = createBaselineSnapshot(ev({ at: '2026-10-01T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const s2 = createBaselineSnapshot(ev({ kind: 'write-surface', at: '2026-10-02T00:00:00.000Z', surface: 'prompt', target: 'SKILL.md' }), {
      dataDir,
      skillRoot,
      configValues: {},
      weightsManifestRef: 'wm-1',
    });
    const s3 = createBaselineSnapshot(ev({ kind: 'demote', at: '2026-10-03T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });

    const chain = loadBaselineChain(dataDir);
    expect(chain.map((s) => s.id)).toEqual([s1.id, s2.id, s3.id]);
    expect(chain[0]!.prevId).toBeNull();
    expect(chain[1]!.prevId).toBe(s1.id);
    expect(chain[2]!.prevId).toBe(s2.id);
    expect(verifyBaselineChain(chain).ok).toBe(true);
    expect(resolveBaselineChainPath(dataDir)).toBe(join(dataDir, 'evolve', 'baseline-chain.jsonl'));
    expect(existsSync(resolveBaselineChainPath(dataDir))).toBe(true);
  });

  it('按 id 寻址：全 id 与短前缀均可命中；未命中 ⇒ 具名报错', () => {
    const s1 = createBaselineSnapshot(ev({ at: '2026-10-01T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = loadBaselineChain(dataDir);
    expect(getBaselineById(chain, s1.id).id).toBe(s1.id);
    expect(getBaselineById(chain, s1.id.slice(0, 8)).id).toBe(s1.id);
    expect(() => getBaselineById(chain, 'bs-deadbeefdeadbeef')).toThrow(BaselineNotFoundError);
  });

  it('回溯任一时点：取 createdAt ≤ 目标时刻的最后一条快照', () => {
    const s1 = createBaselineSnapshot(ev({ at: '2026-10-01T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const s2 = createBaselineSnapshot(ev({ at: '2026-10-02T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = loadBaselineChain(dataDir);
    expect(resolveBaselineAt(chain, '2026-09-30T00:00:00.000Z')).toBeNull();
    expect(resolveBaselineAt(chain, '2026-10-01T12:00:00.000Z')!.id).toBe(s1.id);
    expect(resolveBaselineAt(chain, '2026-10-05T00:00:00.000Z')!.id).toBe(s2.id);
  });

  it('前驱指针断裂 ⇒ 链完整性判定失败并具名定位', () => {
    createBaselineSnapshot(ev({ at: '2026-10-01T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    createBaselineSnapshot(ev({ at: '2026-10-02T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = loadBaselineChain(dataDir);
    const broken = [{ ...chain[0]! }, { ...chain[1]!, prevId: 'bs-0000000000000000' }];
    const integ = verifyBaselineChain(broken);
    expect(integ.ok).toBe(false);
    expect(integ.failures.some((f) => f.includes('前驱指针断裂'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
describe('章二 · 回滚可举证（四层计划 + decision-log 留痕 + 引证）', () => {
  it('四层恢复计划齐备且各绑定既有机制', () => {
    const snap = createBaselineSnapshot(ev(), {
      dataDir,
      skillRoot,
      configValues: {},
      weightsManifestRef: 'wm-1',
      repoSnapshotSha: 'a'.repeat(40),
      persist: false,
    });
    const plan = buildRestorePlan(snap);
    expect(plan.directives.map((d) => d.layer)).toEqual([...BASELINE_LAYERS]);
    expect(plan.directives.find((d) => d.layer === 'prompt')!.mechanism).toBe('snapshot-restore');
    expect(plan.directives.find((d) => d.layer === 'skill')!.mechanism).toBe('snapshot-restore');
    expect(plan.directives.find((d) => d.layer === 'memory')!.mechanism).toBe('memory-store');
    expect(plan.directives.find((d) => d.layer === 'weights')!.mechanism).toBe('manifest-ref');
  });

  it('按快照 id 回滚四层 + 回滚动作落 decision-log（引用快照 id 留痕）', () => {
    seedFact('事故锚点.上下文', 'before');
    const snap = createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = loadBaselineChain(dataDir);

    let observedPlan: BaselineRestorePlan | null = null;
    const spyRestorer = (plan: BaselineRestorePlan) => {
      observedPlan = plan;
      return { restored: [...BASELINE_LAYERS], skipped: [], notes: ['探针：四层全恢复'] };
    };
    const written: Array<{ kind: string; moment: string; why: string; evidence?: string[] }> = [];
    const spyWriter = (entry: { kind: string; moment: string; why: string; evidence?: string[] }) => {
      written.push(entry);
      return { ts: '2026-10-10T00:00:00.000Z' };
    };

    const record = rollbackToBaseline(snap.id, { chain, restorer: spyRestorer, writer: spyWriter, now: () => '2026-10-10T00:00:00.000Z', actor: 'fde-1' });

    expect(observedPlan!.snapshotId).toBe(snap.id);
    expect(observedPlan!.directives).toHaveLength(4);
    expect(record.snapshotId).toBe(snap.id);
    expect(record.actor).toBe('fde-1');
    expect(record.outcome.restored).toEqual([...BASELINE_LAYERS]);
    // decision-log 留痕（举证：kind=EVOLUTION / moment=EVOLVE / evidence 引用快照 id）
    expect(written).toHaveLength(1);
    expect(written[0]!.kind).toBe('EVOLUTION');
    expect(written[0]!.moment).toBe('EVOLVE');
    expect(written[0]!.evidence!.some((e) => e.includes(`snapshotId=${snap.id}`))).toBe(true);
    expect(record.decisionLogTs).toBe('2026-10-10T00:00:00.000Z');
  });

  it('判定模式恢复器不出副作用，而默认 writer 经软依赖真实落 decision-log', () => {
    const snap = createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    expect(advisoryBaselineRestorer(buildRestorePlan(snap)).restored).toEqual([]);
    const record = rollbackToBaseline(snap.id, { chain: loadBaselineChain(dataDir), now: () => '2026-10-10T00:00:00.000Z' });
    // 判定模式：恢复动作零副作用（只出计划，不改四层状态）
    expect(record.outcome.restored).toEqual([]);
    expect(record.outcome.skipped).toEqual([...BASELINE_LAYERS]);
    // 默认 writer（createCoreDecisionWriter，绑定本 dataDir）：core 已 @public 导出
    // emitAuditDecision ⇒ 留痕真实落盘（不再是旧前提下的「缺导出 ⇒ null」）。
    expect(record.decisionLogTs).not.toBeNull();
    expect(Number.isNaN(Date.parse(record.decisionLogTs as string))).toBe(false);
  });

  it('拒绝回滚被篡改的快照（fail-closed）', () => {
    const snap = createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const tampered: BaselineSnapshot = { ...snap, state: { ...snap.state, collectedAt: '改过了' } };
    expect(() => rollbackToBaseline(tampered, { chain: [tampered] })).toThrow(BaselineIntegrityError);
  });

  it('举证记录可引用快照 id（「事故发生在基线 X 下」）', () => {
    const snap = createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = loadBaselineChain(dataDir);
    const citation = citeBaseline(chain, snap.id, '事故发生在基线 X 下', () => '2026-10-11T00:00:00.000Z');
    expect(citation.snapshotId).toBe(snap.id);
    expect(citation.reason).toBe('事故发生在基线 X 下');
    expect(citation.stateSummary.promptVersion).toBe(snap.state.prompt.version);
    expect(citation.stateSummary.skillVersion).toBe(snap.state.skill.version);
    expect(citation.stateSummary.memoryAnchorCount).toBe(snap.state.memoryAnchors.length);
  });
});
