// domain-verifier.test.ts · 域验证器三档 / fail-closed / 保护面单测（v1.5.8 章一）
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  judgeAdmission,
  defaultTierForUnregistered,
  gateStrengthOf,
  isGateStrengthNonDecreasing,
  detectStagnation,
  loadRegistry,
  initializeRegistryProtected,
  computeContentHash,
  type DomainVerifierEntry,
} from '../domain-verifier-registry';
import {
  registerEvalSetProvenance,
  succeedEvalSet,
  stripAnswerKey,
  verifyContaminationSelfReport,
  safetySuiteVerdict,
  type ProvenanceLedger,
} from '../eval-provenance';

const ENTRIES: DomainVerifierEntry[] = [
  { domain: 'code', tier: 'deterministic', basis: '测试套件当免费验证器', registeredAt: '2026-10-09T00:00:00Z' },
  { domain: 'math', tier: 'deterministic', basis: '可机械验算', registeredAt: '2026-10-09T00:00:00Z' },
  { domain: 'summary-quality', tier: 'model-judge', basis: 'LLM 评分有成本但可行', registeredAt: '2026-10-09T00:00:00Z' },
  { domain: 'open-writing', tier: 'human-only', basis: '开放式写作验证与生成同价', registeredAt: '2026-10-09T00:00:00Z' },
];

describe('章一 · 域验证器三档登记与准入分流', () => {
  it('三档登记可配置（deterministic/model-judge/human-only 全档可登记）', () => {
    const tiers = new Set(ENTRIES.map((e) => e.tier));
    expect(tiers.has('deterministic')).toBe(true);
    expect(tiers.has('model-judge')).toBe(true);
    expect(tiers.has('human-only')).toBe(true);
  });

  it('deterministic 域 → auto（全自动走 eval-gate）', () => {
    const v = judgeAdmission('code', ENTRIES);
    expect(v.action).toBe('auto');
    expect(v.tier).toBe('deterministic');
  });

  it('model-judge 域 → auto-with-review（评分 + 采样人审）', () => {
    const v = judgeAdmission('summary-quality', ENTRIES);
    expect(v.action).toBe('auto-with-review');
    expect(v.reviewSampleRate).toBeGreaterThan(0);
    expect(v.reviewSampleRate).toBeLessThanOrEqual(1);
  });

  it('human-only 域 → 零自动晋升（强制 HITL）', () => {
    const v = judgeAdmission('open-writing', ENTRIES);
    expect(v.action).toBe('human-only');
  });

  it('未登记域 fail-closed 按 human-only 处理', () => {
    expect(defaultTierForUnregistered()).toBe('human-only');
    const v = judgeAdmission('totally-unknown-domain', ENTRIES);
    expect(v.action).toBe('human-only');
    expect(v.basis).toContain('fail-closed');
  });
});

describe('章一 · 门强度单调（自改进只能加门、不能撤门）', () => {
  it('门强度映射：三档 → 三强度', () => {
    expect(gateStrengthOf('deterministic')).toBe('eval-gate');
    expect(gateStrengthOf('model-judge')).toBe('eval-gate+sampled-review');
    expect(gateStrengthOf('human-only')).toBe('hitl-only');
  });

  it('强度不降判 true：平迁 / 加门方向', () => {
    expect(isGateStrengthNonDecreasing('eval-gate', 'eval-gate')).toBe(true);
    expect(isGateStrengthNonDecreasing('eval-gate', 'eval-gate+sampled-review')).toBe(true);
    expect(isGateStrengthNonDecreasing('eval-gate+sampled-review', 'hitl-only')).toBe(true);
  });

  it('强度弱化判 false：撤门方向的提案一律不准入', () => {
    expect(isGateStrengthNonDecreasing('hitl-only', 'eval-gate')).toBe(false);
    expect(isGateStrengthNonDecreasing('hitl-only', 'eval-gate+sampled-review')).toBe(false);
    expect(isGateStrengthNonDecreasing('eval-gate+sampled-review', 'eval-gate')).toBe(false);
  });
});

describe('章一 · 收益停滞检测（只提示不自动改方向）', () => {
  it('连续 N 轮无提升 → 停滞 + 转人审提示', () => {
    const readings = [
      { round: 1, heldOutScore: 0.80 },
      { round: 2, heldOutScore: 0.803 },
      { round: 3, heldOutScore: 0.805 },
    ];
    const v = detectStagnation(readings, { scaffoldPlainWithinWindow: false, checkpointPlainWithinWindow: true });
    expect(v.stagnant).toBe(true);
    expect(v.basis).toContain('转人审');
  });

  it('窗口内有实质提升 → 不停滞', () => {
    const readings = [
      { round: 1, heldOutScore: 0.80 },
      { round: 2, heldOutScore: 0.85 },
      { round: 3, heldOutScore: 0.86 },
    ];
    const v = detectStagnation(readings, { scaffoldPlainWithinWindow: false, checkpointPlainWithinWindow: false });
    expect(v.stagnant).toBe(false);
  });

  it('平稳二分：仅 checkpoint 平 → plateauKind=checkpoint（脚手架可能仍有余量）', () => {
    const readings = [
      { round: 1, heldOutScore: 0.80 },
      { round: 2, heldOutScore: 0.80 },
      { round: 3, heldOutScore: 0.80 },
    ];
    const v = detectStagnation(readings, { scaffoldPlainWithinWindow: false, checkpointPlainWithinWindow: true });
    expect(v.stagnant).toBe(true);
    expect(v.plateauKind).toBe('checkpoint');
  });

  it('读数不足 N 轮 → 不判定（宁缺勿假）', () => {
    const v = detectStagnation([{ round: 1, heldOutScore: 0.5 }], { scaffoldPlainWithinWindow: false, checkpointPlainWithinWindow: false });
    expect(v.stagnant).toBe(false);
  });
});

describe('章一 · 登记表保护面（可写面之外 + 篡改校验）', () => {
  let dir: string;
  it('人工初始化 → 只读位在位 + 读入校验通过', () => {
    dir = mkdtempSync(join(tmpdir(), 'sofagent-verify-reg-'));
    const { path, contentHash } = initializeRegistryProtected(dir, ENTRIES);
    const load = loadRegistry(dir);
    expect(load.ok).toBe(true);
    if (load.ok) {
      expect(load.entries).toHaveLength(4);
      expect(load.contentHash).toBe(contentHash);
    }
    // 只读位断言（保护面 = 文件系统只读）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const mode = fs.statSync(path).mode;
    expect(mode & 0o222).toBe(0);
  });

  it('entries 被篡改（哈希不匹配）→ fail-closed 拒载', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'sofagent-verify-tamper-'));
    initializeRegistryProtected(dir2, ENTRIES);
    const path = join(dir2, 'protected', 'domain-verifiers.json');
    chmodSync(path, 0o644); // 人工模拟篡改者先解锁
    const file = JSON.parse(require('node:fs').readFileSync(path, 'utf8'));
    file.entries[0].tier = 'deterministic→tampered';
    writeFileSync(path, JSON.stringify(file));
    chmodSync(path, 0o444);
    const load = loadRegistry(dir2);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason).toContain('钉哈希不匹配');
    rmSync(dir2, { recursive: true, force: true });
  });

  it('钉哈希计算确定性（同输入同哈希；变一字符即变）', () => {
    const h1 = computeContentHash(ENTRIES);
    const h2 = computeContentHash([...ENTRIES]);
    expect(h1).toBe(h2);
    const h3 = computeContentHash([{ ...ENTRIES[0], basis: 'changed' }, ...ENTRIES.slice(1)]);
    expect(h3).not.toBe(h1);
  });

  it('登记表不存在 → fail-closed（全 human-only 最安全态）', () => {
    const dir3 = mkdtempSync(join(tmpdir(), 'sofagent-verify-none-'));
    const load = loadRegistry(dir3);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason).toContain('fail-closed');
    rmSync(dir3, { recursive: true, force: true });
  });

  it('登记表路径落在可写面清单之外（protected/ 是唯一例外位）', () => {
    const dir4 = mkdtempSync(join(tmpdir(), 'sofagent-verify-path-'));
    const { path } = initializeRegistryProtected(dir4, ENTRIES);
    expect(path).toContain(join('protected', 'domain-verifiers.json'));
    rmSync(dir4, { recursive: true, force: true });
  });
});

describe('章一 · 评测集谱系与防投毒', () => {
  const items = [
    { id: 'q1', prompt: '实现 foo', expected: 'foo passes' },
    { id: 'q2', prompt: '修复 bar', expected: 'bar fixed' },
  ];

  it('谱系登记：来源/版本/变更权/钉哈希齐备', () => {
    const p = registerEvalSetProvenance({
      setId: 'heldout-code',
      origin: '人工策划 100 题',
      version: 3,
      items,
      contaminationSelfReport: { q1: [], q2: ['boolq'] },
    });
    expect(p.changeAuthority).toBe('human-fde');
    expect(p.contentHash).toHaveLength(64);
    expect(p.version).toBe(3);
  });

  it('留出集换代：新建集 + 不可横比声明留痕', () => {
    const ledger: ProvenanceLedger = { schemaVersion: 1, sets: [], successionDeclarations: [] };
    const v3 = registerEvalSetProvenance({ setId: 'heldout', origin: 'x', version: 3, items, contaminationSelfReport: { q1: [], q2: [] } });
    const next = succeedEvalSet(ledger, v3, '半集污染感知到，全量换题', '2026-10-09T00:00:00Z');
    expect(next.sets).toHaveLength(1);
    expect(next.successionDeclarations).toHaveLength(1);
    expect(next.successionDeclarations[0].note).toContain('不可横比');
  });

  it('答案键剥离：投影条目无 expected 字段', () => {
    const stripped = stripAnswerKey(items);
    expect(stripped).toHaveLength(2);
    for (const s of stripped) {
      expect(s).not.toHaveProperty('expected');
    }
  });

  it('污染自陈校验：缺自陈条目 fail-closed 暴露', () => {
    const p = registerEvalSetProvenance({ setId: 's', origin: 'x', version: 1, items, contaminationSelfReport: { q1: [] } });
    const v = verifyContaminationSelfReport(p, ['q1', 'q2']);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(['q2']);
  });

  it('安全套件独立硬阻断：命中即 block，分数不参与权衡', () => {
    const blocked = safetySuiteVerdict(['A20 外传命中'], 0.99);
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toContain('硬阻断');
    const pass = safetySuiteVerdict([], 0.3);
    expect(pass.blocked).toBe(false);
  });
});
