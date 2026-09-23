// ============================================================
// ruleset-export.test.ts · v1.5.2 章二 · 规则集导出单测
//
// 覆盖（changelog 章二验收标准逐条对号）：
//   1. ruleset_export 导出 24 条默认规则 + 已加载扩展（JSON 格式）
//   2. 双向可逆：导出物 → loadRulesetFile 读回 + validateRuleset 不报错
//   3. 每条规则含训练消费元数据（rule_id / 意图 / 样例 / 级别）
//   4. 导出物带版本号 + 内容指纹（指纹随内容变化）
//   5. 每次导出审计留痕（读回临时 dataDir 的 history.jsonl，条目数与导出次数一致）
//   6. 元数据表 24 条全覆盖
//
// 隔离纪律：所有落盘/留痕传临时目录（mkdtemp），**禁止污染开发者真实 ~/.sofagent**。
// 自指规避：不硬编码规则样例中的密钥/外联串（避免本测试文件本身命中 A2/A20）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { defaultRules, extendedRules } from '../rules/index';
import { loadRulesetFile, validateRuleset, type Ruleset } from '../ruleset-loader';
import {
  buildExportMetadata,
  assertIntentCoverage,
  RULE_INTENTS,
} from '../rules/export-metadata';
import {
  buildRulesetExport,
  buildRulesetCore,
  computeRulesetFingerprint,
  RULESET_EXPORT_SCHEMA_VERSION,
} from '../export/ruleset-export';

/** 规则集 id 全集快照（24 条——成员增删须显式改本断言） */
const EXPECTED_IDS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11',
  'A18', 'A19', 'A20', 'A21', 'A22', 'A23',
  'E1', 'E2', 'E4',
  'A14', 'A15', 'A16', 'A17',
].sort();

/** 临时目录登记（afterEach 统一清理） */
let tmpDirs: string[] = [];

function makeTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  tmpDirs = [];
});

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ────────────────────────────────────────────────────────────
// 一、导出范围 + 双向可逆（核心断言）
// ────────────────────────────────────────────────────────────

describe('规则集导出（24 条 · 双向可逆）', () => {
  it('导出 24 条默认规则 + 扩展规则（id 集合快照）', () => {
    const dataDir = makeTmp('ruleset-export-data-');
    const outDir = makeTmp('ruleset-export-out-');
    const result = buildRulesetExport({ dataDir, outDir, rulesetVersion: 'test-1.0.0' });

    expect(result.ok).toBe(true);
    expect(result.ruleCount).toBe(24);
    expect(result.ruleset.rules).toHaveLength(24);
    const ids = result.ruleset.rules.map((r) => r.id).sort();
    expect(ids).toEqual(EXPECTED_IDS);
    // 24 条与注册表逐条对应（源与导出同源，无遗漏）
    const registryIds = [...defaultRules, ...extendedRules].map((r) => r.id).sort();
    expect(ids).toEqual(registryIds);
  });

  it('双向可逆：导出物落盘 → loadRulesetFile 读回（规则数与 id 集一致，validateRuleset 不报错）', () => {
    const dataDir = makeTmp('ruleset-export-data-');
    const outDir = makeTmp('ruleset-export-out-');
    const result = buildRulesetExport({ dataDir, outDir, rulesetVersion: 'test-2.0.0' });

    expect(result.files).toHaveLength(1);
    const filePath = result.files[0]!;

    // 读回（loadRulesetFile 内部即调用 validateRuleset —— 不报错即通过校验）
    const loaded: Ruleset = loadRulesetFile(filePath);
    expect(loaded.rules).toHaveLength(24);
    const loadedIds = loaded.rules.map((r) => r.id).sort();
    expect(loadedIds).toEqual(EXPECTED_IDS);

    // 显式再跑一次校验（不抛即通过——双向可逆的硬断言）
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(() => validateRuleset(raw)).not.toThrow();
    expect(loaded.version).toBe('test-2.0.0');
    expect(loaded.name).toBe('sofagent');
    // 每条加载后的规则都有 pattern 必需面（可被规则集引擎执行）
    for (const r of loaded.rules) {
      expect(r.type).toBe('pattern');
      expect(typeof r.pattern === 'string' && r.pattern.length > 0).toBe(true);
      expect(['FAIL', 'WARN']).toContain(r.severity);
    }
  });

  it('开放格式：训练元数据随导出物走且 round-trip 保留（validateRuleset 忽略未知字段）', () => {
    const dataDir = makeTmp('ruleset-export-data-');
    const outDir = makeTmp('ruleset-export-out-');
    const result = buildRulesetExport({ dataDir, outDir, rulesetVersion: 'test-3.0.0' });
    const filePath = result.files[0]!;

    // 落盘 JSON 的原始形态（未经加载器裁剪）
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      rules: Array<Record<string, unknown>>;
    };
    const a1 = raw.rules.find((r) => r.id === 'A1')!;
    expect(a1.rule_id).toBe('A1');
    expect(typeof a1.intent).toBe('string');
    expect((a1.intent as string).length).toBeGreaterThan(0);
    expect(typeof a1.sampleViolation).toBe('string');
    expect((a1.sampleViolation as string).length).toBeGreaterThan(0);

    // 读回后未知字段仍在（loadRulesetFile 只 JSON.parse + 校验，不裁剪）
    const loaded = loadRulesetFile(filePath);
    const loadedA1 = loaded.rules.find((r) => r.id === 'A1') as Record<string, unknown>;
    expect(loadedA1.rule_id).toBe('A1');
    expect(loadedA1.intent).toBe(a1.intent);
  });
});

// ────────────────────────────────────────────────────────────
// 二、训练消费元数据完整性
// ────────────────────────────────────────────────────────────

describe('训练消费元数据（rule_id / 意图 / 样例 / 级别）', () => {
  it('每条导出规则含四件套元数据', () => {
    const dataDir = makeTmp('ruleset-export-data-');
    const outDir = makeTmp('ruleset-export-out-');
    const result = buildRulesetExport({ dataDir, outDir, rulesetVersion: 'test-4.0.0' });

    for (const r of result.ruleset.rules) {
      expect(r.rule_id).toBe(r.id);
      expect(r.id.length).toBeGreaterThan(0);
      expect(r.intent.length).toBeGreaterThan(0);
      expect(r.sampleViolation.length).toBeGreaterThan(0);
      expect(['FAIL', 'WARN']).toContain(r.severity);
      expect(['examples.match', 'synthesized']).toContain(r.sampleViolationSource);
    }
  });

  it('严重级别推导：critical → FAIL（8 条），其余 → WARN（16 条）', () => {
    const all = [...defaultRules, ...extendedRules];
    const meta = buildExportMetadata(all);
    const fails = meta.filter((m) => m.severity === 'FAIL').map((m) => m.ruleId).sort();
    // A1/A2/A9/A10/A20-A23 为 critical（index.ts 注册表 priority）
    expect(fails).toEqual(['A1', 'A10', 'A2', 'A20', 'A21', 'A22', 'A23', 'A9'].sort());
    expect(meta.filter((m) => m.severity === 'WARN')).toHaveLength(16);
    for (const m of meta) {
      expect(m.severityBasis.length).toBeGreaterThan(0);
    }
  });

  it('违规样例优先复用规则自带 examples.match（来源标注可复核）', () => {
    const all = [...defaultRules, ...extendedRules];
    const meta = buildExportMetadata(all);
    for (const m of meta) {
      const rule = all.find((r) => r.id === m.ruleId)!;
      const first = rule.examples?.match.find((s) => s.trim().length > 0);
      if (first) {
        expect(m.sampleViolationSource).toBe('examples.match');
        expect(m.sampleViolation).toBe(first);
      } else {
        // 防御性兜底分支：合成占位样例并标注来源
        expect(m.sampleViolationSource).toBe('synthesized');
      }
    }
    // 当前 24 条全部自带样例（兜底分支不应触发）
    expect(meta.every((m) => m.sampleViolationSource === 'examples.match')).toBe(true);
  });

  it('意图表 24 条全覆盖（断言 + 计数）', () => {
    const all = [...defaultRules, ...extendedRules];
    expect(Object.keys(RULE_INTENTS)).toHaveLength(24);
    expect(() => assertIntentCoverage(all)).not.toThrow();
    const meta = buildExportMetadata(all);
    expect(meta).toHaveLength(24);
    for (const m of meta) {
      expect(RULE_INTENTS[m.ruleId]).toBe(m.intent);
    }
    // 每条意图非空
    expect(Object.values(RULE_INTENTS).every((s) => s.trim().length > 0)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 三、版本号 + 内容指纹
// ────────────────────────────────────────────────────────────

describe('版本号与内容指纹', () => {
  it('导出物带规则集版本号 + schema 版本 + 32 位十六进制指纹', () => {
    const dataDir = makeTmp('ruleset-export-data-');
    const outDir = makeTmp('ruleset-export-out-');
    const result = buildRulesetExport({ dataDir, outDir, rulesetVersion: 'test-5.0.0' });

    expect(result.rulesetVersion).toBe('test-5.0.0');
    expect(result.ruleset.version).toBe('test-5.0.0');
    expect(result.schemaVersion).toBe(RULESET_EXPORT_SCHEMA_VERSION);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(result.ruleset.fingerprint).toBe(result.fingerprint);
    expect(['hmac-sha256', 'sha256']).toContain(result.fingerprintAlgo);
  });

  it('指纹随内容变化：改一条规则 → 指纹变；同内容 → 指纹恒同', () => {
    const all = [...defaultRules, ...extendedRules];
    const metaInfo = { name: 'sofagent', version: 'test-6.0.0', description: 'x' };
    const coreA = buildRulesetCore(all, metaInfo);
    const coreB = buildRulesetCore(all, metaInfo);
    // 同内容同指纹（无密钥确定性口径）
    const fpA = computeRulesetFingerprint(coreA, null);
    const fpB = computeRulesetFingerprint(coreB, null);
    expect(fpA).toBe(fpB);
    expect(fpA).toMatch(/^[0-9a-f]{32}$/);

    // 改一条规则（改 A1 名称）→ 指纹变
    const mutated = all.map((r) => (r.id === 'A1' ? { ...r, name: `${r.name}（变更）` } : r));
    const coreMutated = buildRulesetCore(mutated, metaInfo);
    const fpMutated = computeRulesetFingerprint(coreMutated, null);
    expect(fpMutated).not.toBe(fpA);
  });
});

// ────────────────────────────────────────────────────────────
// 四、审计留痕
// ────────────────────────────────────────────────────────────

describe('导出审计留痕', () => {
  it('每次导出写一条 history.jsonl（条目数 = 导出次数）', () => {
    const dataDir = makeTmp('ruleset-export-data-');
    const outDir = makeTmp('ruleset-export-out-');

    buildRulesetExport({ dataDir, outDir, rulesetVersion: 'test-7.0.0' });
    buildRulesetExport({ dataDir, outDir, rulesetVersion: 'test-7.0.0' });

    const historyPath = join(dataDir, 'audit', 'history.jsonl');
    const lines = readFileSync(historyPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    // 审计事件契约（结构化面）
    const result = buildRulesetExport({ dataDir, outDir, rulesetVersion: 'test-7.0.0' });
    expect(result.auditEvent.event).toBe('ruleset_export');
    expect(result.auditEvent.rulesetVersion).toBe('test-7.0.0');
    expect(result.auditEvent.fingerprint).toBe(result.fingerprint);
    expect(result.auditEvent.ruleCount).toBe(24);

    const linesAfter = readFileSync(historyPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(linesAfter).toHaveLength(3);
  });

  it('dryRun：不落盘产物，但审计留痕照写（导出行为本身受审计）', () => {
    const dataDir = makeTmp('ruleset-export-data-');
    const result = buildRulesetExport({ dataDir, dryRun: true, rulesetVersion: 'test-8.0.0' });
    expect(result.files).toEqual([]);
    expect(result.ruleCount).toBe(24);
    // 未落盘任何 ruleset 产物
    expect(result.files).toHaveLength(0);
    // 审计留痕照写（每次导出进 history）
    const historyPath = join(dataDir, 'audit', 'history.jsonl');
    const lines = readFileSync(historyPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});
