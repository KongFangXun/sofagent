// ============================================================
// baseline-snapshot.test.ts · 能力基线版本线测试（v1.5.9 章二）
// 覆盖：快照完整性（四层打包 / 可寻址 id / 篡改检出）/
//       版本链前驱指针（成链 / 寻址 / 回溯任一时点）/ 回滚可举证（四层计划 + decision-log 留痕 + 引证）
// 隔离纪律：SOFAGENT_DATA 指向临时目录（不触真实 ~/.sofagent/data）
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
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
  // 每测重置链与 evolve 台账；memory 事实按需重建；skill 根同步清理（BUG-52
  // 文件清单用例会在根下摆文件，跨测残留会污染空清单/排序断言）
  rmSync(join(dataDir, 'evolve'), { recursive: true, force: true });
  rmSync(join(dataDir, 'memory'), { recursive: true, force: true });
  for (const e of readdirSync(skillRoot)) rmSync(join(skillRoot, e), { recursive: true, force: true });
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
  it('四层齐备：prompt / skill / memory / weights 全部采集，版本带域前缀', async () => {
    seedFact('用户偏好.前端框架', 'React');
    seedFact('项目约定.包管理', 'pnpm');
    const state = collect();
    expect(state.prompt.version.startsWith('pc-')).toBe(true);
    expect(state.prompt.fieldCount).toBeGreaterThan(0);
    expect(state.prompt.layers.length).toBeGreaterThan(0);
    expect(state.skill.version.startsWith('sk-')).toBe(true);
    expect(state.memoryAnchors.count).toBe(2); // v1.8.0 Q29 聚合态：count+anchorsHash（明细不再逐条复制）
    // 锚点只存指针 + 摘要，不存事实原文
    expect(state.memoryAnchors.anchorsHash).toHaveLength(64); // sha256 全长聚合哈希
    expect(state.weights.ref).toBe('wm-v3-sha256:abc123');
    expect(state.collectedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('权重 manifest 未接线 ⇒ 如实记 null + 原因（不假装有值）', async () => {
    const state = collectFourLayerState({ dataDir, skillRoot, weightsManifestRef: undefined, now: () => '2026-10-01T00:00:00.000Z' });
    expect(state.weights.ref).toBeNull();
    expect(String(state.weights.reason)).toContain('软依赖');
  });

  it('能力变更自动生成快照：可寻址 id + stateHash 自证一致', async () => {
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: { skillDir: '.sofagent' }, weightsManifestRef: 'wm-1' });
    expect(snap.id).toMatch(/^bs-[0-9a-f]{16}$/);
    expect(snap.prevId).toBeNull();
    expect(snap.stateHash).toBe(computeStateHash(snap.state));
    expect(verifySnapshotIntegrity(snap).ok).toBe(true);
  });

  it('四层状态被篡改 ⇒ 完整性自证失败（stateHash 不匹配）', async () => {
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1', persist: false });
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
  it('快照按时间成链：链首 prevId=null，其后逐条指向直接前驱', async () => {
    const s1 = await createBaselineSnapshot(ev({ at: '2026-10-01T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const s2 = await createBaselineSnapshot(ev({ kind: 'write-surface', at: '2026-10-02T00:00:00.000Z', surface: 'prompt', target: 'SKILL.md' }), {
      dataDir,
      skillRoot,
      configValues: {},
      weightsManifestRef: 'wm-1',
    });
    const s3 = await createBaselineSnapshot(ev({ kind: 'demote', at: '2026-10-03T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });

    const chain = await loadBaselineChain(dataDir);
    expect(chain.map((s) => s.id)).toEqual([s1.id, s2.id, s3.id]);
    expect(chain[0]!.prevId).toBeNull();
    expect(chain[1]!.prevId).toBe(s1.id);
    expect(chain[2]!.prevId).toBe(s2.id);
    expect(verifyBaselineChain(chain).ok).toBe(true);
    expect(resolveBaselineChainPath(dataDir)).toBe(join(dataDir, 'evolve', 'baseline-chain.jsonl'));
    expect(existsSync(resolveBaselineChainPath(dataDir))).toBe(true);
  });

  it('按 id 寻址：全 id 与短前缀均可命中；未命中 ⇒ 具名报错', async () => {
    const s1 = await createBaselineSnapshot(ev({ at: '2026-10-01T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = await loadBaselineChain(dataDir);
    expect(getBaselineById(chain, s1.id).id).toBe(s1.id);
    expect(getBaselineById(chain, s1.id.slice(0, 8)).id).toBe(s1.id);
    expect(() => getBaselineById(chain, 'bs-deadbeefdeadbeef')).toThrow(BaselineNotFoundError);
  });

  it('回溯任一时点：取 createdAt ≤ 目标时刻的最后一条快照', async () => {
    const s1 = await createBaselineSnapshot(ev({ at: '2026-10-01T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const s2 = await createBaselineSnapshot(ev({ at: '2026-10-02T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = await loadBaselineChain(dataDir);
    expect(resolveBaselineAt(chain, '2026-09-30T00:00:00.000Z')).toBeNull();
    expect(resolveBaselineAt(chain, '2026-10-01T12:00:00.000Z')!.id).toBe(s1.id);
    expect(resolveBaselineAt(chain, '2026-10-05T00:00:00.000Z')!.id).toBe(s2.id);
  });

  it('前驱指针断裂 ⇒ 链完整性判定失败并具名定位', async () => {
    await createBaselineSnapshot(ev({ at: '2026-10-01T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    await createBaselineSnapshot(ev({ at: '2026-10-02T00:00:00.000Z' }), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = await loadBaselineChain(dataDir);
    const broken = [{ ...chain[0]! }, { ...chain[1]!, prevId: 'bs-0000000000000000' }];
    const integ = verifyBaselineChain(broken);
    expect(integ.ok).toBe(false);
    expect(integ.failures.some((f) => f.includes('前驱指针断裂'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
describe('章二 · 回滚可举证（四层计划 + decision-log 留痕 + 引证）', () => {
  it('四层恢复计划齐备且各绑定既有机制', async () => {
    const snap = await createBaselineSnapshot(ev(), {
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

  it('按快照 id 回滚四层 + 回滚动作落 decision-log（引用快照 id 留痕）', async () => {
    seedFact('事故锚点.上下文', 'before');
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = await loadBaselineChain(dataDir);

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

    const record = await rollbackToBaseline(snap.id, { chain, restorer: spyRestorer, writer: spyWriter, now: () => '2026-10-10T00:00:00.000Z', actor: 'fde-1' });

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

  it('判定模式恢复器不出副作用，而默认 writer 经软依赖真实落 decision-log', async () => {
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    expect(advisoryBaselineRestorer(buildRestorePlan(snap)).restored).toEqual([]);
    const record = await rollbackToBaseline(snap.id, { chain: await loadBaselineChain(dataDir), now: () => '2026-10-10T00:00:00.000Z' });
    // 判定模式：恢复动作零副作用（只出计划，不改四层状态）
    expect(record.outcome.restored).toEqual([]);
    expect(record.outcome.skipped).toEqual([...BASELINE_LAYERS]);
    // 默认 writer（createCoreDecisionWriter，绑定本 dataDir）：core 已 @public 导出
    // emitAuditDecision ⇒ 留痕真实落盘（不再是旧前提下的「缺导出 ⇒ null」）。
    expect(record.decisionLogTs).not.toBeNull();
    expect(Number.isNaN(Date.parse(record.decisionLogTs as string))).toBe(false);
  });

  it('拒绝回滚被篡改的快照（fail-closed）', async () => {
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const tampered: BaselineSnapshot = { ...snap, state: { ...snap.state, collectedAt: '改过了' } };
    await expect(rollbackToBaseline(tampered, { chain: [tampered] })).rejects.toThrow(BaselineIntegrityError);
  });

  it('举证记录可引用快照 id（「事故发生在基线 X 下」）', async () => {
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    const chain = await loadBaselineChain(dataDir);
    const citation = citeBaseline(chain, snap.id, '事故发生在基线 X 下', () => '2026-10-11T00:00:00.000Z');
    expect(citation.snapshotId).toBe(snap.id);
    expect(citation.reason).toBe('事故发生在基线 X 下');
    expect(citation.stateSummary.promptVersion).toBe(snap.state.prompt.version);
    expect(citation.stateSummary.skillVersion).toBe(snap.state.skill.version);
    expect(citation.stateSummary.memoryAnchorCount).toBe(snap.state.memoryAnchors.count); // v1.8.0 Q29 聚合态
  });
});

// ════════════════════════════════════════════════════════════
describe('BUG-52 · fileManifest 双判（防删除绕过收口）', () => {
  /** 在 skill 根摆两个文件（prompt/skill 层实际落盘处） */
  function seedSkillFiles(): void {
    mkdirSync(join(skillRoot, 'skills', 'demo'), { recursive: true });
    writeFileSync(join(skillRoot, 'SKILL.md'), '# skill root\n');
    writeFileSync(join(skillRoot, 'skills', 'demo', 'SKILL.md'), '# demo skill\n');
  }

  it('新快照自带 fileManifest：根锚定 + 相对路径 + 内容哈希、按 path 排序', async () => {
    seedSkillFiles();
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1', persist: false });
    expect(snap.fileManifest).toBeDefined();
    expect(snap.fileManifest!.skillRoot).toBe(skillRoot);
    const paths = snap.fileManifest!.files.map((e) => e.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain('SKILL.md');
    expect(paths).toContain('skills/demo/SKILL.md');
    expect(snap.fileManifest!.files[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // 快照 id 不受 manifest 影响（manifest 是校验面不是寻址面）
    expect(snap.id).toMatch(/^bs-[0-9a-f]{16}$/);
    expect(verifySnapshotIntegrity(snap).ok).toBe(true);
  });

  it('态一（改文件 → 红）：磁盘文件改动后 stateHash 仍一致，但第二判失配', async () => {
    seedSkillFiles();
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1', persist: false });
    writeFileSync(join(skillRoot, 'skills', 'demo', 'SKILL.md'), '# demo skill (被改动)\n');
    const integ = verifySnapshotIntegrity(snap);
    expect(integ.ok).toBe(false);
    expect(String(integ.reason)).toContain('文件被删除或改动');
    expect(String(integ.reason)).toContain('skills/demo/SKILL.md');
  });

  it('态二（删文件 → 红·主断言）：清单内文件被删除，第二判报不存在', async () => {
    seedSkillFiles();
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1', persist: false });
    rmSync(join(skillRoot, 'skills', 'demo', 'SKILL.md'));
    const integ = verifySnapshotIntegrity(snap);
    expect(integ.ok).toBe(false);
    expect(String(integ.reason)).toContain('文件被删除或改动');
    expect(String(integ.reason)).toContain('不存在');
    // reverse-probe：还原文件（内容回写）后恢复绿
    writeFileSync(join(skillRoot, 'skills', 'demo', 'SKILL.md'), '# demo skill\n');
    expect(verifySnapshotIntegrity(snap).ok).toBe(true);
  });

  it('态三（legacy 无 manifest → 过 + 提示）：跳过第二判不判红', async () => {
    seedSkillFiles();
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1', persist: false });
    const legacy: BaselineSnapshot = (({ fileManifest: _omit, ...rest }) => rest)(snap) as BaselineSnapshot;
    expect(legacy.fileManifest).toBeUndefined();
    rmSync(join(skillRoot, 'skills', 'demo', 'SKILL.md')); // 即便文件已删——legacy 路径不判红
    const integ = verifySnapshotIntegrity(legacy);
    expect(integ.ok).toBe(true);
    expect(String(integ.notice)).toContain('legacy 快照无文件清单');
  });

  it('空清单（skill 根无文件）→ ok + 提示（与 skill 层采集宽容语义对齐）', async () => {
    const snap = await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1', persist: false });
    expect(snap.fileManifest!.files).toEqual([]);
    const integ = verifySnapshotIntegrity(snap);
    expect(integ.ok).toBe(true);
    expect(String(integ.notice ?? '')).toContain('清单为空');
  });

  it('链完整性判定沿用双判结果（删除文件后 verifyBaselineChain 失败）', async () => {
    seedSkillFiles();
    await createBaselineSnapshot(ev(), { dataDir, skillRoot, configValues: {}, weightsManifestRef: 'wm-1' });
    rmSync(join(skillRoot, 'skills', 'demo', 'SKILL.md'));
    const chain = await loadBaselineChain(dataDir);
    const result = verifyBaselineChain(chain);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes('文件被删除或改动'))).toBe(true);
  });
});
